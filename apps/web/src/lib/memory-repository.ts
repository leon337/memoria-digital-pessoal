import type {
  CorrectMemoryRequest,
  CorrectMemoryResponse,
  CreateMemoryResponse,
  MemoryHistoryResponse,
  MemoryQueryResponse,
  ResolveConflictRequest,
} from '@mdp/contracts';

export type MemoryRepositoryErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'STALE_CORRECTION'
  | 'NO_CHANGE'
  | 'CONFLICT_REQUIRES_RESOLUTION'
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
  resolveConflict(
    memoryId: string,
    request: ResolveConflictRequest,
  ): Promise<CorrectMemoryResponse>;
  history(memoryId: string): Promise<MemoryHistoryResponse>;
}
