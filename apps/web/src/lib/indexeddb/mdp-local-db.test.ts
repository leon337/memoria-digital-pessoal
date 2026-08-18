// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  MDP_LOCAL_DB_NAME,
  MDP_LOCAL_DB_VERSION,
  PRODUCT_STORES,
  applyMdpLocalUpgrade,
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
} from './mdp-local-db.js';

function openAt(factory: IDBFactory, version: 1 | 2): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(MDP_LOCAL_DB_NAME, version);
    request.onupgradeneeded = (event) => {
      applyMdpLocalUpgrade(request.result, request.transaction!, event.oldVersion, version);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

const EXPECTED_V3_STORES = [
  'memories',
  'evidence',
  'ledgerEvents',
  'facts',
  'currentFacts',
  'factRelations',
  'syncOutbox',
  'syncState',
  'syncConflicts',
  'bootstrapStaging',
].sort();

describe('mdp-local IndexedDB schema', () => {
  it('ships version 3 with the exact Slice 04 stores and indexes', async () => {
    const db = await openMdpLocalDatabase(new IDBFactory());

    expect(MDP_LOCAL_DB_VERSION).toBe(3);
    expect(db.version).toBe(3);
    expect([...db.objectStoreNames].sort()).toEqual(EXPECTED_V3_STORES);
    expect([...PRODUCT_STORES].sort()).toEqual(EXPECTED_V3_STORES);

    const facts = db.transaction('facts').objectStore('facts');
    expect(facts.indexNames.contains('memoryId')).toBe(true);
    expect(facts.indexNames.contains('supersedesFactId')).toBe(false);

    const relations = db.transaction('factRelations').objectStore('factRelations');
    expect(relations.keyPath).toEqual(['predecessorFactId', 'successorFactId']);
    expect([...relations.indexNames].sort()).toEqual(['memoryId', 'predecessorFactId', 'successorFactId']);

    const outbox = db.transaction('syncOutbox').objectStore('syncOutbox');
    expect([...outbox.indexNames].sort()).toEqual(['memoryId', 'nextAttemptAt', 'status']);
    expect(db.transaction('syncState').objectStore('syncState').keyPath).toBe('key');
    expect([...db.transaction('syncConflicts').objectStore('syncConflicts').indexNames]).toEqual([
      'status',
    ]);
    expect(
      [...db.transaction('bootstrapStaging').objectStore('bootstrapStaging').indexNames],
    ).toEqual(['bootstrapToken']);

    db.close();
  });

  it('upgrades v1 by adding indexes without deleting seeded memory', async () => {
    const factory = new IDBFactory();
    const v1 = await openAt(factory, 1);
    const write = v1.transaction('memories', 'readwrite');
    write.objectStore('memories').add({
      id: 'm-v1',
      recordedAt: new Date('2026-08-17T07:00:00.000Z'),
      occurredAt: null,
      temporalPrecision: 'unknown',
    });
    await transactionDone(write);
    v1.close();

    const v3 = await openMdpLocalDatabase(factory);

    expect(v3.transaction('evidence').objectStore('evidence').indexNames.contains('memoryId')).toBe(
      true,
    );
    expect(v3.transaction('facts').objectStore('facts').indexNames.contains('supersedesFactId')).toBe(
      false,
    );
    expect(
      v3.transaction('currentFacts').objectStore('currentFacts').index('memoryId').unique,
    ).toBe(false);
    expect(
      await requestAsPromise(v3.transaction('memories').objectStore('memories').get('m-v1')),
    ).toBeTruthy();

    v3.close();
  });

  it('upgrades v2 to v3 non-destructively, backfills lineage, and permits branching', async () => {
    const factory = new IDBFactory();
    const v2 = await openAt(factory, 2);
    const seed = v2.transaction(
      ['memories', 'evidence', 'ledgerEvents', 'facts', 'currentFacts'],
      'readwrite',
    );
    seed.objectStore('memories').add({
      id: 'memory-a',
      recordedAt: new Date('2026-08-17T07:00:00.000Z'),
      occurredAt: null,
      temporalPrecision: 'unknown',
    });
    seed.objectStore('evidence').add({
      id: 'evidence-a',
      memoryId: 'memory-a',
      kind: 'text',
      content: 'Raiz A.',
      createdAt: new Date('2026-08-17T07:00:00.000Z'),
    });
    seed.objectStore('evidence').add({
      id: 'evidence-b',
      memoryId: 'memory-a',
      kind: 'text',
      content: 'Sucessor B.',
      createdAt: new Date('2026-08-17T07:01:00.000Z'),
    });
    seed.objectStore('facts').add({
      id: 'fact-a',
      memoryId: 'memory-a',
      evidenceId: 'evidence-a',
      kind: 'autobiographical_statement',
      content: 'Raiz A.',
      createdAt: new Date('2026-08-17T07:00:00.000Z'),
    });
    seed.objectStore('facts').add({
      id: 'fact-b',
      memoryId: 'memory-a',
      evidenceId: 'evidence-b',
      kind: 'autobiographical_statement',
      content: 'Sucessor B.',
      supersedesFactId: 'fact-a',
      createdAt: new Date('2026-08-17T07:01:00.000Z'),
    });
    seed.objectStore('ledgerEvents').add({
      id: 'event-a',
      memoryId: 'memory-a',
      evidenceId: 'evidence-a',
      type: 'MEMORY_CREATED',
      createdAt: new Date('2026-08-17T07:00:00.000Z'),
    });
    seed.objectStore('ledgerEvents').add({
      id: 'event-b',
      memoryId: 'memory-a',
      evidenceId: 'evidence-b',
      factId: 'fact-b',
      supersedesFactId: 'fact-a',
      type: 'MEMORY_CORRECTED',
      createdAt: new Date('2026-08-17T07:01:00.000Z'),
    });
    seed.objectStore('currentFacts').add({
      factId: 'fact-b',
      memoryId: 'memory-a',
      evidenceId: 'evidence-b',
      content: 'Sucessor B.',
      recordedAt: new Date('2026-08-17T07:01:00.000Z'),
    });
    await transactionDone(seed);
    v2.close();

    const v3 = await openMdpLocalDatabase(factory);
    expect(v3.version).toBe(3);

    for (const [storeName, key] of [
      ['memories', 'memory-a'],
      ['evidence', 'evidence-a'],
      ['evidence', 'evidence-b'],
      ['ledgerEvents', 'event-a'],
      ['ledgerEvents', 'event-b'],
      ['facts', 'fact-a'],
      ['facts', 'fact-b'],
      ['currentFacts', 'fact-b'],
    ] as const) {
      await expect(
        requestAsPromise(v3.transaction(storeName).objectStore(storeName).get(key)),
      ).resolves.toBeTruthy();
    }

    await expect(
      requestAsPromise(
        v3
          .transaction('factRelations')
          .objectStore('factRelations')
          .get(['fact-a', 'fact-b']),
      ),
    ).resolves.toMatchObject({
      memoryId: 'memory-a',
      predecessorFactId: 'fact-a',
      successorFactId: 'fact-b',
      relationType: 'SUPERSEDES',
    });

    const branch = v3.transaction(['facts', 'factRelations'], 'readwrite');
    branch.objectStore('facts').add({
      id: 'fact-c',
      memoryId: 'memory-a',
      evidenceId: 'evidence-c',
      kind: 'autobiographical_statement',
      content: 'Sucessor C.',
      supersedesFactId: 'fact-a',
      createdAt: new Date('2026-08-17T07:02:00.000Z'),
    });
    branch.objectStore('factRelations').add({
      memoryId: 'memory-a',
      predecessorFactId: 'fact-a',
      successorFactId: 'fact-c',
      relationType: 'SUPERSEDES',
    });
    await expect(transactionDone(branch)).resolves.toBeUndefined();

    v3.close();
  });
});
