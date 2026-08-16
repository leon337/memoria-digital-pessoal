import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env.js';

describe('parseWebEnv', () => {
  it('accepts a valid API URL', () => {
    expect(parseWebEnv({ VITE_API_BASE_URL: 'http://127.0.0.1:3000' })).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3000',
    });
  });

  it('rejects a missing API URL', () => {
    expect(() => parseWebEnv({})).toThrow();
  });
});
