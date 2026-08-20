import {
  syncCursorSchema,
  type SyncCanonicalRecord,
  type SyncPullResponse,
  type SyncPushEventResult,
} from '@mdp/contracts';
import { FactGraphDomainError, deriveMemoryProjection } from '@mdp/domain';
import { createId } from '@mdp/shared';
import { MemoryRepositoryError } from '../memory-repository.js';
import {
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
  type LocalBootstrapStagingRecord,
  type LocalCurrentFactRecord,
  type LocalEvidenceRecord,
  type LocalFactRecord,
  type LocalFactRelationRecord,
  type LocalLedgerEventRecord,
  type LocalMemoryRecord,
  type LocalSyncConflictRecord,
  type LocalSyncOutboxRecord,
  type LocalSyncStateRecord,
} from './mdp-local-db.js';

export type LocalMemorySyncStatus = 'SYNCED' | 'PENDING' | 'BLOCKED' | 'CONFLICT';

interface IndexedDbSyncStoreDependencies {
  factory?: IDBFactory;
  createId?: () => string;
}

const PULL_STORES = [
  'memories',
  'evidence',
  'ledgerEvents',
  'facts',
  'factRelations',
  'currentFacts',
  'syncConflicts',
  'syncState',
];

const BOOTSTRAP_PROMOTION_STORES = [...PULL_STORES, 'bootstrapStaging'];

function sameDate(left: Date, right: string): boolean {
  return left.toISOString() === right;
}

function sameCanonicalRecord(existing: unknown, record: SyncCanonicalRecord): boolean {
  switch (record.kind) {
    case 'memory': {
      const local = existing as LocalMemoryRecord;
      return (
        local.id === record.id &&
        sameDate(local.recordedAt, record.recordedAt) &&
        local.occurredAt === record.occurredAt &&
        local.temporalPrecision === record.temporalPrecision
      );
    }
    case 'evidence': {
      const local = existing as LocalEvidenceRecord;
      return (
        local.id === record.id &&
        local.memoryId === record.memoryId &&
        local.kind === record.evidenceKind &&
        local.content === record.content &&
        sameDate(local.createdAt, record.createdAt)
      );
    }
    case 'ledgerEvent': {
      const local = existing as LocalLedgerEventRecord;
      return (
        local.id === record.id &&
        local.memoryId === record.memoryId &&
        local.evidenceId === record.evidenceId &&
        (local.factId ?? null) === record.factId &&
        (local.supersedesFactId ?? null) === record.supersedesFactId &&
        local.type === record.eventType &&
        (local.reason ?? null) === record.reason &&
        sameDate(local.createdAt, record.createdAt)
      );
    }
    case 'fact': {
      const local = existing as LocalFactRecord;
      return (
        local.id === record.id &&
        local.memoryId === record.memoryId &&
        local.evidenceId === record.evidenceId &&
        local.kind === record.factKind &&
        local.content === record.content &&
        sameDate(local.createdAt, record.createdAt)
      );
    }
    case 'factRelation': {
      const local = existing as LocalFactRelationRecord;
      return (
        local.memoryId === record.memoryId &&
        local.predecessorFactId === record.predecessorFactId &&
        local.successorFactId === record.successorFactId &&
        local.relationType === record.relationType
      );
    }
  }
}

function sameWireRecord(left: SyncCanonicalRecord, right: SyncCanonicalRecord): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'memory':
      return (
        right.kind === 'memory' &&
        left.id === right.id &&
        left.recordedAt === right.recordedAt &&
        left.occurredAt === right.occurredAt &&
        left.temporalPrecision === right.temporalPrecision
      );
    case 'evidence':
      return (
        right.kind === 'evidence' &&
        left.id === right.id &&
        left.memoryId === right.memoryId &&
        left.evidenceKind === right.evidenceKind &&
        left.content === right.content &&
        left.createdAt === right.createdAt
      );
    case 'ledgerEvent':
      return (
        right.kind === 'ledgerEvent' &&
        left.id === right.id &&
        left.memoryId === right.memoryId &&
        left.evidenceId === right.evidenceId &&
        left.factId === right.factId &&
        left.supersedesFactId === right.supersedesFactId &&
        left.eventType === right.eventType &&
        left.reason === right.reason &&
        left.createdAt === right.createdAt
      );
    case 'fact':
      return (
        right.kind === 'fact' &&
        left.id === right.id &&
        left.memoryId === right.memoryId &&
        left.evidenceId === right.evidenceId &&
        left.factKind === right.factKind &&
        left.content === right.content &&
        left.createdAt === right.createdAt
      );
    case 'factRelation':
      return (
        right.kind === 'factRelation' &&
        left.memoryId === right.memoryId &&
        left.predecessorFactId === right.predecessorFactId &&
        left.successorFactId === right.successorFactId &&
        left.relationType === right.relationType
      );
  }
}

function toLocalRecord(record: SyncCanonicalRecord): object {
  switch (record.kind) {
    case 'memory':
      return {
        id: record.id,
        recordedAt: new Date(record.recordedAt),
        occurredAt: record.occurredAt,
        temporalPrecision: record.temporalPrecision,
      } satisfies LocalMemoryRecord;
    case 'evidence':
      return {
        id: record.id,
        memoryId: record.memoryId,
        kind: record.evidenceKind,
        content: record.content,
        createdAt: new Date(record.createdAt),
      } satisfies LocalEvidenceRecord;
    case 'ledgerEvent':
      return {
        id: record.id,
        memoryId: record.memoryId,
        evidenceId: record.evidenceId,
        ...(record.factId === null ? {} : { factId: record.factId }),
        ...(record.supersedesFactId === null ? {} : { supersedesFactId: record.supersedesFactId }),
        type: record.eventType,
        reason: record.reason,
        createdAt: new Date(record.createdAt),
      } satisfies LocalLedgerEventRecord;
    case 'fact':
      return {
        id: record.id,
        memoryId: record.memoryId,
        evidenceId: record.evidenceId,
        kind: record.factKind,
        content: record.content,
        createdAt: new Date(record.createdAt),
      } satisfies LocalFactRecord;
    case 'factRelation':
      return {
        memoryId: record.memoryId,
        predecessorFactId: record.predecessorFactId,
        successorFactId: record.successorFactId,
        relationType: record.relationType,
      } satisfies LocalFactRelationRecord;
  }
}

function recordStore(record: SyncCanonicalRecord): string {
  switch (record.kind) {
    case 'memory':
      return 'memories';
    case 'evidence':
      return 'evidence';
    case 'ledgerEvent':
      return 'ledgerEvents';
    case 'fact':
      return 'facts';
    case 'factRelation':
      return 'factRelations';
  }
}

function recordKey(record: SyncCanonicalRecord): IDBValidKey {
  if (record.kind === 'factRelation') {
    return [record.predecessorFactId, record.successorFactId];
  }
  return record.id;
}

function bootstrapRecordKey(record: SyncCanonicalRecord): string {
  if (record.kind === 'factRelation') {
    return `factRelation:${record.predecessorFactId}:${record.successorFactId}`;
  }
  return `${record.kind}:${record.id}`;
}

async function applyRecordImmutable(
  transaction: IDBTransaction,
  record: SyncCanonicalRecord,
): Promise<void> {
  const store = transaction.objectStore(recordStore(record));
  const existing = await requestAsPromise<unknown>(store.get(recordKey(record)));
  if (existing === undefined) {
    store.add(toLocalRecord(record));
    return;
  }
  if (!sameCanonicalRecord(existing, record)) {
    throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
  }
}

function latestFactDate(facts: LocalFactRecord[]): Date {
  return new Date(Math.max(...facts.map((fact) => fact.createdAt.getTime())));
}

async function reprojectMemory(transaction: IDBTransaction, memoryId: string): Promise<void> {
  const facts = await requestAsPromise<LocalFactRecord[]>(
    transaction.objectStore('facts').index('memoryId').getAll(memoryId),
  );
  const relations = await requestAsPromise<LocalFactRelationRecord[]>(
    transaction.objectStore('factRelations').index('memoryId').getAll(memoryId),
  );
  const memory = await requestAsPromise<LocalMemoryRecord | undefined>(
    transaction.objectStore('memories').get(memoryId),
  );
  if (!memory || facts.length === 0) {
    throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
  }

  let projection: ReturnType<typeof deriveMemoryProjection>;
  try {
    projection = deriveMemoryProjection(
      facts.map((fact) => ({ factId: fact.id, createdAt: fact.createdAt })),
      relations,
    );
  } catch (error) {
    if (error instanceof FactGraphDomainError) {
      throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR', error);
    }
    throw error;
  }

  const currentFacts = transaction.objectStore('currentFacts');
  const existingCurrentKeys = await requestAsPromise<IDBValidKey[]>(
    currentFacts.index('memoryId').getAllKeys(memoryId),
  );
  for (const key of existingCurrentKeys) currentFacts.delete(key);

  const conflicts = transaction.objectStore('syncConflicts');
  const existingConflict = await requestAsPromise<LocalSyncConflictRecord | undefined>(
    conflicts.get(memoryId),
  );

  if (projection.status === 'RESOLVED') {
    const current = facts.find((fact) => fact.id === projection.currentFactId);
    if (!current) throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
    currentFacts.put({
      factId: current.id,
      memoryId,
      evidenceId: current.evidenceId,
      content: current.content,
      recordedAt: memory.recordedAt,
    } satisfies LocalCurrentFactRecord);
    if (existingConflict) {
      conflicts.put({
        ...existingConflict,
        status: 'RESOLVED',
        resolutionFactId: current.id,
        updatedAt: current.createdAt,
      } satisfies LocalSyncConflictRecord);
    }
    return;
  }

  const candidateFacts = projection.candidateFactIds.map((candidateId) =>
    facts.find((fact) => fact.id === candidateId),
  );
  if (candidateFacts.some((fact) => fact === undefined)) {
    throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
  }
  conflicts.put({
    memoryId,
    baselineFactId: projection.baselineFactId,
    candidateFactIds: projection.candidateFactIds,
    status: 'OPEN',
    resolutionFactId: null,
    updatedAt: latestFactDate(candidateFacts as LocalFactRecord[]),
  } satisfies LocalSyncConflictRecord);
}

export class IndexedDbSyncStore {
  private readonly factory: IDBFactory;
  private readonly nextId: () => string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dependencies: IndexedDbSyncStoreDependencies = {}) {
    this.factory = dependencies.factory ?? indexedDB;
    this.nextId = dependencies.createId ?? createId;
  }

  async getOrCreateClientInstanceId(): Promise<string> {
    const db = await this.database();
    const transaction = db.transaction('syncState', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('syncState');
    const existing = await requestAsPromise<LocalSyncStateRecord | undefined>(
      store.get('clientInstanceId'),
    );

    if (existing !== undefined) {
      if (typeof existing.value !== 'string' || existing.value[14] !== '7') {
        transaction.abort();
        await done.catch(() => undefined);
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }
      await done;
      return existing.value;
    }

    const id = this.nextId();
    if (id[14] !== '7') {
      transaction.abort();
      await done.catch(() => undefined);
      throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
    }
    store.add({ key: 'clientInstanceId', value: id } satisfies LocalSyncStateRecord);
    await done;
    return id;
  }

  async getConfirmedCursor(): Promise<string | null> {
    const db = await this.database();
    const transaction = db.transaction('syncState', 'readonly');
    const done = transactionDone(transaction);
    const row = await requestAsPromise<LocalSyncStateRecord | undefined>(
      transaction.objectStore('syncState').get('confirmedCursor'),
    );
    await done;
    if (row === undefined) return null;
    const parsed = syncCursorSchema.safeParse(row.value);
    if (!parsed.success) throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
    return parsed.data;
  }

  async listPending(limit: number, now: Date): Promise<LocalSyncOutboxRecord[]> {
    const db = await this.database();
    const transaction = db.transaction('syncOutbox', 'readonly');
    const done = transactionDone(transaction);
    const rows = await requestAsPromise<LocalSyncOutboxRecord[]>(
      transaction.objectStore('syncOutbox').getAll(),
    );
    await done;

    return rows
      .filter(
        (row) =>
          row.status === 'PENDING' ||
          (row.status === 'RETRY_WAIT' &&
            row.nextAttemptAt !== null &&
            row.nextAttemptAt.getTime() <= now.getTime()),
      )
      .sort((left, right) => left.eventId.localeCompare(right.eventId))
      .slice(0, Math.max(0, limit));
  }

  async applyPushResults(results: SyncPushEventResult[], now: Date): Promise<void> {
    void now;
    const db = await this.database();
    const transaction = db.transaction('syncOutbox', 'readwrite');
    const done = transactionDone(transaction);
    const outbox = transaction.objectStore('syncOutbox');

    for (const result of results) {
      const row = await requestAsPromise<LocalSyncOutboxRecord | undefined>(
        outbox.get(result.eventId),
      );
      if (row === undefined) {
        continue;
      }

      switch (result.status) {
        case 'APPLIED':
        case 'ALREADY_APPLIED':
        case 'CONFLICT':
          outbox.delete(result.eventId);
          break;
        case 'DEPENDENCY_MISSING':
          outbox.put({
            ...row,
            status: 'PENDING',
            nextAttemptAt: null,
            lastErrorCode: 'SYNC_DEPENDENCY_MISSING',
          } satisfies LocalSyncOutboxRecord);
          break;
        case 'BLOCKED':
        case 'INVALID':
          outbox.put({
            ...row,
            status: 'BLOCKED',
            nextAttemptAt: null,
            lastErrorCode: result.code,
          } satisfies LocalSyncOutboxRecord);
          break;
      }
    }

    await done;
  }

  async applyPullPage(page: SyncPullResponse): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction(PULL_STORES, 'readwrite');
    const done = transactionDone(transaction);

    try {
      const touchedMemoryIds = new Set<string>();
      for (const event of page.events) {
        touchedMemoryIds.add(event.envelope.memoryId);
        for (const record of event.envelope.records) {
          await applyRecordImmutable(transaction, record);
        }
      }
      for (const memoryId of touchedMemoryIds) {
        await reprojectMemory(transaction, memoryId);
      }
      transaction.objectStore('syncState').put({
        key: 'confirmedCursor',
        value: page.nextCursor,
      } satisfies LocalSyncStateRecord);
      await done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already be aborted by IndexedDB.
      }
      await done.catch(() => undefined);
      if (error instanceof MemoryRepositoryError) throw error;
      throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR', error);
    }
  }

  async stageBootstrapPage(bootstrapToken: string, records: SyncCanonicalRecord[]): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction('bootstrapStaging', 'readwrite');
    const done = transactionDone(transaction);
    const staging = transaction.objectStore('bootstrapStaging');

    try {
      for (const record of records) {
        const key = bootstrapRecordKey(record);
        const existing = await requestAsPromise<LocalBootstrapStagingRecord | undefined>(
          staging.get([bootstrapToken, key]),
        );
        if (existing === undefined) {
          staging.add({
            bootstrapToken,
            recordKey: key,
            record,
          } satisfies LocalBootstrapStagingRecord);
          continue;
        }
        if (!sameWireRecord(existing.record, record)) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
      }
      await done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already be aborted by IndexedDB.
      }
      await done.catch(() => undefined);
      if (error instanceof MemoryRepositoryError) throw error;
      throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR', error);
    }
  }

  async promoteBootstrap(bootstrapToken: string, watermark: string): Promise<void> {
    const parsedWatermark = syncCursorSchema.safeParse(watermark);
    if (!parsedWatermark.success) throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');

    const db = await this.database();
    const transaction = db.transaction(BOOTSTRAP_PROMOTION_STORES, 'readwrite');
    const done = transactionDone(transaction);

    try {
      const staging = transaction.objectStore('bootstrapStaging');
      const [rows, keys] = await Promise.all([
        requestAsPromise<LocalBootstrapStagingRecord[]>(
          staging.index('bootstrapToken').getAll(bootstrapToken),
        ),
        requestAsPromise<IDBValidKey[]>(staging.index('bootstrapToken').getAllKeys(bootstrapToken)),
      ]);
      const touchedMemoryIds = new Set<string>();
      for (const row of rows) {
        if (row.record.kind !== 'memory') touchedMemoryIds.add(row.record.memoryId);
        else touchedMemoryIds.add(row.record.id);
        await applyRecordImmutable(transaction, row.record);
      }
      for (const memoryId of touchedMemoryIds) {
        await reprojectMemory(transaction, memoryId);
      }
      transaction.objectStore('syncState').put({
        key: 'confirmedCursor',
        value: parsedWatermark.data,
      } satisfies LocalSyncStateRecord);
      for (const key of keys) staging.delete(key);
      await done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already be aborted by IndexedDB.
      }
      await done.catch(() => undefined);
      if (error instanceof MemoryRepositoryError) throw error;
      throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR', error);
    }
  }

  async getGlobalStatus(): Promise<LocalMemorySyncStatus> {
    const db = await this.database();
    const transaction = db.transaction(['syncConflicts', 'syncOutbox'], 'readonly');
    const done = transactionDone(transaction);
    const [conflicts, outbox] = await Promise.all([
      requestAsPromise<LocalSyncConflictRecord[]>(transaction.objectStore('syncConflicts').getAll()),
      requestAsPromise<LocalSyncOutboxRecord[]>(transaction.objectStore('syncOutbox').getAll()),
    ]);
    await done;

    if (conflicts.some((conflict) => conflict.status === 'OPEN')) return 'CONFLICT';
    if (outbox.some((row) => row.status === 'BLOCKED')) return 'BLOCKED';
    if (outbox.length > 0) return 'PENDING';
    return 'SYNCED';
  }

  async getMemoryStatus(memoryId: string): Promise<LocalMemorySyncStatus> {
    const db = await this.database();
    const transaction = db.transaction(['syncConflicts', 'syncOutbox'], 'readonly');
    const done = transactionDone(transaction);
    const conflictRequest = transaction.objectStore('syncConflicts').get(memoryId);
    const outboxRequest = transaction.objectStore('syncOutbox').index('memoryId').getAll(memoryId);
    const [conflict, outbox] = await Promise.all([
      requestAsPromise<LocalSyncConflictRecord | undefined>(conflictRequest),
      requestAsPromise<LocalSyncOutboxRecord[]>(outboxRequest),
    ]);
    await done;

    if (conflict?.status === 'OPEN') return 'CONFLICT';
    if (outbox.some((row) => row.status === 'BLOCKED')) return 'BLOCKED';
    if (outbox.length > 0) return 'PENDING';
    return 'SYNCED';
  }

  private async database(): Promise<IDBDatabase> {
    this.dbPromise ??= openMdpLocalDatabase(this.factory);
    return this.dbPromise;
  }
}
