import { describe, expect, it } from 'vitest';
import {
  syncCursorSchema,
  syncEventEnvelopeSchema,
  syncPushEventResultSchema,
} from './sync.js';

const memoryId = '018f47a6-62f1-7f36-8c2f-3b17d0878d4a';
const evidenceId = '018f47a6-62f2-7c4a-8f1d-24b57980731a';
const factId = '018f47a6-62f3-72c9-83df-997a49d6ca22';
const eventId = '018f47a6-62f4-781e-95a4-1a5de09e5fc1';
const createdAt = '2026-08-18T00:00:00.000Z';

const validEnvelope = {
  protocolVersion: 1,
  eventId,
  eventType: 'MEMORY_CREATED',
  memoryId,
  predecessorFactIds: [],
  records: [
    {
      kind: 'memory',
      id: memoryId,
      recordedAt: createdAt,
      occurredAt: null,
      temporalPrecision: 'unknown',
    },
    {
      kind: 'evidence',
      id: evidenceId,
      memoryId,
      evidenceKind: 'text',
      content: 'Registro sintético de sincronização.',
      createdAt,
    },
    {
      kind: 'ledgerEvent',
      id: eventId,
      memoryId,
      evidenceId,
      factId,
      supersedesFactId: null,
      eventType: 'MEMORY_CREATED',
      reason: null,
      createdAt,
    },
    {
      kind: 'fact',
      id: factId,
      memoryId,
      evidenceId,
      factKind: 'autobiographical_statement',
      content: 'Registro sintético de sincronização.',
      createdAt,
    },
  ],
} as const;

describe('synchronization protocol contracts', () => {
  it('preserves decimal cursors beyond the JavaScript safe integer range', () => {
    expect(syncCursorSchema.parse('9007199254740993')).toBe('9007199254740993');
  });

  it('accepts protocol v1 envelopes and rejects a different persisted protocol version', () => {
    expect(syncEventEnvelopeSchema.parse(validEnvelope).protocolVersion).toBe(1);
    expect(() =>
      syncEventEnvelopeSchema.parse({ ...validEnvelope, protocolVersion: 2 }),
    ).toThrow();
  });

  it('accepts durable conflict acknowledgements as a push outcome', () => {
    expect(syncPushEventResultSchema.parse({ eventId, status: 'CONFLICT' })).toEqual({
      eventId,
      status: 'CONFLICT',
    });
  });

  it('preserves missing dependency identifiers for recoverable push ordering', () => {
    expect(
      syncPushEventResultSchema.parse({
        eventId,
        status: 'DEPENDENCY_MISSING',
        missingFactIds: [factId],
      }),
    ).toEqual({
      eventId,
      status: 'DEPENDENCY_MISSING',
      missingFactIds: [factId],
    });
  });
});
