import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from './prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for integration test');
}

const service = new PrismaService({ databaseUrl });

afterAll(async () => {
  await service.close();
});

describe('PrismaService integration', () => {
  it('pings PostgreSQL', async () => {
    await expect(service.ping()).resolves.toBeUndefined();
  });

  it('exposes the Slice 04 synchronization persistence primitives', async () => {
    await service.run(async (client) => {
      const feedState = await client.syncFeedState.findUnique({ where: { id: 1 } });
      expect(feedState).toMatchObject({ id: 1, currentSequence: 0n });

      const tables = await client.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'fact_relations',
            'sync_feed_state',
            'sync_outbox',
            'sync_conflicts',
            'sync_bootstrap_snapshots'
          )
        ORDER BY table_name
      `;
      expect(tables.map((row) => row.table_name)).toEqual([
        'fact_relations',
        'sync_bootstrap_snapshots',
        'sync_conflicts',
        'sync_feed_state',
        'sync_outbox',
      ]);

      const legacyUniqueIndexes = await client.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'facts'
          AND indexname = 'facts_supersedes_fact_id_key'
      `;
      expect(legacyUniqueIndexes).toEqual([]);

      const compositeFactIndex = await client.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'facts'
          AND indexname = 'facts_id_memory_id_key'
      `;
      expect(compositeFactIndex).toHaveLength(1);
    });
  });
});
