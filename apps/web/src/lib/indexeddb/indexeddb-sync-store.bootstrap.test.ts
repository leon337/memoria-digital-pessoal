// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { SyncEventEnvelope } from '@mdp/contracts';
import { MemoryRepositoryError } from '../memory-repository.js';
import {
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
  type LocalCurrentFactRecord,
  type LocalMemoryRecord,
  type LocalSyncOutboxRecord,
} from './mdp-local-db.js';
import { IndexedDbSyncStore } from './indexeddb-sync-store.js';

const token = '0198d100-0000-7000-8000-000000000001';
const memoryId = '0198d100-0000-7000-8000-000000000002';
const evidenceId = '0198d100-0000-7000-8000-000000000003';
const eventId = '0198d100-0000-7000-8000-000000000004';
const factId = '0198d100-0000-7000-8000-000000000005';

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
      recordedAt: '2026-08-18T10:10:00.000Z',
      occurredAt: null,
      temporalPrecision: 'unknown',
    },
    {
      kind: 'evidence',
      id: evidenceId,
      memoryId,
      evidenceKind: 'text',
      content: 'Bootstrap sintético controlado.',
      createdAt: '2026-08-18T10:10:00.000Z',
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
      createdAt: '2026-08-18T10:10:00.000Z',
    },
    {
      kind: 'fact',
      id: factId,
      memoryId,
      evidenceId,
      factKind: 'autobiographical_statement',
      content: 'Bootstrap sintético controlado.',
      createdAt: '2026-08-18T10:10:00.000Z',
    },
  ],
};

async function seedPending(factory: IDBFactory): Promise<LocalSyncOutboxRecord> {
  const row: LocalSyncOutboxRecord = {
    eventId: '0198d100-0000-7000-8000-000000000010',
    memoryId: '0198d100-0000-7000-8000-000000000011',
    envelope: {
      ...envelope,
      eventId: '0198d100-0000-7000-8000-000000000010',
      memoryId: '0198d100-0000-7000-8000-000000000011',
    },
    status: 'PENDING',
    attempt: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
  };
  const db = await openMdpLocalDatabase(factory);
  const tx = db.transaction('syncOutbox', 'readwrite');
  tx.objectStore('syncOutbox').add(row);
  await transactionDone(tx);
  db.close();
  return row;
}

async function stagingCount(factory: IDBFactory): Promise<number> {
  const db = await openMdpLocalDatabase(factory);
  const tx = db.transaction('bootstrapStaging');
  const done = transactionDone(tx);
  const count = await requestAsPromise<number>(
    tx.objectStore('bootstrapStaging').index('bootstrapToken').count(token),
  );
  await done;
  db.close();
  return count;
}

describe('IndexedDbSyncStore bootstrap staging and promotion', () => {
  it('stages bootstrap pages without mutating canonical rows or the confirmed cursor', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbSyncStore({ factory });

    await store.stageBootstrapPage(token, envelope.records);

    await expect(store.getConfirmedCursor()).resolves.toBeNull();
    await expect(stagingCount(factory)).resolves.toBe(envelope.records.length);
    const db = await openMdpLocalDatabase(factory);
    const tx = db.transaction('memories');
    const done = transactionDone(tx);
    const memory = await requestAsPromise(tx.objectStore('memories').get(memoryId));
    await done;
    db.close();
    expect(memory).toBeUndefined();
  });

  it('promotes one fixed snapshot atomically and preserves local pending outbox rows', async () => {
    const factory = new IDBFactory();
    const pending = await seedPending(factory);
    const store = new IndexedDbSyncStore({ factory });
    await store.stageBootstrapPage(token, envelope.records);

    await store.promoteBootstrap(token, '17');

    await expect(store.getConfirmedCursor()).resolves.toBe('17');
    await expect(stagingCount(factory)).resolves.toBe(0);
    const db = await openMdpLocalDatabase(factory);
    const tx = db.transaction(['memories', 'currentFacts', 'syncOutbox']);
    const done = transactionDone(tx);
    const [memory, current, preservedPending] = await Promise.all([
      requestAsPromise<LocalMemoryRecord | undefined>(tx.objectStore('memories').get(memoryId)),
      requestAsPromise<LocalCurrentFactRecord[]>(
        tx.objectStore('currentFacts').index('memoryId').getAll(memoryId),
      ),
      requestAsPromise<LocalSyncOutboxRecord | undefined>(
        tx.objectStore('syncOutbox').get(pending.eventId),
      ),
    ]);
    await done;
    db.close();

    expect(memory?.id).toBe(memoryId);
    expect(current).toHaveLength(1);
    expect(current[0]?.factId).toBe(factId);
    expect(preservedPending).toEqual(pending);
  });

  it('rolls promotion back on immutable mismatch while preserving staging and pending work', async () => {
    const factory = new IDBFactory();
    const pending = await seedPending(factory);
    const db = await openMdpLocalDatabase(factory);
    const seed = db.transaction('memories', 'readwrite');
    seed.objectStore('memories').add({
      id: memoryId,
      recordedAt: new Date('2026-08-18T10:10:01.000Z'),
      occurredAt: null,
      temporalPrecision: 'unknown',
    } satisfies LocalMemoryRecord);
    await transactionDone(seed);
    db.close();

    const store = new IndexedDbSyncStore({ factory });
    await store.stageBootstrapPage(token, envelope.records);

    await expect(store.promoteBootstrap(token, '17')).rejects.toEqual(
      expect.objectContaining<Partial<MemoryRepositoryError>>({
        code: 'LOCAL_DATA_INTEGRITY_ERROR',
      }),
    );
    await expect(store.getConfirmedCursor()).resolves.toBeNull();
    await expect(stagingCount(factory)).resolves.toBe(envelope.records.length);

    const verifyDb = await openMdpLocalDatabase(factory);
    const verify = verifyDb.transaction(['evidence', 'syncOutbox']);
    const done = transactionDone(verify);
    const [rejectedEvidence, preservedPending] = await Promise.all([
      requestAsPromise(verify.objectStore('evidence').get(evidenceId)),
      requestAsPromise<LocalSyncOutboxRecord | undefined>(
        verify.objectStore('syncOutbox').get(pending.eventId),
      ),
    ]);
    await done;
    verifyDb.close();

    expect(rejectedEvidence).toBeUndefined();
    expect(preservedPending).toEqual(pending);
  });
});
