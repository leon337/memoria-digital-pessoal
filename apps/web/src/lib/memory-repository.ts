import type {
  CorrectMemoryRequest,
  CorrectMemoryResponse,
  CreateMemoryResponse,
  MemoryHistoryResponse,
  MemoryQueryResponse,
} from '@mdp/contracts';

export type MemoryRepositoryErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'STALE_CORRECTION'
  | 'NO_CHANGE'
  | 'LOCAL_STORAGE_UNAVAILABLE'
  | 'LOCAL_DATA_INTEGRITY_ERROR';

export class MemoryRepositoryError extends Error {
  constructor(
    readonly code: MemoryRepositoryErrorCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = 'MemoryRepositoryError';
  }
}

export interface MemoryRepository {
  ready(): Promise<void>;
  create(text: string): Promise<CreateMemoryResponse>;
  query(query: string): Promise<MemoryQueryResponse>;
  correct(memoryId: string, request: CorrectMemoryRequest): Promise<CorrectMemoryResponse>;
  history(memoryId: string): Promise<MemoryHistoryResponse>;
}
