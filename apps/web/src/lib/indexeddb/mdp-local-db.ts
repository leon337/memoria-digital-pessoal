export const MDP_LOCAL_DB_NAME = 'mdp-local';
export const MDP_LOCAL_DB_VERSION = 2;
export const PRODUCT_STORES = [
  'memories',
  'evidence',
  'ledgerEvents',
  'facts',
  'currentFacts',
] as const;

export type ProductStoreName = (typeof PRODUCT_STORES)[number];

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
  type: 'MEMORY_CREATED' | 'MEMORY_CORRECTED';
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
