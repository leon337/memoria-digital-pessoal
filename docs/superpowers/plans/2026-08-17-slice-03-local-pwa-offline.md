# Slice 03 — Local PWA + Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing textual-memory PWA fully usable on one browser/device without network access by moving the active web persistence path to IndexedDB while preserving all Slice 01–02 trust, history, concurrency, and regression guarantees.

**Architecture:** Add a browser-side `MemoryRepository` boundary and a native IndexedDB implementation backed by the five approved product stores. The React PWA depends on that repository instead of `memory-api.ts`; the NestJS/PostgreSQL path remains intact for regression and future synchronization. `vite-plugin-pwa` supplies a versioned app-shell Service Worker with prompt-based controlled updates; memory data never enters Cache Storage.

**Tech Stack:** React 19-style current workspace React, TypeScript 6.0.3, Vite, Vitest, fake-indexeddb for Node-side IndexedDB tests, Playwright Chromium for browser acceptance, native IndexedDB, `@mdp/domain`, `@mdp/contracts`, `@mdp/shared`, vite-plugin-pwa/Workbox-generated app-shell precache.

## Global Constraints

- Planning baseline: approved spec `docs/superpowers/specs/2026-08-17-slice-03-local-pwa-offline-design.md` on `design/slice-03-local-offline`.
- Product implementation is **not authorized by this plan**. Before Task 1, LEANDRO must explicitly authorize Slice 03 implementation.
- At execution time, verify live `main` again and create a fresh `slice/03-local-offline` worktree/branch from that exact live `main` using the Superpowers worktree workflow. Do not implement on the design branch and do not write directly to `main`.
- Local database name is exactly `mdp-local`.
- Shipping IndexedDB schema version is exactly `2`.
- Version `1` creates exactly five product object stores: `memories`, `evidence`, `ledgerEvents`, `facts`, `currentFacts`.
- Version `2` adds indexes only; valid version-1 canonical content is not rewritten or discarded.
- `@mdp/domain` must not import or reference IndexedDB, Service Worker, `window`, `navigator`, Cache Storage, Vite PWA tooling, or any browser infrastructure API.
- Browser memory operations reuse `createMemoryRequestSchema`, `memoryQuerySchema`, `correctMemoryRequestSchema`, `createTextMemoryRecord`, `createTextCorrectionRecord`, `orderTextFactHistory`, and UUID v7 generation from `@mdp/shared`.
- Active Slice 03 PWA memory path is IndexedDB only. No API/IndexedDB runtime switching, HTTP fallback, dual-write, import, export, queued mutation, Background Sync, or synchronization.
- Offline covers create, query, correct, history, and append-only restore.
- Mutations are all-or-nothing IndexedDB transactions and publish success only after transaction completion.
- Original Evidence, LedgerEvent, and Fact records remain append-only/immutable; only `CurrentFact` projection moves.
- Correction/restore uses `expectedCurrentFactId`; stale state cannot silently win.
- Root Facts omit the persisted `supersedesFactId` property; the adapter maps the missing key to domain/history `null`.
- The `facts.supersedesFactId` IndexedDB index is unique for correction facts.
- `currentFacts` is keyed by `factId`; do not add a global unique `memoryId` index.
- `CurrentFact.recordedAt` stays the original memory recording time through corrections/restores.
- Normal query reads current projection only and preserves deterministic case-insensitive substring matching with newest `recordedAt`, then ascending `factId` tie-break.
- Local errors include `VALIDATION_FAILED`, `NOT_FOUND`, `STALE_CORRECTION`, `NO_CHANGE`, `LOCAL_STORAGE_UNAVAILABLE`, `LOCAL_DATA_INTEGRITY_ERROR` and must not leak submitted text, IndexedDB internals, stack traces, store dumps, or technical UUIDs.
- Hidden automatic retries are forbidden for local mutations.
- Service Worker caches only app shell/versioned static assets; memory/API responses are never cached as product data.
- New Service Worker versions use controlled prompt behavior and do not force takeover during active work.
- API readiness is not a gate for healthy local memory operations.
- Real sensitive data remains `NOT AUTHORIZED`; pilot remains `NOT AUTHORIZED`; all tests use synthetic data.
- Cumulative Slice 01–02 PostgreSQL/API tests, E2E, schema checks, PRF manifests, build/runtime checks, and outage proof remain mandatory.
- Universal DoD remains: implementation → automated tests → E2E → acceptance → invariants → evidence → review → CI → gate.

---

## File Structure Map

### Browser repository boundary

- Create `apps/web/src/lib/memory-repository.ts` — persistence-neutral browser application interface and local error model.
- Create `apps/web/src/lib/indexeddb/mdp-local-db.ts` — IndexedDB schema types, versioned migrations, open/request/transaction helpers.
- Create `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts` — local implementation of create/query/correct/history.
- Create `apps/web/src/lib/indexeddb/mdp-local-db.test.ts` — schema/migration tests using isolated fake `IDBFactory` instances.
- Create `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts` — repository transaction, query, history, concurrency, corruption, and reopen tests.

### React composition

- Modify `apps/web/src/App.tsx` — local repository readiness + connectivity status; remove API readiness as an enablement gate.
- Modify `apps/web/src/App.test.tsx` — local readiness/offline tests and synthetic-only warning regression.
- Modify `apps/web/src/main.tsx` — construct the IndexedDB repository and inject it into `App`.
- Modify `apps/web/src/features/memory/StoreMemoryForm.tsx` and test — call repository `create`.
- Modify `apps/web/src/features/memory/QueryMemoryForm.tsx` and test — call repository `query` and pass repository to found result.
- Modify `apps/web/src/features/memory/MemoryFoundResult.tsx` and test — call repository `correct/history`, map local errors, preserve stale behavior, and stop rendering technical Evidence/Event UUIDs.
- Create `apps/web/src/lib/use-connectivity.ts` and test — informational browser Online/Offline state.

### PWA shell

- Modify `apps/web/package.json` and `pnpm-lock.yaml` — add workspace dependencies required by the browser repository plus `fake-indexeddb` and `vite-plugin-pwa` development dependencies.
- Modify `apps/web/vite.config.ts` — configure PWA manifest, static app-shell precache, prompt update behavior, and no runtime API cache.
- Modify `apps/web/tsconfig.app.json` — add vite-plugin-pwa React virtual-module types.
- Modify `apps/web/index.html` — theme metadata and generated static PWA icon links.
- Create `apps/web/public/logo.svg`, `apps/web/public/pwa-64x64.png`, `apps/web/public/pwa-192x192.png`, `apps/web/public/pwa-512x512.png`, `apps/web/public/maskable-icon-512x512.png`, `apps/web/public/apple-touch-icon-180x180.png`, `apps/web/public/favicon.ico` — installability assets generated from one source mark.
- Create `apps/web/src/features/pwa/PwaUpdateNotice.tsx` and test — controlled waiting-worker prompt.
- Modify `apps/web/src/index.css` — compact connectivity/local-readiness/update-notice styling only.
- Create `scripts/verify-slice03-pwa.mjs` — built-artifact assertions for manifest/SW/cache boundary.

### Acceptance and governance

- Create `playwright.offline.config.ts` — isolated one-worker browser acceptance with web preview only and no API server.
- Create `tests/e2e/local-offline.spec.ts` — offline reopen, full memory flow, local failure, v1→v2 browser migration, multi-tab stale, and Service Worker update preservation.
- Modify `package.json` — add `e2e:offline` and PWA verification scripts.
- Create `tests/architecture/slice-03-scope.test.ts` — boundary guards against browser infrastructure in domain and HTTP fallback in active web memory components.
- Modify `.github/workflows/ci.yml` — preserve all existing checks and add Slice 03 verification.
- Create `docs/evidence/slice-03/SLICE-03-EVIDENCE-001.md`, `docs/checkpoints/MDP-SLICE-03-CHECKPOINT-001.md`, `docs/phases/SLICE-03.md`, and `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/*` only after technical acceptance is green.

---

### Task 1: Browser MemoryRepository contract and local error model

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/lib/memory-repository.ts`
- Create: `apps/web/src/lib/memory-repository.test.ts`

**Interfaces:**
- Consumes: existing `CreateMemoryResponse`, `MemoryQueryResponse`, `CorrectMemoryRequest`, `CorrectMemoryResponse`, `MemoryHistoryResponse` from `@mdp/contracts`.
- Produces: `MemoryRepository`, `MemoryRepositoryError`, `MemoryRepositoryErrorCode`; later tasks depend on these exact names.

- [ ] **Step 1: Add the browser domain/shared dependencies and fake IndexedDB test dependency**

Update `apps/web/package.json` so runtime workspace dependencies include `@mdp/domain` and `@mdp/shared`, and dev dependencies include `fake-indexeddb`:

```json
{
  "dependencies": {
    "@mdp/contracts": "workspace:*",
    "@mdp/domain": "workspace:*",
    "@mdp/shared": "workspace:*",
    "react": "latest",
    "react-dom": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@testing-library/user-event": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@vitejs/plugin-react": "latest",
    "fake-indexeddb": "latest",
    "jsdom": "latest",
    "vite": "latest"
  }
}
```

Run:

```bash
pnpm install
```

Expected: lockfile updates without replacing existing workspace dependency ranges.

- [ ] **Step 2: Write the failing repository-boundary test**

Create `apps/web/src/lib/memory-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MemoryRepositoryError } from './memory-repository.js';

describe('MemoryRepositoryError', () => {
  it.each([
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'STALE_CORRECTION',
    'NO_CHANGE',
    'LOCAL_STORAGE_UNAVAILABLE',
    'LOCAL_DATA_INTEGRITY_ERROR',
  ] as const)('preserves stable code %s without exposing a storage cause', (code) => {
    const error = new MemoryRepositoryError(code, new Error('private database detail'));
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
    expect(error.message).not.toContain('private database detail');
  });
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter @mdp/web test -- src/lib/memory-repository.test.ts
```

Expected: FAIL because `memory-repository.ts` does not exist.

- [ ] **Step 4: Implement the minimal stable browser repository contract**

Create `apps/web/src/lib/memory-repository.ts`:

```ts
import type {
  CorrectMemoryRequest,
  CorrectMemoryResponse,
  CreateMemoryResponse,
  MemoryHistoryResponse,
  MemoryQueryResponse,
} from '@mdp/contracts';

export type MemoryRepositoryErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'STALE_CORRECTION'
  | 'NO_CHANGE'
  | 'LOCAL_STORAGE_UNAVAILABLE'
  | 'LOCAL_DATA_INTEGRITY_ERROR';

export class MemoryRepositoryError extends Error {
  constructor(
    readonly code: MemoryRepositoryErrorCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = 'MemoryRepositoryError';
  }
}

export interface MemoryRepository {
  ready(): Promise<void>;
  create(text: string): Promise<CreateMemoryResponse>;
  query(query: string): Promise<MemoryQueryResponse>;
  correct(memoryId: string, request: CorrectMemoryRequest): Promise<CorrectMemoryResponse>;
  history(memoryId: string): Promise<MemoryHistoryResponse>;
}
```

Do not add an HTTP fallback method and do not import `memory-api.ts` here.

- [ ] **Step 5: Run focused test, typecheck, and boundary regression**

Run:

```bash
pnpm --filter @mdp/web test -- src/lib/memory-repository.test.ts
pnpm typecheck
pnpm test -- --run tests/architecture/slice-01-scope.test.ts tests/architecture/slice-02-scope.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/memory-repository.ts apps/web/src/lib/memory-repository.test.ts
git commit -m "feat(slice03): define browser memory repository"
```

---

### Task 2: IndexedDB v1/v2 schema and non-destructive migration

**Files:**
- Create: `apps/web/src/lib/indexeddb/mdp-local-db.ts`
- Create: `apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

**Interfaces:**
- Consumes: native `IDBFactory`, `IDBDatabase`, `IDBTransaction`, `IDBRequest`.
- Produces: `MDP_LOCAL_DB_NAME`, `MDP_LOCAL_DB_VERSION`, `PRODUCT_STORES`, local record interfaces, `openMdpLocalDatabase`, `applyMdpLocalUpgrade`, `requestAsPromise`, `transactionDone`.

- [ ] **Step 1: Write schema/migration RED tests with isolated IDBFactory**

Create `apps/web/src/lib/indexeddb/mdp-local-db.test.ts` with Node test environment and isolated factories:

```ts
// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  MDP_LOCAL_DB_NAME,
  MDP_LOCAL_DB_VERSION,
  PRODUCT_STORES,
  applyMdpLocalUpgrade,
  openMdpLocalDatabase,
  transactionDone,
} from './mdp-local-db.js';

function openAt(factory: IDBFactory, version: 1 | 2): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(MDP_LOCAL_DB_NAME, version);
    request.onupgradeneeded = () => {
      applyMdpLocalUpgrade(request.result, request.transaction!, request.oldVersion, version);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

describe('mdp-local schema', () => {
  it('ships version 2 with exactly five product stores', async () => {
    const db = await openMdpLocalDatabase(new IDBFactory());
    expect(db.version).toBe(MDP_LOCAL_DB_VERSION);
    expect([...db.objectStoreNames]).toEqual([...PRODUCT_STORES]);
    db.close();
  });

  it('upgrades a seeded version-1 database by adding indexes without rewriting records', async () => {
    const factory = new IDBFactory();
    const v1 = await openAt(factory, 1);
    const tx = v1.transaction(PRODUCT_STORES, 'readwrite');
    tx.objectStore('memories').add({
      id: '0198aa00-0000-7000-8000-000000000001',
      recordedAt: new Date('2026-08-17T07:00:00.000Z'),
      occurredAt: null,
      temporalPrecision: 'unknown',
    });
    await transactionDone(tx);
    v1.close();

    const v2 = await openMdpLocalDatabase(factory);
    expect(v2.version).toBe(2);
    expect(v2.transaction('evidence').objectStore('evidence').indexNames.contains('memoryId')).toBe(true);
    expect(v2.transaction('facts').objectStore('facts').index('supersedesFactId').unique).toBe(true);
    expect(v2.transaction('currentFacts').objectStore('currentFacts').index('memoryId').unique).toBe(false);
    expect(await new Promise((resolve, reject) => {
      const request = v2.transaction('memories').objectStore('memories').get('0198aa00-0000-7000-8000-000000000001');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })).toBeTruthy();
    v2.close();
  });
});
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run:

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/mdp-local-db.test.ts
```

Expected: FAIL because schema helpers do not exist.

- [ ] **Step 3: Implement exact local record types and migration helpers**

Create `apps/web/src/lib/indexeddb/mdp-local-db.ts` around these exact public constants and record shapes:

```ts
export const MDP_LOCAL_DB_NAME = 'mdp-local';
export const MDP_LOCAL_DB_VERSION = 2;
export const PRODUCT_STORES = [
  'memories',
  'evidence',
  'ledgerEvents',
  'facts',
  'currentFacts',
] as const;

export interface LocalMemoryRecord {
  id: string;
  recordedAt: Date;
  occurredAt: null;
  temporalPrecision: 'unknown';
}

export interface LocalEvidenceRecord {
  id: string;
  memoryId: string;
  kind: 'text';
  content: string;
  createdAt: Date;
}

export interface LocalLedgerEventRecord {
  id: string;
  memoryId: string;
  evidenceId: string;
  factId?: string;
  supersedesFactId?: string;
  type: 'MEMORY_CREATED' | 'MEMORY_CORRECTED';
  reason?: string | null;
  createdAt: Date;
}

export interface LocalFactRecord {
  id: string;
  memoryId: string;
  evidenceId: string;
  kind: 'autobiographical_statement';
  content: string;
  supersedesFactId?: string;
  createdAt: Date;
}

export interface LocalCurrentFactRecord {
  factId: string;
  memoryId: string;
  evidenceId: string;
  content: string;
  recordedAt: Date;
}
```

Implement ordered upgrades:

```ts
function upgradeToV1(db: IDBDatabase): void {
  db.createObjectStore('memories', { keyPath: 'id' });
  db.createObjectStore('evidence', { keyPath: 'id' });
  db.createObjectStore('ledgerEvents', { keyPath: 'id' });
  db.createObjectStore('facts', { keyPath: 'id' });
  db.createObjectStore('currentFacts', { keyPath: 'factId' });
}

function upgradeToV2(transaction: IDBTransaction): void {
  transaction.objectStore('evidence').createIndex('memoryId', 'memoryId');
  transaction.objectStore('ledgerEvents').createIndex('memoryId', 'memoryId');
  transaction.objectStore('ledgerEvents').createIndex('factId', 'factId');
  transaction.objectStore('ledgerEvents').createIndex('supersedesFactId', 'supersedesFactId');
  transaction.objectStore('facts').createIndex('memoryId', 'memoryId');
  transaction.objectStore('facts').createIndex('supersedesFactId', 'supersedesFactId', {
    unique: true,
  });
  transaction.objectStore('currentFacts').createIndex('memoryId', 'memoryId');
}

export function applyMdpLocalUpgrade(
  db: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  targetVersion: number,
): void {
  if (oldVersion < 1 && targetVersion >= 1) upgradeToV1(db);
  if (oldVersion < 2 && targetVersion >= 2) upgradeToV2(transaction);
}
```

Implement `openMdpLocalDatabase(factory = indexedDB)` so `onupgradeneeded` calls `applyMdpLocalUpgrade` and any open/upgrade failure rejects; never call `deleteDatabase` in production code.

Implement request/transaction completion helpers:

```ts
export function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}
```

- [ ] **Step 4: Add explicit root-key and uniqueness tests**

Extend `mdp-local-db.test.ts` to prove that two root facts without the `supersedesFactId` property can coexist, while two correction facts pointing to the same predecessor cannot commit:

```ts
it('indexes only correction predecessors and rejects a fork', async () => {
  const db = await openMdpLocalDatabase(new IDBFactory());
  const tx = db.transaction('facts', 'readwrite');
  const facts = tx.objectStore('facts');
  facts.add({ id: 'root-a', memoryId: 'm-a', evidenceId: 'e-a', kind: 'autobiographical_statement', content: 'A', createdAt: new Date() });
  facts.add({ id: 'root-b', memoryId: 'm-b', evidenceId: 'e-b', kind: 'autobiographical_statement', content: 'B', createdAt: new Date() });
  await transactionDone(tx);

  const fork = db.transaction('facts', 'readwrite');
  fork.objectStore('facts').add({ id: 'next-a', memoryId: 'm-a', evidenceId: 'e-a2', kind: 'autobiographical_statement', content: 'A2', supersedesFactId: 'root-a', createdAt: new Date() });
  fork.objectStore('facts').add({ id: 'next-b', memoryId: 'm-a', evidenceId: 'e-a3', kind: 'autobiographical_statement', content: 'A3', supersedesFactId: 'root-a', createdAt: new Date() });
  await expect(transactionDone(fork)).rejects.toBeTruthy();
  db.close();
});
```

- [ ] **Step 5: Run focused tests and full web typecheck**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/mdp-local-db.test.ts
pnpm --filter @mdp/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/web/src/lib/indexeddb/mdp-local-db.ts apps/web/src/lib/indexeddb/mdp-local-db.test.ts
git commit -m "feat(slice03): add versioned local database"
```

---

### Task 3: IndexedDB create/query repository path

**Files:**
- Create: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts`
- Create: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 `MemoryRepository`; Task 2 DB helpers; `createMemoryRequestSchema`, `memoryQuerySchema`, `createTextMemoryRecord`, `createId`.
- Produces: `IndexedDbMemoryRepository` implementing `ready/create/query`; Task 4 completes `correct/history`.

- [ ] **Step 1: Write RED tests for creation, atomic rollback, query, tie-break, and reopen**

Start `indexeddb-memory-repository.test.ts` with isolated deterministic dependencies:

```ts
// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IndexedDbMemoryRepository } from './indexeddb-memory-repository.js';

function ids(...values: string[]): () => string {
  const queue = [...values];
  return () => {
    const value = queue.shift();
    if (!value) throw new Error('test id queue exhausted');
    return value;
  };
}

it('creates one complete local memory and returns the stable contract shape', async () => {
  const factory = new IDBFactory();
  const repository = new IndexedDbMemoryRepository({
    factory,
    now: () => new Date('2026-08-17T07:00:00.000Z'),
    createId: ids('m1', 'e1', 'ev1', 'f1'),
  });
  await expect(repository.create('  Memória sintética preservada.  ')).resolves.toMatchObject({
    memory: { id: 'm1', recordedAt: '2026-08-17T07:00:00.000Z' },
    fact: { id: 'f1', content: '  Memória sintética preservada.  ' },
    provenance: { evidenceId: 'e1' },
  });
});

it('rolls back all earlier store writes when a later add fails', async () => {
  const factory = new IDBFactory();
  const first = new IndexedDbMemoryRepository({ factory, createId: ids('m1', 'e1', 'ev1', 'f1') });
  await first.create('Primeiro registro sintético.');

  const second = new IndexedDbMemoryRepository({ factory, createId: ids('m2', 'e2', 'ev2', 'f1') });
  await expect(second.create('Segundo registro sintético.')).rejects.toMatchObject({
    code: 'LOCAL_DATA_INTEGRITY_ERROR',
  });
  await expect(first.query('Segundo registro')).resolves.toEqual({ status: 'UNKNOWN', answer: null, provenance: null });
});

it('queries only current facts, case-insensitively, with deterministic tie-break', async () => {
  // Seed two records with controlled recordedAt values and assert newest, then factId ascending.
});

it('reopens the same factory without losing local records', async () => {
  // Create with repository A, instantiate repository B over the same factory, query with B.
});
```

Replace the two descriptive test bodies before committing with concrete seeding/assertions using deterministic dates/IDs; do not leave comment-only test bodies in the branch.

- [ ] **Step 2: Run focused test and confirm RED**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/indexeddb-memory-repository.test.ts
```

Expected: FAIL because `IndexedDbMemoryRepository` does not exist.

- [ ] **Step 3: Implement constructor/readiness and safe error mapping**

Create `indexeddb-memory-repository.ts` with injected dependencies so tests never patch browser globals:

```ts
interface IndexedDbMemoryRepositoryDependencies {
  factory?: IDBFactory;
  now?: () => Date;
  createId?: () => string;
}

export class IndexedDbMemoryRepository implements MemoryRepository {
  private readonly factory: IDBFactory;
  private readonly now: () => Date;
  private readonly nextId: () => string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dependencies: IndexedDbMemoryRepositoryDependencies = {}) {
    this.factory = dependencies.factory ?? indexedDB;
    this.now = dependencies.now ?? (() => new Date());
    this.nextId = dependencies.createId ?? createId;
  }

  ready(): Promise<void> {
    return this.withMappedFailure(async () => {
      await this.database();
    });
  }

  private database(): Promise<IDBDatabase> {
    this.dbPromise ??= openMdpLocalDatabase(this.factory);
    return this.dbPromise;
  }
}
```

Use one private mapping helper. Preserve an existing `MemoryRepositoryError`; classify quota/unreadable/invalid-state/open failures as `LOCAL_STORAGE_UNAVAILABLE` and constraint/corruption/programmatic invariant failures as `LOCAL_DATA_INTEGRITY_ERROR`. The mapper must use safe stable codes only.

- [ ] **Step 4: Implement transactional `create`**

Use `createMemoryRequestSchema.safeParse({ text })`. On failure throw `MemoryRepositoryError('VALIDATION_FAILED')`. On success:

```ts
const recordedAt = this.now();
const record = createTextMemoryRecord({
  text: parsed.data.text,
  recordedAt,
  ids: {
    memoryId: this.nextId(),
    evidenceId: this.nextId(),
    eventId: this.nextId(),
    factId: this.nextId(),
  },
});
```

Open one `readwrite` transaction across all `PRODUCT_STORES`, `add` the five records, omit correction-only keys from the `MEMORY_CREATED` event, then `await transactionDone(transaction)` before returning:

```ts
return {
  memory: { id: record.memory.id, recordedAt: record.memory.recordedAt.toISOString() },
  fact: { id: record.fact.id, content: record.fact.content },
  provenance: { evidenceId: record.evidence.id },
};
```

- [ ] **Step 5: Implement deterministic current-only `query`**

Validate with `memoryQuerySchema.safeParse(query)`. Read `currentFacts` only with a readonly transaction, normalize with `toLowerCase()`, filter `content.includes(normalized)`, then sort:

```ts
matches.sort((left, right) => {
  const newest = right.recordedAt.getTime() - left.recordedAt.getTime();
  return newest !== 0 ? newest : left.factId.localeCompare(right.factId);
});
```

Return stable `FOUND` provenance or exact `UNKNOWN` shape.

- [ ] **Step 6: Complete the concrete query/reopen tests and run GREEN**

Use deterministic IDs and dates in every test. Commands:

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/indexeddb-memory-repository.test.ts
pnpm --filter @mdp/web typecheck
pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts
git commit -m "feat(slice03): store and query memories locally"
```

---

### Task 4: Local correction, history, restore, stale concurrency, and integrity checks

**Files:**
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`

**Interfaces:**
- Consumes: `correctMemoryRequestSchema`, `createTextCorrectionRecord`, `orderTextFactHistory`, Task 2 memoryId/factId indexes.
- Produces: complete `IndexedDbMemoryRepository.correct()` and `.history()`.

- [ ] **Step 1: Add RED tests for correction and append-only restore**

Add a synthetic Ana→Beatriz→Ana sequence. Assert after first correction:

```ts
await expect(repository.correct('m1', {
  text: 'Minha irmã se chama Beatriz.',
  expectedCurrentFactId: 'f1',
  reason: 'Correção sintética',
})).resolves.toMatchObject({
  memoryId: 'm1',
  current: { factId: 'f2', content: 'Minha irmã se chama Beatriz.' },
  correction: { supersedesFactId: 'f1', reason: 'Correção sintética' },
});

await expect(repository.query('Ana')).resolves.toEqual({ status: 'UNKNOWN', answer: null, provenance: null });
const history = await repository.history('m1');
expect(history.versions.map((version) => version.content)).toEqual([
  'Minha irmã se chama Ana.',
  'Minha irmã se chama Beatriz.',
]);
```

Then correct from current `f2` using the original text and assert a three-version chain; old Fact/Evidence/Event records must still exist.

- [ ] **Step 2: Add RED tests for no-op, stale, same-base concurrency, fork defense, and corrupt history**

Required assertions:

```ts
await expect(repository.correct('m1', {
  text: 'Minha irmã se chama Ana.',
  expectedCurrentFactId: 'f1',
})).rejects.toMatchObject({ code: 'NO_CHANGE' });

await expect(repository.correct('m1', {
  text: 'Versão concorrente.',
  expectedCurrentFactId: 'stale-fact',
})).rejects.toMatchObject({ code: 'STALE_CORRECTION' });
```

For cross-tab behavior, construct two repository instances over one `IDBFactory`, query the same `factId`, and submit two different corrections concurrently with `Promise.allSettled`. Assert exactly one fulfilled result and exactly one rejection with `STALE_CORRECTION`.

For integrity behavior, directly seed a disconnected Fact or mismatched Evidence in a test transaction, call `history`, and assert `LOCAL_DATA_INTEGRITY_ERROR` with no raw content in the error message.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/indexeddb-memory-repository.test.ts
```

Expected: new correction/history tests FAIL because methods are not implemented.

- [ ] **Step 4: Implement stale-safe `correct` in one multi-store transaction**

Inside one `readwrite` transaction over all five stores:

1. `get(memoryId)` from `memories`; if absent throw `NOT_FOUND` without writes.
2. `getAll(memoryId)` from `currentFacts.index('memoryId')`; require exactly one current textual projection.
3. Compare `current.factId` to `expectedCurrentFactId`; mismatch throws `STALE_CORRECTION` before IDs/writes.
4. Validate the request with `correctMemoryRequestSchema` and invoke `createTextCorrectionRecord` with persisted current as `previous`.
5. `add` new Evidence, Fact, and LedgerEvent.
6. Delete old `CurrentFact` by the old `factId` and `add` the new projection.
7. Await transaction completion before returning success.

Map `CorrectionDomainError` exactly:

```ts
switch (error.code) {
  case 'NO_CHANGE':
    throw new MemoryRepositoryError('NO_CHANGE');
  case 'BROKEN_HISTORY':
    throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
  case 'EMPTY_CORRECTION':
  case 'TEXT_TOO_LONG':
  case 'REASON_TOO_LONG':
    throw new MemoryRepositoryError('VALIDATION_FAILED');
}
```

Do not auto-retry an aborted mutation.

- [ ] **Step 5: Implement provenance-validating `history`**

Read target Memory, current projection, all Facts/Evidence/Events for that memory. Enforce before rendering:

```text
exactly one current textual fact
all facts belong to memory
all referenced evidence belongs to memory
fact.kind = autobiographical_statement
evidence.kind = text
fact.content = evidence.content
root fact has no persisted predecessor key
orderTextFactHistory returns one complete root→tip chain ending at current fact
exactly one MEMORY_CREATED event maps the root evidence
exactly one MEMORY_CORRECTED event maps each correction fact
event evidence/fact/predecessor links match the chain
```

Map missing persisted root `supersedesFactId` to `null`, then map ordered versions to the existing `MemoryHistoryResponse` ISO-string contract.

- [ ] **Step 6: Extend the v1→v2 migration test through repository behavior**

Seed a complete valid version-1 textual memory using the v1 schema, close it, instantiate the current repository (which upgrades to v2), then prove:

```ts
expect((await repository.query('sintética')).status).toBe('FOUND');
expect((await repository.history('m-v1')).versions).toHaveLength(1);
await expect(repository.correct('m-v1', {
  text: 'Memória sintética migrada e corrigida.',
  expectedCurrentFactId: 'f-v1',
})).resolves.toMatchObject({ memoryId: 'm-v1' });
```

- [ ] **Step 7: Run repository, domain, contract, and full regression tests**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/mdp-local-db.test.ts src/lib/indexeddb/indexeddb-memory-repository.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all PASS; existing API/PostgreSQL tests are unchanged.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts
git commit -m "feat(slice03): correct and reconstruct local memory history"
```

---

### Task 5: React local-first composition, connectivity, fail-safe UX, and UUID-hiding regression

**Files:**
- Create: `apps/web/src/lib/use-connectivity.ts`
- Create: `apps/web/src/lib/use-connectivity.test.tsx`
- Modify: `apps/web/src/App.tsx:1-end`
- Modify: `apps/web/src/App.test.tsx:1-end`
- Modify: `apps/web/src/main.tsx:1-end`
- Modify: `apps/web/src/features/memory/StoreMemoryForm.tsx:1-end`
- Modify: `apps/web/src/features/memory/StoreMemoryForm.test.tsx:1-end`
- Modify: `apps/web/src/features/memory/QueryMemoryForm.tsx:1-end`
- Modify: `apps/web/src/features/memory/QueryMemoryForm.test.tsx:1-end`
- Modify: `apps/web/src/features/memory/MemoryFoundResult.tsx:1-end`
- Modify: `apps/web/src/features/memory/MemoryFoundResult.test.tsx:1-end`

**Interfaces:**
- Consumes: complete `MemoryRepository`, `MemoryRepositoryError`, `IndexedDbMemoryRepository`.
- Produces: UI that is enabled by local repository readiness, not API readiness or connectivity.

- [ ] **Step 1: Write RED tests for informational connectivity and local readiness**

Create `use-connectivity.test.tsx` that renders a small probe hook component, dispatches `offline`/`online` events, and asserts status changes without persistence calls.

Update `App.test.tsx` to use a fake repository:

```ts
const repository: MemoryRepository = {
  ready: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
  query: vi.fn(),
  correct: vi.fn(),
  history: vi.fn(),
};

render(<App repository={repository} />);
expect(await screen.findByText('Armazenamento local pronto')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
expect(screen.getByRole('button', { name: 'Consultar' })).toBeEnabled();
```

Add a test where `repository.ready()` rejects with `LOCAL_STORAGE_UNAVAILABLE`; assert memory controls are disabled and a safe local-storage error is visible.

Add a test that dispatches `offline`; assert visible `Offline` while controls stay enabled if repository readiness succeeded.

- [ ] **Step 2: Run focused UI tests and confirm RED**

```bash
pnpm --filter @mdp/web test -- src/App.test.tsx src/lib/use-connectivity.test.tsx
```

Expected: FAIL because App still gates on API readiness and the hook does not exist.

- [ ] **Step 3: Implement `useConnectivity`**

Create:

```ts
import { useEffect, useState } from 'react';

export function useConnectivity(): 'online' | 'offline' {
  const [status, setStatus] = useState<'online' | 'offline'>(() =>
    navigator.onLine ? 'online' : 'offline',
  );

  useEffect(() => {
    const online = () => setStatus('online');
    const offline = () => setStatus('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  return status;
}
```

- [ ] **Step 4: Refactor App from API readiness to local repository readiness**

Change `App` signature to:

```ts
export function App({ repository }: { repository: MemoryRepository })
```

Track `checking | ready | unavailable`. In an effect, call `repository.ready()`. Render both states separately:

```text
Online / Offline                 ← informational
Verificando armazenamento local…
Armazenamento local pronto
or
Armazenamento local indisponível ← actual persistence gate
```

`enabled` is `localStatus === 'ready'` only. Do not call `getApiReadiness` from `App`.

Keep the full synthetic-only laboratory warning unchanged.

- [ ] **Step 5: Inject one local repository from `main.tsx`**

Replace API composition with:

```ts
import { IndexedDbMemoryRepository } from './lib/indexeddb/indexeddb-memory-repository.js';

const repository = new IndexedDbMemoryRepository();

createRoot(root).render(
  <StrictMode>
    <App repository={repository} />
  </StrictMode>,
);
```

Do not delete `memory-api.ts`; existing API tests and later synchronization still need that HTTP client boundary.

- [ ] **Step 6: Refactor StoreMemoryForm and QueryMemoryForm to repository methods**

`StoreMemoryForm` props become `{ repository, enabled }`; replace `createMemory(apiBaseUrl, text)` with `repository.create(text)`.

On `LOCAL_STORAGE_UNAVAILABLE`, show:

```text
O armazenamento local está indisponível. A lembrança não foi guardada.
```

Do not clear the textarea after any failed mutation. Only clear after fulfilled repository `create`.

`QueryMemoryForm` props become `{ repository, enabled }`; replace API query with `repository.query(normalized)` and pass the same repository to `MemoryFoundResult`.

- [ ] **Step 7: Refactor MemoryFoundResult to local repository and remove technical UUID presentation**

Props become:

```ts
interface MemoryFoundResultProps {
  repository: MemoryRepository;
  result: FoundResult;
  onCurrentChange: (next: FoundResult) => void;
}
```

Replace `correctMemory/getMemoryHistory/MemoryApiError` with repository methods and `MemoryRepositoryError` code checks. Preserve the existing `internallyPublishedFactId` behavior that keeps `Correção salva` visible after the component publishes its own new fact.

Required safe messages:

```text
STALE_CORRECTION → A lembrança mudou desde esta consulta. Consulte novamente antes de corrigir.
NO_CHANGE → A correção não altera o texto atual.
VALIDATION_FAILED → Revise o texto e o motivo da correção.
LOCAL_STORAGE_UNAVAILABLE → O armazenamento local está indisponível. A correção não foi salva.
LOCAL_DATA_INTEGRITY_ERROR → O histórico local não pôde ser verificado com segurança.
```

Remove this current raw-ID output entirely:

```tsx
<p className="provenance">
  Evidência: {version.evidenceId} · Evento: {version.eventId}
</p>
```

Do not replace it with any other UUID. Keep human-level labels such as Original/Correção/Atual and optional reason.

- [ ] **Step 8: Rewrite component tests around a typed fake repository**

Stop mocking `memory-api.ts` in memory feature tests. Provide `vi.fn()` repository methods and assert exact calls such as:

```ts
expect(repository.correct).toHaveBeenCalledWith('memory-1', {
  text: 'Minha irmã se chama Beatriz.',
  expectedCurrentFactId: 'fact-1',
  reason: 'Correção factual',
});
```

Add a regression assertion after opening history:

```ts
expect(screen.queryByText(/evidence-1|event-1|fact-1/)).not.toBeInTheDocument();
```

- [ ] **Step 9: Run focused UI + full test suite**

```bash
pnpm --filter @mdp/web test
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all PASS; API readiness can be unavailable without disabling healthy local memory UI.

- [ ] **Step 10: Commit Task 5**

```bash
git add apps/web/src apps/web/src/main.tsx
git commit -m "feat(slice03): switch PWA memory flows to local repository"
```

---

### Task 6: Installable PWA app shell and controlled Service Worker updates

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.app.json`
- Modify: `apps/web/index.html`
- Create: `apps/web/public/logo.svg`
- Create generated static icon files under `apps/web/public/`
- Create: `apps/web/src/features/pwa/PwaUpdateNotice.tsx`
- Create: `apps/web/src/features/pwa/PwaUpdateNotice.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/index.css`
- Create: `scripts/verify-slice03-pwa.mjs`
- Modify: root `package.json`

**Interfaces:**
- Consumes: Task 5 App shell.
- Produces: installable manifest, generated Workbox Service Worker with prompt behavior, `PwaUpdateNotice`, and deterministic build verifier.

- [ ] **Step 1: Add vite-plugin-pwa and generate reproducible static PWA assets from one SVG source**

Add `vite-plugin-pwa` as an `apps/web` dev dependency and run `pnpm install`.

Create a simple square non-sensitive `apps/web/public/logo.svg` containing only an `MDP` monogram/geometric mark; it must not use a photo or personal data.

Generate standard static assets from that source with the official minimal-2023 generator in a one-time development command:

```bash
pnpm dlx @vite-pwa/assets-generator --preset minimal-2023 --root apps/web public/logo.svg
```

Commit the generated `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, and `favicon.ico`; the production build must not need the generator.

- [ ] **Step 2: Write RED update-notice component test**

Mock `virtual:pwa-register/react` and assert a waiting worker does not update until the user acts:

```ts
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [true, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: updateServiceWorkerMock,
  }),
}));

render(<PwaUpdateNotice />);
expect(screen.getByText('Nova versão disponível')).toBeInTheDocument();
expect(updateServiceWorkerMock).not.toHaveBeenCalled();
await user.click(screen.getByRole('button', { name: 'Atualizar' }));
expect(updateServiceWorkerMock).toHaveBeenCalledWith(true);
```

- [ ] **Step 3: Run focused test and confirm RED**

```bash
pnpm --filter @mdp/web test -- src/features/pwa/PwaUpdateNotice.test.tsx
```

Expected: FAIL because the PWA virtual module/configuration/component is absent.

- [ ] **Step 4: Configure VitePWA for app-shell-only precache and prompt updates**

Modify `apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'generateSW',
      injectRegister: 'auto',
      manifest: {
        id: '/',
        name: 'Memória Digital Pessoal',
        short_name: 'MDP',
        description: 'Memória textual local em ambiente de laboratório.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,png,svg,ico}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true, host: '127.0.0.1' },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

The explicit empty `runtimeCaching` array is part of the Slice 03 cache boundary.

- [ ] **Step 5: Add PWA React types, metadata, and update notice**

Add `"vite-plugin-pwa/react"` to `compilerOptions.types` in `apps/web/tsconfig.app.json`.

Add to `apps/web/index.html` head:

```html
<meta name="theme-color" content="#ffffff" />
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" href="/logo.svg" sizes="any" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
```

Implement `PwaUpdateNotice` with `useRegisterSW`; render nothing unless `needRefresh` is true, and only call `updateServiceWorker(true)` after explicit `Atualizar` click. Include a `Depois` button that only clears the local prompt state.

Render `<PwaUpdateNotice />` in `App` outside the memory forms so it cannot interrupt transaction logic.

- [ ] **Step 6: Add built-artifact verification**

Create `scripts/verify-slice03-pwa.mjs` using Node `fs/promises`. It must fail unless all are true:

```text
apps/web/dist/manifest.webmanifest exists
manifest id/start_url/scope are '/'
manifest display is 'standalone'
manifest contains 192x192 and 512x512 PNG icons
apps/web/dist/sw.js exists
apps/web/dist/index.html references manifest registration output
sw.js does not contain http://127.0.0.1:3000
sw.js does not contain an explicit /memories runtime route
all manifest icon files exist in dist
```

Add root script:

```json
"verify:pwa": "node scripts/verify-slice03-pwa.mjs"
```

- [ ] **Step 7: Run component/build/artifact checks**

```bash
pnpm --filter @mdp/web test -- src/features/pwa/PwaUpdateNotice.test.tsx
pnpm build
pnpm verify:pwa
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all PASS. Inspect `apps/web/dist/sw.js` only as a build artifact; never commit `dist`.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/vite.config.ts apps/web/tsconfig.app.json apps/web/index.html apps/web/public apps/web/src/features/pwa apps/web/src/App.tsx apps/web/src/index.css scripts/verify-slice03-pwa.mjs package.json
git commit -m "feat(slice03): make web app installable offline"
```

---

### Task 7: Real-browser offline, migration, failure, multi-tab, and Service Worker update acceptance

**Files:**
- Create: `playwright.offline.config.ts`
- Create: `tests/e2e/local-offline.spec.ts`
- Modify: root `package.json`

**Interfaces:**
- Consumes: production `apps/web/dist`, IndexedDB v2, generated Service Worker.
- Produces: `pnpm e2e:offline`, an isolated Chromium acceptance suite that starts only web preview; no NestJS/API process is available.

- [ ] **Step 1: Create isolated offline Playwright config**

Create `playwright.offline.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'local-offline.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm --filter @mdp/web preview',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
```

Add root script:

```json
"e2e:offline": "playwright test --config playwright.offline.config.ts"
```

Do not start the API in this config; absence of the API is part of acceptance.

- [ ] **Step 2: Write RED full offline reopen flow**

In `local-offline.spec.ts`, wait for the Service Worker before going offline:

```ts
await page.goto('/');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.getByLabel('Lembrança').fill('Minha irmã se chama Ana.');
await page.getByRole('button', { name: 'Guardar' }).click();
await expect(page.getByText('Lembrança guardada.')).toBeVisible();

await page.close();
await context.setOffline(true);
const offlinePage = await context.newPage();
await offlinePage.goto('/');
await expect(offlinePage.getByText('Offline')).toBeVisible();
```

Continue on the same offline page:

```text
query Ana → FOUND
correct Ana → Beatriz
query Ana → UNKNOWN
query Beatriz → FOUND
open history → original + correction
restore Ana as new correction
history → exactly 3 versions
reload while offline
query Ana → restored FOUND
history still 3 versions
```

Record page requests before the flow and assert no request URL uses port `3000`.

- [ ] **Step 3: Write RED multi-tab stale-write acceptance**

With one context and two pages, query the same current memory in both, open both correction forms, submit page A first, then page B. Assert page B shows the stale message and does not silently replace page A's content.

- [ ] **Step 4: Write RED browser local-storage failure acceptance**

Create a fresh context with init script replacing `window.indexedDB` with an object whose `open()` throws a safe synthetic `DOMException`. Navigate to `/` and assert:

```text
Armazenamento local indisponível is visible
Guardar is disabled
Consultar is disabled
no Memória/Lembrança salva success message appears
no fallback request to port 3000 occurs
```

- [ ] **Step 5: Write RED real-browser v1→v2 migration acceptance**

Before loading application JavaScript, temporarily fulfill `/` with minimal same-origin HTML, then use `page.evaluate` to open `mdp-local` version 1 and seed one complete valid Memory/Evidence/MEMORY_CREATED/Fact/CurrentFact record. Remove the route and navigate to the real app. Assert the production v2 code upgrades the database, query finds the seeded current text, history shows one version, and a correction commits successfully.

Do not create any sixth product store for migration metadata.

- [ ] **Step 6: Write real waiting-Service-Worker update preservation acceptance**

Because this suite owns one worker and the preview serves the already-built `dist`, use Node `fs/promises` from the Playwright test to:

1. read and save original `apps/web/dist/sw.js` bytes;
2. seed/query one local memory and wait for current registration;
3. append one harmless build-revision comment to `dist/sw.js`;
4. call `registration.update()` in the page;
5. wait for the application's `Nova versão disponível` prompt;
6. click `Atualizar`;
7. wait for reload/controller change;
8. query the seeded memory again and verify history remains intact;
9. restore the original `sw.js` in a `finally` block even on failure.

This proves a changed worker can activate/reload without deleting `mdp-local`. The test must never mutate committed source files.

- [ ] **Step 7: Build once, run the offline suite, and confirm GREEN**

```bash
pnpm build
pnpm verify:pwa
pnpm exec playwright install chromium
pnpm e2e:offline
```

Expected: all Slice 03 offline acceptance cases PASS with only Vite preview running.

- [ ] **Step 8: Run existing browser regression separately**

Start PostgreSQL as required by the existing suite, then:

```bash
pnpm e2e
```

Expected: Foundation + Slice 01 + Slice 02 existing E2E remain PASS.

- [ ] **Step 9: Commit Task 7**

```bash
git add playwright.offline.config.ts tests/e2e/local-offline.spec.ts package.json
git commit -m "test(slice03): prove local PWA offline in chromium"
```

---

### Task 8: Architecture guards, CI progression, evidence, review, and gate preparation

**Files:**
- Create: `tests/architecture/slice-03-scope.test.ts`
- Modify: `.github/workflows/ci.yml`
- Create after technical green: `docs/evidence/slice-03/SLICE-03-EVIDENCE-001.md`
- Create after technical green: `docs/checkpoints/MDP-SLICE-03-CHECKPOINT-001.md`
- Create after technical green: `docs/phases/SLICE-03.md`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/README.md`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-PLAN.md`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-DECISIONS.md`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-CHECKPOINT.yaml`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-REPORT.md`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-VALIDATION.txt`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-VALIDATION-FULL.txt`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-SMOKE.txt`
- Create after technical green: `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-ARTIFACT-MANIFEST.sha256`

**Interfaces:**
- Consumes: all prior tasks and existing CI.
- Produces: cumulative executable guardrails, PRF/evidence, review checkpoint, and a gate-ready exact HEAD; does not merge without authority.

- [ ] **Step 1: Write RED architecture boundary test**

Create `tests/architecture/slice-03-scope.test.ts` that reads repository source files and asserts:

```ts
const forbiddenDomainPatterns = [
  /indexedDB/i,
  /IDBDatabase/,
  /serviceWorker/i,
  /CacheStorage/,
  /\bwindow\b/,
  /\bnavigator\b/,
  /vite-plugin-pwa/,
];
```

Every file under `packages/domain/src` must match none of those patterns.

Also assert active memory UI files under `apps/web/src/features/memory` do not import `memory-api`, do not call `fetch`, and do not render the literal labels `Evidência:` or `Evento:` followed by technical IDs.

Assert the local database source contains exactly `mdp-local`, version `2`, and the five approved store names.

- [ ] **Step 2: Run architecture test and confirm RED if any boundary remains**

```bash
pnpm test -- --run tests/architecture/slice-03-scope.test.ts
```

Expected before all cleanup: fail on any remaining HTTP coupling/raw-ID output; after fixes: PASS.

- [ ] **Step 3: Extend CI without removing any existing step**

Keep every existing PostgreSQL/schema/typecheck/lint/format/manifest/test/build/runtime/Chromium/E2E/outage step. Add after `pnpm build`:

```yaml
- name: Verify Slice 03 PWA build
  run: pnpm verify:pwa
```

After Chromium installation and existing `pnpm e2e`, add:

```yaml
- name: Verify Slice 03 offline browser acceptance
  run: pnpm e2e:offline
```

Do not weaken or replace the existing PostgreSQL outage proof.

Once the Slice 03 PRF is finalized, add:

```yaml
- name: Verify Slice 03 PRF manifest
  working-directory: artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE
  run: sha256sum -c PHASE-03-ARTIFACT-MANIFEST.sha256
```

- [ ] **Step 4: Run the complete local verification sequence on the exact candidate HEAD**

With PostgreSQL healthy where existing tests require it:

```bash
pnpm install --frozen-lockfile
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm verify:pwa
pnpm exec playwright install chromium
pnpm e2e
pnpm e2e:offline
```

Then execute the existing real PostgreSQL outage verification exactly as CI does. Record command outputs and exact HEAD SHA.

- [ ] **Step 5: Create evidence and PRF from observed results only**

`SLICE-03-EVIDENCE-001.md` and `PHASE-03-REPORT.md` must record exact observed counts/SHAs/run IDs, not predicted values. Evidence must include:

```text
candidate HEAD
CI run/job IDs
unit/integration/architecture test counts
existing E2E count
new offline E2E count
IndexedDB v1→v2 migration PASS
same-base multi-tab stale proof PASS
local failure false-success proof PASS
PWA manifest/SW build proof PASS
API/PostgreSQL regression PASS
real PostgreSQL outage proof PASS
real sensitive data NOT AUTHORIZED
pilot NOT AUTHORIZED
Slice 04 NOT STARTED / NOT AUTHORIZED
```

Compute the SHA-256 manifest only after all PRF files are final; CI must verify it.

- [ ] **Step 6: Run review against the exact candidate HEAD**

Perform MESTRE technical review and applicable MCF review/audit steps against the exact SHA. Classify findings:

```text
BLOCKER → fix before gate
REQUIRED_FOR_ACCEPTANCE → fix before gate
FUTURE_OR_IMPROVEMENT → backlog with rationale
```

After any product-code fix, rerun the full relevant verification and update evidence to the new exact HEAD. Never reuse a prior green CI run as proof for a changed HEAD.

- [ ] **Step 7: Obtain fresh CI on the final review-clean HEAD**

Push the exact candidate and require CI SUCCESS for all cumulative and Slice 03 checks. Freeze final evidence/PRF to that HEAD and CI run.

- [ ] **Step 8: Prepare the HUMAN_GATE without merging**

Present LEANDRO with:

```text
exact final branch HEAD
fresh CI run/job IDs
all automated test counts
all E2E counts
PWA/offline/migration/concurrency/failure evidence
open Critical/Important findings = 0
applicable Emily/LÉO gate state exactly as actually executed, never inferred
real sensitive data NOT AUTHORIZED
pilot NOT AUTHORIZED
Slice 04 NOT AUTHORIZED
```

Merge only after explicit compatible authority. If an expected independent gate is unavailable, report `NOT PERFORMED / NOT CLAIMED`; do not simulate it.

- [ ] **Step 9: Commit final pre-gate evidence state**

```bash
git add tests/architecture/slice-03-scope.test.ts .github/workflows/ci.yml docs/evidence/slice-03 docs/checkpoints/MDP-SLICE-03-CHECKPOINT-001.md docs/phases/SLICE-03.md artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE
git commit -m "docs(slice03): freeze gate evidence"
```

After this commit, run fresh CI again because evidence/manifest changes advance HEAD.

---

## Final Spec-to-Task Coverage

| Approved requirement | Implemented/proved by |
|---|---|
| Full create/query/correct/history/restore offline flow | Tasks 3–5, browser proof Task 7 |
| IndexedDB active source only | Tasks 1, 3–5, architecture guard Task 8 |
| Five conceptual stores | Task 2 |
| App shell only in Service Worker cache | Task 6 + Task 7 + build verifier |
| Atomic local mutations | Tasks 3–4 |
| Permanent client UUID v7 IDs | Tasks 3–4 via `@mdp/shared` |
| Non-destructive DB upgrades | Task 2 + repository migration Task 4 + browser migration Task 7 |
| Visible Offline state without disabling local flows | Task 5 + Task 7 |
| No server import | Architecture/behavior Tasks 5, 7, 8 |
| `expectedCurrentFactId` stale protection | Task 4 + multi-tab Task 7 |
| Controlled Service Worker updates | Task 6 + real changed-worker proof Task 7 |
| Fail-safe storage behavior | Tasks 3–5 + browser failure Task 7 |
| Domain independent from IndexedDB/browser APIs | Task 8 |
| Current-only deterministic query | Task 3 + offline flow Task 7 |
| Explicit history/provenance integrity | Task 4 |
| Restore append-only | Task 4 + Task 7 |
| API readiness does not gate local memory | Task 5 + offline web-only server Task 7 |
| Existing Slice 01–02 regression remains mandatory | Tasks 4, 5, 7, 8 |
| Synthetic-only boundary | Task 5 UI regression + Task 8 evidence/gate |

## Execution Boundary

This plan is complete only as a planning artifact. Do not begin Task 1 until LEANDRO separately authorizes implementation.

When implementation is authorized, first verify live `main`, invoke the required worktree skill, create the fresh Slice 03 implementation branch/worktree, and then execute tasks strictly in order with RED→GREEN evidence and review between task boundaries.
