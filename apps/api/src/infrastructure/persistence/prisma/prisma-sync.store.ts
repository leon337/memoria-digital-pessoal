import {
  syncEventEnvelopeSchema,
  type SyncEventEnvelope,
  type SyncPullResponse,
  type SyncPushEventResult,
} from '@mdp/contracts';
import type { ApiEnv } from '../../../config/env.js';
import { SyncStoreError, type SyncStore } from '../../../sync/sync.store.js';
import {
  PrismaCanonicalMemoryWriter,
  normalizeEnvelope,
  payloadHash,
} from './prisma-canonical-memory.writer.js';
import type { PrismaClient } from './generated/client.js';
import { PrismaService } from './prisma.service.js';

const DEFAULT_SYNC_MAX_BATCH_SIZE = 50;
const DEFAULT_SYNC_OUTBOX_MAX_ENTRIES = 10000;

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

  constructor(options: PrismaSyncStoreOptions) {
    this.prisma = options.prisma;
    this.maxBatchSize = options.env?.syncMaxBatchSize ?? DEFAULT_SYNC_MAX_BATCH_SIZE;
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
