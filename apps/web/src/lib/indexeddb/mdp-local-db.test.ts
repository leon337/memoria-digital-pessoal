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

describe('mdp-local IndexedDB schema', () => {
  it('ships version 2 with exactly five product stores', async () => {
    const db = await openMdpLocalDatabase(new IDBFactory());

    expect(db.version).toBe(MDP_LOCAL_DB_VERSION);
    expect([...db.objectStoreNames]).toEqual([...PRODUCT_STORES]);

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

    const v2 = await openMdpLocalDatabase(factory);

    expect(
      v2.transaction('evidence').objectStore('evidence').indexNames.contains('memoryId'),
    ).toBe(true);
    expect(v2.transaction('facts').objectStore('facts').index('supersedesFactId').unique).toBe(true);
    expect(
      v2.transaction('currentFacts').objectStore('currentFacts').index('memoryId').unique,
    ).toBe(false);
    expect(
      await requestAsPromise(v2.transaction('memories').objectStore('memories').get('m-v1')),
    ).toBeTruthy();

    v2.close();
  });

  it('allows independent roots but rejects two successor facts for one predecessor', async () => {
    const db = await openMdpLocalDatabase(new IDBFactory());
    const roots = db.transaction('facts', 'readwrite');
    const rootStore = roots.objectStore('facts');
    rootStore.add({
      id: 'root-a',
      memoryId: 'memory-a',
      evidenceId: 'evidence-a',
      kind: 'autobiographical_statement',
      content: 'Raiz sintética A.',
      createdAt: new Date('2026-08-17T07:00:00.000Z'),
    });
    rootStore.add({
      id: 'root-b',
      memoryId: 'memory-b',
      evidenceId: 'evidence-b',
      kind: 'autobiographical_statement',
      content: 'Raiz sintética B.',
      createdAt: new Date('2026-08-17T07:01:00.000Z'),
    });
    await expect(transactionDone(roots)).resolves.toBeUndefined();

    const fork = db.transaction('facts', 'readwrite');
    const forkStore = fork.objectStore('facts');
    forkStore.add({
      id: 'next-a',
      memoryId: 'memory-a',
      evidenceId: 'evidence-a2',
      kind: 'autobiographical_statement',
      content: 'Sucessor sintético A2.',
      supersedesFactId: 'root-a',
      createdAt: new Date('2026-08-17T07:02:00.000Z'),
    });
    forkStore.add({
      id: 'next-b',
      memoryId: 'memory-a',
      evidenceId: 'evidence-a3',
      kind: 'autobiographical_statement',
      content: 'Sucessor sintético A3.',
      supersedesFactId: 'root-a',
      createdAt: new Date('2026-08-17T07:03:00.000Z'),
    });

    await expect(transactionDone(fork)).rejects.toBeTruthy();
    db.close();
  });
});
