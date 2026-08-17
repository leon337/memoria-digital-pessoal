// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
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

    await expect(new IndexedDbMemoryRepository({ factory }).query('Empate sintético')).resolves.toEqual(
      {
        status: 'FOUND',
        answer: 'Empate sintético A.',
        provenance: { memoryId: 'm-a', evidenceId: 'e-a', factId: 'f-a' },
      },
    );
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
