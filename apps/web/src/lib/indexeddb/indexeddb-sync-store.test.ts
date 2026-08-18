// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { SyncEventEnvelope } from '@mdp/contracts';
import {
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
  type LocalSyncConflictRecord,
  type LocalSyncOutboxRecord,
} from './mdp-local-db.js';
import { IndexedDbSyncStore } from './indexeddb-sync-store.js';

const memoryId = '0198d001-0000-7000-8000-000000000001';
const evidenceId = '0198d001-0000-7000-8000-000000000002';
const eventId = '0198d001-0000-7000-8000-000000000003';
const factId = '0198d001-0000-7000-8000-000000000004';
const clientInstanceId = '0198d001-0000-7000-8000-000000000005';

const envelope: SyncEventEnvelope = {
  protocolVersion: 1,
  eventId,
  eventType: 'MEMORY_CREATED',
  memoryId,
  predecessorFactIds: [],
  records: [
    {
      kind: 'memory',
      id: memoryId,
      recordedAt: '2026-08-18T09:00:00.000Z',
      occurredAt: null,
      temporalPrecision: 'unknown',
    },
    {
      kind: 'evidence',
      id: evidenceId,
      memoryId,
      evidenceKind: 'text',
      content: 'Memória sintética para teste de sincronização.',
      createdAt: '2026-08-18T09:00:00.000Z',
    },
    {
      kind: 'ledgerEvent',
      id: eventId,
      memoryId,
      evidenceId,
      factId: null,
      supersedesFactId: null,
      eventType: 'MEMORY_CREATED',
      reason: null,
      createdAt: '2026-08-18T09:00:00.000Z',
    },
    {
      kind: 'fact',
      id: factId,
      memoryId,
      evidenceId,
      factKind: 'autobiographical_statement',
      content: 'Memória sintética para teste de sincronização.',
      createdAt: '2026-08-18T09:00:00.000Z',
    },
  ],
};

async function seedOutbox(factory: IDBFactory): Promise<void> {
  const db = await openMdpLocalDatabase(factory);
  const tx = db.transaction(['syncOutbox', 'syncConflicts'], 'readwrite');
  tx.objectStore('syncOutbox').add({
    eventId,
    memoryId,
    envelope,
    status: 'PENDING',
    attempt: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
  } satisfies LocalSyncOutboxRecord);
  tx.objectStore('syncConflicts').put({
    memoryId,
    baselineFactId: factId,
    candidateFactIds: [factId, '0198d001-0000-7000-8000-000000000006'],
    status: 'OPEN',
    resolutionFactId: null,
    updatedAt: new Date('2026-08-18T09:00:00.000Z'),
  } satisfies LocalSyncConflictRecord);
  await transactionDone(tx);
  db.close();
}

async function pending(factory: IDBFactory): Promise<LocalSyncOutboxRecord | undefined> {
  const db = await openMdpLocalDatabase(factory);
  const tx = db.transaction('syncOutbox', 'readonly');
  const done = transactionDone(tx);
  const row = await requestAsPromise<LocalSyncOutboxRecord | undefined>(
    tx.objectStore('syncOutbox').get(eventId),
  );
  await done;
  db.close();
  return row;
}

describe('IndexedDbSyncStore identity and push acknowledgements', () => {
  it('creates one persistent UUID v7 client instance id', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbSyncStore({ factory, createId: () => clientInstanceId });

    const first = await store.getOrCreateClientInstanceId();
    const second = await store.getOrCreateClientInstanceId();

    expect(first[14]).toBe('7');
    expect(second).toBe(first);
  });

  it('treats CONFLICT as a durable acknowledgement and removes the pending event', async () => {
    const factory = new IDBFactory();
    await seedOutbox(factory);
    const store = new IndexedDbSyncStore({ factory });

    await store.applyPushResults(
      [{ eventId, status: 'CONFLICT' }],
      new Date('2026-08-18T09:01:00.000Z'),
    );

    await expect(pending(factory)).resolves.toBeUndefined();
    await expect(store.getMemoryStatus(memoryId)).resolves.toBe('CONFLICT');
  });
});
