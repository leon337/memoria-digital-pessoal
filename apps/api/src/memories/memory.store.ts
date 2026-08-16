import type { TextMemoryRecord } from '@mdp/domain';

export const MEMORY_STORE = Symbol('MEMORY_STORE');

export class MemoryStoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Memory persistence is unavailable', { cause });
    this.name = 'MemoryStoreUnavailableError';
  }
}

export interface StoredMemory {
  memory: {
    id: string;
    recordedAt: Date;
    occurredAt: null;
    temporalPrecision: 'unknown';
  };
  evidence: {
    id: string;
    kind: 'text';
    content: string;
    createdAt: Date;
  };
  fact: {
    id: string;
    kind: 'autobiographical_statement';
    content: string;
    createdAt: Date;
  };
}

export interface QueryHit {
  memoryId: string;
  evidenceId: string;
  factId: string;
  content: string;
  recordedAt: Date;
}

export interface MemoryStore {
  create(record: TextMemoryRecord): Promise<void>;
  getById(id: string): Promise<StoredMemory | null>;
  findLiteral(query: string): Promise<QueryHit | null>;
}
