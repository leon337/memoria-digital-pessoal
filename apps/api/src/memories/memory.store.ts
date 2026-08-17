import type { TextCorrectionRecord, TextMemoryRecord } from '@mdp/domain';

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

export interface CorrectMemoryStoreInput {
  memoryId: string;
  expectedCurrentFactId: string;
  text: string;
  reason?: string;
  correctedAt: Date;
  ids: {
    evidenceId: string;
    eventId: string;
    factId: string;
  };
}

export type CorrectMemoryStoreResult =
  | { status: 'CORRECTED'; record: TextCorrectionRecord }
  | { status: 'NOT_FOUND' }
  | { status: 'STALE'; currentFactId: string };

export interface StoredHistoryVersion {
  factId: string;
  evidenceId: string;
  content: string;
  createdAt: Date;
  reason: string | null;
  supersedesFactId: string | null;
  eventId: string;
  isOriginal: boolean;
  isCurrent: boolean;
}

export interface StoredMemoryHistory {
  memoryId: string;
  versions: StoredHistoryVersion[];
}

export interface MemoryStore {
  create(record: TextMemoryRecord): Promise<void>;
  getById(id: string): Promise<StoredMemory | null>;
  findLiteral(query: string): Promise<QueryHit | null>;
  correct(input: CorrectMemoryStoreInput): Promise<CorrectMemoryStoreResult>;
  history(memoryId: string): Promise<StoredMemoryHistory | null>;
}
