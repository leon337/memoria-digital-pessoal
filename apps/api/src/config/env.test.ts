import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env.js';

const valid = {
  PORT: '3000',
  DATABASE_URL: 'postgresql://mdp:mdp@127.0.0.1:5432/mdp',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
};

describe('parseApiEnv', () => {
  it('returns typed configuration', () => {
    expect(parseApiEnv(valid)).toEqual({
      port: 3000,
      databaseUrl: valid.DATABASE_URL,
      webOrigin: valid.WEB_ORIGIN,
    });
  });

  it('fails without DATABASE_URL', () => {
    expect(() => parseApiEnv({ PORT: '3000', WEB_ORIGIN: valid.WEB_ORIGIN })).toThrow();
  });
});
