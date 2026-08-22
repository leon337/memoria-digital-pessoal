import { z } from 'zod';
import { CORRECTION_REASON_MAX_LENGTH } from './correction.js';
import { MEMORY_TEXT_MAX_LENGTH } from './memory.js';

export const SYNC_PROTOCOL_VERSION = 1 as const;

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const syncCursorSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const syncEventTypeSchema = z.enum([
  'MEMORY_CREATED',
  'MEMORY_CORRECTED',
  'CONFLICT_RESOLVED',
]);

export const syncMemoryRecordSchema = z.object({
  kind: z.literal('memory'),
  id: uuidSchema,
  recordedAt: isoDateTimeSchema,
  occurredAt: z.null(),
  temporalPrecision: z.literal('unknown'),
});

export const syncEvidenceRecordSchema = z.object({
  kind: z.literal('evidence'),
  id: uuidSchema,
  memoryId: uuidSchema,
  evidenceKind: z.literal('text'),
  content: z.string().min(1).max(MEMORY_TEXT_MAX_LENGTH),
  createdAt: isoDateTimeSchema,
});

export const syncLedgerEventRecordSchema = z.object({
  kind: z.literal('ledgerEvent'),
  id: uuidSchema,
  memoryId: uuidSchema,
  evidenceId: uuidSchema,
  factId: uuidSchema.nullable(),
  supersedesFactId: uuidSchema.nullable(),
  eventType: syncEventTypeSchema,
  reason: z.string().max(CORRECTION_REASON_MAX_LENGTH).nullable(),
  createdAt: isoDateTimeSchema,
});

export const syncFactRecordSchema = z.object({
  kind: z.literal('fact'),
  id: uuidSchema,
  memoryId: uuidSchema,
  evidenceId: uuidSchema,
  factKind: z.literal('autobiographical_statement'),
  content: z.string().min(1).max(MEMORY_TEXT_MAX_LENGTH),
  createdAt: isoDateTimeSchema,
});

export const syncFactRelationRecordSchema = z.object({
  kind: z.literal('factRelation'),
  memoryId: uuidSchema,
  predecessorFactId: uuidSchema,
  successorFactId: uuidSchema,
  relationType: z.literal('SUPERSEDES'),
});

export const syncCanonicalRecordSchema = z.discriminatedUnion('kind', [
  syncMemoryRecordSchema,
  syncEvidenceRecordSchema,
  syncLedgerEventRecordSchema,
  syncFactRecordSchema,
  syncFactRelationRecordSchema,
]);

export const syncCanonicalRecordArraySchema = z.array(syncCanonicalRecordSchema);

export const syncEventEnvelopeSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  eventId: uuidSchema,
  eventType: syncEventTypeSchema,
  memoryId: uuidSchema,
  predecessorFactIds: z.array(uuidSchema),
  records: syncCanonicalRecordArraySchema.min(4),
});

const appliedResultSchema = z.object({
  eventId: uuidSchema,
  status: z.literal('APPLIED'),
});
const alreadyAppliedResultSchema = z.object({
  eventId: uuidSchema,
  status: z.literal('ALREADY_APPLIED'),
});
const conflictResultSchema = z.object({
  eventId: uuidSchema,
  status: z.literal('CONFLICT'),
});
const dependencyMissingResultSchema = z.object({
  eventId: uuidSchema,
  status: z.literal('DEPENDENCY_MISSING'),
  missingFactIds: z.array(uuidSchema),
});
const blockedResultSchema = z.object({
  eventId: uuidSchema,
  status: z.literal('BLOCKED'),
  code: z.literal('SYNC_BLOCKED'),
});
const invalidResultSchema = z.object({
  eventId: uuidSchema,
  status: z.literal('INVALID'),
  code: z.literal('SYNC_INTEGRITY_VIOLATION'),
});

export const syncPushEventResultSchema = z.discriminatedUnion('status', [
  appliedResultSchema,
  alreadyAppliedResultSchema,
  conflictResultSchema,
  dependencyMissingResultSchema,
  blockedResultSchema,
  invalidResultSchema,
]);

export const syncPushRequestSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  clientInstanceId: uuidSchema,
  events: z.array(syncEventEnvelopeSchema).min(1),
});

export const syncPushResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  results: z.array(syncPushEventResultSchema),
});

export const syncPullEventSchema = z.object({
  sequence: syncCursorSchema,
  envelope: syncEventEnvelopeSchema,
});

export const syncPullResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  events: z.array(syncPullEventSchema),
  nextCursor: syncCursorSchema,
  hasMore: z.boolean(),
});

export const syncBootstrapStartRequestSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  clientInstanceId: uuidSchema,
});

export const syncBootstrapStartResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  bootstrapToken: uuidSchema,
  highWatermarkCursor: syncCursorSchema,
  totalRecords: z.number().int().nonnegative(),
});

export const syncBootstrapPageResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  bootstrapToken: uuidSchema,
  records: syncCanonicalRecordArraySchema,
  nextOffset: z.number().int().nonnegative().nullable(),
});

export const syncErrorCodeSchema = z.enum([
  'SYNC_PROTOCOL_UNSUPPORTED',
  'SYNC_CURSOR_EXPIRED',
  'SYNC_BOOTSTRAP_EXPIRED',
  'SYNC_DEPENDENCY_MISSING',
  'SYNC_INTEGRITY_VIOLATION',
  'SYNC_SERVICE_UNAVAILABLE',
  'SYNC_BLOCKED',
]);

export type SyncCursor = z.infer<typeof syncCursorSchema>;
export type SyncEventType = z.infer<typeof syncEventTypeSchema>;
export type SyncMemoryRecord = z.infer<typeof syncMemoryRecordSchema>;
export type SyncEvidenceRecord = z.infer<typeof syncEvidenceRecordSchema>;
export type SyncLedgerEventRecord = z.infer<typeof syncLedgerEventRecordSchema>;
export type SyncFactRecord = z.infer<typeof syncFactRecordSchema>;
export type SyncFactRelationRecord = z.infer<typeof syncFactRelationRecordSchema>;
export type SyncCanonicalRecord = z.infer<typeof syncCanonicalRecordSchema>;
export type SyncEventEnvelope = z.infer<typeof syncEventEnvelopeSchema>;
export type SyncPushEventResult = z.infer<typeof syncPushEventResultSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;
export type SyncPullEvent = z.infer<typeof syncPullEventSchema>;
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
export type SyncBootstrapStartRequest = z.infer<typeof syncBootstrapStartRequestSchema>;
export type SyncBootstrapStartResponse = z.infer<typeof syncBootstrapStartResponseSchema>;
export type SyncBootstrapPageResponse = z.infer<typeof syncBootstrapPageResponseSchema>;
export type SyncErrorCode = z.infer<typeof syncErrorCodeSchema>;
