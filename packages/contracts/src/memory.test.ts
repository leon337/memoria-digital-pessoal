import { describe, expect, it } from 'vitest';
import {
  createMemoryRequestSchema,
  memoryQueryResponseSchema,
  memoryQuerySchema,
  MEMORY_QUERY_MAX_LENGTH,
  MEMORY_TEXT_MAX_LENGTH,
  resolveConflictRequestSchema,
} from './memory.js';

const candidateB = '018f47a6-62f1-7f36-8c2f-3b17d0878d4a';
const candidateC = '018f47a6-62f2-7c4a-8f1d-24b57980731a';

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

  it('accepts coherent FOUND, UNKNOWN, or explicit CONFLICT response shapes', () => {
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

    expect(
      memoryQueryResponseSchema.parse({
        status: 'CONFLICT',
        answer: null,
        provenance: null,
        conflict: {
          memoryId: 'memory-id',
          baseline: {
            factId: 'fact-a',
            evidenceId: 'evidence-a',
            content: 'Versão A',
          },
          candidates: [
            { factId: 'fact-b', evidenceId: 'evidence-b', content: 'Versão B' },
            { factId: 'fact-c', evidenceId: 'evidence-c', content: 'Versão C' },
          ],
        },
      }).status,
    ).toBe('CONFLICT');

    expect(() =>
      memoryQueryResponseSchema.parse({
        status: 'FOUND',
        answer: null,
        provenance: null,
      }),
    ).toThrow();
  });

  it('normalizes a conflict resolution request and requires distinct UUID candidates', () => {
    expect(
      resolveConflictRequestSchema.parse({
        expectedCandidateFactIds: [candidateC, candidateB],
        text: '  Versão confirmada.  ',
        reason: '  confirmação humana  ',
      }),
    ).toEqual({
      expectedCandidateFactIds: [candidateC, candidateB],
      text: 'Versão confirmada.',
      reason: 'confirmação humana',
    });

    expect(() =>
      resolveConflictRequestSchema.parse({
        expectedCandidateFactIds: [candidateB, candidateB],
        text: 'Versão confirmada.',
      }),
    ).toThrow();
  });
});
