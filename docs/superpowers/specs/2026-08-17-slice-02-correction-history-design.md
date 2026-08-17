# Slice 02 — Correction & History — Design

## Document status

- Mission: `MDP-001 — Memória Digital Pessoal`
- Boundary: `SLICE 02 — Correction & History`
- Date: `2026-08-17`
- Design decisions: approved by LEANDRO during interactive design review.
- Written specification review: PENDING LEANDRO REVIEW.
- Implementation: NOT STARTED / NOT AUTHORIZED.
- Real sensitive data: NOT AUTHORIZED.
- Pilot: NOT AUTHORIZED.

This document defines the proposed Slice 02 product and technical boundary. It does not authorize implementation, use of real sensitive data, pilot activity, or any later roadmap capability.

## 1. Objective

Extend the deterministic trusted-text memory delivered by Slice 01 so a stored textual memory can be corrected without silently destroying its original evidence.

The slice must prove this end-to-end flow:

```text
existing current textual memory
→ explicit correction based on the current fact
→ new immutable correction evidence
→ MEMORY_CORRECTED ledger event
→ new immutable fact superseding the previous fact
→ atomic CurrentFact reprojection
→ normal query returns only the corrected current state
→ history returns the complete provenance-preserving chain
```

The central guarantee is that correction changes the current projection while preserving every historical version and its provenance.

## 2. Product decisions

The following decisions are part of the approved design:

1. Correction is initiated directly from a found memory.
2. The original record is immutable.
3. Every correction creates a new immutable full-text version.
4. Normal queries return only the current version.
5. Historical versions are available through explicit history viewing.
6. A correction may itself be corrected repeatedly.
7. Correction reason is optional.
8. Empty or whitespace-only corrected text is rejected; Slice 02 does not use AI or semantic judgment to decide whether text is "useful".
9. Only textual content is correctable in Slice 02.
10. Corrections use complete replacement text, not patches/diffs.
11. A correction based on a stale current version is rejected.
12. Each corrected fact explicitly references its immediate predecessor.
13. Corrections are represented in the ledger by `MEMORY_CORRECTED`.
14. History is shown chronologically from original to current.
15. Identical-content correction is rejected as no change.
16. A never-corrected memory has a valid one-version history, simultaneously original and current.
17. Undo never rewinds or deletes history; it creates a new correction whose content matches an earlier version.
18. Correction persistence is atomic.
19. Slice 02 is vertical end-to-end: domain, persistence, API, web UI, automated tests and browser E2E.
20. Correction/history actions appear on a `FOUND` query result; no general memory-list screen is introduced.
21. Correction UI is inline and prefilled with current text.
22. On success the result immediately updates to the new current state, the form closes and a concise success message is shown.

## 3. Chosen architecture

### 3.1 Approach

Use an explicit immutable fact chain plus the existing mutable current projection.

Each correction creates:

- a new immutable `Evidence` record containing the complete corrected text;
- a new immutable `Fact` record containing the complete corrected text;
- an explicit predecessor link from the new fact to the previous fact;
- a new immutable `LedgerEvent` of type `MEMORY_CORRECTED`;
- an atomic update of `CurrentFact` so it points to the new fact/evidence/content.

No separate generic `FactVersion` aggregate is introduced, and Slice 02 does not convert the whole system to event-sourced reconstruction.

### 3.2 Rationale

This approach extends the Slice 01 model with the smallest structure required to prove correction, history, reprojection and provenance. It avoids speculative abstractions and preserves the existing distinction:

- evidence and ledger are historical/canonical records;
- facts are immutable derived records;
- `CurrentFact` is a reconstructible projection of the current state.

## 4. Data model

### 4.1 Evidence

`Evidence` remains immutable.

For every accepted correction, create a new text evidence row with:

- new globally unique evidence ID;
- same `memoryId` as the memory being corrected;
- `kind = text`;
- complete normalized corrected content;
- correction timestamp.

The original evidence and all previous correction evidence remain unchanged.

### 4.2 Fact

`Fact` remains immutable and gains a nullable self-reference semantically equivalent to:

```text
supersedesFactId: UUID | null
```

The persistence design is fixed for this slice:

- database column: `facts.supersedes_fact_id UUID NULL`;
- foreign key: `facts.supersedes_fact_id → facts.id` with restrictive deletion semantics;
- unique constraint/index on non-null `supersedes_fact_id`, preventing two accepted facts from superseding the same predecessor;
- original Slice 01 facts have `supersedesFactId = null`;
- each correction fact sets `supersedesFactId` to the immediately previous current fact ID.

A correction service/store must additionally verify that predecessor and successor belong to the same `memoryId`. This same-memory rule is a domain/persistence invariant even where Prisma cannot express it as a simple single-column relation.

History must not depend on timestamp ordering for logical linkage.

### 4.3 LedgerEvent

Slice 02 introduces `MEMORY_CORRECTED` as a distinct immutable event type.

The physical persistence representation is explicit columns on the existing `ledger_events` table; no generic JSON payload is introduced in this slice.

Add nullable columns:

```text
fact_id              UUID NULL
supersedes_fact_id   UUID NULL
reason               VARCHAR(500) NULL
```

Rules:

- `fact_id` references `facts.id` with restrictive deletion semantics;
- `supersedes_fact_id` references `facts.id` with restrictive deletion semantics;
- for every new `MEMORY_CORRECTED` event, `fact_id` is the newly created fact and `supersedes_fact_id` is the previous fact;
- `evidence_id` remains the new correction evidence;
- `memory_id` remains the corrected memory;
- `reason` is optional, trimmed, and omitted/null when empty after trimming;
- a migration-level PostgreSQL check constraint requires `fact_id` and `supersedes_fact_id` to be non-null when `type = 'MEMORY_CORRECTED'`;
- application/persistence invariants require the event memory, new fact, previous fact and evidence to all belong to the same memory;
- the new fact's `supersedesFactId` must equal the event's `supersedes_fact_id`.

Existing `MEMORY_CREATED` rows are preserved unchanged; their new correction-specific columns may remain null. The original event remains traceable through its existing memory/evidence relation and the original fact remains traceable through that evidence.

### 4.4 CurrentFact

`CurrentFact` remains a projection, not history.

Within the Slice 01/02 `autobiographical_statement` boundary there is one current textual fact per stored memory. After an accepted correction it references the newest fact and newest evidence and exposes the newest complete text.

`CurrentFact.recordedAt` continues to mean the original memory recording timestamp and does **not** change when a correction is made. Version/correction time comes from the new evidence/fact/event `createdAt` fields. This preserves existing literal-query ordering semantics instead of making a correction appear to be a newly recorded memory.

No global `UNIQUE(memory_id)` constraint is added to `current_facts` in Slice 02, because later architecture may allow multiple current atomic facts per memory. The one-current-autobiographical-fact guarantee is enforced by the current boundary's repository/domain behavior and tests.

The historical chain must remain reconstructible if `CurrentFact` is rebuilt.

## 5. Domain invariants

The following invariants are mandatory and require executable proof:

1. **Original immutability** — original evidence, event and fact never change when correction occurs.
2. **Historical preservation** — no accepted correction deletes or mutates previous versions.
3. **Linear succession** — the accepted correction chain cannot silently fork.
4. **Current-tip correctness** — `CurrentFact` points to the tip of the accepted chain.
5. **Same-memory linkage** — a fact cannot supersede a fact from another memory.
6. **Current-only normal retrieval** — normal memory query exposes only the current state.
7. **Deterministic history** — history is reconstructed by explicit links and returned original-to-current.
8. **Optimistic concurrency** — correction is accepted only when its expected current fact still matches the persisted current fact after database-safe serialization.
9. **No-change rejection** — normalized identical current/corrected content creates no new records.
10. **Empty rejection** — empty/whitespace-only text creates no new records.
11. **Atomicity** — evidence, correction event, new fact and current projection change either all commit or all roll back.
12. **Undo by append** — returning to old text is represented as a new correction, never a destructive pointer rewind.
13. **Provenance completeness** — every historical displayed version can be traced to its evidence and corresponding creation/correction ledger record.
14. **Recorded-time stability** — correction does not rewrite the memory's original recording timestamp.

## 6. Validation and normalization

Correction text uses the same maximum length as stored memory text: `4000` characters.

Deterministic normalization for correction is:

```text
normalizedText = input.text.trim()
```

Rules:

- `normalizedText.length` must be between `1` and `4000`;
- accepted correction evidence/fact content stores `normalizedText`;
- no-change comparison uses `normalizedText === current.content.trim()`;
- no semantic/AI-based "usefulness" classifier is used.

Optional reason normalization is:

```text
normalizedReason = input.reason?.trim()
```

Rules:

- empty normalized reason becomes absent/null;
- non-empty reason maximum length is `500` characters;
- reason is metadata of the correction event, not canonical memory content.

## 7. Correction command and concurrency

Conceptual input:

```text
CorrectTextMemory {
  memoryId
  expectedCurrentFactId
  text
  reason?
  correctedAt
  generatedIds {
    evidenceId
    eventId
    factId
  }
}
```

Validation order must ensure invalid requests do not create persistent side effects.

The concurrency mechanism for this slice is fixed: correction transactions serialize per memory by locking the stable `memories` row with PostgreSQL `SELECT ... FOR UPDATE` (or the Prisma transaction equivalent implemented through explicit SQL).

Conceptual successful transaction:

```text
BEGIN
  lock Memory(memoryId) row FOR UPDATE
  if memory does not exist → NOT_FOUND

  read the current autobiographical CurrentFact for that memory
  verify the current projection is internally consistent

  if current.factId != expectedCurrentFactId → STALE_CORRECTION

  normalize/validate corrected text and optional reason
  if normalized corrected text == normalized current text → NO_CHANGE

  create correction Evidence
  create corrected Fact(supersedesFactId = previous current factId)
  create MEMORY_CORRECTED event(
    memory,
    new evidence,
    new fact,
    previous fact,
    optional reason
  )
  replace/reproject the existing CurrentFact row to the new fact/evidence/content
  preserve CurrentFact.recordedAt
COMMIT
```

Why the stable memory-row lock is required:

- two correction requests for the same memory cannot both pass the stale-current check concurrently;
- the second transaction observes the first transaction's committed current fact and becomes `STALE_CORRECTION` if it used the old expected fact;
- the unique `facts.supersedes_fact_id` constraint is an additional database-level fork-prevention defense;
- all writes remain inside the same transaction, so any unique/FK/check failure rolls the complete correction back.

## 8. History query

History is an explicit operation separate from normal retrieval.

For a valid memory, history returns one or more ordered versions:

```text
original → correction 1 → correction 2 → ... → current
```

The repository reconstructs semantic order from `Fact.supersedesFactId`; timestamps are display metadata, not the source of chain order.

Each history item exposes:

- `memoryId`;
- `factId`;
- `evidenceId`;
- complete text content;
- version timestamp (`Fact.createdAt` / corresponding evidence-event time);
- optional reason;
- `isOriginal`;
- `isCurrent`;
- predecessor fact ID when applicable;
- correction event ID for corrected versions; original creation event ID may be exposed as provenance when resolved through the original evidence.

A never-corrected memory returns exactly one version with both `isOriginal = true` and `isCurrent = true`.

History retrieval must detect and fail safely on impossible persistence states such as broken predecessor links, cross-memory links, multiple successors, or a `CurrentFact` that is not the chain tip. It must not silently invent an ordering.

## 9. API contract

### 9.1 Create correction

```http
POST /memories/:memoryId/corrections
```

Request:

```json
{
  "text": "corrected complete text",
  "expectedCurrentFactId": "uuid",
  "reason": "optional reason"
}
```

Successful response concept:

```json
{
  "memoryId": "uuid",
  "current": {
    "factId": "uuid",
    "evidenceId": "uuid",
    "content": "normalized corrected complete text",
    "recordedAt": "original-memory-recording-timestamp",
    "correctedAt": "correction-timestamp"
  },
  "correction": {
    "eventId": "uuid",
    "supersedesFactId": "uuid",
    "reason": "optional reason or null"
  }
}
```

The exact TypeScript type names may follow existing package conventions, but these semantics and identifiers are required.

### 9.2 Read history

```http
GET /memories/:memoryId/history
```

Successful response concept:

```json
{
  "memoryId": "uuid",
  "versions": [
    {
      "factId": "uuid",
      "evidenceId": "uuid",
      "content": "full text",
      "createdAt": "timestamp",
      "reason": null,
      "isOriginal": true,
      "isCurrent": false,
      "supersedesFactId": null,
      "eventId": "uuid"
    }
  ]
}
```

`versions` is always non-empty for an existing valid memory and is ordered original-to-current.

### 9.3 Existing normal query

The existing literal deterministic memory query retains its Slice 01 semantics: normal lookup searches `current_facts` and returns `FOUND` or `UNKNOWN`.

The existing `FOUND` contract already exposes `memoryId`, `evidenceId` and `factId` in provenance, so Slice 02 must reuse those identifiers rather than introduce a second lookup identity. Ordinary query must never start returning superseded text.

## 10. Error semantics

The API exposes deterministic, testable failure categories using the existing structured-error approach.

Minimum behavior:

- memory not found → HTTP `404` with stable not-found code;
- stale `expectedCurrentFactId` → HTTP `409`, code `STALE_CORRECTION`;
- empty/whitespace-only or over-4000 corrected text → HTTP `422`, stable validation code;
- corrected text equal to current content after defined trimming normalization → HTTP `422`, code `NO_CHANGE`;
- optional reason over 500 characters → HTTP `422`, stable validation code;
- persistent store unavailable → HTTP `503`, preserving Slice 01 storage-outage behavior;
- detected broken history/persistence invariant → safe server error with no fabricated history;
- unexpected failure inside the correction transaction → no partial correction state.

No correction error path may automatically retry with a different expected fact or silently overwrite a newer version.

## 11. PWA experience

The current Slice 01 query card remains the entry point.

When a query returns `FOUND`:

- current memory text remains prominent;
- provenance remains visible;
- actions `Corrigir` and `Ver histórico` are shown.

### 11.1 Inline correction

Selecting `Corrigir` opens an inline form in the result area.

Fields/actions:

- corrected text, prefilled with current text;
- optional reason;
- `Salvar correção`;
- `Cancelar`.

On successful save:

- correction form closes;
- visible result immediately changes to corrected text;
- local current `factId` and `evidenceId` are replaced by returned current provenance;
- concise success feedback is announced accessibly.

If the server returns `STALE_CORRECTION`:

- no overwrite/retry is performed automatically;
- user is told that the memory changed;
- the stale result is no longer treated as an editable current version;
- a new query/refresh is required before another correction attempt.

### 11.2 Inline history

Selecting `Ver histórico` opens an inline history section.

Versions are displayed:

```text
Original → Correção 1 → Correção 2 → ... → Atual
```

Each visible version includes:

- full text;
- timestamp;
- clear original/current label where applicable;
- provenance/source information;
- optional reason when present.

A historical version may offer `Usar este texto como nova correção`. This action fills the ordinary correction form with that version's text while using the **currently displayed current `factId`** as `expectedCurrentFactId`; it does not submit the historical fact ID as the concurrency base and does not rewind `CurrentFact` directly.

### 11.3 Accessibility and lab boundary

Existing accessible status/error patterns must be preserved or improved for the new controls.

The laboratory warning remains visible. Slice 02 continues to require synthetic data only.

## 12. Testing strategy

Slice 02 uses cumulative regression plus boundary-specific tests.

### 12.1 Domain/unit invariant tests

Minimum proofs:

- first correction creates an immutable successor;
- multiple corrections form a linear chain;
- predecessor belongs to same memory;
- no-change rejected;
- empty content rejected;
- trimming normalization is deterministic;
- reason normalization/limit is deterministic;
- undo is append-only;
- history semantics mark original/current correctly.

### 12.2 Persistence/integration tests

Minimum proofs with PostgreSQL:

- migration preserves every existing Slice 01 row;
- correction transaction creates exactly the required evidence, fact, event and reprojection;
- original rows remain field-stable;
- `Fact.supersedesFactId` unique constraint prevents a persisted fork;
- correction event check constraint requires both fact links;
- event/fact/evidence/memory consistency is validated;
- stale expected fact is rejected;
- two competing corrections using the same expected current fact cannot both commit successfully;
- transaction failure at controlled intermediate points leaves no partial correction;
- history reconstructs the full chain in semantic order;
- current query ignores superseded facts;
- `CurrentFact.recordedAt` remains the original recorded timestamp after correction;
- database-unavailable behavior remains safely mapped to service-unavailable semantics.

### 12.3 API/contract tests

Minimum proofs:

- correction success response;
- history response for one-version and multi-version memories;
- `404`, `STALE_CORRECTION`, invalid text, oversized reason, `NO_CHANGE`, store unavailable;
- `FOUND` current-query contract continues exposing current provenance without historical versions;
- `UNKNOWN` behavior remains intact.

### 12.4 Web component/UI tests

Minimum proofs:

- `FOUND` result exposes `Corrigir` and `Ver histórico`;
- correction form is prefilled;
- successful correction refreshes visible current content/provenance and closes the form;
- stale correction disables treating the old result as current until refresh/new query;
- history displays original-to-current order;
- `Usar este texto como nova correção` uses old content but current fact as concurrency base;
- accessible status/error announcements remain present.

### 12.5 Browser E2E

At least one reproducible end-to-end scenario must prove:

```text
store synthetic memory
→ query FOUND
→ open inline correction
→ save corrected full text
→ visible result updates immediately
→ repeat query and see only corrected current text
→ open history and see original + correction in order
→ choose old text as new correction
→ save
→ see it appended as newest current version
→ history still contains every intermediate version
```

User-visible stale-correction behavior must be proven either by browser E2E or by API/integration concurrency proof plus a focused UI test that consumes the `STALE_CORRECTION` response.

## 13. Acceptance criteria

Slice 02 is acceptable only when all of the following are reproducibly demonstrated:

1. A stored textual memory can be corrected from the PWA.
2. Normal retrieval returns only the latest accepted corrected state.
3. The original evidence/fact/event remain preserved.
4. Every correction has its own evidence, fact and `MEMORY_CORRECTED` ledger record.
5. Every correction event explicitly traces new evidence, previous fact and new fact.
6. Multiple corrections retain a complete linear history.
7. History is visible in chronological chain order in the PWA.
8. A one-version memory has valid history.
9. Empty, invalid and no-change requests create no persistent records.
10. A stale correction cannot overwrite a newer correction.
11. Two concurrent corrections using the same expected current fact cannot both succeed.
12. Correction is transactionally atomic.
13. Undo appends a new correction instead of deleting/repointing history.
14. Original memory recorded time remains stable after corrections.
15. Existing Slice 01 deterministic retrieval, provenance, `UNKNOWN`, E2E and outage guarantees do not regress.
16. Required tests, builds, lint/typecheck/format, migrations and CI are green.
17. Evidence/PRF artifacts are sufficient for independent review and gate decision.

## 14. Explicit exclusions

Slice 02 does not include:

- deletion, trash or permanent purge;
- editing occurred/recorded dates or temporal precision;
- entity resolution or entity metadata correction;
- partial text patches/diff storage as canonical versions;
- offline/IndexedDB capability;
- service worker/offline mutation queues;
- synchronization;
- distributed conflict resolution;
- transactional outbox, Redis, BullMQ or worker unless a separately approved blocker proves they are strictly required (not expected for this boundary);
- pgvector or semantic retrieval;
- generative AI or AI extraction;
- voice/STT/TTS;
- reminders/proactivity;
- passkeys, full security/recovery hardening;
- backup/restore/purge boundary implementation;
- real sensitive data;
- controlled pilot.

No later roadmap capability may be inferred as authorized by approval of this design.

## 15. Files/components expected to be affected during future implementation

This is a design map, not an implementation authorization.

Likely boundary-local changes include:

- `packages/domain` — correction/history domain types and invariants;
- `packages/contracts` — correction/history request/response/error contracts and normalization limits;
- `prisma/schema.prisma` and one versioned Slice 02 migration — fact predecessor and correction-event traceability structure;
- `apps/api` memory application/persistence/controller layers — per-memory locked transactional correction and history read;
- `apps/web` memory API client and query result UI — inline correction/history;
- integration/API/UI/E2E tests;
- Slice 02 evidence, phase and PRF documentation.

Unrelated refactors are excluded.

## 16. Delivery and governance

The eventual implementation boundary follows the repository's established progression:

```text
implementation
→ automated tests
→ integration/E2E/invariant evidence
→ CI
→ review
→ independent audit as required by active governance
→ internal gate
→ HUMAN_GATE by LEANDRO when required for integration/completion
```

Approval of this design document does not itself authorize implementation. After LEANDRO reviews the committed written specification, the next permitted design-process step is to create an implementation plan. Starting product code requires the subsequently applicable project/MCF authorization.

## 17. Design self-review checklist

Before requesting written-spec approval, verify:

- no unresolved placeholder markers;
- concrete correction-event persistence shape is fixed;
- correction validation and no-change normalization are deterministic;
- no contradiction exists between current-only retrieval and explicit historical retrieval;
- stale-write rule has a database-safe per-memory serialization mechanism;
- the database has an additional fork-prevention constraint;
- every accepted correction is append-only except for the reconstructible `CurrentFact` projection;
- undo semantics are append-only and use the current fact as concurrency base;
- `CurrentFact.recordedAt` semantics are stable;
- real sensitive data and pilot remain prohibited;
- offline, sync, AI, voice and purge remain out of scope;
- the scope is small enough for one implementation plan and one Slice 02 PR boundary.
