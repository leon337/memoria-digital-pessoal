import type { SyncPushEventResult } from '@mdp/contracts';
import { createId } from '@mdp/shared';
import { MemoryRepositoryError } from '../memory-repository.js';
import {
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
  type LocalSyncConflictRecord,
  type LocalSyncOutboxRecord,
  type LocalSyncStateRecord,
} from './mdp-local-db.js';

export type LocalMemorySyncStatus = 'SYNCED' | 'PENDING' | 'BLOCKED' | 'CONFLICT';

interface IndexedDbSyncStoreDependencies {
  factory?: IDBFactory;
  createId?: () => string;
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

  async applyPushResults(results: SyncPushEventResult[], now: Date): Promise<void> {
    void now;
    const db = await this.database();
    const transaction = db.transaction('syncOutbox', 'readwrite');
    const done = transactionDone(transaction);
    const outbox = transaction.objectStore('syncOutbox');

    for (const result of results) {
      const row = await requestAsPromise<LocalSyncOutboxRecord | undefined>(outbox.get(result.eventId));
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
