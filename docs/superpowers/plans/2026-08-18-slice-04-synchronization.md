# Slice 04 — Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable bidirectional synchronization between the Slice 03 local IndexedDB repository and the PostgreSQL server, with immutable event transport, transactional Outbox, idempotent retry, causal conflict preservation, fixed-snapshot bootstrap, and deterministic convergence.

**Architecture:** The PWA remains local-first. Local domain writes commit to IndexedDB together with a persistent outbound event; a separate `SyncEngine` performs versioned `bootstrap → push → pull` over HTTP. PostgreSQL coordinates durable convergence. Every server-accepted canonical mutation, including the existing `/memories` path, commits canonical rows, `FactRelation` rows, reconstructible projection changes, a commit-ordered feed cursor, and one immutable `SyncOutbox` envelope in the same transaction. Evidence + LedgerEvent + Fact + FactRelation remain the canonical historical basis.

**Tech Stack:** TypeScript 6, React, Vite PWA, IndexedDB, NestJS, PostgreSQL, Prisma, Zod, Vitest, Playwright, pnpm 10, Node.js 24.

**Approved design:** `docs/superpowers/specs/2026-08-17-slice-04-synchronization-design.md`, design HEAD `4608498ce05a5fe44d1bb1d49f3a308996f575e7`. LEANDRO approved the written specification through `HUMAN_SPEC_REVIEW_GATE` on 2026-08-18. That approval authorized this plan only.

## Global Constraints

- Slice 04 implementation: **NOT AUTHORIZED** until a separate explicit HUMAN_GATE.
- Merge: **NOT AUTHORIZED** until a later explicit HUMAN_GATE.
- Real sensitive data: **NOT AUTHORIZED**; all fixtures/logs/E2E/evidence are synthetic.
- Pilot: **NOT AUTHORIZED**.
- Protocol version: exactly `1`.
- IndexedDB migration: exactly `mdp-local` v2 → v3, non-destructive.
- UUID v7 IDs remain definitive; no remapping.
- Sync is bidirectional and event-oriented.
- In-scope event types: `MEMORY_CREATED`, `MEMORY_CORRECTED`, `CONFLICT_RESOLVED`.
- Deletion/purge/remote wipe/content tombstones are out of scope.
- `eventId` is the logical idempotency key; retries reuse it.
- `CONFLICT` acknowledges a durably accepted event; it is not a transport retry.
- Push atomicity: one PostgreSQL transaction per event.
- Pull atomicity: one IndexedDB transaction per page.
- Bootstrap promotion: one IndexedDB transaction.
- Server feed order never decides truth; timestamps/UUID order/network order never resolve conflicts.
- Feed sequence must reflect serialized transactional acceptance order; standalone `BIGSERIAL` or `MAX(sequence)` allocation is forbidden.
- Server canonical sync-visible mutation + Outbox commit together.
- Redis/BullMQ/separate worker/WebSocket/P2P/mandatory Background Sync are excluded.
- `clientInstanceId` is installation identity only, never authentication.
- Foreground auto sync + manual `Synchronize now`.
- Transient retry uses bounded exponential backoff + jitter; permanent/integrity/protocol states do not loop.
- Cursor advances only with successful local commit of corresponding data.
- Outbox retention never deletes canonical memory history.
- Slices 01–03 regression remains green.

## Exact Protocol Contract

Create these logical shapes in `packages/contracts/src/sync.ts`, with Zod schemas exporting inferred types. JSON cursor values are decimal strings because PostgreSQL `BIGINT` can exceed JavaScript safe integers.

```ts
export const SYNC_PROTOCOL_VERSION = 1 as const;
export type SyncCursor = string;
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

export type SyncErrorCode =
  | 'SYNC_PROTOCOL_UNSUPPORTED'
  | 'SYNC_CURSOR_EXPIRED'
  | 'SYNC_BOOTSTRAP_EXPIRED'
  | 'SYNC_DEPENDENCY_MISSING'
  | 'SYNC_INTEGRITY_VIOLATION'
  | 'SYNC_SERVICE_UNAVAILABLE'
  | 'SYNC_BLOCKED';
```

Every envelope includes the Memory plus its event-specific Evidence, LedgerEvent, Fact, and FactRelation records. Before hashing or persistence, normalize `predecessorFactIds` lexicographically and normalize `records` by `(kindRank, stableRecordKey)` so semantically identical sets do not hash differently because of array ordering.

## Exact PostgreSQL Shape

The Slice 04 migration must create exactly these physical semantics:

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

`Fact.supersedesFactId` remains only as a non-unique legacy mirror for a normal one-predecessor correction. FactRelation is authoritative. A resolution Fact has `supersedesFactId=null`; its multiple predecessors exist in `fact_relations`.

## Exact IndexedDB v3 Shape

- Existing: `memories`, `evidence`, `ledgerEvents`, `facts`, `currentFacts`.
- `factRelations`: keyPath `['predecessorFactId','successorFactId']`; indexes `memoryId`, `predecessorFactId`, `successorFactId`.
- `syncOutbox`: keyPath `eventId`; indexes `memoryId`, `status`, `nextAttemptAt`.
- `syncState`: keyPath `key`; no secondary index.
- `syncConflicts`: keyPath `memoryId`; index `status`.
- `bootstrapStaging`: keyPath `['bootstrapToken','recordKey']`; index `bootstrapToken`.
- Delete the old unique `facts.supersedesFactId` index during v3 upgrade; do not recreate uniqueness.
- Backfill one FactRelation for every existing Fact whose legacy `supersedesFactId` is present before the upgrade transaction commits.

---

### Task 1: Protocol v1 schemas

**Files:**
- Create: `packages/contracts/src/sync.ts`
- Create: `packages/contracts/src/sync.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:** Exact protocol contract above.

- [ ] **Step 1: Write failing tests**

```ts
expect(syncCursorSchema.parse('9007199254740993')).toBe('9007199254740993');
expect(() => syncEventEnvelopeSchema.parse({ ...validEnvelope, protocolVersion: 2 })).toThrow();
expect(syncPushEventResultSchema.parse({ eventId, status: 'CONFLICT' })).toEqual({ eventId, status: 'CONFLICT' });
expect(syncPushEventResultSchema.parse({ eventId, status: 'DEPENDENCY_MISSING', missingFactIds: [factId] }).missingFactIds).toEqual([factId]);
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run packages/contracts/src/sync.test.ts`

Expected: FAIL because the sync module is absent.

- [ ] **Step 3: Implement schemas**

```ts
import { z } from 'zod';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
export const syncCursorSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

const memoryRecord = z.object({
  kind: z.literal('memory'), id: uuid, recordedAt: iso,
  occurredAt: z.null(), temporalPrecision: z.literal('unknown'),
});
const evidenceRecord = z.object({
  kind: z.literal('evidence'), id: uuid, memoryId: uuid,
  evidenceKind: z.literal('text'), content: z.string().min(1).max(4000), createdAt: iso,
});
const ledgerEventRecord = z.object({
  kind: z.literal('ledgerEvent'), id: uuid, memoryId: uuid, evidenceId: uuid,
  factId: uuid.nullable(), supersedesFactId: uuid.nullable(),
  eventType: z.enum(['MEMORY_CREATED','MEMORY_CORRECTED','CONFLICT_RESOLVED']),
  reason: z.string().max(500).nullable(), createdAt: iso,
});
const factRecord = z.object({
  kind: z.literal('fact'), id: uuid, memoryId: uuid, evidenceId: uuid,
  factKind: z.literal('autobiographical_statement'), content: z.string().min(1).max(4000), createdAt: iso,
});
const relationRecord = z.object({
  kind: z.literal('factRelation'), memoryId: uuid,
  predecessorFactId: uuid, successorFactId: uuid, relationType: z.literal('SUPERSEDES'),
});
export const syncCanonicalRecordSchema = z.discriminatedUnion('kind', [memoryRecord,evidenceRecord,ledgerEventRecord,factRecord,relationRecord]);
export const syncEventEnvelopeSchema = z.object({
  protocolVersion: z.literal(1), eventId: uuid,
  eventType: z.enum(['MEMORY_CREATED','MEMORY_CORRECTED','CONFLICT_RESOLVED']),
  memoryId: uuid, predecessorFactIds: z.array(uuid), records: z.array(syncCanonicalRecordSchema).min(4),
});
```

Add the exact push/pull/bootstrap/result/error schemas defined above and export inferred types from `index.ts`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run packages/contracts/src/sync.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/sync.ts packages/contracts/src/sync.test.ts packages/contracts/src/index.ts
git commit -m "feat(slice-04): define synchronization protocol contracts"
```

---

### Task 2: Fact DAG and deterministic projection

**Files:**
- Create: `packages/domain/src/fact-graph.ts`
- Create: `packages/domain/src/fact-graph.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

```ts
export interface FactGraphNode { factId: string; createdAt: Date; }
export interface FactRelationRecord { memoryId: string; predecessorFactId: string; successorFactId: string; relationType: 'SUPERSEDES'; }
export type DerivedMemoryProjection =
  | { status: 'RESOLVED'; currentFactId: string }
  | { status: 'CONFLICT'; baselineFactId: string; candidateFactIds: string[] };
```

- [ ] **Step 1: Write RED graph cases**

```ts
expect(project('A>B>C')).toEqual({ status: 'RESOLVED', currentFactId: 'C' });
expect(project('A>B,A>C')).toEqual({ status: 'CONFLICT', baselineFactId: 'A', candidateFactIds: ['B','C'] });
expect(project('A>B,A>C,B>D,C>D')).toEqual({ status: 'RESOLVED', currentFactId: 'D' });
expect(project('A>B,A>C,B>D,C>D,B>E,C>E')).toEqual({ status: 'CONFLICT', baselineFactId: 'A', candidateFactIds: ['D','E'] });
```

Also assert cycle/self-edge/missing endpoint fails with a domain `BROKEN_GRAPH` error.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run packages/domain/src/fact-graph.test.ts`

- [ ] **Step 3: Implement topological sort + dominators**

```ts
export function deriveMemoryProjection(nodes: FactGraphNode[], relations: FactRelationRecord[]): DerivedMemoryProjection {
  const graph = buildAndValidateDag(nodes, relations);
  const order = topologicalOrder(graph);
  const dominators = new Map<string, Set<string>>();
  for (const id of order) {
    const predecessors = graph.predecessors.get(id) ?? [];
    if (predecessors.length === 0) dominators.set(id, new Set([id]));
    else dominators.set(id, new Set([id, ...intersection(predecessors.map((p) => dominators.get(p)!))]));
  }
  const leaves = order.filter((id) => (graph.successors.get(id)?.length ?? 0) === 0);
  if (leaves.length === 1) return { status: 'RESOLVED', currentFactId: leaves[0]! };
  const common = intersection(leaves.map((leaf) => dominators.get(leaf)!));
  const baselineFactId = deepestByTopologicalDepth(common, graph);
  return { status: 'CONFLICT', baselineFactId, candidateFactIds: stablePresentationSort(leaves, nodes) };
}
```

Implement `orderFactGraphHistory()` using the same validated topological order and return every node's sorted predecessor IDs.

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run packages/domain/src/fact-graph.test.ts packages/domain/src/correction.test.ts packages/domain/src/memory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/fact-graph.ts packages/domain/src/fact-graph.test.ts packages/domain/src/index.ts
git commit -m "feat(slice-04): model causal fact graph"
```

---

### Task 3: Append-only conflict resolution + graph-aware memory contracts

**Files:**
- Create: `packages/domain/src/conflict-resolution.ts`
- Create: `packages/domain/src/conflict-resolution.test.ts`
- Modify: `packages/domain/src/correction.ts`, test
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/contracts/src/memory.ts`, test

- [ ] **Step 1: Write RED resolution/contract tests**

```ts
const record = createConflictResolutionRecord({
  memoryId, baselineFactId: factA, candidateFactIds: [factB, factC],
  text: 'Versão confirmada', resolvedAt,
  ids: { evidenceId, eventId, factId: factD },
});
expect(record.event.type).toBe('CONFLICT_RESOLVED');
expect(record.event.factId).toBe(factD);
expect(record.event.supersedesFactId).toBeNull();
expect(record.relations.map((r) => r.predecessorFactId).sort()).toEqual([factB,factC].sort());
```

- [ ] **Step 2: Implement resolution record**

```ts
export function createConflictResolutionRecord(input: ResolveDomainInput) {
  const candidates = [...new Set(input.candidateFactIds)].sort();
  if (candidates.length < 2) throw new ConflictResolutionDomainError('INVALID_CANDIDATES');
  const evidence = { id: input.ids.evidenceId, memoryId: input.memoryId, kind: 'text' as const, content: normalizeText(input.text), createdAt: input.resolvedAt };
  const fact = { id: input.ids.factId, memoryId: input.memoryId, evidenceId: evidence.id, kind: 'autobiographical_statement' as const, content: evidence.content, createdAt: input.resolvedAt };
  const event = { id: input.ids.eventId, memoryId: input.memoryId, evidenceId: evidence.id, factId: fact.id, supersedesFactId: null, type: 'CONFLICT_RESOLVED' as const, reason: input.reason ?? null, createdAt: input.resolvedAt };
  const relations = candidates.map((predecessorFactId) => ({ memoryId: input.memoryId, predecessorFactId, successorFactId: fact.id, relationType: 'SUPERSEDES' as const }));
  return { evidence, fact, event, relations, baselineFactId: input.baselineFactId };
}
```

Reuse the same text validation rules as create/correct; do not create a second normalization standard.

- [ ] **Step 3: Extend contracts**

```ts
export const resolveConflictRequestSchema = z.object({
  expectedCandidateFactIds: z.array(z.string().uuid()).min(2).refine((ids) => new Set(ids).size === ids.length),
  text: memoryTextSchema,
  reason: correctionReasonSchema.optional(),
});
```

Add `CONFLICT` query variant containing baseline and candidates. Add `predecessorFactIds: string[]` to history versions; retain legacy `supersedesFactId` as nullable compatibility field.

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run packages/domain/src/conflict-resolution.test.ts packages/contracts/src/memory.test.ts && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src packages/contracts/src/memory.ts packages/contracts/src/memory.test.ts
git commit -m "feat(slice-04): define conflict resolution domain flow"
```

---

### Task 4: PostgreSQL migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260818000100_slice_04_synchronization/migration.sql`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts`

- [ ] **Step 1: Write upgrade test fixture**

```ts
await seedSlice02LinearCorrection({ rootFactId: factA, correctedFactId: factB });
await applySlice04Migration();
const relation = await sql`SELECT predecessor_fact_id, successor_fact_id FROM fact_relations WHERE successor_fact_id=${factB}`;
expect(relation).toEqual([{ predecessor_fact_id: factA, successor_fact_id: factB }]);
```

Use the existing integration DB helpers rather than introducing a second database driver.

- [ ] **Step 2: Implement exact DDL from this plan**

Copy the full `Exact PostgreSQL Shape` SQL above into the migration, with only Prisma-generated constraint/index naming adjustments if Prisma requires them; the physical table/column names and semantics do not change.

- [ ] **Step 3: Update Prisma models**

```prisma
model FactRelation {
  memoryId         String @map("memory_id") @db.Uuid
  predecessorFactId String @map("predecessor_fact_id") @db.Uuid
  successorFactId   String @map("successor_fact_id") @db.Uuid
  relationType      String @map("relation_type") @db.VarChar(32)
  @@id([predecessorFactId, successorFactId])
  @@index([memoryId])
  @@map("fact_relations")
}

model SyncFeedState {
  id              Int    @id
  currentSequence BigInt @map("current_sequence")
  @@map("sync_feed_state")
}

model SyncOutbox {
  sequence               BigInt   @id
  eventId                String   @unique @map("event_id") @db.Uuid
  protocolVersion        Int      @map("protocol_version")
  eventType              String   @map("event_type") @db.VarChar(64)
  memoryId               String   @map("memory_id") @db.Uuid
  originClientInstanceId String?  @map("origin_client_instance_id") @db.Uuid
  payload                Json
  payloadHash            String   @map("payload_hash") @db.Char(64)
  createdAt              DateTime @map("created_at") @db.Timestamptz(3)
  @@index([memoryId])
  @@map("sync_outbox")
}
```

Add corresponding `SyncConflict` and `SyncBootstrapSnapshot` models matching the DDL. Change legacy `Fact.supersedesFactId` from `@unique` to non-unique and change its reverse relation to an array.

- [ ] **Step 4: Verify clean + upgrade DB**

```bash
docker compose up -d postgres
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add prisma apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts
git commit -m "feat(slice-04): migrate synchronization persistence schema"
```

---

### Task 5: Transactional canonical writer + commit-ordered feed

**Files:**
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.integration.test.ts`

- [ ] **Step 1: Write RED atomicity/concurrency tests**

```ts
await expect(writer.writeEnvelope(txWithInjectedFailure, envelope, clientId)).rejects.toThrow();
expect(await countCanonicalByEvent(eventId)).toBe(0);
expect(await countOutboxByEvent(eventId)).toBe(0);
```

Run two writer transactions concurrently and assert visible Outbox sequences are strictly ordered with no lower sequence committing after a higher visible high-water mark.

- [ ] **Step 2: Implement feed allocation**

```ts
async function allocateFeedSequence(tx: PrismaTransactionClient): Promise<bigint> {
  const rows = await tx.$queryRaw<Array<{ current_sequence: bigint }>>`
    UPDATE "sync_feed_state"
    SET "current_sequence" = "current_sequence" + 1
    WHERE "id" = 1
    RETURNING "current_sequence"
  `;
  const row = rows[0];
  if (!row) throw new Error('SYNC_FEED_STATE_MISSING');
  return row.current_sequence;
}
```

- [ ] **Step 3: Implement semantic normalization/hash**

```ts
function normalizeEnvelope(envelope: SyncEventEnvelope): SyncEventEnvelope {
  return {
    ...envelope,
    predecessorFactIds: [...new Set(envelope.predecessorFactIds)].sort(),
    records: [...envelope.records].sort(compareCanonicalRecords),
  };
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function payloadHash(envelope: SyncEventEnvelope): string {
  return createHash('sha256').update(stableJson(normalizeEnvelope(envelope))).digest('hex');
}
```

- [ ] **Step 4: Implement write path**

```ts
async writeEnvelope(tx, envelope, originClientInstanceId) {
  const normalized = normalizeEnvelope(envelope);
  await this.addOrVerifyImmutableRecords(tx, normalized.records);
  const graph = await this.loadGraph(tx, normalized.memoryId);
  const projection = deriveMemoryProjection(graph.nodes, graph.relations);
  await this.persistProjection(tx, normalized.memoryId, projection);
  const sequence = await allocateFeedSequence(tx);
  await tx.syncOutbox.create({ data: {
    sequence, eventId: normalized.eventId, protocolVersion: 1,
    eventType: normalized.eventType, memoryId: normalized.memoryId,
    originClientInstanceId, payload: normalized as Prisma.InputJsonValue,
    payloadHash: payloadHash(normalized), createdAt: this.now(),
  }});
  return projection;
}
```

For a prior OPEN conflict becoming resolved, write `RESOLVED` with `resolutionFactId`; for a new OPEN branch, upsert OPEN baseline/candidates.

- [ ] **Step 5: Verify**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.integration.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer*
git commit -m "feat(slice-04): add transactional canonical sync writer"
```

---

### Task 6: Existing PostgreSQL memory writes publish Outbox

**Files:**
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

- [ ] **Step 1: Write RED Outbox regression assertions**

```ts
await store.create(record);
expect(await prisma.syncOutbox.findUnique({ where: { eventId: record.event.id } })).not.toBeNull();
const correction = await store.correct(input);
expect(await prisma.factRelation.findUnique({ where: { predecessorFactId_successorFactId: { predecessorFactId: input.expectedCurrentFactId, successorFactId: correction.record.fact.id } } })).not.toBeNull();
```

- [ ] **Step 2: Build envelopes from existing records**

```ts
function envelopeForCreate(record: TextMemoryRecord): SyncEventEnvelope {
  return normalizeEnvelope({
    protocolVersion: 1, eventId: record.event.id, eventType: 'MEMORY_CREATED', memoryId: record.memory.id,
    predecessorFactIds: [],
    records: [toSyncMemory(record.memory), toSyncEvidence(record.evidence), toSyncLedgerEvent(record.event), toSyncFact(record.fact)],
  });
}
```

Correction builder adds `toSyncFactRelation({predecessor=currentFact,newFact})`. Server-origin writer passes `null` origin client.

- [ ] **Step 3: Route store transactions through common writer**

```ts
await this.prisma.$transaction(async (tx) => {
  await this.writer.writeEnvelope(tx, envelopeForCreate(record), null);
});
```

Preserve existing store return types and outage mapping.

- [ ] **Step 4: Verify**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/infrastructure/persistence/prisma/prisma-memory.store*
git commit -m "refactor(slice-04): publish server memory writes to sync outbox"
```

---

### Task 7: Server push idempotency/dependencies/conflicts

**Files:**
- Create: `apps/api/src/sync/sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts`

- [ ] **Step 1: Write RED outcome tests**

Test `APPLIED`, exact replay `ALREADY_APPLIED`, changed payload same ID `INVALID`, missing predecessor, accepted conflict, accepted conflict replay.

```ts
const first = await store.pushEvent(clientId, branchEnvelope);
expect(first.status).toBe('CONFLICT');
const replay = await store.pushEvent(clientId, branchEnvelope);
expect(replay.status).toBe('ALREADY_APPLIED');
```

- [ ] **Step 2: Implement `pushEvent`**

```ts
async pushEvent(clientInstanceId: string, envelope: SyncEventEnvelope): Promise<SyncPushEventResult> {
  const normalized = normalizeEnvelope(envelope);
  const hash = payloadHash(normalized);
  const existing = await this.prisma.syncOutbox.findUnique({ where: { eventId: normalized.eventId } });
  if (existing) return existing.payloadHash === hash
    ? { eventId: normalized.eventId, status: 'ALREADY_APPLIED' }
    : { eventId: normalized.eventId, status: 'INVALID', code: 'SYNC_INTEGRITY_VIOLATION' };

  const missingFactIds = await this.findMissingPredecessors(normalized);
  if (missingFactIds.length > 0) return { eventId: normalized.eventId, status: 'DEPENDENCY_MISSING', missingFactIds };

  const projection = await this.prisma.$transaction((tx) => this.writer.writeEnvelope(tx, normalized, clientInstanceId));
  return { eventId: normalized.eventId, status: projection.status === 'CONFLICT' ? 'CONFLICT' : 'APPLIED' };
}
```

`findMissingPredecessors` treats predecessor Facts included in `records` as present for the event; otherwise queries DB and returns sorted unique IDs.

- [ ] **Step 3: Verify**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t push`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): implement idempotent sync push"
```

---

### Task 8: Pull + exact cursor expiry + retention

**Files:**
- Modify: `apps/api/src/sync/sync.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.ts`, test
- Modify: `apps/api/src/config/env.ts`
- Create or Modify: `apps/api/src/config/env.test.ts`

**Exact defaults:** `SYNC_MAX_BATCH_SIZE=50`, `SYNC_OUTBOX_MAX_ENTRIES=10000`, `SYNC_BOOTSTRAP_TTL_SECONDS=900`.

- [ ] **Step 1: Write RED cursor/retention tests**

```ts
expect(await pull('4', 2)).toMatchObject({ events: [{sequence:'5'}], nextCursor:'5' });
await expectPullError('3', 'SYNC_CURSOR_EXPIRED'); // oldest retained is 5
```

Also prove canonical rows survive pruning.

- [ ] **Step 2: Implement env parsing**

```ts
SYNC_MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
SYNC_OUTBOX_MAX_ENTRIES: z.coerce.number().int().min(1).default(10000),
SYNC_BOOTSTRAP_TTL_SECONDS: z.coerce.number().int().min(1).max(86400).default(900),
```

Expose camel-case fields in `ApiEnv`.

- [ ] **Step 3: Implement cursor logic in a consistent read transaction**

```ts
return this.prisma.$transaction(async (tx) => {
  const state = await tx.syncFeedState.findUniqueOrThrow({ where: { id: 1 } });
  const current = state.currentSequence;
  const cursor = BigInt(after);
  if (cursor > current) throw new SyncStoreError('SYNC_INTEGRITY_VIOLATION');
  if (cursor === current || current === 0n) return emptyPull(after);
  const oldest = await tx.syncOutbox.findFirst({ orderBy: { sequence: 'asc' }, select: { sequence: true } });
  if (!oldest || cursor < oldest.sequence - 1n) throw new SyncStoreError('SYNC_CURSOR_EXPIRED');
  const rows = await tx.syncOutbox.findMany({ where: { sequence: { gt: cursor } }, orderBy: { sequence: 'asc' }, take: limit + 1 });
  return toPullResponse(after, rows, limit);
}, { isolationLevel: 'RepeatableRead' });
```

- [ ] **Step 4: Implement retention inside accepted writer transaction**

```ts
const threshold = sequence - BigInt(this.env.syncOutboxMaxEntries);
if (threshold >= 1n) await tx.syncOutbox.deleteMany({ where: { sequence: { lte: threshold } } });
```

- [ ] **Step 5: Verify**

```bash
pnpm exec vitest run apps/api/src/config/env.test.ts
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t pull
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): add pull cursor and outbox retention"
```

---

### Task 9: Fixed-snapshot paginated bootstrap

**Files:** Modify `sync.store.ts`, `prisma-sync.store.ts`, integration test.

- [ ] **Step 1: Write RED bootstrap/concurrency tests**

Prove historical pre-Outbox records included; post-snapshot concurrent write has sequence > watermark and appears in pull; pages stay stable; expired token fails.

- [ ] **Step 2: Implement snapshot materialization**

```ts
async startBootstrap(clientInstanceId: string): Promise<SyncBootstrapStartResponse> {
  return this.prisma.$transaction(async (tx) => {
    const feed = await tx.syncFeedState.findUniqueOrThrow({ where: { id: 1 } });
    const records = await loadAllCanonicalSyncRecords(tx);
    const normalizedRecords = records.sort(compareBootstrapRecords); // memory=0,evidence=1,ledgerEvent=2,fact=3,factRelation=4
    const token = this.createId();
    const expiresAt = new Date(this.now().getTime() + this.env.syncBootstrapTtlSeconds * 1000);
    await tx.syncBootstrapSnapshot.create({ data: {
      token, highWatermark: feed.currentSequence, records: normalizedRecords as Prisma.InputJsonValue,
      expiresAt, createdAt: this.now(),
    }});
    return { protocolVersion: 1, bootstrapToken: token, highWatermarkCursor: feed.currentSequence.toString(), totalRecords: normalizedRecords.length };
  }, { isolationLevel: 'RepeatableRead' });
}
```

`loadAllCanonicalSyncRecords` reads Memory/Evidence/LedgerEvent/Fact/FactRelation only; it does not serialize CurrentFact or conflict/sync projections.

- [ ] **Step 3: Implement stable page read + expiry**

```ts
async readBootstrapPage(token: string, offset: number, limit: number) {
  const snapshot = await this.prisma.syncBootstrapSnapshot.findUnique({ where: { token } });
  if (!snapshot || snapshot.expiresAt <= this.now()) throw new SyncStoreError('SYNC_BOOTSTRAP_EXPIRED');
  const records = syncCanonicalRecordArraySchema.parse(snapshot.records);
  const page = records.slice(offset, offset + limit);
  const nextOffset = offset + page.length < records.length ? offset + page.length : null;
  return { protocolVersion: 1, bootstrapToken: token, records: page, nextOffset };
}
```

Delete expired snapshot rows opportunistically before creating/reading snapshots.

- [ ] **Step 4: Verify**

Run: `DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts -t bootstrap`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sync/sync.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-sync.store*
git commit -m "feat(slice-04): add consistent paginated bootstrap"
```

---

### Task 10: NestJS sync service/controller

**Files:**
- Create: `apps/api/src/sync/sync.service.ts`, test
- Create: `apps/api/src/sync/sync.controller.ts`, test
- Modify: `apps/api/src/app.module.ts`

**Endpoints:** `POST /sync/v1/bootstrap/start`, `GET /sync/v1/bootstrap/:token`, `POST /sync/v1/push`, `GET /sync/v1/pull`.

- [ ] **Step 1: Write RED HTTP/service tests**

Test protocol 999→structured rejection; cursor/bootstrap expiry; push result list; DB outage→503 without SQL/payload leak.

- [ ] **Step 2: Implement service**

```ts
export class SyncService {
  constructor(private readonly store: SyncStore, private readonly maxBatch: number) {}
  async push(input: unknown): Promise<SyncPushResponse> {
    const request = syncPushRequestSchema.parse(input);
    if (request.events.length > this.maxBatch) throw new SyncServiceError('SYNC_BLOCKED');
    const results: SyncPushEventResult[] = [];
    for (const event of request.events) results.push(await this.store.pushEvent(request.clientInstanceId, event));
    return { protocolVersion: 1, results };
  }
}
```

Add bootstrap/pull methods with contract parsing and configured limit validation.

- [ ] **Step 3: Implement controller**

```ts
@Controller('sync/v1')
export class SyncController {
  constructor(@Inject(SYNC_SERVICE) private readonly service: SyncService) {}
  @Post('push') push(@Body() body: unknown) { return this.service.push(body); }
  @Post('bootstrap/start') start(@Body() body: unknown) { return this.service.startBootstrap(body); }
  @Get('bootstrap/:token') page(@Param('token') token: string, @Query() query: unknown) { return this.service.bootstrapPage(token, query); }
  @Get('pull') pull(@Query() query: unknown) { return this.service.pull(query); }
}
```

Use existing exception/error-envelope patterns to map `SYNC_PROTOCOL_UNSUPPORTED`/validation→400, integrity→409, expired→410, service unavailable→503. Push per-event outcomes remain HTTP 200.

- [ ] **Step 4: Register providers**

```ts
const syncStoreProvider = { provide: SYNC_STORE, inject: [PRISMA_SERVICE, API_ENV], useFactory: (prisma: PrismaService, env: ApiEnv) => new PrismaSyncStore({ prisma, env, now: () => new Date(), createId }) };
const syncServiceProvider = { provide: SYNC_SERVICE, inject: [SYNC_STORE, API_ENV], useFactory: (store: SyncStore, env: ApiEnv) => new SyncService(store, env.syncMaxBatchSize) };
```

Add `SyncController` and providers to `AppModule`.

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run apps/api/src/sync apps/api/src/memories apps/api/src/health`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync apps/api/src/app.module.ts
git commit -m "feat(slice-04): expose synchronization API"
```

---

### Task 11: IndexedDB v3 migration

**Files:** Modify `mdp-local-db.ts`, test.

- [ ] **Step 1: Write RED v2→v3 fixture test**

Seed A→B in v2; upgrade; assert all old records preserved, relation A→B backfilled, new stores/indexes exact, and second successor C with legacy predecessor A can be inserted.

- [ ] **Step 2: Define record types**

```ts
export interface LocalFactRelationRecord { memoryId: string; predecessorFactId: string; successorFactId: string; relationType: 'SUPERSEDES'; }
export interface LocalSyncOutboxRecord { eventId: string; memoryId: string; envelope: SyncEventEnvelope; status: 'PENDING'|'RETRY_WAIT'|'BLOCKED'; attempt: number; nextAttemptAt: Date|null; lastErrorCode: string|null; }
export interface LocalSyncStateRecord { key: 'clientInstanceId'|'confirmedCursor'|'bootstrap'; value: unknown; }
export interface LocalSyncConflictRecord { memoryId: string; baselineFactId: string; candidateFactIds: string[]; status: 'OPEN'|'RESOLVED'; resolutionFactId: string|null; updatedAt: Date; }
export interface LocalBootstrapStagingRecord { bootstrapToken: string; recordKey: string; record: SyncCanonicalRecord; }
```

- [ ] **Step 3: Implement upgrade**

```ts
export const MDP_LOCAL_DB_VERSION = 3;
function upgradeToV3(tx: IDBTransaction): void {
  const db = tx.db ?? (tx as IDBTransaction & { db?: IDBDatabase }).db;
  const facts = tx.objectStore('facts');
  if (facts.indexNames.contains('supersedesFactId')) facts.deleteIndex('supersedesFactId');
  const relations = db!.createObjectStore('factRelations', { keyPath: ['predecessorFactId','successorFactId'] });
  relations.createIndex('memoryId','memoryId'); relations.createIndex('predecessorFactId','predecessorFactId'); relations.createIndex('successorFactId','successorFactId');
  const outbox = db!.createObjectStore('syncOutbox', { keyPath: 'eventId' });
  outbox.createIndex('memoryId','memoryId'); outbox.createIndex('status','status'); outbox.createIndex('nextAttemptAt','nextAttemptAt');
  db!.createObjectStore('syncState', { keyPath: 'key' });
  const conflicts = db!.createObjectStore('syncConflicts', { keyPath: 'memoryId' }); conflicts.createIndex('status','status');
  const staging = db!.createObjectStore('bootstrapStaging', { keyPath: ['bootstrapToken','recordKey'] }); staging.createIndex('bootstrapToken','bootstrapToken');
  facts.openCursor().onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cursor) return;
    const fact = cursor.value as LocalFactRecord;
    if (fact.supersedesFactId) relations.add({ memoryId: fact.memoryId, predecessorFactId: fact.supersedesFactId, successorFactId: fact.id, relationType: 'SUPERSEDES' });
    cursor.continue();
  };
}
```

Use `request.result` database from `onupgradeneeded` if transaction does not expose a typed `db` property; keep existing upgrade function signature explicit rather than relying on a nonstandard IDBTransaction field.

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/mdp-local-db.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/indexeddb/mdp-local-db*
git commit -m "feat(slice-04): migrate local database to sync v3"
```

---

### Task 12: Local create/correct/resolve atomic Outbox + graph history

**Files:** Modify `memory-repository.ts`, `indexeddb-memory-repository.ts`, tests.

- [ ] **Step 1: Write RED atomicity/conflict tests**

```ts
await repository.create('Sintético');
expect(await readAll('syncOutbox')).toHaveLength(1);
await injectNextAddFailure('syncOutbox');
await expect(repository.correct(memoryId, request)).rejects.toMatchObject({ code: 'LOCAL_DATA_INTEGRITY_ERROR' });
expect(await repository.history(memoryId)).toEqual(historyBeforeFailedCorrection);
```

- [ ] **Step 2: Extend repository boundary**

```ts
export interface MemoryRepository {
  ready(): Promise<void>;
  create(text: string): Promise<CreateMemoryResponse>;
  query(query: string): Promise<MemoryQueryResponse>;
  correct(memoryId: string, request: CorrectMemoryRequest): Promise<CorrectMemoryResponse>;
  resolveConflict(memoryId: string, request: ResolveConflictRequest): Promise<CorrectMemoryResponse>;
  history(memoryId: string): Promise<MemoryHistoryResponse>;
}
```

Add `CONFLICT_REQUIRES_RESOLUTION` to local stable errors.

- [ ] **Step 3: Add syncOutbox and relation writes in same transaction**

```ts
const tx = db.transaction(['memories','evidence','ledgerEvents','facts','currentFacts','factRelations','syncOutbox','syncConflicts'], 'readwrite');
// add canonical rows first, then exact envelope with eventId=LedgerEvent.id; transaction success is returned only after transactionDone(tx).
tx.objectStore('syncOutbox').add({ eventId: record.event.id, memoryId, envelope, status:'PENDING', attempt:0, nextAttemptAt:null, lastErrorCode:null });
```

Create uses no relation; correction adds one; resolution validates currently OPEN candidate set equals request set, then adds every resolution relation.

- [ ] **Step 4: Replace linear history/query behavior**

```ts
const ordered = orderFactGraphHistory(facts.map(toGraphNode), relations);
const conflict = await getConflict(tx, memoryId);
if (conflict?.status === 'OPEN') return buildConflictQueryResponse(conflict, facts, evidence);
return buildNormalQueryResponse(currentFact);
```

History maps each Fact to authoritative `predecessorFactIds`; legacy `supersedesFactId` is populated only for one-predecessor normal corrections.

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/indexeddb-memory-repository.test.ts apps/web/src/lib/memory-repository.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/memory-repository* apps/web/src/lib/indexeddb/indexeddb-memory-repository*
git commit -m "feat(slice-04): enqueue local memory events atomically"
```

---

### Task 13: IndexedDbSyncStore atomic pull/bootstrap

**Files:** Create `indexeddb-sync-store.ts`, test.

- [ ] **Step 1: Write RED identity/ack tests**

```ts
expect((await store.getOrCreateClientInstanceId())[14]).toBe('7');
await store.applyPushResults([{eventId,status:'CONFLICT'}], now);
expect(await pending(eventId)).toBeUndefined();
expect((await store.getMemoryStatus(memoryId))).toBe('CONFLICT');
```

- [ ] **Step 2: Implement immutable add-or-verify**

```ts
async function addOrVerify(store: IDBObjectStore, key: IDBValidKey, value: unknown): Promise<void> {
  const existing = await requestAsPromise(store.get(key));
  if (existing === undefined) { store.add(value); return; }
  if (stableJson(toComparable(existing)) !== stableJson(toComparable(value))) throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
}
```

Use type-specific keys; FactRelation key is `[predecessorFactId,successorFactId]`.

- [ ] **Step 3: Implement push-result state transitions**

```ts
switch (result.status) {
  case 'APPLIED': case 'ALREADY_APPLIED': case 'CONFLICT': outbox.delete(result.eventId); break;
  case 'DEPENDENCY_MISSING': keepPendingForImmediateDependencyRecovery(row); break;
  case 'BLOCKED': case 'INVALID': outbox.put({ ...row, status:'BLOCKED', lastErrorCode: result.code }); break;
}
```

- [ ] **Step 4: Implement atomic pull**

```ts
async applyPullPage(page: SyncPullResponse): Promise<void> {
  const db = await this.database();
  const tx = db.transaction(['memories','evidence','ledgerEvents','facts','factRelations','currentFacts','syncConflicts','syncState'], 'readwrite');
  const touched = new Set<string>();
  for (const item of page.events) for (const record of item.envelope.records) { await applyRecordImmutable(tx, record); touched.add(item.envelope.memoryId); }
  for (const memoryId of touched) await reprojectInTransaction(tx, memoryId);
  tx.objectStore('syncState').put({ key:'confirmedCursor', value: page.nextCursor });
  await transactionDone(tx);
}
```

- [ ] **Step 5: Implement bootstrap stage/promotion**

```ts
stageBootstrapPage(token, records) // transaction writes only bootstrapStaging records using recordKey(record)

promoteBootstrap(token, watermark) // one transaction reads all token staging, addOrVerify canonical records, reprojects touched memories, writes confirmedCursor=watermark, deletes token staging; never deletes/overwrites syncOutbox
```

If promotion fails, transaction rollback preserves canonical/cursor/pending state.

- [ ] **Step 6: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/indexeddb/indexeddb-sync-store*
git commit -m "feat(slice-04): add local synchronization store"
```

---

### Task 14: HTTP sync client + retry

**Files:** Create `sync-api.ts/test`, `retry.ts/test`.

- [ ] **Step 1: Write RED serialization/retry tests**

```ts
expect(computeRetryDelay(0, () => 0.5)).toBe(500);
expect(computeRetryDelay(1, () => 0.5)).toBe(1000);
expect(classifySyncFailure({status:503})).toBe('TRANSIENT');
expect(classifySyncFailure({code:'SYNC_INTEGRITY_VIOLATION'})).toBe('PERMANENT');
```

- [ ] **Step 2: Implement retry**

```ts
export function computeRetryDelay(attempt: number, random: () => number): number {
  const raw = Math.min(500 * 2 ** attempt, 10_000);
  return Math.round(raw * (0.8 + random() * 0.4));
}
export const MAX_FOREGROUND_RETRIES = 5;
```

- [ ] **Step 3: Implement client**

```ts
export class SyncApiClient {
  constructor(private readonly baseUrl: string, private readonly fetchFn: typeof fetch = fetch) {}
  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const res = await this.fetchFn(`${this.baseUrl}/sync/v1/push`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(request), cache:'no-store' });
    if (!res.ok) throw await parseSyncHttpError(res);
    return syncPushResponseSchema.parse(await res.json());
  }
  async pull(after: SyncCursor, limit: number): Promise<SyncPullResponse> {
    const res = await this.fetchFn(`${this.baseUrl}/sync/v1/pull?after=${encodeURIComponent(after)}&limit=${limit}`, { cache:'no-store' });
    if (!res.ok) throw await parseSyncHttpError(res);
    return syncPullResponseSchema.parse(await res.json());
  }
}
```

Add analogous bootstrap start/page methods; never use Cache API.

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/sync/sync-api.test.ts apps/web/src/lib/sync/retry.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sync
git commit -m "feat(slice-04): add sync transport and retry policy"
```

---

### Task 15: SyncEngine

**Files:** Create `sync-engine.ts`, test.

- [ ] **Step 1: Write RED orchestration tests**

Test offline no-network, bootstrap on null cursor, push→pull, dependency recovery, cursor-expired rebootstrap, single-flight, bounded retry.

- [ ] **Step 2: Implement single-flight entrypoint**

```ts
synchronize(reason: SyncReason): Promise<void> {
  if (!this.online()) return Promise.resolve();
  if (this.inFlight) return this.inFlight;
  this.inFlight = this.runCycle(reason).finally(() => { this.inFlight = null; });
  return this.inFlight;
}
```

- [ ] **Step 3: Implement cycle**

```ts
private async runCycle(reason: SyncReason): Promise<void> {
  this.emit({status:'SYNCING', reason});
  if ((await this.local.getConfirmedCursor()) === null) await this.bootstrap();
  for (let round = 0; round < 20; round += 1) {
    const pending = await this.local.listPending(this.batchSize, this.now());
    if (pending.length) {
      const response = await this.withRetry(() => this.api.push({ protocolVersion:1, clientInstanceId: await this.local.getOrCreateClientInstanceId(), events: pending.map((p) => p.envelope) }));
      await this.local.applyPushResults(response.results, this.now());
    }
    const cursor = (await this.local.getConfirmedCursor())!;
    const pull = await this.api.pull(cursor, this.batchSize);
    await this.local.applyPullPage(pull);
    if (!pull.hasMore && pending.length === 0) break;
  }
  this.emit(await this.local.getGlobalStatus());
}
```

Catch `SYNC_CURSOR_EXPIRED` to call safe `bootstrap()`; `DEPENDENCY_MISSING` remains pending and the subsequent pull can provide dependencies. Enforce a round cap so malformed state cannot spin forever.

- [ ] **Step 4: Implement bootstrap loop**

```ts
const start = await this.api.startBootstrap({ protocolVersion:1, clientInstanceId });
for (let offset = 0; offset !== null;) {
  const page = await this.api.readBootstrapPage(start.bootstrapToken, offset, this.batchSize);
  await this.local.stageBootstrapPage(start.bootstrapToken, page.records);
  offset = page.nextOffset;
}
await this.local.promoteBootstrap(start.bootstrapToken, start.highWatermarkCursor);
```

On `SYNC_BOOTSTRAP_EXPIRED`, discard that token staging and restart; no cursor advance before promotion.

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run apps/web/src/lib/sync/sync-engine.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sync/sync-engine*
git commit -m "feat(slice-04): implement synchronization engine"
```

---

### Task 16: React sync/conflict UI

**Files:** Create `use-sync-state.ts/test`, `features/sync/SyncStatus.tsx/test`, `ConflictResolutionPanel.tsx/test`; modify App, StoreMemoryForm, MemoryFoundResult and tests.

- [ ] **Step 1: Write RED UI tests**

```tsx
expect(screen.getByText(/Salva neste dispositivo/i)).toBeInTheDocument();
expect(screen.queryByText(/^Sincronizada$/i)).not.toBeInTheDocument();
await user.click(screen.getByRole('button', {name:/Sincronizar agora/i}));
expect(syncEngine.synchronize).toHaveBeenCalledWith('manual');
```

Conflict test asserts baseline/candidates and no normal answer rendering.

- [ ] **Step 2: Implement hook**

```ts
export function useSyncState(engine: SyncEngine) {
  const [state, setState] = useState<SyncRuntimeState>({status:navigator.onLine?'PENDING':'OFFLINE'});
  useEffect(() => engine.subscribe(setState), [engine]);
  return { state, synchronizeNow: () => engine.synchronize('manual') };
}
```

- [ ] **Step 3: Wire app startup/online triggers**

```ts
useEffect(() => {
  if (navigator.onLine) void syncEngine.synchronize('startup');
  const onOnline = () => void syncEngine.synchronize('online');
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}, [syncEngine]);
```

- [ ] **Step 4: Implement conflict panel**

```tsx
<form onSubmit={handleResolve}>
  {conflict.candidates.map((candidate) => <label key={candidate.factId}><input type="radio" name="candidate" value={candidate.content}/>{candidate.content}</label>)}
  <textarea aria-label="Nova versão confirmada" value={customText} onChange={(e)=>setCustomText(e.target.value)}/>
  <button type="submit">Resolver conflito</button>
</form>
```

Submit calls local `resolveConflict(memoryId,{expectedCandidateFactIds,text,reason})`; it never edits old Facts.

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run apps/web/src/App.test.tsx apps/web/src/features/memory apps/web/src/features/sync apps/web/src/lib/sync/use-sync-state.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App* apps/web/src/features apps/web/src/lib/sync/use-sync-state*
git commit -m "feat(slice-04): surface synchronization and conflict state"
```

---

### Task 17: Architecture + physical schema guards

**Files:** Create `tests/architecture/slice-04-scope.test.ts`; modify `.github/workflows/ci.yml`.

- [ ] **Step 1: Write RED architecture guard**

```ts
const forbidden = ['bullmq','ioredis','redis.createClient','new WebSocket(','MEMORY_DELETED','lastWriteWins','serverWins'];
for (const token of forbidden) expect(productionSource).not.toContain(token);
expect(productionSource).not.toMatch(/SyncManager|registration\.sync\.register/);
```

Also assert active App/memory feature source does not import/call `memory-api` for writes.

- [ ] **Step 2: Update CI exact tables**

```bash
expected="current_facts,evidence,fact_relations,facts,ledger_events,memories,sync_bootstrap_snapshots,sync_conflicts,sync_feed_state,sync_outbox"
```

- [ ] **Step 3: Add physical SQL checks**

```bash
legacy_unique="$(psql ... -tAc "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='facts_supersedes_fact_id_key';")"
outbox_default="$(psql ... -tAc "SELECT COALESCE(column_default,'') FROM information_schema.columns WHERE table_name='sync_outbox' AND column_name='sequence';")"
feed_row="$(psql ... -tAc "SELECT count(*) FROM sync_feed_state WHERE id=1 AND current_sequence>=0;")"
test "$legacy_unique" = "0"
test -z "$outbox_default"
test "$feed_row" = "1"
```

Use the existing full `docker compose exec -T postgres psql -U mdp -d mdp` prefix instead of literal `psql ...` in the workflow; the SQL strings above are exact assertions.

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run tests/architecture/slice-04-scope.test.ts && pnpm lint && pnpm format:check`

- [ ] **Step 5: Commit**

```bash
git add tests/architecture/slice-04-scope.test.ts .github/workflows/ci.yml
git commit -m "test(slice-04): guard synchronization architecture"
```

---

### Task 18: Core synchronization E2E

**Files:** Create `tests/e2e/synchronization-core.spec.ts`; modify `playwright.config.ts`.

- [ ] **Step 1: Configure deterministic synthetic limits**

```ts
env: {
  PORT:'3000', DATABASE_URL:'postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp',
  WEB_ORIGIN:'http://127.0.0.1:5173', VITE_API_BASE_URL:'http://127.0.0.1:3000',
  SYNC_MAX_BATCH_SIZE:'4', SYNC_OUTBOX_MAX_ENTRIES:'8', SYNC_BOOTSTRAP_TTL_SECONDS:'30',
}
```

- [ ] **Step 2: Offline create/correct→online**

```ts
await context.setOffline(true);
await page.getByLabel('Memória').fill('Registro sintético A');
await page.getByRole('button',{name:/Salvar/i}).click();
await context.setOffline(false);
await page.getByRole('button',{name:/Sincronizar agora/i}).click();
await expect(page.getByText(/^Sincronizada$/)).toBeVisible();
```

Continue through correction and verify server/local history IDs with API response + browser state.

- [ ] **Step 3: Lost response after server commit**

```ts
let dropOnce = true;
await page.route('**/sync/v1/push', async (route) => {
  if (!dropOnce) return route.continue();
  dropOnce = false;
  await route.fetch();
  await route.abort();
});
```

Manual retry must reuse same event ID; assert one server effect.

- [ ] **Step 4: Two-device identity convergence**

Create `contextA` and `contextB`; A creates/syncs; B bootstraps. Compare memory/evidence/fact UUIDs exactly.

- [ ] **Step 5: Out-of-order dependency**

Intercept first push batch and reorder JSON `events` so a dependent correction precedes its predecessor. Relay real server response; expect dependency-missing then later same event ID accepted.

- [ ] **Step 6: Verify**

Run: `pnpm exec playwright test tests/e2e/synchronization-core.spec.ts --project=chromium`

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/synchronization-core.spec.ts playwright.config.ts
git commit -m "test(slice-04): cover core synchronization flows"
```

---

### Task 19: Conflict/resolution E2E

**Files:** Create `tests/e2e/synchronization-conflicts.spec.ts`.

- [ ] **Step 1: Concurrent branch conflict**

```ts
await contextA.setOffline(true); await contextB.setOffline(true);
await correctFromBase(pageA, baseFactId, 'Versão B');
await correctFromBase(pageB, baseFactId, 'Versão C');
await contextA.setOffline(false); await contextB.setOffline(false);
await synchronize(pageA); await synchronize(pageB); await synchronize(pageA);
await expect(pageA.getByText(/Conflito/)).toBeVisible();
await expect(pageA.getByText('Versão B')).toBeVisible();
await expect(pageA.getByText('Versão C')).toBeVisible();
```

Verify server retains both Facts/Evidence and baseline is not normal answer.

- [ ] **Step 2: Human resolution**

Resolve B/C to D; verify D new UUID, relations B→D/C→D, all replicas converge, B/C remain history.

- [ ] **Step 3: Bootstrap versus local pending branch**

Server A→B; local fresh install has A→C pending before first server bootstrap fixture. Promote snapshot and assert explicit conflict without overwrite.

- [ ] **Step 4: Concurrent resolution recursion**

Two devices resolve same B/C to D/E offline. Sync both; assert OPEN conflict candidates D/E and dominator baseline A.

- [ ] **Step 5: Verify/commit**

```bash
pnpm exec playwright test tests/e2e/synchronization-conflicts.spec.ts --project=chromium
git add tests/e2e/synchronization-conflicts.spec.ts
git commit -m "test(slice-04): prove conflict preservation and resolution"
```

---

### Task 20: Recovery E2E

**Files:** Create `tests/e2e/synchronization-recovery.spec.ts`.

- [ ] **Step 1: New-device bootstrap then incremental pull**

Seed server via existing synthetic memory API; fresh context bootstraps; create later server correction; assert it arrives through pull after stored watermark.

- [ ] **Step 2: Cursor expiry + rebootstrap preserving local pending**

Generate more than eight accepted Outbox events after device's old cursor. On reconnect assert engine handles `SYNC_CURSOR_EXPIRED`, reboots, then pushes unchanged pending event ID.

- [ ] **Step 3: Pull atomic rollback**

```ts
await page.route('**/sync/v1/pull**', async (route) => {
  const response = await route.fetch();
  const body = await response.json();
  const mutated = mutateFirstKnownImmutableRecord(body);
  await route.fulfill({ response, json: mutated });
});
```

Assert cursor unchanged through IndexedDB inspection; unroute and retry authentic page successfully.

- [ ] **Step 4: Bootstrap partial staging invisible**

Abort second/later bootstrap page; assert remote-only record is not normal query result, local data remains usable, and subsequent bootstrap succeeds.

- [ ] **Step 5: Protocol 999 preserves pending**

```ts
await page.route('**/sync/v1/push', async (route) => {
  const request = route.request();
  const body = request.postDataJSON();
  const response = await route.fetch({ postData: JSON.stringify({ ...body, protocolVersion: 999 }) });
  await route.fulfill({ response });
});
```

Assert pending event/cursor unchanged; remove route and v1 sync succeeds.

- [ ] **Step 6: Verify/commit**

```bash
pnpm exec playwright test tests/e2e/synchronization-recovery.spec.ts --project=chromium
git add tests/e2e/synchronization-recovery.spec.ts
git commit -m "test(slice-04): prove synchronization recovery semantics"
```

---

### Task 21: Full regression, outage proof, invariants

**Files:** Create `artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-INVARIANTS.yaml`; implementation files only for scoped fixes.

- [ ] **Step 1: Clean migration chain**

```bash
docker compose down -v
docker compose up -d postgres
pnpm install --frozen-lockfile
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
```

- [ ] **Step 2: Static/unit/build**

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm verify:pwa
```

- [ ] **Step 3: Browser regression**

```bash
pnpm e2e
pnpm e2e:offline
```

Standard E2E includes Slices 01–04; isolated offline remains Slice 03-only.

- [ ] **Step 4: Real PostgreSQL outage proof**

Extend current CI outage script: healthy live/ready=200; stop DB; live=200, ready=503, existing memory mutation safe 503, `/sync/v1/push` safe 503 with no SQL/synthetic content leak; restart DB; same local pending UUID syncs successfully.

- [ ] **Step 5: Write exact I1–I15 YAML**

```yaml
slice: 4
invariants:
  I1: { statement: "no silent overwrite", proofs: ["tests/e2e/synchronization-conflicts.spec.ts"] }
  I2: { statement: "original Evidence is never destroyed by synchronization", proofs: ["apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts", "tests/e2e/synchronization-conflicts.spec.ts"] }
  I3: { statement: "retries do not duplicate events/effects", proofs: ["tests/e2e/synchronization-core.spec.ts"] }
  I4: { statement: "same eventId with different content fails closed", proofs: ["apps/api/src/infrastructure/persistence/prisma/prisma-sync.store.integration.test.ts"] }
  I5: { statement: "cursor advances only after local commit", proofs: ["apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts", "tests/e2e/synchronization-recovery.spec.ts"] }
  I6: { statement: "server canonical sync-visible write always has same-transaction Outbox", proofs: ["apps/api/src/infrastructure/persistence/prisma/prisma-canonical-memory.writer.integration.test.ts"] }
  I7: { statement: "conflicts preserve every valid branch", proofs: ["tests/e2e/synchronization-conflicts.spec.ts"] }
  I8: { statement: "timestamps do not resolve causal truth", proofs: ["packages/domain/src/fact-graph.test.ts"] }
  I9: { statement: "device remains functional offline", proofs: ["tests/e2e/local-offline.spec.ts"] }
  I10: { statement: "sync failure does not imply local data loss", proofs: ["tests/e2e/synchronization-core.spec.ts"] }
  I11: { statement: "rebootstrap does not erase pending local operations", proofs: ["tests/e2e/synchronization-recovery.spec.ts"] }
  I12: { statement: "replicas converge after failures/conflicts/resolution", proofs: ["tests/e2e/synchronization-core.spec.ts", "tests/e2e/synchronization-conflicts.spec.ts"] }
  I13: { statement: "CurrentFact and conflict projections are reconstructible", proofs: ["packages/domain/src/fact-graph.test.ts", "apps/web/src/lib/indexeddb/indexeddb-sync-store.test.ts"] }
  I14: { statement: "purge/deletion semantics are not introduced", proofs: ["tests/architecture/slice-04-scope.test.ts"] }
  I15: { statement: "validation requires no real sensitive data", proofs: ["docs/evidence/slice-04/SLICE-04-EVIDENCE-001.md"] }
```

- [ ] **Step 6: Commit invariant map**

```bash
git add artifacts/phases/SLICE-04-SYNCHRONIZATION/PHASE-04-INVARIANTS.yaml
git commit -m "test(slice-04): map synchronization acceptance invariants"
```

---

### Task 22: Freeze evidence/checkpoint/review

**Files:**
- Create `docs/evidence/slice-04/SLICE-04-EVIDENCE-001.md`
- Create `docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md`
- Create `docs/phases/SLICE-04.md`
- Create `docs/superpowers/specs/2026-08-18-slice-04-synchronization-review.md`
- Create artifact files `README.md`, `PHASE-04-PLAN.md`, `PHASE-04-REPORT.md`, `PHASE-04-DECISIONS.md`, `PHASE-04-VALIDATION.txt`, `PHASE-04-VALIDATION-FULL.txt`, `PHASE-04-SMOKE.txt`, `PHASE-04-CHECKPOINT.yaml`, existing `PHASE-04-INVARIANTS.yaml`, and `PHASE-04-ARTIFACT-MANIFEST.sha256` under `artifacts/phases/SLICE-04-SYNCHRONIZATION/`.
- Modify `.github/workflows/ci.yml` to verify frozen manifest.

- [ ] **Step 1: Record observed evidence only**

Use exact candidate SHA, actual test/E2E counts, real migration/schema/outage outputs, invariant map, workflow run/job IDs. Planned counts are never reported as observed.

- [ ] **Step 2: Record review truthfully**

MESTRE findings by severity. Emily/LÉO/subagent gates are `NOT PERFORMED / NOT CLAIMED` whenever unavailable.

- [ ] **Step 3: Freeze manifest**

```bash
cd artifacts/phases/SLICE-04-SYNCHRONIZATION
sha256sum README.md PHASE-04-PLAN.md PHASE-04-REPORT.md PHASE-04-DECISIONS.md PHASE-04-VALIDATION.txt PHASE-04-VALIDATION-FULL.txt PHASE-04-SMOKE.txt PHASE-04-CHECKPOINT.yaml PHASE-04-INVARIANTS.yaml > PHASE-04-ARTIFACT-MANIFEST.sha256
sha256sum -c PHASE-04-ARTIFACT-MANIFEST.sha256
```

- [ ] **Step 4: Add CI manifest verification; run full qualifying CI on exact candidate HEAD**

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/slice-04 docs/checkpoints/MDP-SLICE-04-CHECKPOINT-001.md docs/phases/SLICE-04.md docs/superpowers/specs/2026-08-18-slice-04-synchronization-review.md artifacts/phases/SLICE-04-SYNCHRONIZATION .github/workflows/ci.yml
git commit -m "docs(slice-04): freeze synchronization evidence"
```

---

### Task 23: HUMAN_GATE preparation; no automatic merge

**Files:** No product changes. `docs/STATE.md` cannot claim merged before actual authorized merge.

- [ ] **Step 1: Scope/lineage**

```bash
git diff --stat main...HEAD
git log --oneline main..HEAD
```

- [ ] **Step 2: Confirm qualifying CI on exact candidate SHA**

Record exact run ID/job ID/SHA.

- [ ] **Step 3: Present explicit MCF gate with recommendation marked**

```text
✅ A — AUTORIZAR MERGE SLICE 04 — RECOMENDADA PELO MESTRE
⬜ B — NÃO AUTORIZAR / CORRIGIR ANTES DO MERGE
```

- [ ] **Step 4: Stop**

Do not merge or begin Slice 05 implementation before explicit authorization.

---

## Self-Review Coverage

- Governance: Global Constraints, Task 23.
- Bidirectional local-first event sync: Tasks 1, 12–16.
- DAG/conflicts/resolution: Tasks 2–7, 12–13, 19.
- Protocol version/client instance: Tasks 1, 11, 13–15, 20.
- Bootstrap/push/pull/idempotency/dependencies: Tasks 7–10, 13–15.
- Transactional Outbox/commit-order/retention: Tasks 4–9.
- IndexedDB v3/local atomicity: Tasks 11–13.
- Retry/status/pagination: Tasks 8–10, 13–16.
- Security/deletion/infrastructure non-goals: Global Constraints + Task 17.
- Stable errors: Tasks 1, 7–10, 14.
- Required E2E scenarios: Tasks 18–20.
- I1–I15: Task 21 exact mapping.
- DoD/regression/evidence/HUMAN_GATE: Tasks 21–23.

Self-review result: no `TBD`, `TODO`, omitted SQL column list, unspecified physical table name, automatic merge instruction, or code-implementation step without an executable code/command skeleton remains.

## Execution Handoff

This plan is a planning artifact only. **Slice 04 implementation remains NOT AUTHORIZED until LEANDRO explicitly authorizes it.**

If that gate is granted in this runtime, use inline task-by-task execution with `superpowers:executing-plans`. Only claim subagent-driven execution if an actual subagent runtime becomes available; unavailable Emily/LÉO/subagent gates are never retroactively claimed.
