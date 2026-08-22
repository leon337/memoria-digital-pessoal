import { describe, expect, it } from 'vitest';
import {
  ConflictResolutionDomainError,
  createConflictResolutionRecord,
} from './conflict-resolution.js';

const resolvedAt = new Date('2026-08-18T01:00:00.000Z');
const ids = {
  evidenceId: 'evidence-resolution',
  eventId: 'event-resolution',
  factId: 'fact-resolution',
};

describe('append-only conflict resolution', () => {
  it('creates one new fact linked to every sorted unique candidate', () => {
    const record = createConflictResolutionRecord({
      memoryId: 'memory-1',
      baselineFactId: 'fact-a',
      candidateFactIds: ['fact-c', 'fact-b'],
      text: '  Versão confirmada.  ',
      reason: '  confirmação humana  ',
      resolvedAt,
      ids,
    });

    expect(record.evidence.content).toBe('Versão confirmada.');
    expect(record.fact).toMatchObject({
      id: ids.factId,
      content: 'Versão confirmada.',
      supersedesFactId: null,
    });
    expect(record.event).toMatchObject({
      type: 'CONFLICT_RESOLVED',
      factId: ids.factId,
      supersedesFactId: null,
      reason: 'confirmação humana',
    });
    expect(record.relations.map((relation) => relation.predecessorFactId)).toEqual([
      'fact-b',
      'fact-c',
    ]);
    expect(record.baselineFactId).toBe('fact-a');
  });

  it('rejects fewer than two distinct conflict candidates', () => {
    for (const candidateFactIds of [[], ['fact-b'], ['fact-b', 'fact-b']]) {
      expect(() =>
        createConflictResolutionRecord({
          memoryId: 'memory-1',
          baselineFactId: 'fact-a',
          candidateFactIds,
          text: 'Versão confirmada.',
          resolvedAt,
          ids,
        }),
      ).toThrow(
        expect.objectContaining<Partial<ConflictResolutionDomainError>>({
          code: 'INVALID_CANDIDATES',
        }),
      );
    }
  });

  it('reuses correction text and reason validation rules', () => {
    expect(() =>
      createConflictResolutionRecord({
        memoryId: 'memory-1',
        baselineFactId: 'fact-a',
        candidateFactIds: ['fact-b', 'fact-c'],
        text: '   ',
        resolvedAt,
        ids,
      }),
    ).toThrow(expect.objectContaining({ code: 'EMPTY_CORRECTION' }));

    expect(() =>
      createConflictResolutionRecord({
        memoryId: 'memory-1',
        baselineFactId: 'fact-a',
        candidateFactIds: ['fact-b', 'fact-c'],
        text: 'Versão confirmada.',
        reason: 'x'.repeat(501),
        resolvedAt,
        ids,
      }),
    ).toThrow(expect.objectContaining({ code: 'REASON_TOO_LONG' }));
  });
});
