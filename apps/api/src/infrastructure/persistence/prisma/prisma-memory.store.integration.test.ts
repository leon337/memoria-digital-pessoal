import { createTextMemoryRecord } from '@mdp/domain';
import { createId } from '@mdp/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemoryStore } from './prisma-memory.store.js';
import { PrismaService } from './prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for integration test');
}

const prisma = new PrismaService({ databaseUrl });
const store = new PrismaMemoryStore(prisma);

interface RecordOptions {
  text?: string;
  recordedAt?: Date;
  factId?: string;
}

function buildRecord(options: RecordOptions = {}) {
  return createTextMemoryRecord({
    text: options.text ?? '  Minha irmã se chama Ana.  ',
    recordedAt: options.recordedAt ?? new Date('2026-08-16T09:00:00.000Z'),
    ids: {
      memoryId: createId(),
      evidenceId: createId(),
      eventId: createId(),
      factId: options.factId ?? createId(),
    },
  });
}

function correctionIds() {
  return { evidenceId: createId(), eventId: createId(), factId: createId() };
}

async function clearProductTables(): Promise<void> {
  await prisma.run(async (client) => {
    await client.$transaction([
      client.currentFact.deleteMany(),
      client.ledgerEvent.deleteMany(),
      client.fact.deleteMany(),
      client.evidence.deleteMany(),
      client.memory.deleteMany(),
    ]);
  });
}

async function counts(): Promise<number[]> {
  return prisma.run(async (client) =>
    Promise.all([
      client.memory.count(),
      client.evidence.count(),
      client.ledgerEvent.count(),
      client.fact.count(),
      client.currentFact.count(),
    ]),
  );
}

async function dropFailureTriggers(): Promise<void> {
  await prisma.run(async (client) => {
    await client.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS slice01_fail_current_fact ON current_facts',
    );
    await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS slice01_fail_current_fact_insert()');
    await client.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS slice02_fail_current_fact_update ON current_facts',
    );
    await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS slice02_fail_current_fact_update()');
  });
}

beforeEach(async () => {
  await dropFailureTriggers();
  await clearProductTables();
});

afterAll(async () => {
  await dropFailureTriggers();
  await clearProductTables();
  await prisma.close();
});

describe('PrismaMemoryStore integration', () => {
  it('atomically creates all five records and preserves exact evidence', async () => {
    const record = buildRecord();

    await store.create(record);

    expect(await counts()).toEqual([1, 1, 1, 1, 1]);
    const persisted = await prisma.run(async (client) => ({
      evidence: await client.evidence.findUniqueOrThrow({ where: { id: record.evidence.id } }),
      fact: await client.fact.findUniqueOrThrow({ where: { id: record.fact.id } }),
      currentFact: await client.currentFact.findUniqueOrThrow({
        where: { factId: record.fact.id },
      }),
      event: await client.ledgerEvent.findUniqueOrThrow({ where: { id: record.event.id } }),
    }));

    expect(persisted.evidence.content).toBe('  Minha irmã se chama Ana.  ');
    expect(persisted.fact.content).toBe(persisted.evidence.content);
    expect(persisted.currentFact.content).toBe(persisted.fact.content);
    expect(persisted.event.type).toBe('MEMORY_CREATED');
    expect(persisted.event.evidenceId).toBe(persisted.evidence.id);
  });

  it('rolls back every record when the final projection insert fails', async () => {
    await prisma.run(async (client) => {
      await client.$executeRawUnsafe(`
        CREATE FUNCTION slice01_fail_current_fact_insert()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'synthetic current_fact failure';
        END;
        $$ LANGUAGE plpgsql
      `);
      await client.$executeRawUnsafe(`
        CREATE TRIGGER slice01_fail_current_fact
        BEFORE INSERT ON current_facts
        FOR EACH ROW EXECUTE FUNCTION slice01_fail_current_fact_insert()
      `);
    });

    await expect(store.create(buildRecord({ text: 'Falha sintética.' }))).rejects.toThrow();
    expect(await counts()).toEqual([0, 0, 0, 0, 0]);
  });

  it('reads the original evidence and deterministic fact by memory ID', async () => {
    const record = buildRecord();
    await store.create(record);

    const stored = await store.getById(record.memory.id);

    expect(stored?.memory.id).toBe(record.memory.id);
    expect(stored?.evidence.id).toBe(record.evidence.id);
    expect(stored?.evidence.content).toBe(record.evidence.content);
    expect(stored?.fact.id).toBe(record.fact.id);
    expect(stored?.fact.content).toBe(stored?.evidence.content);
    await expect(store.getById(createId())).resolves.toBeNull();
  });

  it('matches literal substrings case-insensitively', async () => {
    const record = buildRecord();
    await store.create(record);

    const hit = await store.findLiteral('ANA');

    expect(hit).toMatchObject({
      memoryId: record.memory.id,
      evidenceId: record.evidence.id,
      factId: record.fact.id,
      content: record.fact.content,
    });
  });

  it('treats percent and underscore as literal characters rather than wildcards', async () => {
    const literal = buildRecord({ text: 'Código sintético: 100%_seguro.' });
    await store.create(literal);

    await expect(store.findLiteral('%_')).resolves.toMatchObject({ factId: literal.fact.id });
    await expect(store.findLiteral('não%existe')).resolves.toBeNull();
    await expect(store.findLiteral('não_existe')).resolves.toBeNull();
  });

  it('orders matches by newest recordedAt and then factId ascending', async () => {
    const older = buildRecord({
      text: 'alvo antigo',
      recordedAt: new Date('2026-08-16T08:00:00.000Z'),
    });
    const tieHigh = buildRecord({
      text: 'alvo empate alto',
      recordedAt: new Date('2026-08-16T10:00:00.000Z'),
      factId: '0198c000-0000-7000-8000-000000000002',
    });
    const tieLow = buildRecord({
      text: 'alvo empate baixo',
      recordedAt: new Date('2026-08-16T10:00:00.000Z'),
      factId: '0198c000-0000-7000-8000-000000000001',
    });
    await store.create(older);
    await store.create(tieHigh);
    await store.create(tieLow);

    const hit = await store.findLiteral('alvo');

    expect(hit?.factId).toBe(tieLow.fact.id);
    expect(hit?.recordedAt).toEqual(tieLow.memory.recordedAt);
  });

  it('atomically corrects current text while preserving original rows and recordedAt', async () => {
    const original = buildRecord({ text: 'Texto original.' });
    await store.create(original);
    const originalRows = await prisma.run(async (client) => ({
      evidence: await client.evidence.findUniqueOrThrow({ where: { id: original.evidence.id } }),
      fact: await client.fact.findUniqueOrThrow({ where: { id: original.fact.id } }),
      event: await client.ledgerEvent.findUniqueOrThrow({ where: { id: original.event.id } }),
    }));

    const result = await store.correct({
      memoryId: original.memory.id,
      expectedCurrentFactId: original.fact.id,
      text: '  Texto corrigido.  ',
      reason: '  ajuste factual  ',
      correctedAt: new Date('2026-08-17T05:00:00.000Z'),
      ids: correctionIds(),
    });

    expect(result.status).toBe('CORRECTED');
    expect(await counts()).toEqual([1, 2, 2, 2, 1]);
    await expect(store.findLiteral('original')).resolves.toBeNull();
    await expect(store.findLiteral('corrigido')).resolves.toMatchObject({
      memoryId: original.memory.id,
      content: 'Texto corrigido.',
      recordedAt: original.memory.recordedAt,
    });

    const unchanged = await prisma.run(async (client) => ({
      evidence: await client.evidence.findUniqueOrThrow({ where: { id: original.evidence.id } }),
      fact: await client.fact.findUniqueOrThrow({ where: { id: original.fact.id } }),
      event: await client.ledgerEvent.findUniqueOrThrow({ where: { id: original.event.id } }),
    }));
    expect(unchanged).toEqual(originalRows);
  });

  it('serializes concurrent corrections so only one succeeds from the same expected fact', async () => {
    const original = buildRecord({ text: 'Versão zero.' });
    await store.create(original);
    const correctedAt = new Date('2026-08-17T05:01:00.000Z');

    const [first, second] = await Promise.all([
      store.correct({
        memoryId: original.memory.id,
        expectedCurrentFactId: original.fact.id,
        text: 'Versão A.',
        correctedAt,
        ids: correctionIds(),
      }),
      store.correct({
        memoryId: original.memory.id,
        expectedCurrentFactId: original.fact.id,
        text: 'Versão B.',
        correctedAt,
        ids: correctionIds(),
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual(['CORRECTED', 'STALE']);
    expect(await counts()).toEqual([1, 2, 2, 2, 1]);
  });

  it('rolls back the entire correction when current projection update fails', async () => {
    const original = buildRecord({ text: 'Antes da falha.' });
    await store.create(original);
    await prisma.run(async (client) => {
      await client.$executeRawUnsafe(`
        CREATE FUNCTION slice02_fail_current_fact_update()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'synthetic correction projection failure';
        END;
        $$ LANGUAGE plpgsql
      `);
      await client.$executeRawUnsafe(`
        CREATE TRIGGER slice02_fail_current_fact_update
        BEFORE UPDATE ON current_facts
        FOR EACH ROW EXECUTE FUNCTION slice02_fail_current_fact_update()
      `);
    });

    await expect(
      store.correct({
        memoryId: original.memory.id,
        expectedCurrentFactId: original.fact.id,
        text: 'Depois da falha.',
        correctedAt: new Date('2026-08-17T05:02:00.000Z'),
        ids: correctionIds(),
      }),
    ).rejects.toThrow('synthetic correction projection failure');

    expect(await counts()).toEqual([1, 1, 1, 1, 1]);
    await expect(store.findLiteral('Antes da falha')).resolves.toMatchObject({
      factId: original.fact.id,
    });
  });

  it('returns one-version history for an original and semantic order after repeated corrections', async () => {
    const original = buildRecord({ text: 'Versão original.' });
    await store.create(original);

    const initialHistory = await store.history(original.memory.id);
    expect(initialHistory?.versions).toEqual([
      expect.objectContaining({
        factId: original.fact.id,
        evidenceId: original.evidence.id,
        content: 'Versão original.',
        eventId: original.event.id,
        reason: null,
        supersedesFactId: null,
        isOriginal: true,
        isCurrent: true,
      }),
    ]);

    const first = await store.correct({
      memoryId: original.memory.id,
      expectedCurrentFactId: original.fact.id,
      text: 'Versão um.',
      reason: 'primeira',
      correctedAt: new Date('2026-08-17T05:03:00.000Z'),
      ids: correctionIds(),
    });
    expect(first.status).toBe('CORRECTED');
    if (first.status !== 'CORRECTED') throw new Error('expected first correction');

    const second = await store.correct({
      memoryId: original.memory.id,
      expectedCurrentFactId: first.record.fact.id,
      text: 'Versão dois.',
      reason: 'segunda',
      correctedAt: new Date('2026-08-17T05:04:00.000Z'),
      ids: correctionIds(),
    });
    expect(second.status).toBe('CORRECTED');
    if (second.status !== 'CORRECTED') throw new Error('expected second correction');

    const history = await store.history(original.memory.id);
    expect(history?.versions.map((version) => version.factId)).toEqual([
      original.fact.id,
      first.record.fact.id,
      second.record.fact.id,
    ]);
    expect(history?.versions.map((version) => version.reason)).toEqual([null, 'primeira', 'segunda']);
    expect(history?.versions[0]).toMatchObject({ isOriginal: true, isCurrent: false });
    expect(history?.versions[2]).toMatchObject({ isOriginal: false, isCurrent: true });
    await expect(store.history(createId())).resolves.toBeNull();
  });
});
