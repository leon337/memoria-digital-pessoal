import { describe, expect, it } from 'vitest';
import { createTextMemoryRecord } from './memory.js';

describe('createTextMemoryRecord', () => {
  it('creates the five linked Slice 01 records without changing text', () => {
    const recordedAt = new Date('2026-08-16T08:00:00.000Z');
    const record = createTextMemoryRecord({
      text: '  Minha irmã se chama Ana.  ',
      recordedAt,
      ids: {
        memoryId: 'memory-id',
        evidenceId: 'evidence-id',
        eventId: 'event-id',
        factId: 'fact-id',
      },
    });

    expect(record.evidence.content).toBe('  Minha irmã se chama Ana.  ');
    expect(record.fact.content).toBe(record.evidence.content);
    expect(record.currentFact.content).toBe(record.fact.content);
    expect(record.memory.occurredAt).toBeNull();
    expect(record.memory.temporalPrecision).toBe('unknown');
    expect(record.event.type).toBe('MEMORY_CREATED');
    expect(record.event.evidenceId).toBe(record.evidence.id);
    expect(record.currentFact.factId).toBe(record.fact.id);
    expect(record.memory.recordedAt).toBe(recordedAt);
  });

  it('returns frozen record containers without adding inferred semantics', () => {
    const record = createTextMemoryRecord({
      text: 'Registro sintético.',
      recordedAt: new Date('2026-08-16T08:00:00.000Z'),
      ids: {
        memoryId: 'memory-id',
        evidenceId: 'evidence-id',
        eventId: 'event-id',
        factId: 'fact-id',
      },
    });

    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.evidence)).toBe(true);
    expect(record.fact).not.toHaveProperty('confidence');
    expect(record.fact).not.toHaveProperty('entities');
  });
});
