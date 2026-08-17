# Slice 04 — Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable bidirectional synchronization between the Slice 03 local IndexedDB repository and the PostgreSQL server, with immutable event transport, transactional Outbox, idempotent retry, causal conflict preservation, fixed-snapshot bootstrap, and deterministic convergence.

**Architecture:** Keep the PWA local-first: local domain writes commit to IndexedDB together with a persistent local outbound event, then a dedicated `SyncEngine` performs versioned `bootstrap → push → pull` over HTTP. PostgreSQL is the durable convergence coordinator; every server-accepted canonical mutation, including legacy `/memories` writes, commits canonical rows, causal `FactRelation` rows, projection updates, a commit-ordered feed cursor, and one immutable `SyncOutbox` envelope in the same transaction. Canonical truth remains Evidence + LedgerEvent + Fact + FactRelation; `CurrentFact`, conflict state, cursors, and sync status are reconstructible projections.

**Tech Stack:** TypeScript 6, React, Vite PWA, IndexedDB, NestJS, PostgreSQL, Prisma, Zod, Vitest, Playwright, pnpm 10, Node.js 24.

## Global Constraints

- Written design source of truth: `docs/superpowers/specs/2026-08-17-slice-04-synchronization-design.md` at design HEAD `4608498ce05a5fe44d1bb1d49f3a308996f575e7`.
- Implementation must start only after a separate explicit HUMAN_GATE; this plan itself does not authorize implementation or merge.
- Real sensitive data: **NOT AUTHORIZED**. All implementation, fixtures, tests, E2E, and evidence use synthetic/controlled data only.
- Pilot: **NOT AUTHORIZED**.
- Protocol version is exactly `1` for Slice 04; persisted envelopes carry `protocolVersion: 1`.
- `mdp-local` migration is exactly **v2 → v3**, non-destructive, with UUIDs preserved.
- Client-generated UUID v7 identifiers remain definitive; no server remapping.
- Synchronization direction is bidirectional.
- Synchronization unit is immutable event + immutable dependencies.
- Event types in scope: `MEMORY_CREATED`, `MEMORY_CORRECTED`, `CONFLICT_RESOLVED` only.
- Deletion, purge, remote wipe, and content tombstone semantics are out of scope.
- `eventId` is the idempotency key; retry never creates a replacement ID.
- `CONFLICT` means the event was durably accepted and acknowledged, while the memory remains unresolved; do not retry the accepted outbound event.
- Push is atomic per event; pull is atomic per page; bootstrap promotion is atomic.
- Server feed ordering is operational only. Timestamps, UUID order, and network arrival order never decide causal truth.
- Server sequence must reflect transaction commit order. Do not use standalone `BIGSERIAL/MAX(sequence)` semantics that can expose a high-water mark beyond an uncommitted lower sequence.
- Every server canonical sync-visible write and corresponding Outbox record commit in one PostgreSQL transaction.
- Redis, BullMQ, a separate worker, WebSocket, peer-to-peer sync, and mandatory Service Worker Background Sync are not introduced.
- `clientInstanceId` identifies an installation operationally; it is not authentication or authorization.
- Foreground automatic sync + explicit `Synchronize now`; bounded exponential backoff + jitter for transient failures only.
- Cursor advances only in the same local transaction that successfully applies the corresponding pull page/bootstrap promotion.
- Outbox retention is operational/configurable and never deletes canonical memory history.
- Slices 01–03 behavior and tests remain green.

---

## File Map

### Shared contracts/domain

- Create `packages/contracts/src/sync.ts` — protocol v1 schemas, DTOs, stable result/error codes, canonical record/envelope shapes.
- Create `packages/contracts/src/sync.test.ts` — protocol parsing/version/result semantics.
- Modify `packages/contracts/src/index.ts` — export sync contracts.
- Modify `packages/contracts/src/memory.ts` and `memory.test.ts` — add conflict query response and graph-aware history fields without removing existing normal-flow fields.
- Create `packages/domain/src/fact-graph.ts` and `fact-graph.test.ts` — DAG validation, topological history, leaf detection, dominator-based conflict baseline, current projection derivation.
- Create `packages/domain/src/conflict-resolution.ts` and `conflict-resolution.test.ts` — append-only resolution record creation.
- Modify `packages/domain/src/correction.ts` and tests — expose causal relation for a normal correction while retaining legacy compatibility fields.
- Modify `packages/domain/src/index.ts` — export new domain APIs.

### PostgreSQL / API

- Modify `prisma/schema.prisma`.
- Create `prisma/migrations/20260818000100_slice_04_synchronization/migration.sql`.
- Create `apps/api/src/sync/sync.store.ts` — server sync persistence boundary.
- Create `apps/api/src/sync/sync.service.ts`, `sync.service.test.ts` — protocol orchestration/validation.
- Create `apps/api/src/sync/sync.controller.ts`, `sync.controller.test.ts` — HTTP endpoints.
- Create `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts` and integration tests — push/pull/bootstrap/retention implementation.
- Create `apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.ts` and tests — common transactional canonical writer + commit-ordered feed allocation + Outbox envelope.
- Modify `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts` and integration tests — existing server create/correct use the common writer and publish Outbox.
- Modify `apps/api/src/app.module.ts` — register sync providers/controller.
- Modify `apps/api/src/config/env.ts` and tests — operational sync limits/retention/bootstrap TTL.

### Local IndexedDB / sync engine

- Modify `apps/web/src/lib/indexeddb/mdp-local-db.ts` and tests — v3 stores/indexes/migration/backfill.
- Modify `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts` and tests — atomic local Outbox, FactRelation writes, graph-aware query/history, conflict resolution.
- Modify `apps/web/src/lib/memory-repository.ts` — conflict/resolve boundary.
- Create `apps/web/src/lib/indexeddb/indexeddb-sync-store.ts` and tests — pending queue, pull apply, bootstrap staging/promotion, cursor/conflict/status state.
- Create `apps/web/src/lib/sync/sync-api.ts` and tests — versioned HTTP client.
- Create `apps/web/src/lib/sync/retry.ts` and tests — bounded exponential backoff/jitter/classification.
- Create `apps/web/src/lib/sync/sync-engine.ts` and tests — single-flight bootstrap/push/pull convergence loop.
- Create `apps/web/src/lib/sync/use-sync-state.ts` and tests — React subscription/trigger layer.

### UI

- Create `apps/web/src/features/sync/SyncStatus.tsx` and test.
- Create `apps/web/src/features/sync/ConflictResolutionPanel.tsx` and test.
- Modify `apps/web/src/App.tsx`, `App.test.tsx`.
- Modify `apps/web/src/features/memory/StoreMemoryForm.tsx` and test — truthful local-save copy.
- Modify `apps/web/src/features/memory/MemoryFoundResult.tsx` and test — conflict display/per-memory sync state/resolve action.

### Verification / CI / evidence

- Create `tests/architecture/slice-04-scope.test.ts`.
- Create `tests/e2e/synchronization-core.spec.ts`.
- Create `tests/e2e/synchronization-conflicts.spec.ts`.
- Create `tests/e2e/synchronization-recovery.spec.ts`.
- Modify `playwright.config.ts` — deterministic synthetic sync limits suitable for retention/recovery tests.
- Keep `playwright.offline.config.ts` limited to Slice 03 offline regression.
- Modify `.github/workflows/ci.yml` — Slice 04 physical schema guards and sync E2E coverage while preserving all previous checks.
- Create `docs/evidence/slice-04/SLICE-04-EVIDENCE-001.md`, `docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md`, `docs/phases/SLICE-04.md`, and `artifacts/phases/SLICE-04-SYNCHRONIZATION/*` only after the implementation/test evidence exists.

---

### Task 1: Define protocol v1 contracts and stable synchronization semantics

**Files:**
- Create: `packages/contracts/src/sync.ts`
- Create: `packages/contracts/src/sync.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `SYNC_PROTOCOL_VERSION`, `syncEventEnvelopeSchema`, `syncPushRequestSchema`, `syncPushResponseSchema`, `syncPullResponseSchema`, `syncBootstrapStartResponseSchema`, `syncBootstrapPageResponseSchema`, `SyncEventEnvelope`, `SyncPushEventResult`, `SyncCursor`.
- Cursor JSON type is a decimal string, not JavaScript `number`, because PostgreSQL `BIGINT` may exceed `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 1: Write failing protocol tests**

Add tests that require version `1`, reject `2`, preserve decimal-string cursors, and distinguish accepted `CONFLICT` from retryable `DEPENDENCY_MISSING`:

```ts
expect(syncCursorSchema.parse('9007199254740993')).toBe('9007199254740993');
expect(() => syncEventEnvelopeSchema.parse({ ...validEnvelope, protocolVersion: 2 })).toThrow();
expect(syncPushEventResultSchema.parse({ eventId, status: 'CONFLICT' }).status).toBe('CONFLICT');
expect(syncPushEventResultSchema.parse({
  eventId,
  status: 'DEPENDENCY_MISSING',
  missingFactIds: [factId],
}).status).toBe('DEPENDENCY_MISSING');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run packages/contracts/src/sync.test.ts`

Expected: FAIL because sync contracts do not exist.

- [ ] **Step 3: Implement the exact protocol surface**

Define at minimum:

```ts
export const SYNC_PROTOCOL_VERSION = 1 as const;
export type SyncCursor = string;
export type SyncEventType = 'MEMORY_CREATED' | 'MEMORY_CORRECTED' | 'CONFLICT_RESOLVED';
export type SyncPushStatus =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'CONFLICT'
  | 'DEPENDENCY_MISSING'
  | 'BLOCKED'
  | 'INVALID';

export interface SyncEventEnvelope {
  protocolVersion: 1;
  eventId: string;
  eventType: SyncEventType;
  memoryId: string;
  records: SyncCanonicalRecord[];
  predecessorFactIds: string[];
}
```

Canonical record variants must explicitly cover `memory`, `evidence`, `ledgerEvent`, `fact`, and `factRelation`. Dates are ISO strings. `FactRelation` is the authoritative causal representation.

Define stable top-level sync error codes:

```ts
export type SyncErrorCode =
  | 'SYNC_PROTOCOL_UNSUPPORTED'
  | 'SYNC_CURSOR_EXPIRED'
  | 'SYNC_BOOTSTRAP_EXPIRED'
  | 'SYNC_DEPENDENCY_MISSING'
  | 'SYNC_INTEGRITY_VIOLATION'
  | 'SYNC_SERVICE_UNAVAILABLE'
  | 'SYNC_BLOCKED';
```

- [ ] **Step 4: Export the contracts and run tests**

Run: `pnpm exec vitest run packages/contracts/src/sync.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/sync.ts packages/contracts/src/sync.test.ts packages/contracts/src/index.ts
git commit -m "feat(slice-04): define synchronization protocol contracts"
```

---

### Task 2: Introduce the canonical Fact DAG and deterministic projection algorithm

**Files:**
- Create: `packages/domain/src/fact-graph.ts`
- Create: `packages/domain/src/fact-graph.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface FactGraphNode { factId: string; createdAt: Date; }
export interface FactRelationRecord {
  memoryId: string;
  predecessorFactId: string;
  successorFactId: string;
  relationType: 'SUPERSEDES';
}
export type DerivedMemoryProjection =
  | { status: 'RESOLVED'; currentFactId: string }
  | { status: 'CONFLICT'; baselineFactId: string; candidateFactIds: string[] };
export function deriveMemoryProjection(nodes: FactGraphNode[], relations: FactRelationRecord[]): DerivedMemoryProjection;
export function orderFactGraphHistory(...): Array<{ factId: string; predecessorFactIds: string[] }>;
```

- [ ] **Step 1: Write RED tests for chain, branch, merge, concurrent resolution, cycles, and missing nodes**

Required cases:

```text
A→B→C             => RESOLVED C
A→B and A→C       => CONFLICT baseline A candidates B,C
A→B,A→C,B→D,C→D  => RESOLVED D
A→B,A→C,B,C→D and B,C→E => CONFLICT baseline A candidates D,E
A→B→A             => invalid graph
```

The conflict baseline is the deepest common **dominator**, not merely any common ancestor. Compute dominators in topological order:

```ts
dom(root) = {root}
dom(node) = {node} ∪ intersection(dom(predecessor) for every predecessor)
```

For multiple leaf candidates, intersect their dominator sets and select the deepest common dominator. This preserves baseline `A` for concurrent resolutions `D` and `E`, where `B` and `C` are common ancestors but do not dominate all paths.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run packages/domain/src/fact-graph.test.ts`

Expected: FAIL because DAG logic does not exist.

- [ ] **Step 3: Implement graph validation/topological ordering/dominator projection**

Rules:

- exactly one root Fact per current memory graph;
- every relation endpoint exists and belongs to the same memory;
- no self-edge;
- no cycle;
- leaf Facts are Facts with no outgoing `SUPERSEDES` relation;
- one leaf => resolved current Fact;
- more than one leaf => conflict; candidates sorted by stable topological presentation order, not used as truth priority.

- [ ] **Step 4: Run tests and full domain regression**

Run: `pnpm exec vitest run packages/domain/src/fact-graph.test.ts packages/domain/src/correction.test.ts packages/domain/src/memory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/fact-graph.ts packages/domain/src/fact-graph.test.ts packages/domain/src/index.ts
git commit -m "feat(slice-04): model causal fact graph"
```

---

### Task 3: Add append-only conflict resolution domain records and graph-aware response contracts

**Files:**
- Create: `packages/domain/src/conflict-resolution.ts`
- Create: `packages/domain/src/conflict-resolution.test.ts`
- Modify: `packages/domain/src/correction.ts`
- Modify: `packages/domain/src/correction.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/contracts/src/memory.ts`
- Modify: `packages/contracts/src/memory.test.ts`

**Interfaces:**
- Produces `createConflictResolutionRecord()` with one new Evidence, one new Fact, one `CONFLICT_RESOLVED` LedgerEvent, and one FactRelation from each candidate to the new Fact.
- Extends query response with explicit `CONFLICT` state.
- Extends history versions with `predecessorFactIds: string[]`; keep existing `supersedesFactId` for normal legacy compatibility, but do not use it as authoritative causal data.

- [ ] **Step 1: Write failing tests**

Resolution test must require two predecessors and prove a new Fact is created even when chosen text equals a candidate:

```ts
const result = createConflictResolutionRecord({
  memoryId,
  baselineFactId,
  candidateFactIds: [factB, factC],
  text: 'Versão confirmada',
  resolvedAt,
  ids: { evidenceId, eventId, factId: factD },
});
expect(result.relations.map((r) => r.predecessorFactId).sort()).toEqual([factB, factC].sort());
expect(result.event.type).toBe('CONFLICT_RESOLVED');
expect(result.fact.id).toBe(factD);
```

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run packages/domain/src/conflict-resolution.test.ts packages/contracts/src/memory.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement resolution and response schemas**

Add a request contract equivalent to:

```ts
{
  expectedCandidateFactIds: string[]; // minimum 2, unique
  text: string;
  reason?: string;
}
```

Add query result shape equivalent to:

```ts
{
  status: 'CONFLICT';
  answer: null;
  provenance: null;
  conflict: {
    memoryId: string;
    baseline: { factId: string; content: string };
    candidates: Array<{ factId: string; evidenceId: string; content: string }>;
  };
}
```

- [ ] **Step 4: Run contract/domain tests and typecheck**

Run: `pnpm exec vitest run packages/domain/src packages/contracts/src && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src packages/contracts/src/memory.ts packages/contracts/src/memory.test.ts
git commit -m "feat(slice-04): define conflict resolution domain flow"
```

---

### Task 4: Migrate PostgreSQL to FactRelation + commit-ordered sync infrastructure

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260818000100_slice_04_synchronization/migration.sql`
- Modify/Test: `apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts`

**Interfaces:**
- Produces physical tables: `fact_relations`, `sync_feed_state`, `sync_outbox`, `sync_conflicts`, `sync_bootstrap_snapshots`.
- Keeps existing canonical tables and historical UUIDs.

- [ ] **Step 1: Write/extend real PostgreSQL integration assertions before migration**

Assertions after migration must include:

```sql
SELECT count(*) FROM fact_relations;
SELECT current_sequence FROM sync_feed_state WHERE id = 1;
SELECT count(*) FROM pg_indexes WHERE indexname = 'facts_supersedes_fact_id_key'; -- must be 0
```

Seed one existing linear correction before applying the Slice 04 migration in a dedicated migration verification path and assert the corresponding `fact_relations` row exists after migration.

- [ ] **Step 2: Write the migration**

Migration requirements:

```sql
DROP INDEX IF EXISTS "facts_supersedes_fact_id_key";

CREATE TABLE "fact_relations" (
  "memory_id" UUID NOT NULL,
  "predecessor_fact_id" UUID NOT NULL,
  "successor_fact_id" UUID NOT NULL,
  "relation_type" VARCHAR(32) NOT NULL,
  PRIMARY KEY ("predecessor_fact_id", "successor_fact_id")
);

INSERT INTO "fact_relations" (...)
SELECT memory_id, supersedes_fact_id, id, 'SUPERSEDES'
FROM facts
WHERE supersedes_fact_id IS NOT NULL;
```

Add FK constraints to memory/fact records with `ON DELETE RESTRICT` and indexes for `memory_id`, predecessor, successor.

Create a singleton transactional feed counter:

```sql
CREATE TABLE "sync_feed_state" (
  "id" INTEGER PRIMARY KEY,
  "current_sequence" BIGINT NOT NULL
);
INSERT INTO "sync_feed_state" ("id", "current_sequence") VALUES (1, 0);
```

Create Outbox with explicit sequence PK, unique `event_id`, payload hash, JSONB immutable payload, nullable UUID `origin_client_instance_id`, and timestamps. Create `sync_conflicts` as a reconstructible current projection and `sync_bootstrap_snapshots` with UUID token, `high_watermark`, JSONB records, expiry, and created timestamp.

- [ ] **Step 3: Update Prisma models**

Keep `Fact.supersedesFactId` only as a legacy compatibility mirror and remove `@unique`. Add authoritative `FactRelation` relations. Do not model Outbox sequence with an autoincrement default; it is allocated transactionally from `sync_feed_state`.

- [ ] **Step 4: Apply migration on real PostgreSQL and verify**

Run:

```bash
docker compose up -d postgres
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts
```

Expected: PASS and no historical row loss.

- [ ] **Step 5: Commit**

```bash
git add prisma apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts
git commit -m "feat(slice-04): migrate synchronization persistence schema"
```

---

### Task 5: Build a shared transactional canonical writer with commit-ordered Outbox publication

**Files:**
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.integration.test.ts`

**Interfaces:**
- Produces `PrismaCanonicalMemoryWriter.writeEnvelope(tx, envelope, originClientInstanceId)` and `allocateFeedSequence(tx): Promise<bigint>`.
- Consumes protocol envelopes and domain projection derivation.

- [ ] **Step 1: Write RED integration tests for atomicity and sequence ordering**

Required proofs:

1. canonical rows + relations + conflict projection + Outbox all appear after commit;
2. forced failure before Outbox causes total rollback;
3. two concurrent writers receive feed sequence in commit-lock order;
4. rolled-back sequence allocation does not consume a visible feed sequence.

- [ ] **Step 2: Implement transactionally serialized sequence allocation**

Use the singleton row, not `BIGSERIAL`:

```sql
UPDATE sync_feed_state
SET current_sequence = current_sequence + 1
WHERE id = 1
RETURNING current_sequence;
```

The row update lock serializes sequence assignment inside the same transaction. A concurrent transaction cannot receive `N+1` until the transaction holding `N` releases the lock by commit/rollback. This makes a bootstrap `highWatermarkCursor` safe against hidden later commits with sequence `<= N`.

- [ ] **Step 3: Implement immutable payload hashing**

Canonicalize parsed envelope JSON by recursively sorting object keys and SHA-256 hash the canonical string. Store the 64-hex hash in `sync_outbox.payload_hash`. Never compare idempotency by text search or timestamps.

- [ ] **Step 4: Implement canonical inserts + projection rebuild + Outbox insert**

For new immutable records, reject an existing same ID with different canonical content. An accepted conflict still writes the event and Outbox; projection becomes `OPEN`, but the event is acknowledged.

- [ ] **Step 5: Run focused real-DB tests**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer*
git commit -m "feat(slice-04): add transactional canonical sync writer"
```

---

### Task 6: Route existing PostgreSQL memory writes through the transactional writer

**Files:**
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

**Interfaces:**
- Existing `MemoryStore` HTTP behavior remains compatible.
- Direct server-origin operations publish `originClientInstanceId = null`.

- [ ] **Step 1: Add RED regression assertions**

After existing `/memories`-equivalent create/correct store operations, assert:

- matching `fact_relations` edge exists for correction;
- one `sync_outbox` row exists for each LedgerEvent;
- Outbox envelope uses the exact existing UUIDs;
- `CurrentFact` remains correct.

- [ ] **Step 2: Extract envelope construction from existing records**

For `MEMORY_CREATED`, envelope records include Memory, Evidence, LedgerEvent, Fact. For `MEMORY_CORRECTED`, include Memory, new Evidence, LedgerEvent, new Fact, and the `FactRelation` predecessor→successor edge.

- [ ] **Step 3: Replace duplicated Prisma write transaction with common writer**

Do not change public `MemoryStore` result types. Keep PostgreSQL outage mapping behavior unchanged.

- [ ] **Step 4: Run existing + new store integration tests**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-memory.store*
git commit -m "refactor(slice-04): publish server memory writes to sync outbox"
```

---

### Task 7: Implement server `push` with idempotency, dependency recovery, and accepted-conflict semantics

**Files:**
- Create: `apps/api/src/sync/sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

**Interfaces:**
- Produces `SyncStore.pushEvent(clientInstanceId, envelope): Promise<SyncPushEventResult>`.
- Uses one PostgreSQL transaction per pushed event.

- [ ] **Step 1: Write RED real-DB tests for every push outcome**

Cases:

- new create => `APPLIED`;
- replay same `eventId`/same payload => `ALREADY_APPLIED`, no duplicate rows;
- same `eventId`/different payload hash => `INVALID` with integrity code, no write;
- missing predecessor => `DEPENDENCY_MISSING` and zero partial writes;
- second successor to same predecessor => event durably written, `CONFLICT`, open conflict projection, Outbox row present;
- accepted `CONFLICT` replay => `ALREADY_APPLIED`.

- [ ] **Step 2: Implement idempotency check before mutation**

Query by `event_id`. If present, compare payload hash. Same hash acknowledges. Different hash fails closed.

- [ ] **Step 3: Implement dependency validation**

Every predecessor Fact ID in the envelope must exist before application unless that Fact is included as an immutable dependency in the same envelope. Missing IDs return them explicitly and do not create Outbox rows.

- [ ] **Step 4: Apply via `PrismaCanonicalMemoryWriter` and derive result**

After write/reprojection, return `CONFLICT` if the resulting memory projection is open conflict; otherwise `APPLIED`.

- [ ] **Step 5: Run integration tests**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): implement idempotent sync push"
```

---

### Task 8: Implement monotonic `pull`, bounded retention, and cursor expiration

**Files:**
- Modify: `apps/api/src/sync/sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Create/Modify: `apps/api/src/config/env.test.ts`

**Interfaces:**
- Adds `pull(after: SyncCursor, limit: number)`.
- Adds config `SYNC_MAX_BATCH_SIZE` and `SYNC_OUTBOX_MAX_ENTRIES` with bounded positive integer defaults.

- [ ] **Step 1: Write RED tests**

Require:

- strict `sequence > after`, ascending;
- server clamps/rejects above max according to contract;
- `nextCursor` equals last returned sequence after a nonempty page;
- `hasMore` true only when retained later rows exist;
- if `after` predates retained floor while `currentSequence > after`, return `SYNC_CURSOR_EXPIRED`;
- Outbox pruning never deletes Memory/Evidence/LedgerEvent/Fact/FactRelation.

- [ ] **Step 2: Parse sync operational config**

Use exact API env fields:

```ts
syncMaxBatchSize: number;
syncOutboxMaxEntries: number;
syncBootstrapTtlSeconds: number;
```

Recommended defaults for non-test runtime: `50`, `10000`, `900` respectively. They are operational defaults, not domain semantics.

- [ ] **Step 3: Implement bounded retention**

Because feed sequence is transactionally contiguous, after accepting sequence `N`, retain at most configured entries by deleting Outbox rows with `sequence <= N - maxEntries`. Execute pruning without touching canonical rows.

- [ ] **Step 4: Implement pull/cursor-expired rules**

If no row exists at/before the requested cursor because retention removed required feed history, return the structured expiration result; clients rebootstrap.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/api/src/config/env.test.ts && DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): add pull cursor and outbox retention"
```

---

### Task 9: Implement fixed-snapshot paginated bootstrap

**Files:**
- Modify: `apps/api/src/sync/sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

**Interfaces:**
- Produces `startBootstrap(clientInstanceId)` and `readBootstrapPage(token, offset, limit)`.
- Bootstrap snapshot stores flattened immutable canonical records only; projections are rebuilt by the client.

- [ ] **Step 1: Write RED real-DB bootstrap tests**

Prove:

- pre-Slice04/server history not represented in Outbox is still included;
- `highWatermarkCursor` and snapshot are from one logical PostgreSQL snapshot;
- a concurrent write that commits after snapshot creation receives a sequence `> highWatermarkCursor` and appears in later pull, not silently inside later bootstrap pages;
- pages from one token are stable even while server changes;
- expired token returns `SYNC_BOOTSTRAP_EXPIRED`;
- no canonical data is changed by bootstrap.

- [ ] **Step 2: Start bootstrap in `REPEATABLE READ` transaction**

Within one Prisma transaction with `isolationLevel: 'RepeatableRead'`:

1. read `sync_feed_state.current_sequence` as high-water mark;
2. read all immutable canonical Memory/Evidence/LedgerEvent/Fact/FactRelation records visible to that snapshot;
3. flatten and deterministically sort records by `(memoryId, kindRank, stableRecordKey)`;
4. store that exact array in `sync_bootstrap_snapshots.records` with UUID-v7 token and expiry;
5. commit.

Commit-ordered feed allocation from Task 5 guarantees any write not visible in this snapshot later receives a cursor above the captured high-water mark.

- [ ] **Step 3: Implement page reads**

Page by integer `offset`/`limit` into the materialized snapshot JSON. Return `nextOffset: null` at completion. Never rebuild a page from live canonical tables.

- [ ] **Step 4: Implement opportunistic snapshot cleanup**

Delete expired snapshot rows on bootstrap start/read. This cleanup is infrastructure-only.

- [ ] **Step 5: Run bootstrap integration tests**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t bootstrap`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): add consistent paginated bootstrap"
```

---

### Task 10: Expose versioned NestJS sync endpoints with stable structured errors

**Files:**
- Create: `apps/api/src/sync/sync.service.ts`
- Create: `apps/api/src/sync/sync.service.test.ts`
- Create: `apps/api/src/sync/sync.controller.ts`
- Create: `apps/api/src/sync/sync.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Endpoints:

```text
POST /sync/v1/bootstrap/start
GET  /sync/v1/bootstrap/:token?offset=0&limit=50
POST /sync/v1/push
GET  /sync/v1/pull?after=<decimal>&limit=50
```

- [ ] **Step 1: Write controller/service RED tests**

Verify version mismatch, invalid limit/cursor, push result forwarding, bootstrap expiration, cursor expiration, and service-unavailable mapping. Assert error body uses stable `code` and does not leak SQL/payload contents.

- [ ] **Step 2: Implement service validation**

Parse all requests with `@mdp/contracts`; never infer semantics from raw HTTP fields after validation.

- [ ] **Step 3: Implement controller status mapping**

Use transport statuses consistently, e.g. unsupported protocol `400`, expired cursor/bootstrap `410`, invalid/integrity `409/422` as appropriate, database/transient outage `503`. Per-event push results remain in a successful batch response because one event result must not abort independent events.

- [ ] **Step 4: Register providers/controller in `AppModule`**

Wire `PrismaSyncStore` through a symbol such as `SYNC_STORE`, and `SyncService` through `SYNC_SERVICE`; inject existing `PrismaService`, env, and `createId`.

- [ ] **Step 5: Run API unit regression**

Run: `pnpm exec vitest run apps/api/src/sync apps/api/src/memories apps/api/src/health`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync apps/api/src/app.module.ts
git commit -m "feat(slice-04): expose synchronization API"
```

---

### Task 11: Upgrade IndexedDB from v2 to v3 and backfill causal relations

**Files:**
- Modify: `apps/web/src/lib/indexeddb/mdp-local-db.ts`
- Modify: `apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

**Interfaces:**
- `MDP_LOCAL_DB_VERSION = 3`.
- New stores: `factRelations`, `syncOutbox`, `syncState`, `syncConflicts`, `bootstrapStaging`.

- [ ] **Step 1: Write RED migration tests from a real v2 fixture**

Seed v2 with root A and correction B where B has legacy `supersedesFactId=A`. Upgrade and assert:

- all five existing stores/rows remain;
- `factRelations` contains `A→B`;
- the old unique `facts.supersedesFactId` index no longer blocks inserting C with `supersedesFactId=A`;
- new stores/indexes exist;
- database remains writable;
- all original UUIDs/content remain byte-for-byte equivalent.

- [ ] **Step 2: Define v3 record types**

At minimum:

```ts
interface LocalFactRelationRecord {
  memoryId: string;
  predecessorFactId: string;
  successorFactId: string;
  relationType: 'SUPERSEDES';
}
interface LocalSyncOutboxRecord {
  eventId: string;
  memoryId: string;
  envelope: SyncEventEnvelope;
  status: 'PENDING' | 'RETRY_WAIT' | 'BLOCKED';
  attempt: number;
  nextAttemptAt: Date | null;
  lastErrorCode: string | null;
}
```

`syncState` stores `clientInstanceId`, confirmed server cursor, and bootstrap metadata as named keys. `syncConflicts` is keyed by `memoryId`. `bootstrapStaging` is keyed by `[bootstrapToken, recordKey]` and indexed by token.

- [ ] **Step 3: Implement `upgradeToV3` inside the IndexedDB versionchange transaction**

Create new stores, delete the old unique `supersedesFactId` index from `facts`, cursor existing Facts, and add one `FactRelation` for every legacy `supersedesFactId`. Any constraint/data failure aborts the upgrade transaction.

- [ ] **Step 4: Run migration tests**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/indexeddb/mdp-local-db*
git commit -m "feat(slice-04): migrate local database to sync v3"
```

---

### Task 12: Make local create/correct/resolve atomically enqueue synchronization events

**Files:**
- Modify: `apps/web/src/lib/memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`

**Interfaces:**
- Add `resolveConflict(memoryId, request)`.
- Add local error code `CONFLICT_REQUIRES_RESOLUTION`.
- Local create/correct/resolve transaction includes canonical rows + FactRelations + local `syncOutbox` record.

- [ ] **Step 1: Write RED atomicity tests**

Require:

- create adds one `MEMORY_CREATED` pending envelope in same transaction;
- correct adds one relation and one `MEMORY_CORRECTED` pending envelope;
- injected `syncOutbox.add()` failure aborts the domain mutation, proving no false local success;
- correction against an OPEN conflict throws `CONFLICT_REQUIRES_RESOLUTION`;
- resolve creates new Evidence/Fact/Event plus relations from all candidate Facts and one `CONFLICT_RESOLVED` pending envelope.

- [ ] **Step 2: Replace `PRODUCT_STORES` transaction lists with explicit canonical+sync mutation store sets**

Do not hide sync stores inside a name that still claims “five product stores”. Introduce clear constants such as `CANONICAL_STORES`, `SYNC_STORES`, `LOCAL_MUTATION_STORES`.

- [ ] **Step 3: Generate immutable envelopes from the exact newly committed records**

Use event IDs already generated by Slice 03 domain functions. Do not generate a separate idempotency key.

- [ ] **Step 4: Update graph-aware history/query**

Stop using linear `orderTextFactHistory` as the authoritative path. Use `FactRelation` + `orderFactGraphHistory`. If `syncConflicts` is OPEN, `query()` returns contract `CONFLICT` rather than silently returning baseline/candidate content.

- [ ] **Step 5: Run local repository tests**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts apps/web/src/lib/memory-repository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository*
git commit -m "feat(slice-04): enqueue local memory events atomically"
```

---

### Task 13: Implement `IndexedDbSyncStore` for pending queue, atomic pull, and bootstrap staging/promotion

**Files:**
- Create: `apps/web/src/lib/indexeddb/indexeddb-sync-store.ts`
- Create: `apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts`

**Interfaces:**

```ts
interface SyncLocalStore {
  getOrCreateClientInstanceId(): Promise<string>;
  getConfirmedCursor(): Promise<SyncCursor | null>;
  listPending(limit: number, now: Date): Promise<LocalSyncOutboxRecord[]>;
  applyPushResults(results: SyncPushEventResult[], now: Date): Promise<void>;
  applyPullPage(page: SyncPullResponse): Promise<void>;
  stageBootstrapPage(token: string, records: SyncCanonicalRecord[]): Promise<void>;
  promoteBootstrap(token: string, highWatermark: SyncCursor): Promise<void>;
  discardBootstrap(token: string): Promise<void>;
  getGlobalStatus(): Promise<SyncGlobalStatus>;
  getMemoryStatus(memoryId: string): Promise<SyncMemoryStatus>;
}
```

- [ ] **Step 1: Write RED tests for client identity and push acknowledgements**

`clientInstanceId` is UUID v7, stable across reload/open, but a fresh database gets a different ID. `APPLIED`, `ALREADY_APPLIED`, and `CONFLICT` remove/acknowledge the outbound pending record; `DEPENDENCY_MISSING` retains it; `BLOCKED/INVALID` preserve it as BLOCKED.

- [ ] **Step 2: Write RED test for immutable apply**

Applying an already-known same ID/same content is idempotent. Same ID/different immutable content aborts with `LOCAL_DATA_INTEGRITY_ERROR`; never `put()` over immutable canonical content blindly.

- [ ] **Step 3: Write RED atomic pull page test**

Stage a page with two valid records and one conflicting immutable duplicate. Assert the entire transaction rolls back and confirmed cursor remains unchanged. Then retry an unmodified valid page and assert all records/projections/cursor commit together.

- [ ] **Step 4: Implement projection rebuild inside the same transaction**

For each touched memory, read Facts + FactRelations, call `deriveMemoryProjection`, then:

- RESOLVED => exactly one `currentFacts` row for derived current Fact and no OPEN conflict;
- CONFLICT => `currentFacts` points to the derived baseline Fact and `syncConflicts` records OPEN candidates; query layer must still expose conflict, not baseline as normal truth.

- [ ] **Step 5: Implement bootstrap staging/promotion**

Pages write only to `bootstrapStaging`. Promotion opens one readwrite transaction over staging + canonical stores + projection/conflict + `syncState`, merges immutable remote records while retaining local pending rows, rebuilds touched projections, writes high-watermark cursor, then clears staging. A failure rolls back promotion and leaves old local state/cursor intact.

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-sync-store*
git commit -m "feat(slice-04): add local synchronization store"
```

---

### Task 14: Implement versioned HTTP client and bounded retry policy

**Files:**
- Create: `apps/web/src/lib/sync/sync-api.ts`
- Create: `apps/web/src/lib/sync/sync-api.test.ts`
- Create: `apps/web/src/lib/sync/retry.ts`
- Create: `apps/web/src/lib/sync/retry.test.ts`

**Interfaces:**
- `SyncApiClient.startBootstrap`, `readBootstrapPage`, `push`, `pull`.
- `computeRetryDelay(attempt, random)` and `classifySyncFailure(error)`.

- [ ] **Step 1: Write RED API serialization tests**

Assert protocol version is in every persisted/request envelope, cursor remains string, stable structured server codes map to typed client errors, and unknown response shapes fail closed.

- [ ] **Step 2: Write RED retry tests with deterministic random**

Use formula:

```ts
raw = Math.min(500 * 2 ** attempt, 10_000);
jitterFactor = 0.8 + random() * 0.4;
delay = Math.round(raw * jitterFactor);
```

Cap automatic attempts per foreground cycle at `5`. Network errors/timeouts/502/503 are transient. Protocol unsupported, integrity, blocked, and accepted conflict are not transient transport retries.

- [ ] **Step 3: Implement `SyncApiClient` with injected `fetch`**

Never cache sync API responses in Service Worker or browser Cache API.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run apps/web/src/lib/sync/sync-api.test.ts apps/web/src/lib/sync/retry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sync
git commit -m "feat(slice-04): add sync transport and retry policy"
```

---

### Task 15: Implement single-flight `SyncEngine` bootstrap/push/pull convergence loop

**Files:**
- Create: `apps/web/src/lib/sync/sync-engine.ts`
- Create: `apps/web/src/lib/sync/sync-engine.test.ts`

**Interfaces:**

```ts
class SyncEngine {
  synchronize(reason: 'startup' | 'online' | 'pending' | 'manual'): Promise<void>;
  subscribe(listener: (state: SyncRuntimeState) => void): () => void;
}
```

- [ ] **Step 1: Write RED orchestration tests with fake API/local store**

Prove:

- no network when offline;
- no confirmed cursor => bootstrap all pages, promote, then push/pull;
- normal cycle => push pending batch, acknowledge accepted results, pull until `hasMore=false`, repeat if dependency recovery created work;
- `DEPENDENCY_MISSING` triggers pull/dependency recovery before retry same event ID;
- `CURSOR_EXPIRED` triggers safe rebootstrap while pending local work remains;
- concurrent `synchronize()` calls share one in-flight promise;
- transient failure performs bounded retries; permanent failure stops.

- [ ] **Step 2: Implement bootstrap loop**

Use server-provided `bootstrapToken` and page offsets. If any page fails, keep staging isolated and do not confirm high-watermark. On token expiration, discard only that staging token and restart bootstrap.

- [ ] **Step 3: Implement push/pull loop**

Never mark an event synced merely because request transmission succeeded; consume explicit result status. `CONFLICT` acknowledges the outbound event and leaves conflict UI state.

- [ ] **Step 4: Implement foreground triggers without Background Sync dependency**

The engine exposes methods; React integration in next task wires startup, `online`, pending, and manual triggers. No Service Worker Background Sync registration.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/web/src/lib/sync/sync-engine.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sync/sync-engine*
git commit -m "feat(slice-04): implement synchronization engine"
```

---

### Task 16: Integrate sync state and explicit conflict resolution into React UI

**Files:**
- Create: `apps/web/src/lib/sync/use-sync-state.ts`
- Create: `apps/web/src/lib/sync/use-sync-state.test.ts`
- Create: `apps/web/src/features/sync/SyncStatus.tsx`
- Create: `apps/web/src/features/sync/SyncStatus.test.tsx`
- Create: `apps/web/src/features/sync/ConflictResolutionPanel.tsx`
- Create: `apps/web/src/features/sync/ConflictResolutionPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/features/memory/StoreMemoryForm.tsx`, test
- Modify: `apps/web/src/features/memory/MemoryFoundResult.tsx`, test

**Interfaces:**
- Global states: `OFFLINE | SYNCED | PENDING | SYNCING | CONFLICT | ERROR`.
- Per-memory states: `LOCAL_PENDING | SYNCING | SYNCED | CONFLICT | BLOCKED`.

- [ ] **Step 1: Write RED component tests for truthful state**

Assertions:

- offline save says local save, not remote synchronization;
- `PENDING` shows pending count/status;
- `SYNCING` shows progress without blocking local forms;
- `CONFLICT` shows baseline and every candidate;
- `Synchronize now` invokes manual engine trigger;
- conflict resolution can choose candidate text or enter a new value, but always calls `resolveConflict()` and creates a new fact.

- [ ] **Step 2: Wire one `SyncEngine` instance at app boundary**

On app mount, subscribe and call startup sync when online. Listen to browser `online` events. Do not couple memory form submit directly to remote API.

- [ ] **Step 3: Update success copy**

After local create/correct, use copy equivalent to `Salva neste dispositivo.` plus sync status component. Only the sync projection may say `Sincronizada` after remote acknowledgement.

- [ ] **Step 4: Render conflict response instead of normal found answer**

`MemoryFoundResult` branches on `status === 'CONFLICT'`. It must not display baseline/candidate as a normal resolved answer.

- [ ] **Step 5: Run UI tests**

Run: `pnpm exec vitest run apps/web/src/App.test.tsx apps/web/src/features/memory apps/web/src/features/sync apps/web/src/lib/sync/use-sync-state.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App* apps/web/src/features apps/web/src/lib/sync/use-sync-state*
git commit -m "feat(slice-04): surface synchronization and conflict state"
```

---

### Task 17: Add Slice 04 architecture guards and physical schema guards

**Files:**
- Create: `tests/architecture/slice-04-scope.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Architecture test enforces boundary/non-goals.
- CI validates actual PostgreSQL Slice 04 schema before application tests.

- [ ] **Step 1: Write RED architecture guard**

Scan production sources/package metadata and fail if Slice 04 introduces `bullmq`, Redis client packages, WebSocket server/client infrastructure, `SyncManager`/mandatory Background Sync, `MEMORY_DELETED`, purge endpoints, or server-wins/last-write-wins implementation switches.

Also assert active PWA memory writes still target `MemoryRepository` rather than direct `memory-api` dual write.

- [ ] **Step 2: Update CI exact table assertion**

Expected public tables (excluding `_prisma_migrations`) become exactly:

```text
current_facts,evidence,fact_relations,facts,ledger_events,memories,sync_bootstrap_snapshots,sync_conflicts,sync_feed_state,sync_outbox
```

If Prisma naming differs, use the exact final migration names and keep the assertion deterministic.

- [ ] **Step 3: Add physical schema assertions**

Require:

- legacy `facts.supersedes_fact_id` UUID column may remain but is not unique;
- composite PK/FKs on `fact_relations`;
- `sync_outbox.event_id` unique;
- `sync_outbox.sequence` BIGINT PK without sequence/autoincrement default;
- singleton `sync_feed_state(id=1,current_sequence=0+)` exists;
- bootstrap/outbox JSONB and expiry/indexes exist.

- [ ] **Step 4: Run architecture + formatting**

Run: `pnpm exec vitest run tests/architecture/slice-04-scope.test.ts && pnpm lint && pnpm format:check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/architecture/slice-04-scope.test.ts .github/workflows/ci.yml
git commit -m "test(slice-04): guard synchronization architecture"
```

---

### Task 18: Add core synchronization E2E scenarios

**Files:**
- Create: `tests/e2e/synchronization-core.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Use separate Playwright browser contexts to represent separate installations/IndexedDB databases.
- E2E runtime remains synthetic.

- [ ] **Step 1: Configure deterministic E2E operational limits**

Add API webServer env values, e.g.:

```ts
SYNC_MAX_BATCH_SIZE: '4',
SYNC_OUTBOX_MAX_ENTRIES: '8',
SYNC_BOOTSTRAP_TTL_SECONDS: '30',
```

Keep these as test configuration only.

- [ ] **Step 2: Implement E2E 1 — offline create/correct → online convergence**

Use `context.setOffline(true)`, create/correct locally, restore online, click/wait for sync, then verify server history through API and local query/history contain identical definitive IDs/content.

- [ ] **Step 3: Implement E2E 2 — lost response + idempotent retry**

Intercept first push with `route.fetch()` so the real server commits, then abort/throw the response to the page. Retry must send the same event ID and end synchronized with exactly one server LedgerEvent/Fact effect.

- [ ] **Step 4: Implement E2E 3 — device A create → device B bootstrap/pull**

Use two contexts. Assert the same memory/evidence/fact UUIDs appear on both; no remapping.

- [ ] **Step 5: Implement E2E 6 — dependency arrives out of order**

Network-route the push payload to send dependent event first, verify `DEPENDENCY_MISSING`, then allow predecessor and retry; convergence succeeds.

- [ ] **Step 6: Run focused E2E**

Run: `pnpm exec playwright test tests/e2e/synchronization-core.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/synchronization-core.spec.ts playwright.config.ts
git commit -m "test(slice-04): cover core synchronization flows"
```

---

### Task 19: Add conflict and human-resolution E2E scenarios

**Files:**
- Create: `tests/e2e/synchronization-conflicts.spec.ts`

**Interfaces:**
- Covers required E2E scenarios 4, 5, and 8.

- [ ] **Step 1: Implement concurrent correction branch test**

Bootstrap two contexts from Fact A, take both offline, correct independently to B/C, reconnect and sync. Assert server and both clients preserve B and C, conflict is OPEN, baseline A is not shown as normal resolved answer, and neither timestamp decides a winner.

- [ ] **Step 2: Implement explicit resolution test**

Resolve B/C to new Fact D. Assert D has a new UUID even if its text equals B or C, relations `B→D` and `C→D` exist, all replicas converge to D, and B/C remain in history.

- [ ] **Step 3: Implement bootstrap-with-local-pending-conflict test**

Server has `A→B`; a separate client locally has pending `A→C` before first server bootstrap. Promotion preserves both and opens the same conflict; no server-wins/local-wins overwrite.

- [ ] **Step 4: Add concurrent-resolution recursive conflict test**

Two devices resolve B/C independently to D/E before syncing. Assert D/E become candidates of a new conflict with deepest common dominator A and neither resolution wins automatically.

- [ ] **Step 5: Run focused E2E**

Run: `pnpm exec playwright test tests/e2e/synchronization-conflicts.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/synchronization-conflicts.spec.ts
git commit -m "test(slice-04): prove conflict preservation and resolution"
```

---

### Task 20: Add bootstrap, cursor-expiry, atomic-failure, and protocol-rejection E2E

**Files:**
- Create: `tests/e2e/synchronization-recovery.spec.ts`

**Interfaces:**
- Covers required E2E scenarios 7, 9, 10, 11, 12.

- [ ] **Step 1: New-device fixed bootstrap then incremental pull**

Seed server via existing API, open fresh context, complete bootstrap, then make another server change and prove it arrives via `pull` after the bootstrap high-watermark rather than requiring a second bootstrap.

- [ ] **Step 2: Cursor expiration after Outbox retention**

Allow a device to confirm an old cursor, generate more than `SYNC_OUTBOX_MAX_ENTRIES` server events, then reconnect. Assert `CURSOR_EXPIRED` causes rebootstrap and a separate local pending event survives/pushes afterward.

- [ ] **Step 3: Pull page local failure keeps cursor unchanged**

Intercept one pull response and mutate one immutable record to conflict with an existing same ID/different content. Local application must fail atomically; inspect `syncState` to prove cursor unchanged. Remove interception and retry the authentic page successfully.

- [ ] **Step 4: Bootstrap failure mid-pagination keeps staging invisible**

Abort a later bootstrap page after earlier pages were staged. Verify remote partial records are not query-visible as synchronized canonical state, local data remains usable, and a subsequent bootstrap succeeds.

- [ ] **Step 5: Unsupported protocol version preserves pending work**

Intercept the client push request, forward a copy with `protocolVersion: 999` to the real API, return the real structured rejection to the client, and assert pending local event remains and cursor does not advance. Remove interception and prove normal v1 sync succeeds.

- [ ] **Step 6: Run focused E2E**

Run: `pnpm exec playwright test tests/e2e/synchronization-recovery.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/synchronization-recovery.spec.ts
git commit -m "test(slice-04): prove synchronization recovery semantics"
```

---

### Task 21: Run complete regression, failure proofs, and CI-equivalent validation

**Files:**
- Modify only if a failing legitimate regression requires a scoped Slice 04 fix.

**Interfaces:**
- No new product behavior. This is the pre-evidence technical qualification task.

- [ ] **Step 1: Clean real database and reapply all migrations**

Run:

```bash
docker compose down -v
docker compose up -d postgres
pnpm install --frozen-lockfile
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
```

Expected: all migrations succeed from empty DB.

- [ ] **Step 2: Run static/unit/integration gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm verify:pwa
```

Expected: PASS.

- [ ] **Step 3: Run both E2E commands**

Run:

```bash
pnpm e2e
pnpm e2e:offline
```

Expected: standard E2E includes Slice 01–04 browser scenarios; isolated offline suite still proves Slice 03 with no API dependency.

- [ ] **Step 4: Re-run real PostgreSQL outage proof and add sync outage assertion**

With API healthy first, stop PostgreSQL and verify `/health/live=200`, `/health/ready=503`, existing memory mutation returns safe `503`, and `/sync/v1/push` returns safe structured `503` without payload text/SQL leakage. Restart PostgreSQL and prove pending client work subsequently synchronizes without ID change.

- [ ] **Step 5: Verify acceptance invariants I1–I15 explicitly**

Create a short machine-readable or test-linked checklist mapping each invariant in the spec to at least one passing automated/E2E/integration proof. Any unmapped invariant blocks evidence finalization.

- [ ] **Step 6: Commit only scoped fixes if needed**

If no fixes were needed, do not create an empty commit.

---

### Task 22: Produce Slice 04 evidence package and checkpoint without claiming unavailable gates

**Files:**
- Create: `docs/evidence/slice-04/SLICE-04-EVIDENCE-001.md`
- Create: `docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md`
- Create: `docs/phases/SLICE-04.md`
- Create: `docs/superpowers/specs/2026-08-18-slice-04-synchronization-review.md`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/README.md`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-PLAN.md`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-REPORT.md`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-DECISIONS.md`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-VALIDATION.txt`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-VALIDATION-FULL.txt`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-SMOKE.txt`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-CHECKPOINT.yaml`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-ARTIFACT-MANIFEST.sha256`
- Modify: `.github/workflows/ci.yml` only to verify the frozen Slice 04 manifest after it exists.

**Interfaces:**
- Evidence must cite exact branch HEAD, exact workflow run/job IDs, exact test counts, E2E counts, schema proof, outage proof, and invariants.

- [ ] **Step 1: Capture immutable validation output**

Record exact commands and outputs from Task 21. Do not copy planned counts; use actual observed results.

- [ ] **Step 2: Write review with explicit gate truth**

Record MESTRE review findings by severity. If Emily/LÉO independent gates are unavailable, write `NOT PERFORMED / NOT CLAIMED`; do not simulate them.

- [ ] **Step 3: Build SHA-256 manifest after evidence files are frozen**

From the artifact directory:

```bash
sha256sum README.md PHASE-04-PLAN.md PHASE-04-REPORT.md PHASE-04-DECISIONS.md PHASE-04-VALIDATION.txt PHASE-04-VALIDATION-FULL.txt PHASE-04-SMOKE.txt PHASE-04-CHECKPOINT.yaml > PHASE-04-ARTIFACT-MANIFEST.sha256
sha256sum -c PHASE-04-ARTIFACT-MANIFEST.sha256
```

Expected: every entry `OK`.

- [ ] **Step 4: Add manifest verification to CI and rerun complete CI**

Do not edit the frozen manifest contents after the qualifying CI without creating a clearly newer evidence revision.

- [ ] **Step 5: Commit evidence**

```bash
git add docs/evidence/slice-04 docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md docs/phases/SLICE-04.md docs/superpowers/specs/2026-08-18-slice-04-synchronization-review.md artifacts/phases/SLICE-04-SYNCHRONIZATION .github/workflows/ci.yml
git commit -m "docs(slice-04): freeze synchronization evidence"
```

---

### Task 23: Prepare the HUMAN_GATE for merge; do not merge automatically

**Files:**
- No implementation changes.
- `docs/STATE.md` must not claim Slice 04 merged before the authorized merge actually occurs.

**Interfaces:**
- Produces a factual gate packet for LEANDRO.

- [ ] **Step 1: Confirm branch is based on the expected main lineage and has no unrelated changes**

Run equivalent of:

```bash
git diff --stat main...HEAD
git log --oneline main..HEAD
```

- [ ] **Step 2: Confirm latest qualifying CI is green on exact candidate HEAD**

Record workflow run ID/job ID/SHA.

- [ ] **Step 3: Present merge gate with explicit recommendation**

Use MCF format and mark recommendation:

```text
✅ A — AUTORIZAR MERGE SLICE 04 — RECOMENDADA PELO MESTRE
⬜ B — NÃO AUTORIZAR / CORRIGIR ANTES DO MERGE
```

- [ ] **Step 4: Stop**

Do not merge, do not start Slice 05 implementation, and do not infer authorization from a bare continuation message unless it is answering this explicit HUMAN_GATE.

---

## Plan Self-Review Checklist

Before requesting implementation authorization, verify this plan against the written spec:

- Spec §1 governance: implementation/merge/real data/pilot gates preserved — covered by Global Constraints and Task 23.
- §§2–6 objective/local-first/bidirectional/event unit — Tasks 1, 12–16.
- §§7–8 Fact DAG/conflict/current projection — Tasks 2–3, 4, 7, 12–13, 19.
- §9 protocol versioning — Tasks 1, 10, 14, 20.
- §10 client instance — Tasks 11, 13.
- §§11–13 bootstrap/push/pull/idempotency/dependencies — Tasks 7–10, 13–15.
- §§14–15 Transactional Outbox/retention — Tasks 4–9.
- §§16–17 IndexedDB v3/local atomicity — Tasks 11–13.
- §§18–21 SyncEngine/retry/UI/pagination — Tasks 14–16, 18–20.
- §§22–24 security/deletion/infrastructure boundaries — Global Constraints + Task 17.
- §25 stable error model — Tasks 1, 7–10, 14.
- §26 test strategy and 12 required E2E scenarios — Tasks 18–21.
- §27 invariants I1–I15 — Task 21 mapping.
- §28 DoD/regression/evidence — Tasks 21–23.
- §29 later-slice non-goals — Global Constraints + architecture guard.
- §30 all 30 approved decisions — represented by tasks above; no alternate server-wins/LWW/background-worker path introduced.

No `TBD`, `TODO`, “implement later”, unspecified validation step, or automatic merge instruction is permitted in the executable plan.

## Execution Handoff

This plan is complete only as a planning artifact. **Implementation remains blocked until LEANDRO gives the explicit Slice 04 implementation authorization required by governance.**

After that gate, preferred execution is **Subagent-Driven Development** if the runtime provides independent subagents; otherwise use **Inline Execution** with `superpowers:executing-plans`, task-by-task checkpoints, without pretending unavailable subagent/Emily/LÉO gates were executed.
