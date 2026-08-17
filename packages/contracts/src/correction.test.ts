import { expect, it } from 'vitest';
import {
  correctMemoryRequestSchema,
  correctMemoryResponseSchema,
  memoryHistoryResponseSchema,
} from './correction.js';

it('normalizes a correction request', () => {
  expect(
    correctMemoryRequestSchema.parse({
      text: '  Corrigido.  ',
      expectedCurrentFactId: '0198c000-0000-7000-8000-000000000001',
      reason: '  ajuste  ',
    }),
  ).toEqual({
    text: 'Corrigido.',
    expectedCurrentFactId: '0198c000-0000-7000-8000-000000000001',
    reason: 'ajuste',
  });
});

it('rejects invalid correction request lengths', () => {
  expect(
    correctMemoryRequestSchema.safeParse({ text: ' ', expectedCurrentFactId: 'id' }).success,
  ).toBe(false);
  expect(
    correctMemoryRequestSchema.safeParse({
      text: 'x'.repeat(4001),
      expectedCurrentFactId: 'id',
    }).success,
  ).toBe(false);
  expect(
    correctMemoryRequestSchema.safeParse({
      text: 'ok',
      expectedCurrentFactId: 'id',
      reason: 'x'.repeat(501),
    }).success,
  ).toBe(false);
});

it('parses a correction response', () => {
  const parsed = correctMemoryResponseSchema.parse({
    memoryId: 'm1',
    current: {
      factId: 'f2',
      evidenceId: 'e2',
      content: 'B',
      recordedAt: '2026-08-16T09:00:00.000Z',
      correctedAt: '2026-08-17T05:00:00.000Z',
    },
    correction: { eventId: 'ev2', supersedesFactId: 'f1', reason: null },
  });

  expect(parsed.current.factId).toBe('f2');
  expect(parsed.correction.supersedesFactId).toBe('f1');
});

it('requires a non-empty history', () => {
  const version = {
    factId: 'f1',
    evidenceId: 'e1',
    content: 'A',
    createdAt: '2026-08-16T09:00:00.000Z',
    reason: null,
    isOriginal: true,
    isCurrent: true,
    supersedesFactId: null,
    eventId: 'ev1',
  };

  expect(
    memoryHistoryResponseSchema.parse({ memoryId: 'm1', versions: [version] }).versions,
  ).toHaveLength(1);
  expect(memoryHistoryResponseSchema.safeParse({ memoryId: 'm1', versions: [] }).success).toBe(
    false,
  );
});
