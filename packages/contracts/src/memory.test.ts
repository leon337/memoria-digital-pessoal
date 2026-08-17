import { describe, expect, it } from 'vitest';
import {
  createMemoryRequestSchema,
  memoryQueryResponseSchema,
  memoryQuerySchema,
  MEMORY_QUERY_MAX_LENGTH,
  MEMORY_TEXT_MAX_LENGTH,
} from './memory.js';

describe('memory contracts', () => {
  it('accepts the exact memory limit and preserves valid surrounding whitespace', () => {
    expect(createMemoryRequestSchema.parse({ text: '  memória sintética  ' }).text).toBe(
      '  memória sintética  ',
    );
    expect(
      createMemoryRequestSchema.parse({ text: 'x'.repeat(MEMORY_TEXT_MAX_LENGTH) }).text,
    ).toHaveLength(MEMORY_TEXT_MAX_LENGTH);
  });

  it('rejects empty, whitespace-only and oversized memory text', () => {
    expect(() => createMemoryRequestSchema.parse({ text: '' })).toThrow();
    expect(() => createMemoryRequestSchema.parse({ text: '   ' })).toThrow();
    expect(() =>
      createMemoryRequestSchema.parse({
        text: 'x'.repeat(MEMORY_TEXT_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });

  it('trims query text and enforces the 200-character limit after trimming', () => {
    expect(memoryQuerySchema.parse('  Ana  ')).toBe('Ana');
    expect(memoryQuerySchema.parse('x'.repeat(MEMORY_QUERY_MAX_LENGTH))).toHaveLength(
      MEMORY_QUERY_MAX_LENGTH,
    );
    expect(() => memoryQuerySchema.parse('   ')).toThrow();
    expect(() => memoryQuerySchema.parse('x'.repeat(MEMORY_QUERY_MAX_LENGTH + 1))).toThrow();
  });

  it('accepts only coherent FOUND or UNKNOWN response shapes', () => {
    expect(
      memoryQueryResponseSchema.parse({
        status: 'UNKNOWN',
        answer: null,
        provenance: null,
      }),
    ).toEqual({ status: 'UNKNOWN', answer: null, provenance: null });

    expect(
      memoryQueryResponseSchema.parse({
        status: 'FOUND',
        answer: 'Minha irmã se chama Ana.',
        provenance: {
          memoryId: 'memory-id',
          evidenceId: 'evidence-id',
          factId: 'fact-id',
        },
      }).status,
    ).toBe('FOUND');

    expect(() =>
      memoryQueryResponseSchema.parse({
        status: 'FOUND',
        answer: null,
        provenance: null,
      }),
    ).toThrow();
  });
});
