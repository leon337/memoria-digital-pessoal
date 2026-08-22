import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'generated' || entry.name === 'dist') return [];
        return sourceFiles(path);
      }
      if (!/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) return [];
      if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) return [];
      return [path];
    }),
  );
  return files.flat();
}

async function combinedSource(paths: string[]): Promise<string> {
  const files = (await Promise.all(paths.map(sourceFiles))).flat();
  return (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');
}

describe('Slice 04 synchronization architecture invariants', () => {
  it('keeps excluded infrastructure and destructive semantics out of production source', async () => {
    const productionSource = await combinedSource([
      'apps/api/src',
      'apps/web/src',
      'packages/contracts/src',
      'packages/domain/src',
      'packages/shared/src',
    ]);

    for (const forbidden of [
      'bullmq',
      'ioredis',
      'redis.createClient',
      'new WebSocket(',
      'MEMORY_DELETED',
      'lastWriteWins',
      'serverWins',
    ]) {
      expect(productionSource).not.toContain(forbidden);
    }
    expect(productionSource).not.toMatch(/SyncManager|registration\.sync\.register/);
  });

  it('keeps memory writes local while synchronization uses its dedicated transport', async () => {
    const activeMemorySource = (
      await Promise.all(
        [
          'apps/web/src/App.tsx',
          'apps/web/src/features/memory/StoreMemoryForm.tsx',
          'apps/web/src/features/memory/QueryMemoryForm.tsx',
          'apps/web/src/features/memory/MemoryFoundResult.tsx',
        ].map((path) => readFile(path, 'utf8')),
      )
    ).join('\n');
    const runtime = await readFile('apps/web/src/main.tsx', 'utf8');

    expect(activeMemorySource).not.toContain('memory-api');
    expect(activeMemorySource).toContain('MemoryRepository');
    expect(runtime).toContain('IndexedDbMemoryRepository');
    expect(runtime).toContain('SyncApiClient');
    expect(runtime).toContain('SyncEngine');
  });
});
