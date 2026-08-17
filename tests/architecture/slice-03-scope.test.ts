import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function text(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('Slice 03 scope invariants', () => {
  it('keeps browser persistence APIs and PWA infrastructure out of the domain package', async () => {
    const domain = [
      await text('packages/domain/src/index.ts'),
      await text('packages/domain/src/memory.ts'),
      await text('packages/domain/src/correction.ts'),
    ].join('\n');

    for (const forbidden of [
      'indexedDB',
      'IDBDatabase',
      'IDBTransaction',
      'serviceWorker',
      'CacheStorage',
      'vite-plugin-pwa',
      'navigator.',
      'window.',
    ]) {
      expect(domain).not.toContain(forbidden);
    }
  });

  it('keeps the active web memory path local-only while retaining the HTTP client only for regression/future sync', async () => {
    const activePaths = [
      'apps/web/src/App.tsx',
      'apps/web/src/main.tsx',
      'apps/web/src/features/memory/StoreMemoryForm.tsx',
      'apps/web/src/features/memory/QueryMemoryForm.tsx',
      'apps/web/src/features/memory/MemoryFoundResult.tsx',
    ];
    const active = (await Promise.all(activePaths.map(text))).join('\n');

    expect(active).not.toContain('memory-api');
    expect(active).not.toContain('apiBaseUrl');
    expect(active).toContain('MemoryRepository');
    expect(await exists('apps/web/src/lib/memory-api.ts')).toBe(true);
  });

  it('freezes the local database identity and five-store versioned migration boundary', async () => {
    const db = await text('apps/web/src/lib/indexeddb/mdp-local-db.ts');

    expect(db).toContain("MDP_LOCAL_DB_NAME = 'mdp-local'");
    expect(db).toContain('MDP_LOCAL_DB_VERSION = 2');
    for (const store of ['memories', 'evidence', 'ledgerEvents', 'facts', 'currentFacts']) {
      expect(db).toContain(`'${store}'`);
    }
    expect(db).not.toContain('deleteDatabase');
    expect(db).toContain("createIndex('supersedesFactId', 'supersedesFactId', {");
    expect(db).toContain('unique: true');
    expect(db).toContain("createIndex('memoryId', 'memoryId')");
  });

  it('uses prompt-based app-shell updates without runtime API cache or background sync', async () => {
    const vite = await text('apps/web/vite.config.ts');

    expect(vite).toContain("registerType: 'prompt'");
    expect(vite).toContain('runtimeCaching: []');
    expect(vite).not.toContain("registerType: 'autoUpdate'");
    expect(vite).not.toContain('BackgroundSyncPlugin');
    expect(vite).not.toContain('NetworkFirst');
  });

  it('removes the temporary Slice 03 TDD workflow before final qualification', async () => {
    expect(await exists('.github/workflows/slice03-tdd.yml')).toBe(false);
  });
});
