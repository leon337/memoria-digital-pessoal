import {
  CorrectionDomainError,
  createTextCorrectionRecord,
  orderTextFactHistory,
  type TextMemoryRecord,
} from '@mdp/domain';
import { MemoryInvariantError } from '../../../memories/memory.errors.js';
import {
  MemoryStoreUnavailableError,
  type CorrectMemoryStoreInput,
  type CorrectMemoryStoreResult,
  type MemoryStore,
  type QueryHit,
  type StoredMemory,
  type StoredMemoryHistory,
} from '../../../memories/memory.store.js';
import { PrismaService } from './prisma.service.js';

interface QueryHitRow {
  memoryId: string;
  evidenceId: string;
  factId: string;
  content: string;
  recordedAt: Date;
}

const unavailableCodes = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2037',
  'ECONNREFUSED',
  'ECONNRESET',
  '57P01',
  '57P02',
  '57P03',
]);

function isPersistenceUnavailable(error: unknown, depth = 0): boolean {
  if (depth > 4 || !error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string' && unavailableCodes.has(candidate.code)) {
    return true;
  }
  if (typeof candidate.message === 'string') {
    const message = candidate.message.toLowerCase();
    if (
      message.includes('connection refused') ||
      message.includes('econnrefused') ||
      message.includes('connection terminated') ||
      message.includes('server closed the connection') ||
      message.includes("can't reach database server")
    ) {
      return true;
    }
  }
  return isPersistenceUnavailable(candidate.cause, depth + 1);
}

export class PrismaMemoryStore implements MemoryStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(record: TextMemoryRecord): Promise<void> {
    return this.withAvailabilityMapping(async () => {
      await this.prisma.run(async (client) => {
        await client.$transaction(async (tx) => {
          await tx.memory.create({
            data: {
              id: record.memory.id,
              recordedAt: record.memory.recordedAt,
              occurredAt: record.memory.occurredAt,
              temporalPrecision: record.memory.temporalPrecision,
            },
          });
          await tx.evidence.create({
            data: {
              id: record.evidence.id,
              memoryId: record.evidence.memoryId,
              kind: record.evidence.kind,
              content: record.evidence.content,
              createdAt: record.evidence.createdAt,
            },
          });
          await tx.ledgerEvent.create({
            data: {
              id: record.event.id,
              memoryId: record.event.memoryId,
              evidenceId: record.event.evidenceId,
              type: record.event.type,
              createdAt: record.event.createdAt,
            },
          });
          await tx.fact.create({
            data: {
              id: record.fact.id,
              memoryId: record.fact.memoryId,
              evidenceId: record.fact.evidenceId,
              kind: record.fact.kind,
              content: record.fact.content,
              createdAt: record.fact.createdAt,
            },
          });
          await tx.currentFact.create({
            data: {
              factId: record.currentFact.factId,
              memoryId: record.currentFact.memoryId,
              evidenceId: record.currentFact.evidenceId,
              content: record.currentFact.content,
              recordedAt: record.currentFact.recordedAt,
            },
          });
        });
      });
    });
  }

  async getById(id: string): Promise<StoredMemory | null> {
    return this.withAvailabilityMapping(() =>
      this.prisma.run(async (client) => {
        const memory = await client.memory.findUnique({ where: { id } });
        if (!memory) {
          return null;
        }

        const [evidence, fact] = await Promise.all([
          client.evidence.findFirst({ where: { memoryId: id }, orderBy: { createdAt: 'asc' } }),
          client.fact.findFirst({ where: { memoryId: id }, orderBy: { createdAt: 'asc' } }),
        ]);
        if (!evidence || !fact) {
          throw new MemoryInvariantError('missing original evidence or fact');
        }
        if (
          memory.occurredAt !== null ||
          memory.temporalPrecision !== 'unknown' ||
          evidence.kind !== 'text' ||
          fact.kind !== 'autobiographical_statement' ||
          fact.evidenceId !== evidence.id ||
          fact.content !== evidence.content
        ) {
          throw new MemoryInvariantError('inconsistent original memory record');
        }

        return {
          memory: {
            id: memory.id,
            recordedAt: memory.recordedAt,
            occurredAt: null,
            temporalPrecision: 'unknown',
          },
          evidence: {
            id: evidence.id,
            kind: 'text',
            content: evidence.content,
            createdAt: evidence.createdAt,
          },
          fact: {
            id: fact.id,
            kind: 'autobiographical_statement',
            content: fact.content,
            createdAt: fact.createdAt,
          },
        };
      }),
    );
  }

  async findLiteral(query: string): Promise<QueryHit | null> {
    return this.withAvailabilityMapping(() =>
      this.prisma.run(async (client) => {
        const rows = await client.$queryRaw<QueryHitRow[]>`
          SELECT
            memory_id AS "memoryId",
            evidence_id AS "evidenceId",
            fact_id AS "factId",
            content,
            recorded_at AS "recordedAt"
          FROM current_facts
          WHERE strpos(lower(content), lower(${query})) > 0
          ORDER BY recorded_at DESC, fact_id ASC
          LIMIT 1
        `;
        return rows[0] ?? null;
      }),
    );
  }

  async correct(input: CorrectMemoryStoreInput): Promise<CorrectMemoryStoreResult> {
    return this.withAvailabilityMapping(() =>
      this.prisma.run((client) =>
        client.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM memories
            WHERE id = ${input.memoryId}::uuid
            FOR UPDATE
          `;
          if (locked.length === 0) {
            return { status: 'NOT_FOUND' as const };
          }

          const currentRows = await tx.currentFact.findMany({
            where: { memoryId: input.memoryId },
          });
          if (currentRows.length !== 1) {
            throw new MemoryInvariantError('expected exactly one current textual fact');
          }
          const current = currentRows[0];
          if (!current) {
            throw new MemoryInvariantError('missing current textual fact');
          }
          if (current.factId !== input.expectedCurrentFactId) {
            return { status: 'STALE' as const, currentFactId: current.factId };
          }

          const record = createTextCorrectionRecord({
            memoryId: input.memoryId,
            previous: {
              factId: current.factId,
              evidenceId: current.evidenceId,
              content: current.content,
              recordedAt: current.recordedAt,
            },
            text: input.text,
            reason: input.reason,
            correctedAt: input.correctedAt,
            ids: input.ids,
          });

          await tx.evidence.create({ data: record.evidence });
          await tx.fact.create({ data: record.fact });
          await tx.ledgerEvent.create({ data: record.event });

          const changed = await tx.$executeRaw`
            UPDATE current_facts
            SET
              fact_id = ${record.currentFact.factId}::uuid,
              evidence_id = ${record.currentFact.evidenceId}::uuid,
              content = ${record.currentFact.content}
            WHERE fact_id = ${current.factId}::uuid
              AND memory_id = ${input.memoryId}::uuid
          `;
          if (changed !== 1) {
            throw new MemoryInvariantError('current projection update did not affect exactly one row');
          }

          return { status: 'CORRECTED' as const, record };
        }),
      ),
    );
  }

  async history(memoryId: string): Promise<StoredMemoryHistory | null> {
    return this.withAvailabilityMapping(() =>
      this.prisma.run(async (client) => {
        const memory = await client.memory.findUnique({ where: { id: memoryId } });
        if (!memory) {
          return null;
        }

        const [currentRows, facts, events] = await Promise.all([
          client.currentFact.findMany({ where: { memoryId } }),
          client.fact.findMany({
            where: { memoryId },
            include: { evidence: true },
          }),
          client.ledgerEvent.findMany({ where: { memoryId } }),
        ]);

        if (currentRows.length !== 1) {
          throw new MemoryInvariantError('expected exactly one current textual fact');
        }
        const current = currentRows[0];
        if (!current || facts.length === 0) {
          throw new MemoryInvariantError('missing current or historical fact');
        }
        if (
          current.memoryId !== memoryId ||
          current.recordedAt.getTime() !== memory.recordedAt.getTime()
        ) {
          throw new MemoryInvariantError('inconsistent current projection');
        }

        for (const fact of facts) {
          if (
            fact.memoryId !== memoryId ||
            fact.evidenceId !== fact.evidence.id ||
            fact.evidence.memoryId !== memoryId ||
            fact.kind !== 'autobiographical_statement' ||
            fact.evidence.kind !== 'text' ||
            fact.content !== fact.evidence.content
          ) {
            throw new MemoryInvariantError('inconsistent historical fact provenance');
          }
        }

        let ordered;
        try {
          ordered = orderTextFactHistory(
            facts.map((fact) => ({
              factId: fact.id,
              evidenceId: fact.evidenceId,
              content: fact.content,
              createdAt: fact.createdAt,
              supersedesFactId: fact.supersedesFactId,
            })),
            current.factId,
          );
        } catch (error) {
          if (error instanceof CorrectionDomainError && error.code === 'BROKEN_HISTORY') {
            throw new MemoryInvariantError('broken fact history');
          }
          throw error;
        }

        const versions = ordered.map((node) => {
          if (node.isOriginal) {
            const creationEvents = events.filter(
              (event) => event.type === 'MEMORY_CREATED' && event.evidenceId === node.evidenceId,
            );
            if (creationEvents.length !== 1) {
              throw new MemoryInvariantError('missing or duplicate original creation event');
            }
            const event = creationEvents[0];
            if (!event) {
              throw new MemoryInvariantError('missing original creation event');
            }
            return {
              ...node,
              eventId: event.id,
              reason: null,
            };
          }

          const correctionEvents = events.filter(
            (event) => event.type === 'MEMORY_CORRECTED' && event.factId === node.factId,
          );
          if (correctionEvents.length !== 1) {
            throw new MemoryInvariantError('missing or duplicate correction event');
          }
          const event = correctionEvents[0];
          if (
            !event ||
            event.evidenceId !== node.evidenceId ||
            event.supersedesFactId !== node.supersedesFactId
          ) {
            throw new MemoryInvariantError('inconsistent correction event provenance');
          }
          return {
            ...node,
            eventId: event.id,
            reason: event.reason,
          };
        });

        return { memoryId, versions };
      }),
    );
  }

  private async withAvailabilityMapping<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isPersistenceUnavailable(error)) {
        throw new MemoryStoreUnavailableError(error);
      }
      throw error;
    }
  }
}
