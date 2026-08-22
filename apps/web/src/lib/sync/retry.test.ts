import { describe, expect, it } from 'vitest';
import { MAX_FOREGROUND_RETRIES, classifySyncFailure, computeRetryDelay } from './retry.js';

describe('synchronization retry policy', () => {
  it('uses bounded exponential backoff with deterministic jitter', () => {
    expect(computeRetryDelay(0, () => 0.5)).toBe(500);
    expect(computeRetryDelay(1, () => 0.5)).toBe(1000);
    expect(computeRetryDelay(10, () => 0.5)).toBe(10_000);
    expect(computeRetryDelay(0, () => 0)).toBe(400);
    expect(computeRetryDelay(0, () => 1)).toBe(600);
    expect(MAX_FOREGROUND_RETRIES).toBe(5);
  });

  it('retries transient service/network failures only', () => {
    expect(classifySyncFailure({ status: 503 })).toBe('TRANSIENT');
    expect(classifySyncFailure({ status: 429 })).toBe('TRANSIENT');
    expect(classifySyncFailure({ code: 'SYNC_SERVICE_UNAVAILABLE' })).toBe('TRANSIENT');
    expect(classifySyncFailure(new TypeError('network failed'))).toBe('TRANSIENT');
  });

  it('does not loop on protocol, integrity, cursor or bootstrap states', () => {
    expect(classifySyncFailure({ code: 'SYNC_INTEGRITY_VIOLATION' })).toBe('PERMANENT');
    expect(classifySyncFailure({ code: 'SYNC_PROTOCOL_UNSUPPORTED' })).toBe('PERMANENT');
    expect(classifySyncFailure({ code: 'SYNC_CURSOR_EXPIRED' })).toBe('PERMANENT');
    expect(classifySyncFailure({ code: 'SYNC_BOOTSTRAP_EXPIRED' })).toBe('PERMANENT');
    expect(classifySyncFailure({ status: 400 })).toBe('PERMANENT');
  });
});
