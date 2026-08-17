# Slice 04 — Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable bidirectional synchronization between the Slice 03 local IndexedDB repository and the PostgreSQL server, with immutable event transport, transactional Outbox, idempotent retry, causal conflict preservation, fixed-snapshot bootstrap, and deterministic convergence.

**Architecture:** Keep the PWA local-first: local domain writes commit to IndexedDB together with a persistent outbound event, then a dedicated `SyncEngine` performs versioned `bootstrap → push → pull` over HTTP. PostgreSQL is the durable convergence coordinator; every server-accepted canonical mutation, including existing `/memories` writes, commits canonical rows, causal `FactRelation` rows, projection updates, a commit-ordered feed cursor, and one immutable `SyncOutbox` envelope in the same transaction. Canonical truth remains Evidence + LedgerEvent + Fact + FactRelation; `CurrentFact`, open-conflict state, cursors, and sync status are reconstructible projections.

**Tech Stack:** TypeScript 6, React, Vite PWA, IndexedDB, NestJS, PostgreSQL, Prisma, Zod, Vitest, Playwright, pnpm 10, Node.js 24.

**Approved design:** `docs/superpowers/specs/2026-08-17-slice-04-synchronization-design.md`, design HEAD `4608498ce05a5fe44d1bb1d49f3a308996f575e7`. LEANDRO approved the written specification through `HUMAN_SPEC_REVIEW_GATE` on 2026-08-18. That approval authorized this implementation plan, not implementation itself.

## Global Constraints

- Implementation must start only after a separate explicit HUMAN_GATE; this plan does not authorize implementation or merge.
- Real sensitive data: **NOT AUTHORIZED**. Fixtures, tests, E2E, logs, evidence, and demos use synthetic/controlled data only.
- Pilot: **NOT AUTHORIZED**.
- Protocol version is exactly `1` for Slice 04; every persisted/retried envelope carries `protocolVersion: 1`.
- `mdp-local` migration is exactly **v2 → v3**, non-destructive, with all existing UUIDs preserved.
- Client-generated UUID v7 identifiers remain definitive; there is no server remapping.
- Synchronization is bidirectional.
- Synchronization unit is immutable event + immutable dependencies.
- Event types in scope are exactly `MEMORY_CREATED`, `MEMORY_CORRECTED`, `CONFLICT_RESOLVED`.
- Deletion, purge, remote wipe, and content tombstone semantics are out of scope.
- `eventId` is the sole logical idempotency key; retry never creates a replacement ID.
- `CONFLICT` means the outbound event was durably accepted and acknowledged while the memory remains unresolved; the accepted event is removed from pending retry.
- Push is atomic per event. Pull is atomic per page. Bootstrap promotion is atomic.
- Server feed ordering is operational only. Timestamp, UUID order, and network arrival order never decide causal truth.
- Feed sequence must reflect serialized transactional acceptance order. Do not use standalone `BIGSERIAL` allocation or `MAX(sequence)` as the ordering primitive.
- Every server canonical sync-visible write and corresponding Outbox record commit in one PostgreSQL transaction.
- Redis, BullMQ, separate worker processes, WebSocket, peer-to-peer sync, and mandatory Service Worker Background Sync are not introduced.
- `clientInstanceId` identifies an installation operationally; it is not authentication or authorization.
- Foreground automatic sync + explicit `Synchronize now`; bounded exponential backoff + jitter applies only to transient failures.
- Cursor advances only in the same local transaction that successfully applies the corresponding pull page or completed bootstrap promotion.
- Outbox retention is operational/configurable and never deletes canonical memory history.
- Slices 01–03 behavior and tests remain green, including isolated offline PWA regression and PostgreSQL outage safety.

---

## Exact Protocol Types

Task 1 must create these logical shapes in `packages/contracts/src/sync.ts` using Zod schemas and exported inferred TypeScript types. ISO timestamps use the same contract conventions as existing memory contracts. UUID fields use the existing UUID validation style.

```ts
export const SYNC_PROTOCOL_VERSION = 1 as const;
export type SyncCursor = string; // decimal BIGINT string
export type SyncEventType = 'MEMORY_CREATED' | 'MEMORY_CORRECTED' | 'CONFLICT_RESOLVED';

export interface SyncMemoryRecord {
  kind: 'memory';
  id: string;
  recordedAt: string;
  occurredAt: null;
  temporalPrecision: 'unknown';
}

export interface SyncEvidenceRecord {
  kind: 'evidence';
  id: string;
  memoryId: string;
  evidenceKind: 'text';
  content: string;
  createdAt: string;
}

export interface SyncLedgerEventRecord {
  kind: 'ledgerEvent';
  id: string;
  memoryId: string;
  evidenceId: string;
  factId: string | null;
  supersedesFactId: string | null;
  eventType: SyncEventType;
  reason: string | null;
  createdAt: string;
}

export interface SyncFactRecord {
  kind: 'fact';
  id: string;
  memoryId: string;
  evidenceId: string;
  factKind: 'autobiographical_statement';
  content: string;
  createdAt: string;
}

export interface SyncFactRelationRecord {
  kind: 'factRelation';
  memoryId: string;
  predecessorFactId: string;
  successorFactId: string;
  relationType: 'SUPERSEDES';
}

export type SyncCanonicalRecord =
  | SyncMemoryRecord
  | SyncEvidenceRecord
  | SyncLedgerEventRecord
  | SyncFactRecord
  | SyncFactRelationRecord;

export interface SyncEventEnvelope {
  protocolVersion: 1;
  eventId: string;
  eventType: SyncEventType;
  memoryId: string;
  predecessorFactIds: string[];
  records: SyncCanonicalRecord[];
}

export type SyncPushEventResult =
  | { eventId: string; status: 'APPLIED' }
  | { eventId: string; status: 'ALREADY_APPLIED' }
  | { eventId: string; status: 'CONFLICT' }
  | { eventId: string; status: 'DEPENDENCY_MISSING'; missingFactIds: string[] }
  | { eventId: string; status: 'BLOCKED'; code: 'SYNC_BLOCKED' }
  | { eventId: string; status: 'INVALID'; code: 'SYNC_INTEGRITY_VIOLATION' };

export type SyncErrorCode =
  | 'SYNC_PROTOCOL_UNSUPPORTED'
  | 'SYNC_CURSOR_EXPIRED'
  | 'SYNC_BOOTSTRAP_EXPIRED'
  | 'SYNC_DEPENDENCY_MISSING'
  | 'SYNC_INTEGRITY_VIOLATION'
  | 'SYNC_SERVICE_UNAVAILABLE'
  | 'SYNC_BLOCKED';
```

Every event envelope includes the Memory record, the event's Evidence, LedgerEvent, Fact, and zero or more FactRelation records. This controlled duplication makes each envelope self-contained and safe for immutable idempotent replay.

---

## Exact PostgreSQL Slice 04 Shape

Task 4 must implement the following physical semantics. Prisma names may be idiomatic models, but table/column names below are the database contract and CI checks use them verbatim.

```sql
DROP INDEX IF EXISTS "facts_supersedes_fact_id_key";
CREATE UNIQUE INDEX "facts_id_memory_id_key" ON "facts"("id", "memory_id");

CREATE TABLE "fact_relations" (
  "memory_id" UUID NOT NULL,
  "predecessor_fact_id" UUID NOT NULL,
  "successor_fact_id" UUID NOT NULL,
  "relation_type" VARCHAR(32) NOT NULL,
  CONSTRAINT "fact_relations_pkey" PRIMARY KEY ("predecessor_fact_id", "successor_fact_id"),
  CONSTRAINT "fact_relations_no_self_edge_check" CHECK ("predecessor_fact_id" <> "successor_fact_id"),
  CONSTRAINT "fact_relations_type_check" CHECK ("relation_type" = 'SUPERSEDES'),
  CONSTRAINT "fact_relations_predecessor_fkey" FOREIGN KEY ("predecessor_fact_id", "memory_id") REFERENCES "facts"("id", "memory_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fact_relations_successor_fkey" FOREIGN KEY ("successor_fact_id", "memory_id") REFERENCES "facts"("id", "memory_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fact_relations_memory_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "fact_relations_memory_id_idx" ON "fact_relations"("memory_id");
CREATE INDEX "fact_relations_predecessor_idx" ON "fact_relations"("predecessor_fact_id");
CREATE INDEX "fact_relations_successor_idx" ON "fact_relations"("successor_fact_id");

INSERT INTO "fact_relations" ("memory_id", "predecessor_fact_id", "successor_fact_id", "relation_type")
SELECT "memory_id", "supersedes_fact_id", "id", 'SUPERSEDES'
FROM "facts"
WHERE "supersedes_fact_id" IS NOT NULL;

CREATE TABLE "sync_feed_state" (
  "id" INTEGER NOT NULL,
  "current_sequence" BIGINT NOT NULL,
  CONSTRAINT "sync_feed_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sync_feed_state_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "sync_feed_state_sequence_check" CHECK ("current_sequence" >= 0)
);
INSERT INTO "sync_feed_state" ("id", "current_sequence") VALUES (1, 0);

CREATE TABLE "sync_outbox" (
  "sequence" BIGINT NOT NULL,
  "event_id" UUID NOT NULL,
  "protocol_version" INTEGER NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "memory_id" UUID NOT NULL,
  "origin_client_instance_id" UUID,
  "payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sync_outbox_pkey" PRIMARY KEY ("sequence"),
  CONSTRAINT "sync_outbox_event_id_key" UNIQUE ("event_id"),
  CONSTRAINT "sync_outbox_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "sync_outbox_protocol_check" CHECK ("protocol_version" > 0),
  CONSTRAINT "sync_outbox_memory_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "sync_outbox_memory_id_idx" ON "sync_outbox"("memory_id");
CREATE INDEX "sync_outbox_created_at_idx" ON "sync_outbox"("created_at");

CREATE TABLE "sync_conflicts" (
  "memory_id" UUID NOT NULL,
  "baseline_fact_id" UUID NOT NULL,
  "candidate_fact_ids" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "resolution_fact_id" UUID,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("memory_id"),
  CONSTRAINT "sync_conflicts_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED')),
  CONSTRAINT "sync_conflicts_candidates_array_check" CHECK (jsonb_typeof("candidate_fact_ids") = 'array'),
  CONSTRAINT "sync_conflicts_memory_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sync_conflicts_baseline_fkey" FOREIGN KEY ("baseline_fact_id") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sync_conflicts_resolution_fkey" FOREIGN KEY ("resolution_fact_id") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "sync_bootstrap_snapshots" (
  "token" UUID NOT NULL,
  "high_watermark" BIGINT NOT NULL,
  "records" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sync_bootstrap_snapshots_pkey" PRIMARY KEY ("token"),
  CONSTRAINT "sync_bootstrap_snapshots_watermark_check" CHECK ("high_watermark" >= 0),
  CONSTRAINT "sync_bootstrap_snapshots_records_array_check" CHECK (jsonb_typeof("records") = 'array')
);
CREATE INDEX "sync_bootstrap_snapshots_expires_at_idx" ON "sync_bootstrap_snapshots"("expires_at");

ALTER TABLE "ledger_events"
ADD CONSTRAINT "ledger_events_conflict_resolved_fact_link_check"
CHECK (
  "type" <> 'CONFLICT_RESOLVED'
  OR ("fact_id" IS NOT NULL AND "supersedes_fact_id" IS NULL)
);
```

`Fact.supersedesFactId` remains a non-unique legacy compatibility mirror for normal corrections only; FactRelation is authoritative. A `CONFLICT_RESOLVED` fact has no single authoritative legacy predecessor, so its legacy field is null and its multiple predecessors live exclusively in `fact_relations`.

---

## Exact IndexedDB v3 Shape

Task 11 upgrades `mdp-local` to version `3` in the existing versionchange transaction.

- Existing stores remain: `memories`, `evidence`, `ledgerEvents`, `facts`, `currentFacts`.
- `factRelations`: keyPath `['predecessorFactId', 'successorFactId']`; indexes `memoryId`, `predecessorFactId`, `successorFactId`.
- `syncOutbox`: keyPath `eventId`; indexes `memoryId`, `status`, `nextAttemptAt`.
- `syncState`: keyPath `key`; no secondary index.
- `syncConflicts`: keyPath `memoryId`; index `status`.
- `bootstrapStaging`: keyPath `['bootstrapToken', 'recordKey']`; index `bootstrapToken`.
- The old unique `facts.supersedesFactId` index is deleted during v3 upgrade. No replacement uniqueness constraint is created.
- Existing Facts with `supersedesFactId` are backfilled into `factRelations` before the upgrade transaction completes.

---

### Task 1: Define protocol v1 schemas and stable sync semantics

**Files:**
- Create: `packages/contracts/src/sync.ts`
- Create: `packages/contracts/src/sync.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:** Produces the exact protocol types listed above plus request/response Zod schemas for push, pull, bootstrap start/page, and structured top-level sync errors.

- [ ] **Step 1: Write failing tests for version, cursors, envelopes, and outcomes**

```ts
expect(syncCursorSchema.parse('9007199254740993')).toBe('9007199254740993');
expect(() => syncEventEnvelopeSchema.parse({ ...validEnvelope, protocolVersion: 2 })).toThrow();
expect(syncPushEventResultSchema.parse({ eventId, status: 'CONFLICT' })).toEqual({ eventId, status: 'CONFLICT' });
expect(syncPushEventResultSchema.parse({ eventId, status: 'DEPENDENCY_MISSING', missingFactIds: [factId] }).missingFactIds).toEqual([factId]);
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run packages/contracts/src/sync.test.ts`

Expected: FAIL because `sync.ts` does not exist.

- [ ] **Step 3: Implement exact schemas/types**

Additional exact transport shapes:

```ts
export interface SyncPushRequest {
  protocolVersion: 1;
  clientInstanceId: string;
  events: SyncEventEnvelope[];
}
export interface SyncPushResponse {
  protocolVersion: 1;
  results: SyncPushEventResult[];
}
export interface SyncPullEvent {
  sequence: SyncCursor;
  envelope: SyncEventEnvelope;
}
export interface SyncPullResponse {
  protocolVersion: 1;
  events: SyncPullEvent[];
  nextCursor: SyncCursor;
  hasMore: boolean;
}
export interface SyncBootstrapStartResponse {
  protocolVersion: 1;
  bootstrapToken: string;
  highWatermarkCursor: SyncCursor;
  totalRecords: number;
}
export interface SyncBootstrapPageResponse {
  protocolVersion: 1;
  bootstrapToken: string;
  records: SyncCanonicalRecord[];
  nextOffset: number | null;
}
```

Push request schema requires `1..SYNC_MAX_BATCH_SIZE` at service validation time; contracts enforce nonempty arrays and individual field sizes using existing text/reason limits.

- [ ] **Step 4: Export and verify**

Run: `pnpm exec vitest run packages/contracts/src/sync.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/sync.ts packages/contracts/src/sync.test.ts packages/contracts/src/index.ts
git commit -m "feat(slice-04): define synchronization protocol contracts"
```

---

### Task 2: Implement canonical Fact DAG validation, ordering, and projection

**Files:**
- Create: `packages/domain/src/fact-graph.ts`
- Create: `packages/domain/src/fact-graph.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

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
export function orderFactGraphHistory(nodes: FactGraphNode[], relations: FactRelationRecord[]): Array<{ factId: string; predecessorFactIds: string[] }>;
```

- [ ] **Step 1: Write RED tests**

Required graphs:

```text
A→B→C                            => RESOLVED C
A→B and A→C                      => CONFLICT baseline A candidates B,C
A→B,A→C,B→D,C→D                 => RESOLVED D
A→B,A→C,B→D,C→D,B→E,C→E         => CONFLICT baseline A candidates D,E
A→B→A                            => BROKEN_GRAPH
missing relation endpoint         => BROKEN_GRAPH
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run packages/domain/src/fact-graph.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement topological sort and deepest common dominator baseline**

For root `R`, `dom(R)={R}`. For each non-root node in topological order:

```text
dom(node) = {node} union intersection(dom(pred1), dom(pred2), ...)
```

With multiple leaf candidates, intersect all leaf dominator sets and select the deepest member by topological depth. Presentation ties sort by `createdAt` then `factId`; this order is presentation-only and never resolves truth.

- [ ] **Step 4: Verify domain regression**

Run: `pnpm exec vitest run packages/domain/src/fact-graph.test.ts packages/domain/src/correction.test.ts packages/domain/src/memory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/fact-graph.ts packages/domain/src/fact-graph.test.ts packages/domain/src/index.ts
git commit -m "feat(slice-04): model causal fact graph"
```

---

### Task 3: Add append-only conflict resolution and graph-aware memory contracts

**Files:**
- Create: `packages/domain/src/conflict-resolution.ts`
- Create: `packages/domain/src/conflict-resolution.test.ts`
- Modify: `packages/domain/src/correction.ts`
- Modify: `packages/domain/src/correction.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/contracts/src/memory.ts`
- Modify: `packages/contracts/src/memory.test.ts`

**Interfaces:** `createConflictResolutionRecord()` creates one new Evidence, Fact, `CONFLICT_RESOLVED` LedgerEvent (`factId=newFact`, `supersedesFactId=null`), and one FactRelation from every expected candidate to the new Fact.

- [ ] **Step 1: Write RED resolution tests**

```ts
const result = createConflictResolutionRecord({
  memoryId,
  baselineFactId,
  candidateFactIds: [factB, factC],
  text: 'Versão confirmada',
  resolvedAt,
  ids: { evidenceId, eventId, factId: factD },
});
expect(result.relations.map((item) => item.predecessorFactId).sort()).toEqual([factB, factC].sort());
expect(result.event.type).toBe('CONFLICT_RESOLVED');
expect(result.event.factId).toBe(factD);
expect(result.event.supersedesFactId).toBeNull();
```

Candidate IDs must be unique, at least two, and match the currently open conflict at repository application time.

- [ ] **Step 2: Add RED contract tests for conflict query/history**

Add request:

```ts
interface ResolveConflictRequest {
  expectedCandidateFactIds: string[];
  text: string;
  reason?: string;
}
```

Add query variant:

```ts
interface MemoryConflictResponse {
  status: 'CONFLICT';
  answer: null;
  provenance: null;
  conflict: {
    memoryId: string;
    baseline: { factId: string; evidenceId: string; content: string };
    candidates: Array<{ factId: string; evidenceId: string; content: string }>;
  };
}
```

Every history version adds `predecessorFactIds: string[]`. Existing `supersedesFactId` remains for backward-compatible normal corrections and is null for roots/multi-predecessor resolutions.

- [ ] **Step 3: Implement and verify**

Run: `pnpm exec vitest run packages/domain/src/conflict-resolution.test.ts packages/contracts/src/memory.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src packages/contracts/src/memory.ts packages/contracts/src/memory.test.ts
git commit -m "feat(slice-04): define conflict resolution domain flow"
```

---

### Task 4: Apply exact PostgreSQL Slice 04 migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260818000100_slice_04_synchronization/migration.sql`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts`

**Interfaces:** Produces exactly the physical schema defined above; preserves all previous rows/UUIDs.

- [ ] **Step 1: Add a migration upgrade test fixture**

In the real-PostgreSQL verification path, apply migrations through Slice 02, insert synthetic root A + corrected Fact B with legacy `supersedes_fact_id=A`, then apply the Slice 04 migration. Assert the new `fact_relations` row is exactly `(memoryId,A,B,'SUPERSEDES')` and all old rows still exist.

- [ ] **Step 2: Implement the exact DDL above**

Also update Prisma `Fact` self-relation from one-to-one successor semantics to non-unique legacy successors and add authoritative `FactRelation` models/relations. `SyncOutbox.sequence` has no autoincrement/default.

- [ ] **Step 3: Add physical assertions**

```sql
SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='facts_supersedes_fact_id_key';
SELECT current_sequence FROM sync_feed_state WHERE id=1;
SELECT relation_type FROM fact_relations WHERE predecessor_fact_id=$1 AND successor_fact_id=$2;
```

Expected unique-index count `0`, initial feed state `0`, and relation type `SUPERSEDES`.

- [ ] **Step 4: Validate from clean and upgraded databases**

```bash
docker compose up -d postgres
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts
git commit -m "feat(slice-04): migrate synchronization persistence schema"
```

---

### Task 5: Build common transactional canonical writer and commit-ordered feed allocation

**Files:**
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.integration.test.ts`

**Interfaces:**

```ts
class PrismaCanonicalMemoryWriter {
  writeEnvelope(tx: PrismaTransactionClient, envelope: SyncEventEnvelope, originClientInstanceId: string | null): Promise<DerivedMemoryProjection>;
}
async function allocateFeedSequence(tx: PrismaTransactionClient): Promise<bigint>;
```

- [ ] **Step 1: Write RED real-DB atomicity/concurrency tests**

Prove canonical+relations+projection+Outbox commit together; forced failure before Outbox rolls everything back; two concurrent accepted writers get serialized visible sequences; rollback of sequence allocation leaves `current_sequence` unchanged.

- [ ] **Step 2: Implement sequence allocation with singleton row update**

Execute within the same transaction:

```sql
UPDATE "sync_feed_state"
SET "current_sequence" = "current_sequence" + 1
WHERE "id" = 1
RETURNING "current_sequence";
```

The row lock is the ordering primitive. Do not call PostgreSQL sequence functions.

- [ ] **Step 3: Implement canonical payload hash**

Recursively sort object keys, preserve array order from validated contract, stringify, SHA-256, and store lowercase 64-hex `payload_hash`. Idempotency compares this hash.

- [ ] **Step 4: Apply immutable records safely**

Existing same-ID immutable rows must canonical-compare equal; otherwise throw integrity violation. Insert FactRelations, derive projection, update `CurrentFact`, and upsert `sync_conflicts`. For resolved state with a prior OPEN conflict, set it `RESOLVED` with `resolution_fact_id=currentFactId`; for a fresh chain with no prior conflict, no conflict row is required.

- [ ] **Step 5: Allocate feed sequence, insert Outbox, and prune inside the transaction**

Sequence allocation occurs after canonical validation and before commit. Outbox payload is the validated envelope. Pruning is added in Task 8.

- [ ] **Step 6: Verify**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer*
git commit -m "feat(slice-04): add transactional canonical sync writer"
```

---

### Task 6: Route existing server memory create/correct through the common writer

**Files:**
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

**Interfaces:** Public `MemoryStore` behavior stays compatible; direct server-origin Outbox rows use `originClientInstanceId=null`.

- [ ] **Step 1: Add RED assertions after existing store create/correct**

Create produces one Outbox row matching the `MEMORY_CREATED` event ID. Correct produces one FactRelation predecessor→successor and one Outbox row matching the `MEMORY_CORRECTED` event ID. Definitive UUIDs are unchanged.

- [ ] **Step 2: Construct exact self-contained envelopes from existing domain records**

Every create/correct envelope includes the existing Memory record plus its event-specific Evidence, LedgerEvent, Fact, and correction relation when applicable.

- [ ] **Step 3: Replace duplicated canonical transaction writes with `PrismaCanonicalMemoryWriter`**

Keep existing outage error mapping and service/controller response types unchanged.

- [ ] **Step 4: Verify existing integration suite**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-memory.store*
git commit -m "refactor(slice-04): publish server memory writes to sync outbox"
```

---

### Task 7: Implement server push idempotency, dependency recovery, and accepted conflicts

**Files:**
- Create: `apps/api/src/sync/sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

**Interfaces:**

```ts
export const SYNC_STORE = Symbol('SYNC_STORE');
export interface SyncStore {
  pushEvent(clientInstanceId: string, envelope: SyncEventEnvelope): Promise<SyncPushEventResult>;
}
```

- [ ] **Step 1: Write RED real-DB outcome tests**

Cases: new event→`APPLIED`; exact replay→`ALREADY_APPLIED`; same eventId/different payload→`INVALID/SYNC_INTEGRITY_VIOLATION`; absent predecessor→`DEPENDENCY_MISSING` with zero writes; second valid successor→durably accepted `CONFLICT`; replay accepted conflict→`ALREADY_APPLIED`.

- [ ] **Step 2: Idempotency check by Outbox `event_id` + `payload_hash`**

If same ID/hash exists, acknowledge without reapplying. If same ID/different hash exists, fail closed.

- [ ] **Step 3: Validate dependencies before canonical mutation**

Every `predecessorFactId` must already exist or be present as a Fact record in the same self-contained envelope. Missing IDs return sorted unique `missingFactIds` and create no canonical/Outbox row.

- [ ] **Step 4: Apply via common writer and derive status**

Resulting OPEN conflict returns `CONFLICT`; otherwise `APPLIED`. The conflict event is already durable and must not remain pending on the sender.

- [ ] **Step 5: Verify**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t push`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): implement idempotent sync push"
```

---

### Task 8: Implement pull, exact cursor-expiry semantics, and bounded Outbox retention

**Files:**
- Modify: `apps/api/src/sync/sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Create or Modify: `apps/api/src/config/env.test.ts`

**Interfaces:**

```ts
pull(after: SyncCursor, limit: number): Promise<SyncPullResponse>;
```

Exact operational defaults:

```text
SYNC_MAX_BATCH_SIZE=50
SYNC_OUTBOX_MAX_ENTRIES=10000
SYNC_BOOTSTRAP_TTL_SECONDS=900
```

- [ ] **Step 1: Write RED pull/retention tests**

Require strict ascending `sequence > after`, decimal-string JSON cursors, bounded limit, `nextCursor`, `hasMore`, pruning, and canonical data preservation.

- [ ] **Step 2: Implement exact cursor validation**

Let `current` be `sync_feed_state.current_sequence` and `oldest` be minimum retained Outbox sequence.

```text
after > current                         => INVALID / SYNC_INTEGRITY_VIOLATION
after = current                         => empty page, nextCursor=after, hasMore=false
current = 0                             => empty page
oldest is null AND after < current      => SYNC_CURSOR_EXPIRED
oldest is not null AND after < oldest-1 => SYNC_CURSOR_EXPIRED
otherwise                               => query retained rows with sequence > after
```

`after = oldest-1` is valid because the next required event is exactly the oldest retained event.

- [ ] **Step 3: Implement retention inside accepted-event transaction**

After assigning accepted sequence `N`, delete only Outbox rows satisfying `sequence <= N - SYNC_OUTBOX_MAX_ENTRIES`. Never cascade or manually delete canonical rows.

- [ ] **Step 4: Verify config and real DB behavior**

Run:

```bash
pnpm exec vitest run apps/api/src/config/env.test.ts
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t pull
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): add pull cursor and outbox retention"
```

---

### Task 9: Implement consistent fixed-snapshot paginated bootstrap

**Files:**
- Modify: `apps/api/src/sync/sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

**Interfaces:**

```ts
startBootstrap(clientInstanceId: string): Promise<SyncBootstrapStartResponse>;
readBootstrapPage(token: string, offset: number, limit: number): Promise<SyncBootstrapPageResponse>;
```

- [ ] **Step 1: Write RED bootstrap tests**

Prove pre-Outbox historical rows are included; snapshot/high-water mark are consistent; concurrent post-snapshot write appears only in later pull with sequence greater than watermark; pages are stable; expired token is rejected; bootstrap never mutates canonical data.

- [ ] **Step 2: Materialize snapshot in one `RepeatableRead` transaction**

Read `sync_feed_state.current_sequence`, then all immutable Memory/Evidence/LedgerEvent/Fact/FactRelation rows visible to the same snapshot. Flatten to `SyncCanonicalRecord[]`. Deterministic kind rank is exactly:

```text
memory=0
evidence=1
ledgerEvent=2
fact=3
factRelation=4
```

Sort by `memoryId`, then kind rank, then stable record key (`id` for entity/event/fact; `predecessorFactId + ':' + successorFactId` for relation). Store exact JSON array with UUID-v7 token, watermark, expiry `now + SYNC_BOOTSTRAP_TTL_SECONDS`, and createdAt.

Commit-ordered feed allocation ensures a write invisible to this Repeatable Read snapshot receives a feed cursor greater than the captured watermark when it commits.

- [ ] **Step 3: Page only the stored snapshot**

Validate offset `>=0`, limit `1..SYNC_MAX_BATCH_SIZE`, slice stored array, and return `nextOffset=null` at end. Do not read live canonical tables for later pages.

- [ ] **Step 4: Cleanup expired snapshots opportunistically**

Delete rows with `expires_at <= now` at bootstrap start/read; this is operational cleanup only.

- [ ] **Step 5: Verify**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t bootstrap`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): add consistent paginated bootstrap"
```

---

### Task 10: Expose NestJS sync endpoints with stable structured errors

**Files:**
- Create: `apps/api/src/sync/sync.service.ts`
- Create: `apps/api/src/sync/sync.service.test.ts`
- Create: `apps/api/src/sync/sync.controller.ts`
- Create: `apps/api/src/sync/sync.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Endpoints:**

```text
POST /sync/v1/bootstrap/start
GET  /sync/v1/bootstrap/:token?offset=0&limit=50
POST /sync/v1/push
GET  /sync/v1/pull?after=<decimal-cursor>&limit=50
```

- [ ] **Step 1: Write RED controller/service tests**

Cover unsupported protocol, invalid cursor/limit, push per-event results, cursor/bootstrap expiration, integrity violation, and PostgreSQL unavailability. Error body exposes stable `code` and never SQL/payload text.

- [ ] **Step 2: Implement schema-first service validation**

Parse all request/response boundaries with `@mdp/contracts`. Process push events sequentially or with bounded order-preserving iteration so each event owns one independent transaction and response order matches request order.

- [ ] **Step 3: Map transport status without replacing stable codes**

Use `400` protocol/validation, `409` integrity conflict, `410` cursor/bootstrap expired, `422` semantic/dependency rejection when top-level, `503` persistence outage. Push per-event domain outcomes remain a `200` batch response because one event cannot abort independent neighbors.

- [ ] **Step 4: Register providers/controller**

`AppModule` injects existing `PrismaService`, parsed env limits, clock, and `createId` into `PrismaSyncStore`/`SyncService`.

- [ ] **Step 5: Verify API unit regression**

Run: `pnpm exec vitest run apps/api/src/sync apps/api/src/memories apps/api/src/health`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync apps/api/src/app.module.ts
git commit -m "feat(slice-04): expose synchronization API"
```

---

### Task 11: Upgrade IndexedDB v2 → v3 exactly and backfill FactRelation

**Files:**
- Modify: `apps/web/src/lib/indexeddb/mdp-local-db.ts`
- Modify: `apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

**Interfaces:** Implements the exact IndexedDB v3 shape above.

- [ ] **Step 1: Write RED v2 fixture migration test**

Seed v2 with Memory, root Fact A, correction Fact B (`supersedesFactId=A`), Evidence, LedgerEvents, CurrentFact. Upgrade to v3 and assert every old row/UUID/content survives, relation A→B exists, and C with legacy `supersedesFactId=A` can now be inserted because the old unique index is gone.

- [ ] **Step 2: Define exact v3 record types**

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
interface LocalSyncStateRecord {
  key: 'clientInstanceId' | 'confirmedCursor' | 'bootstrap';
  value: unknown;
}
interface LocalSyncConflictRecord {
  memoryId: string;
  baselineFactId: string;
  candidateFactIds: string[];
  status: 'OPEN' | 'RESOLVED';
  resolutionFactId: string | null;
  updatedAt: Date;
}
interface LocalBootstrapStagingRecord {
  bootstrapToken: string;
  recordKey: string;
  record: SyncCanonicalRecord;
}
```

- [ ] **Step 3: Implement `upgradeToV3` in the versionchange transaction**

Create stores/indexes exactly as specified. Delete `facts` index `supersedesFactId`. Cursor all existing Facts and add FactRelation rows for each non-null legacy predecessor. Any failure aborts upgrade.

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/indexeddb/mdp-local-db*
git commit -m "feat(slice-04): migrate local database to sync v3"
```

---

### Task 12: Make local create/correct/resolve atomically enqueue events and use DAG history

**Files:**
- Modify: `apps/web/src/lib/memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`
- Modify: `apps/web/src/lib/memory-repository.test.ts`

**Interfaces:** Adds `resolveConflict(memoryId, request)` and local error `CONFLICT_REQUIRES_RESOLUTION`.

- [ ] **Step 1: Write RED atomicity tests**

Create→one pending `MEMORY_CREATED` envelope; correct→relation + pending `MEMORY_CORRECTED`; injected `syncOutbox.add()` failure aborts whole local domain mutation; correction while conflict OPEN rejects; resolve→new Evidence/Fact/Event + relation from every candidate + pending `CONFLICT_RESOLVED`.

- [ ] **Step 2: Replace ambiguous store list constants**

Keep `CANONICAL_STORES = ['memories','evidence','ledgerEvents','facts','currentFacts','factRelations']`, `SYNC_STORES = ['syncOutbox','syncState','syncConflicts','bootstrapStaging']`, and use explicit transaction store arrays per operation.

- [ ] **Step 3: Generate exact immutable self-contained envelopes in the same transaction**

No secondary idempotency ID. `eventId` is the domain LedgerEvent ID. Every envelope includes Memory + event-specific immutable records.

- [ ] **Step 4: Replace linear history authority**

Use FactRelations + `orderFactGraphHistory`. Preserve `supersedesFactId` only as compatibility output when a version has exactly one legacy predecessor. Multi-parent resolution has `supersedesFactId:null` and complete `predecessorFactIds`.

- [ ] **Step 5: Make query conflict-aware**

If current `syncConflicts.status='OPEN'`, return the explicit `CONFLICT` response. Never return baseline/candidate as a normal `FOUND` answer.

- [ ] **Step 6: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts apps/web/src/lib/memory-repository.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/memory-repository* apps/web/src/lib/indexeddb/indexeddb-memory-repository*
git commit -m "feat(slice-04): enqueue local memory events atomically"
```

---

### Task 13: Implement IndexedDbSyncStore atomic pull and bootstrap promotion

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

- [ ] **Step 1: Write RED identity/acknowledgement tests**

`clientInstanceId` is UUID v7, persistent in one DB, different in a new DB. `APPLIED`, `ALREADY_APPLIED`, `CONFLICT` acknowledge/remove pending outbound event. `DEPENDENCY_MISSING` remains PENDING. `BLOCKED/INVALID` becomes BLOCKED with stable code.

- [ ] **Step 2: Implement immutable add-or-verify**

For each canonical record ID/key, existing identical content is idempotent; existing different content aborts with `LOCAL_DATA_INTEGRITY_ERROR`. Never blindly `put()` immutable canonical rows.

- [ ] **Step 3: Write/implement atomic pull page**

One readwrite transaction applies all page records, recomputes each touched memory projection, updates CurrentFact/conflict projection, and writes `confirmedCursor=page.nextCursor`. Any record/projection failure aborts everything and cursor stays unchanged.

- [ ] **Step 4: Rebuild projection deterministically**

RESOLVED→exactly one CurrentFact for derived leaf. OPEN CONFLICT→CurrentFact points to baseline as internal baseline projection, `syncConflicts` stores OPEN candidates, and query layer still returns `CONFLICT`. If an existing OPEN conflict becomes resolved, write RESOLVED projection with resolutionFactId; a later new branch may replace it with OPEN.

- [ ] **Step 5: Implement bootstrap staging and atomic promotion**

Pages write only `bootstrapStaging`. Promotion transaction merges staged immutable records with existing local canonical rows, never touches local `syncOutbox`, rebuilds all touched projections, writes watermark cursor, and deletes staging rows. Failure rolls back promotion and preserves old state/cursor/pending events.

- [ ] **Step 6: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-sync-store*
git commit -m "feat(slice-04): add local synchronization store"
```

---

### Task 14: Implement versioned HTTP client and deterministic bounded retry policy

**Files:**
- Create: `apps/web/src/lib/sync/sync-api.ts`
- Create: `apps/web/src/lib/sync/sync-api.test.ts`
- Create: `apps/web/src/lib/sync/retry.ts`
- Create: `apps/web/src/lib/sync/retry.test.ts`

**Interfaces:** `SyncApiClient.startBootstrap/readBootstrapPage/push/pull`; `computeRetryDelay`; `classifySyncFailure`.

- [ ] **Step 1: Write RED API tests**

Every request/response validates protocol v1; cursor remains string; unknown shape fails closed; structured `code` maps to typed error; sync responses are not written to Cache API.

- [ ] **Step 2: Write RED retry tests with injected `random()`**

Exact policy:

```ts
const raw = Math.min(500 * 2 ** attempt, 10_000);
const jitterFactor = 0.8 + random() * 0.4;
const delayMs = Math.round(raw * jitterFactor);
```

Maximum automatic retry attempts per foreground cycle: `5`. Network errors/timeouts/502/503 are transient. Protocol/integrity/blocked and accepted conflict are not transport retries.

- [ ] **Step 3: Implement injected-fetch client and retry functions**

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/sync/sync-api.test.ts apps/web/src/lib/sync/retry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sync
git commit -m "feat(slice-04): add sync transport and retry policy"
```

---

### Task 15: Implement single-flight SyncEngine convergence loop

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

- [ ] **Step 1: Write RED orchestration tests using fake API/local store**

No network offline; no cursor→complete bootstrap then push/pull; normal push then pull until `hasMore=false`; dependency missing→pull then retry same event ID; cursor expired→rebootstrap preserving pending; simultaneous synchronize calls share one in-flight promise; transient retry bounded; permanent stop.

- [ ] **Step 2: Implement bootstrap loop**

Stage every page by token. Confirm watermark only through `promoteBootstrap`. On `SYNC_BOOTSTRAP_EXPIRED`, discard only that token staging and restart bootstrap.

- [ ] **Step 3: Implement push/pull loop**

Send at most configured batch limit. Apply explicit results before pull. Accepted conflict is acknowledged. Pull pages commit atomically through local store. Repeat only while there is known productive work; cap dependency/retry loops to prevent infinite foreground spin.

- [ ] **Step 4: Keep triggers foreground-only**

Expose engine methods; React wiring handles startup, `online`, pending, and manual. Do not register Background Sync.

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/sync/sync-engine.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sync/sync-engine*
git commit -m "feat(slice-04): implement synchronization engine"
```

---

### Task 16: Integrate global/per-memory sync state and conflict resolution UI

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

**Interfaces:** Global `OFFLINE | SYNCED | PENDING | SYNCING | CONFLICT | ERROR`; per-memory `LOCAL_PENDING | SYNCING | SYNCED | CONFLICT | BLOCKED`.

- [ ] **Step 1: Write RED UI tests**

Offline save states local persistence only; pending/syncing/synced states are distinct; manual button invokes engine; conflict shows baseline plus every candidate; resolution always calls local `resolveConflict()` and creates a new fact.

- [ ] **Step 2: Wire one engine at app boundary**

Subscribe on mount, trigger startup if online, listen to browser `online`, and trigger when new pending work appears. Memory form submit never calls remote memory/sync API directly.

- [ ] **Step 3: Use truthful copy**

Local success: `Salva neste dispositivo.` Sync projection alone may display `Sincronizada` after remote acknowledgement.

- [ ] **Step 4: Render conflict branch**

`MemoryFoundResult` on `status==='CONFLICT'` never renders baseline/candidate as a normal resolved answer.

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run apps/web/src/App.test.tsx apps/web/src/features/memory apps/web/src/features/sync apps/web/src/lib/sync/use-sync-state.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App* apps/web/src/features apps/web/src/lib/sync/use-sync-state*
git commit -m "feat(slice-04): surface synchronization and conflict state"
```

---

### Task 17: Add architecture and physical schema guards

**Files:**
- Create: `tests/architecture/slice-04-scope.test.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write RED architecture guard**

Fail if production/package sources introduce Redis client/BullMQ, WebSocket sync infrastructure, mandatory `SyncManager` Background Sync, `MEMORY_DELETED`, purge/remote-wipe endpoints, last-write-wins/server-wins switches, or active UI dual-write to `memory-api`.

- [ ] **Step 2: Replace exact table assertion with Slice 04 exact list**

```text
current_facts,evidence,fact_relations,facts,ledger_events,memories,sync_bootstrap_snapshots,sync_conflicts,sync_feed_state,sync_outbox
```

- [ ] **Step 3: Add exact physical schema assertions**

Require old facts unique index count `0`; `fact_relations` PK/FKs/checks; `sync_outbox.event_id` unique; `sync_outbox.sequence` BIGINT primary key with no default; singleton feed row exists; bootstrap records JSONB/expiry index; conflict status check exists; conflict-resolved LedgerEvent check exists.

- [ ] **Step 4: Verify architecture/lint/format**

Run: `pnpm exec vitest run tests/architecture/slice-04-scope.test.ts && pnpm lint && pnpm format:check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/architecture/slice-04-scope.test.ts .github/workflows/ci.yml
git commit -m "test(slice-04): guard synchronization architecture"
```

---

### Task 18: Add core synchronization E2E

**Files:**
- Create: `tests/e2e/synchronization-core.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Set deterministic synthetic E2E API config**

```ts
SYNC_MAX_BATCH_SIZE: '4',
SYNC_OUTBOX_MAX_ENTRIES: '8',
SYNC_BOOTSTRAP_TTL_SECONDS: '30',
```

- [ ] **Step 2: E2E — offline create/correct → online convergence**

Set browser context offline; create/correct; restore online; sync; verify server history and local history retain identical definitive IDs/content.

- [ ] **Step 3: E2E — server commits, response lost, retry same event**

Intercept first push, call `route.fetch()` so real server commits, then abort response to page. Retry must reuse event ID and server must contain one logical effect.

- [ ] **Step 4: E2E — device A create → device B bootstrap/pull**

Two browser contexts; same memory/evidence/fact IDs on A, B, server.

- [ ] **Step 5: E2E — dependent event arrives before predecessor**

Intercept/reorder push batch so dependent event is processed first; observe `DEPENDENCY_MISSING`, then predecessor accepted, then same dependent event ID succeeds.

- [ ] **Step 6: Verify**

Run: `pnpm exec playwright test tests/e2e/synchronization-core.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/synchronization-core.spec.ts playwright.config.ts
git commit -m "test(slice-04): cover core synchronization flows"
```

---

### Task 19: Add conflict/resolution E2E

**Files:**
- Create: `tests/e2e/synchronization-conflicts.spec.ts`

- [ ] **Step 1: Concurrent correction conflict**

Two devices bootstrap Fact A, go offline, produce B/C, reconnect. Assert B/C both durable, OPEN conflict, baseline A not shown as normal truth, no timestamp winner.

- [ ] **Step 2: Human resolution**

Resolve B/C to new D. Assert D UUID differs from B/C even if text equals a candidate, relations B→D/C→D exist, all replicas converge, B/C remain in history.

- [ ] **Step 3: Bootstrap meets local pending branch**

Server A→B; new client has local pending A→C before first bootstrap. Promotion preserves both and opens conflict; no overwrite.

- [ ] **Step 4: Concurrent resolution recursively conflicts**

Two devices independently resolve B/C to D/E before syncing. Assert new OPEN conflict candidates D/E with dominator baseline A; neither resolution auto-wins.

- [ ] **Step 5: Verify**

Run: `pnpm exec playwright test tests/e2e/synchronization-conflicts.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/synchronization-conflicts.spec.ts
git commit -m "test(slice-04): prove conflict preservation and resolution"
```

---

### Task 20: Add bootstrap/cursor/failure/protocol recovery E2E

**Files:**
- Create: `tests/e2e/synchronization-recovery.spec.ts`

- [ ] **Step 1: New device fixed bootstrap then incremental pull**

Seed server with synthetic history using existing API; fresh context bootstraps; later server change arrives through pull after captured watermark.

- [ ] **Step 2: Cursor expires after pruning**

Device confirms old cursor; generate more than 8 Outbox events; reconnect. `SYNC_CURSOR_EXPIRED` causes rebootstrap. A separate local pending event survives and subsequently pushes.

- [ ] **Step 3: Pull page local failure keeps cursor unchanged**

Intercept pull response and mutate one immutable same-ID record to different content. Atomic apply fails and cursor stays unchanged. Remove intercept, manual retry authentic page, success.

- [ ] **Step 4: Bootstrap failure mid-pagination remains invisible**

Abort later bootstrap page after earlier staging. Partial remote records remain staging-only; existing local state usable; new bootstrap succeeds.

- [ ] **Step 5: Unsupported protocol preserves pending/cursor**

Intercept client push, forward modified request with `protocolVersion:999` to real API, relay real rejection. Pending remains, cursor unchanged. Remove intercept and v1 sync succeeds.

- [ ] **Step 6: Verify**

Run: `pnpm exec playwright test tests/e2e/synchronization-recovery.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/synchronization-recovery.spec.ts
git commit -m "test(slice-04): prove synchronization recovery semantics"
```

---

### Task 21: Run full regression, real PostgreSQL outage proof, and invariant mapping

**Files:**
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-INVARIANTS.yaml`
- Modify implementation files only if a legitimate scoped regression requires a fix.

- [ ] **Step 1: Clean DB and validate full migration chain**

```bash
docker compose down -v
docker compose up -d postgres
pnpm install --frozen-lockfile
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
```

Expected: PASS from empty PostgreSQL.

- [ ] **Step 2: Static/unit/integration/build gates**

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm verify:pwa
```

Expected: PASS.

- [ ] **Step 3: Browser gates**

```bash
pnpm e2e
pnpm e2e:offline
```

Expected: standard suite covers Slices 01–04; isolated offline suite remains Slice 03-only and API-independent.

- [ ] **Step 4: Extend real PostgreSQL outage proof to sync**

Start healthy API; prove live=200/ready=200. Stop PostgreSQL; prove live=200/ready=503; existing memory mutation and `/sync/v1/push` return safe structured 503 with `SYNC_SERVICE_UNAVAILABLE`/existing safe envelope as appropriate; response contains no synthetic memory content and no SQL text. Restart DB; same local pending UUID synchronizes successfully.

- [ ] **Step 5: Write exact invariant mapping YAML**

Structure:

```yaml
slice: 4
invariants:
  I1:
    statement: no silent overwrite
    proofs:
      - tests/e2e/synchronization-conflicts.spec.ts
  I2:
    statement: original Evidence is never destroyed by synchronization
    proofs:
      - apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts
      - tests/e2e/synchronization-conflicts.spec.ts
```

Continue explicitly through I15 from the approved spec. Every invariant must have at least one concrete automated proof path; no generic “covered by tests” entry.

- [ ] **Step 6: Commit invariant map with any scoped qualification fixes**

```bash
git add artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-INVARIANTS.yaml
git commit -m "test(slice-04): map synchronization acceptance invariants"
```

---

### Task 22: Freeze evidence/checkpoint/review package

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
- Existing from Task 21: `PHASE-04-INVARIANTS.yaml`
- Create: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-ARTIFACT-MANIFEST.sha256`
- Modify: `.github/workflows/ci.yml` to verify frozen Slice 04 manifest.

- [ ] **Step 1: Capture actual observed outputs only**

Evidence records exact candidate HEAD, actual test file/test counts, E2E counts, migration/schema proof, outage proof, invariant map, workflow run/job IDs. Never copy planned counts as observed facts.

- [ ] **Step 2: Write review truthfully**

MESTRE review severity findings are explicit. If Emily/LÉO gates are unavailable, record `NOT PERFORMED / NOT CLAIMED`; do not simulate them.

- [ ] **Step 3: Freeze artifact manifest**

```bash
cd artifacts/phases/SLICE-04-SYNCHRONIZATION
sha256sum README.md PHASE-04-PLAN.md PHASE-04-REPORT.md PHASE-04-DECISIONS.md PHASE-04-VALIDATION.txt PHASE-04-VALIDATION-FULL.txt PHASE-04-SMOKE.txt PHASE-04-CHECKPOINT.yaml PHASE-04-INVARIANTS.yaml > PHASE-04-ARTIFACT-MANIFEST.sha256
sha256sum -c PHASE-04-ARTIFACT-MANIFEST.sha256
```

Expected: all entries `OK`.

- [ ] **Step 4: Add CI manifest verification and run complete qualifying CI on exact candidate HEAD**

Do not alter frozen evidence after the qualifying run without producing an explicit newer evidence revision.

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/slice-04 docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md docs/phases/SLICE-04.md docs/superpowers/specs/2026-08-18-slice-04-synchronization-review.md artifacts/phases/SLICE-04-SYNCHRONIZATION .github/workflows/ci.yml
git commit -m "docs(slice-04): freeze synchronization evidence"
```

---

### Task 23: Prepare HUMAN_GATE; do not merge automatically

**Files:** No product changes. `docs/STATE.md` must not claim Slice 04 merged before an authorized merge actually occurs.

- [ ] **Step 1: Verify branch scope and lineage**

```bash
git diff --stat main...HEAD
git log --oneline main..HEAD
```

- [ ] **Step 2: Verify latest qualifying CI is green on exact candidate HEAD**

Record exact workflow run ID, job ID, and SHA in gate packet.

- [ ] **Step 3: Present explicit MCF merge gate with recommendation marked**

```text
✅ A — AUTORIZAR MERGE SLICE 04 — RECOMENDADA PELO MESTRE
⬜ B — NÃO AUTORIZAR / CORRIGIR ANTES DO MERGE
```

- [ ] **Step 4: Stop**

Do not merge, do not start Slice 05 implementation, and do not interpret unrelated/bare continuation as merge authorization unless it directly answers this explicit gate.

---

## Self-Review Coverage Map

- Governance/authorization: Global Constraints, Task 23.
- Local-first + bidirectional event sync: Tasks 1, 12–16.
- Fact DAG / conflict baseline / resolution: Tasks 2–5, 7, 12–13, 19.
- Protocol versioning/client installation ID: Tasks 1, 11, 13–15, 20.
- Bootstrap/push/pull/idempotency/dependency: Tasks 7–10, 13–15.
- Transactional Outbox/commit-order cursor/retention: Tasks 4–9.
- IndexedDB v3/local atomicity: Tasks 11–13.
- Retry/status/pagination: Tasks 8–10, 13–16.
- Security/deletion/infrastructure boundaries: Global Constraints + Task 17.
- Stable error model: Tasks 1, 7–10, 14.
- All 12 required E2E scenarios: Tasks 18–20.
- Acceptance invariants I1–I15: Task 21 exact YAML mapping.
- DoD/regression/evidence/CI/HUMAN_GATE: Tasks 21–23.
- No later-slice capability is introduced.

Self-review result: no `TBD`, `TODO`, omitted SQL column list, unspecified table name, automatic merge action, or implicit implementation authorization remains in this plan.

## Execution Handoff

This is a planning artifact only. **Slice 04 implementation remains NOT AUTHORIZED until LEANDRO explicitly authorizes implementation.**

If implementation is authorized in this runtime, the available path is inline task-by-task execution using `superpowers:executing-plans`; independent subagent execution must only be claimed if an actual subagent runtime is available. Unavailable Emily/LÉO/subagent gates must never be retroactively claimed.
