// @vitest-environment node
import type { SyncCanonicalRecord } from '@mdp/contracts';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openMdpLocalDatabase, requestAsPromise, transactionDone } from './mdp-local-db.js';
import { IndexedDbSyncStore } from './indexeddb-sync-store.js';

const expiredToken = '0198d300-0000-7000-8000-000000000001';
const retainedToken = '0198d300-0000-7000-8000-000000000002';

const record: SyncCanonicalRecord = {
  kind: 'memory',
  id: '0198d300-0000-7000-8000-000000000003',
  recordedAt: '2026-08-20T09:30:00.000Z',
  occurredAt: null,
  temporalPrecision: 'unknown',
};

async function countToken(factory: IDBFactory, token: string): Promise<number> {
  const db = await openMdpLocalDatabase(factory);
  const transaction = db.transaction('bootstrapStaging');
  const done = transactionDone(transaction);
  const count = await requestAsPromise<number>(
    transaction.objectStore('bootstrapStaging').index('bootstrapToken').count(token),
  );
  await done;
  db.close();
  return count;
}

describe('IndexedDbSyncStore bootstrap discard', () => {
  it('discards only staging rows for the expired bootstrap token', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbSyncStore({ factory });
    await store.stageBootstrapPage(expiredToken, [record]);
    await store.stageBootstrapPage(retainedToken, [
      { ...record, id: '0198d300-0000-7000-8000-000000000004' },
    ]);

    await store.discardBootstrap(expiredToken);

    await expect(countToken(factory, expiredToken)).resolves.toBe(0);
    await expect(countToken(factory, retainedToken)).resolves.toBe(1);
  });
});
