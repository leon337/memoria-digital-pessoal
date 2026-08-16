import { describe, expect, it } from 'vitest';
import { createId, isUuidV7 } from './id.js';

describe('global id policy', () => {
  it('creates UUID version 7', () => {
    const id = createId();

    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('rejects invalid and non-v7 identifiers', () => {
    expect(isUuidV7('not-a-uuid')).toBe(false);
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});
