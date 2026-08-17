# Slice 03 — Local PWA + Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing textual-memory PWA fully usable on one browser/device without network access by moving the active web persistence path to IndexedDB while preserving all Slice 01–02 trust, history, concurrency, and regression guarantees.

**Architecture:** Add a browser-side `MemoryRepository` boundary and a native IndexedDB implementation backed by the five approved product stores. React depends on that repository instead of the HTTP memory client; NestJS/PostgreSQL remains intact for cumulative regression and future synchronization. `vite-plugin-pwa` generates a versioned app-shell Service Worker with prompt-based update behavior; user memory data never enters Cache Storage.

**Tech Stack:** Current workspace React + TypeScript 6.0.3 + Vite + Vitest, native IndexedDB, `fake-indexeddb` for fast isolated DB tests, Playwright Chromium for real-browser acceptance, `@mdp/domain`, `@mdp/contracts`, `@mdp/shared`, and `vite-plugin-pwa`/Workbox for the app shell.

## Global Constraints

- Approved specification: `docs/superpowers/specs/2026-08-17-slice-03-local-pwa-offline-design.md`.
- This plan does **not** authorize implementation. Task 1 begins only after separate explicit authorization from LEANDRO.
- At execution time, re-read live `main`, invoke `superpowers:using-git-worktrees`, and create a fresh `slice/03-local-offline` branch/worktree from that exact live `main`. Never implement on the design branch or directly on `main`.
- Local DB name: exactly `mdp-local`.
- Shipping local schema version: exactly `2`.
- V1 creates exactly five stores: `memories`, `evidence`, `ledgerEvents`, `facts`, `currentFacts`.
- V2 adds indexes only and preserves valid v1 content.
- `@mdp/domain` remains independent from IndexedDB, Service Worker, Cache Storage, `window`, `navigator`, and Vite PWA infrastructure.
- Browser logic reuses `createMemoryRequestSchema`, `memoryQuerySchema`, `correctMemoryRequestSchema`, `createTextMemoryRecord`, `createTextCorrectionRecord`, `orderTextFactHistory`, and UUID v7 generation from `@mdp/shared`.
- Slice 03 PWA persistence is IndexedDB-only. No API fallback, dual-write, import, export, queued mutation, Background Sync, or synchronization.
- Offline operations: create, query, correct, history, append-only restore.
- Mutations publish success only after the encompassing IndexedDB transaction completes.
- Evidence, LedgerEvent, and Fact remain append-only; CurrentFact is the mutable reconstructible projection.
- Corrections/restores require `expectedCurrentFactId`; stale state cannot silently win.
- Root Facts omit the persisted `supersedesFactId` key; adapter maps missing root key to `null` in domain/history shapes.
- `facts.supersedesFactId` index is unique for correction records.
- `currentFacts` is keyed by `factId`; its `memoryId` index is non-unique.
- `CurrentFact.recordedAt` preserves original memory recording time through corrections/restores.
- Query reads CurrentFact only, case-insensitive substring, newest `recordedAt` first, ascending `factId` as tie-break.
- Stable local operation error codes: `VALIDATION_FAILED`, `NOT_FOUND`, `STALE_CORRECTION`, `NO_CHANGE`, `LOCAL_STORAGE_UNAVAILABLE`, `LOCAL_DATA_INTEGRITY_ERROR`.
- Errors must not leak submitted memory text, stack traces, object-store dumps, raw storage errors, or technical UUIDs.
- No hidden automatic retry for local mutations.
- Service Worker caches only app-shell/versioned static assets and never caches memory API responses as product data.
- New Service Workers wait; activation is user-controlled rather than unconditional mid-session takeover.
- API readiness/connectivity cannot disable healthy local memory operations.
- Real sensitive data remains `NOT AUTHORIZED`; pilot remains `NOT AUTHORIZED`; all implementation evidence uses synthetic data.
- Existing Slice 01–02 PostgreSQL/API tests, physical schema checks, PRF manifests, build/runtime checks, E2E, and real PostgreSQL outage proof remain mandatory.
- Universal DoD remains implementation → automated tests → E2E → acceptance → invariants → evidence → review → CI → gate.

---

## File Structure Map

### Browser persistence

- Create `apps/web/src/lib/memory-repository.ts` — browser application contract + safe local error model.
- Create `apps/web/src/lib/indexeddb/mdp-local-db.ts` — five-store types, DB v1/v2 migrations, request/transaction helpers.
- Create `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts` — IndexedDB create/query/correct/history implementation.
- Create `apps/web/src/lib/indexeddb/mdp-local-db.test.ts` — schema, index, migration tests.
- Create `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts` — atomicity, query, correction, history, restore, concurrency, integrity, reopen tests.

### React

- Modify `apps/web/src/App.tsx` and test — local readiness and Online/Offline state; API readiness no longer gates forms.
- Modify `apps/web/src/main.tsx` — instantiate and inject the local repository.
- Modify `StoreMemoryForm`, `QueryMemoryForm`, `MemoryFoundResult` and their tests — repository dependency instead of HTTP helpers.
- Create `apps/web/src/lib/use-connectivity.ts` and test — informational connectivity hook.
- Preserve `apps/web/src/lib/memory-api.ts` and its tests as API regression/future synchronization infrastructure.

### PWA

- Modify `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/vite.config.ts`, `apps/web/tsconfig.app.json`, `apps/web/index.html`.
- Create `apps/web/public/logo.svg` and generated standard PWA raster assets.
- Create `apps/web/src/features/pwa/PwaUpdateNotice.tsx` and test.
- Create `scripts/verify-slice03-pwa.mjs`.
- Modify `apps/web/src/index.css` only for status/update-notice presentation.

### Acceptance/governance

- Create `playwright.offline.config.ts` and `tests/e2e/local-offline.spec.ts`.
- Create `tests/architecture/slice-03-scope.test.ts`.
- Modify root `package.json` and `.github/workflows/ci.yml`.
- After technical GREEN, create Slice 03 evidence/checkpoint/phase/PRF artifacts from observed outputs only.

---

### Task 1: Define the browser MemoryRepository boundary

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/lib/memory-repository.ts`
- Create: `apps/web/src/lib/memory-repository.test.ts`

**Interfaces:**
- Consumes: current contract response/request types from `@mdp/contracts`.
- Produces: `MemoryRepository`, `MemoryRepositoryError`, `MemoryRepositoryErrorCode`.

- [ ] **Step 1: Add browser workspace/test dependencies**

Add `@mdp/domain` and `@mdp/shared` under `dependencies`, and `fake-indexeddb` under `devDependencies`, preserving the repository's existing `workspace:*`/`latest` conventions. Run:

```bash
pnpm install
```

- [ ] **Step 2: Write the failing error-contract test**

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
  ] as const)('keeps stable safe code %s', (code) => {
    const error = new MemoryRepositoryError(code, new Error('private storage detail'));
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
    expect(error.message).not.toContain('private storage detail');
  });
});
```

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @mdp/web test -- src/lib/memory-repository.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the exact repository contract**

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

There is deliberately no HTTP fallback method.

- [ ] **Step 5: Verify GREEN and old architecture regression**

```bash
pnpm --filter @mdp/web test -- src/lib/memory-repository.test.ts
pnpm typecheck
pnpm exec vitest run tests/architecture/slice-01-scope.test.ts tests/architecture/slice-02-scope.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/memory-repository.ts apps/web/src/lib/memory-repository.test.ts
git commit -m "feat(slice03): define browser memory repository"
```

---

### Task 2: Add IndexedDB v1/v2 schema and migration

**Files:**
- Create: `apps/web/src/lib/indexeddb/mdp-local-db.ts`
- Create: `apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

**Interfaces:**
- Produces: `MDP_LOCAL_DB_NAME`, `MDP_LOCAL_DB_VERSION`, `PRODUCT_STORES`, local record interfaces, `applyMdpLocalUpgrade`, `openMdpLocalDatabase`, `requestAsPromise`, `transactionDone`.

- [ ] **Step 1: Write failing schema tests**

Use Node test environment and `IDBFactory` from `fake-indexeddb`:

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
  requestAsPromise,
  transactionDone,
} from './mdp-local-db.js';

function openAt(factory: IDBFactory, version: 1 | 2): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(MDP_LOCAL_DB_NAME, version);
    request.onupgradeneeded = (event) => {
      applyMdpLocalUpgrade(request.result, request.transaction!, event.oldVersion, version);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

it('ships v2 with exactly five product stores', async () => {
  const db = await openMdpLocalDatabase(new IDBFactory());
  expect(db.version).toBe(MDP_LOCAL_DB_VERSION);
  expect([...db.objectStoreNames]).toEqual([...PRODUCT_STORES]);
  db.close();
});

it('upgrades v1 by adding indexes without deleting seeded memory', async () => {
  const factory = new IDBFactory();
  const v1 = await openAt(factory, 1);
  const write = v1.transaction('memories', 'readwrite');
  write.objectStore('memories').add({
    id: 'm-v1',
    recordedAt: new Date('2026-08-17T07:00:00.000Z'),
    occurredAt: null,
    temporalPrecision: 'unknown',
  });
  await transactionDone(write);
  v1.close();

  const v2 = await openMdpLocalDatabase(factory);
  expect(v2.transaction('evidence').objectStore('evidence').indexNames.contains('memoryId')).toBe(true);
  expect(v2.transaction('facts').objectStore('facts').index('supersedesFactId').unique).toBe(true);
  expect(v2.transaction('currentFacts').objectStore('currentFacts').index('memoryId').unique).toBe(false);
  expect(await requestAsPromise(v2.transaction('memories').objectStore('memories').get('m-v1'))).toBeTruthy();
  v2.close();
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/mdp-local-db.test.ts
```

- [ ] **Step 3: Implement exact DB constants, types, and ordered upgrades**

The public constants and store order are:

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
```

Record types mirror PostgreSQL conceptually. Correction-only fields are optional in local event/fact record interfaces so root/creation records omit those properties.

V1:

```ts
function upgradeToV1(db: IDBDatabase): void {
  db.createObjectStore('memories', { keyPath: 'id' });
  db.createObjectStore('evidence', { keyPath: 'id' });
  db.createObjectStore('ledgerEvents', { keyPath: 'id' });
  db.createObjectStore('facts', { keyPath: 'id' });
  db.createObjectStore('currentFacts', { keyPath: 'factId' });
}
```

V2:

```ts
function upgradeToV2(transaction: IDBTransaction): void {
  transaction.objectStore('evidence').createIndex('memoryId', 'memoryId');
  transaction.objectStore('ledgerEvents').createIndex('memoryId', 'memoryId');
  transaction.objectStore('ledgerEvents').createIndex('factId', 'factId');
  transaction.objectStore('ledgerEvents').createIndex('supersedesFactId', 'supersedesFactId');
  transaction.objectStore('facts').createIndex('memoryId', 'memoryId');
  transaction.objectStore('facts').createIndex('supersedesFactId', 'supersedesFactId', { unique: true });
  transaction.objectStore('currentFacts').createIndex('memoryId', 'memoryId');
}
```

Upgrade dispatcher:

```ts
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

`openMdpLocalDatabase(factory = indexedDB)` opens version 2 and invokes this dispatcher from `onupgradeneeded`. Production code never calls `deleteDatabase` as an upgrade strategy.

Request helper:

```ts
export function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
```

Transaction helper resolves only on `complete`, rejects on `abort`/`error`.

- [ ] **Step 4: Add root/fork persistence defense test**

Use two root Fact records that omit `supersedesFactId`; they must commit. In a later transaction add two correction Facts with the same `supersedesFactId: 'root-a'`; `transactionDone()` must reject. This proves independent roots are allowed while one predecessor cannot fork.

- [ ] **Step 5: Verify GREEN**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/mdp-local-db.test.ts
pnpm --filter @mdp/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/indexeddb/mdp-local-db.ts apps/web/src/lib/indexeddb/mdp-local-db.test.ts
git commit -m "feat(slice03): add versioned local database"
```

---

### Task 3: Implement local create and current-only query

**Files:**
- Create: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts`
- Create: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`

**Interfaces:**
- Consumes: Task 2 DB helpers, `createMemoryRequestSchema`, `memoryQuerySchema`, `createTextMemoryRecord`, `createId`.
- Produces: `IndexedDbMemoryRepository.ready/create/query`. Do **not** declare `implements MemoryRepository` until Task 4 adds `correct/history`.

- [ ] **Step 1: Write fully concrete failing tests**

Create a deterministic ID helper:

```ts
function ids(...values: string[]): () => string {
  const queue = [...values];
  return () => {
    const value = queue.shift();
    if (value === undefined) throw new Error('test id queue exhausted');
    return value;
  };
}
```

Creation contract test:

```ts
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
```

Atomic rollback test:

```ts
it('rolls back all stores when a later add violates a key constraint', async () => {
  const factory = new IDBFactory();
  await new IndexedDbMemoryRepository({
    factory,
    createId: ids('m1', 'e1', 'ev1', 'f1'),
  }).create('Primeiro registro sintético.');

  const failing = new IndexedDbMemoryRepository({
    factory,
    createId: ids('m2', 'e2', 'ev2', 'f1'),
  });
  await expect(failing.create('Segundo registro sintético.')).rejects.toMatchObject({
    code: 'LOCAL_DATA_INTEGRITY_ERROR',
  });
  await expect(failing.query('Segundo registro')).resolves.toEqual({
    status: 'UNKNOWN',
    answer: null,
    provenance: null,
  });
});
```

Newest-record query test:

```ts
it('returns the newest matching current fact', async () => {
  const factory = new IDBFactory();
  await new IndexedDbMemoryRepository({
    factory,
    now: () => new Date('2026-08-17T07:00:00.000Z'),
    createId: ids('m1', 'e1', 'ev1', 'f-z'),
  }).create('Registro sintético comum antigo.');
  const repository = new IndexedDbMemoryRepository({
    factory,
    now: () => new Date('2026-08-17T08:00:00.000Z'),
    createId: ids('m2', 'e2', 'ev2', 'f-b'),
  });
  await repository.create('Registro sintético comum novo.');
  await expect(repository.query('COMUM')).resolves.toMatchObject({
    status: 'FOUND',
    provenance: { memoryId: 'm2', factId: 'f-b' },
  });
});
```

Stable tie-break test uses two matching records with the same `recordedAt`, fact IDs `f-b` and `f-a`, and asserts query returns `f-a`.

Reopen test creates through repository A, creates repository B over the same `IDBFactory`, and asserts B can query A's content.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/indexeddb-memory-repository.test.ts
```

- [ ] **Step 3: Implement constructor/readiness and safe failure mapping**

Use injectable dependencies:

```ts
interface IndexedDbMemoryRepositoryDependencies {
  factory?: IDBFactory;
  now?: () => Date;
  createId?: () => string;
}

export class IndexedDbMemoryRepository {
  private readonly factory: IDBFactory;
  private readonly now: () => Date;
  private readonly nextId: () => string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(deps: IndexedDbMemoryRepositoryDependencies = {}) {
    this.factory = deps.factory ?? indexedDB;
    this.now = deps.now ?? (() => new Date());
    this.nextId = deps.createId ?? createId;
  }

  private database(): Promise<IDBDatabase> {
    this.dbPromise ??= openMdpLocalDatabase(this.factory);
    return this.dbPromise;
  }
}
```

`ready()` awaits `database()`. A private `withMappedFailure` preserves existing `MemoryRepositoryError`; storage availability names such as `QuotaExceededError`, `NotReadableError`, `InvalidStateError`, `UnknownError` map to `LOCAL_STORAGE_UNAVAILABLE`; constraint/invariant failures map to `LOCAL_DATA_INTEGRITY_ERROR`.

- [ ] **Step 4: Implement transactional `create`**

Validate with `createMemoryRequestSchema.safeParse({ text })`. On failure throw `VALIDATION_FAILED`. Generate one timestamp and four IDs, call `createTextMemoryRecord`, open one `readwrite` transaction over all five stores, `add` complete Memory/Evidence/MEMORY_CREATED/Fact/CurrentFact records, and return only after `transactionDone(tx)`.

For the creation LedgerEvent, persist only `id`, `memoryId`, `evidenceId`, `type`, `createdAt`; do not persist correction-only properties with `null`/`undefined` values.

- [ ] **Step 5: Implement deterministic `query`**

Validate/normalize using `memoryQuerySchema`. Read `currentFacts` only. Match `content.toLowerCase().includes(parsed.data.toLowerCase())`, sort newest `recordedAt` then ascending `factId`, and return exact existing `FOUND`/`UNKNOWN` contract shapes.

- [ ] **Step 6: Verify GREEN**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/indexeddb-memory-repository.test.ts
pnpm --filter @mdp/web typecheck
pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts
git commit -m "feat(slice03): store and query memories locally"
```

---

### Task 4: Implement correction, history, restore, concurrency, and integrity

**Files:**
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`

**Interfaces:**
- Adds `correct()` and `history()`, then declares `IndexedDbMemoryRepository implements MemoryRepository`.

- [ ] **Step 1: Add failing Ana → Beatriz → Ana history/restore test**

Create one memory with IDs `m1/e1/ev1/f1`. Configure correction IDs `e2/ev2/f2`, correct to Beatriz, then correction IDs `e3/ev3/f3`, restore Ana. Assert:

```ts
expect((await repository.query('Beatriz')).status).toBe('FOUND');
expect((await repository.query('Ana')).status).toBe('UNKNOWN');

await repository.correct('m1', {
  text: 'Minha irmã se chama Ana.',
  expectedCurrentFactId: 'f2',
});

const history = await repository.history('m1');
expect(history.versions.map((version) => version.content)).toEqual([
  'Minha irmã se chama Ana.',
  'Minha irmã se chama Beatriz.',
  'Minha irmã se chama Ana.',
]);
expect(history.versions.map((version) => version.isCurrent)).toEqual([false, false, true]);
```

Also query Beatriz after restore and assert `UNKNOWN`.

- [ ] **Step 2: Add failing validation/no-op/stale/concurrency tests**

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

For same-base concurrency, instantiate repository A and B over the same `IDBFactory`, both use `expectedCurrentFactId: 'f1'`, and submit different corrections with `Promise.allSettled`. Assert one result is fulfilled, one is rejected, and the rejected reason has `code === 'STALE_CORRECTION'`.

- [ ] **Step 3: Add failing broken-history test**

After a valid create, directly insert one Fact whose Evidence belongs to another memory or whose predecessor disconnects from the root. `repository.history('m1')` must reject with `LOCAL_DATA_INTEGRITY_ERROR`. Assert the error message is exactly the stable code and does not contain synthetic content or raw IDs.

- [ ] **Step 4: Verify RED**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/indexeddb-memory-repository.test.ts
```

- [ ] **Step 5: Implement `correct` with validation before transaction and stale check inside transaction**

1. Validate `request` with `correctMemoryRequestSchema.safeParse()` before opening a write transaction; invalid input throws `VALIDATION_FAILED` with no storage mutation.
2. Open one `readwrite` transaction over all five stores.
3. Read target Memory; absent → `NOT_FOUND`.
4. Read `currentFacts.index('memoryId').getAll(memoryId)`; require exactly one current textual projection.
5. Compare `factId` with `expectedCurrentFactId`; mismatch → `STALE_CORRECTION` and abort/no writes.
6. Generate correction IDs and call `createTextCorrectionRecord` with persisted current as `previous`.
7. Add new Evidence, correction Fact with explicit predecessor, and `MEMORY_CORRECTED` event.
8. Delete old CurrentFact by old `factId`, add new CurrentFact in the same transaction.
9. Await `transactionDone()` before returning `CorrectMemoryResponse`.

Map `CorrectionDomainError`: `NO_CHANGE` → `NO_CHANGE`; empty/too-long text or reason → `VALIDATION_FAILED`; `BROKEN_HISTORY` → `LOCAL_DATA_INTEGRITY_ERROR`.

- [ ] **Step 6: Implement provenance-validating `history`**

Read Memory, current projection, all Facts, Evidence, and LedgerEvents for the target memory. Fail safely unless:

- exactly one current textual projection exists;
- each Fact/Evidence/Event belongs to the requested memory;
- Fact/Evidence kinds and contents agree;
- missing persisted root predecessor maps to domain `null`;
- `orderTextFactHistory` yields one complete root→tip chain ending at current fact;
- exactly one `MEMORY_CREATED` event maps the root;
- exactly one `MEMORY_CORRECTED` event maps every correction Fact and its evidence/predecessor.

Serialize Dates to ISO strings only when returning the existing response contract.

- [ ] **Step 7: Prove complete v1→v2 migration remains writable**

In a separate test, seed a complete valid v1 Memory/Evidence/MEMORY_CREATED/Fact/CurrentFact record, close v1, instantiate the current repository so it upgrades to v2, then assert:

```ts
expect((await repository.query('migrada')).status).toBe('FOUND');
expect((await repository.history('m-v1')).versions).toHaveLength(1);
await expect(repository.correct('m-v1', {
  text: 'Memória sintética migrada e corrigida.',
  expectedCurrentFactId: 'f-v1',
})).resolves.toMatchObject({ memoryId: 'm-v1' });
```

- [ ] **Step 8: Verify repository + cumulative tests**

```bash
pnpm --filter @mdp/web test -- src/lib/indexeddb/mdp-local-db.test.ts src/lib/indexeddb/indexeddb-memory-repository.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts
git commit -m "feat(slice03): correct and reconstruct local memory history"
```

---

### Task 5: Switch React memory flows to local repository

**Files:**
- Create: `apps/web/src/lib/use-connectivity.ts`
- Create: `apps/web/src/lib/use-connectivity.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`, `apps/web/src/main.tsx`
- Modify: `apps/web/src/features/memory/StoreMemoryForm.tsx` and test
- Modify: `apps/web/src/features/memory/QueryMemoryForm.tsx` and test
- Modify: `apps/web/src/features/memory/MemoryFoundResult.tsx` and test

**Interfaces:**
- Consumes: complete `MemoryRepository`, `MemoryRepositoryError`, `IndexedDbMemoryRepository`.
- Produces: local-first UI whose enablement depends on local repository readiness only.

- [ ] **Step 1: Add failing App/connectivity tests**

Use a typed fake repository:

```ts
const repository: MemoryRepository = {
  ready: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
  query: vi.fn(),
  correct: vi.fn(),
  history: vi.fn(),
};
```

Assert after render:

```ts
expect(await screen.findByText('Armazenamento local pronto')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
expect(screen.getByRole('button', { name: 'Consultar' })).toBeEnabled();
```

Dispatch browser `offline`; assert visible `Offline` and both buttons remain enabled. In a second test make `ready()` reject with `LOCAL_STORAGE_UNAVAILABLE`; assert a safe storage alert and both controls disabled.

Create a hook test that dispatches `online`/`offline` events and verifies `useConnectivity()` transitions.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @mdp/web test -- src/App.test.tsx src/lib/use-connectivity.test.tsx
```

- [ ] **Step 3: Implement `useConnectivity`**

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

- [ ] **Step 4: Refactor App and main composition**

`App` becomes `App({ repository }: { repository: MemoryRepository })`. Its effect calls `repository.ready()` and tracks `checking | ready | unavailable`. The form `enabled` value is `localStatus === 'ready'`; connectivity is a separate `Online`/`Offline` indicator.

Keep the synthetic-only laboratory warning unchanged.

`main.tsx` no longer calls web API env/readiness for product enablement:

```ts
const repository = new IndexedDbMemoryRepository();
createRoot(root).render(
  <StrictMode>
    <App repository={repository} />
  </StrictMode>,
);
```

Do not delete the API client/config modules; they remain regression/future sync infrastructure.

- [ ] **Step 5: Refactor StoreMemoryForm and QueryMemoryForm**

Both receive `{ repository, enabled }`. Replace HTTP calls with `repository.create(text)` and `repository.query(normalized)`.

Failed create keeps unsaved text in component state. `LOCAL_STORAGE_UNAVAILABLE` copy:

```text
O armazenamento local está indisponível. A lembrança não foi guardada.
```

Only successful completed create clears the field and shows `Lembrança guardada.`

- [ ] **Step 6: Refactor MemoryFoundResult and hide technical UUIDs**

Props:

```ts
interface MemoryFoundResultProps {
  repository: MemoryRepository;
  result: FoundResult;
  onCurrentChange: (next: FoundResult) => void;
}
```

Use `repository.correct()` and `repository.history()`. Preserve `internallyPublishedFactId` so the component's own successful correction does not immediately clear `Correção salva.`

Error copy:

```text
STALE_CORRECTION → A lembrança mudou desde esta consulta. Consulte novamente antes de corrigir.
NO_CHANGE → A correção não altera o texto atual.
VALIDATION_FAILED → Revise o texto e o motivo da correção.
LOCAL_STORAGE_UNAVAILABLE → O armazenamento local está indisponível. A correção não foi salva.
LOCAL_DATA_INTEGRITY_ERROR → O histórico local não pôde ser verificado com segurança.
```

Delete the current history line that renders `Evidência: {version.evidenceId} · Evento: {version.eventId}`. No replacement may render `memoryId`, `evidenceId`, `eventId`, `factId`, or predecessor IDs.

- [ ] **Step 7: Rewrite feature tests around repository fakes**

Stop mocking `memory-api.ts`. Assert exact repository calls. Add a history regression:

```ts
expect(screen.queryByText(/evidence-1|event-1|fact-1/)).not.toBeInTheDocument();
```

Add storage-failure tests proving neither `Lembrança guardada.` nor `Correção salva.` appears after rejected persistence.

- [ ] **Step 8: Verify GREEN**

```bash
pnpm --filter @mdp/web test
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(slice03): switch PWA memory flows to local repository"
```

---

### Task 6: Add installable app shell and controlled Service Worker updates

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/vite.config.ts`, `apps/web/tsconfig.app.json`, `apps/web/index.html`, `apps/web/src/App.tsx`, `apps/web/src/index.css`
- Create: `apps/web/public/logo.svg` plus standard generated PWA raster assets
- Create: `apps/web/src/features/pwa/PwaUpdateNotice.tsx` and test
- Create: `scripts/verify-slice03-pwa.mjs`
- Modify: root `package.json`

**Interfaces:**
- Produces: Web App Manifest, Workbox-generated `sw.js`, `PwaUpdateNotice`, `pnpm verify:pwa`.

- [ ] **Step 1: Add vite-plugin-pwa and static installability assets**

Add `vite-plugin-pwa` under web devDependencies and run `pnpm install`.

Create one non-sensitive square `apps/web/public/logo.svg`. Generate committed standard raster assets using the official CLI:

```bash
pnpm dlx @vite-pwa/assets-generator --preset minimal-2023 --root apps/web public/logo.svg
```

Keep generated `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`. The production build does not run the generator.

- [ ] **Step 2: Write failing update-notice test**

Mock `virtual:pwa-register/react` so `needRefresh` is `true`; render `PwaUpdateNotice`; assert `updateServiceWorker` is untouched before user action; click `Atualizar`; assert `updateServiceWorker(true)` exactly once. A `Depois` action only hides the notice.

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @mdp/web test -- src/features/pwa/PwaUpdateNotice.test.tsx
```

- [ ] **Step 4: Configure VitePWA with no runtime API cache**

Add `VitePWA` to `apps/web/vite.config.ts`:

```ts
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
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
})
```

- [ ] **Step 5: Add virtual-module types, metadata, and update UI**

Add `vite-plugin-pwa/react` to web TS `compilerOptions.types`.

Add to HTML head:

```html
<meta name="theme-color" content="#ffffff" />
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" href="/logo.svg" sizes="any" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
```

`PwaUpdateNotice` uses `useRegisterSW`. Render it in `App` outside memory forms. A waiting update is informational until explicit `Atualizar`.

- [ ] **Step 6: Add build verifier**

Create `scripts/verify-slice03-pwa.mjs` using Node `fs/promises`. Fail unless:

- `apps/web/dist/manifest.webmanifest` exists;
- manifest `id/start_url/scope` are `/` and `display` is `standalone`;
- 192×192 and 512×512 PNG manifest icons exist in `dist`;
- `apps/web/dist/sw.js` exists;
- built `index.html` links the manifest/registration output;
- `sw.js` does not contain the API base URL or an explicit `/memories` runtime route.

Add root script:

```json
"verify:pwa": "node scripts/verify-slice03-pwa.mjs"
```

- [ ] **Step 7: Verify GREEN**

```bash
pnpm --filter @mdp/web test -- src/features/pwa/PwaUpdateNotice.test.tsx
pnpm build
pnpm verify:pwa
pnpm typecheck
pnpm lint
pnpm format:check
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/vite.config.ts apps/web/tsconfig.app.json apps/web/index.html apps/web/public apps/web/src/features/pwa apps/web/src/App.tsx apps/web/src/index.css scripts/verify-slice03-pwa.mjs package.json
git commit -m "feat(slice03): make web app installable offline"
```

---

### Task 7: Prove the complete boundary in real Chromium

**Files:**
- Create: `playwright.offline.config.ts`
- Create: `tests/e2e/local-offline.spec.ts`
- Modify: root `package.json`

**Interfaces:**
- Produces: `pnpm e2e:offline`, one-worker web-only acceptance suite with no API process.

- [ ] **Step 1: Create isolated offline Playwright config**

Use `testMatch: 'local-offline.spec.ts'`, `workers: 1`, base URL `http://127.0.0.1:5173`, Chromium Desktop Chrome, and webServer command:

```bash
pnpm --filter @mdp/web preview
```

Do not start NestJS/API. Add:

```json
"e2e:offline": "playwright test --config playwright.offline.config.ts"
```

- [ ] **Step 2: Write failing online-install → offline-reopen full flow**

Flow:

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

Then while still offline: query Ana → FOUND; correct to Beatriz; query Ana → UNKNOWN; query Beatriz → FOUND; view two-version history; restore original text as new correction; verify three versions; reload offline; query restored Ana and verify three-version history persists.

Capture page requests and assert no request URL targets port `3000` during the memory flow.

- [ ] **Step 3: Write failing two-tab stale acceptance**

Two pages query the same current fact before either correction. Submit correction in page A, then page B. Page B must show the stale message and current query must still resolve to page A's committed text.

- [ ] **Step 4: Write failing local-storage-unavailable acceptance**

In a fresh context, install an init script that replaces `window.indexedDB` with a synthetic factory whose `open()` throws `DOMException('synthetic unavailable', 'InvalidStateError')`. Navigate to `/`. Assert storage unavailable message, disabled Guardar/Consultar, no success message, and no request to port 3000.

- [ ] **Step 5: Write failing real-browser v1→v2 migration acceptance**

Before loading app JS, route `/` once to minimal same-origin HTML. In `page.evaluate`, create `mdp-local` version 1 and seed complete valid Memory/Evidence/MEMORY_CREATED/Fact/CurrentFact records. Remove the route and load the real app. Query seeded content, open one-version history, then correct successfully. Assert the database version observed in-browser is 2 and there are still exactly five product stores.

- [ ] **Step 6: Write changed-Service-Worker waiting/activation preservation acceptance**

This one-worker suite may mutate the built `dist/sw.js` temporarily. In `try/finally`:

1. save original `dist/sw.js` bytes;
2. create/query one local memory and capture `navigator.serviceWorker.controller`;
3. append a harmless revision comment to `dist/sw.js`;
4. call `registration.update()`;
5. wait until `registration.waiting` exists;
6. assert current controller has not changed while the new worker is waiting;
7. send `registration.waiting.postMessage({ type: 'SKIP_WAITING' })`;
8. wait for `controllerchange`, reload, then query/history the same local memory;
9. restore original `sw.js` bytes in `finally`.

This proves a changed generated worker waits and can be explicitly activated without deleting IndexedDB.

- [ ] **Step 7: Verify offline suite GREEN**

```bash
pnpm build
pnpm verify:pwa
pnpm exec playwright install chromium
pnpm e2e:offline
```

- [ ] **Step 8: Run existing browser regression separately**

With PostgreSQL available as required by the existing suite:

```bash
pnpm e2e
```

- [ ] **Step 9: Commit**

```bash
git add playwright.offline.config.ts tests/e2e/local-offline.spec.ts package.json
git commit -m "test(slice03): prove local PWA offline in chromium"
```

---

### Task 8: Add architecture guards, CI, evidence, review, and gate

**Files:**
- Create: `tests/architecture/slice-03-scope.test.ts`
- Modify: `.github/workflows/ci.yml`
- After technical GREEN, create Slice 03 evidence/checkpoint/phase and `artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/` PRF files.

**Interfaces:**
- Produces: executable boundary guards and gate-ready evidence tied to exact SHA/CI.

- [ ] **Step 1: Write failing architecture test**

Read all `packages/domain/src` files and reject:

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

Read active memory feature files and assert they do not import `memory-api`, do not call `fetch`, and do not render technical Evidence/Event IDs. Assert local DB source contains name `mdp-local`, version `2`, and exactly the five approved store names.

- [ ] **Step 2: Verify architecture guard**

```bash
pnpm exec vitest run tests/architecture/slice-03-scope.test.ts
```

Fix only Slice 03 boundary violations; do not refactor unrelated code.

- [ ] **Step 3: Extend CI without removing existing checks**

Keep every current PostgreSQL/schema/typecheck/lint/format/PRF/test/build/runtime/Chromium/E2E/outage step. After build add:

```yaml
- name: Verify Slice 03 PWA build
  run: pnpm verify:pwa
```

After existing browser E2E add:

```yaml
- name: Verify Slice 03 offline browser acceptance
  run: pnpm e2e:offline
```

After final PRF creation add its SHA-256 manifest verification exactly like Slices 01–02.

- [ ] **Step 4: Run complete candidate verification**

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

Also run the existing real PostgreSQL outage proof exactly as CI does. Record exact test counts, command outputs, candidate HEAD.

- [ ] **Step 5: Build evidence/PRF only from observed results**

Create:

```text
docs/evidence/slice-03/SLICE-03-EVIDENCE-001.md
docs/checkpoints/MDP-SLICE-03-CHECKPOINT-001.md
docs/phases/SLICE-03.md
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/README.md
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-PLAN.md
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-DECISIONS.md
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-CHECKPOINT.yaml
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-REPORT.md
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-VALIDATION.txt
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-VALIDATION-FULL.txt
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-SMOKE.txt
artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE/PHASE-03-ARTIFACT-MANIFEST.sha256
```

Evidence records actual final HEAD, CI run/job IDs, automated/E2E counts, migration proof, multi-tab stale proof, false-success failure proof, PWA/SW proof, API/PostgreSQL regression, outage proof, and continuing authorization boundaries. Compute manifest only after PRF content is frozen.

- [ ] **Step 6: Review the exact candidate HEAD**

Run MESTRE technical review and applicable MCF review/audit against the exact SHA. Classify findings `BLOCKER`, `REQUIRED_FOR_ACCEPTANCE`, `FUTURE_OR_IMPROVEMENT`. Fix the first two before gate and rerun relevant/full verification on the new SHA.

- [ ] **Step 7: Require fresh CI on final review-clean HEAD**

No prior green run is proof for a changed HEAD. Freeze final evidence only after fresh CI succeeds on the exact final candidate.

- [ ] **Step 8: Prepare HUMAN_GATE; do not merge automatically**

Present exact final branch HEAD, fresh CI run/job IDs, all test/E2E counts, PWA/offline/migration/concurrency/failure evidence, open Critical/Important findings, and the actual Emily/LÉO gate states. If a gate was unavailable, record `NOT PERFORMED / NOT CLAIMED`; never simulate it.

Real sensitive data remains `NOT AUTHORIZED`, pilot remains `NOT AUTHORIZED`, and Slice 04 remains `NOT STARTED / NOT AUTHORIZED` unless separately changed by LEANDRO.

- [ ] **Step 9: Commit final pre-gate evidence and rerun CI**

```bash
git add tests/architecture/slice-03-scope.test.ts .github/workflows/ci.yml docs/evidence/slice-03 docs/checkpoints/MDP-SLICE-03-CHECKPOINT-001.md docs/phases/SLICE-03.md artifacts/phases/SLICE-03-LOCAL-PWA-OFFLINE
git commit -m "docs(slice03): freeze gate evidence"
```

Because this commit advances HEAD, run fresh CI again before requesting HUMAN_GATE.

---

## Spec Coverage Matrix

| Approved requirement | Task(s) |
|---|---|
| Create/query/correct/history/restore offline | 3–5, 7 |
| IndexedDB active source only | 1, 3–5, 8 |
| Exactly five conceptual stores | 2, 7 |
| App-shell-only SW caching | 6, 7 |
| Atomic local mutation | 3–4 |
| Client UUID v7 identity | 3–4 via existing `createId` |
| Non-destructive v1→v2 migration | 2, 4, 7 |
| Visible Offline without blocking local operations | 5, 7 |
| No server import/dual-write/fallback | 5, 7, 8 |
| Same-base stale protection | 4, 7 |
| Controlled SW update | 6, 7 |
| Fail-safe local storage | 3–5, 7 |
| Domain browser-neutral | 8 |
| Current-only deterministic query | 3, 7 |
| History/provenance integrity | 4 |
| Append-only restore | 4, 7 |
| API readiness not a local gate | 5, 7 |
| Technical UUIDs hidden in normal UI | 5, 8 |
| Existing Slice 01–02 regression preserved | 4–5, 7–8 |
| Synthetic-only safety boundary | 5, 8 |

## Execution Handoff

The plan is complete as a planning artifact. Implementation remains unauthorized until LEANDRO explicitly authorizes it.

After authorization, first verify live `main`, create the fresh worktree/branch, then execute tasks in order with RED→GREEN evidence and review at task boundaries. Recommended execution mode is Superpowers subagent-driven development when the runtime can actually dispatch independent task workers; otherwise use executing-plans inline and state that no independent subagents were claimed.
