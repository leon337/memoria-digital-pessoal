import { expect, it } from 'vitest';
import {
  CorrectionDomainError,
  createTextCorrectionRecord,
  orderTextFactHistory,
} from './correction.js';

const recordedAt = new Date('2026-08-16T09:00:00.000Z');
const correctedAt = new Date('2026-08-17T05:00:00.000Z');
const previous = {
  factId: 'fact-1',
  evidenceId: 'evidence-1',
  content: 'Texto atual.',
  recordedAt,
};
const ids = { evidenceId: 'evidence-2', eventId: 'event-2', factId: 'fact-2' };

it('creates a normalized append-only correction and preserves recordedAt', () => {
  const record = createTextCorrectionRecord({
    memoryId: 'memory-1',
    previous,
    text: '  Texto corrigido.  ',
    reason: '  ajuste factual  ',
    correctedAt,
    ids,
  });
  expect(record.evidence.content).toBe('Texto corrigido.');
  expect(record.fact.supersedesFactId).toBe('fact-1');
  expect(record.event).toMatchObject({
    type: 'MEMORY_CORRECTED',
    factId: 'fact-2',
    supersedesFactId: 'fact-1',
    reason: 'ajuste factual',
  });
  expect(record.currentFact.recordedAt).toBe(recordedAt);
});

it.each([
  ['   ', 'EMPTY_CORRECTION'],
  ['x'.repeat(4001), 'TEXT_TOO_LONG'],
  [' Texto atual. ', 'NO_CHANGE'],
] as const)('rejects invalid text %s with %s', (text, code) => {
  expect(() =>
    createTextCorrectionRecord({ memoryId: 'memory-1', previous, text, correctedAt, ids }),
  ).toThrow(expect.objectContaining<Partial<CorrectionDomainError>>({ code }));
});

it('rejects an oversized normalized reason', () => {
  expect(() =>
    createTextCorrectionRecord({
      memoryId: 'memory-1',
      previous,
      text: 'Novo texto.',
      reason: 'x'.repeat(501),
      correctedAt,
      ids,
    }),
  ).toThrow(expect.objectContaining<Partial<CorrectionDomainError>>({ code: 'REASON_TOO_LONG' }));
});

it('orders the explicit chain root-to-tip independent of array/timestamp order', () => {
  const ordered = orderTextFactHistory(
    [
      {
        factId: 'f3',
        evidenceId: 'e3',
        content: 'C',
        createdAt: correctedAt,
        supersedesFactId: 'f2',
      },
      {
        factId: 'f1',
        evidenceId: 'e1',
        content: 'A',
        createdAt: recordedAt,
        supersedesFactId: null,
      },
      {
        factId: 'f2',
        evidenceId: 'e2',
        content: 'B',
        createdAt: correctedAt,
        supersedesFactId: 'f1',
      },
    ],
    'f3',
  );
  expect(ordered.map((item) => item.factId)).toEqual(['f1', 'f2', 'f3']);
  expect(ordered[0]).toMatchObject({ isOriginal: true, isCurrent: false });
  expect(ordered[2]).toMatchObject({ isOriginal: false, isCurrent: true });
});

it('rejects broken or forked history', () => {
  expect(() =>
    orderTextFactHistory(
      [
        {
          factId: 'f1',
          evidenceId: 'e1',
          content: 'A',
          createdAt: recordedAt,
          supersedesFactId: null,
        },
        {
          factId: 'f2',
          evidenceId: 'e2',
          content: 'B',
          createdAt: correctedAt,
          supersedesFactId: 'f1',
        },
        {
          factId: 'f3',
          evidenceId: 'e3',
          content: 'C',
          createdAt: correctedAt,
          supersedesFactId: 'f1',
        },
      ],
      'f3',
    ),
  ).toThrow(expect.objectContaining<Partial<CorrectionDomainError>>({ code: 'BROKEN_HISTORY' }));
});
