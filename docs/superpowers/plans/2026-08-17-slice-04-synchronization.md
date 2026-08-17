# Slice 04 — Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable bidirectional synchronization between the Slice 03 IndexedDB local-first repository and PostgreSQL, with idempotent event delivery, causal conflict preservation, safe bootstrap/rebootstrap, retry, human conflict resolution, and deterministic convergence.

**Architecture:** Keep `MemoryRepository` local-first and add a separate `SyncEngine`/local sync store boundary. Canonical history is represented by immutable Memory/Evidence/LedgerEvent/Fact plus explicit N:N `FactRelation`; `CurrentFact`, conflict state, and transport state remain projections. The NestJS API coordinates convergence through PostgreSQL and a Transactional Outbox; no Redis/BullMQ/worker is introduced.

**Tech Stack:** TypeScript 6.0.3, Node >=24 <25, pnpm 10.34.0, React/Vite PWA, IndexedDB, NestJS, PostgreSQL, Prisma, Zod, Vitest, Playwright.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-08-17-slice-04-synchronization-design.md` at approved HEAD `4608498ce05a5fe44d1bb1d49f3a308996f575e7`.
- Written design approval record: `docs/superpowers/specs/2026-08-17-slice-04-synchronization-design-approval.md`.
- Repository functional baseline: `main@0637cbd32ed7e4a3b484cfebf771f9871cad2eb8`.
- Implementation is **NOT AUTHORIZED** until LEANDRO grants the explicit Slice 04 implementation gate after reviewing this plan.
- When implementation is authorized, create `slice/04-synchronization` from the approved planning HEAD; do not implement directly on `main` or the design branch.
- Merge remains separately gated even after implementation/CI succeeds.
- Real sensitive data and pilot remain `NOT AUTHORIZED`.
- `mdp-local` must migrate non-destructively from version `2` to version `3`; existing UUIDs and content must not be remapped or dropped.
- The active UI remains local-first: no UI dual-write to IndexedDB + HTTP.
- `eventId` is the canonical idempotency key; retry never generates a replacement event ID.
- Synchronization protocol version is `1` and every persisted/transmitted sync envelope carries `protocolVersion: 1`.
- Supported sync event types in Slice 04 are exactly `MEMORY_CREATED`, `MEMORY_CORRECTED`, and `CONFLICT_RESOLVED`.
- Deletion/purge, semantic retrieval, AI, voice, reminders, passkeys/trusted sessions, and pilot behavior are outside this plan.
- No Redis, BullMQ, WebSocket requirement, peer-to-peer sync, or mandatory Service Worker Background Sync.
- Server feed ordering uses PostgreSQL Outbox `sequence`; sequence/timestamp/UUID ordering must never be used as causal truth.
- Push is atomic per event; pull is atomic per page; bootstrap promotion is atomic locally.
- `CONFLICT` means the remote event was durably accepted and acknowledged while the memory remains unresolved; it must not stay in retry-pending state.
- All critical PostgreSQL transaction/idempotency behavior must be proved against the real database engine.
- Preserve every Slice 01–03 regression, including offline behavior, correction/history/restore, PWA update persistence, and outage-safe API behavior.

## File/Boundary Map

### Shared contracts

- Create `packages/contracts/src/sync.ts`: protocol v1 envelopes, push/pull/bootstrap schemas, stable result/error codes, sync status types.
- Create `packages/contracts/src/sync.test.ts`: schema and acknowledgement semantics tests.
- Modify `packages/contracts/src/memory.ts`: add explicit conflict query result.
- Modify `packages/contracts/src/memory.test.ts`: conflict response contract tests.
- Modify `packages/contracts/src/correction.ts`: add conflict-resolution request/response and graph-aware history predecessor arrays.
- Modify `packages/contracts/src/correction.test.ts`: resolution/history schema tests.
- Modify `packages/contracts/src/index.ts`: export new public contracts.

### Domain

- Create `packages/domain/src/causality.ts`: `FactRelation`, graph projection, frontier/conflict detection, deterministic history projection.
- Create `packages/domain/src/causality.test.ts`: normal chain, branch, multi-parent resolution, recursive resolution conflict, malformed graph tests.
- Create `packages/domain/src/conflict-resolution.ts`: pure creator for `CONFLICT_RESOLVED` Evidence/Fact/LedgerEvent/FactRelations.
- Create `packages/domain/src/conflict-resolution.test.ts`.
- Modify `packages/domain/src/correction.ts`: correction returns explicit `FactRelation`; `Fact.supersedesFactId` is no longer canonical domain state.
- Modify `packages/domain/src/correction.test.ts` and `packages/domain/src/index.ts`.

### PostgreSQL / Prisma

- Modify `prisma/schema.prisma`.
- Create `prisma/migrations/20260817234500_slice04_synchronization/migration.sql`.
- Add `FactRelation`, `SyncOutbox`, `SyncConflict`, `SyncBootstrapSession`, and `SyncBootstrapItem` models/tables.
- Backfill existing `facts.supersedes_fact_id` edges into `fact_relations`, then remove the old Fact self-edge column/unique constraint; keep `ledger_events.supersedes_fact_id` only as historical event metadata for single-predecessor corrections.

### API synchronization boundary

- Create `apps/api/src/sync/sync.store.ts`: persistence port.
- Create `apps/api/src/sync/sync.service.ts` and `sync.service.test.ts`.
- Create `apps/api/src/sync/sync.controller.ts` and `sync.controller.test.ts`.
- Create `apps/api/src/infrastructure/persistence/prisma/sync-envelope.ts` and test.
- Create `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts` and integration test.
- Modify `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts` and integration tests so legacy/direct server writes also append a sync envelope atomically.
- Modify `apps/api/src/app.module.ts` for dependency wiring.
- Modify `apps/api/src/config/env.ts`, `.env.example`, and corresponding tests for operational sync retention/bootstrap TTL settings.

### IndexedDB/local sync boundary

- Modify `apps/web/src/lib/indexeddb/mdp-local-db.ts` and tests for v3.
- Modify `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts` and tests for atomic local Outbox, FactRelation, conflict-aware query/history, and resolution.
- Create `apps/web/src/lib/indexeddb/indexeddb-sync-store.ts` and test.
- Create `apps/web/src/lib/sync/sync-store.ts`: local sync port/types.
- Create `apps/web/src/lib/sync/sync-api.ts` and test.
- Create `apps/web/src/lib/sync/sync-engine.ts` and test.
- Create `apps/web/src/lib/sync/retry-policy.ts` and test.
- Create `apps/web/src/lib/sync/use-sync.ts` and test.

### React/UI

- Create `apps/web/src/features/sync/SyncStatus.tsx` and test.
- Create `apps/web/src/features/memory/ConflictResolution.tsx` and test.
- Modify `apps/web/src/features/memory/MemoryFoundResult.tsx` and test.
- Modify `apps/web/src/App.tsx`, `App.test.tsx`, `main.tsx`, and `index.css`.

### Acceptance/E2E/governance

- Create `tests/e2e/synchronization.spec.ts`.
- Create `tests/e2e/helpers/sync-db.ts` for controlled synthetic DB manipulation/assertions only.
- Create `tests/architecture/slice-04-scope.test.ts`.
- Create `scripts/verify-slice04-sync.mjs` and add `verify:sync` to `package.json`.
- Modify `.github/workflows/ci.yml` to run Slice 04 schema/protocol/architecture/E2E verification.
- Create `docs/evidence/slice-04/SLICE-04-EVIDENCE-001.md`, `docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md`, `docs/phases/SLICE-04.md`, and `artifacts/phases/SLICE-04-SYNCHRONIZATION/*` only after implementation evidence exists.

---

### Task 1: Freeze protocol v1 and conflict contracts

**Files:**
- Create: `packages/contracts/src/sync.ts`
- Create: `packages/contracts/src/sync.test.ts`
- Modify: `packages/contracts/src/memory.ts`
- Modify: `packages/contracts/src/memory.test.ts`
- Modify: `packages/contracts/src/correction.ts`
- Modify: `packages/contracts/src/correction.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces `SYNC_PROTOCOL_VERSION`, `SyncEventEnvelope`, `SyncPushRequest`, `SyncPushResponse`, `SyncPullResponse`, `SyncBootstrapStartResponse`, `SyncBootstrapPageResponse`, stable result/error schemas, `ResolveMemoryConflictRequest/Response`, and conflict-aware `MemoryQueryResponse`.
- Later tasks must consume these exact contracts rather than duplicate transport DTOs.

- [ ] **Step 1: Write failing protocol contract tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  SYNC_PROTOCOL_VERSION,
  syncPushEventResultSchema,
  syncEventEnvelopeSchema,
} from './sync.js';

describe('sync protocol v1', () => {
  it('fixes protocol version to 1', () => {
    expect(SYNC_PROTOCOL_VERSION).toBe(1);
  });

  it('accepts CONFLICT as a durable acknowledgement', () => {
    expect(syncPushEventResultSchema.parse({
      eventId: '018f0000-0000-7000-8000-000000000001',
      status: 'CONFLICT',
      accepted: true,
    }).accepted).toBe(true);
  });

  it('rejects unsupported envelope versions', () => {
    expect(() => syncEventEnvelopeSchema.parse({
      protocolVersion: 2,
      eventId: '018f0000-0000-7000-8000-000000000001',
      eventType: 'MEMORY_CREATED',
      memoryId: '018f0000-0000-7000-8000-000000000002',
      originClientInstanceId: null,
      payload: {},
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run packages/contracts/src/sync.test.ts packages/contracts/src/memory.test.ts packages/contracts/src/correction.test.ts`

Expected: FAIL because sync contracts and conflict variants do not yet exist.

- [ ] **Step 3: Implement protocol constants/schemas**

`packages/contracts/src/sync.ts` must define the following stable semantic core:

```ts
import { z } from 'zod';

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_MAX_BATCH_SIZE = 50;

export const syncEventTypeSchema = z.enum([
  'MEMORY_CREATED',
  'MEMORY_CORRECTED',
  'CONFLICT_RESOLVED',
]);

export const syncFactRelationSchema = z.object({
  predecessorFactId: z.string().min(1),
  successorFactId: z.string().min(1),
  relationType: z.literal('SUPERSEDES'),
});

const canonicalMemorySchema = z.object({
  id: z.string().min(1),
  recordedAt: z.string(),
  occurredAt: z.null(),
  temporalPrecision: z.literal('unknown'),
});
const canonicalEvidenceSchema = z.object({
  id: z.string().min(1), memoryId: z.string().min(1), kind: z.literal('text'),
  content: z.string(), createdAt: z.string(),
});
const canonicalFactSchema = z.object({
  id: z.string().min(1), memoryId: z.string().min(1), evidenceId: z.string().min(1),
  kind: z.literal('autobiographical_statement'), content: z.string(), createdAt: z.string(),
});
const canonicalLedgerEventSchema = z.object({
  id: z.string().min(1), memoryId: z.string().min(1), evidenceId: z.string().min(1),
  factId: z.string().min(1).nullable(), supersedesFactId: z.string().min(1).nullable(),
  type: syncEventTypeSchema, reason: z.string().nullable(), createdAt: z.string(),
});

export const syncEventEnvelopeSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  eventId: z.string().min(1),
  eventType: syncEventTypeSchema,
  memoryId: z.string().min(1),
  originClientInstanceId: z.string().min(1).nullable(),
  payload: z.object({
    memory: canonicalMemorySchema.optional(),
    evidence: canonicalEvidenceSchema,
    fact: canonicalFactSchema,
    ledgerEvent: canonicalLedgerEventSchema,
    factRelations: z.array(syncFactRelationSchema),
  }),
});

export const syncPushEventResultSchema = z.discriminatedUnion('status', [
  z.object({ eventId: z.string(), status: z.literal('APPLIED'), accepted: z.literal(true) }),
  z.object({ eventId: z.string(), status: z.literal('ALREADY_APPLIED'), accepted: z.literal(true) }),
  z.object({ eventId: z.string(), status: z.literal('CONFLICT'), accepted: z.literal(true) }),
  z.object({ eventId: z.string(), status: z.literal('DEPENDENCY_MISSING'), accepted: z.literal(false), missingFactIds: z.array(z.string()).min(1) }),
  z.object({ eventId: z.string(), status: z.literal('BLOCKED'), accepted: z.literal(false), code: z.string() }),
  z.object({ eventId: z.string(), status: z.literal('INVALID'), accepted: z.literal(false), code: z.string() }),
]);

export type SyncEventEnvelope = z.infer<typeof syncEventEnvelopeSchema>;
export type SyncPushEventResult = z.infer<typeof syncPushEventResultSchema>;
```

Add bounded push/pull/bootstrap request/response schemas using `SYNC_MAX_BATCH_SIZE`; use cursor values as decimal strings at HTTP/JSON boundaries so PostgreSQL `BIGINT` does not lose precision in JavaScript JSON.

- [ ] **Step 4: Extend memory/correction contracts**

Add `MemoryQueryResponse` variant:

```ts
z.object({
  status: z.literal('CONFLICT'),
  answer: z.null(),
  provenance: z.null(),
  conflict: z.object({
    memoryId: z.string(),
    baseline: z.object({ factId: z.string(), evidenceId: z.string(), content: z.string() }),
    candidates: z.array(z.object({ factId: z.string(), evidenceId: z.string(), content: z.string() })).min(2),
  }),
})
```

Add resolution request/response contracts with `expectedCandidateFactIds: z.array(z.string()).min(2)` and graph-aware history `predecessorFactIds: string[]`. Keep the existing single `supersedesFactId` only on the correction response/event metadata where one direct correction has one predecessor; do not use it as graph authority.

- [ ] **Step 5: Run contract tests and full package typecheck**

Run: `pnpm vitest run packages/contracts/src && pnpm --filter @mdp/contracts typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(slice-04): define synchronization protocol contracts"
```

---

### Task 2: Introduce deterministic causal graph projection

**Files:**
- Create: `packages/domain/src/causality.ts`
- Create: `packages/domain/src/causality.test.ts`
- Modify: `packages/domain/src/correction.ts`
- Modify: `packages/domain/src/correction.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces `FactRelation`, `projectFactGraph(...)`, and `projectTextFactHistory(...)`.
- `projectFactGraph` is the single graph-projection algorithm used later by PostgreSQL and IndexedDB adapters.

- [ ] **Step 1: Write graph tests**

```ts
it('projects two terminal successors as an explicit conflict', () => {
  const result = projectFactGraph({
    factIds: ['A', 'B', 'C'],
    relations: [
      { predecessorFactId: 'A', successorFactId: 'B', relationType: 'SUPERSEDES' },
      { predecessorFactId: 'A', successorFactId: 'C', relationType: 'SUPERSEDES' },
    ],
  });
  expect(result).toEqual({ status: 'CONFLICT', baselineFactId: 'A', candidateFactIds: ['B', 'C'] });
});

it('closes B/C conflict when D causally succeeds both', () => {
  const result = projectFactGraph({
    factIds: ['A', 'B', 'C', 'D'],
    relations: [
      { predecessorFactId: 'A', successorFactId: 'B', relationType: 'SUPERSEDES' },
      { predecessorFactId: 'A', successorFactId: 'C', relationType: 'SUPERSEDES' },
      { predecessorFactId: 'B', successorFactId: 'D', relationType: 'SUPERSEDES' },
      { predecessorFactId: 'C', successorFactId: 'D', relationType: 'SUPERSEDES' },
    ],
  });
  expect(result).toEqual({ status: 'RESOLVED', currentFactId: 'D' });
});
```

Also test cycle rejection, relation to unknown fact rejection, multiple roots rejection, and two concurrent resolution leaves producing a new conflict.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/domain/src/causality.test.ts packages/domain/src/correction.test.ts`

Expected: FAIL because graph primitives do not exist and correction still embeds causal authority in `Fact.supersedesFactId`.

- [ ] **Step 3: Implement graph projection**

Define:

```ts
export interface FactRelation {
  readonly predecessorFactId: string;
  readonly successorFactId: string;
  readonly relationType: 'SUPERSEDES';
}

export type FactGraphProjection =
  | { readonly status: 'RESOLVED'; readonly currentFactId: string }
  | { readonly status: 'CONFLICT'; readonly baselineFactId: string; readonly candidateFactIds: readonly string[] };
```

Implementation requirements:

1. validate a DAG with one original root;
2. terminal facts are nodes with no successors;
3. one terminal => `RESOLVED`;
4. multiple terminals => `CONFLICT`;
5. `baselineFactId` is the deepest common ancestor of all terminal candidates by graph depth, with no timestamp/UUID used as causal authority;
6. output candidate IDs in lexical order only for deterministic serialization/display, never to choose a winner.

- [ ] **Step 4: Refactor correction creation**

`createTextCorrectionRecord()` must return:

```ts
{
  evidence,
  fact: { id, memoryId, evidenceId, kind, content, createdAt },
  event: { ...existing correction event metadata... },
  relation: {
    predecessorFactId: input.previous.factId,
    successorFactId: input.ids.factId,
    relationType: 'SUPERSEDES',
  },
  currentFact,
}
```

Do not include `supersedesFactId` on the canonical Fact object after this refactor.

- [ ] **Step 5: Replace linear history helper**

Implement `projectTextFactHistory(nodes, relations, projection)` so each returned history item has `predecessorFactIds`, `isOriginal`, `isCurrent`, and `isConflictCandidate`. Deterministic display order may be topological with `createdAt`/`factId` as a tie-breaker only after causal constraints are satisfied.

- [ ] **Step 6: Run domain tests**

Run: `pnpm vitest run packages/domain/src && pnpm --filter @mdp/domain typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src
git commit -m "feat(slice-04): model memory history as causal graph"
```

---

### Task 3: Add append-only conflict resolution domain operation

**Files:**
- Create: `packages/domain/src/conflict-resolution.ts`
- Create: `packages/domain/src/conflict-resolution.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces `createTextConflictResolutionRecord(...)` returning one new Evidence, Fact, LedgerEvent, one FactRelation per candidate predecessor, and projected CurrentFact.

- [ ] **Step 1: Write failing resolution tests**

```ts
it('creates one successor fact related to every conflict candidate', () => {
  const record = createTextConflictResolutionRecord({
    memoryId: 'M',
    candidates: [
      { factId: 'B', content: 'Berlin', recordedAt: new Date('2026-01-01T00:00:00Z') },
      { factId: 'C', content: 'Bonn', recordedAt: new Date('2026-01-01T00:00:00Z') },
    ],
    text: 'Berlin',
    resolvedAt: new Date('2026-08-17T20:00:00Z'),
    ids: { evidenceId: 'E-D', eventId: 'EV-D', factId: 'D' },
  });
  expect(record.event.type).toBe('CONFLICT_RESOLVED');
  expect(record.relations.map((r) => r.predecessorFactId)).toEqual(['B', 'C']);
  expect(record.relations.every((r) => r.successorFactId === 'D')).toBe(true);
});
```

Also reject fewer than two candidates, duplicate candidate IDs, empty/too-long text, and candidate-set mismatch semantics where applicable at repository level.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/domain/src/conflict-resolution.test.ts`

Expected: FAIL because creator does not exist.

- [ ] **Step 3: Implement minimal immutable creator**

Use the same text-length constraints as corrections. `LedgerEvent` must have `factId = new fact`, `supersedesFactId = null`, `type = 'CONFLICT_RESOLVED'`, and immutable Evidence. Causal truth lives in the returned relations array.

- [ ] **Step 4: Run tests/typecheck**

Run: `pnpm vitest run packages/domain/src/conflict-resolution.test.ts packages/domain/src/causality.test.ts && pnpm --filter @mdp/domain typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(slice-04): add append-only conflict resolution"
```

---

### Task 4: Migrate PostgreSQL to causal graph + sync infrastructure

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260817234500_slice04_synchronization/migration.sql`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync-schema.integration.test.ts`

**Interfaces:**
- Produces PostgreSQL tables `fact_relations`, `sync_outbox`, `sync_conflicts`, `sync_bootstrap_sessions`, `sync_bootstrap_items`.
- Removes canonical dependency on `facts.supersedes_fact_id` after backfill.

- [ ] **Step 1: Add failing real-PostgreSQL schema tests**

Tests must assert:

```ts
expect(tableNames).toEqual(expect.arrayContaining([
  'memories', 'evidence', 'ledger_events', 'facts', 'current_facts',
  'fact_relations', 'sync_outbox', 'sync_conflicts',
  'sync_bootstrap_sessions', 'sync_bootstrap_items',
]));
```

Seed a Slice 03 linear correction before migration, deploy migration, then assert its old `supersedes_fact_id` edge exists exactly once in `fact_relations` and all UUID/content rows remain unchanged.

- [ ] **Step 2: Verify RED against real PostgreSQL**

Run with compose PostgreSQL active:

`pnpm prisma:validate && pnpm prisma:generate && pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync-schema.integration.test.ts`

Expected: FAIL because new models/tables do not exist.

- [ ] **Step 3: Update Prisma schema**

Use these model semantics:

```prisma
model FactRelation {
  predecessorFactId String @map("predecessor_fact_id") @db.Uuid
  successorFactId   String @map("successor_fact_id") @db.Uuid
  relationType      String @map("relation_type") @db.VarChar(32)
  predecessor       Fact   @relation("FactRelationPredecessor", fields: [predecessorFactId], references: [id], onDelete: Restrict)
  successor         Fact   @relation("FactRelationSuccessor", fields: [successorFactId], references: [id], onDelete: Restrict)
  @@id([predecessorFactId, successorFactId, relationType])
  @@index([successorFactId])
  @@map("fact_relations")
}

model SyncOutbox {
  sequence               BigInt   @id @default(autoincrement())
  eventId                String   @unique @map("event_id") @db.Uuid
  protocolVersion        Int      @map("protocol_version")
  eventType              String   @map("event_type") @db.VarChar(64)
  memoryId               String   @map("memory_id") @db.Uuid
  originClientInstanceId String?  @map("origin_client_instance_id") @db.Uuid
  payload                Json
  createdAt              DateTime @map("created_at") @db.Timestamptz(3)
  @@index([createdAt, sequence])
  @@map("sync_outbox")
}
```

`SyncConflict` is a reconstructible projection keyed by `memoryId`, storing `baselineFactId`, JSON candidate ID array, `status`, optional `resolutionFactId`, and `updatedAt`.

`SyncBootstrapSession` stores UUID token, `highWatermark`, `expiresAt`, `createdAt`; `SyncBootstrapItem` stores `(sessionToken, position)` plus immutable JSON aggregate payload and cascades only with its operational session.

- [ ] **Step 4: Write migration SQL in safe order**

The migration must: create new tables/indexes/FKs; backfill `fact_relations` from non-null `facts.supersedes_fact_id`; verify via SQL constraint-safe operations; drop old Fact self-relation unique/index/FK/column only after successful backfill. Do not drop `ledger_events.supersedes_fact_id`.

- [ ] **Step 5: Deploy migration and run integration tests**

Run: `pnpm db:migrate && pnpm prisma:generate && pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync-schema.integration.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma apps/api/src/infrastructure/persistence/prisma/prisma-sync-schema.integration.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts
git commit -m "feat(slice-04): migrate persistence to sync causal graph"
```

---

### Task 5: Make existing server memory writes publish Transactional Outbox entries

**Files:**
- Create: `apps/api/src/infrastructure/persistence/prisma/sync-envelope.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/sync-envelope.test.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

**Interfaces:**
- Produces `serializeSyncEnvelope(record, originClientInstanceId)`.
- Guarantees direct API create/correct writes and matching `SyncOutbox` insert share one Prisma transaction.

- [ ] **Step 1: Add failing transaction tests**

Test server-side create produces exactly one outbox row with the same `eventId`; correction produces a `FactRelation` plus one outbox row. Inject an invalid outbox payload/write failure and assert canonical tables roll back too.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/sync-envelope.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

Expected: FAIL because server writes do not publish Outbox entries.

- [ ] **Step 3: Implement serializer**

Serializer converts Date fields to ISO strings and returns the Task 1 `SyncEventEnvelope`. For direct server API writes set `originClientInstanceId: null`.

- [ ] **Step 4: Extend PrismaMemoryStore transactions**

Inside the same `$transaction`, insert/update canonical rows, add `fact_relations` for correction, reproject current state, and create `sync_outbox` with `protocolVersion = 1`. Never append an outbox row after the transaction has already committed.

- [ ] **Step 5: Run integration tests**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

Expected: PASS including rollback proof.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma
git commit -m "feat(slice-04): publish server memory changes transactionally"
```

---

### Task 6: Implement idempotent server push and conflict/dependency outcomes

**Files:**
- Create: `apps/api/src/sync/sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

**Interfaces:**

```ts
export interface SyncStore {
  pushEvent(envelope: SyncEventEnvelope): Promise<SyncPushEventResult>;
  pullPage(after: bigint, limit: number): Promise<SyncPullPage>;
  startBootstrap(): Promise<SyncBootstrapStart>;
  readBootstrapPage(token: string, offset: number, limit: number): Promise<SyncBootstrapPage>;
  pruneOutboxBefore(cutoff: Date): Promise<number>;
}
```

- [ ] **Step 1: Write failing real-DB push tests**

Cover `APPLIED`, exact replay → `ALREADY_APPLIED`, same `eventId`/different payload → integrity failure/no write, missing predecessor → `DEPENDENCY_MISSING`, second successor of same predecessor → accepted `CONFLICT`, and multi-parent resolution → conflict closes/current becomes resolution fact.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

Expected: FAIL because `PrismaSyncStore` does not exist.

- [ ] **Step 3: Implement per-event transaction**

Algorithm inside one Prisma transaction:

```ts
const prior = await tx.syncOutbox.findUnique({ where: { eventId: envelope.eventId } });
if (prior) return immutablePayloadEquals(prior.payload, envelope) ? alreadyApplied() : integrityViolation();

const missing = await findMissingPredecessors(tx, envelope.payload.factRelations);
if (missing.length > 0) return dependencyMissing(missing);

await insertCanonicalEnvelope(tx, envelope);
const graph = await loadAndProjectMemoryGraph(tx, envelope.memoryId);
await rewriteCurrentAndConflictProjection(tx, envelope.memoryId, graph);
await tx.syncOutbox.create({ data: outboxRow(envelope) });
return graph.status === 'CONFLICT' ? conflictAccepted() : applied();
```

`insertCanonicalEnvelope` must reject ID collisions with non-equivalent immutable content rather than overwrite.

- [ ] **Step 4: Run integration tests**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts
git commit -m "feat(slice-04): apply pushed events idempotently"
```

---

### Task 7: Implement pull pagination, retention floor, and cursor expiration

**Files:**
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/config/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- `pullPage(after, limit)` returns ordered immutable envelopes, `nextCursor`, `hasMore`.
- Throws/returns stable `CURSOR_EXPIRED` when `after` predates retained feed floor.

- [ ] **Step 1: Add failing pagination/retention tests**

Create >50 outbox rows and assert page order uses `sequence`. Prune older rows, retain canonical rows, then assert old cursor receives `CURSOR_EXPIRED` while a valid recent cursor still pulls incrementally.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts apps/api/src/config/env.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add operational config**

Parse positive integers:

```ts
syncOutboxRetentionHours: Number(env.SYNC_OUTBOX_RETENTION_HOURS ?? '168'),
syncBootstrapTtlMinutes: Number(env.SYNC_BOOTSTRAP_TTL_MINUTES ?? '15'),
```

Add `.env.example` values `SYNC_OUTBOX_RETENTION_HOURS=168` and `SYNC_BOOTSTRAP_TTL_MINUTES=15`. These are operational defaults, not domain semantics.

- [ ] **Step 4: Implement pull/prune**

Clamp requested limit to `1..SYNC_MAX_BATCH_SIZE`; query `sequence > after` ordered ascending with `take: limit + 1`. `nextCursor` is last returned sequence as decimal string. Pruning deletes only `sync_outbox` rows older than cutoff; it must not cascade to canonical content.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts apps/api/src/config/env.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts apps/api/src/config .env.example
git commit -m "feat(slice-04): add ordered pull and cursor expiration"
```

---

### Task 8: Implement fixed-snapshot paginated bootstrap

**Files:**
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

**Interfaces:**
- `startBootstrap()` materializes a fixed canonical snapshot and high-watermark in one Repeatable Read transaction.
- `readBootstrapPage(token, offset, limit)` never mixes later writes into that snapshot.

- [ ] **Step 1: Add failing bootstrap consistency tests**

Test sequence:

1. seed Memory A;
2. start bootstrap and capture `highWatermark`;
3. create Memory B after bootstrap starts;
4. read all bootstrap pages and assert only A appears;
5. pull after high-watermark and assert B appears there;
6. expire token and assert `BOOTSTRAP_EXPIRED`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t bootstrap`

Expected: FAIL.

- [ ] **Step 3: Materialize snapshot atomically**

Use `prisma.$transaction(async tx => { ... }, { isolationLevel: 'RepeatableRead' })` to:

- capture current maximum Outbox sequence (`0` if none);
- read each Memory with Evidence, LedgerEvents, Facts, and FactRelations only;
- serialize one immutable aggregate per memory into ordered `sync_bootstrap_items`;
- create session with UUID token and configured expiry.

Do not serialize `CurrentFact` or `SyncConflict` as canonical truth; clients reproject them.

- [ ] **Step 4: Implement page reads**

Validate token/expiry, clamp page size, read ordered positions, return `nextOffset` + `hasMore` + original high-watermark. Expired session may be deleted with its operational items.

- [ ] **Step 5: Run bootstrap tests**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t bootstrap`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts
git commit -m "feat(slice-04): add consistent paginated bootstrap"
```

---

### Task 9: Expose versioned NestJS synchronization API

**Files:**
- Create: `apps/api/src/sync/sync.service.ts`
- Create: `apps/api/src/sync/sync.service.test.ts`
- Create: `apps/api/src/sync/sync.controller.ts`
- Create: `apps/api/src/sync/sync.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- `POST /sync/v1/push`
- `GET /sync/v1/pull?after=<decimal>&limit=<n>`
- `POST /sync/v1/bootstrap`
- `GET /sync/v1/bootstrap/:token?offset=<n>&limit=<n>`

- [ ] **Step 1: Write failing controller/service tests**

Assert Zod validation, version rejection, per-event push results, decimal cursor parsing, HTTP safe envelopes, and no leakage of SQL/internal error strings.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/src/sync`

Expected: FAIL because sync service/controller do not exist.

- [ ] **Step 3: Implement SyncService**

Service validates protocol contract and delegates persistence. Map stable errors:

```ts
SYNC_PROTOCOL_UNSUPPORTED
CURSOR_EXPIRED
BOOTSTRAP_EXPIRED
DEPENDENCY_MISSING
SYNC_INTEGRITY_VIOLATION
SYNC_BLOCKED
SERVICE_UNAVAILABLE
```

Do not infer domain semantics from HTTP status alone.

- [ ] **Step 4: Implement controller and DI**

Wire `PrismaSyncStore` in `AppModule`; controllers never access Prisma directly.

- [ ] **Step 5: Run API tests + typecheck**

Run: `pnpm vitest run apps/api/src/sync apps/api/src/infrastructure/persistence/prisma && pnpm --filter @mdp/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync apps/api/src/app.module.ts
git commit -m "feat(slice-04): expose synchronization api"
```

---

### Task 10: Migrate IndexedDB v2 → v3 without data loss

**Files:**
- Modify: `apps/web/src/lib/indexeddb/mdp-local-db.ts`
- Modify: `apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

**Interfaces:**
- Adds stores: `factRelations`, `syncOutbox`, `syncState`, `syncConflicts`, `bootstrapStaging`.
- Rewrites old Fact records to remove `supersedesFactId` after backfilling equivalent relations.

- [ ] **Step 1: Add failing v2 → v3 migration test**

Seed a real fake-indexeddb v2 database containing a root and corrected Fact, then open v3 and assert:

```ts
expect([...db.objectStoreNames]).toEqual(expect.arrayContaining([
  'memories', 'evidence', 'ledgerEvents', 'facts', 'currentFacts',
  'factRelations', 'syncOutbox', 'syncState', 'syncConflicts', 'bootstrapStaging',
]));
expect(await getRelation('old-fact', 'new-fact')).toBeDefined();
expect((await getFact('new-fact')).supersedesFactId).toBeUndefined();
```

Also assert all preexisting UUID/content fields survive and the upgraded DB remains writable.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

Expected: FAIL because shipping version is 2.

- [ ] **Step 3: Implement v3 store schema**

Set `MDP_LOCAL_DB_VERSION = 3`. Use compound key for `factRelations` (`[predecessorFactId, successorFactId, relationType]`), `eventId` key for `syncOutbox`, singleton key `'state'` for `syncState`, `memoryId` key for `syncConflicts`, and compound `[bootstrapToken, position]` for `bootstrapStaging`.

- [ ] **Step 4: Backfill inside upgrade transaction**

Cursor over `facts`; for every legacy `supersedesFactId`, add one FactRelation then rewrite the Fact without that property. Any constraint/integrity failure aborts the entire upgrade transaction.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/indexeddb/mdp-local-db.ts apps/web/src/lib/indexeddb/mdp-local-db.test.ts
git commit -m "feat(slice-04): migrate local database to sync v3"
```

---

### Task 11: Make local memory operations atomic with sync Outbox and conflicts

**Files:**
- Modify: `apps/web/src/lib/memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`

**Interfaces:**
- `create/correct/resolveConflict` write canonical local state + `syncOutbox` in one transaction.
- `query` returns `CONFLICT` when `syncConflicts` is open.
- `history` reports graph predecessors/candidates.

- [ ] **Step 1: Add failing atomicity tests**

Test create/correct each produce one pending envelope with exactly the domain event ID. Force `syncOutbox.add()` constraint/quota failure and assert no canonical local mutation commits. Test branch data projects baseline conflict rather than arbitrary current candidate.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`

Expected: FAIL.

- [ ] **Step 3: Extend transaction store sets**

For create use canonical stores + `syncOutbox`; for correction include `factRelations`, `syncOutbox`, `syncConflicts`. Build the immutable envelope before commit and add it in the same IDB transaction.

- [ ] **Step 4: Implement graph-aware correction/query/history**

Correction still checks `expectedCurrentFactId`; after creating a relation, re-run `projectFactGraph`. If conflict is open, persist conflict projection and keep `CurrentFact` at the baseline. Query checks conflict projection before returning a normal `FOUND` result.

- [ ] **Step 5: Add `resolveConflict`**

Extend `MemoryRepository`:

```ts
resolveConflict(memoryId: string, request: ResolveMemoryConflictRequest): Promise<ResolveMemoryConflictResponse>;
```

Require the request candidate set to equal the currently open candidate set, create an append-only resolution record, add all FactRelations + local Outbox atomically, reproject, and close conflict only if the new resolution is the sole frontier.

- [ ] **Step 6: Run local repository regressions**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts apps/web/src/features/memory`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts
git commit -m "feat(slice-04): queue local memory changes atomically"
```

---

### Task 12: Implement IndexedDB sync store and HTTP adapter

**Files:**
- Create: `apps/web/src/lib/sync/sync-store.ts`
- Create: `apps/web/src/lib/indexeddb/indexeddb-sync-store.ts`
- Create: `apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts`
- Create: `apps/web/src/lib/sync/sync-api.ts`
- Create: `apps/web/src/lib/sync/sync-api.test.ts`

**Interfaces:**

```ts
export interface LocalSyncStore {
  getOrCreateClientInstanceId(): Promise<string>;
  getCursor(): Promise<string | null>;
  listPending(limit: number): Promise<SyncEventEnvelope[]>;
  applyPushResults(results: readonly SyncPushEventResult[]): Promise<void>;
  applyPullPage(events: readonly SyncFeedEvent[], nextCursor: string): Promise<void>;
  beginBootstrap(meta: BootstrapMeta): Promise<void>;
  stageBootstrapPage(page: SyncBootstrapPageResponse): Promise<void>;
  promoteBootstrap(token: string): Promise<void>;
  clearBootstrap(token: string): Promise<void>;
  snapshotStatus(): Promise<SyncStatusSnapshot>;
}
```

- [ ] **Step 1: Write failing local store tests**

Assert persistent UUID v7 `clientInstanceId`, acknowledged statuses remove pending (`APPLIED`, `ALREADY_APPLIED`, `CONFLICT`), `DEPENDENCY_MISSING` remains pending, pull page applies canonical records/projections/cursor in one transaction, and payload collision rolls back page/cursor.

- [ ] **Step 2: Write failing HTTP adapter tests**

Mock `fetch` and assert endpoints, version/body validation, structured error mapping, decimal cursor preservation, and `503` classified transiently.

- [ ] **Step 3: Verify RED**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts apps/web/src/lib/sync/sync-api.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement local sync store**

Use the v3 stores. `applyPullPage` must call the same immutable collision checks and `projectFactGraph` as local writes, then update `syncConflicts`/`currentFacts` and cursor before one transaction commits.

- [ ] **Step 5: Implement SyncApi**

Expose typed methods `push`, `pull`, `startBootstrap`, `readBootstrapPage`. Parse every response through Task 1 Zod schemas before returning it.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts apps/web/src/lib/sync/sync-api.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/sync apps/web/src/lib/indexeddb/indexeddb-sync-store.ts apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts
git commit -m "feat(slice-04): add local sync store and api adapter"
```

---

### Task 13: Implement SyncEngine push/pull/retry and dependency recovery

**Files:**
- Create: `apps/web/src/lib/sync/retry-policy.ts`
- Create: `apps/web/src/lib/sync/retry-policy.test.ts`
- Create: `apps/web/src/lib/sync/sync-engine.ts`
- Create: `apps/web/src/lib/sync/sync-engine.test.ts`

**Interfaces:**
- `SyncEngine.syncNow(): Promise<SyncRunResult>`.
- Retry constants: base `500ms`, max `30000ms`, max automatic attempts per foreground trigger `5`, jitter factor `±20%` using injected RNG.

- [ ] **Step 1: Write retry policy tests**

```ts
expect(computeRetryDelayMs({ attempt: 0, random: () => 0.5 })).toBe(500);
expect(computeRetryDelayMs({ attempt: 1, random: () => 0.5 })).toBe(1000);
expect(computeRetryDelayMs({ attempt: 20, random: () => 0.5 })).toBe(30000);
```

Test only network/timeout/502/503/504 as transient; protocol/integrity/conflict are not transport retries.

- [ ] **Step 2: Write SyncEngine behavior tests**

Use fakes to prove:

- pending push then pull repeats until no work;
- accepted `CONFLICT` is acknowledged and run continues;
- `DEPENDENCY_MISSING` triggers pull/recovery then retries same event ID;
- lost response followed by `ALREADY_APPLIED` converges;
- cursor expiration routes to bootstrap;
- permanent blocked item does not loop;
- concurrent `syncNow()` calls coalesce to one in-flight run.

- [ ] **Step 3: Verify RED**

Run: `pnpm vitest run apps/web/src/lib/sync/retry-policy.test.ts apps/web/src/lib/sync/sync-engine.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement retry policy and engine**

Engine normal cycle:

```ts
while (cycles < maxCycles) {
  const pending = await store.listPending(SYNC_MAX_BATCH_SIZE);
  if (pending.length > 0) {
    const results = await api.push({ protocolVersion: 1, clientInstanceId, events: pending });
    await store.applyPushResults(results.results);
  }
  const page = await api.pull({ after: (await store.getCursor()) ?? '0', limit: SYNC_MAX_BATCH_SIZE });
  await store.applyPullPage(page.events, page.nextCursor);
  if (pending.length === 0 && !page.hasMore && !(await store.snapshotStatus()).hasPending) break;
}
```

Handle cursor expiration via bootstrap rather than retrying the same invalid cursor.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/web/src/lib/sync`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sync
git commit -m "feat(slice-04): synchronize pending and remote events"
```

---

### Task 14: Implement bootstrap staging and atomic promotion

**Files:**
- Modify: `apps/web/src/lib/indexeddb/indexeddb-sync-store.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts`
- Modify: `apps/web/src/lib/sync/sync-engine.ts`
- Modify: `apps/web/src/lib/sync/sync-engine.test.ts`

**Interfaces:**
- Bootstrap pages remain invisible in `bootstrapStaging` until full promotion.
- Promotion preserves local pending events and merges server/local causal branches using the same graph projection.

- [ ] **Step 1: Add failing staging tests**

Stage two pages and verify normal query stores remain unchanged. Simulate missing final page/expired token and verify existing local memory/pending Outbox remains. Promote complete server branch B against local pending branch C from A and assert both facts/relations exist and conflict candidates are `[B, C]`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts -t bootstrap apps/web/src/lib/sync/sync-engine.test.ts -t bootstrap`

Expected: FAIL.

- [ ] **Step 3: Implement staging**

`beginBootstrap` stores metadata in `syncState` but does not overwrite confirmed cursor. `stageBootstrapPage` validates token/high-watermark consistency and stores immutable aggregate items keyed by token/position.

- [ ] **Step 4: Implement promotion**

In one readwrite transaction over canonical, relation, conflict, state, and staging stores:

1. validate staged page completeness;
2. merge immutable server records by ID/equivalence;
3. preserve local pending canonical rows;
4. rebuild graph projection for affected memories;
5. update `currentFacts`/`syncConflicts`;
6. set confirmed cursor to bootstrap high-watermark;
7. delete staging/token metadata;
8. commit.

Any collision or failure aborts all eight operations.

- [ ] **Step 5: Connect SyncEngine bootstrap loop**

On first run with no confirmed bootstrap/cursor or on `CURSOR_EXPIRED`: start bootstrap, page until `hasMore=false`, promote, then resume normal pull after high-watermark.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts apps/web/src/lib/sync/sync-engine.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-sync-store.ts apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts apps/web/src/lib/sync/sync-engine.ts apps/web/src/lib/sync/sync-engine.test.ts
git commit -m "feat(slice-04): promote bootstrap snapshots atomically"
```

---

### Task 15: Wire foreground synchronization and explicit conflict/status UI

**Files:**
- Create: `apps/web/src/lib/sync/use-sync.ts`
- Create: `apps/web/src/lib/sync/use-sync.test.ts`
- Create: `apps/web/src/features/sync/SyncStatus.tsx`
- Create: `apps/web/src/features/sync/SyncStatus.test.tsx`
- Create: `apps/web/src/features/memory/ConflictResolution.tsx`
- Create: `apps/web/src/features/memory/ConflictResolution.test.tsx`
- Modify: `apps/web/src/features/memory/MemoryFoundResult.tsx`
- Modify: `apps/web/src/features/memory/MemoryFoundResult.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/index.css`

**Interfaces:**
- `useSync(engine, connectivity)` triggers foreground sync on initial online mount and offline→online, and exposes manual `syncNow`.
- UI never claims remote synchronization from a local write alone.

- [ ] **Step 1: Write failing UI/hook tests**

Assert global labels for Offline/Syncing/Synchronized/Pending/Conflict/Error; manual button calls engine; offline creation wording includes local save + pending synchronization; conflict result displays baseline and all candidates; resolution submit calls `repository.resolveConflict` with exact candidate IDs.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/web/src/lib/sync/use-sync.test.ts apps/web/src/features/sync apps/web/src/features/memory/ConflictResolution.test.tsx apps/web/src/App.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Wire repositories/engine in `main.tsx`**

Instantiate one IndexedDB database boundary, `IndexedDbMemoryRepository`, `IndexedDbSyncStore`, `SyncApi` using existing web API base URL config, and `SyncEngine`. Pass memory repository + engine into App; do not replace local MemoryRepository with a network repository.

- [ ] **Step 4: Implement status and conflict UI**

Use accessible text/buttons; conflict must never render a candidate as normal current truth. Resolution may choose candidate content or edited content but always invokes append-only resolution.

- [ ] **Step 5: Run component tests + existing Slice 03 UI tests**

Run: `pnpm vitest run apps/web/src && pnpm --filter @mdp/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(slice-04): expose synchronization and conflict status"
```

---

### Task 16: Prove multi-device convergence and failure recovery in browser E2E

**Files:**
- Create: `tests/e2e/synchronization.spec.ts`
- Create: `tests/e2e/helpers/sync-db.ts`
- Modify only if needed: `playwright.config.ts`, `playwright.offline.config.ts`

**Interfaces:**
- Playwright browser contexts represent independent synthetic device installations.
- DB helper is test-only and may use `PrismaService` to assert/prune synthetic sync rows; it must never become an application endpoint.

- [ ] **Step 1: Add E2E scenarios 1–4**

Implement tests for:

1. offline create/correct → online sync → server/local same IDs/state;
2. route request to server, let commit occur, then abort response → retry → `ALREADY_APPLIED`/no duplicate;
3. Device A create/sync → Device B bootstrap/pull → same IDs;
4. two device contexts correct same predecessor offline → sync → both branches preserved/conflict open/no winner.

- [ ] **Step 2: Run subset and verify failures before missing plumbing is complete**

Run: `pnpm e2e --grep "Slice 04 sync"`

Expected before full wiring: FAIL; after Tasks 1–15: PASS.

- [ ] **Step 3: Add E2E scenarios 5–8**

5. resolve conflict → both replicas converge while prior branches remain in history;
6. force dependent event C before B using controlled HTTP order → `DEPENDENCY_MISSING`, then B, then retry C;
7. new empty device bootstrap existing server history then receive later incremental event;
8. local pending C + server B from same A during bootstrap → preserve both/open conflict.

- [ ] **Step 4: Add E2E scenarios 9–12**

9. DB helper ages/prunes synthetic Outbox rows, old cursor → `CURSOR_EXPIRED` → rebootstrap without losing local pending;
10. create controlled local immutable ID collision so pull-page apply aborts → cursor unchanged; remove test collision → retry succeeds;
11. abort a middle bootstrap-page response → partial staging not visible; retry/restart preserves existing local memory;
12. Playwright route rewrites a sync request `protocolVersion` to `999` → protocol unsupported/no remote write/no local pending deletion/no cursor advance.

- [ ] **Step 5: Run all E2E including existing offline suite**

Run: `pnpm e2e && pnpm e2e:offline`

Expected: all Slice 01–04 browser scenarios PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e playwright.config.ts playwright.offline.config.ts
git commit -m "test(slice-04): prove synchronization convergence e2e"
```

---

### Task 17: Add architecture guards, CI verification, and freeze evidence

**Files:**
- Create: `tests/architecture/slice-04-scope.test.ts`
- Create: `scripts/verify-slice04-sync.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create after validation: `docs/evidence/slice-04/SLICE-04-EVIDENCE-001.md`
- Create after validation: `docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md`
- Create after validation: `docs/phases/SLICE-04.md`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/README.md`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-PLAN.md`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-VALIDATION.txt`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-VALIDATION-FULL.txt`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-SMOKE.txt`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-REPORT.md`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-DECISIONS.md`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-CHECKPOINT.yaml`
- Create after validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-ARTIFACT-MANIFEST.sha256`

**Interfaces:**
- `pnpm verify:sync` is a deterministic boundary verifier.
- CI must fail if out-of-scope infrastructure/semantics appear or required schema/protocol invariants disappear.

- [ ] **Step 1: Write failing Slice 04 architecture guard**

Guard assertions include:

```ts
expect(source).not.toMatch(/bullmq|redis|MEMORY_DELETED|PURGE/i);
expect(syncContractSource).toContain('SYNC_PROTOCOL_VERSION = 1');
expect(localDbSource).toContain('MDP_LOCAL_DB_VERSION = 3');
expect(prismaSchema).toContain('model FactRelation');
expect(prismaSchema).toContain('model SyncOutbox');
```

Also verify active UI still instantiates `IndexedDbMemoryRepository` and does not call `memory-api` for create/correct operations.

- [ ] **Step 2: Add verifier script**

`verify-slice04-sync.mjs` must check exact required tables/models, protocol version, absence of Redis/BullMQ dependencies, PWA cache boundary remains app-shell-only, and presence of the 12 named E2E scenario titles.

- [ ] **Step 3: Add package/CI commands**

Add:

```json
"verify:sync": "node scripts/verify-slice04-sync.mjs"
```

CI order after migration should include `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm verify:pwa`, `pnpm verify:sync`, `pnpm e2e`, `pnpm e2e:offline`, plus existing real PostgreSQL outage proof/cleanup.

- [ ] **Step 4: Run complete local qualification**

Run, with clean PostgreSQL:

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
pnpm verify:sync
pnpm e2e
pnpm e2e:offline
```

Expected: all PASS. Also rerun the existing PostgreSQL outage proof and verify safe `503 SERVICE_UNAVAILABLE` without text/SQL leakage.

- [ ] **Step 5: Record evidence only from actual outputs**

Populate evidence/checkpoint/phase/artifacts with exact commit SHA, test counts, E2E counts, migration/table proof, failure-injection results, and CI run/job IDs. Do not write anticipated PASS results before they exist. Generate SHA-256 manifest after artifact contents are final.

- [ ] **Step 6: Self-review implementation against invariants I1–I15**

For each invariant in the approved spec, point to at least one automated test/E2E/evidence item. Any missing evidence is blocking and must be added before review/CI gate.

- [ ] **Step 7: Commit qualification artifacts**

```bash
git add tests/architecture scripts package.json .github/workflows docs/evidence/slice-04 docs/checkpoints docs/phases/SLICE-04.md artifacts/phases/SLICE-04-SYNCHRONIZATION
git commit -m "docs(slice-04): freeze synchronization qualification evidence"
```

- [ ] **Step 8: Push branch and require green CI before merge gate**

Do not merge. Present exact branch HEAD, CI run/job, automated test counts, E2E counts, real PostgreSQL proofs, review findings, and unresolved risks to LEANDRO for the separate `HUMAN_GATE` merge decision.

---

## Required implementation execution order

The tasks are intentionally sequential because later tasks consume contracts/invariants created earlier:

`1 contracts → 2 causal graph → 3 resolution → 4 DB migration → 5 server Outbox → 6 push → 7 pull/retention → 8 bootstrap → 9 API → 10 IndexedDB v3 → 11 local writes/conflicts → 12 local sync store/API → 13 engine → 14 bootstrap promotion → 15 UI → 16 E2E → 17 qualification`

Do not parallelize tasks that modify the same causal schema or persistence semantics. Independent test additions inside a task may be parallelized only after that task's interface is fixed.

## Plan self-review checklist

Before execution authorization, verify the written plan itself satisfies:

- Spec coverage: every approved design section maps to at least one Task 1–17.
- No placeholders: no `TBD`, `TODO`, “implement later”, or unspecified error handling remains.
- Type consistency: `SyncEventEnvelope`, `FactRelation`, `SyncStore`, `LocalSyncStore`, and protocol result names are defined once and consumed consistently.
- Scope: no Redis/BullMQ/WebSocket/purge/authentication/semantic/AI work enters Slice 04.
- Governance: plan creation does not imply implementation or merge authorization.

## Implementation gate after plan review

If LEANDRO approves this plan and explicitly authorizes Slice 04 implementation, execution should use **Subagent-Driven Development** where available, with a fresh implementation worker per task and review between tasks. If independent subagents are unavailable in the runtime, execute inline task-by-task with the same TDD/review checkpoints and do not claim unavailable gates were performed.

Even after every task passes, a separate explicit merge authorization remains mandatory.
