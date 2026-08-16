import type { CreateMemoryResponse } from '@mdp/contracts';
import { createTextMemoryRecord } from '@mdp/domain';
import type { MemoryWriter } from './memory.store.js';

export interface MemoryServiceOptions {
  store: MemoryWriter;
  now: () => Date;
  createId: () => string;
}

export class MemoryService {
  private readonly store: MemoryWriter;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: MemoryServiceOptions) {
    this.store = options.store;
    this.now = options.now;
    this.createId = options.createId;
  }

  async register(text: string): Promise<CreateMemoryResponse> {
    const recordedAt = this.now();
    const record = createTextMemoryRecord({
      text,
      recordedAt,
      ids: {
        memoryId: this.createId(),
        evidenceId: this.createId(),
        eventId: this.createId(),
        factId: this.createId(),
      },
    });

    await this.store.create(record);

    return {
      memory: {
        id: record.memory.id,
        recordedAt: record.memory.recordedAt.toISOString(),
      },
      fact: {
        id: record.fact.id,
        content: record.fact.content,
      },
      provenance: {
        evidenceId: record.evidence.id,
      },
    };
  }
}
