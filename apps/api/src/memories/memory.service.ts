import type {
  CreateMemoryResponse,
  GetMemoryResponse,
  MemoryQueryResponse,
} from '@mdp/contracts';
import { createTextMemoryRecord } from '@mdp/domain';
import type { MemoryStore } from './memory.store.js';

export interface MemoryServiceOptions {
  store: MemoryStore;
  now: () => Date;
  createId: () => string;
}

export class MemoryService {
  private readonly store: MemoryStore;
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

  async get(id: string): Promise<GetMemoryResponse | null> {
    const stored = await this.store.getById(id);
    if (!stored) {
      return null;
    }

    return {
      memory: {
        id: stored.memory.id,
        recordedAt: stored.memory.recordedAt.toISOString(),
        occurredAt: null,
        temporalPrecision: 'unknown',
      },
      evidence: {
        id: stored.evidence.id,
        kind: 'text',
        content: stored.evidence.content,
        createdAt: stored.evidence.createdAt.toISOString(),
      },
      fact: {
        id: stored.fact.id,
        kind: 'autobiographical_statement',
        content: stored.fact.content,
        createdAt: stored.fact.createdAt.toISOString(),
      },
    };
  }

  async query(query: string): Promise<MemoryQueryResponse> {
    const hit = await this.store.findLiteral(query.trim());
    if (!hit) {
      return { status: 'UNKNOWN', answer: null, provenance: null };
    }

    return {
      status: 'FOUND',
      answer: hit.content,
      provenance: {
        memoryId: hit.memoryId,
        evidenceId: hit.evidenceId,
        factId: hit.factId,
      },
    };
  }
}
