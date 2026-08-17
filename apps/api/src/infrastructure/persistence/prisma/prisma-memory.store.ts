import type { TextMemoryRecord } from '@mdp/domain';
import {
  MemoryStoreUnavailableError,
  type MemoryStore,
  type QueryHit,
  type StoredMemory,
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
          throw new Error('Slice 01 persistence invariant violated: missing evidence or fact');
        }
        if (
          memory.occurredAt !== null ||
          memory.temporalPrecision !== 'unknown' ||
          evidence.kind !== 'text' ||
          fact.kind !== 'autobiographical_statement' ||
          fact.evidenceId !== evidence.id ||
          fact.content !== evidence.content
        ) {
          throw new Error('Slice 01 persistence invariant violated: inconsistent memory record');
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
