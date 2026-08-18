import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function text(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

async function dependencies(path: string): Promise<string[]> {
  const parsed = JSON.parse(await text(path)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})];
}

describe('Slice 02 scope invariants', () => {
  it('preserves the five base models and correction lineage fields', async () => {
    const schema = await text('prisma/schema.prisma');
    const models = new Set(
      [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]),
    );

    for (const model of ['CurrentFact', 'Evidence', 'Fact', 'LedgerEvent', 'Memory']) {
      expect(models.has(model)).toBe(true);
    }
    expect(schema).toContain('supersedesFactId');
    expect(schema).toContain('@relation("FactSupersession"');
    expect(schema).toContain('reason');
    expect(schema).not.toContain('model FactVersion');
  });

  it('requires database fork prevention and correction-event fact links at the Slice 02 boundary', async () => {
    const migration = await text(
      'prisma/migrations/20260817000100_slice_02_correction_history/migration.sql',
    );

    expect(migration).not.toMatch(/CREATE TABLE/i);
    expect(migration).toContain('CREATE UNIQUE INDEX "facts_supersedes_fact_id_key"');
    expect(migration).toContain('ledger_events_memory_corrected_fact_links_check');
    expect(migration).toContain('"type" <> \'MEMORY_CORRECTED\'');
    expect(migration).toContain('"fact_id" IS NOT NULL');
    expect(migration).toContain('"supersedes_fact_id" IS NOT NULL');
  });

  it('keeps future-slice infrastructure and AI dependencies out', async () => {
    const paths = [
      'package.json',
      'apps/api/package.json',
      'apps/web/package.json',
      'packages/contracts/package.json',
      'packages/domain/package.json',
      'packages/shared/package.json',
    ];
    const names = (await Promise.all(paths.map(dependencies)))
      .flat()
      .map((name) => name.toLowerCase());

    for (const forbidden of [
      'openai',
      'anthropic',
      'pgvector',
      'redis',
      'bullmq',
      'langchain',
      '@aws-sdk/client-s3',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
