import { createHash } from 'node:crypto';
import {
  syncEventEnvelopeSchema,
  type SyncCanonicalRecord,
  type SyncEventEnvelope,
} from '@mdp/contracts';
import { deriveMemoryProjection, type DerivedMemoryProjection } from '@mdp/domain';
import type { Prisma } from './generated/client.js';

const kindRank: Record<SyncCanonicalRecord['kind'], number> = {
  memory: 0,
  evidence: 1,
  ledgerEvent: 2,
  fact: 3,
  factRelation: 4,
};

function stableRecordKey(record: SyncCanonicalRecord): string {
  switch (record.kind) {
    case 'memory':
    case 'evidence':
    case 'ledgerEvent':
    case 'fact':
      return record.id;
    case 'factRelation':
      return `${record.predecessorFactId}:${record.successorFactId}`;
  }
}

function compareCanonicalRecords(left: SyncCanonicalRecord, right: SyncCanonicalRecord): number {
  const rank = kindRank[left.kind] - kindRank[right.kind];
  return rank !== 0 ? rank : stableRecordKey(left).localeCompare(stableRecordKey(right));
}

export function normalizeEnvelope(envelope: SyncEventEnvelope): SyncEventEnvelope {
  const parsed = syncEventEnvelopeSchema.parse(envelope);
  return {
    ...parsed,
    predecessorFactIds: [...new Set(parsed.predecessorFactIds)].sort(),
    records: [...parsed.records].sort(compareCanonicalRecords),
  };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function payloadHash(envelope: SyncEventEnvelope): string {
  return createHash('sha256')
    .update(stableJson(normalizeEnvelope(envelope)))
    .digest('hex');
}

async function allocateFeedSequence(tx: Prisma.TransactionClient): Promise<bigint> {
  const rows = await tx.$queryRaw<Array<{ current_sequence: bigint }>>`
    UPDATE "sync_feed_state"
    SET "current_sequence" = "current_sequence" + 1
    WHERE "id" = 1
    RETURNING "current_sequence"
  `;
  const row = rows[0];
  if (!row) {
    throw new Error('SYNC_FEED_STATE_MISSING');
  }
  return row.current_sequence;
}

function dateEqual(left: Date, right: string): boolean {
  return left.toISOString() === new Date(right).toISOString();
}

function integrityViolation(): never {
  throw new Error('SYNC_INTEGRITY_VIOLATION');
}

export interface PrismaCanonicalMemoryWriterOptions {
  now?: () => Date;
}

export class PrismaCanonicalMemoryWriter {
  private readonly now: () => Date;

  constructor(options: PrismaCanonicalMemoryWriterOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async writeEnvelope(
    tx: Prisma.TransactionClient,
    envelope: SyncEventEnvelope,
    originClientInstanceId: string | null,
  ): Promise<DerivedMemoryProjection> {
    const normalized = normalizeEnvelope(envelope);
    await this.addOrVerifyImmutableRecords(tx, normalized);

    const graph = await this.loadGraph(tx, normalized.memoryId);
    const projection = deriveMemoryProjection(graph.nodes, graph.relations);
    await this.persistProjection(tx, normalized.memoryId, projection);

    const sequence = await allocateFeedSequence(tx);
    await tx.syncOutbox.create({
      data: {
        sequence,
        eventId: normalized.eventId,
        protocolVersion: normalized.protocolVersion,
        eventType: normalized.eventType,
        memoryId: normalized.memoryId,
        originClientInstanceId,
        payload: normalized as unknown as Prisma.InputJsonValue,
        payloadHash: payloadHash(normalized),
        createdAt: this.now(),
      },
    });

    return projection;
  }

  private async addOrVerifyImmutableRecords(
    tx: Prisma.TransactionClient,
    envelope: SyncEventEnvelope,
  ): Promise<void> {
    const records = envelope.records;

    for (const record of records.filter((item) => item.kind === 'memory')) {
      await this.addOrVerifyMemory(tx, record);
    }
    for (const record of records.filter((item) => item.kind === 'evidence')) {
      await this.addOrVerifyEvidence(tx, record);
    }
    for (const record of records.filter((item) => item.kind === 'fact')) {
      await this.addOrVerifyFact(tx, record, envelope);
    }
    for (const record of records.filter((item) => item.kind === 'ledgerEvent')) {
      await this.addOrVerifyLedgerEvent(tx, record);
    }
    for (const record of records.filter((item) => item.kind === 'factRelation')) {
      await this.addOrVerifyFactRelation(tx, record);
    }
  }

  private async addOrVerifyMemory(
    tx: Prisma.TransactionClient,
    record: Extract<SyncCanonicalRecord, { kind: 'memory' }>,
  ): Promise<void> {
    const existing = await tx.memory.findUnique({ where: { id: record.id } });
    if (!existing) {
      await tx.memory.create({
        data: {
          id: record.id,
          recordedAt: new Date(record.recordedAt),
          occurredAt: null,
          temporalPrecision: record.temporalPrecision,
        },
      });
      return;
    }
    if (
      !dateEqual(existing.recordedAt, record.recordedAt) ||
      existing.occurredAt !== null ||
      existing.temporalPrecision !== record.temporalPrecision
    ) {
      integrityViolation();
    }
  }

  private async addOrVerifyEvidence(
    tx: Prisma.TransactionClient,
    record: Extract<SyncCanonicalRecord, { kind: 'evidence' }>,
  ): Promise<void> {
    const existing = await tx.evidence.findUnique({ where: { id: record.id } });
    if (!existing) {
      await tx.evidence.create({
        data: {
          id: record.id,
          memoryId: record.memoryId,
          kind: record.evidenceKind,
          content: record.content,
          createdAt: new Date(record.createdAt),
        },
      });
      return;
    }
    if (
      existing.memoryId !== record.memoryId ||
      existing.kind !== record.evidenceKind ||
      existing.content !== record.content ||
      !dateEqual(existing.createdAt, record.createdAt)
    ) {
      integrityViolation();
    }
  }

  private legacySupersedesFactId(
    record: Extract<SyncCanonicalRecord, { kind: 'fact' }>,
    envelope: SyncEventEnvelope,
  ): string | null {
    if (envelope.eventType !== 'MEMORY_CORRECTED' || envelope.predecessorFactIds.length !== 1) {
      return null;
    }
    const event = envelope.records.find(
      (item): item is Extract<SyncCanonicalRecord, { kind: 'ledgerEvent' }> =>
        item.kind === 'ledgerEvent' && item.id === envelope.eventId,
    );
    return event?.factId === record.id ? (envelope.predecessorFactIds[0] ?? null) : null;
  }

  private async addOrVerifyFact(
    tx: Prisma.TransactionClient,
    record: Extract<SyncCanonicalRecord, { kind: 'fact' }>,
    envelope: SyncEventEnvelope,
  ): Promise<void> {
    const supersedesFactId = this.legacySupersedesFactId(record, envelope);
    const existing = await tx.fact.findUnique({ where: { id: record.id } });
    if (!existing) {
      await tx.fact.create({
        data: {
          id: record.id,
          memoryId: record.memoryId,
          evidenceId: record.evidenceId,
          kind: record.factKind,
          content: record.content,
          supersedesFactId,
          createdAt: new Date(record.createdAt),
        },
      });
      return;
    }
    if (
      existing.memoryId !== record.memoryId ||
      existing.evidenceId !== record.evidenceId ||
      existing.kind !== record.factKind ||
      existing.content !== record.content ||
      existing.supersedesFactId !== supersedesFactId ||
      !dateEqual(existing.createdAt, record.createdAt)
    ) {
      integrityViolation();
    }
  }

  private async addOrVerifyLedgerEvent(
    tx: Prisma.TransactionClient,
    record: Extract<SyncCanonicalRecord, { kind: 'ledgerEvent' }>,
  ): Promise<void> {
    const existing = await tx.ledgerEvent.findUnique({ where: { id: record.id } });
    if (!existing) {
      await tx.ledgerEvent.create({
        data: {
          id: record.id,
          memoryId: record.memoryId,
          evidenceId: record.evidenceId,
          factId: record.factId,
          supersedesFactId: record.supersedesFactId,
          type: record.eventType,
          reason: record.reason,
          createdAt: new Date(record.createdAt),
        },
      });
      return;
    }
    if (
      existing.memoryId !== record.memoryId ||
      existing.evidenceId !== record.evidenceId ||
      existing.factId !== record.factId ||
      existing.supersedesFactId !== record.supersedesFactId ||
      existing.type !== record.eventType ||
      existing.reason !== record.reason ||
      !dateEqual(existing.createdAt, record.createdAt)
    ) {
      integrityViolation();
    }
  }

  private async addOrVerifyFactRelation(
    tx: Prisma.TransactionClient,
    record: Extract<SyncCanonicalRecord, { kind: 'factRelation' }>,
  ): Promise<void> {
    const key = {
      predecessorFactId: record.predecessorFactId,
      successorFactId: record.successorFactId,
    };
    const existing = await tx.factRelation.findUnique({
      where: { predecessorFactId_successorFactId: key },
    });
    if (!existing) {
      await tx.factRelation.create({
        data: {
          memoryId: record.memoryId,
          predecessorFactId: record.predecessorFactId,
          successorFactId: record.successorFactId,
          relationType: record.relationType,
        },
      });
      return;
    }
    if (existing.memoryId !== record.memoryId || existing.relationType !== record.relationType) {
      integrityViolation();
    }
  }

  private async loadGraph(tx: Prisma.TransactionClient, memoryId: string) {
    const [facts, relations] = await Promise.all([
      tx.fact.findMany({ where: { memoryId } }),
      tx.factRelation.findMany({ where: { memoryId } }),
    ]);
    return {
      nodes: facts.map((fact) => ({ factId: fact.id, createdAt: fact.createdAt })),
      relations: relations.map((relation) => ({
        memoryId: relation.memoryId,
        predecessorFactId: relation.predecessorFactId,
        successorFactId: relation.successorFactId,
        relationType: 'SUPERSEDES' as const,
      })),
    };
  }

  private async persistProjection(
    tx: Prisma.TransactionClient,
    memoryId: string,
    projection: DerivedMemoryProjection,
  ): Promise<void> {
    if (projection.status === 'CONFLICT') {
      await tx.currentFact.deleteMany({ where: { memoryId } });
      await tx.syncConflict.upsert({
        where: { memoryId },
        create: {
          memoryId,
          baselineFactId: projection.baselineFactId,
          candidateFactIds: projection.candidateFactIds,
          status: 'OPEN',
          resolutionFactId: null,
          updatedAt: this.now(),
        },
        update: {
          baselineFactId: projection.baselineFactId,
          candidateFactIds: projection.candidateFactIds,
          status: 'OPEN',
          resolutionFactId: null,
          updatedAt: this.now(),
        },
      });
      return;
    }

    const current = await tx.fact.findUniqueOrThrow({
      where: { id: projection.currentFactId },
      include: { memory: true },
    });
    await tx.currentFact.deleteMany({ where: { memoryId } });
    await tx.currentFact.create({
      data: {
        factId: current.id,
        memoryId,
        evidenceId: current.evidenceId,
        content: current.content,
        recordedAt: current.memory.recordedAt,
      },
    });

    const priorConflict = await tx.syncConflict.findUnique({ where: { memoryId } });
    if (priorConflict?.status === 'OPEN') {
      await tx.syncConflict.update({
        where: { memoryId },
        data: {
          status: 'RESOLVED',
          resolutionFactId: projection.currentFactId,
          updatedAt: this.now(),
        },
      });
    }
  }
}
