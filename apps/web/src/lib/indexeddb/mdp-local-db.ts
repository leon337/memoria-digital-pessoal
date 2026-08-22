import type { SyncCanonicalRecord, SyncEventEnvelope } from '@mdp/contracts';

export const MDP_LOCAL_DB_NAME = 'mdp-local';
export const MDP_LOCAL_DB_VERSION = 3;
export const PRODUCT_STORES = [
  'memories',
  'evidence',
  'ledgerEvents',
  'facts',
  'currentFacts',
] as const;
export const SYNC_STORES = [
  'factRelations',
  'syncOutbox',
  'syncState',
  'syncConflicts',
  'bootstrapStaging',
] as const;

export type ProductStoreName = (typeof PRODUCT_STORES)[number];
export type SyncStoreName = (typeof SYNC_STORES)[number];

export interface LocalMemoryRecord {
  id: string;
  recordedAt: Date;
  occurredAt: null;
  temporalPrecision: 'unknown';
}

export interface LocalEvidenceRecord {
  id: string;
  memoryId: string;
  kind: 'text';
  content: string;
  createdAt: Date;
}

export interface LocalLedgerEventRecord {
  id: string;
  memoryId: string;
  evidenceId: string;
  factId?: string;
  supersedesFactId?: string;
  type: 'MEMORY_CREATED' | 'MEMORY_CORRECTED' | 'CONFLICT_RESOLVED';
  reason?: string | null;
  createdAt: Date;
}

export interface LocalFactRecord {
  id: string;
  memoryId: string;
  evidenceId: string;
  kind: 'autobiographical_statement';
  content: string;
  supersedesFactId?: string;
  createdAt: Date;
}

export interface LocalCurrentFactRecord {
  factId: string;
  memoryId: string;
  evidenceId: string;
  content: string;
  recordedAt: Date;
}

export interface LocalFactRelationRecord {
  memoryId: string;
  predecessorFactId: string;
  successorFactId: string;
  relationType: 'SUPERSEDES';
}

export interface LocalSyncOutboxRecord {
  eventId: string;
  memoryId: string;
  envelope: SyncEventEnvelope;
  status: 'PENDING' | 'RETRY_WAIT' | 'BLOCKED';
  attempt: number;
  nextAttemptAt: Date | null;
  lastErrorCode: string | null;
}

export interface LocalSyncStateRecord {
  key: 'clientInstanceId' | 'confirmedCursor' | 'bootstrap';
  value: unknown;
}

export interface LocalSyncConflictRecord {
  memoryId: string;
  baselineFactId: string;
  candidateFactIds: string[];
  status: 'OPEN' | 'RESOLVED';
  resolutionFactId: string | null;
  updatedAt: Date;
}

export interface LocalBootstrapStagingRecord {
  bootstrapToken: string;
  recordKey: string;
  record: SyncCanonicalRecord;
}

function upgradeToV1(db: IDBDatabase): void {
  db.createObjectStore('memories', { keyPath: 'id' });
  db.createObjectStore('evidence', { keyPath: 'id' });
  db.createObjectStore('ledgerEvents', { keyPath: 'id' });
  db.createObjectStore('facts', { keyPath: 'id' });
  db.createObjectStore('currentFacts', { keyPath: 'factId' });
}

function upgradeToV2(transaction: IDBTransaction): void {
  transaction.objectStore('evidence').createIndex('memoryId', 'memoryId');
  transaction.objectStore('ledgerEvents').createIndex('memoryId', 'memoryId');
  transaction.objectStore('ledgerEvents').createIndex('factId', 'factId');
  transaction.objectStore('ledgerEvents').createIndex('supersedesFactId', 'supersedesFactId');
  transaction.objectStore('facts').createIndex('memoryId', 'memoryId');
  transaction.objectStore('facts').createIndex('supersedesFactId', 'supersedesFactId', {
    unique: true,
  });
  transaction.objectStore('currentFacts').createIndex('memoryId', 'memoryId');
}

function upgradeToV3(db: IDBDatabase, transaction: IDBTransaction): void {
  const facts = transaction.objectStore('facts');
  if (facts.indexNames.contains('supersedesFactId')) {
    facts.deleteIndex('supersedesFactId');
  }

  const relations = db.createObjectStore('factRelations', {
    keyPath: ['predecessorFactId', 'successorFactId'],
  });
  relations.createIndex('memoryId', 'memoryId');
  relations.createIndex('predecessorFactId', 'predecessorFactId');
  relations.createIndex('successorFactId', 'successorFactId');

  const outbox = db.createObjectStore('syncOutbox', { keyPath: 'eventId' });
  outbox.createIndex('memoryId', 'memoryId');
  outbox.createIndex('status', 'status');
  outbox.createIndex('nextAttemptAt', 'nextAttemptAt');

  db.createObjectStore('syncState', { keyPath: 'key' });

  const conflicts = db.createObjectStore('syncConflicts', { keyPath: 'memoryId' });
  conflicts.createIndex('status', 'status');

  const staging = db.createObjectStore('bootstrapStaging', {
    keyPath: ['bootstrapToken', 'recordKey'],
  });
  staging.createIndex('bootstrapToken', 'bootstrapToken');

  facts.openCursor().onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cursor) {
      return;
    }
    const fact = cursor.value as LocalFactRecord;
    if (fact.supersedesFactId) {
      relations.add({
        memoryId: fact.memoryId,
        predecessorFactId: fact.supersedesFactId,
        successorFactId: fact.id,
        relationType: 'SUPERSEDES',
      } satisfies LocalFactRelationRecord);
    }
    cursor.continue();
  };
}

export function applyMdpLocalUpgrade(
  db: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  targetVersion: number,
): void {
  if (oldVersion < 1 && targetVersion >= 1) {
    upgradeToV1(db);
  }
  if (oldVersion < 2 && targetVersion >= 2) {
    upgradeToV2(transaction);
  }
  if (oldVersion < 3 && targetVersion >= 3) {
    upgradeToV3(db, transaction);
  }
}

export function openMdpLocalDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(MDP_LOCAL_DB_NAME, MDP_LOCAL_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (!transaction) {
        reject(new Error('IndexedDB upgrade transaction is unavailable'));
        return;
      }

      try {
        applyMdpLocalUpgrade(
          request.result,
          transaction,
          event.oldVersion,
          event.newVersion ?? MDP_LOCAL_DB_VERSION,
        );
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    request.onsuccess = () => resolve(request.result);
  });
}

export function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}
