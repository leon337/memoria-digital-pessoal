import { describe, expect, it } from 'vitest';
import { MemoryRepositoryError } from './memory-repository.js';

describe('MemoryRepositoryError', () => {
  it.each([
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'STALE_CORRECTION',
    'NO_CHANGE',
    'CONFLICT_REQUIRES_RESOLUTION',
    'LOCAL_STORAGE_UNAVAILABLE',
    'LOCAL_DATA_INTEGRITY_ERROR',
  ] as const)('keeps stable safe code %s', (code) => {
    const error = new MemoryRepositoryError(code, new Error('private storage detail'));
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
    expect(error.message).not.toContain('private storage detail');
  });
});
