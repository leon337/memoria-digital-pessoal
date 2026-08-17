// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_STORES,
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
} from './mdp-local-db.js';
import { IndexedDbMemoryRepository } from './indexeddb-memory-repository.js';

function ids(...values: string[]): () => string {
  const queue = [...values];
  return () => {
    const value = queue.shift();
    if (value === undefined) {
      throw new Error('test id queue exhausted');
    }
    return value;
  };
}

function times(...values: string[]): () => Date {
  const queue = [...values];
  return () => {
    const value = queue.shift();
    if (value === undefined) {
      throw new Error('test time queue exhausted');
    }
    return new Date(value);
  };
}

describe('IndexedDbMemoryRepository create/query', () => {
  it('creates a complete local memory and preserves valid original whitespace', async () => {
    const repository = new IndexedDbMemoryRepository({
      factory: new IDBFactory(),
      now: () => new Date('2026-08-17T07:00:00.000Z'),
      createId: ids('m1', 'e1', 'ev1', 'f1'),
    });

    await expect(repository.create('  Memória sintética preservada.  ')).resolves.toEqual({
      memory: { id: 'm1', recordedAt: '2026-08-17T07:00:00.000Z' },
      fact: { id: 'f1', content: '  Memória sintética preservada.  ' },
      provenance: { evidenceId: 'e1' },
    });
  });

  it('rejects invalid create/query input with the stable validation code', async () => {
    const repository = new IndexedDbMemoryRepository({
      factory: new IDBFactory(),
      createId: ids('m1', 'e1', 'ev1', 'f1'),
    });

    await expect(repository.create('   ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(repository.query('   ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rolls back all stores when a later add violates a key constraint', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T07:00:00.000Z'),
      createId: ids('m1', 'e1', 'ev1', 'f1'),
    });
    await first.create('Primeiro registro sintético.');

    const failing = new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T07:01:00.000Z'),
      createId: ids('m2', 'e2', 'ev2', 'f1'),
    });

    await expect(failing.create('Segundo registro sintético.')).rejects.toMatchObject({
      code: 'LOCAL_DATA_INTEGRITY_ERROR',
    });
    await expect(first.query('Segundo registro')).resolves.toEqual({
      status: 'UNKNOWN',
      answer: null,
      provenance: null,
    });
    await expect(first.query('Primeiro registro')).resolves.toMatchObject({
      status: 'FOUND',
      answer: 'Primeiro registro sintético.',
    });
  });

  it('returns the newest matching current fact case-insensitively', async () => {
    const factory = new IDBFactory();
    await new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T07:00:00.000Z'),
      createId: ids('m-old', 'e-old', 'ev-old', 'f-old'),
    }).create('Registro sintético compartilhado antigo.');
    await new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T08:00:00.000Z'),
      createId: ids('m-new', 'e-new', 'ev-new', 'f-new'),
    }).create('Registro SINTÉTICO compartilhado novo.');

    await expect(
      new IndexedDbMemoryRepository({ factory }).query('sintético compartilhado'),
    ).resolves.toEqual({
      status: 'FOUND',
      answer: 'Registro SINTÉTICO compartilhado novo.',
      provenance: {
        memoryId: 'm-new',
        evidenceId: 'e-new',
        factId: 'f-new',
      },
    });
  });

  it('breaks equal recordedAt ties by ascending factId', async () => {
    const factory = new IDBFactory();
    const recordedAt = new Date('2026-08-17T09:00:00.000Z');
    await new IndexedDbMemoryRepository({
      factory,
      now: () => recordedAt,
      createId: ids('m-b', 'e-b', 'ev-b', 'f-b'),
    }).create('Empate sintético B.');
    await new IndexedDbMemoryRepository({
      factory,
      now: () => recordedAt,
      createId: ids('m-a', 'e-a', 'ev-a', 'f-a'),
    }).create('Empate sintético A.');

    await expect(
      new IndexedDbMemoryRepository({ factory }).query('Empate sintético'),
    ).resolves.toEqual({
      status: 'FOUND',
      answer: 'Empate sintético A.',
      provenance: { memoryId: 'm-a', evidenceId: 'e-a', factId: 'f-a' },
    });
  });

  it('reopens the same local database without losing records', async () => {
    const factory = new IDBFactory();
    const writer = new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T10:00:00.000Z'),
      createId: ids('m1', 'e1', 'ev1', 'f1'),
    });
    await writer.create('Persistência sintética após reabertura.');

    const reader = new IndexedDbMemoryRepository({ factory });
    await reader.ready();

    await expect(reader.query('após reabertura')).resolves.toMatchObject({
      status: 'FOUND',
      answer: 'Persistência sintética após reabertura.',
      provenance: { memoryId: 'm1', evidenceId: 'e1', factId: 'f1' },
    });
  });
});

describe('IndexedDbMemoryRepository correction/history', () => {
  it('corrects and restores by appending evidence, facts and events while moving only CurrentFact', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbMemoryRepository({
      factory,
      now: times(
        '2026-08-17T07:00:00.000Z',
        '2026-08-17T08:00:00.000Z',
        '2026-08-17T09:00:00.000Z',
      ),
      createId: ids('m1', 'e1', 'ev1', 'f1', 'e2', 'ev2', 'f2', 'e3', 'ev3', 'f3'),
    });
    await repository.create('Minha irmã se chama Ana.');

    await expect(
      repository.correct('m1', {
        text: 'Minha irmã se chama Beatriz.',
        expectedCurrentFactId: 'f1',
        reason: 'Correção sintética',
      }),
    ).resolves.toEqual({
      memoryId: 'm1',
      current: {
        factId: 'f2',
        evidenceId: 'e2',
        content: 'Minha irmã se chama Beatriz.',
        recordedAt: '2026-08-17T07:00:00.000Z',
        correctedAt: '2026-08-17T08:00:00.000Z',
      },
      correction: {
        eventId: 'ev2',
        supersedesFactId: 'f1',
        reason: 'Correção sintética',
      },
    });

    await expect(repository.query('Ana')).resolves.toEqual({
      status: 'UNKNOWN',
      answer: null,
      provenance: null,
    });
    await expect(repository.query('Beatriz')).resolves.toMatchObject({
      status: 'FOUND',
      provenance: { factId: 'f2' },
    });

    await expect(
      repository.correct('m1', {
        text: 'Minha irmã se chama Ana.',
        expectedCurrentFactId: 'f2',
      }),
    ).resolves.toMatchObject({
      memoryId: 'm1',
      current: {
        factId: 'f3',
        evidenceId: 'e3',
        content: 'Minha irmã se chama Ana.',
        recordedAt: '2026-08-17T07:00:00.000Z',
        correctedAt: '2026-08-17T09:00:00.000Z',
      },
      correction: { eventId: 'ev3', supersedesFactId: 'f2', reason: null },
    });

    const history = await repository.history('m1');
    expect(
      history.versions.map((version) => ({
        factId: version.factId,
        content: version.content,
        reason: version.reason,
        supersedesFactId: version.supersedesFactId,
        eventId: version.eventId,
        isOriginal: version.isOriginal,
        isCurrent: version.isCurrent,
      })),
    ).toEqual([
      {
        factId: 'f1',
        content: 'Minha irmã se chama Ana.',
        reason: null,
        supersedesFactId: null,
        eventId: 'ev1',
        isOriginal: true,
        isCurrent: false,
      },
      {
        factId: 'f2',
        content: 'Minha irmã se chama Beatriz.',
        reason: 'Correção sintética',
        supersedesFactId: 'f1',
        eventId: 'ev2',
        isOriginal: false,
        isCurrent: false,
      },
      {
        factId: 'f3',
        content: 'Minha irmã se chama Ana.',
        reason: null,
        supersedesFactId: 'f2',
        eventId: 'ev3',
        isOriginal: false,
        isCurrent: true,
      },
    ]);

    const db = await openMdpLocalDatabase(factory);
    const transaction = db.transaction(PRODUCT_STORES, 'readonly');
    const done = transactionDone(transaction);
    const counts = await Promise.all(
      PRODUCT_STORES.map((store) => requestAsPromise(transaction.objectStore(store).count())),
    );
    await done;
    expect(counts).toEqual([1, 3, 3, 3, 1]);
    db.close();
  });

  it('rejects no-op correction and leaves history unchanged', async () => {
    const repository = new IndexedDbMemoryRepository({
      factory: new IDBFactory(),
      now: times('2026-08-17T07:00:00.000Z', '2026-08-17T08:00:00.000Z'),
      createId: ids('m1', 'e1', 'ev1', 'f1', 'e2', 'ev2', 'f2'),
    });
    await repository.create('Texto sintético atual.');

    await expect(
      repository.correct('m1', {
        text: 'Texto sintético atual.',
        expectedCurrentFactId: 'f1',
      }),
    ).rejects.toMatchObject({ code: 'NO_CHANGE' });

    await expect(repository.history('m1')).resolves.toMatchObject({
      versions: [{ factId: 'f1', isOriginal: true, isCurrent: true }],
    });
  });

  it('rejects stale correction without changing current state', async () => {
    const repository = new IndexedDbMemoryRepository({
      factory: new IDBFactory(),
      now: times('2026-08-17T07:00:00.000Z', '2026-08-17T08:00:00.000Z'),
      createId: ids('m1', 'e1', 'ev1', 'f1', 'e2', 'ev2', 'f2'),
    });
    await repository.create('Versão sintética A.');
    await repository.correct('m1', {
      text: 'Versão sintética B.',
      expectedCurrentFactId: 'f1',
    });

    await expect(
      repository.correct('m1', {
        text: 'Versão sintética C.',
        expectedCurrentFactId: 'f1',
      }),
    ).rejects.toMatchObject({ code: 'STALE_CORRECTION' });

    const history = await repository.history('m1');
    expect(history.versions).toHaveLength(2);
    expect(history.versions.at(-1)).toMatchObject({ factId: 'f2', isCurrent: true });
  });

  it('serializes same-base corrections across repository instances into one success and one stale result', async () => {
    const factory = new IDBFactory();
    await new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T07:00:00.000Z'),
      createId: ids('m1', 'e1', 'ev1', 'f1'),
    }).create('Base sintética.');

    const first = new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T08:00:00.000Z'),
      createId: ids('e2', 'ev2', 'f2'),
    });
    const second = new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T08:00:01.000Z'),
      createId: ids('e3', 'ev3', 'f3'),
    });

    const results = await Promise.allSettled([
      first.correct('m1', { text: 'Correção concorrente A.', expectedCurrentFactId: 'f1' }),
      second.correct('m1', { text: 'Correção concorrente B.', expectedCurrentFactId: 'f1' }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'STALE_CORRECTION',
    });

    const history = await first.history('m1');
    expect(history.versions).toHaveLength(2);
    expect(history.versions.filter((version) => version.isCurrent)).toHaveLength(1);
  });

  it('returns stable NOT_FOUND semantics for missing local memories', async () => {
    const repository = new IndexedDbMemoryRepository({
      factory: new IDBFactory(),
      createId: ids('e1', 'ev1', 'f1'),
    });

    await expect(repository.history('missing-memory')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      repository.correct('missing-memory', {
        text: 'Correção sintética.',
        expectedCurrentFactId: 'missing-fact',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('fails safely when local history contains a second disconnected root', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbMemoryRepository({
      factory,
      now: () => new Date('2026-08-17T07:00:00.000Z'),
      createId: ids('m1', 'e1', 'ev1', 'f1'),
    });
    await repository.create('Conteúdo sintético íntegro.');

    const db = await openMdpLocalDatabase(factory);
    const transaction = db.transaction(['evidence', 'facts'], 'readwrite');
    transaction.objectStore('evidence').add({
      id: 'e-bad',
      memoryId: 'm1',
      kind: 'text',
      content: 'Conteúdo sintético desconectado.',
      createdAt: new Date('2026-08-17T08:00:00.000Z'),
    });
    transaction.objectStore('facts').add({
      id: 'f-bad',
      memoryId: 'm1',
      evidenceId: 'e-bad',
      kind: 'autobiographical_statement',
      content: 'Conteúdo sintético desconectado.',
      createdAt: new Date('2026-08-17T08:00:00.000Z'),
    });
    await transactionDone(transaction);
    db.close();

    await expect(repository.history('m1')).rejects.toMatchObject({
      code: 'LOCAL_DATA_INTEGRITY_ERROR',
      message: 'LOCAL_DATA_INTEGRITY_ERROR',
    });
  });
});
