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
8. Empty or non-useful corrected text is rejected.
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
- complete corrected content;
- correction timestamp.

The original evidence and all previous correction evidence remain unchanged.

### 4.2 Fact

`Fact` remains immutable and gains an optional predecessor/supersession relation equivalent to:

```text
supersedesFactId: UUID | null
```

Rules:

- original Slice 01 fact: `supersedesFactId = null`;
- each correction fact: `supersedesFactId = immediate previous current fact ID`;
- predecessor must belong to the same memory;
- one historical fact must not have multiple accepted successors inside this single-writer Slice 02 correction model;
- history must not depend on timestamp ordering for logical linkage.

Exact Prisma relation naming may follow repository conventions during implementation, but the semantic relationship is mandatory.

### 4.3 LedgerEvent

Slice 02 introduces `MEMORY_CORRECTED` as a distinct immutable event type.

A correction event must be traceable to:

- the memory;
- the new correction evidence;
- the previous fact being superseded;
- the new fact created by the correction;
- correction timestamp;
- optional correction reason when supplied.

The exact persistence shape may use explicit nullable columns or a narrowly typed payload only if it preserves referential integrity, deterministic querying and existing domain isolation. The implementation plan must choose one concrete representation before code is written.

### 4.4 CurrentFact

`CurrentFact` remains a projection, not history.

For the textual-memory boundary there must be exactly one current textual fact per memory. After an accepted correction it must reference the newest fact and newest evidence and expose the newest full text.

The historical chain must remain reconstructible even if `CurrentFact` is rebuilt.

## 5. Domain invariants

The following invariants are mandatory and require executable proof:

1. **Original immutability** — original evidence, event and fact never change when correction occurs.
2. **Historical preservation** — no accepted correction deletes or mutates previous versions.
3. **Linear succession** — the accepted correction chain cannot silently fork.
4. **Current-tip correctness** — `CurrentFact` points to the tip of the accepted chain.
5. **Same-memory linkage** — a fact cannot supersede a fact from another memory.
6. **Current-only normal retrieval** — normal memory query exposes only the current state.
7. **Deterministic history** — history is reconstructed by explicit links and returned original-to-current.
8. **Optimistic concurrency** — correction is accepted only when its expected current fact still matches the persisted current fact.
9. **No-change rejection** — normalized identical current/corrected content creates no new records.
10. **Empty rejection** — empty/invalid text creates no new records.
11. **Atomicity** — evidence, correction event, new fact and current projection change either all commit or all roll back.
12. **Undo by append** — returning to old text is represented as a new correction, never a destructive pointer rewind.
13. **Provenance completeness** — every historical displayed version can be traced to its evidence and corresponding creation/correction ledger record.

## 6. Correction command

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

Validation order must ensure invalid requests do not create side effects.

Conceptual successful transaction:

```text
BEGIN
  read current fact for memory with concurrency-safe semantics
  verify memory/current fact exists
  verify current fact == expectedCurrentFactId
  normalize/validate corrected text
  reject empty/no-change
  create correction Evidence
  create corrected Fact(supersedes = previous fact)
  create MEMORY_CORRECTED event(previous fact, new fact, new evidence, optional reason)
  replace/reproject CurrentFact to new fact/evidence/content
COMMIT
```

The database implementation must make stale concurrent writes unable to both succeed. Merely checking in application memory before an unguarded update is insufficient.

## 7. History query

History is an explicit operation separate from normal retrieval.

For a valid memory, history returns one or more ordered versions:

```text
original → correction 1 → correction 2 → ... → current
```

Each history item exposes enough information for the UI and provenance proof:

- `memoryId`;
- `factId`;
- `evidenceId`;
- complete text content;
- recorded/correction timestamp appropriate to that version;
- optional reason;
- `isOriginal`;
- `isCurrent`;
- predecessor fact ID when applicable.

A never-corrected memory returns exactly one version with both `isOriginal = true` and `isCurrent = true`.

History ordering is semantic chain ordering, not best-effort timestamp sorting.

## 8. API contract

### 8.1 Create correction

```http
POST /memories/:memoryId/corrections
```

Request concept:

```json
{
  "text": "corrected complete text",
  "expectedCurrentFactId": "uuid",
  "reason": "optional reason"
}
```

Success returns the new current state and provenance identifiers required by the PWA.

### 8.2 Read history

```http
GET /memories/:memoryId/history
```

Returns the complete chronological version chain.

### 8.3 Existing normal query

The existing literal deterministic memory query retains its Slice 01 semantics: normal lookup searches current state and returns `FOUND` or `UNKNOWN`.

A `FOUND` response is extended only as needed to expose stable identifiers such as `memoryId`, current `factId` and provenance required to initiate correction/history. It must not start returning superseded text during ordinary search.

## 9. Error semantics

The API must expose deterministic, testable failure categories.

Minimum behavior:

- memory not found → `404`;
- stale `expectedCurrentFactId` → `409` with stable code `STALE_CORRECTION`;
- empty/invalid corrected text → validation failure (`422` unless existing contract conventions require another established validation status);
- text equal to current content after the same canonical normalization used for comparison → `422` with stable code `NO_CHANGE`;
- persistent store unavailable → safe `503` behavior consistent with the Slice 01 storage-outage contract;
- unexpected failure inside the correction transaction → no partial correction state.

The implementation plan must reuse existing structured-error conventions rather than creating parallel error machinery.

## 10. PWA experience

The current Slice 01 query card remains the entry point.

When a query returns `FOUND`:

- current memory text remains prominent;
- provenance remains visible;
- actions `Corrigir` and `Ver histórico` are shown.

### 10.1 Inline correction

Selecting `Corrigir` opens an inline form in the result area.

Fields/actions:

- corrected text, prefilled with current text;
- optional reason;
- `Salvar correção`;
- `Cancelar`.

On successful save:

- correction form closes;
- visible result immediately changes to corrected text;
- local current `factId` is replaced by the returned new fact ID;
- concise success feedback is announced accessibly.

If the server returns `STALE_CORRECTION`:

- no overwrite/retry is performed automatically;
- user is told that the memory changed;
- the stale result is not treated as current;
- a new query/refresh is required before another correction attempt.

### 10.2 Inline history

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

A historical version may offer `Usar este texto como nova correção`. This action pre-fills/initiates the ordinary correction flow; it does not alter old records or rewind `CurrentFact` directly.

### 10.3 Accessibility and lab boundary

Existing accessible status/error patterns must be preserved or improved for the new controls.

The laboratory warning remains visible. Slice 02 continues to require synthetic data only.

## 11. Testing strategy

Slice 02 uses cumulative regression plus boundary-specific tests.

### 11.1 Domain/unit invariant tests

Minimum proofs:

- first correction creates an immutable successor;
- multiple corrections form a linear chain;
- predecessor belongs to same memory;
- no-change rejected without generated domain output intended for persistence;
- empty content rejected;
- undo is append-only;
- history semantics mark original/current correctly.

### 11.2 Persistence/integration tests

Minimum proofs with PostgreSQL:

- correction transaction creates exactly the required new immutable records and reprojection;
- original rows remain byte/field stable where applicable;
- stale expected fact is rejected;
- two competing corrections using the same expected current fact cannot both commit successfully;
- transaction failure at a controlled intermediate step leaves no partial correction;
- history reconstructs the full chain in semantic order;
- current query ignores superseded facts;
- database-unavailable behavior remains safely mapped to service-unavailable semantics.

### 11.3 API/contract tests

Minimum proofs:

- correction success response;
- history response for one-version and multi-version memories;
- `404`, `STALE_CORRECTION`, empty input, `NO_CHANGE`, store unavailable;
- `FOUND` current-query contract exposes correction identifiers without exposing historical versions by default;
- `UNKNOWN` behavior remains intact.

### 11.4 Browser E2E

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

Additional E2E or integration coverage must prove the user-visible stale-correction behavior if practical at browser level; otherwise it must be proven at integration/API level plus a focused UI test.

## 12. Acceptance criteria

Slice 02 is acceptable only when all of the following are reproducibly demonstrated:

1. A stored textual memory can be corrected from the PWA.
2. Normal retrieval returns only the latest accepted corrected state.
3. The original evidence/fact remains preserved.
4. Every correction has its own evidence, fact and `MEMORY_CORRECTED` ledger record.
5. Multiple corrections retain a complete linear history.
6. History is visible in chronological chain order in the PWA.
7. A one-version memory has valid history.
8. Empty and no-change requests create no persistent records.
9. A stale correction cannot overwrite a newer correction.
10. Correction is transactionally atomic.
11. Undo appends a new correction instead of deleting/repointing history.
12. Existing Slice 01 deterministic retrieval, provenance, `UNKNOWN`, E2E and outage guarantees do not regress.
13. Required tests, builds, lint/typecheck/format, migrations and CI are green.
14. Evidence/PRF artifacts are sufficient for independent review and gate decision.

## 13. Explicit exclusions

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

## 14. Files/components expected to be affected during future implementation

This is a design map, not an implementation authorization.

Likely boundary-local changes include:

- `packages/domain` — correction/history domain types and invariants;
- `packages/contracts` — correction/history request/response/error contracts;
- `prisma/schema.prisma` and a versioned migration — predecessor/event traceability structure;
- `apps/api` memory application/persistence/controller layers — transactional correction and history read;
- `apps/web` memory API client and query result UI — inline correction/history;
- integration/API/UI/E2E tests;
- Slice 02 evidence, phase and PRF documentation.

Unrelated refactors are excluded.

## 15. Delivery and governance

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

## 16. Design self-review checklist

Before requesting written-spec approval, verify:

- no `TBD`/`TODO` placeholders;
- no contradiction between current-only retrieval and historical retrieval;
- stale-write rule has a database-safe concurrency requirement;
- every accepted correction is append-only except for the reconstructible `CurrentFact` projection;
- undo semantics are append-only;
- real sensitive data and pilot remain prohibited;
- offline, sync, AI, voice and purge remain out of scope;
- the scope is small enough for one implementation plan and one Slice 02 PR boundary.
