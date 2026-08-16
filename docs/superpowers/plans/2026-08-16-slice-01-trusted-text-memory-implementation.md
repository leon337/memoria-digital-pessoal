# Slice 01 — Trusted Text Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first trustworthy end-to-end textual memory flow: preserve exact text as canonical Evidence, append `MEMORY_CREATED`, create a deterministic Fact/current projection, retrieve it with literal PostgreSQL substring search, and return provenance or explicit `UNKNOWN`.

**Architecture:** Keep `@mdp/domain` pure and infrastructure-neutral, put HTTP schemas/types in `@mdp/contracts`, and isolate Prisma/PostgreSQL behavior under `apps/api/src/infrastructure`. One API application service orchestrates IDs/time and a persistence port; one Prisma store owns the atomic five-record transaction and literal query. The React PWA consumes shared HTTP contracts and exposes two accessible smartphone-first flows.

**Tech Stack:** Node 24, pnpm 10.34, TypeScript 6.0.3 strict/ESM, NestJS, Prisma 7 + PostgreSQL 17, React/Vite, Zod, Vitest/React Testing Library, Playwright Chromium, GitHub Actions.

## Global Constraints

- Work only on `slice/01-trusted-text-memory`; never implement this slice on `main`.
- Only synthetic, non-sensitive laboratory data is permitted.
- Memory text is `1..4000` characters inclusive; whitespace-only is invalid; valid leading/trailing whitespace is preserved.
- Query text is trimmed for matching and is `1..200` characters inclusive after trimming.
- `Fact.content === Evidence.content` exactly in Slice 01.
- `CurrentFact.content === Fact.content` exactly in Slice 01.
- `Memory.occurredAt` is always `null`; `temporalPrecision` is always `unknown`.
- Retrieval predicate is exactly equivalent to `strpos(lower(content), lower(trim(q))) > 0`.
- `%` and `_` are literal characters, never wildcard syntax.
- Match order is newest `recordedAt` first, then `factId` ascending.
- `FOUND` means a matching user-recorded statement exists; it does not externally verify objective truth.
- Evidence and Ledger expose no update behavior in Slice 01.
- Registration is one database transaction creating Memory + Evidence + LedgerEvent + Fact + CurrentFact, or nothing.
- No automatic POST retry or deduplication claim.
- No AI, embeddings, pgvector, Redis, BullMQ, worker, object storage, voice, offline, sync, corrections, purge, real-user data, or advanced authentication.
- Existing request ID, safe API error envelope, health endpoints, architecture boundaries, Foundation E2E and PostgreSQL-outage proof remain regressions.
- Green CI alone never authorizes merge or Slice 02.

---

## File Structure Lock

```text
packages/contracts/src/memory.ts
packages/contracts/src/memory.test.ts
packages/contracts/src/index.ts
packages/contracts/package.json

packages/domain/src/memory.ts
packages/domain/src/memory.test.ts
packages/domain/src/index.ts

prisma/schema.prisma
prisma/migrations/20260816000200_slice_01_trusted_text_memory/migration.sql

apps/api/package.json
apps/api/src/app.module.ts
apps/api/src/memories/memory.store.ts
apps/api/src/memories/memory.service.ts
apps/api/src/memories/memory.service.test.ts
apps/api/src/memories/memory.controller.ts
apps/api/src/memories/memory.controller.test.ts
apps/api/src/infrastructure/persistence/prisma/prisma.service.ts
apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts
apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts

apps/web/package.json
apps/web/src/lib/memory-api.ts
apps/web/src/lib/memory-api.test.ts
apps/web/src/features/memory/StoreMemoryForm.tsx
apps/web/src/features/memory/StoreMemoryForm.test.tsx
apps/web/src/features/memory/QueryMemoryForm.tsx
apps/web/src/features/memory/QueryMemoryForm.test.tsx
apps/web/src/App.tsx
apps/web/src/App.test.tsx
apps/web/src/index.css

tests/architecture/slice-01-scope.test.ts
tests/e2e/trusted-text-memory.spec.ts
.github/workflows/ci.yml
pnpm-lock.yaml

docs/evidence/slice-01/SLICE-01-EVIDENCE-001.md
docs/phases/SLICE-01.md
docs/checkpoints/MDP-SLICE-01-CHECKPOINT-001.md
docs/STATE.md
docs/MDP-RESUME-CARD.md

artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/PHASE-01-PLAN.md
artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/PHASE-01-REPORT.md
artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/PHASE-01-VALIDATION.txt
artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/PHASE-01-VALIDATION-FULL.txt
artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/PHASE-01-SMOKE.txt
artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/PHASE-01-CHECKPOINT.yaml
artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/PHASE-01-DECISIONS.md
artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/PHASE-01-ARTIFACT-MANIFEST.sha256
artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/README.md
```

Only add workspace/Zod dependencies required by these files. No unrelated refactor is part of Slice 01.

---

### Task 1: Shared contracts and pure domain creation

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
- `@mdp/contracts`: `MEMORY_TEXT_MAX_LENGTH`, `MEMORY_QUERY_MAX_LENGTH`, `createMemoryRequestSchema`, `memoryQuerySchema`, `CreateMemoryResponse`, `GetMemoryResponse`, `MemoryQueryResponse`.
- `@mdp/domain`: `TextMemoryRecord`, `CreateTextMemoryRecordInput`, `createTextMemoryRecord(input)`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  createMemoryRequestSchema,
  memoryQuerySchema,
  MEMORY_QUERY_MAX_LENGTH,
  MEMORY_TEXT_MAX_LENGTH,
} from './memory.js';

describe('memory contracts', () => {
  it('preserves valid surrounding whitespace', () => {
    const result = createMemoryRequestSchema.parse({ text: '  memória sintética  ' });
    expect(result.text).toBe('  memória sintética  ');
  });

  it('accepts exactly 4000 characters', () => {
    expect(createMemoryRequestSchema.parse({ text: 'x'.repeat(MEMORY_TEXT_MAX_LENGTH) }).text)
      .toHaveLength(MEMORY_TEXT_MAX_LENGTH);
  });

  it('rejects whitespace-only and 4001 characters', () => {
    expect(() => createMemoryRequestSchema.parse({ text: '   ' })).toThrow();
    expect(() =>
      createMemoryRequestSchema.parse({ text: 'x'.repeat(MEMORY_TEXT_MAX_LENGTH + 1) }),
    ).toThrow();
  });

  it('trims query and enforces 200 characters after trim', () => {
    expect(memoryQuerySchema.parse('  Ana  ')).toBe('Ana');
    expect(memoryQuerySchema.parse('x'.repeat(MEMORY_QUERY_MAX_LENGTH))).toHaveLength(200);
    expect(() => memoryQuerySchema.parse('x'.repeat(MEMORY_QUERY_MAX_LENGTH + 1))).toThrow();
  });
});
```

- [ ] **Step 2: Run RED contract test**

```bash
pnpm exec vitest run packages/contracts/src/memory.test.ts
```

Expected: FAIL because the module/exports do not exist.

- [ ] **Step 3: Implement exact shared contracts**

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
  memory: {
    id: string;
    recordedAt: string;
    occurredAt: null;
    temporalPrecision: 'unknown';
  };
  evidence: { id: string; kind: 'text'; content: string; createdAt: string };
  fact: {
    id: string;
    kind: 'autobiographical_statement';
    content: string;
    createdAt: string;
  };
}

export type MemoryQueryResponse =
  | {
      status: 'FOUND';
      answer: string;
      provenance: { memoryId: string; evidenceId: string; factId: string };
    }
  | { status: 'UNKNOWN'; answer: null; provenance: null };
```

Export from `packages/contracts/src/index.ts`. Add `zod` to `packages/contracts/package.json`, `@mdp/contracts` + `@mdp/domain` to the API, and `@mdp/contracts` to the web.

- [ ] **Step 4: Run contracts GREEN**

```bash
pnpm install
pnpm exec vitest run packages/contracts/src/memory.test.ts
pnpm --filter @mdp/contracts build
```

Expected: PASS.

- [ ] **Step 5: Write failing pure-domain test**

```ts
import { expect, it } from 'vitest';
import { createTextMemoryRecord } from './memory.js';

it('creates linked Slice 01 records without changing text or inventing time', () => {
  const recordedAt = new Date('2026-08-16T08:00:00.000Z');
  const record = createTextMemoryRecord({
    text: '  Minha irmã se chama Ana.  ',
    recordedAt,
    ids: {
      memoryId: 'memory-id',
      evidenceId: 'evidence-id',
      eventId: 'event-id',
      factId: 'fact-id',
    },
  });

  expect(record.memory.occurredAt).toBeNull();
  expect(record.memory.temporalPrecision).toBe('unknown');
  expect(record.evidence.content).toBe('  Minha irmã se chama Ana.  ');
  expect(record.fact.content).toBe(record.evidence.content);
  expect(record.currentFact.content).toBe(record.fact.content);
  expect(record.event.type).toBe('MEMORY_CREATED');
  expect(record.event.evidenceId).toBe(record.evidence.id);
  expect(record.evidence.createdAt).toEqual(recordedAt);
});
```

- [ ] **Step 6: Run domain RED test**

```bash
pnpm exec vitest run packages/domain/src/memory.test.ts
```

Expected: FAIL because the domain module does not exist.

- [ ] **Step 7: Implement pure domain types and factory**

```ts
export interface CreateTextMemoryRecordInput {
  text: string;
  recordedAt: Date;
  ids: {
    memoryId: string;
    evidenceId: string;
    eventId: string;
    factId: string;
  };
}

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

export function createTextMemoryRecord(input: CreateTextMemoryRecordInput): TextMemoryRecord {
  const { text, recordedAt, ids } = input;
  return {
    memory: {
      id: ids.memoryId,
      recordedAt,
      occurredAt: null,
      temporalPrecision: 'unknown',
    },
    evidence: {
      id: ids.evidenceId,
      memoryId: ids.memoryId,
      kind: 'text',
      content: text,
      createdAt: recordedAt,
    },
    event: {
      id: ids.eventId,
      memoryId: ids.memoryId,
      evidenceId: ids.evidenceId,
      type: 'MEMORY_CREATED',
      createdAt: recordedAt,
    },
    fact: {
      id: ids.factId,
      memoryId: ids.memoryId,
      evidenceId: ids.evidenceId,
      kind: 'autobiographical_statement',
      content: text,
      createdAt: recordedAt,
    },
    currentFact: {
      factId: ids.factId,
      memoryId: ids.memoryId,
      evidenceId: ids.evidenceId,
      content: text,
      recordedAt,
    },
  };
}
```

Export from `packages/domain/src/index.ts`. Do not import Node/Prisma/Nest/Zod in domain.

- [ ] **Step 8: Run domain + architecture GREEN**

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

### Task 2: PostgreSQL schema, versioned migration and CI schema allowlist

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260816000200_slice_01_trusted_text_memory/migration.sql`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Creates only `memories`, `evidence`, `ledger_events`, `facts`, `current_facts` beyond Prisma migration metadata.

- [ ] **Step 1: Add five Prisma models**

```prisma
model Memory {
  id                String        @id @db.Uuid
  recordedAt        DateTime      @map("recorded_at") @db.Timestamptz(3)
  occurredAt        DateTime?     @map("occurred_at") @db.Timestamptz(3)
  temporalPrecision String        @map("temporal_precision") @db.VarChar(32)
  evidence          Evidence[]
  events            LedgerEvent[]
  facts             Fact[]
  currentFacts      CurrentFact[]

  @@map("memories")
}

model Evidence {
  id           String        @id @db.Uuid
  memoryId     String        @map("memory_id") @db.Uuid
  kind         String        @db.VarChar(32)
  content      String        @db.VarChar(4000)
  createdAt    DateTime      @map("created_at") @db.Timestamptz(3)
  memory       Memory        @relation(fields: [memoryId], references: [id], onDelete: Restrict)
  events       LedgerEvent[]
  facts        Fact[]
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
  id         String       @id @db.Uuid
  memoryId   String       @map("memory_id") @db.Uuid
  evidenceId String       @map("evidence_id") @db.Uuid
  kind       String       @db.VarChar(64)
  content    String       @db.VarChar(4000)
  createdAt  DateTime     @map("created_at") @db.Timestamptz(3)
  memory     Memory       @relation(fields: [memoryId], references: [id], onDelete: Restrict)
  evidence   Evidence     @relation(fields: [evidenceId], references: [id], onDelete: Restrict)
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

- [ ] **Step 2: Validate/generate schema before migration**

```bash
pnpm prisma:validate
pnpm prisma:generate
```

Expected: PASS.

- [ ] **Step 3: Create exact migration DDL**

```sql
CREATE TABLE "memories" (
  "id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3),
  "temporal_precision" VARCHAR(32) NOT NULL,
  CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evidence" (
  "id" UUID NOT NULL,
  "memory_id" UUID NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "content" VARCHAR(4000) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_events" (
  "id" UUID NOT NULL,
  "memory_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "type" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ledger_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "facts" (
  "id" UUID NOT NULL,
  "memory_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "content" VARCHAR(4000) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "current_facts" (
  "fact_id" UUID NOT NULL,
  "memory_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "content" VARCHAR(4000) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "current_facts_pkey" PRIMARY KEY ("fact_id")
);

CREATE INDEX "evidence_memory_id_idx" ON "evidence"("memory_id");
CREATE INDEX "ledger_events_memory_id_idx" ON "ledger_events"("memory_id");
CREATE INDEX "facts_memory_id_idx" ON "facts"("memory_id");
CREATE INDEX "current_facts_recorded_at_fact_id_idx" ON "current_facts"("recorded_at", "fact_id");

ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_memory_id_fkey"
  FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_events"
  ADD CONSTRAINT "ledger_events_memory_id_fkey"
  FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_events"
  ADD CONSTRAINT "ledger_events_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "facts"
  ADD CONSTRAINT "facts_memory_id_fkey"
  FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "facts"
  ADD CONSTRAINT "facts_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "current_facts"
  ADD CONSTRAINT "current_facts_fact_id_fkey"
  FOREIGN KEY ("fact_id") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "current_facts"
  ADD CONSTRAINT "current_facts_memory_id_fkey"
  FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "current_facts"
  ADD CONSTRAINT "current_facts_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply on clean PostgreSQL**

```bash
docker compose down -v
docker compose up -d postgres
pnpm db:migrate
pnpm prisma:generate
```

Expected: Foundation migration and Slice 01 migration PASS.

- [ ] **Step 5: Replace obsolete zero-product-table CI assertion**

```yaml
- name: Assert Slice 01 schema boundary
  run: |
    actual="$(docker compose exec -T postgres psql -U mdp -d mdp -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" | sed '/^$/d')"
    expected="$(printf '%s\n' _prisma_migrations current_facts evidence facts ledger_events memories)"
    test "$actual" = "$expected"
```

- [ ] **Step 6: Run exact allowlist locally**

```bash
actual="$(docker compose exec -T postgres psql -U mdp -d mdp -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" | sed '/^$/d')"
expected="$(printf '%s\n' _prisma_migrations current_facts evidence facts ledger_events memories)"
test "$actual" = "$expected"
```

Expected: exit 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add prisma .github/workflows/ci.yml
git commit -m "feat: add trusted text memory schema"
```

---

### Task 3: Persistence port, atomic write and application service

**Files:**
- Create: `apps/api/src/memories/memory.store.ts`
- Create: `apps/api/src/memories/memory.service.ts`
- Create: `apps/api/src/memories/memory.service.test.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma.service.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

**Interfaces:**

```ts
import type { TextMemoryRecord } from '@mdp/domain';

export interface StoredMemory {
  memory: TextMemoryRecord['memory'];
  evidence: TextMemoryRecord['evidence'];
  fact: TextMemoryRecord['fact'];
}

export interface QueryHit {
  memoryId: string;
  evidenceId: string;
  factId: string;
  content: string;
  recordedAt: Date;
}

export interface MemoryStore {
  create(record: TextMemoryRecord): Promise<void>;
  getById(id: string): Promise<StoredMemory | null>;
  findLiteral(query: string): Promise<QueryHit | null>;
}

export class MemoryStoreUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Memory store unavailable', options);
    this.name = 'MemoryStoreUnavailableError';
  }
}
```

- [ ] **Step 1: Write RED service test**

```ts
import { expect, it, vi } from 'vitest';
import { MemoryService } from './memory.service.js';
import type { MemoryStore } from './memory.store.js';

it('registers one deterministic linked record and returns provenance', async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  const store = { create, getById: vi.fn(), findLiteral: vi.fn() } as unknown as MemoryStore;
  const ids = ['0198f000-0000-7000-8000-000000000001', '0198f000-0000-7000-8000-000000000002', '0198f000-0000-7000-8000-000000000003', '0198f000-0000-7000-8000-000000000004'];
  const service = new MemoryService(store, () => ids.shift()!, () => new Date('2026-08-16T08:00:00.000Z'));

  const result = await service.register('  Minha irmã se chama Ana.  ');
  const record = create.mock.calls[0]![0];

  expect(record.evidence.content).toBe('  Minha irmã se chama Ana.  ');
  expect(record.fact.content).toBe(record.evidence.content);
  expect(record.currentFact.content).toBe(record.fact.content);
  expect(result.provenance.evidenceId).toBe(record.evidence.id);
});
```

- [ ] **Step 2: Run service RED**

```bash
pnpm --filter @mdp/api test -- memory.service.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `MemoryService.register()`**

```ts
import { createTextMemoryRecord } from '@mdp/domain';
import { createId } from '@mdp/shared';
import type { CreateMemoryResponse, GetMemoryResponse, MemoryQueryResponse } from '@mdp/contracts';
import { ServiceUnavailableException } from '@nestjs/common';
import { MemoryStoreUnavailableError, type MemoryStore } from './memory.store.js';

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
    await this.runStore(() => this.store.create(record));
    return {
      memory: { id: record.memory.id, recordedAt: recordedAt.toISOString() },
      fact: { id: record.fact.id, content: record.fact.content },
      provenance: { evidenceId: record.evidence.id },
    };
  }

  private async runStore<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof MemoryStoreUnavailableError) throw new ServiceUnavailableException();
      throw error;
    }
  }
}
```

Later steps add `get()` and `query()` to the same class using the same `runStore` mapping.

- [ ] **Step 4: Run service GREEN**

```bash
pnpm --filter @mdp/api test -- memory.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Expose Prisma client inside infrastructure only**

```ts
get db(): PrismaClient {
  return this.client;
}
```

Do not re-export generated Prisma types from API/domain/contracts packages.

- [ ] **Step 6: Write RED transaction integration test**

Use `createTextMemoryRecord()` with real UUID-v7 IDs. First insert one valid record. Then create a second record with a new Memory/Evidence/Event but reuse the first record's `factId`; the Fact insert must violate its PK after earlier inserts in the same transaction. Assert the second Memory/Evidence/Event are absent after rejection.

```ts
await expect(store.create(conflictingRecord)).rejects.toBeInstanceOf(MemoryStoreUnavailableError);
expect(await prisma.db.memory.findUnique({ where: { id: conflictingRecord.memory.id } })).toBeNull();
expect(await prisma.db.evidence.findUnique({ where: { id: conflictingRecord.evidence.id } })).toBeNull();
expect(await prisma.db.ledgerEvent.findUnique({ where: { id: conflictingRecord.event.id } })).toBeNull();
```

- [ ] **Step 7: Run transaction RED**

```bash
pnpm --filter @mdp/api test:integration -- prisma-memory.store.integration.test.ts
```

Expected: FAIL before store implementation.

- [ ] **Step 8: Implement one atomic Prisma transaction**

```ts
async create(record: TextMemoryRecord): Promise<void> {
  try {
    await this.prisma.db.$transaction(async (tx) => {
      await tx.memory.create({ data: record.memory });
      await tx.evidence.create({ data: record.evidence });
      await tx.ledgerEvent.create({ data: record.event });
      await tx.fact.create({ data: record.fact });
      await tx.currentFact.create({ data: record.currentFact });
    });
  } catch (cause) {
    throw new MemoryStoreUnavailableError({ cause });
  }
}
```

If Prisma requires relation scalar mapping rather than direct object assignment, map scalar fields explicitly but preserve the same five inserts and ordering. Never retry automatically.

- [ ] **Step 9: Run transaction GREEN**

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

### Task 4: Original-memory read and literal deterministic query

**Files:**
- Modify: `apps/api/src/memories/memory.store.ts`
- Modify: `apps/api/src/memories/memory.service.ts`
- Modify: `apps/api/src/memories/memory.service.test.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

- [ ] **Step 1: Write RED retrieval integration tests**

```ts
expect((await store.findLiteral('Ana'))?.content).toBe('Minha irmã se chama Ana.');
expect((await store.findLiteral('SE CHAMA'))?.content).toBe('Minha irmã se chama Ana.');
expect(await store.findLiteral('texto inexistente')).toBeNull();
```

Seed literal-special-character fixtures and assert:

```ts
expect((await store.findLiteral('%'))?.content).toContain('%');
expect((await store.findLiteral('_'))?.content).toContain('_');
```

Seed two matching records with different `recordedAt` and assert the newest is returned. Seed two matching records with equal `recordedAt` and assert lexicographically ascending `factId` is returned.

- [ ] **Step 2: Run retrieval RED**

```bash
pnpm --filter @mdp/api test:integration -- prisma-memory.store.integration.test.ts
```

Expected: FAIL on missing read/query methods.

- [ ] **Step 3: Implement `getById()` preserving original Evidence**

```ts
const row = await this.prisma.db.memory.findUnique({
  where: { id },
  include: { evidence: true, facts: true },
});
if (!row) return null;
const evidence = row.evidence[0];
const fact = row.facts[0];
if (!evidence || !fact) throw new MemoryStoreUnavailableError();
return {
  memory: {
    id: row.id,
    recordedAt: row.recordedAt,
    occurredAt: null,
    temporalPrecision: 'unknown',
  },
  evidence: {
    id: evidence.id,
    memoryId: evidence.memoryId,
    kind: 'text',
    content: evidence.content,
    createdAt: evidence.createdAt,
  },
  fact: {
    id: fact.id,
    memoryId: fact.memoryId,
    evidenceId: fact.evidenceId,
    kind: 'autobiographical_statement',
    content: fact.content,
    createdAt: fact.createdAt,
  },
};
```

Wrap actual Prisma failures as `MemoryStoreUnavailableError`; a genuine absent row remains `null`.

- [ ] **Step 4: Implement exact parameterized literal query**

Do not use `contains`, `LIKE` or `ILIKE`.

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
return rows[0] ?? null;
```

The tagged template must remain parameterized; no string-built SQL.

- [ ] **Step 5: Add service read/query mappings and unit tests**

```ts
async query(query: string): Promise<MemoryQueryResponse> {
  const hit = await this.runStore(() => this.store.findLiteral(query));
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
}
```

`get(id)` maps stored Date values to ISO strings and returns exact Evidence/Fact content; return `null` when the store returns `null`.

- [ ] **Step 6: Run API unit + integration GREEN**

```bash
pnpm --filter @mdp/api test
pnpm --filter @mdp/api test:integration
```

Expected: PASS for case-insensitive substring, literal `%`/`_`, stable ordering, provenance and `UNKNOWN`.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/api/src/memories apps/api/src/infrastructure/persistence/prisma
git commit -m "feat: add deterministic memory retrieval"
```

---

### Task 5: HTTP endpoints and safe database failure mapping

**Files:**
- Create: `apps/api/src/memories/memory.controller.ts`
- Create: `apps/api/src/memories/memory.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/http/api-error.filter.test.ts` only to add regression coverage if needed.

**Interfaces:**
- `POST /memories` -> 201 `CreateMemoryResponse`.
- `GET /memories/:id` -> 200 `GetMemoryResponse`; valid absent UUID -> existing 404 `NOT_FOUND` envelope.
- `GET /query?q=...` -> 200 `MemoryQueryResponse`.
- malformed input/query/id -> 400 validation envelope.
- database connection failure -> 503 `SERVICE_UNAVAILABLE` envelope without leaking internals.

- [ ] **Step 1: Write RED controller tests**

```ts
it('returns 201 without trimming the memory text', async () => {
  memoryService.register = vi.fn().mockResolvedValue(createdResponse);
  await request(app.getHttpServer())
    .post('/memories')
    .send({ text: '  Minha irmã se chama Ana.  ' })
    .expect(201);
  expect(memoryService.register).toHaveBeenCalledWith('  Minha irmã se chama Ana.  ');
});

it('rejects whitespace-only input', async () => {
  await request(app.getHttpServer()).post('/memories').send({ text: '   ' }).expect(400);
});

it('trims query before service call', async () => {
  memoryService.query = vi.fn().mockResolvedValue({ status: 'UNKNOWN', answer: null, provenance: null });
  await request(app.getHttpServer()).get('/query').query({ q: '  Ana  ' }).expect(200);
  expect(memoryService.query).toHaveBeenCalledWith('Ana');
});
```

Also test >4000 text, >200 trimmed query, malformed memory ID, valid missing UUID-v7 -> 404, `FOUND`, `UNKNOWN`, and `MemoryStoreUnavailableError` -> 503.

- [ ] **Step 2: Run controller RED**

```bash
pnpm --filter @mdp/api test -- memory.controller.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement controller with shared validation**

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

For `GET /memories/:id`, use existing `isUuidV7()` before persistence access; malformed IDs are 400, valid absent IDs are 404.

- [ ] **Step 4: Wire providers into `AppModule`**

```ts
const memoryStoreProvider = {
  provide: MEMORY_STORE,
  inject: [PRISMA_SERVICE],
  useFactory: (prisma: PrismaService) => new PrismaMemoryStore(prisma),
};

const memoryServiceProvider = {
  provide: MemoryService,
  inject: [MEMORY_STORE],
  useFactory: (store: MemoryStore) => new MemoryService(store),
};
```

Add MemoryController and providers without removing HealthController/HealthService/PRISMA_SERVICE.

- [ ] **Step 5: Prove safe DB-outage endpoint behavior**

Run API against Compose PostgreSQL, stop PostgreSQL, then call a memory endpoint. Expected HTTP 503 body shape remains:

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Serviço temporariamente indisponível.",
    "requestId": "generated-uuid-v7"
  }
}
```

Assert response does not contain database URL, SQL, stack trace or synthetic Evidence content.

- [ ] **Step 6: Run API regressions**

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
- `createMemory(apiBaseUrl: string, text: string): Promise<CreateMemoryResponse>`.
- `queryMemory(apiBaseUrl: string, query: string): Promise<MemoryQueryResponse>`.

- [ ] **Step 1: Write RED API-client tests**

```ts
it('posts the exact memory string without trimming', async () => {
  global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(createdResponse), { status: 201 }));
  await createMemory('http://api', '  Minha irmã se chama Ana.  ');
  expect(fetch).toHaveBeenCalledWith(
    'http://api/memories',
    expect.objectContaining({ body: JSON.stringify({ text: '  Minha irmã se chama Ana.  ' }) }),
  );
});

it('URL-encodes literal query characters', async () => {
  global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(unknownResponse), { status: 200 }));
  await queryMemory('http://api', '% _ Ana');
  expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain('%25+_+Ana');
});
```

The exact URL assertion may use `URL`/`URLSearchParams` normalization; the requirement is that raw concatenation is not used.

- [ ] **Step 2: Implement minimal typed HTTP client**

```ts
export async function createMemory(apiBaseUrl: string, text: string): Promise<CreateMemoryResponse> {
  const response = await fetch(`${apiBaseUrl}/memories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error('MEMORY_CREATE_FAILED');
  return (await response.json()) as CreateMemoryResponse;
}

export async function queryMemory(apiBaseUrl: string, query: string): Promise<MemoryQueryResponse> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`${apiBaseUrl}/query?${params.toString()}`);
  if (!response.ok) throw new Error('MEMORY_QUERY_FAILED');
  return (await response.json()) as MemoryQueryResponse;
}
```

- [ ] **Step 3: Run API-client GREEN**

```bash
pnpm --filter @mdp/web test -- memory-api.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write RED store-form tests**

```tsx
render(<StoreMemoryForm apiBaseUrl="http://api" />);
const input = screen.getByLabelText('Lembrança');
expect(input).toHaveAttribute('maxlength', '4000');
await userEvent.type(input, 'Minha irmã se chama Ana.');
await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
expect(await screen.findByText('Lembrança guardada.')).toBeInTheDocument();
```

Failure test: reject the API promise and assert an accessible error appears and success does not appear. Do not assert or implement automatic retry.

- [ ] **Step 5: Write RED query-form tests**

```tsx
render(<QueryMemoryForm apiBaseUrl="http://api" />);
expect(screen.getByLabelText('Palavra ou frase')).toHaveAttribute('maxlength', '200');
expect(screen.getByText(/procura palavras ou frases exatamente/i)).toBeInTheDocument();
```

Mock `FOUND` and assert exact statement plus `Fonte: lembrança guardada`. Mock `UNKNOWN` and assert `Não encontrei uma lembrança registrada que corresponda a essa busca.`

- [ ] **Step 6: Implement focused components and keep readiness regression stable**

Required Portuguese labels/copy:

```text
Guardar uma lembrança
Lembrança
Guardar
Lembrança guardada.
Consultar minhas lembranças
Palavra ou frase
Consultar
A busca desta etapa procura palavras ou frases exatamente dentro das lembranças guardadas.
Fonte: lembrança guardada
Não encontrei uma lembrança registrada que corresponda a essa busca.
```

Render store success status conditionally only after a successful POST so the initial page still has exactly the existing Foundation `role="status"` element for `API pronta`. Query results may use an `aria-live="polite"` region without adding another initial `role="status"`.

`App.tsx` retains the existing readiness check and renders feature forms once ready; it does not absorb form/network logic.

- [ ] **Step 7: Add minimal low-cognitive-load CSS**

One-column smartphone-first layout, readable line height, explicit labels, controls at least 44px tall, visible `:focus-visible`, adequate spacing, and no color-only state. Do not add a UI framework.

- [ ] **Step 8: Run web GREEN**

```bash
pnpm --filter @mdp/web test
pnpm --filter @mdp/web typecheck
pnpm --filter @mdp/web build
```

Expected: PASS, including existing App/Foundation assertions.

- [ ] **Step 9: Commit Task 6**

```bash
git add apps/web
git commit -m "feat: add trusted text memory web flow"
```

---

### Task 7: Executable scope invariants, E2E and cumulative acceptance

**Files:**
- Create: `tests/architecture/slice-01-scope.test.ts`
- Create: `tests/e2e/trusted-text-memory.spec.ts`
- Modify: `.github/workflows/ci.yml` only if an earlier required command is not already covered.

- [ ] **Step 1: Write Slice 01 scope test**

```ts
const forbiddenProductDependencies = [
  'pgvector',
  'bullmq',
  'redis',
  'openai',
  '@anthropic-ai',
];

for (const dependency of forbiddenProductDependencies) {
  expect(serializedWorkspaceManifests).not.toContain(`"${dependency}"`);
}
```

Reuse existing `eslint-boundaries.test.ts` for Node/Prisma neutrality. Also assert no Evidence/Ledger update controller/store method is introduced by checking the Slice 01 memory feature exports/routes rather than scanning unrelated third-party text.

- [ ] **Step 2: Run architecture GREEN**

```bash
pnpm exec vitest run tests/architecture
```

Expected: PASS.

- [ ] **Step 3: Write browser E2E RED test**

```ts
import { expect, test } from '@playwright/test';

test('stores and retrieves trusted text with provenance and UNKNOWN fallback', async ({ page, request }) => {
  await expect
    .poll(async () => (await request.get('http://127.0.0.1:3000/health/ready')).status())
    .toBe(200);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API pronta');

  await page.getByLabel('Lembrança').fill('Minha irmã se chama Ana.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Lembrança guardada.')).toBeVisible();

  await page.getByLabel('Palavra ou frase').fill('Ana');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText('Minha irmã se chama Ana.')).toBeVisible();
  await expect(page.getByText('Fonte: lembrança guardada')).toBeVisible();

  await page.getByLabel('Palavra ou frase').fill('texto inexistente 987654321');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText(/Não encontrei uma lembrança registrada/)).toBeVisible();
});
```

- [ ] **Step 4: Run E2E RED then GREEN**

Before feature implementation is complete, the new spec must fail. After Tasks 1–6:

```bash
pnpm e2e
```

Expected: Foundation E2E and Slice 01 E2E both PASS using built web/API and real PostgreSQL.

- [ ] **Step 5: Run complete local acceptance sequence**

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

Expected: every command PASS.

- [ ] **Step 6: Re-run exact table boundary**

```bash
actual="$(docker compose exec -T postgres psql -U mdp -d mdp -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" | sed '/^$/d')"
expected="$(printf '%s\n' _prisma_migrations current_facts evidence facts ledger_events memories)"
test "$actual" = "$expected"
```

Expected: exit 0.

- [ ] **Step 7: Re-run Foundation outage proof**

Start built API with PostgreSQL healthy, capture live/ready 200/200, stop PostgreSQL, capture live/ready 200/503, restart PostgreSQL. No regression from Foundation is allowed.

- [ ] **Step 8: Commit Task 7**

```bash
git add tests .github/workflows/ci.yml
git commit -m "test: prove trusted text memory slice"
```

---

### Task 8: Evidence, MCF PRF, independent review and gate readiness

**Files:**
- Create/update all docs and `artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY/` files listed in File Structure Lock.

**Final allowed state:** `SLICE 01 — IN_REVIEW / READY_FOR_GATE`; never `COMPLETE` in this task.

- [ ] **Step 1: Write project evidence from observed outputs**

`docs/evidence/slice-01/SLICE-01-EVIDENCE-001.md` records mission/boundary, exact HEAD SHA, each acceptance criterion, exact command/procedure, observed result, PASS/FAIL/BLOCKED, artifact/run reference and known limitations. Include rollback, exact-text round trip, literal `%`/`_`, deterministic ordering, provenance, `UNKNOWN`, exact table allowlist, E2E and Foundation outage regression. Use synthetic data only.

- [ ] **Step 2: Create MCF phase traceability pack**

Classify this slice as risk class B because it establishes personal-memory behavior while laboratory evidence remains synthetic.

Required content:

```text
PHASE-01-PLAN.md            approved objective/scope/acceptance/agents/authorization
PHASE-01-REPORT.md          task commits, execution, deviations, failures/recoveries
PHASE-01-VALIDATION.txt     concise command/result matrix
PHASE-01-VALIDATION-FULL.txt safe expanded outputs or exact CI references
PHASE-01-SMOKE.txt          built-app store/query/provenance/UNKNOWN smoke
PHASE-01-CHECKPOINT.yaml    branch, HEAD, state, findings, blockers, next action
PHASE-01-DECISIONS.md       explicit human auth + Option A/spec/review/gate decisions
README.md                   recovery order and result
```

Generate manifest last:

```bash
cd artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY
sha256sum PHASE-01-PLAN.md PHASE-01-REPORT.md PHASE-01-VALIDATION.txt \
  PHASE-01-VALIDATION-FULL.txt PHASE-01-SMOKE.txt PHASE-01-CHECKPOINT.yaml \
  PHASE-01-DECISIONS.md README.md > PHASE-01-ARTIFACT-MANIFEST.sha256
sha256sum -c PHASE-01-ARTIFACT-MANIFEST.sha256
```

Expected: every entry `OK`.

- [ ] **Step 3: Persist review-ready canonical state on the branch**

`docs/STATE.md`, phase record, resume card and checkpoint must state:

```text
Current phase: SLICE 01 — IN_REVIEW
FOUNDATION: COMPLETE
Slice 01: IN_REVIEW
Real data: NOT AUTHORIZED
Pilot: NOT AUTHORIZED
Slice 02: NOT STARTED / NOT AUTHORIZED
```

Include evidence/PRF paths. Do not write `COMPLETE`.

- [ ] **Step 4: Re-run docs-state regression**

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @mdp/api test:integration
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit evidence/review readiness**

```bash
git add docs artifacts
git commit -m "docs: prepare Slice 01 review gate"
```

- [ ] **Step 6: Open exactly one Slice 01 PR**

Title:

```text
SLICE 01: trusted text memory
```

Body includes boundary, spec path, plan path, evidence path, PRF path, HEAD SHA, explicit exclusions, real-data prohibition, and the statement that green CI does not authorize merge.

- [ ] **Step 7: Perform independent full-diff review**

Classify findings Critical / Important / Minor. Fix every Critical and Important finding. For each fix, rerun the directly affected RED/GREEN test plus the complete acceptance sequence, then refresh evidence/PRF so it refers to the final reviewed HEAD.

- [ ] **Step 8: Require canonical PR CI on final reviewed HEAD**

Capture workflow run ID/job ID and require `conclusion: success` on the same reviewed HEAD. Record 0 open Critical and 0 open Important findings in evidence and PR body.

- [ ] **Step 9: Stop before merge at the gate boundary**

Required terminal execution state:

```text
SLICE 01 — IN_REVIEW / READY_FOR_GATE
PR — OPEN / NOT MERGED
Critical findings — 0
Important findings — 0
CI — PASS on final reviewed HEAD
Real data — NOT AUTHORIZED
Slice 02 — NOT STARTED / NOT AUTHORIZED
```

Merge/completion requires the authority defined by current project governance; this implementation plan does not consume that future gate.

---

## Plan Self-Review Checklist

- [ ] All 14 approved acceptance criteria have executable proof.
- [ ] 4000/200 limits are shared, tested and reflected in UI attributes.
- [ ] Leading/trailing memory whitespace round-trips unchanged.
- [ ] `Fact.content === Evidence.content` and CurrentFact equality are executable invariants.
- [ ] Registration rollback is proven using a deliberate mid-transaction PK collision.
- [ ] Query uses parameterized `strpos(lower(...), lower(parameter))`; not `LIKE`, `ILIKE` or Prisma `contains`.
- [ ] `%` and `_` literal behavior is tested.
- [ ] Newest `recordedAt`, then ascending `factId`, is tested.
- [ ] FOUND provenance is tested.
- [ ] UNKNOWN returns no fabricated answer.
- [ ] Evidence/Ledger expose no update path.
- [ ] Foundation zero-table assertion is replaced by the exact five-table Slice 01 allowlist.
- [ ] Foundation health/readiness/outage and browser E2E remain green.
- [ ] No real sensitive data appears in tests, logs, docs or screenshots.
- [ ] Project evidence convention and MCF PRF are both satisfied.
- [ ] Final state is review/gate readiness, not merge/completion.

## Execution Handoff

Recommended execution: **Subagent-Driven Development** — one fresh implementation worker per task, then spec-compliance review and code-quality review before proceeding. Alternative: **Inline Execution** through `superpowers:executing-plans`, preserving the same task checkpoints and gate boundary.
