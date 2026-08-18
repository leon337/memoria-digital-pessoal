import type { SyncEventEnvelope } from '@mdp/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaCanonicalMemoryWriter } from './prisma-canonical-memory.writer.js';
import { PrismaService } from './prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for integration test');
}

const service = new PrismaService({ databaseUrl });
const writer = new PrismaCanonicalMemoryWriter();

const ids = {
  first: {
    memoryId: '11111111-1111-4111-8111-111111111111',
    evidenceId: '11111111-1111-4111-8111-111111111112',
    eventId: '11111111-1111-4111-8111-111111111113',
    factId: '11111111-1111-4111-8111-111111111114',
  },
  second: {
    memoryId: '22222222-2222-4222-8222-222222222221',
    evidenceId: '22222222-2222-4222-8222-222222222222',
    eventId: '22222222-2222-4222-8222-222222222223',
    factId: '22222222-2222-4222-8222-222222222224',
  },
} as const;

function createEnvelope(
  group: (typeof ids)[keyof typeof ids],
  text: string,
  recordedAt: string,
): SyncEventEnvelope {
  return {
    protocolVersion: 1,
    eventId: group.eventId,
    eventType: 'MEMORY_CREATED',
    memoryId: group.memoryId,
    predecessorFactIds: [],
    records: [
      {
        kind: 'memory',
        value: {
          id: group.memoryId,
          recordedAt,
          occurredAt: null,
          temporalPrecision: 'unknown',
        },
      },
      {
        kind: 'evidence',
        value: {
          id: group.evidenceId,
          memoryId: group.memoryId,
          evidenceKind: 'text',
          content: text,
          createdAt: recordedAt,
        },
      },
      {
        kind: 'ledgerEvent',
        value: {
          id: group.eventId,
          memoryId: group.memoryId,
          evidenceId: group.evidenceId,
          factId: null,
          supersedesFactId: null,
          eventType: 'MEMORY_CREATED',
          reason: null,
          createdAt: recordedAt,
        },
      },
      {
        kind: 'fact',
        value: {
          id: group.factId,
          memoryId: group.memoryId,
          evidenceId: group.evidenceId,
          factKind: 'autobiographical_statement',
          content: text,
          createdAt: recordedAt,
        },
      },
    ],
  };
}

async function clearSynchronizationData(): Promise<void> {
  await service.run(async (client) => {
    await client.$transaction(async (tx) => {
      await tx.syncOutbox.deleteMany();
      await tx.syncConflict.deleteMany();
      await tx.syncBootstrapSnapshot.deleteMany();
      await tx.factRelation.deleteMany();
      await tx.currentFact.deleteMany();
      await tx.ledgerEvent.deleteMany();
      await tx.fact.deleteMany();
      await tx.evidence.deleteMany();
      await tx.memory.deleteMany();
      await tx.syncFeedState.update({ where: { id: 1 }, data: { currentSequence: 0n } });
    });
  });
}

beforeEach(async () => {
  await service.run(async (client) => {
    await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_sync_outbox_insert ON sync_outbox');
    await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_sync_outbox_insert()');
  });
  await clearSynchronizationData();
});

afterAll(async () => {
  await service.run(async (client) => {
    await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_sync_outbox_insert ON sync_outbox');
    await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_sync_outbox_insert()');
  });
  await clearSynchronizationData();
  await service.close();
});

describe('PrismaCanonicalMemoryWriter integration', () => {
  it('rolls back canonical rows and feed sequence when the Outbox insert fails', async () => {
    const envelope = createEnvelope(
      ids.first,
      'Registro sintético para rollback.',
      '2026-08-18T02:15:00.000Z',
    );

    await service.run(async (client) => {
      await client.$executeRawUnsafe(`
        CREATE FUNCTION fail_sync_outbox_insert() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'forced sync outbox failure';
        END;
        $$ LANGUAGE plpgsql
      `);
      await client.$executeRawUnsafe(`
        CREATE TRIGGER fail_sync_outbox_insert
        BEFORE INSERT ON sync_outbox
        FOR EACH ROW EXECUTE FUNCTION fail_sync_outbox_insert()
      `);
    });

    await expect(
      service.run((client) =>
        client.$transaction((tx) => writer.write(tx, envelope, null)),
      ),
    ).rejects.toThrow('forced sync outbox failure');

    await service.run(async (client) => {
      await expect(client.memory.count()).resolves.toBe(0);
      await expect(client.evidence.count()).resolves.toBe(0);
      await expect(client.fact.count()).resolves.toBe(0);
      await expect(client.ledgerEvent.count()).resolves.toBe(0);
      await expect(client.currentFact.count()).resolves.toBe(0);
      await expect(client.syncOutbox.count()).resolves.toBe(0);
      await expect(client.syncFeedState.findUniqueOrThrow({ where: { id: 1 } })).resolves.toMatchObject(
        { currentSequence: 0n },
      );
    });
  });

  it('allocates a strict commit-ordered feed sequence across concurrent transactions', async () => {
    const first = createEnvelope(
      ids.first,
      'Primeiro registro concorrente.',
      '2026-08-18T02:16:00.000Z',
    );
    const second = createEnvelope(
      ids.second,
      'Segundo registro concorrente.',
      '2026-08-18T02:16:01.000Z',
    );

    await Promise.all([
      service.run((client) => client.$transaction((tx) => writer.write(tx, first, null))),
      service.run((client) => client.$transaction((tx) => writer.write(tx, second, null))),
    ]);

    await service.run(async (client) => {
      const feed = await client.syncOutbox.findMany({ orderBy: { sequence: 'asc' } });
      expect(feed.map((entry) => entry.sequence)).toEqual([1n, 2n]);
      expect(new Set(feed.map((entry) => entry.eventId))).toEqual(
        new Set([ids.first.eventId, ids.second.eventId]),
      );
      await expect(client.syncFeedState.findUniqueOrThrow({ where: { id: 1 } })).resolves.toMatchObject(
        { currentSequence: 2n },
      );
    });
  });
});
