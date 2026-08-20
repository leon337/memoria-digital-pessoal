// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { SyncEventEnvelope } from '@mdp/contracts';
import {
  openMdpLocalDatabase,
  transactionDone,
  type LocalSyncConflictRecord,
  type LocalSyncOutboxRecord,
} from './mdp-local-db.js';
import { IndexedDbSyncStore } from './indexeddb-sync-store.js';

function envelope(eventId: string, memoryId: string): SyncEventEnvelope {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'MEMORY_CREATED',
    memoryId,
    predecessorFactIds: [],
    records: [],
  };
}

function outbox(input: {
  eventId: string;
  memoryId: string;
  status: LocalSyncOutboxRecord['status'];
  nextAttemptAt?: Date | null;
}): LocalSyncOutboxRecord {
  return {
    eventId: input.eventId,
    memoryId: input.memoryId,
    envelope: envelope(input.eventId, input.memoryId),
    status: input.status,
    attempt: input.status === 'RETRY_WAIT' ? 1 : 0,
    nextAttemptAt: input.nextAttemptAt ?? null,
    lastErrorCode: null,
  };
}

async function seed(
  factory: IDBFactory,
  rows: LocalSyncOutboxRecord[],
  conflict?: LocalSyncConflictRecord,
): Promise<void> {
  const db = await openMdpLocalDatabase(factory);
  const tx = db.transaction(['syncOutbox', 'syncConflicts'], 'readwrite');
  for (const row of rows) tx.objectStore('syncOutbox').add(row);
  if (conflict) tx.objectStore('syncConflicts').put(conflict);
  await transactionDone(tx);
  db.close();
}

describe('IndexedDbSyncStore operational queue', () => {
  it('lists only eligible pending work with deterministic batching', async () => {
    const factory = new IDBFactory();
    const now = new Date('2026-08-18T10:30:00.000Z');
    await seed(factory, [
      outbox({
        eventId: '0198d200-0000-7000-8000-000000000001',
        memoryId: '0198d200-0000-7000-8000-000000000101',
        status: 'PENDING',
      }),
      outbox({
        eventId: '0198d200-0000-7000-8000-000000000002',
        memoryId: '0198d200-0000-7000-8000-000000000102',
        status: 'RETRY_WAIT',
        nextAttemptAt: new Date('2026-08-18T10:29:59.000Z'),
      }),
      outbox({
        eventId: '0198d200-0000-7000-8000-000000000003',
        memoryId: '0198d200-0000-7000-8000-000000000103',
        status: 'RETRY_WAIT',
        nextAttemptAt: new Date('2026-08-18T10:31:00.000Z'),
      }),
      outbox({
        eventId: '0198d200-0000-7000-8000-000000000004',
        memoryId: '0198d200-0000-7000-8000-000000000104',
        status: 'BLOCKED',
      }),
    ]);
    const store = new IndexedDbSyncStore({ factory });

    const eligible = await store.listPending(10, now);
    const first = await store.listPending(1, now);

    expect(eligible.map((row) => row.eventId)).toEqual([
      '0198d200-0000-7000-8000-000000000001',
      '0198d200-0000-7000-8000-000000000002',
    ]);
    expect(first.map((row) => row.eventId)).toEqual(['0198d200-0000-7000-8000-000000000001']);
  });

  it('reports global status with conflict then blocked then pending precedence', async () => {
    const factory = new IDBFactory();
    const conflictMemoryId = '0198d200-0000-7000-8000-000000000201';
    await seed(
      factory,
      [
        outbox({
          eventId: '0198d200-0000-7000-8000-000000000011',
          memoryId: '0198d200-0000-7000-8000-000000000211',
          status: 'BLOCKED',
        }),
        outbox({
          eventId: '0198d200-0000-7000-8000-000000000012',
          memoryId: '0198d200-0000-7000-8000-000000000212',
          status: 'PENDING',
        }),
      ],
      {
        memoryId: conflictMemoryId,
        baselineFactId: '0198d200-0000-7000-8000-000000000221',
        candidateFactIds: [
          '0198d200-0000-7000-8000-000000000222',
          '0198d200-0000-7000-8000-000000000223',
        ],
        status: 'OPEN',
        resolutionFactId: null,
        updatedAt: new Date('2026-08-18T10:30:00.000Z'),
      },
    );
    const store = new IndexedDbSyncStore({ factory });

    await expect(store.getGlobalStatus()).resolves.toBe('CONFLICT');

    const db = await openMdpLocalDatabase(factory);
    let tx = db.transaction('syncConflicts', 'readwrite');
    tx.objectStore('syncConflicts').delete(conflictMemoryId);
    await transactionDone(tx);
    await expect(store.getGlobalStatus()).resolves.toBe('BLOCKED');

    tx = db.transaction('syncOutbox', 'readwrite');
    tx.objectStore('syncOutbox').delete('0198d200-0000-7000-8000-000000000011');
    await transactionDone(tx);
    await expect(store.getGlobalStatus()).resolves.toBe('PENDING');

    tx = db.transaction('syncOutbox', 'readwrite');
    tx.objectStore('syncOutbox').clear();
    await transactionDone(tx);
    db.close();
    await expect(store.getGlobalStatus()).resolves.toBe('SYNCED');
  });
});
