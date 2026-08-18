// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { SyncEventEnvelope, SyncPullResponse } from '@mdp/contracts';
import { MemoryRepositoryError } from '../memory-repository.js';
import {
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
  type LocalCurrentFactRecord,
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

function correctionEnvelope(input: {
  evidenceId: string;
  eventId: string;
  factId: string;
  text: string;
  createdAt: string;
}): SyncEventEnvelope {
  return {
    protocolVersion: 1,
    eventId: input.eventId,
    eventType: 'MEMORY_CORRECTED',
    memoryId,
    predecessorFactIds: [factId],
    records: [
      envelope.records[0]!,
      {
        kind: 'evidence',
        id: input.evidenceId,
        memoryId,
        evidenceKind: 'text',
        content: input.text,
        createdAt: input.createdAt,
      },
      {
        kind: 'ledgerEvent',
        id: input.eventId,
        memoryId,
        evidenceId: input.evidenceId,
        factId: input.factId,
        supersedesFactId: factId,
        eventType: 'MEMORY_CORRECTED',
        reason: null,
        createdAt: input.createdAt,
      },
      {
        kind: 'fact',
        id: input.factId,
        memoryId,
        evidenceId: input.evidenceId,
        factKind: 'autobiographical_statement',
        content: input.text,
        createdAt: input.createdAt,
      },
      {
        kind: 'factRelation',
        memoryId,
        predecessorFactId: factId,
        successorFactId: input.factId,
        relationType: 'SUPERSEDES',
      },
    ],
  };
}

function pullPage(events: SyncEventEnvelope[], nextCursor: string): SyncPullResponse {
  return {
    protocolVersion: 1,
    events: events.map((event, index) => ({
      sequence: String(Number(nextCursor) - events.length + index + 1),
      envelope: event,
    })),
    nextCursor,
    hasMore: false,
  };
}

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

describe('IndexedDbSyncStore atomic pull application', () => {
  it('commits canonical rows and projection before advancing the confirmed cursor', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbSyncStore({ factory });

    await store.applyPullPage(pullPage([envelope], '1'));

    await expect(store.getConfirmedCursor()).resolves.toBe('1');
    const db = await openMdpLocalDatabase(factory);
    const tx = db.transaction(['memories', 'evidence', 'ledgerEvents', 'facts', 'currentFacts']);
    const done = transactionDone(tx);
    const [memory, evidence, ledger, fact, current] = await Promise.all([
      requestAsPromise(tx.objectStore('memories').get(memoryId)),
      requestAsPromise(tx.objectStore('evidence').get(evidenceId)),
      requestAsPromise(tx.objectStore('ledgerEvents').get(eventId)),
      requestAsPromise(tx.objectStore('facts').get(factId)),
      requestAsPromise<LocalCurrentFactRecord[]>(
        tx.objectStore('currentFacts').index('memoryId').getAll(memoryId),
      ),
    ]);
    await done;
    db.close();

    expect(memory).toBeTruthy();
    expect(evidence).toBeTruthy();
    expect(ledger).toBeTruthy();
    expect(fact).toBeTruthy();
    expect(current).toHaveLength(1);
    expect(current[0]?.factId).toBe(factId);
  });

  it('fails closed on immutable content mismatch and leaves cursor and new rows unchanged', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbSyncStore({ factory });
    await store.applyPullPage(pullPage([envelope], '1'));

    const divergent = correctionEnvelope({
      evidenceId: '0198d001-0000-7000-8000-000000000030',
      eventId: '0198d001-0000-7000-8000-000000000031',
      factId: '0198d001-0000-7000-8000-000000000032',
      text: 'Correção que não deve ser aplicada.',
      createdAt: '2026-08-18T09:02:00.000Z',
    });
    divergent.records[0] = {
      kind: 'memory',
      id: memoryId,
      recordedAt: '2026-08-18T09:00:01.000Z',
      occurredAt: null,
      temporalPrecision: 'unknown',
    };

    await expect(store.applyPullPage(pullPage([divergent], '2'))).rejects.toEqual(
      expect.objectContaining<Partial<MemoryRepositoryError>>({
        code: 'LOCAL_DATA_INTEGRITY_ERROR',
      }),
    );
    await expect(store.getConfirmedCursor()).resolves.toBe('1');

    const db = await openMdpLocalDatabase(factory);
    const tx = db.transaction('evidence');
    const done = transactionDone(tx);
    const rejectedEvidence = await requestAsPromise(
      tx.objectStore('evidence').get('0198d001-0000-7000-8000-000000000030'),
    );
    await done;
    db.close();
    expect(rejectedEvidence).toBeUndefined();
  });

  it('reprojects two accepted successors of the same baseline as an explicit conflict', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbSyncStore({ factory });
    await store.applyPullPage(pullPage([envelope], '1'));

    const branchB = correctionEnvelope({
      evidenceId: '0198d001-0000-7000-8000-000000000010',
      eventId: '0198d001-0000-7000-8000-000000000011',
      factId: '0198d001-0000-7000-8000-000000000012',
      text: 'Ramo sintético B.',
      createdAt: '2026-08-18T09:03:00.000Z',
    });
    const branchC = correctionEnvelope({
      evidenceId: '0198d001-0000-7000-8000-000000000020',
      eventId: '0198d001-0000-7000-8000-000000000021',
      factId: '0198d001-0000-7000-8000-000000000022',
      text: 'Ramo sintético C.',
      createdAt: '2026-08-18T09:04:00.000Z',
    });

    await store.applyPullPage(pullPage([branchB, branchC], '3'));

    await expect(store.getConfirmedCursor()).resolves.toBe('3');
    await expect(store.getMemoryStatus(memoryId)).resolves.toBe('CONFLICT');
    const db = await openMdpLocalDatabase(factory);
    const tx = db.transaction(['currentFacts', 'syncConflicts']);
    const done = transactionDone(tx);
    const [current, conflict] = await Promise.all([
      requestAsPromise<LocalCurrentFactRecord[]>(
        tx.objectStore('currentFacts').index('memoryId').getAll(memoryId),
      ),
      requestAsPromise<LocalSyncConflictRecord | undefined>(
        tx.objectStore('syncConflicts').get(memoryId),
      ),
    ]);
    await done;
    db.close();

    expect(current).toEqual([]);
    expect(conflict).toMatchObject({
      baselineFactId: factId,
      candidateFactIds: [
        '0198d001-0000-7000-8000-000000000012',
        '0198d001-0000-7000-8000-000000000022',
      ],
      status: 'OPEN',
    });
  });
});
