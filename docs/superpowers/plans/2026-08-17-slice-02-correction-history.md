# Slice 02 — Correction & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver end-to-end correction and immutable history for deterministic textual memories while preserving original evidence, provenance, current-only normal retrieval, atomicity, and stale-write protection.

**Architecture:** Keep the existing five-model Slice 01 architecture. A correction appends immutable Evidence, Fact, and `MEMORY_CORRECTED` LedgerEvent rows, links the new Fact to the immediately previous Fact, and atomically reprojects the existing CurrentFact while holding a PostgreSQL lock on the stable Memory row. History is reconstructed from explicit Fact predecessor links; the PWA exposes correction/history only from an existing `FOUND` query result.

**Tech Stack:** Node.js 24, TypeScript 6, pnpm 10.34.0, React, Vite, NestJS, Prisma, PostgreSQL, Zod, Vitest, Testing Library, Supertest, Playwright, Docker Compose, GitHub Actions.

**Authoritative design:** `docs/superpowers/specs/2026-08-17-slice-02-correction-history-design.md`

## Global Constraints

- **Do not execute this plan until LEANDRO explicitly authorizes Slice 02 implementation.** Spec/plan approval is not implementation authorization.
- Use synthetic laboratory data only. Real sensitive data and pilot remain unauthorized.
- At execution time create an isolated worktree from fresh validated `main` and branch `slice/02-correction-history` using `superpowers:using-git-worktrees`.
- Preserve exactly five Prisma product models/tables: `Memory`, `Evidence`, `LedgerEvent`, `Fact`, `CurrentFact`.
- Add no Redis, BullMQ, worker, pgvector, object storage, AI provider, STT/TTS, IndexedDB/offline, sync, passkeys, purge, or future-slice infrastructure.
- Add no new runtime dependency; none is required by this boundary.
- Correction normalization is exactly `input.text.trim()`; accepted normalized length is 1–4000.
- Optional reason normalization is `input.reason?.trim()`; empty becomes null; non-empty max is 500.
- Normal query continues to read only `current_facts`; superseded text never appears in ordinary search.
- `CurrentFact.recordedAt` remains the original memory recording timestamp after every correction.
- Every accepted correction appends one new Evidence, one new Fact, and one new `MEMORY_CORRECTED` event.
- `Fact.supersedesFactId` points to the immediately previous current fact and is unique when non-null.
- `MEMORY_CORRECTED` uses explicit `fact_id`, `supersedes_fact_id`, and `reason` columns; no JSON event payload.
- Correction transactions lock the Memory row with `SELECT ... FOR UPDATE` before checking `expectedCurrentFactId`.
- Evidence + Fact + LedgerEvent + CurrentFact reprojection commit together or roll back together.
- Stale correction: HTTP 409 / `STALE_CORRECTION`, no retry/overwrite.
- No-change: HTTP 422 / `NO_CHANGE`, no persistent records.
- Correction request validation failure: HTTP 422 / `VALIDATION_FAILED`.
- PostgreSQL unavailability: HTTP 503 / `SERVICE_UNAVAILABLE`, with no SQL/content leak.
- Every behavior change follows RED → prove RED → minimal GREEN → prove GREEN → focused commit.
- Slice 01 tests, E2E, outage behavior, literal search semantics, five-model boundary, and forbidden-dependency checks remain cumulative regression contracts.

---

## File Structure

### Create

- `packages/domain/src/correction.ts`
- `packages/domain/src/correction.test.ts`
- `packages/contracts/src/correction.ts`
- `packages/contracts/src/correction.test.ts`
- `packages/contracts/src/api-error.ts`
- `packages/contracts/src/api-error.test.ts`
- `apps/api/src/memories/memory.errors.ts`
- `prisma/migrations/20260817000100_slice_02_correction_history/migration.sql`
- `tests/architecture/slice-02-scope.test.ts`
- `apps/web/src/features/memory/MemoryFoundResult.tsx`
- `apps/web/src/features/memory/MemoryFoundResult.test.tsx`
- `tests/e2e/correction-history.spec.ts`
- `docs/phases/SLICE-02.md`
- `docs/evidence/slice-02/SLICE-02-EVIDENCE-001.md`
- `artifacts/phases/SLICE-02-CORRECTION-HISTORY/*` PRF files listed in Task 8.

### Modify

- `packages/domain/src/index.ts`
- `packages/contracts/src/index.ts`
- `prisma/schema.prisma`
- `apps/api/src/memories/memory.store.ts`
- `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`
- `apps/api/src/memories/memory.service.ts`
- `apps/api/src/memories/memory.service.test.ts`
- `apps/api/src/memories/memory.controller.ts`
- `apps/api/src/memories/memory.controller.test.ts`
- `apps/api/src/common/http/api-error.ts`
- `apps/api/src/common/http/api-error.filter.ts`
- `apps/api/src/common/http/api-error.filter.test.ts`
- `apps/web/src/lib/memory-api.ts`
- `apps/web/src/lib/memory-api.test.ts`
- `apps/web/src/features/memory/QueryMemoryForm.tsx`
- `apps/web/src/features/memory/QueryMemoryForm.test.tsx`
- `apps/web/src/index.css`
- `.github/workflows/ci.yml`
- `docs/STATE.md` and `docs/MDP-RESUME-CARD.md` only during authorized execution/gate transitions.

---

### Task 1: Pure correction domain + deterministic history

**Files:**
- Create: `packages/domain/src/correction.ts`
- Create: `packages/domain/src/correction.test.ts`
- Modify: `packages/domain/src/index.ts`

**Produces:** `CorrectionDomainError`, `createTextCorrectionRecord`, `orderTextFactHistory`, and their types. Domain remains free of Prisma/Nest/React.

- [ ] **Step 1: Write the RED domain tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  CorrectionDomainError,
  createTextCorrectionRecord,
  orderTextFactHistory,
} from './correction.js';

const recordedAt = new Date('2026-08-16T09:00:00.000Z');
const correctedAt = new Date('2026-08-17T05:00:00.000Z');
const previous = {
  factId: 'fact-1',
  evidenceId: 'evidence-1',
  content: 'Texto atual.',
  recordedAt,
};
const ids = { evidenceId: 'evidence-2', eventId: 'event-2', factId: 'fact-2' };

it('creates a normalized append-only correction and preserves recordedAt', () => {
  const record = createTextCorrectionRecord({
    memoryId: 'memory-1',
    previous,
    text: '  Texto corrigido.  ',
    reason: '  ajuste factual  ',
    correctedAt,
    ids,
  });
  expect(record.evidence.content).toBe('Texto corrigido.');
  expect(record.fact.supersedesFactId).toBe('fact-1');
  expect(record.event).toMatchObject({
    type: 'MEMORY_CORRECTED',
    factId: 'fact-2',
    supersedesFactId: 'fact-1',
    reason: 'ajuste factual',
  });
  expect(record.currentFact.recordedAt).toBe(recordedAt);
});

it.each([
  ['   ', 'EMPTY_CORRECTION'],
  ['x'.repeat(4001), 'TEXT_TOO_LONG'],
  [' Texto atual. ', 'NO_CHANGE'],
] as const)('rejects invalid text %s with %s', (text, code) => {
  expect(() =>
    createTextCorrectionRecord({ memoryId: 'memory-1', previous, text, correctedAt, ids }),
  ).toThrow(expect.objectContaining<Partial<CorrectionDomainError>>({ code }));
});

it('rejects an oversized normalized reason', () => {
  expect(() =>
    createTextCorrectionRecord({
      memoryId: 'memory-1',
      previous,
      text: 'Novo texto.',
      reason: 'x'.repeat(501),
      correctedAt,
      ids,
    }),
  ).toThrow(expect.objectContaining<Partial<CorrectionDomainError>>({ code: 'REASON_TOO_LONG' }));
});

it('orders the explicit chain root-to-tip independent of array/timestamp order', () => {
  const ordered = orderTextFactHistory(
    [
      { factId: 'f3', evidenceId: 'e3', content: 'C', createdAt: correctedAt, supersedesFactId: 'f2' },
      { factId: 'f1', evidenceId: 'e1', content: 'A', createdAt: recordedAt, supersedesFactId: null },
      { factId: 'f2', evidenceId: 'e2', content: 'B', createdAt: correctedAt, supersedesFactId: 'f1' },
    ],
    'f3',
  );
  expect(ordered.map((item) => item.factId)).toEqual(['f1', 'f2', 'f3']);
  expect(ordered[0]).toMatchObject({ isOriginal: true, isCurrent: false });
  expect(ordered[2]).toMatchObject({ isOriginal: false, isCurrent: true });
});

it('rejects broken or forked history', () => {
  expect(() =>
    orderTextFactHistory(
      [
        { factId: 'f1', evidenceId: 'e1', content: 'A', createdAt: recordedAt, supersedesFactId: null },
        { factId: 'f2', evidenceId: 'e2', content: 'B', createdAt: correctedAt, supersedesFactId: 'f1' },
        { factId: 'f3', evidenceId: 'e3', content: 'C', createdAt: correctedAt, supersedesFactId: 'f1' },
      ],
      'f3',
    ),
  ).toThrow(expect.objectContaining<Partial<CorrectionDomainError>>({ code: 'BROKEN_HISTORY' }));
});
```

- [ ] **Step 2: Prove RED**

```bash
pnpm exec vitest run packages/domain/src/correction.test.ts
```

Expected: FAIL because the correction API does not exist.

- [ ] **Step 3: Implement the exact domain shapes and validation**

```ts
export type CorrectionDomainErrorCode =
  | 'EMPTY_CORRECTION'
  | 'TEXT_TOO_LONG'
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
  readonly evidence: Readonly<{ id: string; memoryId: string; kind: 'text'; content: string; createdAt: Date }>;
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

export type OrderedTextFactHistoryNode = TextFactHistoryNode & {
  readonly isOriginal: boolean;
  readonly isCurrent: boolean;
};
```

`createTextCorrectionRecord` must trim text, enforce 1–4000, compare with `previous.content.trim()`, trim reason and enforce ≤500, create frozen immutable output, and preserve `previous.recordedAt` in CurrentFact.

Implement history traversal exactly with a root + successor map:

```ts
export function orderTextFactHistory(
  nodes: readonly TextFactHistoryNode[],
  currentFactId: string,
): OrderedTextFactHistoryNode[] {
  const roots = nodes.filter((node) => node.supersedesFactId === null);
  if (roots.length !== 1) throw new CorrectionDomainError('BROKEN_HISTORY');

  const successor = new Map<string, TextFactHistoryNode>();
  for (const node of nodes) {
    if (node.supersedesFactId === null) continue;
    if (successor.has(node.supersedesFactId)) throw new CorrectionDomainError('BROKEN_HISTORY');
    successor.set(node.supersedesFactId, node);
  }

  const ordered: TextFactHistoryNode[] = [];
  const visited = new Set<string>();
  let cursor: TextFactHistoryNode | undefined = roots[0];
  while (cursor) {
    if (visited.has(cursor.factId)) throw new CorrectionDomainError('BROKEN_HISTORY');
    visited.add(cursor.factId);
    ordered.push(cursor);
    cursor = successor.get(cursor.factId);
  }

  if (ordered.length !== nodes.length || ordered.at(-1)?.factId !== currentFactId) {
    throw new CorrectionDomainError('BROKEN_HISTORY');
  }

  return ordered.map((node, index) => ({
    ...node,
    isOriginal: index === 0,
    isCurrent: node.factId === currentFactId,
  }));
}
```

- [ ] **Step 4: Export from `packages/domain/src/index.ts`, retaining Slice 01 exports**

```ts
export {
  CorrectionDomainError,
  createTextCorrectionRecord,
  orderTextFactHistory,
} from './correction.js';
export type {
  CorrectionDomainErrorCode,
  CreateTextCorrectionRecordInput,
  OrderedTextFactHistoryNode,
  TextCorrectionRecord,
  TextFactHistoryNode,
} from './correction.js';
```

- [ ] **Step 5: Prove GREEN + Slice 01 domain regression**

```bash
pnpm exec vitest run packages/domain/src/correction.test.ts packages/domain/src/memory.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/correction.ts packages/domain/src/correction.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): model append-only memory correction"
```

---

### Task 2: Shared correction/history HTTP contracts and error envelope

**Files:**
- Create: `packages/contracts/src/correction.ts`
- Create: `packages/contracts/src/correction.test.ts`
- Create: `packages/contracts/src/api-error.ts`
- Create: `packages/contracts/src/api-error.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/common/http/api-error.ts`
- Modify: `apps/api/src/common/http/api-error.filter.ts`
- Modify: `apps/api/src/common/http/api-error.filter.test.ts`

**Produces:** typed request/response/history schemas plus a cross-app API error envelope that both API and web can parse.

- [ ] **Step 1: Write RED correction contract tests**

```ts
import { expect, it } from 'vitest';
import {
  correctMemoryRequestSchema,
  correctMemoryResponseSchema,
  memoryHistoryResponseSchema,
} from './correction.js';

it('normalizes correction request', () => {
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

it('rejects invalid correction request lengths', () => {
  expect(correctMemoryRequestSchema.safeParse({ text: ' ', expectedCurrentFactId: 'id' }).success).toBe(false);
  expect(correctMemoryRequestSchema.safeParse({ text: 'x'.repeat(4001), expectedCurrentFactId: 'id' }).success).toBe(false);
  expect(correctMemoryRequestSchema.safeParse({ text: 'ok', expectedCurrentFactId: 'id', reason: 'x'.repeat(501) }).success).toBe(false);
});

it('parses correction response and non-empty history', () => {
  expect(correctMemoryResponseSchema.parse({
    memoryId: 'm1',
    current: {
      factId: 'f2', evidenceId: 'e2', content: 'B',
      recordedAt: '2026-08-16T09:00:00.000Z', correctedAt: '2026-08-17T05:00:00.000Z',
    },
    correction: { eventId: 'ev2', supersedesFactId: 'f1', reason: null },
  }).current.factId).toBe('f2');

  expect(memoryHistoryResponseSchema.parse({
    memoryId: 'm1',
    versions: [{
      factId: 'f1', evidenceId: 'e1', content: 'A', createdAt: '2026-08-16T09:00:00.000Z',
      reason: null, isOriginal: true, isCurrent: true, supersedesFactId: null, eventId: 'ev1',
    }],
  }).versions).toHaveLength(1);
});
```

- [ ] **Step 2: Write RED shared error-envelope tests**

```ts
import { expect, it } from 'vitest';
import { apiErrorEnvelopeSchema } from './api-error.js';

it.each(['STALE_CORRECTION', 'NO_CHANGE', 'SERVICE_UNAVAILABLE'] as const)(
  'parses stable error code %s',
  (code) => {
    expect(apiErrorEnvelopeSchema.parse({
      error: { code, message: 'safe', requestId: 'request-1' },
    }).error.code).toBe(code);
  },
);
```

- [ ] **Step 3: Prove RED**

```bash
pnpm exec vitest run packages/contracts/src/correction.test.ts packages/contracts/src/api-error.test.ts
```

- [ ] **Step 4: Implement correction schemas**

```ts
import { z } from 'zod';
import { MEMORY_TEXT_MAX_LENGTH } from './memory.js';

export const CORRECTION_REASON_MAX_LENGTH = 500;

export const correctMemoryRequestSchema = z.object({
  text: z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(MEMORY_TEXT_MAX_LENGTH)),
  expectedCurrentFactId: z.string().min(1),
  reason: z.string().transform((value) => value.trim()).pipe(z.string().max(CORRECTION_REASON_MAX_LENGTH)).optional(),
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
  factId: z.string(), evidenceId: z.string(), content: z.string(), createdAt: z.string(),
  reason: z.string().nullable(), isOriginal: z.boolean(), isCurrent: z.boolean(),
  supersedesFactId: z.string().nullable(), eventId: z.string(),
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

- [ ] **Step 5: Implement shared error contract**

```ts
import { z } from 'zod';

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'STALE_CORRECTION',
  'NO_CHANGE',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
```

Export all new contracts from `packages/contracts/src/index.ts`.

- [ ] **Step 6: Make API error transport use the shared type and coded exception**

`apps/api/src/common/http/api-error.ts`:

```ts
import type { ApiErrorCode, ApiErrorEnvelope } from '@mdp/contracts';
import { HttpException } from '@nestjs/common';

export type { ApiErrorCode, ApiErrorEnvelope };

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

In `ApiErrorFilter`, handle `CodedHttpException` before generic `HttpException` and emit its exact code/message/requestId. Add filter tests for 409 `STALE_CORRECTION` and 422 `NO_CHANGE`, while preserving existing 400/404/503 tests.

- [ ] **Step 7: Prove GREEN**

```bash
pnpm build:packages
pnpm exec vitest run packages/contracts/src/correction.test.ts packages/contracts/src/api-error.test.ts apps/api/src/common/http/api-error.filter.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/correction.ts packages/contracts/src/correction.test.ts packages/contracts/src/api-error.ts packages/contracts/src/api-error.test.ts packages/contracts/src/index.ts apps/api/src/common/http/api-error.ts apps/api/src/common/http/api-error.filter.ts apps/api/src/common/http/api-error.filter.test.ts
git commit -m "feat(contracts): define correction history and error contracts"
```

---

### Task 3: Prisma lineage migration + scope proof

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260817000100_slice_02_correction_history/migration.sql`
- Create: `tests/architecture/slice-02-scope.test.ts`

- [ ] **Step 1: Write RED architecture test**

```ts
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('keeps five product models and adds only correction lineage fields', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((m) => m[1]).sort();
  expect(models).toEqual(['CurrentFact', 'Evidence', 'Fact', 'LedgerEvent', 'Memory']);
  expect(schema).toContain('supersedesFactId');
  expect(schema).toContain('@unique @map("supersedes_fact_id")');
  expect(schema).toContain('reason');
});

it('does not add future-slice package dependencies', async () => {
  const paths = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'packages/contracts/package.json', 'packages/domain/package.json', 'packages/shared/package.json'];
  const names: string[] = [];
  for (const path of paths) {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    names.push(...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {}));
  }
  for (const forbidden of ['openai', 'anthropic', 'pgvector', 'redis', 'bullmq', '@aws-sdk/client-s3']) {
    expect(names.map((name) => name.toLowerCase())).not.toContain(forbidden);
  }
});
```

- [ ] **Step 2: Prove RED**

```bash
pnpm exec vitest run tests/architecture/slice-02-scope.test.ts
```

- [ ] **Step 3: Add named Prisma relations**

Fact additions:

```prisma
supersedesFactId String? @unique @map("supersedes_fact_id") @db.Uuid
supersedes       Fact? @relation("FactSupersession", fields: [supersedesFactId], references: [id], onDelete: Restrict)
successor        Fact? @relation("FactSupersession")
newFactEvents    LedgerEvent[] @relation("CorrectionNewFact")
supersededEvents LedgerEvent[] @relation("CorrectionPreviousFact")
```

LedgerEvent additions:

```prisma
factId           String? @map("fact_id") @db.Uuid
supersedesFactId String? @map("supersedes_fact_id") @db.Uuid
reason           String? @db.VarChar(500)
fact             Fact? @relation("CorrectionNewFact", fields: [factId], references: [id], onDelete: Restrict)
supersedesFact   Fact? @relation("CorrectionPreviousFact", fields: [supersedesFactId], references: [id], onDelete: Restrict)

@@index([factId])
@@index([supersedesFactId])
```

- [ ] **Step 4: Add exact SQL migration**

```sql
ALTER TABLE "facts" ADD COLUMN "supersedes_fact_id" UUID;
CREATE UNIQUE INDEX "facts_supersedes_fact_id_key" ON "facts"("supersedes_fact_id");
ALTER TABLE "facts" ADD CONSTRAINT "facts_supersedes_fact_id_fkey"
  FOREIGN KEY ("supersedes_fact_id") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_events" ADD COLUMN "fact_id" UUID;
ALTER TABLE "ledger_events" ADD COLUMN "supersedes_fact_id" UUID;
ALTER TABLE "ledger_events" ADD COLUMN "reason" VARCHAR(500);
CREATE INDEX "ledger_events_fact_id_idx" ON "ledger_events"("fact_id");
CREATE INDEX "ledger_events_supersedes_fact_id_idx" ON "ledger_events"("supersedes_fact_id");
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_fact_id_fkey"
  FOREIGN KEY ("fact_id") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_supersedes_fact_id_fkey"
  FOREIGN KEY ("supersedes_fact_id") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_memory_corrected_fact_links_check"
  CHECK ("type" <> 'MEMORY_CORRECTED' OR ("fact_id" IS NOT NULL AND "supersedes_fact_id" IS NOT NULL));
```

- [ ] **Step 5: Validate against real PostgreSQL**

```bash
docker compose up -d postgres
export DATABASE_URL='postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp'
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
pnpm exec vitest run tests/architecture/slice-01-scope.test.ts tests/architecture/slice-02-scope.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260817000100_slice_02_correction_history/migration.sql tests/architecture/slice-02-scope.test.ts
git commit -m "feat(db): add correction lineage constraints"
```

---

### Task 4: Atomic MemoryStore correction + history on PostgreSQL

**Files:**
- Create: `apps/api/src/memories/memory.errors.ts`
- Modify: `apps/api/src/memories/memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts`
- Modify: `apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts`

**Produces:** atomic `correct()` and deterministic `history()` methods with existing safe availability mapping.

- [ ] **Step 1: Define exact application/store shapes**

`memory.errors.ts`:

```ts
export class MemoryNotFoundError extends Error { constructor() { super('MEMORY_NOT_FOUND'); this.name = 'MemoryNotFoundError'; } }
export class StaleCorrectionError extends Error { constructor() { super('STALE_CORRECTION'); this.name = 'StaleCorrectionError'; } }
export class NoChangeCorrectionError extends Error { constructor() { super('NO_CHANGE'); this.name = 'NoChangeCorrectionError'; } }
export class MemoryInvariantError extends Error { constructor(message: string) { super(message); this.name = 'MemoryInvariantError'; } }
```

Add to `MemoryStore`:

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
  factId: string; evidenceId: string; content: string; createdAt: Date;
  reason: string | null; supersedesFactId: string | null; eventId: string;
  isOriginal: boolean; isCurrent: boolean;
}

export interface StoredMemoryHistory { memoryId: string; versions: StoredHistoryVersion[]; }
```

- [ ] **Step 2: Write RED integration tests for atomic success and current-only retrieval**

```ts
it('appends correction records atomically and preserves original recordedAt', async () => {
  const original = buildRecord({ text: 'Texto original.' });
  await store.create(original);
  const result = await store.correct({
    memoryId: original.memory.id,
    expectedCurrentFactId: original.fact.id,
    text: ' Texto corrigido. ',
    reason: ' ajuste ',
    correctedAt: new Date('2026-08-17T05:00:00.000Z'),
    ids: { evidenceId: createId(), eventId: createId(), factId: createId() },
  });
  expect(result.status).toBe('CORRECTED');
  expect(await counts()).toEqual([1, 2, 2, 2, 1]);
  await expect(store.findLiteral('original')).resolves.toBeNull();
  await expect(store.findLiteral('corrigido')).resolves.toMatchObject({ recordedAt: original.memory.recordedAt });
});
```

- [ ] **Step 3: Write RED concurrency and rollback tests**

```ts
it('allows only one of two same-base corrections to commit', async () => {
  const original = buildRecord({ text: 'Base.' });
  await store.create(original);
  const make = (text: string) => store.correct({
    memoryId: original.memory.id,
    expectedCurrentFactId: original.fact.id,
    text,
    correctedAt: new Date('2026-08-17T05:00:00.000Z'),
    ids: { evidenceId: createId(), eventId: createId(), factId: createId() },
  });
  const results = await Promise.all([make('A.'), make('B.')]);
  expect(results.map((item) => item.status).sort()).toEqual(['CORRECTED', 'STALE']);
});

it('rolls every correction write back when CurrentFact update fails', async () => {
  const original = buildRecord({ text: 'Base.' });
  await store.create(original);
  await prisma.run(async (client) => {
    await client.$executeRawUnsafe(`CREATE FUNCTION slice02_fail_current_fact_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic correction projection failure'; END; $$ LANGUAGE plpgsql`);
    await client.$executeRawUnsafe(`CREATE TRIGGER slice02_fail_current_fact BEFORE UPDATE ON current_facts FOR EACH ROW EXECUTE FUNCTION slice02_fail_current_fact_update()`);
  });
  await expect(store.correct({
    memoryId: original.memory.id,
    expectedCurrentFactId: original.fact.id,
    text: 'Falha.',
    correctedAt: new Date('2026-08-17T05:00:00.000Z'),
    ids: { evidenceId: createId(), eventId: createId(), factId: createId() },
  })).rejects.toThrow();
  expect(await counts()).toEqual([1, 1, 1, 1, 1]);
});
```

Update test cleanup to drop `slice02_fail_current_fact` and `slice02_fail_current_fact_update()`.

- [ ] **Step 4: Write RED history tests**

```ts
it('returns one-version history for an uncorrected memory', async () => {
  const original = buildRecord({ text: 'Original.' });
  await store.create(original);
  await expect(store.history(original.memory.id)).resolves.toMatchObject({
    memoryId: original.memory.id,
    versions: [{ factId: original.fact.id, isOriginal: true, isCurrent: true, reason: null }],
  });
});

it('returns corrected history root-to-tip with event provenance', async () => {
  const original = buildRecord({ text: 'A.' });
  await store.create(original);
  const first = await store.correct({
    memoryId: original.memory.id, expectedCurrentFactId: original.fact.id, text: 'B.', reason: 'um',
    correctedAt: new Date('2026-08-17T05:00:00.000Z'),
    ids: { evidenceId: createId(), eventId: createId(), factId: createId() },
  });
  if (first.status !== 'CORRECTED') throw new Error('expected correction');
  await store.correct({
    memoryId: original.memory.id, expectedCurrentFactId: first.record.fact.id, text: 'C.', reason: 'dois',
    correctedAt: new Date('2026-08-17T06:00:00.000Z'),
    ids: { evidenceId: createId(), eventId: createId(), factId: createId() },
  });
  const history = await store.history(original.memory.id);
  expect(history?.versions.map((item) => item.content)).toEqual(['A.', 'B.', 'C.']);
  expect(history?.versions.map((item) => item.reason)).toEqual([null, 'um', 'dois']);
  expect(history?.versions.at(-1)?.isCurrent).toBe(true);
});
```

- [ ] **Step 5: Prove RED on PostgreSQL**

```bash
export DATABASE_URL='postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp'
pnpm build:packages
pnpm exec vitest run apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts
```

- [ ] **Step 6: Implement `correct()` with stable Memory-row lock**

Inside existing `withAvailabilityMapping` and one `client.$transaction`:

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

Insert Evidence, Fact, LedgerEvent, then update the existing CurrentFact by old `factId`. If update count is not exactly 1, throw `MemoryInvariantError`. Do not change `recordedAt`.

- [ ] **Step 7: Implement `history()` from lineage**

Load memory/current/facts/evidence/events; require same-memory consistency; call `orderTextFactHistory`; map root to its `MEMORY_CREATED` event via evidence and each corrected Fact to exactly one `MEMORY_CORRECTED` event via `factId`. Missing/duplicate provenance throws `MemoryInvariantError`; never sort logical history by timestamp.

- [ ] **Step 8: Prove GREEN including availability regression**

```bash
pnpm build:packages
pnpm exec vitest run packages/domain/src/correction.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.test.ts
```

Both new methods must be wrapped by existing `withAvailabilityMapping`; do not duplicate the P1001/P1002/P1008/P1017/P2024/P2037/ECONNREFUSED/ECONNRESET/57P01/57P02/57P03 mapping.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/memories/memory.errors.ts apps/api/src/memories/memory.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.ts apps/api/src/infrastructure/persistence/prisma/prisma-memory.store.integration.test.ts
git commit -m "feat(api): persist atomic memory corrections"
```

---

### Task 5: Service + correction/history HTTP endpoints

**Files:**
- Modify: `apps/api/src/memories/memory.service.ts`
- Modify: `apps/api/src/memories/memory.service.test.ts`
- Modify: `apps/api/src/memories/memory.controller.ts`
- Modify: `apps/api/src/memories/memory.controller.test.ts`

**Produces:** `POST /memories/:memoryId/corrections` and `GET /memories/:memoryId/history`.

- [ ] **Step 1: Extend `makeStore()` test helper with `correct` and `history` defaults**

```ts
return {
  create: async () => undefined,
  getById: async () => null,
  findLiteral: async () => null,
  correct: async () => ({ status: 'NOT_FOUND' as const }),
  history: async () => null,
  ...overrides,
};
```

- [ ] **Step 2: Write RED service tests with literal records, not undefined fixtures**

```ts
it('maps a successful correction using one clock read and three IDs', async () => {
  const correct = vi.fn<MemoryStore['correct']>().mockResolvedValue({
    status: 'CORRECTED',
    record: {
      evidence: { id: 'e2', memoryId: 'm1', kind: 'text', content: 'B.', createdAt: new Date('2026-08-17T05:00:00.000Z') },
      fact: { id: 'f2', memoryId: 'm1', evidenceId: 'e2', kind: 'autobiographical_statement', content: 'B.', supersedesFactId: 'f1', createdAt: new Date('2026-08-17T05:00:00.000Z') },
      event: { id: 'ev2', memoryId: 'm1', evidenceId: 'e2', factId: 'f2', supersedesFactId: 'f1', type: 'MEMORY_CORRECTED', reason: null, createdAt: new Date('2026-08-17T05:00:00.000Z') },
      currentFact: { factId: 'f2', memoryId: 'm1', evidenceId: 'e2', content: 'B.', recordedAt: new Date('2026-08-16T09:00:00.000Z') },
    },
  });
  const now = vi.fn(() => new Date('2026-08-17T05:00:00.000Z'));
  const ids = ['e2', 'ev2', 'f2'];
  const service = new MemoryService({ store: makeStore({ correct }), now, createId: () => ids.shift() ?? 'unexpected' });
  await expect(service.correct('m1', { text: 'B.', expectedCurrentFactId: 'f1' })).resolves.toMatchObject({
    memoryId: 'm1', current: { factId: 'f2', evidenceId: 'e2', content: 'B.' },
    correction: { eventId: 'ev2', supersedesFactId: 'f1', reason: null },
  });
  expect(now).toHaveBeenCalledTimes(1);
});

it('maps store outcomes/domain no-change to application errors', async () => {
  const stale = new MemoryService({ store: makeStore({ correct: async () => ({ status: 'STALE', currentFactId: 'f2' }) }), now: () => new Date(), createId: () => 'id' });
  await expect(stale.correct('m1', { text: 'B', expectedCurrentFactId: 'f1' })).rejects.toBeInstanceOf(StaleCorrectionError);
  const missing = new MemoryService({ store: makeStore(), now: () => new Date(), createId: () => 'id' });
  await expect(missing.correct('m1', { text: 'B', expectedCurrentFactId: 'f1' })).rejects.toBeInstanceOf(MemoryNotFoundError);
});
```

Add a history service test with literal `StoredMemoryHistory` dates and assert ISO string mapping.

- [ ] **Step 3: Write RED controller tests**

Use the existing Supertest setup and extend the service mock with `correct`/`history`. Add exact cases:

```ts
service.correct.mockResolvedValue({
  memoryId: validId,
  current: { factId: validId, evidenceId: validId, content: 'Corrigido.', recordedAt: '2026-08-16T09:00:00.000Z', correctedAt: '2026-08-17T05:00:00.000Z' },
  correction: { eventId: validId, supersedesFactId: validId, reason: null },
});
const ok = await request(app.getHttpServer()).post(`/memories/${validId}/corrections`).send({ text: 'Corrigido.', expectedCurrentFactId: validId });
expect(ok.status).toBe(201);
```

Then mock/reject `MemoryNotFoundError`, `StaleCorrectionError`, `NoChangeCorrectionError`, and `MemoryStoreUnavailableError` one at a time and assert respectively `404/NOT_FOUND`, `409/STALE_CORRECTION`, `422/NO_CHANGE`, `503/SERVICE_UNAVAILABLE`. Send blank/4001-char text, 501-char reason, and non-v7 `expectedCurrentFactId`; assert `422/VALIDATION_FAILED` and `service.correct` not called. Add GET history 200 and missing 404.

- [ ] **Step 4: Prove RED**

```bash
pnpm build:packages
pnpm exec vitest run apps/api/src/memories/memory.service.test.ts apps/api/src/memories/memory.controller.test.ts
```

- [ ] **Step 5: Implement service methods**

`MemoryService.correct` reads clock once, generates exactly `evidenceId/eventId/factId`, calls `store.correct`, maps `NOT_FOUND` → `MemoryNotFoundError`, `STALE` → `StaleCorrectionError`, maps `CorrectionDomainError` code `NO_CHANGE` → `NoChangeCorrectionError`, and returns the approved response fields. `history` maps Date fields to ISO strings and returns null only for missing memory.

- [ ] **Step 6: Implement controller methods**

Validate route memory ID with existing `isUuidV7`. Parse body using `correctMemoryRequestSchema`, then independently require `isUuidV7(parsed.data.expectedCurrentFactId)`. Correction-body/expected-fact validation uses:

```ts
throw new CodedHttpException('VALIDATION_FAILED', 422, 'Os dados enviados são inválidos.');
```

Map application errors:

```ts
if (error instanceof MemoryNotFoundError) throw new NotFoundException();
if (error instanceof StaleCorrectionError) throw new CodedHttpException('STALE_CORRECTION', 409, 'A lembrança mudou desde a última consulta.');
if (error instanceof NoChangeCorrectionError) throw new CodedHttpException('NO_CHANGE', 422, 'A correção não altera o texto atual.');
```

Use existing `mapAvailability` for `MemoryStoreUnavailableError`.

- [ ] **Step 7: Prove GREEN + existing API regression**

```bash
pnpm build:packages
pnpm exec vitest run apps/api/src/common/http/api-error.filter.test.ts apps/api/src/memories/memory.service.test.ts apps/api/src/memories/memory.controller.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/memories/memory.service.ts apps/api/src/memories/memory.service.test.ts apps/api/src/memories/memory.controller.ts apps/api/src/memories/memory.controller.test.ts
git commit -m "feat(api): expose memory correction and history"
```

---

### Task 6: Typed web API client + stable error parsing

**Files:**
- Modify: `apps/web/src/lib/memory-api.ts`
- Modify: `apps/web/src/lib/memory-api.test.ts`

- [ ] **Step 1: Write RED client tests**

```ts
it('posts exactly one correction request', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({
    memoryId: 'm1',
    current: { factId: 'f2', evidenceId: 'e2', content: 'B.', recordedAt: '2026-08-16T09:00:00.000Z', correctedAt: '2026-08-17T05:00:00.000Z' },
    correction: { eventId: 'ev2', supersedesFactId: 'f1', reason: null },
  }, 201));
  vi.stubGlobal('fetch', fetchMock);
  await correctMemory('http://api/', 'm1', { text: 'B.', expectedCurrentFactId: 'f1' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('http://api/memories/m1/corrections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'B.', expectedCurrentFactId: 'f1' }),
  });
});

it('preserves STALE_CORRECTION and does not retry', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({ error: { code: 'STALE_CORRECTION', message: 'safe', requestId: 'r1' } }, 409));
  vi.stubGlobal('fetch', fetchMock);
  await expect(correctMemory('http://api', 'm1', { text: 'B.', expectedCurrentFactId: 'f1' })).rejects.toEqual(
    expect.objectContaining({ status: 409, code: 'STALE_CORRECTION' }),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('loads and validates history', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({
    memoryId: 'm1',
    versions: [{ factId: 'f1', evidenceId: 'e1', content: 'A.', createdAt: '2026-08-16T09:00:00.000Z', reason: null, isOriginal: true, isCurrent: true, supersedesFactId: null, eventId: 'ev1' }],
  }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(getMemoryHistory('http://api', 'm1')).resolves.toMatchObject({ memoryId: 'm1' });
});
```

- [ ] **Step 2: Prove RED**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/lib/memory-api.test.ts
```

- [ ] **Step 3: Implement shared error parser and methods**

Import `apiErrorEnvelopeSchema`, `correctMemoryResponseSchema`, `memoryHistoryResponseSchema`, and types from `@mdp/contracts`. Extend `MemoryApiError`:

```ts
export class MemoryApiError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode | null, message = 'Memory API request failed') {
    super(message);
    this.name = 'MemoryApiError';
  }
}
```

For non-OK responses parse a cloned/consumed JSON body with `apiErrorEnvelopeSchema.safeParse`; set code to parsed code or null; throw once. Implement `correctMemory` POST and `getMemoryHistory` GET. Never retry.

- [ ] **Step 4: Prove GREEN**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/lib/memory-api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/memory-api.ts apps/web/src/lib/memory-api.test.ts
git commit -m "feat(web): add correction and history client"
```

---

### Task 7: PWA inline correction/history/undo

**Files:**
- Create: `apps/web/src/features/memory/MemoryFoundResult.tsx`
- Create: `apps/web/src/features/memory/MemoryFoundResult.test.tsx`
- Modify: `apps/web/src/features/memory/QueryMemoryForm.tsx`
- Modify: `apps/web/src/features/memory/QueryMemoryForm.test.tsx`
- Modify: `apps/web/src/index.css`

**Component interface:**

```ts
type FoundResult = Extract<MemoryQueryResponse, { status: 'FOUND' }>;
interface MemoryFoundResultProps {
  apiBaseUrl: string;
  result: FoundResult;
  onCurrentChange: (next: FoundResult) => void;
}
```

- [ ] **Step 1: Write RED correction UI test**

Mock `correctMemory` and `getMemoryHistory`. Render a literal FOUND result. Assert `Corrigir`/`Ver histórico`; open correction and assert `Texto corrigido` is prefilled. Mock successful correction and assert the call uses `result.provenance.factId`, form closes, success status appears, and `onCurrentChange` receives the new fact/evidence/content.

Use this exact stale assertion after rejecting with `new MemoryApiError(409, 'STALE_CORRECTION')`:

```ts
expect(await screen.findByRole('alert')).toHaveTextContent('A lembrança mudou');
expect(screen.queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument();
expect(correctMemoryMock).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Write RED history + undo UI test**

Mock history as versions A(original), B(current). Open history; assert A appears before B, labels `Original` and `Atual`, and reason is rendered only when non-null. Click `Usar este texto como nova correção` on A; assert correction field value becomes A. After saving, assert the request uses A as `text` but **B's current fact ID** as `expectedCurrentFactId`.

- [ ] **Step 3: Prove RED**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/memory/MemoryFoundResult.test.tsx apps/web/src/features/memory/QueryMemoryForm.test.tsx
```

- [ ] **Step 4: Implement `MemoryFoundResult`**

State: `editing`, `text`, `reason`, `saving`, `stale`, `feedback`, `history`, `historyLoading`, `historyError`. On a fresh `result.provenance.factId`, reset stale/edit state and prefill current text. Use `MEMORY_TEXT_MAX_LENGTH` and `CORRECTION_REASON_MAX_LENGTH`. On correction success call:

```ts
onCurrentChange({
  status: 'FOUND',
  answer: response.current.content,
  provenance: {
    memoryId: response.memoryId,
    evidenceId: response.current.evidenceId,
    factId: response.current.factId,
  },
});
```

History renders server order without re-sorting. `Usar este texto como nova correção` only copies old content into the edit field; concurrency base always comes from the currently displayed FOUND result.

- [ ] **Step 5: Integrate into QueryMemoryForm**

Replace only the current FOUND rendering block with `MemoryFoundResult`; QueryMemoryForm remains owner of search query/loading/result and updates its stored FOUND result via `onCurrentChange`. UNKNOWN behavior remains unchanged.

- [ ] **Step 6: Add minimal responsive styles**

Use existing visual variables/classes in `index.css`; add no design-system dependency. Ensure action buttons wrap on narrow screens, textarea/inputs remain full-width, history list has readable spacing, and focus outlines remain visible.

- [ ] **Step 7: Prove GREEN + existing web regression**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/memory/MemoryFoundResult.test.tsx apps/web/src/features/memory/QueryMemoryForm.test.tsx apps/web/src/features/memory/StoreMemoryForm.test.tsx apps/web/src/App.test.tsx
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/memory/MemoryFoundResult.tsx apps/web/src/features/memory/MemoryFoundResult.test.tsx apps/web/src/features/memory/QueryMemoryForm.tsx apps/web/src/features/memory/QueryMemoryForm.test.tsx apps/web/src/index.css
git commit -m "feat(web): correct and inspect memory history inline"
```

---

### Task 8: Browser proof, CI hardening, evidence, and gate preparation

**Files:**
- Create: `tests/e2e/correction-history.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/phases/SLICE-02.md`
- Create: `docs/evidence/slice-02/SLICE-02-EVIDENCE-001.md`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-PLAN.md`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-VALIDATION.txt`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-VALIDATION-FULL.txt`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-SMOKE.txt`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-REPORT.md`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-CHECKPOINT.yaml`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-DECISIONS.md`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/README.md`
- Create: `artifacts/phases/SLICE-02-CORRECTION-HISTORY/PHASE-02-ARTIFACT-MANIFEST.sha256`
- Modify when authorized/accurate: `docs/STATE.md`, `docs/MDP-RESUME-CARD.md`

- [ ] **Step 1: Write Playwright E2E before final full run**

The test must execute this exact synthetic flow:

```text
store "Minha irmã sintética se chama Ana."
query Ana -> FOUND
Corrigir -> "Minha irmã sintética se chama Beatriz."
visible result updates immediately
query Ana -> UNKNOWN
query Beatriz -> FOUND
Ver histórico -> original then correction
Usar texto original como nova correção
save -> visible current becomes Ana again
Ver histórico -> three versions remain present in order
```

Also assert `Ambiente de laboratório` still says `Use somente dados sintéticos`.

- [ ] **Step 2: Prove E2E RED then GREEN**

Before UI/API completion the new file must fail; after Tasks 1–7:

```bash
export DATABASE_URL='postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp'
pnpm build
pnpm e2e -- correction-history.spec.ts
```

Expected final result: PASS.

- [ ] **Step 3: Extend CI structural checks**

Keep the exact table allowlist unchanged. Add psql assertions that `facts.supersedes_fact_id` exists and is uniquely indexed; `ledger_events.fact_id`, `supersedes_fact_id`, and `reason varchar(500)` exist; and `ledger_events_memory_corrected_fact_links_check` exists.

- [ ] **Step 4: Extend real PostgreSQL-outage proof to correction**

While DB is healthy, create a synthetic memory and save response to `/tmp/memory-created.json`; parse `memory.id` and `fact.id` with Node. After `docker compose stop postgres`, POST one correction using those IDs. Assert HTTP 503, `SERVICE_UNAVAILABLE`, no synthetic text, and no case-insensitive `sql` in the response. Keep existing live/ready/create outage assertions.

- [ ] **Step 5: Run complete local validation before writing evidence**

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

All commands must PASS. Record real output/IDs/counts; do not pre-fill evidence with predicted results.

- [ ] **Step 6: Write phase/evidence/PRF from actual results**

`PHASE-02-REPORT.md` must map every approved acceptance criterion to test/command evidence. `PHASE-02-CHECKPOINT.yaml` must use only the evidence-supported state (`IN_PROGRESS`, `IN_REVIEW`, or `READY_FOR_GATE`); never `ENTREGUE` before the governed completion gate/merge/post-merge evidence.

- [ ] **Step 7: Build/verify PRF manifest**

```bash
cd artifacts/phases/SLICE-02-CORRECTION-HISTORY
sha256sum PHASE-02-PLAN.md PHASE-02-REPORT.md PHASE-02-VALIDATION.txt PHASE-02-VALIDATION-FULL.txt PHASE-02-SMOKE.txt PHASE-02-CHECKPOINT.yaml PHASE-02-DECISIONS.md README.md > PHASE-02-ARTIFACT-MANIFEST.sha256
sha256sum -c PHASE-02-ARTIFACT-MANIFEST.sha256
```

- [ ] **Step 8: Add final CI manifest verification**

```yaml
- name: Verify Slice 02 PRF manifest
  working-directory: artifacts/phases/SLICE-02-CORRECTION-HISTORY
  run: sha256sum -c PHASE-02-ARTIFACT-MANIFEST.sha256
```

Keep the existing Slice 01 manifest verification.

- [ ] **Step 9: Update canonical state only to truthful pre-gate status and run full regression again**

```bash
pnpm prisma:validate
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm e2e
(cd artifacts/phases/SLICE-01-TRUSTED-TEXT-MEMORY && sha256sum -c PHASE-01-ARTIFACT-MANIFEST.sha256)
(cd artifacts/phases/SLICE-02-CORRECTION-HISTORY && sha256sum -c PHASE-02-ARTIFACT-MANIFEST.sha256)
```

Before HUMAN_GATE/merge, docs must still say real data NOT AUTHORIZED, pilot NOT AUTHORIZED, Slice 03 NOT AUTHORIZED, and Slice 02 not yet `ENTREGUE`.

- [ ] **Step 10: Commit gate evidence**

```bash
git add .github/workflows/ci.yml tests/e2e/correction-history.spec.ts docs/STATE.md docs/MDP-RESUME-CARD.md docs/phases/SLICE-02.md docs/evidence/slice-02 artifacts/phases/SLICE-02-CORRECTION-HISTORY
git commit -m "docs: prepare Slice 02 gate evidence"
```

- [ ] **Step 11: PR/review/audit/gate**

Push/update the Slice 02 PR, require fresh CI, classify findings as BLOCKER / REQUIRED_FOR_ACCEPTANCE / FUTURE_OR_IMPROVEMENT, resolve all current-boundary findings, obtain independent audit/internal gate required by current MCF governance, and escalate HUMAN_GATE only to LEANDRO. Green CI alone never authorizes merge/completion.

---

## Self-Review Result

- Spec coverage: correction, multiple corrections, optional reason, trim/limits, no-change, stale write, explicit predecessor, `MEMORY_CORRECTED`, atomicity, current-only retrieval, history, one-version history, undo-by-append, PWA, E2E, outage, and exclusions all map to tasks above.
- Placeholder scan: no `TBD`, `TODO`, “implement later”, undefined fixture, or “same as previous task” instruction is permitted.
- Type consistency: `CorrectMemoryRequest`, `CorrectMemoryResponse`, `MemoryHistoryResponse`, `ApiErrorCode`, `TextCorrectionRecord`, and `CorrectMemoryStoreResult` are defined before downstream use.
- Scope: one vertical Slice 02 plan; no independent future subsystem is bundled.

## Execution Boundary

This is a **planning artifact only**. It does not authorize code, real data, pilot, merge, or Slice 03. Once LEANDRO explicitly authorizes Slice 02 implementation, execute task-by-task with the required Superpowers execution skill and current MCF governance.
