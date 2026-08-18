import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env.js';

const valid = {
  PORT: '3000',
  DATABASE_URL: 'postgresql://mdp:mdp@127.0.0.1:5432/mdp',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
};

describe('parseApiEnv', () => {
  it('returns typed configuration with exact synchronization defaults', () => {
    expect(parseApiEnv(valid)).toEqual({
      port: 3000,
      databaseUrl: valid.DATABASE_URL,
      webOrigin: valid.WEB_ORIGIN,
      syncMaxBatchSize: 50,
      syncOutboxMaxEntries: 10000,
      syncBootstrapTtlSeconds: 900,
    });
  });

  it('parses explicit synchronization limits', () => {
    expect(
      parseApiEnv({
        ...valid,
        SYNC_MAX_BATCH_SIZE: '125',
        SYNC_OUTBOX_MAX_ENTRIES: '2500',
        SYNC_BOOTSTRAP_TTL_SECONDS: '1800',
      }),
    ).toMatchObject({
      syncMaxBatchSize: 125,
      syncOutboxMaxEntries: 2500,
      syncBootstrapTtlSeconds: 1800,
    });
  });

  it('rejects invalid synchronization limits', () => {
    expect(() => parseApiEnv({ ...valid, SYNC_MAX_BATCH_SIZE: '0' })).toThrow();
    expect(() => parseApiEnv({ ...valid, SYNC_OUTBOX_MAX_ENTRIES: '0' })).toThrow();
    expect(() => parseApiEnv({ ...valid, SYNC_BOOTSTRAP_TTL_SECONDS: '86401' })).toThrow();
  });

  it('fails without DATABASE_URL', () => {
    expect(() => parseApiEnv({ PORT: '3000', WEB_ORIGIN: valid.WEB_ORIGIN })).toThrow();
  });
});
