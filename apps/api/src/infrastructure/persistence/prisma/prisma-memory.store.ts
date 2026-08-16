import type { TextMemoryRecord } from '@mdp/domain';
import type { MemoryStore } from '../../../memories/memory.store.js';
import { PrismaService } from './prisma.service.js';

export class PrismaMemoryStore implements Pick<MemoryStore, 'create'> {
  constructor(private readonly prisma: PrismaService) {}

  async create(record: TextMemoryRecord): Promise<void> {
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
  }
}
