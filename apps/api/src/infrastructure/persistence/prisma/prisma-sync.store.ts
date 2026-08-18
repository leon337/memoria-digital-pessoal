import {
  syncCanonicalRecordArraySchema,
  syncEventEnvelopeSchema,
  type SyncBootstrapPageResponse,
  type SyncBootstrapStartResponse,
  type SyncCanonicalRecord,
  type SyncEventEnvelope,
  type SyncPullResponse,
  type SyncPushEventResult,
} from '@mdp/contracts';
import { createId } from '@mdp/shared';
import type { ApiEnv } from '../../../config/env.js';
import { SyncStoreError, type SyncStore } from '../../../sync/sync.store.js';
import {
  PrismaCanonicalMemoryWriter,
  normalizeEnvelope,
  payloadHash,
} from './prisma-canonical-memory.writer.js';
import type { Prisma, PrismaClient } from './generated/client.js';
import { PrismaService } from './prisma.service.js';

const DEFAULT_SYNC_MAX_BATCH_SIZE = 50;
const DEFAULT_SYNC_OUTBOX_MAX_ENTRIES = 10000;
const DEFAULT_SYNC_BOOTSTRAP_TTL_SECONDS = 900;

const canonicalKindRank: Record<SyncCanonicalRecord['kind'], number> = {
  memory: 0,
  evidence: 1,
  ledgerEvent: 2,
  fact: 3,
  factRelation: 4,
};

function canonicalRecordKey(record: SyncCanonicalRecord): string {
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
  const rank = canonicalKindRank[left.kind] - canonicalKindRank[right.kind];
  return rank !== 0 ? rank : canonicalRecordKey(left).localeCompare(canonicalRecordKey(right));
}

function parseCursor(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
  }
  return BigInt(value);
}

export interface PrismaSyncStoreOptions {
  prisma: PrismaService;
  env?: ApiEnv;
  writer?: PrismaCanonicalMemoryWriter;
}

export class PrismaSyncStore implements SyncStore {
  private readonly prisma: PrismaService;
  private readonly writer: PrismaCanonicalMemoryWriter;
  private readonly maxBatchSize: number;
  private readonly bootstrapTtlSeconds: number;

  constructor(options: PrismaSyncStoreOptions) {
    this.prisma = options.prisma;
    this.maxBatchSize = options.env?.syncMaxBatchSize ?? DEFAULT_SYNC_MAX_BATCH_SIZE;
    this.bootstrapTtlSeconds =
      options.env?.syncBootstrapTtlSeconds ?? DEFAULT_SYNC_BOOTSTRAP_TTL_SECONDS;
    this.writer =
      options.writer ??
      new PrismaCanonicalMemoryWriter({
        maxOutboxEntries: options.env?.syncOutboxMaxEntries ?? DEFAULT_SYNC_OUTBOX_MAX_ENTRIES,
      });
  }

  async pushEvent(
    clientInstanceId: string,
    envelope: SyncEventEnvelope,
  ): Promise<SyncPushEventResult> {
    const normalized = normalizeEnvelope(envelope);
    const hash = payloadHash(normalized);

    return this.prisma.run(async (client) => {
      const existing = await client.syncOutbox.findUnique({
        where: { eventId: normalized.eventId },
      });
      if (existing) {
        return existing.payloadHash === hash
          ? { eventId: normalized.eventId, status: 'ALREADY_APPLIED' as const }
          : {
              eventId: normalized.eventId,
              status: 'INVALID' as const,
              code: 'SYNC_INTEGRITY_VIOLATION' as const,
            };
      }

      const missingFactIds = await this.findMissingPredecessors(client, normalized);
      if (missingFactIds.length > 0) {
        return {
          eventId: normalized.eventId,
          status: 'DEPENDENCY_MISSING' as const,
          missingFactIds,
        };
      }

      const projection = await client.$transaction((tx) =>
        this.writer.writeEnvelope(tx, normalized, clientInstanceId),
      );
      if (projection.status === 'CONFLICT') {
        return { eventId: normalized.eventId, status: 'CONFLICT' as const };
      }
      return { eventId: normalized.eventId, status: 'APPLIED' as const };
    });
  }

  async pull(after: string, limit: number): Promise<SyncPullResponse> {
    const cursor = parseCursor(after);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
    }
    const batchSize = Math.min(limit, this.maxBatchSize);

    return this.prisma.run((client) =>
      client.$transaction(
        async (tx) => {
          const feedState = await tx.syncFeedState.findUnique({ where: { id: 1 } });
          if (!feedState) {
            throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
          }
          if (cursor > feedState.currentSequence) {
            throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
          }

          const oldest = await tx.syncOutbox.findFirst({
            orderBy: { sequence: 'asc' },
            select: { sequence: true },
          });
          if (oldest && cursor < oldest.sequence - 1n) {
            throw new SyncStoreError('SYNC_CURSOR_EXPIRED');
          }

          const rows = await tx.syncOutbox.findMany({
            where: { sequence: { gt: cursor } },
            orderBy: { sequence: 'asc' },
            take: batchSize + 1,
          });
          const hasMore = rows.length > batchSize;
          const page = hasMore ? rows.slice(0, batchSize) : rows;
          const events = page.map((entry) => {
            const parsed = syncEventEnvelopeSchema.safeParse(entry.payload);
            if (!parsed.success) {
              throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
            }
            return {
              sequence: entry.sequence.toString(),
              envelope: parsed.data,
            };
          });

          return {
            protocolVersion: 1 as const,
            events,
            nextCursor: page.at(-1)?.sequence.toString() ?? after,
            hasMore,
          };
        },
        { isolationLevel: 'RepeatableRead' },
      ),
    );
  }

  async startBootstrap(clientInstanceId: string): Promise<SyncBootstrapStartResponse> {
    void clientInstanceId;
    return this.prisma.run((client) =>
      client.$transaction(
        async (tx) => {
          const now = new Date();
          await tx.syncBootstrapSnapshot.deleteMany({ where: { expiresAt: { lte: now } } });

          const [feedState, memories, evidence, events, facts, relations] = await Promise.all([
            tx.syncFeedState.findUnique({ where: { id: 1 } }),
            tx.memory.findMany(),
            tx.evidence.findMany(),
            tx.ledgerEvent.findMany(),
            tx.fact.findMany(),
            tx.factRelation.findMany(),
          ]);
          if (!feedState) {
            throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
          }

          const parsed = syncCanonicalRecordArraySchema.safeParse([
            ...memories.map((memory) => ({
              kind: 'memory',
              id: memory.id,
              recordedAt: memory.recordedAt.toISOString(),
              occurredAt: memory.occurredAt?.toISOString() ?? null,
              temporalPrecision: memory.temporalPrecision,
            })),
            ...evidence.map((item) => ({
              kind: 'evidence',
              id: item.id,
              memoryId: item.memoryId,
              evidenceKind: item.kind,
              content: item.content,
              createdAt: item.createdAt.toISOString(),
            })),
            ...events.map((event) => ({
              kind: 'ledgerEvent',
              id: event.id,
              memoryId: event.memoryId,
              evidenceId: event.evidenceId,
              factId: event.factId,
              supersedesFactId: event.supersedesFactId,
              eventType: event.type,
              reason: event.reason,
              createdAt: event.createdAt.toISOString(),
            })),
            ...facts.map((fact) => ({
              kind: 'fact',
              id: fact.id,
              memoryId: fact.memoryId,
              evidenceId: fact.evidenceId,
              factKind: fact.kind,
              content: fact.content,
              createdAt: fact.createdAt.toISOString(),
            })),
            ...relations.map((relation) => ({
              kind: 'factRelation',
              memoryId: relation.memoryId,
              predecessorFactId: relation.predecessorFactId,
              successorFactId: relation.successorFactId,
              relationType: relation.relationType,
            })),
          ]);
          if (!parsed.success) {
            throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
          }

          const records = [...parsed.data].sort(compareCanonicalRecords);
          const bootstrapToken = createId();
          const expiresAt = new Date(now.getTime() + this.bootstrapTtlSeconds * 1000);
          await tx.syncBootstrapSnapshot.create({
            data: {
              token: bootstrapToken,
              highWatermark: feedState.currentSequence,
              records: records as unknown as Prisma.InputJsonValue,
              expiresAt,
              createdAt: now,
            },
          });

          return {
            protocolVersion: 1 as const,
            bootstrapToken,
            highWatermarkCursor: feedState.currentSequence.toString(),
            totalRecords: records.length,
          };
        },
        { isolationLevel: 'RepeatableRead' },
      ),
    );
  }

  async readBootstrapPage(
    bootstrapToken: string,
    offset: number,
    limit: number,
  ): Promise<SyncBootstrapPageResponse> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
      throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
    }
    const pageSize = Math.min(limit, this.maxBatchSize);

    return this.prisma.run((client) =>
      client.$transaction(async (tx) => {
        const now = new Date();
        await tx.syncBootstrapSnapshot.deleteMany({ where: { expiresAt: { lte: now } } });
        const snapshot = await tx.syncBootstrapSnapshot.findUnique({
          where: { token: bootstrapToken },
        });
        if (!snapshot || snapshot.expiresAt <= now) {
          throw new SyncStoreError('SYNC_BOOTSTRAP_EXPIRED');
        }

        const parsed = syncCanonicalRecordArraySchema.safeParse(snapshot.records);
        if (!parsed.success) {
          throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
        }
        const records = parsed.data.slice(offset, offset + pageSize);
        const consumed = offset + records.length;

        return {
          protocolVersion: 1 as const,
          bootstrapToken,
          records,
          nextOffset: consumed < parsed.data.length ? consumed : null,
        };
      }),
    );
  }

  private async findMissingPredecessors(
    client: PrismaClient,
    envelope: SyncEventEnvelope,
  ): Promise<string[]> {
    const includedFactIds = new Set(
      envelope.records.filter((record) => record.kind === 'fact').map((record) => record.id),
    );
    const candidates = envelope.predecessorFactIds.filter((id) => !includedFactIds.has(id));
    if (candidates.length === 0) {
      return [];
    }

    const existing = await client.fact.findMany({
      where: { id: { in: candidates } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((fact) => fact.id));
    return candidates.filter((id) => !existingIds.has(id)).sort();
  }
}
