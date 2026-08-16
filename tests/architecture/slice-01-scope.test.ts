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

describe('Slice 01 scope invariants', () => {
  it('contains exactly the five authorized product models', async () => {
    const schema = await text('prisma/schema.prisma');
    const models = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)]
      .map((match) => match[1])
      .sort();

    expect(models).toEqual(['CurrentFact', 'Evidence', 'Fact', 'LedgerEvent', 'Memory']);
  });

  it('does not add out-of-scope infrastructure or AI dependencies', async () => {
    const names = [
      ...(await dependencies('package.json')),
      ...(await dependencies('apps/api/package.json')),
      ...(await dependencies('apps/web/package.json')),
      ...(await dependencies('packages/contracts/package.json')),
      ...(await dependencies('packages/domain/package.json')),
      ...(await dependencies('packages/shared/package.json')),
    ].map((name) => name.toLowerCase());

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

  it('exposes no correction, update or deletion endpoint for Evidence or Ledger', async () => {
    const controller = await text('apps/api/src/memories/memory.controller.ts');

    expect(controller).not.toMatch(/@(Put|Patch|Delete)\s*\(/);
    expect(controller).not.toContain("'evidence'");
    expect(controller).not.toContain("'ledger'");
  });

  it('keeps literal query semantics parameterized and avoids LIKE wildcards', async () => {
    const store = await text(
      'apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts',
    );

    expect(store).toContain('strpos(lower(content), lower(${query})) > 0');
    expect(store).toContain('ORDER BY recorded_at DESC, fact_id ASC');
    expect(store).not.toMatch(/\bLIKE\b/i);
    expect(store).not.toContain('$queryRawUnsafe');
  });
});
