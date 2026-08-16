# Slice 01 — Trusted Text Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first trustworthy end-to-end textual memory flow: preserve exact text as canonical Evidence, append `MEMORY_CREATED`, create a deterministic Fact/current projection, retrieve it with literal PostgreSQL substring search, and return provenance or explicit `UNKNOWN`.

**Architecture:** Keep `@mdp/domain` pure and infrastructure-neutral, put HTTP schemas/types in `@mdp/contracts`, and isolate all Prisma/PostgreSQL behavior under `apps/api/src/infrastructure`. One API application service orchestrates ID/time creation and a persistence port; one Prisma store owns the atomic five-record transaction and literal query. The React PWA consumes only HTTP contracts and exposes two simple accessible flows.

**Tech Stack:** Node 24, pnpm 10.34, TypeScript 6.0.3 strict/ESM, NestJS, Prisma 7 + PostgreSQL 17, React/Vite, Zod, Vitest/React Testing Library, Playwright Chromium, GitHub Actions.

## Global Constraints

- Branch: `slice/01-trusted-text-memory`; do not implement on `main`.
- Only synthetic, non-sensitive laboratory data is permitted.
- Memory text is `1..4000` characters inclusive; whitespace-only is invalid; valid leading/trailing whitespace is preserved.
- Query text is trimmed for matching and must be `1..200` characters inclusive after trimming.
- `Fact.content` must equal the referenced `Evidence.content` exactly in Slice 01.
- `Memory.occurredAt` is always `null`; `temporalPrecision` is always `unknown` in Slice 01.
- Retrieval rule is literal case-insensitive substring: `strpos(lower(content), lower(trim(q))) > 0`.
- `%` and `_` are literal query characters, never wildcard syntax.
- Match ordering: newest `recordedAt` first, then `factId` ascending.
- A found row proves only that a matching user-recorded statement exists; it does not externally verify truth.
- No AI, embeddings, pgvector, Redis, BullMQ, worker, object storage, voice, offline, sync, corrections, purge, real-user data, or advanced authentication enters this slice.
- Evidence and Ledger have no update path in Slice 01.
- Every memory registration is one database transaction creating Memory + Evidence + LedgerEvent + Fact + CurrentFact or nothing.
- Existing safe API error envelope, request ID, health endpoints, Foundation architecture boundaries and Foundation E2E remain regressions.
- Merge is not authorized by a green CI alone; implementation stops at review/gate readiness.

---

## File Structure Lock

Create or modify only these product-facing areas unless an executable failure proves another file is required:

```text
packages/contracts/src/
  memory.ts
  memory.test.ts
  index.ts

packages/domain/src/
  memory.ts
  memory.test.ts
  index.ts

prisma/
  schema.prisma
  migrations/20260816000200_slice_01_trusted_text_memory/migration.sql

apps/api/src/memories/
  memory.store.ts
  memory.service.ts
  memory.service.test.ts
  memory.controller.ts
  memory.controller.test.ts

apps/api/src/infrastructure/persistence/prisma/
  prisma.service.ts
  prisma-memory.store.ts
  prisma-memory.store.integration.test.ts

apps/web/src/lib/
  memory-api.ts
  memory-api.test.ts

apps/web/src/features/memory/
  StoreMemoryForm.tsx
  StoreMemoryForm.test.tsx
  QueryMemoryForm.tsx
  QueryMemoryForm.test.tsx

apps/web/src/
  App.tsx
  App.test.tsx
  index.css

tests/architecture/
  slice-01-scope.test.ts

tests/e2e/
  trusted-text-memory.spec.ts

.github/workflows/ci.yml

docs/evidence/slice-01/
  SLICE-01-EVIDENCE-001.md

docs/phases/
  SLICE-01.md

docs/checkpoints/
  MDP-SLICE-01-CHECKPOINT-001.md

docs/STATE.md
docs/MDP-RESUME-CARD.md

artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/
  PHASE-01-PLAN.md
  PHASE-01-REPORT.md
  PHASE-01-VALIDATION.txt
  PHASE-01-VALIDATION-FULL.txt
  PHASE-01-SMOKE.txt
  PHASE-01-CHECKPOINT.yaml
  PHASE-01-DECISIONS.md
  PHASE-01-ARTIFACT-MANIFEST.sha256
  README.md
```

Package manifests may be modified only to add the already-approved workspace/Zod dependencies required by these files. `pnpm-lock.yaml` changes only as a consequence of those manifest changes.

---

### Task 1: Shared HTTP contracts and pure domain record

**Files:**
- Create: `packages/contracts/src/memory.ts`
- Create: `packages/contracts/src/memory.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Create: `packages/domain/src/memory.ts`
- Create: `packages/domain/src/memory.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `MEMORY_TEXT_MAX_LENGTH`, `MEMORY_QUERY_MAX_LENGTH`, `createMemoryRequestSchema`, `memoryQuerySchema`, `CreateMemoryResponse`, `GetMemoryResponse`, `MemoryQueryResponse` from `@mdp/contracts`.
- Produces: `TextMemoryRecord`, `createTextMemoryRecord()` from `@mdp/domain`.
- Consumes: `createId()` remains in `@mdp/shared`; domain must not import it directly.

- [ ] **Step 1: Write failing contract tests**

Create assertions covering valid 4000-character text, rejection at 4001, whitespace-only rejection, preservation of surrounding whitespace, query trimming, query max 200, and the exact `FOUND | UNKNOWN` response union.

```ts
import { describe, expect, it } from 'vitest';
import {
  createMemoryRequestSchema,
  memoryQuerySchema,
  MEMORY_TEXT_MAX_LENGTH,
} from './memory.js';

describe('memory contracts', () => {
  it('preserves valid surrounding whitespace', () => {
    expect(createMemoryRequestSchema.parse({ text: '  memória sintética  ' }).text)
      .toBe('  memória sintética  ');
  });

  it('rejects whitespace-only and oversized memory text', () => {
    expect(() => createMemoryRequestSchema.parse({ text: '   ' })).toThrow();
    expect(() => createMemoryRequestSchema.parse({ text: 'x'.repeat(MEMORY_TEXT_MAX_LENGTH + 1) }))
      .toThrow();
  });

  it('trims query text for matching', () => {
    expect(memoryQuerySchema.parse('  Ana  ')).toBe('Ana');
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
pnpm exec vitest run packages/contracts/src/memory.test.ts
```

Expected: FAIL because `memory.ts` and exports do not exist.

- [ ] **Step 3: Implement the minimal shared contract**

Create `packages/contracts/src/memory.ts` with exact limits and schemas:

```ts
import { z } from 'zod';

export const MEMORY_TEXT_MAX_LENGTH = 4000;
export const MEMORY_QUERY_MAX_LENGTH = 200;

export const createMemoryRequestSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(MEMORY_TEXT_MAX_LENGTH)
    .refine((value) => value.trim().length > 0, 'text must contain non-whitespace content'),
});

export const memoryQuerySchema = z.string().trim().min(1).max(MEMORY_QUERY_MAX_LENGTH);

export interface CreateMemoryResponse {
  memory: { id: string; recordedAt: string };
  fact: { id: string; content: string };
  provenance: { evidenceId: string };
}

export interface GetMemoryResponse {
  memory: { id: string; recordedAt: string; occurredAt: null; temporalPrecision: 'unknown' };
  evidence: { id: string; kind: 'text'; content: string; createdAt: string };
  fact: { id: string; kind: 'autobiographical_statement'; content: string; createdAt: string };
}

export type MemoryQueryResponse =
  | {
      status: 'FOUND';
      answer: string;
      provenance: { memoryId: string; evidenceId: string; factId: string };
    }
  | { status: 'UNKNOWN'; answer: null; provenance: null };
```

Export it from `packages/contracts/src/index.ts`, add `zod` to `@mdp/contracts`, and add `@mdp/contracts` to both API and web workspace dependencies.

- [ ] **Step 4: Run contracts and workspace build**

```bash
pnpm install
pnpm exec vitest run packages/contracts/src/memory.test.ts
pnpm --filter @mdp/contracts build
```

Expected: PASS.

- [ ] **Step 5: Write failing pure-domain test**

```ts
import { describe, expect, it } from 'vitest';
import { createTextMemoryRecord } from './memory.js';

it('creates the five linked Slice 01 records without changing text', () => {
  const record = createTextMemoryRecord({
    text: '  Minha irmã se chama Ana.  ',
    recordedAt: new Date('2026-08-16T08:00:00.000Z'),
    ids: {
      memoryId: '0198-memory',
      evidenceId: '0198-evidence',
      eventId: '0198-event',
      factId: '0198-fact',
    },
  });

  expect(record.evidence.content).toBe('  Minha irmã se chama Ana.  ');
  expect(record.fact.content).toBe(record.evidence.content);
  expect(record.memory.occurredAt).toBeNull();
  expect(record.memory.temporalPrecision).toBe('unknown');
  expect(record.event.type).toBe('MEMORY_CREATED');
});
```

- [ ] **Step 6: Run domain test and verify RED**

```bash
pnpm exec vitest run packages/domain/src/memory.test.ts
```

Expected: FAIL because `createTextMemoryRecord` does not exist.

- [ ] **Step 7: Implement pure record creation**

`packages/domain/src/memory.ts` must define one immutable return shape and must not import Prisma, Nest, Node built-ins, Zod, clocks, random generators or network APIs.

```ts
export interface TextMemoryRecord {
  memory: {
    id: string;
    recordedAt: Date;
    occurredAt: null;
    temporalPrecision: 'unknown';
  };
  evidence: {
    id: string;
    memoryId: string;
    kind: 'text';
    content: string;
    createdAt: Date;
  };
  event: {
    id: string;
    memoryId: string;
    evidenceId: string;
    type: 'MEMORY_CREATED';
    createdAt: Date;
  };
  fact: {
    id: string;
    memoryId: string;
    evidenceId: string;
    kind: 'autobiographical_statement';
    content: string;
    createdAt: Date;
  };
  currentFact: {
    factId: string;
    memoryId: string;
    evidenceId: string;
    content: string;
    recordedAt: Date;
  };
}
```

`createTextMemoryRecord()` copies the same `text` into Evidence, Fact and CurrentFact, uses the same `recordedAt` for all Slice 01 timestamps, sets occurred time to `null`, and never trims or interprets the statement.

- [ ] **Step 8: Run domain + architecture regressions**

```bash
pnpm exec vitest run packages/domain/src/memory.test.ts tests/architecture/eslint-boundaries.test.ts
pnpm --filter @mdp/domain build
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add packages/contracts packages/domain apps/api/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "feat: define trusted text memory contracts"
```

---

### Task 2: Slice 01 PostgreSQL schema, migration and CI schema gate

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260816000200_slice_01_trusted_text_memory/migration.sql`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces database tables: `memories`, `evidence`, `ledger_events`, `facts`, `current_facts`.
- Preserves Foundation migration history and generated-client output path.

- [ ] **Step 1: Expand Prisma schema with the five exact models**

Use UUID columns, PostgreSQL timestamptz, 4000-character content fields and snake-case table names. The schema must encode the provenance foreign keys; it must not add correction/delete/sync/AI columns.

```prisma
model Memory {
  id                String       @id @db.Uuid
  recordedAt        DateTime     @map("recorded_at") @db.Timestamptz(3)
  occurredAt        DateTime?    @map("occurred_at") @db.Timestamptz(3)
  temporalPrecision String       @map("temporal_precision") @db.VarChar(32)
  evidence          Evidence[]
  events            LedgerEvent[]
  facts             Fact[]
  currentFacts      CurrentFact[]

  @@map("memories")
}

model Evidence {
  id        String       @id @db.Uuid
  memoryId  String       @map("memory_id") @db.Uuid
  kind      String       @db.VarChar(32)
  content   String       @db.VarChar(4000)
  createdAt DateTime     @map("created_at") @db.Timestamptz(3)
  memory    Memory       @relation(fields: [memoryId], references: [id], onDelete: Restrict)
  events    LedgerEvent[]
  facts     Fact[]
  currentFacts CurrentFact[]

  @@index([memoryId])
  @@map("evidence")
}

model LedgerEvent {
  id         String   @id @db.Uuid
  memoryId   String   @map("memory_id") @db.Uuid
  evidenceId String   @map("evidence_id") @db.Uuid
  type       String   @db.VarChar(64)
  createdAt  DateTime @map("created_at") @db.Timestamptz(3)
  memory     Memory   @relation(fields: [memoryId], references: [id], onDelete: Restrict)
  evidence   Evidence @relation(fields: [evidenceId], references: [id], onDelete: Restrict)

  @@index([memoryId])
  @@map("ledger_events")
}

model Fact {
  id         String        @id @db.Uuid
  memoryId   String        @map("memory_id") @db.Uuid
  evidenceId String        @map("evidence_id") @db.Uuid
  kind       String        @db.VarChar(64)
  content    String        @db.VarChar(4000)
  createdAt  DateTime      @map("created_at") @db.Timestamptz(3)
  memory     Memory        @relation(fields: [memoryId], references: [id], onDelete: Restrict)
  evidence   Evidence      @relation(fields: [evidenceId], references: [id], onDelete: Restrict)
  current    CurrentFact?

  @@index([memoryId])
  @@map("facts")
}

model CurrentFact {
  factId     String   @id @map("fact_id") @db.Uuid
  memoryId   String   @map("memory_id") @db.Uuid
  evidenceId String   @map("evidence_id") @db.Uuid
  content    String   @db.VarChar(4000)
  recordedAt DateTime @map("recorded_at") @db.Timestamptz(3)
  fact       Fact     @relation(fields: [factId], references: [id], onDelete: Restrict)
  memory     Memory   @relation(fields: [memoryId], references: [id], onDelete: Restrict)
  evidence   Evidence @relation(fields: [evidenceId], references: [id], onDelete: Restrict)

  @@index([recordedAt, factId])
  @@map("current_facts")
}
```

- [ ] **Step 2: Validate schema before writing migration**

```bash
pnpm prisma:validate
pnpm prisma:generate
```

Expected: PASS.

- [ ] **Step 3: Create versioned migration SQL**

Create only the five approved tables plus their foreign keys/indexes. Use `VARCHAR(4000)` for Evidence/Fact/CurrentFact content and `TIMESTAMPTZ(3)` for timestamps. Do not add triggers, extensions, pgvector, generated search columns, update procedures, or delete procedures.

- [ ] **Step 4: Apply migrations to a clean Compose database**

```bash
docker compose down -v
docker compose up -d postgres
pnpm db:migrate
pnpm prisma:generate
```

Expected: Foundation migration then Slice 01 migration both apply successfully.

- [ ] **Step 5: Replace the obsolete Foundation zero-table CI assertion**

Replace `Assert no product tables` with an exact allowlist check:

```yaml
- name: Assert Slice 01 schema boundary
  run: |
    actual="$(docker compose exec -T postgres psql -U mdp -d mdp -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" | sed '/^$/d')"
    expected="$(printf '%s\n' _prisma_migrations current_facts evidence facts ledger_events memories)"
    test "$actual" = "$expected"
```

This is a scope guard: any accidental extra product table fails CI.

- [ ] **Step 6: Run schema boundary manually**

Run the same `psql` query and verify the exact six table names including `_prisma_migrations`.

- [ ] **Step 7: Commit Task 2**

```bash
git add prisma .github/workflows/ci.yml
git commit -m "feat: add trusted text memory schema"
```

---

### Task 3: Atomic registration store and application service

**Files:**
- Create: `apps/api/src/memories/memory.store.ts`
- Create: `apps/api/src/memories/memory.service.ts`
- Create: `apps/api/src/memories/memory.service.test.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma.service.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

**Interfaces:**
- `MemoryStore.create(record: TextMemoryRecord): Promise<void>`.
- `MemoryStore.getById(id: string): Promise<StoredMemory | null>`.
- `MemoryStore.findLiteral(query: string): Promise<QueryHit | null>`.
- `MemoryService.register(text: string): Promise<CreateMemoryResponse>`.
- `MemoryService.get(id: string): Promise<GetMemoryResponse | null>`.
- `MemoryService.query(query: string): Promise<MemoryQueryResponse>`.

- [ ] **Step 1: Write service RED test for ID/time orchestration**

Use a fake store, fixed UUID-v7-like strings and a fixed clock. Assert the service sends one `TextMemoryRecord` whose Evidence/Fact/CurrentFact content is identical and returns the expected response mapping.

- [ ] **Step 2: Run service test and verify RED**

```bash
pnpm --filter @mdp/api test -- memory.service.test.ts
```

Expected: FAIL because service/store port do not exist.

- [ ] **Step 3: Define the store port and implement `MemoryService.register`**

The service constructor accepts the store plus injectable `idFactory` and `clock`, defaulting to `createId` and `() => new Date()` in production.

```ts
export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly idFactory: () => string = createId,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async register(text: string): Promise<CreateMemoryResponse> {
    const recordedAt = this.clock();
    const record = createTextMemoryRecord({
      text,
      recordedAt,
      ids: {
        memoryId: this.idFactory(),
        evidenceId: this.idFactory(),
        eventId: this.idFactory(),
        factId: this.idFactory(),
      },
    });
    await this.store.create(record);
    return {
      memory: { id: record.memory.id, recordedAt: recordedAt.toISOString() },
      fact: { id: record.fact.id, content: record.fact.content },
      provenance: { evidenceId: record.evidence.id },
    };
  }
}
```

- [ ] **Step 4: Run service test and verify GREEN**

```bash
pnpm --filter @mdp/api test -- memory.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Expose Prisma client only inside infrastructure**

Add a read-only `db` getter on `PrismaService`; do not export generated Prisma types through domain/contracts.

```ts
get db(): PrismaClient {
  return this.client;
}
```

- [ ] **Step 6: Write integration RED test for the full transaction**

Against real PostgreSQL, call `PrismaMemoryStore.create()` and assert one row in each of the five tables. Then create a second aggregate whose `factId` collides with the first aggregate so the Fact insert fails after Memory/Evidence/Event inserts; assert the second Memory/Evidence/Event rows do not exist afterward.

- [ ] **Step 7: Run integration test and verify RED**

```bash
pnpm --filter @mdp/api test:integration -- prisma-memory.store.integration.test.ts
```

Expected: FAIL because `PrismaMemoryStore` does not exist.

- [ ] **Step 8: Implement one `$transaction` for all five inserts**

```ts
await this.prisma.db.$transaction(async (tx) => {
  await tx.memory.create({ data: record.memory });
  await tx.evidence.create({ data: record.evidence });
  await tx.ledgerEvent.create({ data: record.event });
  await tx.fact.create({ data: record.fact });
  await tx.currentFact.create({ data: record.currentFact });
});
```

Map field names explicitly when Prisma relation fields prevent direct object spreading. Do not catch and retry this transaction.

- [ ] **Step 9: Run registration integration test and verify GREEN**

```bash
pnpm --filter @mdp/api test:integration -- prisma-memory.store.integration.test.ts
```

Expected: PASS including rollback proof.

- [ ] **Step 10: Commit Task 3**

```bash
git add apps/api/src/memories apps/api/src/infrastructure/persistence/prisma
git commit -m "feat: persist text memories atomically"
```

---

### Task 4: Deterministic retrieval and provenance reads

**Files:**
- Modify: `apps/api/src/memories/memory.store.ts`
- Modify: `apps/api/src/memories/memory.service.ts`
- Modify: `apps/api/src/memories/memory.service.test.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

**Interfaces:**
- `StoredMemory` contains Memory + original Evidence + Fact.
- `QueryHit` contains `memoryId`, `evidenceId`, `factId`, `content`, `recordedAt`.

- [ ] **Step 1: Add RED integration tests for retrieval semantics**

Prove all of these independently:

```text
Ana        matches "Minha irmã se chama Ana."
SE CHAMA   matches "Minha irmã se chama Ana."
%          matches only content containing a literal %
_          matches only content containing a literal _
unrelated  returns null
```

Also seed two matching rows with different `recordedAt` values and verify the newest wins; seed equal timestamps and verify ascending `factId` wins.

- [ ] **Step 2: Run integration tests and verify RED**

```bash
pnpm --filter @mdp/api test:integration -- prisma-memory.store.integration.test.ts
```

Expected: FAIL on unimplemented read/query methods.

- [ ] **Step 3: Implement `getById` through Prisma relations**

Fetch one Memory and include its single Slice 01 Evidence and Fact. Return `null` when absent; do not synthesize provenance.

- [ ] **Step 4: Implement literal query with parameterized `$queryRaw`**

Use the exact SQL predicate from the approved spec; do not use Prisma `contains`, `LIKE` or `ILIKE` because `%` and `_` must not become wildcards.

```ts
const rows = await this.prisma.db.$queryRaw<QueryHit[]>`
  SELECT
    "memory_id" AS "memoryId",
    "evidence_id" AS "evidenceId",
    "fact_id" AS "factId",
    "content",
    "recorded_at" AS "recordedAt"
  FROM "current_facts"
  WHERE strpos(lower("content"), lower(${query})) > 0
  ORDER BY "recorded_at" DESC, "fact_id" ASC
  LIMIT 1
`;
```

Interpolation must remain Prisma tagged-template parameterization. Never build SQL with string concatenation.

- [ ] **Step 5: Implement service response mapping**

`MemoryService.query()` returns exactly:

```ts
return hit
  ? {
      status: 'FOUND',
      answer: hit.content,
      provenance: {
        memoryId: hit.memoryId,
        evidenceId: hit.evidenceId,
        factId: hit.factId,
      },
    }
  : { status: 'UNKNOWN', answer: null, provenance: null };
```

`MemoryService.get()` returns original Evidence content and the Fact while preserving `occurredAt: null` and `temporalPrecision: 'unknown'`.

- [ ] **Step 6: Run unit + integration tests and verify GREEN**

```bash
pnpm --filter @mdp/api test
pnpm --filter @mdp/api test:integration
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/api/src/memories apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts
git commit -m "feat: add deterministic memory retrieval"
```

---

### Task 5: HTTP endpoints and safe failure behavior

**Files:**
- Create: `apps/api/src/memories/memory.controller.ts`
- Create: `apps/api/src/memories/memory.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/http/api-error.filter.test.ts` only if a new regression test is needed; do not change the safe envelope shape without a spec change.

**Interfaces:**
- `POST /memories` -> `201 CreateMemoryResponse`.
- `GET /memories/:id` -> `200 GetMemoryResponse` or existing `404 NOT_FOUND` envelope.
- `GET /query?q=...` -> `200 MemoryQueryResponse`.

- [ ] **Step 1: Write controller RED tests**

Use Nest testing + Supertest with a fake `MemoryService`. Cover 201 success, whitespace-only 400, >4000 400, missing memory 404, trimmed query passed to service, >200 query 400, `FOUND`, `UNKNOWN`.

- [ ] **Step 2: Run controller test and verify RED**

```bash
pnpm --filter @mdp/api test -- memory.controller.test.ts
```

Expected: FAIL because controller is missing.

- [ ] **Step 3: Implement controller validation with shared Zod schemas**

```ts
@Post('memories')
@HttpCode(201)
async create(@Body() body: unknown): Promise<CreateMemoryResponse> {
  const parsed = createMemoryRequestSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException();
  return this.memories.register(parsed.data.text);
}

@Get('query')
async query(@Query('q') q: unknown): Promise<MemoryQueryResponse> {
  const parsed = memoryQuerySchema.safeParse(q);
  if (!parsed.success) throw new BadRequestException();
  return this.memories.query(parsed.data);
}
```

For `GET /memories/:id`, return `NotFoundException` when service returns `null`.

- [ ] **Step 4: Wire providers in `AppModule`**

Add `MemoryController`, `MemoryService` provider and `MEMORY_STORE -> PrismaMemoryStore` provider while preserving existing HealthController/HealthService/PRISMA_SERVICE wiring.

- [ ] **Step 5: Add database-outage endpoint regression**

With real PostgreSQL stopped, a memory endpoint must return a safe error envelope without SQL/stack/credentials/evidence leakage. If raw Prisma exceptions currently map to generic 500, keep 500 only if the endpoint failure is truly internal; for connection-unavailable errors map to Nest `ServiceUnavailableException` so the existing filter returns `SERVICE_UNAVAILABLE`.

- [ ] **Step 6: Run API suites**

```bash
pnpm --filter @mdp/api test
pnpm --filter @mdp/api test:integration
pnpm --filter @mdp/api typecheck
pnpm --filter @mdp/api build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/api/src
git commit -m "feat: expose trusted text memory API"
```

---

### Task 6: Accessible web store/query experience

**Files:**
- Create: `apps/web/src/lib/memory-api.ts`
- Create: `apps/web/src/lib/memory-api.test.ts`
- Create: `apps/web/src/features/memory/StoreMemoryForm.tsx`
- Create: `apps/web/src/features/memory/StoreMemoryForm.test.tsx`
- Create: `apps/web/src/features/memory/QueryMemoryForm.tsx`
- Create: `apps/web/src/features/memory/QueryMemoryForm.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/index.css`

**Interfaces:**
- `createMemory(apiBaseUrl, text): Promise<CreateMemoryResponse>`.
- `queryMemory(apiBaseUrl, query): Promise<MemoryQueryResponse>`.

- [ ] **Step 1: Write RED API-client tests**

Mock `fetch` and prove exact URL/method/body plus typed error behavior. The POST client sends the exact textarea string without trimming.

- [ ] **Step 2: Implement the minimal API client**

```ts
export async function createMemory(apiBaseUrl: string, text: string) {
  const response = await fetch(`${apiBaseUrl}/memories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error('MEMORY_CREATE_FAILED');
  return (await response.json()) as CreateMemoryResponse;
}
```

Implement `queryMemory` with `URLSearchParams` so `%`, `_`, accents and spaces are URL-encoded, not manually concatenated.

- [ ] **Step 3: Run API-client test and verify GREEN**

```bash
pnpm --filter @mdp/web test -- memory-api.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write RED component tests**

Store form requirements:

```text
heading/label: Guardar uma lembrança
textarea maxLength: 4000
button reachable by accessible name
success role=status only after resolved POST
failure uses role=alert or accessible live region
no automatic retry
```

Query form requirements:

```text
heading/label: Consultar minhas lembranças
input maxLength: 200
helper text explains literal words/phrases
FOUND displays exact recorded statement and a visible source indicator
UNKNOWN displays explicit inability to find matching recorded evidence
```

- [ ] **Step 5: Implement focused components**

Do not put all form/network/state logic back into `App.tsx`. `App` keeps Foundation readiness status and renders the two feature components when the API is ready.

Use explicit Portuguese copy:

```text
Guardar uma lembrança
Lembrança
Guardar
Lembrança guardada.
Consultar minhas lembranças
Palavra ou frase
A busca desta etapa procura palavras ou frases exatamente dentro das lembranças guardadas.
Fonte: lembrança guardada
Não encontrei uma lembrança registrada que corresponda a essa busca.
```

- [ ] **Step 6: Add low-cognitive-load CSS without a visual redesign**

Use existing CSS, one-column smartphone-first layout, adequate spacing, inputs/buttons at least 44px tall, visible `:focus-visible`, readable line-height, and no color-only state semantics. Do not add a component library.

- [ ] **Step 7: Run web tests/typecheck/build**

```bash
pnpm --filter @mdp/web test
pnpm --filter @mdp/web typecheck
pnpm --filter @mdp/web build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/web
git commit -m "feat: add trusted text memory web flow"
```

---

### Task 7: Executable invariants, browser E2E and cumulative CI

**Files:**
- Create: `tests/architecture/slice-01-scope.test.ts`
- Create: `tests/e2e/trusted-text-memory.spec.ts`
- Modify: `.github/workflows/ci.yml` only if commands added by earlier tasks are not already covered.

**Interfaces:**
- Produces reproducible acceptance evidence for the vertical slice.

- [ ] **Step 1: Write the scope-invariant test**

The test reads workspace manifests/source paths and fails if Slice 01 introduces forbidden product dependencies or direct infrastructure imports in domain/contracts.

At minimum reject package/source occurrences corresponding to:

```ts
const forbidden = [
  'pgvector',
  'bullmq',
  'redis',
  'openai',
  '@anthropic-ai',
  'node:fs',
  'node:fs/promises',
  '@prisma/client',
];
```

Reuse the existing ESLint boundary test for the already-established Node/Prisma neutrality; this new test additionally proves Slice 01 scope does not add AI/queue/vector infrastructure.

- [ ] **Step 2: Run architecture tests**

```bash
pnpm exec vitest run tests/architecture
```

Expected: PASS.

- [ ] **Step 3: Write browser E2E RED test**

```ts
import { expect, test } from '@playwright/test';

test('stores and retrieves a trusted text memory with provenance and UNKNOWN fallback', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('API pronta');

  await page.getByLabel('Lembrança').fill('Minha irmã se chama Ana.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('status')).toContainText('Lembrança guardada.');

  await page.getByLabel('Palavra ou frase').fill('Ana');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText('Minha irmã se chama Ana.')).toBeVisible();
  await expect(page.getByText('Fonte: lembrança guardada')).toBeVisible();

  await page.getByLabel('Palavra ou frase').fill('texto inexistente 987654321');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText(/Não encontrei uma lembrança registrada/)).toBeVisible();
});
```

- [ ] **Step 4: Run E2E and verify RED/GREEN cycle**

Before final implementation integration, the new test must fail. After web/API tasks are complete:

```bash
pnpm e2e
```

Expected: both Foundation E2E and Trusted Text Memory E2E PASS using built apps and real PostgreSQL.

- [ ] **Step 5: Run the complete local acceptance sequence**

```bash
pnpm install --frozen-lockfile

docker compose down -v
docker compose up -d postgres
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate

pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm --filter @mdp/api test:integration
pnpm build
pnpm e2e
```

Then manually repeat the Foundation database-outage proof and verify:

```text
healthy live=200 ready=200
db-down live=200 ready=503
```

Expected: every command/proof PASS.

- [ ] **Step 6: Verify exact table boundary again**

```bash
docker compose exec -T postgres psql -U mdp -d mdp -tAc \
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
```

Expected exact product set: `current_facts`, `evidence`, `facts`, `ledger_events`, `memories`, plus `_prisma_migrations`.

- [ ] **Step 7: Commit Task 7**

```bash
git add tests .github/workflows/ci.yml
git commit -m "test: prove trusted text memory slice"
```

---

### Task 8: Evidence, MCF traceability pack, review readiness and gate boundary

**Files:**
- Create: `docs/evidence/slice-01/SLICE-01-EVIDENCE-001.md`
- Create: `docs/phases/SLICE-01.md`
- Create: `docs/checkpoints/MDP-SLICE-01-CHECKPOINT-001.md`
- Modify: `docs/STATE.md`
- Modify: `docs/MDP-RESUME-CARD.md`
- Create all files under `artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/` listed in the File Structure Lock.

**Interfaces:**
- Produces the project evidence record and MCF Phase Traceability Pack.
- Final branch state after this task: `SLICE 01 — IN_REVIEW`, never `COMPLETE` before review/CI/gate.

- [ ] **Step 1: Capture exact validation evidence**

Record command, observed result and exact HEAD SHA for every acceptance item in `SLICE-01-EVIDENCE-001.md`. Use synthetic fixture text only. Include migration result, five-table boundary, unit/integration/E2E totals, rollback proof, literal `%`/`_` proof, ordering proof, provenance proof, `UNKNOWN` proof, Foundation regression and outage/readiness proof.

- [ ] **Step 2: Create the MCF PRF**

`PHASE-01-PLAN.md` copies the approved boundary/acceptance and identifies Slice 01 as risk class B because it establishes personal-memory behavior even though laboratory evidence is synthetic.

`PHASE-01-REPORT.md` records executed task commits, deviations and recoveries.

`PHASE-01-VALIDATION.txt` contains the concise command/result matrix.

`PHASE-01-VALIDATION-FULL.txt` contains safe expanded outputs or exact GitHub/CI references, with secrets and real personal data excluded.

`PHASE-01-SMOKE.txt` records the built-app Playwright store/query/UNKNOWN flow.

`PHASE-01-CHECKPOINT.yaml` records branch, HEAD, current state, open findings, next action and the prohibition on real data.

`PHASE-01-DECISIONS.md` records the human authorization to enter Slice 01, approval of Option A, approval of the written spec, the deterministic retrieval decision and all review/gate decisions produced during execution.

`README.md` defines recovery order for the PRF.

Generate the manifest only after the other PRF files are final:

```bash
cd artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY
sha256sum PHASE-01-PLAN.md PHASE-01-REPORT.md PHASE-01-VALIDATION.txt \
  PHASE-01-VALIDATION-FULL.txt PHASE-01-SMOKE.txt PHASE-01-CHECKPOINT.yaml \
  PHASE-01-DECISIONS.md README.md > PHASE-01-ARTIFACT-MANIFEST.sha256
sha256sum -c PHASE-01-ARTIFACT-MANIFEST.sha256
```

Expected: every manifest entry `OK`.

- [ ] **Step 3: Update canonical project state to review readiness**

Only after all local tests/evidence are PASS, set branch state to:

```text
Current phase: SLICE 01 — IN_REVIEW
FOUNDATION: COMPLETE
Slice 01: IN_REVIEW
Real data: NOT AUTHORIZED
Pilot: NOT AUTHORIZED
```

Record the branch and evidence path. Do not mark Slice 01 COMPLETE and do not authorize Slice 02.

- [ ] **Step 4: Run documentation and full regression checks after state/evidence changes**

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @mdp/api test:integration
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit review-readiness evidence**

```bash
git add docs artifacts
git commit -m "docs: prepare Slice 01 review gate"
```

- [ ] **Step 6: Push branch and open one Slice 01 PR**

PR title:

```text
SLICE 01: trusted text memory
```

PR body must state exact boundary, design/spec path, implementation-plan path, evidence path, HEAD SHA, CI run when available, open Critical/Important findings, and explicit exclusions. It must say that a green CI does not authorize merge.

- [ ] **Step 7: Require independent review before gate**

Run code review over the complete PR diff. Classify findings Critical / Important / Minor. Fix every Critical and Important finding, rerun the affected tests and the complete acceptance sequence, refresh evidence/PRF and push a new reviewed HEAD.

- [ ] **Step 8: Require canonical GitHub CI on the final reviewed HEAD**

The pull-request workflow must complete `success` on the same reviewed HEAD. Capture run ID and job ID in project evidence and PRF.

- [ ] **Step 9: Stop at the Slice 01 gate**

Final allowed state for implementation execution:

```text
SLICE 01 — IN_REVIEW / READY_FOR_GATE
PR — OPEN / NOT MERGED
Critical findings — 0
Important findings — 0
CI — PASS on final reviewed HEAD
Real data — NOT AUTHORIZED
Slice 02 — NOT STARTED / NOT AUTHORIZED
```

Do not merge or mark `COMPLETE` without the gate/authority required by current project governance.

---

## Plan Self-Review Checklist

Before execution begins, verify:

- [ ] Every approved spec acceptance criterion maps to at least one task/test above.
- [ ] Exact text preservation is tested, including valid leading/trailing whitespace.
- [ ] `Fact.content = Evidence.content` is both a domain and integration invariant.
- [ ] Registration rollback is proven after a deliberately forced mid-transaction failure.
- [ ] Query uses `strpos(lower(...), lower(parameter))`, not LIKE/ILIKE/Prisma `contains`.
- [ ] Literal `%` and `_` behavior is tested.
- [ ] Newest-recordedAt then factId ordering is tested.
- [ ] FOUND provenance and UNKNOWN/no-fabrication behavior are tested.
- [ ] No update route/store method for Evidence or Ledger is introduced.
- [ ] Foundation zero-table CI assertion is deliberately replaced by exact Slice 01 table allowlist.
- [ ] Existing health/readiness/outage regressions remain executable.
- [ ] Browser flow uses built apps + real PostgreSQL.
- [ ] No real sensitive data appears in fixtures, logs, screenshots, docs or commits.
- [ ] MCF PRF and project evidence conventions are both satisfied.
- [ ] Execution stops before merge/gate completion.

## Execution Handoff

The implementation plan is complete only when executed task-by-task with TDD and review checkpoints. Recommended execution mode is **Subagent-Driven Development**, one fresh worker per task with spec-compliance review followed by code-quality review. Inline execution is permitted only through the `executing-plans` workflow and must preserve the same task gates.
