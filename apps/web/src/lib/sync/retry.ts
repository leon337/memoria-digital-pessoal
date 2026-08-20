export const MAX_FOREGROUND_RETRIES = 5;

export type SyncFailureClassification = 'TRANSIENT' | 'PERMANENT';

interface SyncFailureLike {
  status?: unknown;
  code?: unknown;
}

export function computeRetryDelay(attempt: number, random: () => number = Math.random): number {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  const raw = Math.min(500 * 2 ** normalizedAttempt, 10_000);
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.round(raw * jitter);
}

export function classifySyncFailure(error: unknown): SyncFailureClassification {
  if (error instanceof TypeError) return 'TRANSIENT';
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return 'TRANSIENT';
  }

  if (error && typeof error === 'object') {
    const failure = error as SyncFailureLike;
    if (failure.code === 'SYNC_SERVICE_UNAVAILABLE') return 'TRANSIENT';
    if (typeof failure.code === 'string' && failure.code.startsWith('SYNC_')) return 'PERMANENT';

    if (typeof failure.status === 'number') {
      if (
        failure.status === 408 ||
        failure.status === 425 ||
        failure.status === 429 ||
        failure.status >= 500
      ) {
        return 'TRANSIENT';
      }
      return 'PERMANENT';
    }
  }

  return 'PERMANENT';
}
