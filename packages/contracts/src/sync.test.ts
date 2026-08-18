import { describe, expect, it } from 'vitest';
import {
  syncBootstrapPageResponseSchema,
  syncBootstrapStartRequestSchema,
  syncBootstrapStartResponseSchema,
  syncCanonicalRecordArraySchema,
  syncCursorSchema,
  syncErrorCodeSchema,
  syncEventEnvelopeSchema,
  syncPullResponseSchema,
  syncPushEventResultSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
} from './sync.js';

const memoryId = '018f47a6-62f1-7f36-8c2f-3b17d0878d4a';
const evidenceId = '018f47a6-62f2-7c4a-8f1d-24b57980731a';
const factId = '018f47a6-62f3-72c9-83df-997a49d6ca22';
const eventId = '018f47a6-62f4-781e-95a4-1a5de09e5fc1';
const clientInstanceId = '018f47a6-62f5-7baf-8d04-88ce9f940c07';
const bootstrapToken = '018f47a6-62f6-7c62-87fe-e830ec2568cc';
const createdAt = '2026-08-18T00:00:00.000Z';

const validRecords = [
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
] as const;

const validEnvelope = {
  protocolVersion: 1,
  eventId,
  eventType: 'MEMORY_CREATED',
  memoryId,
  predecessorFactIds: [],
  records: validRecords,
} as const;

describe('synchronization protocol contracts', () => {
  it('preserves decimal cursors beyond the JavaScript safe integer range', () => {
    expect(syncCursorSchema.parse('9007199254740993')).toBe('9007199254740993');
    expect(syncCursorSchema.parse('0')).toBe('0');
    expect(() => syncCursorSchema.parse('01')).toThrow();
    expect(() => syncCursorSchema.parse('-1')).toThrow();
  });

  it('accepts protocol v1 envelopes and rejects a different persisted protocol version', () => {
    expect(syncEventEnvelopeSchema.parse(validEnvelope).protocolVersion).toBe(1);
    expect(() =>
      syncEventEnvelopeSchema.parse({ ...validEnvelope, protocolVersion: 2 }),
    ).toThrow();
    expect(() =>
      syncEventEnvelopeSchema.parse({ ...validEnvelope, records: validRecords.slice(0, 3) }),
    ).toThrow();
  });

  it('validates the immutable canonical record union', () => {
    expect(syncCanonicalRecordArraySchema.parse(validRecords)).toHaveLength(4);
    expect(() =>
      syncCanonicalRecordArraySchema.parse([
        ...validRecords,
        { kind: 'currentFact', id: factId, memoryId },
      ]),
    ).toThrow();
  });

  it('accepts push requests and all durable/recoverable push outcomes', () => {
    expect(
      syncPushRequestSchema.parse({
        protocolVersion: 1,
        clientInstanceId,
        events: [validEnvelope],
      }).events,
    ).toHaveLength(1);

    const outcomes = [
      { eventId, status: 'APPLIED' },
      { eventId, status: 'ALREADY_APPLIED' },
      { eventId, status: 'CONFLICT' },
      { eventId, status: 'DEPENDENCY_MISSING', missingFactIds: [factId] },
      { eventId, status: 'BLOCKED', code: 'SYNC_BLOCKED' },
      { eventId, status: 'INVALID', code: 'SYNC_INTEGRITY_VIOLATION' },
    ] as const;

    for (const outcome of outcomes) {
      expect(syncPushEventResultSchema.parse(outcome)).toEqual(outcome);
    }
    expect(syncPushResponseSchema.parse({ protocolVersion: 1, results: outcomes }).results).toHaveLength(
      outcomes.length,
    );
  });

  it('validates ordered pull pages with decimal-string cursors', () => {
    const page = syncPullResponseSchema.parse({
      protocolVersion: 1,
      events: [{ sequence: '9007199254740993', envelope: validEnvelope }],
      nextCursor: '9007199254740993',
      hasMore: false,
    });
    expect(page.events[0]?.sequence).toBe('9007199254740993');
    expect(page.nextCursor).toBe('9007199254740993');
  });

  it('validates fixed-snapshot bootstrap request, start, and page contracts', () => {
    expect(
      syncBootstrapStartRequestSchema.parse({ protocolVersion: 1, clientInstanceId }),
    ).toEqual({ protocolVersion: 1, clientInstanceId });

    expect(
      syncBootstrapStartResponseSchema.parse({
        protocolVersion: 1,
        bootstrapToken,
        highWatermarkCursor: '42',
        totalRecords: 4,
      }),
    ).toMatchObject({ bootstrapToken, highWatermarkCursor: '42', totalRecords: 4 });

    expect(
      syncBootstrapPageResponseSchema.parse({
        protocolVersion: 1,
        bootstrapToken,
        records: validRecords,
        nextOffset: null,
      }).nextOffset,
    ).toBeNull();
  });

  it('accepts only the stable synchronization error codes', () => {
    for (const code of [
      'SYNC_PROTOCOL_UNSUPPORTED',
      'SYNC_CURSOR_EXPIRED',
      'SYNC_BOOTSTRAP_EXPIRED',
      'SYNC_DEPENDENCY_MISSING',
      'SYNC_INTEGRITY_VIOLATION',
      'SYNC_SERVICE_UNAVAILABLE',
      'SYNC_BLOCKED',
    ]) {
      expect(syncErrorCodeSchema.parse(code)).toBe(code);
    }
    expect(() => syncErrorCodeSchema.parse('SYNC_UNKNOWN')).toThrow();
  });
});
