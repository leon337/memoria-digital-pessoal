# Slice 02 — Correction & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver end-to-end correction and immutable history for deterministic textual memories while preserving original evidence, provenance, current-only normal retrieval, atomicity, and stale-write protection.

**Architecture:** Extend the existing five-model Slice 01 persistence shape rather than introducing a version aggregate or event-sourced rewrite. Corrections append immutable Evidence, Fact, and `MEMORY_CORRECTED` LedgerEvent rows, link each Fact to its predecessor, and atomically reproject the existing CurrentFact under a per-memory PostgreSQL row lock. The PWA reuses the existing `FOUND` query result as the correction/history entry point.

**Tech Stack:** Node.js 24, TypeScript 6, pnpm 10.34.0, React, Vite, NestJS, Prisma, PostgreSQL, Zod, Vitest, Testing Library, Supertest, Playwright, Docker Compose, GitHub Actions.

**Authoritative design:** `docs/superpowers/specs/2026-08-17-slice-02-correction-history-design.md`

## Global Constraints

- **Do not execute this plan until LEANDRO explicitly authorizes Slice 02 implementation.** Approval of this plan/spec is not implementation authorization.
- Use only synthetic laboratory data. Real sensitive data and pilot activity remain unauthorized.
- Branch execution from the latest validated `main` using `slice/02-correction-history`; create an isolated worktree at execution time with `superpowers:using-git-worktrees`.
- Preserve exactly the existing five Prisma product models: `Memory`, `Evidence`, `LedgerEvent`, `Fact`, `CurrentFact`.
- Add no Redis, BullMQ, worker, pgvector, object storage, AI provider, STT/TTS, offline storage, service worker, synchronization, authentication, purge, or other future-slice infrastructure.
- Add no runtime dependency unless a separately approved blocker proves it is required. This plan requires none.
- Correction text normalization is exactly `input.text.trim()`; accepted length is 1–4000 characters.
- Optional reason normalization is exactly `input.reason?.trim()`; empty becomes null/absent; non-empty maximum is 500 characters.
- Normal memory query continues to search only `current_facts` and returns only the current version.
- `CurrentFact.recordedAt` remains the original memory recording timestamp after correction.
- Every accepted correction creates a new Evidence, a new Fact, and a new `MEMORY_CORRECTED` LedgerEvent; historical rows are never overwritten.
- Every correction Fact has `supersedesFactId = immediately previous current fact ID`.
- `facts.supersedes_fact_id` is unique when non-null, preventing persisted history forks.
- `MEMORY_CORRECTED` stores explicit `fact_id`, `supersedes_fact_id`, and optional `reason` columns on `ledger_events`; do not introduce a generic JSON event payload.
- Correction transactions serialize per memory using a lock on the stable `memories` row (`SELECT ... FOR UPDATE`) before the stale-current check.
- Evidence + Fact + LedgerEvent + CurrentFact reprojection commit atomically or all roll back.
- A stale `expectedCurrentFactId` returns HTTP 409 / `STALE_CORRECTION`; no auto-retry or overwrite.
- A no-change correction returns HTTP 422 / `NO_CHANGE`; blank/invalid input returns HTTP 422 for the new correction endpoint.
- PostgreSQL unavailability continues to map to safe HTTP 503 / `SERVICE_UNAVAILABLE`, without leaking SQL or memory content.
- Use TDD for every behavior change: failing test → prove RED → minimal implementation → prove GREEN → focused commit.
- Existing Slice 01 tests and architectural invariants remain cumulative regression requirements.

---

## File Structure Map

### New focused files

- `packages/domain/src/correction.ts` — pure correction construction, normalization, domain errors, and deterministic history ordering.
- `packages/domain/src/correction.test.ts` — correction/history invariant tests.
- `packages/contracts/src/correction.ts` — Zod request/response/history schemas and exported types.
- `packages/contracts/src/correction.test.ts` — correction/history contract tests.
- `apps/api/src/memories/memory.errors.ts` — application errors `StaleCorrectionError`, `NoChangeCorrectionError`, and `MemoryInvariantError`.
- `apps/web/src/features/memory/MemoryFoundResult.tsx` — current result, inline correction, history loading/display, stale-result state, and undo-by-append interaction.
- `apps/web/src/features/memory/MemoryFoundResult.test.tsx` — focused UI behavior tests.
- `tests/architecture/slice-02-scope.test.ts` — no new models/dependencies/future-slice capabilities plus required correction constraints.
- `tests/e2e/correction-history.spec.ts` — browser proof of correction, history, current-only retrieval, and undo-by-append.
- `prisma/migrations/20260817000100_slice_02_correction_history/migration.sql` — Slice 02 schema evolution.
- `docs/phases/SLICE-02.md` — governed boundary state during execution and final gate preparation.
- `docs/evidence/slice-02/SLICE-02-EVIDENCE-001.md` — reproducible acceptance evidence.
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-PLAN.md`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-VALIDATION.txt`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-VALIDATION-FULL.txt`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-SMOKE.txt`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-REPORT.md`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-CHECKPOINT.yaml`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-DECISIONS.md`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/README.md`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-ARTIFACT-MANIFEST.sha256`

### Existing files to modify

- `packages/domain/src/index.ts` — export correction/history domain API.
- `packages/contracts/src/index.ts` — export correction/history schemas/types/constants.
- `prisma/schema.prisma` — Fact self-link and correction-specific LedgerEvent columns/relations.
- `apps/api/src/memories/memory.store.ts` — correction/history store contracts and result types.
- `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts` — locked atomic correction and history reads.
- `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts` — PostgreSQL atomicity/concurrency/history proofs.
- `apps/api/src/memories/memory.service.ts` / `.test.ts` — correction/history orchestration and response mapping.
- `apps/api/src/memories/memory.controller.ts` / `.test.ts` — correction/history endpoints and deterministic HTTP semantics.
- `apps/api/src/common/http/api-error.ts` — add stable `STALE_CORRECTION` and `NO_CHANGE` codes.
- `apps/api/src/common/http/api-error.filter.ts` / `.test.ts` — preserve explicit codes for 409/422.
- `apps/web/src/lib/memory-api.ts` / `.test.ts` — correction/history calls and parsed error code.
- `apps/web/src/features/memory/QueryMemoryForm.tsx` / `.test.tsx` — delegate a `FOUND` result to `MemoryFoundResult` and accept current-result updates.
- `.github/workflows/ci.yml` — add Slice 02 constraint checks, correction outage proof, and final PRF verification without removing Slice 01 checks.
- `docs/STATE.md` / `docs/MDP-RESUME-CARD.md` — only during authorized execution/gate transitions; never mark Slice 02 complete before gate/merge evidence exists.

---

### Task 1: Pure domain correction and deterministic history

**Files:**
- Create: `packages/domain/src/correction.ts`
- Create: `packages/domain/src/correction.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes current fact identity/content/timestamp plus new correction text/reason and generated IDs.
- Produces `createTextCorrectionRecord`, `orderTextFactHistory`, `CorrectionDomainError`, `TextCorrectionRecord`, and `TextFactHistoryNode`.
- No Prisma/Nest/React imports are allowed in `packages/domain`.

- [ ] **Step 1: Write RED tests for normalization, immutable successor construction, no-change, reason limit, and history order**

```ts
import { describe, expect, it } from 'vitest';
import {
  CorrectionDomainError,
  createTextCorrectionRecord,
  orderTextFactHistory,
} from './correction.js';

const correctedAt = new Date('2026-08-17T05:00:00.000Z');
const recordedAt = new Date('2026-08-16T09:00:00.000Z');

it('creates a full-text immutable correction and preserves recordedAt', () => {
  const record = createTextCorrectionRecord({
    memoryId: 'memory-id',
    previous: {
      factId: 'fact-1',
      evidenceId: 'evidence-1',
      content: 'Texto original.',
      recordedAt,
    },
    text: '  Texto corrigido.  ',
    reason: '  informação corrigida  ',
    correctedAt,
    ids: { evidenceId: 'evidence-2', eventId: 'event-2', factId: 'fact-2' },
  });

  expect(record.evidence.content).toBe('Texto corrigido.');
  expect(record.fact.supersedesFactId).toBe('fact-1');
  expect(record.event.type).toBe('MEMORY_CORRECTED');
  expect(record.event.factId).toBe('fact-2');
  expect(record.event.supersedesFactId).toBe('fact-1');
  expect(record.event.reason).toBe('informação corrigida');
  expect(record.currentFact.recordedAt).toBe(recordedAt);
});

it('rejects empty and no-change corrections', () => {
  const base = {
    memoryId: 'memory-id',
    previous: {
      factId: 'fact-1',
      evidenceId: 'evidence-1',
      content: 'Texto atual.',
      recordedAt,
    },
    correctedAt,
    ids: { evidenceId: 'evidence-2', eventId: 'event-2', factId: 'fact-2' },
  } as const;

  expect(() => createTextCorrectionRecord({ ...base, text: '   ' })).toThrow(
    expect.objectContaining<Partial<CorrectionDomainError>>({ code: 'EMPTY_CORRECTION' }),
  );
  expect(() => createTextCorrectionRecord({ ...base, text: ' Texto atual. ' })).toThrow(
    expect.objectContaining<Partial<CorrectionDomainError>>({ code: 'NO_CHANGE' }),
  );
});

it('orders an explicit predecessor chain and marks root/current', () => {
  const ordered = orderTextFactHistory(
    [
      { factId: 'fact-3', evidenceId: 'e3', content: 'C', createdAt: correctedAt, supersedesFactId: 'fact-2' },
      { factId: 'fact-1', evidenceId: 'e1', content: 'A', createdAt: recordedAt, supersedesFactId: null },
      { factId: 'fact-2', evidenceId: 'e2', content: 'B', createdAt: correctedAt, supersedesFactId: 'fact-1' },
    ],
    'fact-3',
  );

  expect(ordered.map((item) => item.factId)).toEqual(['fact-1', 'fact-2', 'fact-3']);
  expect(ordered[0]).toMatchObject({ isOriginal: true, isCurrent: false });
  expect(ordered[2]).toMatchObject({ isOriginal: false, isCurrent: true });
});
```

- [ ] **Step 2: Run the new domain test and prove RED**

```bash
pnpm exec vitest run packages/domain/src/correction.test.ts
```

Expected: FAIL because `correction.ts` and its exports do not exist.

- [ ] **Step 3: Implement the pure domain API minimally**

```ts
export type CorrectionDomainErrorCode =
  | 'EMPTY_CORRECTION'
  | 'NO_CHANGE'
  | 'REASON_TOO_LONG'
  | 'BROKEN_HISTORY';

export class CorrectionDomainError extends Error {
  constructor(readonly code: CorrectionDomainErrorCode) {
    super(code);
    this.name = 'CorrectionDomainError';
  }
}

export interface CreateTextCorrectionRecordInput {
  readonly memoryId: string;
  readonly previous: Readonly<{
    factId: string;
    evidenceId: string;
    content: string;
    recordedAt: Date;
  }>;
  readonly text: string;
  readonly reason?: string;
  readonly correctedAt: Date;
  readonly ids: Readonly<{ evidenceId: string; eventId: string; factId: string }>;
}

export interface TextCorrectionRecord {
  readonly evidence: Readonly<{
    id: string;
    memoryId: string;
    kind: 'text';
    content: string;
    createdAt: Date;
  }>;
  readonly fact: Readonly<{
    id: string;
    memoryId: string;
    evidenceId: string;
    kind: 'autobiographical_statement';
    content: string;
    supersedesFactId: string;
    createdAt: Date;
  }>;
  readonly event: Readonly<{
    id: string;
    memoryId: string;
    evidenceId: string;
    factId: string;
    supersedesFactId: string;
    type: 'MEMORY_CORRECTED';
    reason: string | null;
    createdAt: Date;
  }>;
  readonly currentFact: Readonly<{
    factId: string;
    memoryId: string;
    evidenceId: string;
    content: string;
    recordedAt: Date;
  }>;
}

export interface TextFactHistoryNode {
  readonly factId: string;
  readonly evidenceId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly supersedesFactId: string | null;
}

export function createTextCorrectionRecord(
  input: CreateTextCorrectionRecordInput,
): TextCorrectionRecord {
  const content = input.text.trim();
  if (content.length === 0) throw new CorrectionDomainError('EMPTY_CORRECTION');
  if (content === input.previous.content.trim()) throw new CorrectionDomainError('NO_CHANGE');
  const normalizedReason = input.reason?.trim() ?? '';
  if (normalizedReason.length > 500) throw new CorrectionDomainError('REASON_TOO_LONG');

  return Object.freeze({
    evidence: Object.freeze({
      id: input.ids.evidenceId,
      memoryId: input.memoryId,
      kind: 'text' as const,
      content,
      createdAt: input.correctedAt,
    }),
    fact: Object.freeze({
      id: input.ids.factId,
      memoryId: input.memoryId,
      evidenceId: input.ids.evidenceId,
      kind: 'autobiographical_statement' as const,
      content,
      supersedesFactId: input.previous.factId,
      createdAt: input.correctedAt,
    }),
    event: Object.freeze({
      id: input.ids.eventId,
      memoryId: input.memoryId,
      evidenceId: input.ids.evidenceId,
      factId: input.ids.factId,
      supersedesFactId: input.previous.factId,
      type: 'MEMORY_CORRECTED' as const,
      reason: normalizedReason.length === 0 ? null : normalizedReason,
      createdAt: input.correctedAt,
    }),
    currentFact: Object.freeze({
      factId: input.ids.factId,
      memoryId: input.memoryId,
      evidenceId: input.ids.evidenceId,
      content,
      recordedAt: input.previous.recordedAt,
    }),
  });
}
```

Implement `orderTextFactHistory(nodes, currentFactId)` by requiring exactly one root (`supersedesFactId === null`), exactly one successor per predecessor, no cycle/missing link, all nodes visited once, and final node equal to `currentFactId`; otherwise throw `CorrectionDomainError('BROKEN_HISTORY')`.

- [ ] **Step 4: Export the new domain API from `packages/domain/src/index.ts`**

```ts
export {
  CorrectionDomainError,
  createTextCorrectionRecord,
  orderTextFactHistory,
} from './correction.js';
export type {
  CorrectionDomainErrorCode,
  CreateTextCorrectionRecordInput,
  TextCorrectionRecord,
  TextFactHistoryNode,
} from './correction.js';
```

Keep the existing Slice 01 exports intact.

- [ ] **Step 5: Run focused and cumulative domain tests**

```bash
pnpm exec vitest run packages/domain/src/correction.test.ts packages/domain/src/memory.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the domain slice**

```bash
git add packages/domain/src/correction.ts packages/domain/src/correction.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): model append-only memory correction"
```

---

### Task 2: Correction/history contracts and stable API error codes

**Files:**
- Create: `packages/contracts/src/correction.ts`
- Create: `packages/contracts/src/correction.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/common/http/api-error.ts`
- Modify: `apps/api/src/common/http/api-error.filter.ts`
- Modify: `apps/api/src/common/http/api-error.filter.test.ts`

**Interfaces:**
- Produces `correctMemoryRequestSchema`, `correctMemoryResponseSchema`, `memoryHistoryResponseSchema` and inferred TS types.
- Produces API codes `STALE_CORRECTION` and `NO_CHANGE` while retaining existing envelope shape `{ error: { code, message, requestId } }`.

- [ ] **Step 1: Write RED contract tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  correctMemoryRequestSchema,
  correctMemoryResponseSchema,
  memoryHistoryResponseSchema,
} from './correction.js';

it('normalizes correction text and optional reason', () => {
  expect(
    correctMemoryRequestSchema.parse({
      text: '  Corrigido.  ',
      expectedCurrentFactId: '0198c000-0000-7000-8000-000000000001',
      reason: '  ajuste  ',
    }),
  ).toEqual({
    text: 'Corrigido.',
    expectedCurrentFactId: '0198c000-0000-7000-8000-000000000001',
    reason: 'ajuste',
  });
});

it('rejects blank/oversized correction text and oversized reason', () => {
  expect(correctMemoryRequestSchema.safeParse({ text: '   ', expectedCurrentFactId: 'id' }).success).toBe(false);
  expect(correctMemoryRequestSchema.safeParse({ text: 'x'.repeat(4001), expectedCurrentFactId: 'id' }).success).toBe(false);
  expect(correctMemoryRequestSchema.safeParse({ text: 'ok', expectedCurrentFactId: 'id', reason: 'x'.repeat(501) }).success).toBe(false);
});
```

Add response/history parsing tests with the exact fields from the approved spec, including non-empty `versions` checked after parsing in service/controller tests.

- [ ] **Step 2: Prove RED**

```bash
pnpm exec vitest run packages/contracts/src/correction.test.ts
```

Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Implement the schemas**

```ts
import { z } from 'zod';
import { MEMORY_TEXT_MAX_LENGTH } from './memory.js';

export const CORRECTION_REASON_MAX_LENGTH = 500;

export const correctMemoryRequestSchema = z.object({
  text: z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(MEMORY_TEXT_MAX_LENGTH)),
  expectedCurrentFactId: z.string().min(1),
  reason: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(CORRECTION_REASON_MAX_LENGTH))
    .optional(),
});

export const correctMemoryResponseSchema = z.object({
  memoryId: z.string(),
  current: z.object({
    factId: z.string(),
    evidenceId: z.string(),
    content: z.string(),
    recordedAt: z.string(),
    correctedAt: z.string(),
  }),
  correction: z.object({
    eventId: z.string(),
    supersedesFactId: z.string(),
    reason: z.string().nullable(),
  }),
});

export const memoryHistoryVersionSchema = z.object({
  factId: z.string(),
  evidenceId: z.string(),
  content: z.string(),
  createdAt: z.string(),
  reason: z.string().nullable(),
  isOriginal: z.boolean(),
  isCurrent: z.boolean(),
  supersedesFactId: z.string().nullable(),
  eventId: z.string(),
});

export const memoryHistoryResponseSchema = z.object({
  memoryId: z.string(),
  versions: z.array(memoryHistoryVersionSchema).min(1),
});

export type CorrectMemoryRequest = z.infer<typeof correctMemoryRequestSchema>;
export type CorrectMemoryResponse = z.infer<typeof correctMemoryResponseSchema>;
export type MemoryHistoryResponse = z.infer<typeof memoryHistoryResponseSchema>;
export type MemoryHistoryVersion = z.infer<typeof memoryHistoryVersionSchema>;
```

- [ ] **Step 4: Export contracts and extend the API error union**

```ts
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'STALE_CORRECTION'
  | 'NO_CHANGE'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';
```

Use a small coded exception helper in `api-error.ts`:

```ts
import { HttpException } from '@nestjs/common';

export class CodedHttpException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    status: number,
    readonly safeMessage: string,
  ) {
    super(safeMessage, status);
  }
}
```

Teach `ApiErrorFilter` to detect `CodedHttpException` before generic `HttpException` and emit its `code`/`safeMessage` without leaking causes.

- [ ] **Step 5: Add filter tests for 409/422 codes and run focused tests**

```bash
pnpm build:packages
pnpm exec vitest run packages/contracts/src/correction.test.ts apps/api/src/common/http/api-error.filter.test.ts
```

Expected: PASS and existing validation/not-found/503 envelope tests remain green.

- [ ] **Step 6: Commit contracts/error envelope**

```bash
git add packages/contracts/src/correction.ts packages/contracts/src/correction.test.ts packages/contracts/src/index.ts apps/api/src/common/http/api-error.ts apps/api/src/common/http/api-error.filter.ts apps/api/src/common/http/api-error.filter.test.ts
git commit -m "feat(contracts): define correction and history API"
```

---

### Task 3: Prisma schema, migration, and scope constraints

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260817000100_slice_02_correction_history/migration.sql`
- Create: `tests/architecture/slice-02-scope.test.ts`

**Interfaces:**
- Produces nullable `Fact.supersedesFactId` self-link with unique predecessor constraint.
- Produces correction-specific `LedgerEvent.factId`, `LedgerEvent.supersedesFactId`, `LedgerEvent.reason`.
- Preserves all existing Slice 01 rows and exactly five product models/tables.

- [ ] **Step 1: Write RED architecture tests for required fields and forbidden scope**

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

it('adds correction linkage without adding product models', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]).sort();
  expect(models).toEqual(['CurrentFact', 'Evidence', 'Fact', 'LedgerEvent', 'Memory']);
  expect(schema).toContain('supersedesFactId');
  expect(schema).toContain('reason');
});

it('keeps future-slice infrastructure out', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const names = [...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})].map((name) => name.toLowerCase());
  for (const forbidden of ['openai', 'anthropic', 'pgvector', 'redis', 'bullmq']) expect(names).not.toContain(forbidden);
});
```

- [ ] **Step 2: Prove RED**

```bash
pnpm exec vitest run tests/architecture/slice-02-scope.test.ts
```

Expected: FAIL because correction fields do not exist.

- [ ] **Step 3: Modify Prisma relations**

Use named relations to avoid ambiguity. The Fact model must include semantic equivalents of:

```prisma
supersedesFactId String? @unique @map("supersedes_fact_id") @db.Uuid
supersedes       Fact?   @relation("FactSupersession", fields: [supersedesFactId], references: [id], onDelete: Restrict)
successor        Fact?   @relation("FactSupersession")
newFactEvents    LedgerEvent[] @relation("CorrectionNewFact")
supersededEvents LedgerEvent[] @relation("CorrectionPreviousFact")
```

The LedgerEvent model must include:

```prisma
factId            String? @map("fact_id") @db.Uuid
supersedesFactId  String? @map("supersedes_fact_id") @db.Uuid
reason            String? @db.VarChar(500)
fact              Fact?   @relation("CorrectionNewFact", fields: [factId], references: [id], onDelete: Restrict)
supersedesFact    Fact?   @relation("CorrectionPreviousFact", fields: [supersedesFactId], references: [id], onDelete: Restrict)

@@index([factId])
@@index([supersedesFactId])
```

- [ ] **Step 4: Write the versioned SQL migration explicitly**

```sql
ALTER TABLE "facts" ADD COLUMN "supersedes_fact_id" UUID;
CREATE UNIQUE INDEX "facts_supersedes_fact_id_key" ON "facts"("supersedes_fact_id");
ALTER TABLE "facts"
  ADD CONSTRAINT "facts_supersedes_fact_id_fkey"
  FOREIGN KEY ("supersedes_fact_id") REFERENCES "facts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_events" ADD COLUMN "fact_id" UUID;
ALTER TABLE "ledger_events" ADD COLUMN "supersedes_fact_id" UUID;
ALTER TABLE "ledger_events" ADD COLUMN "reason" VARCHAR(500);
CREATE INDEX "ledger_events_fact_id_idx" ON "ledger_events"("fact_id");
CREATE INDEX "ledger_events_supersedes_fact_id_idx" ON "ledger_events"("supersedes_fact_id");
ALTER TABLE "ledger_events"
  ADD CONSTRAINT "ledger_events_fact_id_fkey"
  FOREIGN KEY ("fact_id") REFERENCES "facts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_events"
  ADD CONSTRAINT "ledger_events_supersedes_fact_id_fkey"
  FOREIGN KEY ("supersedes_fact_id") REFERENCES "facts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_events"
  ADD CONSTRAINT "ledger_events_memory_corrected_fact_links_check"
  CHECK (
    "type" <> 'MEMORY_CORRECTED'
    OR ("fact_id" IS NOT NULL AND "supersedes_fact_id" IS NOT NULL)
  );
```

- [ ] **Step 5: Validate/generate/migrate against PostgreSQL and rerun architecture tests**

```bash
docker compose up -d postgres
export DATABASE_URL='postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp'
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
pnpm exec vitest run tests/architecture/slice-01-scope.test.ts tests/architecture/slice-02-scope.test.ts
```

Expected: PASS; no sixth product model/table appears.

- [ ] **Step 6: Commit schema evolution**

```bash
git add prisma/schema.prisma prisma/migrations/20260817000100_slice_02_correction_history/migration.sql tests/architecture/slice-02-scope.test.ts
git commit -m "feat(db): add correction lineage constraints"
```

---

### Task 4: Atomic PostgreSQL correction and deterministic history store

**Files:**
- Modify: `apps/api/src/memories/memory.store.ts`
- Create: `apps/api/src/memories/memory.errors.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

**Interfaces:**

Add to `MemoryStore`:

```ts
correct(input: CorrectMemoryStoreInput): Promise<CorrectMemoryStoreResult>;
history(memoryId: string): Promise<StoredMemoryHistory | null>;
```

Use these shapes:

```ts
export interface CorrectMemoryStoreInput {
  memoryId: string;
  expectedCurrentFactId: string;
  text: string;
  reason?: string;
  correctedAt: Date;
  ids: { evidenceId: string; eventId: string; factId: string };
}

export type CorrectMemoryStoreResult =
  | { status: 'CORRECTED'; record: TextCorrectionRecord }
  | { status: 'NOT_FOUND' }
  | { status: 'STALE'; currentFactId: string };

export interface StoredHistoryVersion {
  factId: string;
  evidenceId: string;
  content: string;
  createdAt: Date;
  reason: string | null;
  supersedesFactId: string | null;
  eventId: string;
  isOriginal: boolean;
  isCurrent: boolean;
}

export interface StoredMemoryHistory {
  memoryId: string;
  versions: StoredHistoryVersion[];
}
```

- [ ] **Step 1: Extend the integration test with RED correction/atomicity/concurrency/history cases**

Add tests that prove:

```ts
it('corrects atomically while preserving original rows and recordedAt', async () => {
  const original = buildRecord({ text: 'Texto original.' });
  await store.create(original);
  const correctedAt = new Date('2026-08-17T05:00:00.000Z');

  const result = await store.correct({
    memoryId: original.memory.id,
    expectedCurrentFactId: original.fact.id,
    text: ' Texto corrigido. ',
    reason: ' ajuste ',
    correctedAt,
    ids: { evidenceId: createId(), eventId: createId(), factId: createId() },
  });

  expect(result.status).toBe('CORRECTED');
  expect(await counts()).toEqual([1, 2, 2, 2, 1]);
  const current = await store.findLiteral('corrigido');
  expect(current?.recordedAt).toEqual(original.memory.recordedAt);
  await expect(store.findLiteral('original')).resolves.toBeNull();
});
```

Add a `Promise.allSettled` race with two corrections sharing the same `expectedCurrentFactId`; assert exactly one `CORRECTED` and exactly one `STALE`.

Add a trigger that fails `BEFORE UPDATE ON current_facts`; assert counts remain `[1,1,1,1,1]` after failed correction.

Add history assertions for original-only, multi-correction order, reason/event IDs, and current tip.

- [ ] **Step 2: Prove RED on real PostgreSQL**

```bash
export DATABASE_URL='postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp'
pnpm build:packages
pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts
```

Expected: new correction/history tests FAIL.

- [ ] **Step 3: Implement `correct()` with per-memory serialization**

Inside the existing `withAvailabilityMapping` and `client.$transaction`:

```ts
const locked = await tx.$queryRaw<Array<{ id: string }>>`
  SELECT id FROM memories WHERE id = ${input.memoryId}::uuid FOR UPDATE
`;
if (locked.length === 0) return { status: 'NOT_FOUND' as const };

const current = await tx.currentFact.findFirst({ where: { memoryId: input.memoryId } });
if (!current) throw new MemoryInvariantError('missing current fact');
if (current.factId !== input.expectedCurrentFactId) {
  return { status: 'STALE' as const, currentFactId: current.factId };
}

const record = createTextCorrectionRecord({
  memoryId: input.memoryId,
  previous: {
    factId: current.factId,
    evidenceId: current.evidenceId,
    content: current.content,
    recordedAt: current.recordedAt,
  },
  text: input.text,
  reason: input.reason,
  correctedAt: input.correctedAt,
  ids: input.ids,
});
```

Then insert `record.evidence`, `record.fact`, `record.event`, and update the existing CurrentFact row in the same transaction. Update by the old `factId` and assert one row changed so the projection cannot silently duplicate.

- [ ] **Step 4: Implement `history()` using explicit lineage, not timestamps**

Load all facts for the memory, current fact, evidence, and ledger events required for provenance. Feed fact nodes to `orderTextFactHistory`. Map the ordered nodes to `StoredHistoryVersion` by matching corrected Fact IDs to `MEMORY_CORRECTED.factId`; map the root creation event through the root evidence ID and `MEMORY_CREATED`. Throw `MemoryInvariantError` for missing/duplicate event provenance or cross-memory inconsistencies.

- [ ] **Step 5: Ensure unavailability mapping still covers correction/history paths**

Do not duplicate connection-error logic. Both methods must be wrapped by the existing `withAvailabilityMapping`, preserving P1001/P1002/P1008/P1017/P2024/P2037/ECONNREFUSED/ECONNRESET/57P01/57P02/57P03 behavior.

- [ ] **Step 6: Run integration + domain regression**

```bash
pnpm build:packages
pnpm exec vitest run packages/domain/src/correction.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit persistence boundary**

```bash
git add apps/api/src/memories/memory.store.ts apps/api/src/memories/memory.errors.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts
git commit -m "feat(api): persist atomic memory corrections"
```

---

### Task 5: Memory service and HTTP endpoints

**Files:**
- Modify: `apps/api/src/memories/memory.service.ts`
- Modify: `apps/api/src/memories/memory.service.test.ts`
- Modify: `apps/api/src/memories/memory.controller.ts`
- Modify: `apps/api/src/memories/memory.controller.test.ts`

**Interfaces:**
- Service: `correct(memoryId: string, request: CorrectMemoryRequest): Promise<CorrectMemoryResponse>`.
- Service: `history(memoryId: string): Promise<MemoryHistoryResponse | null>`.
- HTTP: `POST /memories/:memoryId/corrections` and `GET /memories/:memoryId/history`.

- [ ] **Step 1: Write RED service tests**

```ts
it('uses one clock read and three IDs for a correction', async () => {
  const correct = vi.fn<MemoryStore['correct']>().mockResolvedValue({
    status: 'CORRECTED',
    record: correctionRecordFixture,
  });
  const now = vi.fn(() => new Date('2026-08-17T05:00:00.000Z'));
  const ids = ['evidence-2', 'event-2', 'fact-2'];
  const service = new MemoryService({ store: makeStore({ correct }), now, createId: () => ids.shift() ?? 'bad' });

  const response = await service.correct('memory-id', {
    text: 'Corrigido.',
    expectedCurrentFactId: 'fact-1',
    reason: 'ajuste',
  });

  expect(now).toHaveBeenCalledTimes(1);
  expect(correct).toHaveBeenCalledTimes(1);
  expect(response.current.factId).toBe('fact-2');
  expect(response.correction.supersedesFactId).toBe('fact-1');
});
```

Add tests that `STALE` becomes `StaleCorrectionError`, `NOT_FOUND` becomes a not-found result/error used by controller, `CorrectionDomainError('NO_CHANGE')` becomes `NoChangeCorrectionError`, and history maps Date fields to ISO strings.

- [ ] **Step 2: Write RED controller tests for status/code semantics**

Add Supertest cases for:

```text
POST success -> 201
malformed memoryId -> 400 VALIDATION_FAILED
malformed expectedCurrentFactId -> 422 VALIDATION_FAILED
blank/oversized text -> 422 VALIDATION_FAILED
reason > 500 -> 422 VALIDATION_FAILED
missing memory -> 404 NOT_FOUND
stale -> 409 STALE_CORRECTION
no change -> 422 NO_CHANGE
store down -> 503 SERVICE_UNAVAILABLE
GET history success -> 200
GET missing history -> 404 NOT_FOUND
```

- [ ] **Step 3: Prove RED**

```bash
pnpm build:packages
pnpm exec vitest run apps/api/src/memories/memory.service.test.ts apps/api/src/memories/memory.controller.test.ts
```

Expected: new cases FAIL.

- [ ] **Step 4: Implement service mapping without persistence leakage**

Generate `correctedAt` and exactly three IDs in the service; call `store.correct`; map the returned domain record to the contract. Do not expose Prisma types.

- [ ] **Step 5: Implement controller endpoints and coded errors**

Controller logic for correction must validate both `memoryId` and `expectedCurrentFactId` with existing `isUuidV7`. Parse body with `correctMemoryRequestSchema`. Use `CodedHttpException('STALE_CORRECTION', 409, 'A lembrança mudou desde a última consulta.')` and `CodedHttpException('NO_CHANGE', 422, 'A correção não altera o texto atual.')`. Use `CodedHttpException('VALIDATION_FAILED', 422, 'Os dados enviados são inválidos.')` for correction-body validation so this new endpoint follows the approved 422 contract while existing Slice 01 validation remains 400.

- [ ] **Step 6: Run API tests and full existing controller regression**

```bash
pnpm build:packages
pnpm exec vitest run apps/api/src/memories/memory.service.test.ts apps/api/src/memories/memory.controller.test.ts apps/api/src/common/http/api-error.filter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit application/API boundary**

```bash
git add apps/api/src/memories/memory.service.ts apps/api/src/memories/memory.service.test.ts apps/api/src/memories/memory.controller.ts apps/api/src/memories/memory.controller.test.ts
git commit -m "feat(api): expose memory correction and history"
```

---

### Task 6: Typed web API client with stable error codes and no retry

**Files:**
- Modify: `apps/web/src/lib/memory-api.ts`
- Modify: `apps/web/src/lib/memory-api.test.ts`

**Interfaces:**
- `correctMemory(baseUrl, memoryId, request): Promise<CorrectMemoryResponse>`.
- `getMemoryHistory(baseUrl, memoryId): Promise<MemoryHistoryResponse>`.
- `MemoryApiError` gains `code: ApiErrorCode | null` while preserving `status`.

- [ ] **Step 1: Write RED client tests**

```ts
it('posts one correction request without retry', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response(correctResponseFixture, 201));
  vi.stubGlobal('fetch', fetchMock);

  await correctMemory('http://api/', 'memory-id', {
    text: 'Corrigido.',
    expectedCurrentFactId: 'fact-1',
    reason: 'ajuste',
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('http://api/memories/memory-id/corrections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Corrigido.', expectedCurrentFactId: 'fact-1', reason: 'ajuste' }),
  });
});

it('preserves STALE_CORRECTION without retrying', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({ error: { code: 'STALE_CORRECTION', message: 'changed', requestId: 'r1' } }, 409));
  vi.stubGlobal('fetch', fetchMock);
  await expect(correctMemory('http://api', 'memory-id', { text: 'B', expectedCurrentFactId: 'fact-1' })).rejects.toEqual(
    expect.objectContaining({ status: 409, code: 'STALE_CORRECTION' }),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

Add history GET parsing test.

- [ ] **Step 2: Prove RED**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/lib/memory-api.test.ts
```

Expected: FAIL because methods/error code parsing do not exist.

- [ ] **Step 3: Implement one shared response-error parser**

Parse the existing error envelope defensively; if parsing fails, keep `code = null`. Never retry automatically.

- [ ] **Step 4: Implement `correctMemory` and `getMemoryHistory` with contract schemas**

Use `correctMemoryResponseSchema.parse(await response.json())` and `memoryHistoryResponseSchema.parse(await response.json())` for successful responses.

- [ ] **Step 5: Run focused web client tests**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/lib/memory-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit web client**

```bash
git add apps/web/src/lib/memory-api.ts apps/web/src/lib/memory-api.test.ts
git commit -m "feat(web): add correction and history client"
```

---

### Task 7: Inline correction in a found query result

**Files:**
- Create: `apps/web/src/features/memory/MemoryFoundResult.tsx`
- Create: `apps/web/src/features/memory/MemoryFoundResult.test.tsx`
- Modify: `apps/web/src/features/memory/QueryMemoryForm.tsx`
- Modify: `apps/web/src/features/memory/QueryMemoryForm.test.tsx`

**Interfaces:**

```ts
type FoundResult = Extract<MemoryQueryResponse, { status: 'FOUND' }>;

interface MemoryFoundResultProps {
  apiBaseUrl: string;
  result: FoundResult;
  onCurrentChange: (next: FoundResult) => void;
}
```

- [ ] **Step 1: Write RED UI tests for opening, cancelling, saving, and stale behavior**

Mock `correctMemory` and `getMemoryHistory` from `memory-api.js`. Prove:

```ts
expect(screen.getByRole('button', { name: 'Corrigir' })).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: 'Corrigir' }));
expect(screen.getByLabelText('Texto corrigido')).toHaveValue('Minha irmã se chama Ana.');
expect(screen.getByLabelText('Motivo da correção (opcional)')).toBeInTheDocument();
```

On successful save, assert `correctMemory` receives the currently displayed `factId`, the form closes, visible text changes immediately, and success status is announced.

For `MemoryApiError(409, 'STALE_CORRECTION')`, assert a stale warning appears, no auto-retry occurs, and the old result no longer exposes an enabled `Corrigir` action until QueryMemoryForm receives a fresh query result.

- [ ] **Step 2: Prove RED**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/memory/MemoryFoundResult.test.tsx apps/web/src/features/memory/QueryMemoryForm.test.tsx
```

Expected: FAIL because `MemoryFoundResult` does not exist.

- [ ] **Step 3: Implement `MemoryFoundResult` correction state**

Use local state for `editing`, `text`, `reason`, `saving`, `feedback`, and `stale`. Prefill `text` from `result.answer` every time a fresh `result.provenance.factId` arrives. Use `maxLength={MEMORY_TEXT_MAX_LENGTH}` and `maxLength={CORRECTION_REASON_MAX_LENGTH}`.

On success construct the next FOUND result exactly as:

```ts
const next: FoundResult = {
  status: 'FOUND',
  answer: response.current.content,
  provenance: {
    memoryId: response.memoryId,
    evidenceId: response.current.evidenceId,
    factId: response.current.factId,
  },
};
onCurrentChange(next);
```

- [ ] **Step 4: Delegate `FOUND` rendering from QueryMemoryForm**

Replace the current inline result block with `MemoryFoundResult`. Keep QueryMemoryForm owning query text/loading/error/result and update its result when the child calls `onCurrentChange`.

- [ ] **Step 5: Run focused UI tests and existing StoreMemoryForm regression**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/memory/MemoryFoundResult.test.tsx apps/web/src/features/memory/QueryMemoryForm.test.tsx apps/web/src/features/memory/StoreMemoryForm.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit inline correction UI**

```bash
git add apps/web/src/features/memory/MemoryFoundResult.tsx apps/web/src/features/memory/MemoryFoundResult.test.tsx apps/web/src/features/memory/QueryMemoryForm.tsx apps/web/src/features/memory/QueryMemoryForm.test.tsx
git commit -m "feat(web): correct found memories inline"
```

---

### Task 8: Inline history, undo-by-append, and browser E2E

**Files:**
- Modify: `apps/web/src/features/memory/MemoryFoundResult.tsx`
- Modify: `apps/web/src/features/memory/MemoryFoundResult.test.tsx`
- Create: `tests/e2e/correction-history.spec.ts`

**Interfaces:**
- `Ver histórico` loads `GET /memories/:memoryId/history` on demand.
- `Usar este texto como nova correção` copies historical text into the normal correction form while retaining the **current displayed** `factId` as `expectedCurrentFactId`.

- [ ] **Step 1: Write RED UI history/undo tests**

Prove original-to-current labels, optional reason display, history loading error, and undo prefill. Critical assertion:

```ts
await user.click(screen.getByRole('button', { name: 'Usar este texto como nova correção' }));
expect(screen.getByLabelText('Texto corrigido')).toHaveValue('Texto original.');
await user.click(screen.getByRole('button', { name: 'Salvar correção' }));
expect(correctMemoryMock).toHaveBeenLastCalledWith(
  'http://api',
  'memory-id',
  expect.objectContaining({
    text: 'Texto original.',
    expectedCurrentFactId: 'fact-current',
  }),
);
```

- [ ] **Step 2: Implement history rendering**

Render each version with full text, timestamp, `Original` and/or `Atual` labels, source/provenance, and reason when non-null. Do not infer order in the browser; render server order.

- [ ] **Step 3: Run UI tests GREEN**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/memory/MemoryFoundResult.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Write the Playwright E2E scenario**

The test must use synthetic text and prove this exact user-visible flow:

```text
store "Minha irmã sintética se chama Ana."
query "Ana" -> FOUND
Corrigir -> "Minha irmã sintética se chama Beatriz."
visible result updates to Beatriz
query "Ana" -> UNKNOWN
query "Beatriz" -> FOUND
Ver histórico -> original then correction
Usar texto original como nova correção
save -> visible current becomes Ana again
Ver histórico -> three versions remain present in order
```

Also assert the laboratory warning remains visible.

- [ ] **Step 5: Run browser E2E with real API/PostgreSQL**

```bash
export DATABASE_URL='postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp'
pnpm build
pnpm e2e -- correction-history.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit history/E2E**

```bash
git add apps/web/src/features/memory/MemoryFoundResult.tsx apps/web/src/features/memory/MemoryFoundResult.test.tsx tests/e2e/correction-history.spec.ts
git commit -m "feat(web): show immutable memory history"
```

---

### Task 9: Full regression, CI proofs, PRF/evidence, and gate-ready documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create/update: Slice 02 phase/evidence/PRF files listed in the File Structure Map.
- Modify only when execution is authorized: `docs/STATE.md`, `docs/MDP-RESUME-CARD.md`.

**Interfaces:**
- Produces reproducible evidence for review/audit/gate.
- Does **not** merge, mark `ENTREGUE`, authorize real data, start pilot, or start Slice 03.

- [ ] **Step 1: Run the complete local validation before changing evidence docs**

```bash
export DATABASE_URL='postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp'
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm e2e
```

Expected: every command PASS; existing Slice 01 E2E and new Slice 02 E2E both pass.

- [ ] **Step 2: Extend CI with Slice 02 structural constraints without removing Slice 01 checks**

After migration, add psql assertions that:

```text
facts.supersedes_fact_id exists and has a unique index
ledger_events.fact_id exists
ledger_events.supersedes_fact_id exists
ledger_events.reason is varchar(500)
ledger_events_memory_corrected_fact_links_check exists
```

Keep the exact table allowlist `current_facts,evidence,facts,ledger_events,memories` unchanged.

- [ ] **Step 3: Extend the real database-outage proof to correction**

While PostgreSQL is healthy, create a synthetic memory and parse `memory.id` / `fact.id`. Stop PostgreSQL, POST a correction using those IDs, and assert:

```text
HTTP 503
error.code == SERVICE_UNAVAILABLE
response does not contain memory text
response does not contain SQL details
```

Do not remove the existing live/ready/create outage assertions.

- [ ] **Step 4: Create Slice 02 PRF/evidence artifacts from actual command output**

`PHASE-02-VALIDATION.txt` records focused boundary commands; `PHASE-02-VALIDATION-FULL.txt` records the full regression command set; `PHASE-02-SMOKE.txt` records the deterministic E2E/outage smoke evidence. `PHASE-02-REPORT.md` maps every acceptance criterion to exact test/file/run evidence. `PHASE-02-CHECKPOINT.yaml` must state the current gate state truthfully (`IN_REVIEW`, `READY_FOR_GATE`, or equivalent only when evidence supports it).

- [ ] **Step 5: Generate the SHA-256 manifest only after all PRF contents are final**

```bash
cd artifacts/phases/SLICE-02-CORRECTION-HISTORY
sha256sum PHASE-02-PLAN.md PHASE-02-REPORT.md PHASE-02-VALIDATION.txt PHASE-02-VALIDATION-FULL.txt PHASE-02-SMOKE.txt PHASE-02-CHECKPOINT.yaml PHASE-02-DECISIONS.md README.md > PHASE-02-ARTIFACT-MANIFEST.sha256
sha256sum -c PHASE-02-ARTIFACT-MANIFEST.sha256
```

Expected: every file `OK`.

- [ ] **Step 6: Add CI verification for the final Slice 02 manifest**

Add a separate step after the existing Slice 01 manifest verification:

```yaml
- name: Verify Slice 02 PRF manifest
  working-directory: artifacts/phases/SLICE-02-CORRECTION-HISTORY
  run: sha256sum -c PHASE-02-ARTIFACT-MANIFEST.sha256
```

- [ ] **Step 7: Update canonical docs only to the evidence-supported pre-gate state**

During authorized implementation, `docs/STATE.md` may move Slice 02 from `NOT STARTED / NOT AUTHORIZED` to the accurate active/review state. Before human gate/merge it must **not** say `COMPLETE`, `ENTREGUE`, `MERGED`, `POST-MERGE VALIDATED`, real data authorized, pilot authorized, or Slice 03 authorized.

- [ ] **Step 8: Run full validation again after docs/workflow changes**

```bash
pnpm prisma:validate
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm e2e
cd artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY && sha256sum -c PHASE-01-ARTIFACT-MANIFEST.sha256
cd ../SLICE-02-CORRECTION-HISTORY && sha256sum -c PHASE-02-ARTIFACT-MANIFEST.sha256
```

Expected: PASS.

- [ ] **Step 9: Commit evidence/gate preparation**

```bash
git add .github/workflows/ci.yml docs/STATE.md docs/MDP-RESUME-CARD.md docs/phases/SLICE-02.md docs/evidence/slice-02 artifacts/phases/SLICE-02-CORRECTION-HISTORY
git commit -m "docs: prepare Slice 02 gate evidence"
```

- [ ] **Step 10: Push branch/open or update the Slice 02 PR and wait for fresh CI/review evidence**

Do not interpret green CI as merge authorization. Resolve all BLOCKER/REQUIRED_FOR_ACCEPTANCE findings, obtain the required independent audit/internal gate under the current MCF rules, then escalate HUMAN_GATE only to LEANDRO if integration/completion requires it.

---

## Plan Self-Review Checklist

Before implementation begins, the executor must confirm:

- [ ] Every approved design requirement maps to a task above.
- [ ] No task introduces a sixth product model/table.
- [ ] No task introduces future-slice infrastructure or dependencies.
- [ ] Correction validation is deterministic trim/length only; no semantic/AI usefulness judgment.
- [ ] CurrentFact recorded time remains stable.
- [ ] History order comes from predecessor links, never timestamp sorting.
- [ ] Concurrent same-base corrections cannot both succeed.
- [ ] No-change, stale, rollback, and database-outage paths have executable tests.
- [ ] Undo is implemented by appending a new correction using old content and the current fact as concurrency base.
- [ ] `FOUND`/`UNKNOWN` Slice 01 semantics remain cumulative regression contracts.
- [ ] Real data, pilot, Slice 03, AI, offline, sync, deletion/purge remain unauthorized/out of scope.
- [ ] Final evidence docs describe only what fresh tests/CI actually prove.

## Execution Boundary

This plan is a **planning artifact only**. Its existence and approval do not authorize code execution. Once LEANDRO explicitly authorizes Slice 02 implementation, use one of the approved execution workflows and preserve the TDD/review/gate sequence above.
