// @vitest-environment node
import { syncEventEnvelopeSchema, type SyncEventEnvelope } from '@mdp/contracts';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
  type LocalFactRelationRecord,
  type LocalSyncConflictRecord,
  type LocalSyncOutboxRecord,
} from './mdp-local-db.js';
import { IndexedDbMemoryRepository } from './indexeddb-memory-repository.js';

function ids(...values: string[]): () => string {
  const queue = [...values];
  return () => {
    const value = queue.shift();
    if (value === undefined) throw new Error('test id queue exhausted');
    return value;
  };
}

function times(...values: string[]): () => Date {
  const queue = [...values];
  return () => {
    const value = queue.shift();
    if (value === undefined) throw new Error('test time queue exhausted');
    return new Date(value);
  };
}

async function readAll<T>(factory: IDBFactory, storeName: string): Promise<T[]> {
  const db = await openMdpLocalDatabase(factory);
  const tx = db.transaction(storeName, 'readonly');
  const done = transactionDone(tx);
  const rows = await requestAsPromise<T[]>(tx.objectStore(storeName).getAll());
  await done;
  db.close();
  return rows;
}

const root = {
  memoryId: '0198c001-0000-7000-8000-000000000001',
  evidenceId: '0198c001-0000-7000-8000-000000000002',
  eventId: '0198c001-0000-7000-8000-000000000003',
  factId: '0198c001-0000-7000-8000-000000000004',
} as const;
const branchB = {
  evidenceId: '0198c001-0000-7000-8000-000000000005',
  eventId: '0198c001-0000-7000-8000-000000000006',
  factId: '0198c001-0000-7000-8000-000000000007',
} as const;
const branchC = {
  evidenceId: '0198c001-0000-7000-8000-000000000008',
  eventId: '0198c001-0000-7000-8000-000000000009',
  factId: '0198c001-0000-7000-8000-00000000000a',
} as const;
const resolution = {
  evidenceId: '0198c001-0000-7000-8000-00000000000b',
  eventId: '0198c001-0000-7000-8000-00000000000c',
  factId: '0198c001-0000-7000-8000-00000000000d',
} as const;

describe('IndexedDbMemoryRepository Slice 04 synchronization writes', () => {
  it('enqueues protocol-valid create and correction events with causal relation in the same database', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbMemoryRepository({
      factory,
      now: times('2026-08-18T08:00:00.000Z', '2026-08-18T08:01:00.000Z'),
      createId: ids(
        root.memoryId,
        root.evidenceId,
        root.eventId,
        root.factId,
        branchB.evidenceId,
        branchB.eventId,
        branchB.factId,
      ),
    });

    await repository.create('Base sintética para sincronização.');
    let outbox = await readAll<LocalSyncOutboxRecord>(factory, 'syncOutbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      eventId: root.eventId,
      memoryId: root.memoryId,
      status: 'PENDING',
      attempt: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      envelope: {
        protocolVersion: 1,
        eventId: root.eventId,
        eventType: 'MEMORY_CREATED',
        memoryId: root.memoryId,
        predecessorFactIds: [],
      },
    });
    expect(() => syncEventEnvelopeSchema.parse(outbox[0]!.envelope)).not.toThrow();
    await expect(readAll(factory, 'factRelations')).resolves.toHaveLength(0);

    await repository.correct(root.memoryId, {
      text: 'Base sintética corrigida.',
      expectedCurrentFactId: root.factId,
      reason: 'Correção controlada',
    });

    outbox = await readAll<LocalSyncOutboxRecord>(factory, 'syncOutbox');
    expect(outbox).toHaveLength(2);
    const correction = outbox.find((row) => row.eventId === branchB.eventId);
    expect(correction).toMatchObject({
      memoryId: root.memoryId,
      status: 'PENDING',
      envelope: {
        protocolVersion: 1,
        eventId: branchB.eventId,
        eventType: 'MEMORY_CORRECTED',
        memoryId: root.memoryId,
        predecessorFactIds: [root.factId],
      },
    });
    expect(() => syncEventEnvelopeSchema.parse(correction!.envelope)).not.toThrow();
    await expect(readAll<LocalFactRelationRecord>(factory, 'factRelations')).resolves.toEqual([
      {
        memoryId: root.memoryId,
        predecessorFactId: root.factId,
        successorFactId: branchB.factId,
        relationType: 'SUPERSEDES',
      },
    ]);
  });

  it('rolls back the complete correction when the final syncOutbox add fails', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbMemoryRepository({
      factory,
      now: times('2026-08-18T08:00:00.000Z', '2026-08-18T08:01:00.000Z'),
      createId: ids(
        root.memoryId,
        root.evidenceId,
        root.eventId,
        root.factId,
        branchB.evidenceId,
        branchB.eventId,
        branchB.factId,
      ),
    });
    await repository.create('Histórico sintético preservado.');
    const historyBefore = await repository.history(root.memoryId);

    const db = await openMdpLocalDatabase(factory);
    const reserve = db.transaction('syncOutbox', 'readwrite');
    reserve.objectStore('syncOutbox').add({
      eventId: branchB.eventId,
      memoryId: root.memoryId,
      envelope: { reserved: true },
      status: 'PENDING',
      attempt: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
    });
    await transactionDone(reserve);
    db.close();

    await expect(
      repository.correct(root.memoryId, {
        text: 'Esta correção deve sofrer rollback.',
        expectedCurrentFactId: root.factId,
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_DATA_INTEGRITY_ERROR' });

    await expect(repository.history(root.memoryId)).resolves.toEqual(historyBefore);
    await expect(readAll<LocalFactRelationRecord>(factory, 'factRelations')).resolves.toHaveLength(
      0,
    );
  });

  it('exposes an open causal conflict and resolves the exact candidate set append-only', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbMemoryRepository({
      factory,
      now: times(
        '2026-08-18T08:00:00.000Z',
        '2026-08-18T08:01:00.000Z',
        '2026-08-18T08:03:00.000Z',
      ),
      createId: ids(
        root.memoryId,
        root.evidenceId,
        root.eventId,
        root.factId,
        branchB.evidenceId,
        branchB.eventId,
        branchB.factId,
        resolution.evidenceId,
        resolution.eventId,
        resolution.factId,
      ),
    });
    await repository.create('Base sintética do conflito.');
    await repository.correct(root.memoryId, {
      text: 'Ramo sintético B.',
      expectedCurrentFactId: root.factId,
    });

    const db = await openMdpLocalDatabase(factory);
    const seed = db.transaction(
      ['evidence', 'ledgerEvents', 'facts', 'currentFacts', 'factRelations', 'syncConflicts'],
      'readwrite',
    );
    seed.objectStore('evidence').add({
      id: branchC.evidenceId,
      memoryId: root.memoryId,
      kind: 'text',
      content: 'Ramo sintético C.',
      createdAt: new Date('2026-08-18T08:02:00.000Z'),
    });
    seed.objectStore('facts').add({
      id: branchC.factId,
      memoryId: root.memoryId,
      evidenceId: branchC.evidenceId,
      kind: 'autobiographical_statement',
      content: 'Ramo sintético C.',
      supersedesFactId: root.factId,
      createdAt: new Date('2026-08-18T08:02:00.000Z'),
    });
    seed.objectStore('ledgerEvents').add({
      id: branchC.eventId,
      memoryId: root.memoryId,
      evidenceId: branchC.evidenceId,
      factId: branchC.factId,
      supersedesFactId: root.factId,
      type: 'MEMORY_CORRECTED',
      reason: null,
      createdAt: new Date('2026-08-18T08:02:00.000Z'),
    });
    seed.objectStore('factRelations').add({
      memoryId: root.memoryId,
      predecessorFactId: root.factId,
      successorFactId: branchC.factId,
      relationType: 'SUPERSEDES',
    });
    seed.objectStore('currentFacts').delete(branchB.factId);
    seed.objectStore('syncConflicts').put({
      memoryId: root.memoryId,
      baselineFactId: root.factId,
      candidateFactIds: [branchB.factId, branchC.factId],
      status: 'OPEN',
      resolutionFactId: null,
      updatedAt: new Date('2026-08-18T08:02:00.000Z'),
    } satisfies LocalSyncConflictRecord);
    await transactionDone(seed);
    db.close();

    await expect(repository.query('Ramo sintético')).resolves.toEqual({
      status: 'CONFLICT',
      answer: null,
      provenance: null,
      conflict: {
        memoryId: root.memoryId,
        baseline: {
          factId: root.factId,
          evidenceId: root.evidenceId,
          content: 'Base sintética do conflito.',
        },
        candidates: [
          {
            factId: branchB.factId,
            evidenceId: branchB.evidenceId,
            content: 'Ramo sintético B.',
          },
          {
            factId: branchC.factId,
            evidenceId: branchC.evidenceId,
            content: 'Ramo sintético C.',
          },
        ],
      },
    });

    await expect(
      repository.correct(root.memoryId, {
        text: 'Correção linear proibida durante conflito.',
        expectedCurrentFactId: branchB.factId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT_REQUIRES_RESOLUTION' });

    await expect(
      repository.resolveConflict(root.memoryId, {
        expectedCandidateFactIds: [branchC.factId, branchB.factId],
        text: 'Versão sintética resolvida.',
        reason: 'Resolução controlada',
      }),
    ).resolves.toMatchObject({
      memoryId: root.memoryId,
      current: {
        factId: resolution.factId,
        evidenceId: resolution.evidenceId,
        content: 'Versão sintética resolvida.',
      },
      correction: { eventId: resolution.eventId, reason: 'Resolução controlada' },
    });

    const conflictRows = await readAll<LocalSyncConflictRecord>(factory, 'syncConflicts');
    expect(conflictRows).toEqual([
      expect.objectContaining({
        memoryId: root.memoryId,
        candidateFactIds: [branchB.factId, branchC.factId],
        status: 'RESOLVED',
        resolutionFactId: resolution.factId,
      }),
    ]);

    const relations = await readAll<LocalFactRelationRecord>(factory, 'factRelations');
    expect(relations).toEqual(
      expect.arrayContaining([
        {
          memoryId: root.memoryId,
          predecessorFactId: root.factId,
          successorFactId: branchB.factId,
          relationType: 'SUPERSEDES',
        },
        {
          memoryId: root.memoryId,
          predecessorFactId: root.factId,
          successorFactId: branchC.factId,
          relationType: 'SUPERSEDES',
        },
        {
          memoryId: root.memoryId,
          predecessorFactId: branchB.factId,
          successorFactId: resolution.factId,
          relationType: 'SUPERSEDES',
        },
        {
          memoryId: root.memoryId,
          predecessorFactId: branchC.factId,
          successorFactId: resolution.factId,
          relationType: 'SUPERSEDES',
        },
      ]),
    );

    const outbox = await readAll<LocalSyncOutboxRecord>(factory, 'syncOutbox');
    const resolutionOutbox = outbox.find((row) => row.eventId === resolution.eventId);
    expect(outbox).toHaveLength(3);
    expect(() => syncEventEnvelopeSchema.parse(resolutionOutbox!.envelope)).not.toThrow();
    expect(resolutionOutbox!.envelope).toMatchObject({
      protocolVersion: 1,
      eventId: resolution.eventId,
      eventType: 'CONFLICT_RESOLVED',
      memoryId: root.memoryId,
      predecessorFactIds: [branchB.factId, branchC.factId],
    } satisfies Partial<SyncEventEnvelope>);

    await expect(repository.query('Versão sintética resolvida')).resolves.toMatchObject({
      status: 'FOUND',
      provenance: { memoryId: root.memoryId, factId: resolution.factId },
    });

    const history = await repository.history(root.memoryId);
    expect(
      history.versions.map((version) => ({
        factId: version.factId,
        predecessorFactIds: version.predecessorFactIds,
        supersedesFactId: version.supersedesFactId,
        isCurrent: version.isCurrent,
      })),
    ).toEqual([
      {
        factId: root.factId,
        predecessorFactIds: [],
        supersedesFactId: null,
        isCurrent: false,
      },
      {
        factId: branchB.factId,
        predecessorFactIds: [root.factId],
        supersedesFactId: root.factId,
        isCurrent: false,
      },
      {
        factId: branchC.factId,
        predecessorFactIds: [root.factId],
        supersedesFactId: root.factId,
        isCurrent: false,
      },
      {
        factId: resolution.factId,
        predecessorFactIds: [branchB.factId, branchC.factId],
        supersedesFactId: null,
        isCurrent: true,
      },
    ]);
  });
});
