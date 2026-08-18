import type { SyncEventEnvelope, SyncPushEventResult } from '@mdp/contracts';
import type { SyncStore } from '../../../sync/sync.store.js';
import {
  PrismaCanonicalMemoryWriter,
  normalizeEnvelope,
  payloadHash,
} from './prisma-canonical-memory.writer.js';
import type { PrismaClient } from './generated/client.js';
import { PrismaService } from './prisma.service.js';

export interface PrismaSyncStoreOptions {
  prisma: PrismaService;
  writer?: PrismaCanonicalMemoryWriter;
}

export class PrismaSyncStore implements SyncStore {
  private readonly prisma: PrismaService;
  private readonly writer: PrismaCanonicalMemoryWriter;

  constructor(options: PrismaSyncStoreOptions) {
    this.prisma = options.prisma;
    this.writer = options.writer ?? new PrismaCanonicalMemoryWriter();
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
