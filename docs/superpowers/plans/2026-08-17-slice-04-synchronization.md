# Slice 04 — Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable bidirectional synchronization between the Slice 03 IndexedDB local-first repository and PostgreSQL, with idempotent event delivery, causal conflict preservation, safe bootstrap/rebootstrap, bounded retry, human conflict resolution, and deterministic convergence.

**Architecture:** Keep `MemoryRepository` local-first and introduce a separate `SyncEngine` + `LocalSyncStore`. Canonical history is immutable Memory/Evidence/LedgerEvent/Fact plus explicit N:N `FactRelation`; `CurrentFact`, conflict state, and transport state are projections. NestJS coordinates convergence through PostgreSQL + Transactional Outbox. No Redis/BullMQ/worker is introduced.

**Tech Stack:** TypeScript 6.0.3, Node >=24 <25, pnpm 10.34.0, React/Vite PWA, IndexedDB, NestJS, PostgreSQL, Prisma, Zod, Vitest, Playwright.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-08-17-slice-04-synchronization-design.md` at approved HEAD `4608498ce05a5fe44d1bb1d49f3a308996f575e7`.
- Written approval: `docs/superpowers/specs/2026-08-17-slice-04-synchronization-design-approval.md`.
- Functional baseline: `main@0637cbd32ed7e4a3b484cfebf771f9871cad2eb8`.
- Implementation is **NOT AUTHORIZED** until LEANDRO grants an explicit Slice 04 implementation gate after reviewing this plan.
- Once authorized, create `slice/04-synchronization` from the approved planning HEAD. Do not implement on `main` or `design/slice-04-synchronization`.
- Merge remains separately gated after implementation/review/CI.
- Real sensitive data and pilot remain `NOT AUTHORIZED`.
- `mdp-local` migrates non-destructively `v2 → v3`; no UUID/content remapping or silent drops.
- UI remains local-first; no UI dual-write to IndexedDB + HTTP.
- Protocol version is exactly `1`; persisted/transmitted envelopes carry `protocolVersion: 1`.
- Event types in scope are exactly `MEMORY_CREATED`, `MEMORY_CORRECTED`, `CONFLICT_RESOLVED`.
- `eventId` is the idempotency key; retries reuse it.
- Push is atomic per event; pull is atomic per page; bootstrap promotion is atomic locally.
- `CONFLICT` = event durably accepted/acknowledged + unresolved domain conflict. It is not retry-pending transport failure.
- Outbox sequence/timestamps/UUID ordering are never causal truth.
- No Redis, BullMQ, WebSocket requirement, peer-to-peer sync, mandatory Service Worker Background Sync, deletion/purge, semantic retrieval, AI, voice, reminders, passkeys/trusted sessions, or pilot behavior.
- Real PostgreSQL is mandatory for transaction/idempotency acceptance tests.
- Slices 01–03 regressions remain green, including offline create/query/correct/history/restore, PWA persistence/update, and safe PostgreSQL outage behavior.

## Concrete data decisions locked by this plan

### Protocol objects

`packages/contracts/src/sync.ts` owns all transport schemas. Dates cross HTTP/JSON as ISO strings; PostgreSQL `BIGINT` cursors cross JSON as decimal strings.

```ts
export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_MAX_BATCH_SIZE = 50;

export type SyncEventType =
  | 'MEMORY_CREATED'
  | 'MEMORY_CORRECTED'
  | 'CONFLICT_RESOLVED';

export interface SyncFactRelation {
  predecessorFactId: string;
  successorFactId: string;
  relationType: 'SUPERSEDES';
}

export interface SyncEventEnvelope {
  protocolVersion: 1;
  eventId: string;
  eventType: SyncEventType;
  memoryId: string;
  originClientInstanceId: string | null;
  payload: {
    memory?: CanonicalMemory;
    evidence: CanonicalEvidence;
    fact: CanonicalFact;
    ledgerEvent: CanonicalLedgerEvent;
    factRelations: SyncFactRelation[];
  };
}

export interface SyncFeedEvent {
  sequence: string;
  envelope: SyncEventEnvelope;
}
```

### PostgreSQL additions

- `fact_relations` — canonical causal edges.
- `sync_outbox` — immutable feed envelopes and monotonic sequence.
- `sync_conflicts` — reconstructible server projection.
- `sync_bootstrap_sessions` — token/high-watermark/expiry.
- `sync_bootstrap_items` — materialized immutable bootstrap aggregates.

`facts.supersedes_fact_id` is backfilled to `fact_relations` and then removed. `ledger_events.supersedes_fact_id` remains only as historical metadata for single-predecessor correction events.

### IndexedDB v3 additions

- `factRelations` compound key `[predecessorFactId, successorFactId, relationType]`.
- `syncOutbox` key `eventId` with `{ envelope, state, attempts, lastErrorCode, nextAttemptAt }`.
- `syncState` singleton key `state` with persistent `clientInstanceId`, confirmed cursor, bootstrap metadata.
- `syncConflicts` key `memoryId`.
- `bootstrapStaging` compound key `[bootstrapToken, position]`.

### Stable local operational states

```ts
type LocalOutboundState = 'PENDING' | 'RETRY_WAIT' | 'BLOCKED';
type GlobalSyncState = 'OFFLINE' | 'SYNCED' | 'PENDING' | 'SYNCING' | 'CONFLICT' | 'ERROR';
type MemorySyncState = 'LOCAL_PENDING' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'BLOCKED';
```

### Retry constants

```ts
export const SYNC_RETRY_BASE_MS = 500;
export const SYNC_RETRY_MAX_MS = 30_000;
export const SYNC_RETRY_MAX_ATTEMPTS = 5;
export const SYNC_RETRY_JITTER_RATIO = 0.2;
export const SYNC_MAX_CYCLES_PER_RUN = 100;
```

Operational environment defaults, not domain semantics:

```text
SYNC_OUTBOX_RETENTION_HOURS=168
SYNC_BOOTSTRAP_TTL_MINUTES=15
```

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

**Produces:** `SyncEventEnvelope`, `SyncFeedEvent`, push/pull/bootstrap contracts, stable result codes, conflict-aware query response, conflict resolution request/response, graph-aware history predecessors.

- [ ] **Step 1: Write failing protocol tests**

```ts
it('fixes protocol version to one', () => {
  expect(SYNC_PROTOCOL_VERSION).toBe(1);
});

it('treats CONFLICT as accepted acknowledgement', () => {
  expect(syncPushEventResultSchema.parse({
    eventId: '018f0000-0000-7000-8000-000000000001',
    status: 'CONFLICT',
    accepted: true,
  }).accepted).toBe(true);
});

it('rejects unsupported persisted envelope version', () => {
  expect(() => syncEventEnvelopeSchema.parse({
    protocolVersion: 2,
    eventId: 'E', eventType: 'MEMORY_CREATED', memoryId: 'M',
    originClientInstanceId: null, payload: {},
  })).toThrow();
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/contracts/src/sync.test.ts packages/contracts/src/memory.test.ts packages/contracts/src/correction.test.ts`

Expected: FAIL because sync/conflict contracts do not exist.

- [ ] **Step 3: Implement Zod schemas**

Define `syncEventEnvelopeSchema`, `syncFeedEventSchema`, bounded `syncPushRequestSchema`, `syncPushResponseSchema`, `syncPullResponseSchema`, `syncBootstrapStartResponseSchema`, `syncBootstrapPageResponseSchema`, and:

```ts
export const syncPushEventResultSchema = z.discriminatedUnion('status', [
  z.object({ eventId: z.string(), status: z.literal('APPLIED'), accepted: z.literal(true) }),
  z.object({ eventId: z.string(), status: z.literal('ALREADY_APPLIED'), accepted: z.literal(true) }),
  z.object({ eventId: z.string(), status: z.literal('CONFLICT'), accepted: z.literal(true) }),
  z.object({ eventId: z.string(), status: z.literal('DEPENDENCY_MISSING'), accepted: z.literal(false), missingFactIds: z.array(z.string()).min(1) }),
  z.object({ eventId: z.string(), status: z.literal('BLOCKED'), accepted: z.literal(false), code: z.string() }),
  z.object({ eventId: z.string(), status: z.literal('INVALID'), accepted: z.literal(false), code: z.string() }),
]);
```

- [ ] **Step 4: Extend memory/correction contracts**

Add `MemoryQueryResponse` conflict variant with `baseline` and at least two `candidates`; add `ResolveMemoryConflictRequest` containing `expectedCandidateFactIds: string[]` (min 2), `text`, optional `reason`; add graph-aware history `predecessorFactIds: string[]` and `isConflictCandidate`.

- [ ] **Step 5: Run tests/typecheck**

Run: `pnpm vitest run packages/contracts/src && pnpm --filter @mdp/contracts typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(slice-04): define synchronization protocol contracts"
```

---

### Task 2: Add deterministic causal graph projection without breaking existing consumers

**Files:**
- Create: `packages/domain/src/causality.ts`
- Create: `packages/domain/src/causality.test.ts`
- Modify: `packages/domain/src/correction.ts`
- Modify: `packages/domain/src/correction.test.ts`
- Modify: `packages/domain/src/index.ts`

**Produces:** `FactRelation`, `projectFactGraph`, `projectTextFactHistory`. During this task only, `TextCorrectionRecord.fact.supersedesFactId` remains as a deprecated compatibility field so the repository stays typecheckable until persistence migrations; the new `relation` is authoritative. Physical persistence removes the Fact field in Tasks 4 and 10.

- [ ] **Step 1: Write failing graph tests**

```ts
expect(projectFactGraph({
  factIds: ['A', 'B', 'C'],
  relations: [
    { predecessorFactId: 'A', successorFactId: 'B', relationType: 'SUPERSEDES' },
    { predecessorFactId: 'A', successorFactId: 'C', relationType: 'SUPERSEDES' },
  ],
})).toEqual({ status: 'CONFLICT', baselineFactId: 'A', candidateFactIds: ['B', 'C'] });
```

Also test A→B→C resolved; B/C→D resolves; D/E concurrent resolutions reopen conflict; cycles, unknown nodes, multiple roots fail closed.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/domain/src/causality.test.ts packages/domain/src/correction.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement graph primitives**

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

Rules: one root; DAG; terminals = no successors; one terminal resolved; multiple terminals conflict; baseline = deepest common ancestor by graph depth; lexical order only makes serialization deterministic and never picks truth.

- [ ] **Step 4: Add relation to correction record**

`createTextCorrectionRecord()` returns `relation: { predecessorFactId, successorFactId, relationType:'SUPERSEDES' }`. Keep legacy Fact `supersedesFactId` only until Tasks 4/10 migrate physical consumers; mark it non-authoritative in code comments/types.

- [ ] **Step 5: Implement graph-aware history projection**

Each projected history item includes `predecessorFactIds`, `isOriginal`, `isCurrent`, `isConflictCandidate`. Respect topological order; timestamps may break display ties only after causal constraints.

- [ ] **Step 6: Run domain + root typecheck**

Run: `pnpm vitest run packages/domain/src && pnpm typecheck`

Expected: PASS; this is the regression guard that prevents a transitional broken commit.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src
git commit -m "feat(slice-04): model causal memory graph"
```

---

### Task 3: Add append-only conflict resolution domain operation

**Files:**
- Create: `packages/domain/src/conflict-resolution.ts`
- Create: `packages/domain/src/conflict-resolution.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write failing resolution test**

```ts
const record = createTextConflictResolutionRecord({
  memoryId: 'M',
  candidates: [
    { factId: 'B', content: 'Berlin', recordedAt: new Date('2026-01-01T00:00:00Z') },
    { factId: 'C', content: 'Bonn', recordedAt: new Date('2026-01-01T00:00:00Z') },
  ],
  text: 'Berlin', resolvedAt: new Date('2026-08-17T20:00:00Z'),
  ids: { evidenceId: 'E-D', eventId: 'EV-D', factId: 'D' },
});
expect(record.event.type).toBe('CONFLICT_RESOLVED');
expect(record.relations.map((r) => r.predecessorFactId)).toEqual(['B', 'C']);
```

Also reject <2 candidates, duplicate candidate IDs, blank/too-long text.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/domain/src/conflict-resolution.test.ts`

- [ ] **Step 3: Implement immutable creator**

Create one new Evidence + Fact + `CONFLICT_RESOLVED` LedgerEvent (`supersedesFactId:null`) + one FactRelation from each candidate to the new Fact + projected CurrentFact. Causal authority is the relations array.

- [ ] **Step 4: Run tests/typecheck and commit**

Run: `pnpm vitest run packages/domain/src && pnpm typecheck`

```bash
git add packages/domain/src
git commit -m "feat(slice-04): add conflict resolution event"
```

---

### Task 4: Migrate PostgreSQL to graph + sync tables and keep server memory store working

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260817234500_slice04_synchronization/migration.sql`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync-schema.integration.test.ts`

- [ ] **Step 1: Write failing real-PostgreSQL migration test**

Seed Slice 03 chain A→B before the new migration. After deploy assert old UUID/content unchanged, `fact_relations(A,B)` exists once, `facts.supersedes_fact_id` is absent, and new sync tables exist.

- [ ] **Step 2: Verify RED**

Run with PostgreSQL: `pnpm prisma:validate && pnpm prisma:generate && pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync-schema.integration.test.ts`

- [ ] **Step 3: Define Prisma models**

```prisma
model FactRelation {
  predecessorFactId String @map("predecessor_fact_id") @db.Uuid
  successorFactId   String @map("successor_fact_id") @db.Uuid
  relationType      String @map("relation_type") @db.VarChar(32)
  predecessor Fact @relation("FactRelationPredecessor", fields: [predecessorFactId], references: [id], onDelete: Restrict)
  successor   Fact @relation("FactRelationSuccessor", fields: [successorFactId], references: [id], onDelete: Restrict)
  @@id([predecessorFactId, successorFactId, relationType])
  @@index([successorFactId])
  @@map("fact_relations")
}

model SyncOutbox {
  sequence BigInt @id @default(autoincrement())
  eventId String @unique @map("event_id") @db.Uuid
  protocolVersion Int @map("protocol_version")
  eventType String @map("event_type") @db.VarChar(64)
  memoryId String @map("memory_id") @db.Uuid
  originClientInstanceId String? @map("origin_client_instance_id") @db.Uuid
  payload Json
  createdAt DateTime @map("created_at") @db.Timestamptz(3)
  @@index([createdAt, sequence])
  @@map("sync_outbox")
}
```

Add `SyncConflict`, `SyncBootstrapSession`, `SyncBootstrapItem` as specified in the design/plan concrete data section.

- [ ] **Step 4: Write safe migration SQL**

Create tables/FKs/indexes; backfill `fact_relations` from every non-null `facts.supersedes_fact_id`; only then drop Fact self-edge FK/unique/column. Keep `ledger_events.supersedes_fact_id`.

- [ ] **Step 5: Adapt `PrismaMemoryStore` immediately**

Correction writes must persist `record.relation` in `fact_relations` and no longer write `Fact.supersedesFactId`. History reads predecessor IDs from `fact_relations`. This keeps the repository compiling immediately after the Prisma schema change; Outbox integration is Task 5.

- [ ] **Step 6: Deploy/test/typecheck**

Run: `pnpm db:migrate && pnpm prisma:generate && pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync-schema.integration.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma apps/api/src/infrastructure/persistence/prisma
git commit -m "feat(slice-04): migrate server persistence to causal graph"
```

---

### Task 5: Publish every post-migration server memory mutation through Transactional Outbox

**Files:**
- Create: `apps/api/src/infrastructure/persistence/prisma/sync-envelope.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/sync-envelope.test.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

- [ ] **Step 1: Add failing transaction tests**

Assert direct server create/correct each creates exactly one matching Outbox row in the same transaction. Force Outbox insert failure and prove canonical write rolls back.

- [ ] **Step 2: Implement ISO serializer**

`serializeSyncEnvelope(record, originClientInstanceId)` returns Task 1 schema-valid immutable payload; direct legacy HTTP memory endpoints use `originClientInstanceId:null`.

- [ ] **Step 3: Put canonical writes + relation/projection + Outbox in one `$transaction`**

Never append the Outbox after canonical commit.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/sync-envelope.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma
git commit -m "feat(slice-04): publish server mutations transactionally"
```

---

### Task 6: Implement idempotent server push with legacy canonical-event recognition

**Files:**
- Create: `apps/api/src/sync/sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

**Interface:**

```ts
export interface SyncStore {
  pushEvent(envelope: SyncEventEnvelope): Promise<SyncPushEventResult>;
  pullPage(after: bigint, limit: number): Promise<SyncPullPage>;
  startBootstrap(): Promise<SyncBootstrapStart>;
  readBootstrapPage(token: string, offset: number, limit: number): Promise<SyncBootstrapPage>;
  pruneOutboxBefore(cutoff: Date): Promise<number>;
}
```

- [ ] **Step 1: Write real-DB push tests**

Cover new `APPLIED`; exact replay → `ALREADY_APPLIED`; same eventId/different payload → integrity failure; predecessor missing → `DEPENDENCY_MISSING`; branch → accepted `CONFLICT`; B/C→D resolution closes conflict. Add legacy case: matching canonical LedgerEvent exists from pre-Outbox history but no `sync_outbox` row → recognize equivalent canonical event as `ALREADY_APPLIED`, not duplicate/fail.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

- [ ] **Step 3: Implement idempotency algorithm**

```ts
const outbox = await tx.syncOutbox.findUnique({ where: { eventId: envelope.eventId } });
if (outbox) return payloadEquivalent(outbox.payload, envelope) ? alreadyApplied() : integrityViolation();

const legacyEvent = await tx.ledgerEvent.findUnique({ where: { id: envelope.eventId } });
if (legacyEvent) return canonicalEnvelopeEquivalent(tx, envelope) ? alreadyApplied() : integrityViolation();

const missing = await findMissingPredecessors(tx, envelope.payload.factRelations);
if (missing.length) return dependencyMissing(missing);

await insertImmutableCanonicalEnvelope(tx, envelope);
const projection = await loadAndProjectMemoryGraph(tx, envelope.memoryId);
await rewriteCurrentAndConflictProjection(tx, envelope.memoryId, projection);
await tx.syncOutbox.create({ data: outboxRow(envelope) });
return projection.status === 'CONFLICT' ? conflictAccepted() : applied();
```

Any immutable ID collision with non-equivalent content fails closed; no update/overwrite.

- [ ] **Step 4: Run tests/typecheck and commit**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts && pnpm typecheck`

```bash
git add apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts
git commit -m "feat(slice-04): apply pushed events idempotently"
```

---

### Task 7: Implement ordered pull, retention floor, and cursor expiration

**Files:**
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/config/env.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add pagination/retention tests**

Create >50 Outbox rows, prove ascending sequence pages/no gaps; prune old Outbox, prove canonical rows remain; old cursor gets `CURSOR_EXPIRED`; retained cursor still pulls.

- [ ] **Step 2: Add operational config**

Parse positive integer `SYNC_OUTBOX_RETENTION_HOURS` default 168 and `SYNC_BOOTSTRAP_TTL_MINUTES` default 15; add `.env.example`.

- [ ] **Step 3: Implement `pullPage`/`pruneOutboxBefore`**

Clamp `limit` to 1..50, query `sequence > after` ascending `take limit+1`, serialize cursor as decimal string. Pruning deletes only `sync_outbox` rows.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts apps/api/src/config/env.test.ts`

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts apps/api/src/config .env.example
git commit -m "feat(slice-04): add ordered pull and cursor expiration"
```

---

### Task 8: Implement fixed-snapshot paginated bootstrap

**Files:**
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

- [ ] **Step 1: Add bootstrap consistency test**

Seed A; start bootstrap; create B after start; all bootstrap pages contain A not B; incremental pull after captured high-watermark contains B; expired token returns `BOOTSTRAP_EXPIRED`.

- [ ] **Step 2: Materialize snapshot in one Repeatable Read transaction**

```ts
await prisma.$transaction(async (tx) => {
  const highWatermark = await maxOutboxSequence(tx);
  const aggregates = await readCanonicalMemoryAggregates(tx); // memory/evidence/events/facts/relations only
  const session = await createBootstrapSession(tx, highWatermark, expiresAt);
  await writeBootstrapItems(tx, session.token, aggregates);
  return session;
}, { isolationLevel: 'RepeatableRead' });
```

Do not serialize `CurrentFact`/`SyncConflict` as canonical truth.

- [ ] **Step 3: Implement page reads**

Validate token/expiry; clamp 1..50; read positions in order; return same high-watermark, `nextOffset`, `hasMore`. Expired operational sessions/items may be deleted.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t bootstrap`

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts
git commit -m "feat(slice-04): add consistent paginated bootstrap"
```

---

### Task 9: Expose NestJS sync API and make retention actually execute

**Files:**
- Create: `apps/api/src/sync/sync.service.ts`
- Create: `apps/api/src/sync/sync.service.test.ts`
- Create: `apps/api/src/sync/sync.controller.ts`
- Create: `apps/api/src/sync/sync.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Routes:**
- `POST /sync/v1/push`
- `GET /sync/v1/pull?after=<decimal>&limit=<n>`
- `POST /sync/v1/bootstrap`
- `GET /sync/v1/bootstrap/:token?offset=<n>&limit=<n>`

- [ ] **Step 1: Write service/controller tests**

Assert Zod validation, unsupported protocol, decimal cursors, structured safe errors, no SQL/internal leakage, and pruning is invoked on pull/bootstrap using configured retention cutoff.

- [ ] **Step 2: Implement `SyncService`**

Inject `SyncStore`, env, and `now`. Before `pull` and `startBootstrap`, call:

```ts
const cutoff = new Date(now().getTime() - env.syncOutboxRetentionHours * 60 * 60 * 1000);
await store.pruneOutboxBefore(cutoff);
```

Stable codes: `SYNC_PROTOCOL_UNSUPPORTED`, `CURSOR_EXPIRED`, `BOOTSTRAP_EXPIRED`, `DEPENDENCY_MISSING`, `SYNC_INTEGRITY_VIOLATION`, `SYNC_BLOCKED`, `SERVICE_UNAVAILABLE`.

- [ ] **Step 3: Implement controller/DI**

Controllers parse contracts and delegate; no direct Prisma access. Wire `PrismaSyncStore` in `AppModule`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run apps/api/src/sync apps/api/src/infrastructure/persistence/prisma && pnpm typecheck`

```bash
git add apps/api/src/sync apps/api/src/app.module.ts
git commit -m "feat(slice-04): expose synchronization api"
```

---

### Task 10: Migrate IndexedDB v2 → v3 and remove physical Fact supersedes field

**Files:**
- Modify: `apps/web/src/lib/indexeddb/mdp-local-db.ts`
- Modify: `apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

- [ ] **Step 1: Write v2→v3 migration test**

Seed v2 root + corrected Fact with `supersedesFactId`; open v3; assert ten stores exist, FactRelation edge exists, rewritten Fact no longer has `supersedesFactId`, all IDs/content preserved, DB remains writable.

- [ ] **Step 2: Implement v3 stores/types**

Set `MDP_LOCAL_DB_VERSION = 3`; add stores/keys defined above. `LocalSyncOutboxRecord` must persist `state`, `attempts`, nullable `lastErrorCode`, nullable `nextAttemptAt` and full immutable envelope.

- [ ] **Step 3: Backfill/rewrite in upgrade transaction**

Cursor over legacy facts; add FactRelation for every supersedes field, then `put` a copy with that property removed. Any constraint/integrity failure aborts entire upgrade.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/mdp-local-db.test.ts && pnpm typecheck`

```bash
git add apps/web/src/lib/indexeddb/mdp-local-db.ts apps/web/src/lib/indexeddb/mdp-local-db.test.ts
git commit -m "feat(slice-04): migrate local database to v3"
```

---

### Task 11: Make local memory writes atomic with Outbox and graph projections

**Files:**
- Modify: `apps/web/src/lib/memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts`

- [ ] **Step 1: Write atomicity/conflict tests**

Create/correct each produce one pending envelope with the same domain event ID. Force Outbox add failure and prove canonical writes roll back. Seed A→B and A→C and prove query returns conflict, baseline A, candidates B/C; no arbitrary candidate is `CurrentFact`.

- [ ] **Step 2: Extend `MemoryRepository` error/operation contract**

Add `STALE_CONFLICT` to `MemoryRepositoryErrorCode` and:

```ts
resolveConflict(memoryId: string, request: ResolveMemoryConflictRequest): Promise<ResolveMemoryConflictResponse>;
```

Candidate-set mismatch must throw `STALE_CONFLICT` and create no new records.

- [ ] **Step 3: Update local create/correct transactions**

Build Task 1 envelope before commit; transaction includes canonical stores plus `factRelations`, `syncOutbox`, `syncConflicts` as needed. New Facts persist without `supersedesFactId`; correction persists `record.relation`.

- [ ] **Step 4: Make query/history graph-aware**

Reproject with Task 2. Open conflict stores baseline in `CurrentFact` but query returns `CONFLICT`, never normal `FOUND`. History emits predecessor arrays/candidate flags.

- [ ] **Step 5: Implement append-only resolution**

Require exact current candidate set; call Task 3 creator; atomically add Evidence/Fact/Event/all relations/Outbox, then reproject. If two resolutions race, resulting terminal facts reopen conflict naturally.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts apps/web/src/features/memory && pnpm typecheck`

```bash
git add apps/web/src/lib/memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository.ts apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts
git commit -m "feat(slice-04): queue local mutations atomically"
```

---

### Task 12: Implement `LocalSyncStore` and typed HTTP adapter

**Files:**
- Create: `apps/web/src/lib/sync/sync-store.ts`
- Create: `apps/web/src/lib/indexeddb/indexeddb-sync-store.ts`
- Create: `apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts`
- Create: `apps/web/src/lib/sync/sync-api.ts`
- Create: `apps/web/src/lib/sync/sync-api.test.ts`

**Interface:**

```ts
export interface LocalSyncStore {
  getOrCreateClientInstanceId(): Promise<string>;
  needsBootstrap(): Promise<boolean>;
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

- [ ] **Step 1: Write local-store tests**

Persistent UUID v7 client ID; `APPLIED`/`ALREADY_APPLIED`/`CONFLICT` remove outbound pending; `DEPENDENCY_MISSING` remains pending; blocked stays stored as `BLOCKED`; pull page updates canonical records/projections/cursor in one transaction; collision rolls back page/cursor.

- [ ] **Step 2: Write HTTP adapter tests**

Mock fetch; assert routes, schemas, decimal cursors, 503 transient classification, unsupported protocol structured error.

- [ ] **Step 3: Implement store/API**

`applyPullPage` uses immutable equivalence checks + Task 2 projection. Every response is Zod-parsed before use.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts apps/web/src/lib/sync/sync-api.test.ts && pnpm typecheck`

```bash
git add apps/web/src/lib/sync apps/web/src/lib/indexeddb/indexeddb-sync-store.ts apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts
git commit -m "feat(slice-04): add local sync store and api adapter"
```

---

### Task 13: Implement SyncEngine with bootstrap-before-first-push, retry, and dependency recovery

**Files:**
- Create: `apps/web/src/lib/sync/retry-policy.ts`
- Create: `apps/web/src/lib/sync/retry-policy.test.ts`
- Create: `apps/web/src/lib/sync/sync-engine.ts`
- Create: `apps/web/src/lib/sync/sync-engine.test.ts`

- [ ] **Step 1: Write retry tests**

```ts
expect(computeRetryDelayMs({ attempt: 0, random: () => 0.5 })).toBe(500);
expect(computeRetryDelayMs({ attempt: 1, random: () => 0.5 })).toBe(1000);
expect(computeRetryDelayMs({ attempt: 20, random: () => 0.5 })).toBe(30000);
```

Only network/timeout/502/503/504 retry automatically; protocol/integrity/accepted conflict do not.

- [ ] **Step 2: Write engine tests**

Prove: first run with `needsBootstrap=true` completes bootstrap **before first push** while preserving local pending; normal push→pull repeats; accepted conflict acknowledged; dependency missing performs pull/recovery then retries same ID; lost response replay converges; cursor expiration rebootstrap; blocked no loop; concurrent `syncNow()` coalesces.

- [ ] **Step 3: Implement orchestration**

```ts
async syncNow() {
  return this.singleFlight(async () => {
    if (await store.needsBootstrap()) await this.bootstrap();
    for (let cycle = 0; cycle < SYNC_MAX_CYCLES_PER_RUN; cycle += 1) {
      await this.pushPending();
      const page = await this.pullPage();
      if (!page.hasMore && !(await store.snapshotStatus()).hasPending) return { status: 'SYNCED' };
    }
    return { status: 'PENDING' };
  });
}
```

`CURSOR_EXPIRED` calls `bootstrap()`; transient failures use bounded exponential retry; retry reuses stored envelope/eventId.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run apps/web/src/lib/sync && pnpm typecheck`

```bash
git add apps/web/src/lib/sync
git commit -m "feat(slice-04): orchestrate synchronization cycles"
```

---

### Task 14: Implement isolated bootstrap staging and atomic promotion

**Files:**
- Modify: `apps/web/src/lib/indexeddb/indexeddb-sync-store.ts`
- Modify: `apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts`
- Modify: `apps/web/src/lib/sync/sync-engine.ts`
- Modify: `apps/web/src/lib/sync/sync-engine.test.ts`

- [ ] **Step 1: Write staging/promotion tests**

Partial staged pages are invisible; expired/aborted bootstrap preserves current local memory + local pending Outbox. Complete promotion of server B and local pending C from A yields both branches and conflict B/C. Cursor is high-watermark only after successful promotion.

- [ ] **Step 2: Implement staging**

`beginBootstrap` records token/high-watermark separately from confirmed cursor. `stageBootstrapPage` validates same token/high-watermark and writes immutable items to `bootstrapStaging`.

- [ ] **Step 3: Implement one-transaction promotion**

Validate completeness; merge immutable records; preserve local pending canonical rows; rebuild affected graph projections; update CurrentFact/conflicts; set confirmed cursor; mark bootstrap complete; delete staging. Any collision aborts all.

- [ ] **Step 4: Connect engine bootstrap loop and verify**

Run: `pnpm vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts apps/web/src/lib/sync/sync-engine.test.ts && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-sync-store.ts apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts apps/web/src/lib/sync/sync-engine.ts apps/web/src/lib/sync/sync-engine.test.ts
git commit -m "feat(slice-04): promote bootstrap atomically"
```

---

### Task 15: Wire foreground sync, truthful status, and human conflict resolution UI

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

- [ ] **Step 1: Write hook/UI tests**

Online initial mount and offline→online trigger sync; manual `Sincronizar agora` calls engine; labels distinguish local save/pending from synchronized; conflict renders baseline + every candidate and never candidate as resolved answer; resolution sends exact candidate set.

- [ ] **Step 2: Wire runtime without dual-write**

`main.tsx` instantiates `IndexedDbMemoryRepository`, `IndexedDbSyncStore`, `SyncApi`, `SyncEngine`. `App` still uses local memory repository for all memory mutations.

- [ ] **Step 3: Implement accessible status/resolution UI**

Global states: Offline/Sincronizando/Sincronizado/Pendências/Conflito/Erro. Resolution always calls append-only repository operation.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run apps/web/src && pnpm --filter @mdp/web typecheck`

```bash
git add apps/web/src
git commit -m "feat(slice-04): expose sync and conflict status"
```

---

### Task 16: Prove required multi-device/failure E2E scenarios

**Files:**
- Create: `tests/e2e/synchronization.spec.ts`
- Create: `tests/e2e/helpers/sync-db.ts`
- Modify only if required: `playwright.config.ts`, `playwright.offline.config.ts`

`sync-db.ts` is test-only; it may use `PrismaService` for synthetic assertions/pruning and must never become an application endpoint.

- [ ] **Step 1: Implement scenarios 1–4**

1. offline create/correct → online → server/local same IDs/state;
2. allow server commit then Playwright aborts response → retry → no duplicate;
3. Device A create/sync → independent Device B bootstrap/pull → same IDs;
4. two devices correct same predecessor offline → both branches preserved → conflict open/no winner.

- [ ] **Step 2: Implement scenarios 5–8**

5. human resolution → replicas converge, B/C remain history;
6. controlled C-before-B push → dependency missing → B → same C retry succeeds;
7. empty device bootstrap existing server, later incremental pull works;
8. bootstrap server B against local pending C from A → both preserved/open conflict.

- [ ] **Step 3: Implement scenarios 9–12**

9. synthetic DB helper ages/prunes Outbox → old cursor → safe rebootstrap preserving local pending;
10. controlled local immutable collision makes pull-page transaction abort → cursor unchanged; remove collision → retry succeeds;
11. abort middle bootstrap page → staged partial data never appears synchronized/current;
12. route rewrites protocolVersion to 999 → no remote write, no pending deletion, no cursor advance.

- [ ] **Step 4: Run browser suites**

Run: `pnpm e2e && pnpm e2e:offline`

Expected: all existing + Slice 04 scenarios PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e playwright.config.ts playwright.offline.config.ts
git commit -m "test(slice-04): prove synchronization convergence e2e"
```

---

### Task 17: Architecture guards, full qualification, evidence, and CI gate

**Files:**
- Create: `tests/architecture/slice-04-scope.test.ts`
- Create: `scripts/verify-slice04-sync.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create after actual validation: `docs/evidence/slice-04/SLICE-04-EVIDENCE-001.md`
- Create after actual validation: `docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md`
- Create after actual validation: `docs/phases/SLICE-04.md`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/README.md`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-PLAN.md`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-VALIDATION.txt`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-VALIDATION-FULL.txt`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-SMOKE.txt`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-REPORT.md`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-DECISIONS.md`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-CHECKPOINT.yaml`
- Create after actual validation: `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-ARTIFACT-MANIFEST.sha256`

- [ ] **Step 1: Add architecture guard**

```ts
expect(allRuntimeSources).not.toMatch(/bullmq|from ['"]redis|MEMORY_DELETED|PURGE/i);
expect(syncContractSource).toContain('SYNC_PROTOCOL_VERSION = 1');
expect(localDbSource).toContain('MDP_LOCAL_DB_VERSION = 3');
expect(prismaSchema).toContain('model FactRelation');
expect(prismaSchema).toContain('model SyncOutbox');
```

Also verify active UI still uses `IndexedDbMemoryRepository` and does not use `memory-api` for active create/correct persistence.

- [ ] **Step 2: Add deterministic verifier**

`verify-slice04-sync.mjs` checks required Prisma models/tables, protocol v1, IndexedDB v3 stores, absence of Redis/BullMQ dependencies, app-shell-only PWA cache boundary, and presence of all 12 named E2E scenarios.

- [ ] **Step 3: Wire CI**

Add `"verify:sync": "node scripts/verify-slice04-sync.mjs"`. CI runs frozen install, PostgreSQL, Prisma validate/generate/migrate, typecheck, lint, format check, all tests, build, PWA verifier, sync verifier, standard E2E, isolated offline E2E, existing real-PostgreSQL outage proof, cleanup.

- [ ] **Step 4: Run full qualification locally/CI-equivalent**

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

Also rerun existing outage proof and require safe `503 SERVICE_UNAVAILABLE` with no memory text/SQL leakage.

- [ ] **Step 5: Record evidence only from real outputs**

Evidence files contain exact implementation HEAD, test counts, E2E counts, migration/table proof, failure-injection proof, review findings, CI run/job IDs. Never pre-write anticipated PASS. Generate SHA-256 artifact manifest only after files are final.

- [ ] **Step 6: Map invariants I1–I15 to evidence**

Every invariant in approved design §27 must point to at least one automated test/E2E/evidence item. Missing mapping is blocking.

- [ ] **Step 7: Commit evidence and push branch**

```bash
git add tests/architecture scripts package.json .github/workflows docs/evidence/slice-04 docs/checkpoints docs/phases/SLICE-04.md artifacts/phases/SLICE-04-SYNCHRONIZATION
git commit -m "docs(slice-04): freeze synchronization qualification evidence"
```

Do **not** merge. Present exact branch HEAD, review, CI run/job, test/E2E counts, PostgreSQL proofs, invariants, and unresolved risks to LEANDRO for separate merge HUMAN_GATE.

---

## Required execution order

`1 contracts → 2 causal graph → 3 resolution → 4 PostgreSQL migration → 5 server Outbox → 6 push → 7 pull/retention → 8 bootstrap → 9 API → 10 IndexedDB v3 → 11 local writes/conflicts → 12 LocalSyncStore/API → 13 engine → 14 bootstrap promotion → 15 UI → 16 E2E → 17 qualification`

Tasks touching the same causal/persistence semantics are sequential. Independent tests inside one task may run in parallel only after that task's interfaces are fixed.

## Self-review result

The plan was self-reviewed against the approved spec before this revision was frozen.

- **Spec coverage:** all design sections 1–31 map to Tasks 1–17.
- **Placeholder scan:** no `TBD`, `TODO`, “implement later”, or unspecified error-handling step remains.
- **Type consistency:** `SyncEventEnvelope`, `SyncFeedEvent`, `FactRelation`, `SyncStore`, `LocalSyncStore`, result statuses, cursor strings, and protocol version have one defined meaning.
- **Transition consistency:** Task 2 preserves temporary source compatibility; Tasks 4/10 remove physical Fact supersedes storage without an intermediate broken repository state.
- **Legacy consistency:** Task 6 explicitly recognizes equivalent pre-Outbox canonical Ledger events as already applied.
- **Retention consistency:** Task 9 explicitly executes configured pruning; retention is not merely a dead configuration.
- **Bootstrap consistency:** Task 13 requires bootstrap before first push and after cursor expiration, preserving approved first-sync semantics.
- **Scope:** no future-slice authentication/purge/semantic/AI/voice/reminder work entered the plan.
- **Governance:** this plan does not authorize implementation or merge.

## Execution handoff after explicit implementation authorization

If LEANDRO approves this plan **and explicitly authorizes Slice 04 implementation**, use **Subagent-Driven Development** where a fresh implementation worker and review gate are actually available. If independent subagents are unavailable in the runtime, execute inline task-by-task with the same TDD/review checkpoints and explicitly record that unavailable independent gates were not performed.

A completed implementation and green CI still require a separate explicit merge authorization.
