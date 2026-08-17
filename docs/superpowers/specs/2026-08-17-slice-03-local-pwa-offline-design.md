# Slice 03 — Local PWA + Offline — Design

## Status

- Mission: `MDP-001 — Memória Digital Pessoal`
- Boundary: `SLICE 03 — Local PWA + Offline`
- Design status: `APPROVED_BY_LEANDRO`
- Approved approach: `A — explicit local repository`
- Authorization to enter Slice 03 design/planning: granted by LEANDRO on `2026-08-17`
- Design approval: granted by LEANDRO on `2026-08-17`
- Design branch: `design/slice-03-local-offline`
- Implementation authorization: `NOT GRANTED`
- Real sensitive data: `NOT AUTHORIZED`
- Pilot: `NOT AUTHORIZED`

## Objective

Make the already approved textual-memory product flows fully usable on one browser/device without network access while preserving the trust properties established by Slices 01–02.

The Slice 03 product flow is:

```text
installed PWA
  → local application shell available offline
  → IndexedDB behind a repository boundary
  → create/query/correct/history/restore without network
  → atomic local persistence
  → reload/reopen without losing data
```

Synchronization is deliberately not part of this boundary. Local/server convergence begins only in Slice 04.

## Context from the current codebase

The current `main` baseline already contains:

- pure memory and correction rules in `@mdp/domain`;
- stable public memory/correction response contracts in `@mdp/contracts`;
- UUID v7 generation in `@mdp/shared`;
- a PostgreSQL `MemoryStore` implementation in the API;
- a React PWA candidate whose memory flows currently call `memory-api.ts` directly;
- the five conceptual product entities `Memory`, `Evidence`, `LedgerEvent`, `Fact`, and `CurrentFact` in PostgreSQL.

Slice 03 does not move IndexedDB into the domain package and does not replace the API persistence implementation. It introduces a browser-side application repository boundary and selects its IndexedDB implementation as the active persistence path for the PWA.

## Approved product decisions

LEANDRO approved the following decisions during design:

1. Offline operation covers the complete delivered flow: create, query, correct, view history, and restore a prior version by append-only correction.
2. The PWA uses local IndexedDB as its active memory source in Slice 03; it does not switch between API and IndexedDB at runtime.
3. IndexedDB represents the same five conceptual entities: Memory, Evidence, LedgerEvent, Fact, and CurrentFact.
4. The Service Worker caches only the application shell and versioned static assets, never memory/API response data.
5. Mutating local operations are all-or-nothing IndexedDB transactions across every required object store.
6. UUID v7 identifiers are created on the client and are permanent identifiers; Slice 04 must not remap them merely because synchronization begins.
7. Reloads and application updates preserve IndexedDB data; schema evolution is versioned and non-destructive.
8. The UI clearly indicates offline state, but offline is not treated as an error when a local operation can complete.
9. Existing PostgreSQL memories are not automatically imported into IndexedDB in Slice 03.
10. Corrections/restores use `expectedCurrentFactId`; a stale base is rejected instead of silently overwriting a concurrent local change.
11. Service Worker updates are controlled; a waiting version does not unexpectedly take over an active session.
12. Local persistence is fail-safe: no completed IndexedDB transaction means no user-visible success.
13. The selected architecture is an explicit local repository implementation, not an API/IndexedDB hybrid and not duplicated local domain logic.

## Architecture

```text
React UI
  │
  ▼
MemoryRepository (browser application boundary)
  │
  └── IndexedDbMemoryRepository
        │
        ├── memories
        ├── evidence
        ├── ledgerEvents
        ├── facts
        └── currentFacts

Service Worker
  └── app shell + static versioned assets

Existing NestJS API + PostgreSQL
  └── retained and regression-tested, but not used by normal PWA memory flows in Slice 03
```

### Dependency rule

`@mdp/domain` must remain browser/storage neutral. It must not import IndexedDB, Service Worker, `window`, `navigator`, Cache Storage, Vite PWA tooling, or any other browser infrastructure API.

The browser repository may depend on `@mdp/domain`, `@mdp/contracts`, and `@mdp/shared`. Domain rules are reused rather than reimplemented inside persistence code.

### Browser application repository

The PWA introduces one application-facing `MemoryRepository` abstraction with the operations needed by the existing UI:

```text
create(text)
query(query)
correct(memoryId, { text, expectedCurrentFactId, reason? })
history(memoryId)
```

Restore remains an invocation of `correct` using the chosen historical content and the currently displayed/loaded `factId` as the concurrency base. There is no destructive rewind method.

The repository returns the existing stable contract shapes (`CreateMemoryResponse`, `MemoryQueryResponse`, `CorrectMemoryResponse`, `MemoryHistoryResponse`) so the UI does not gain persistence-specific data structures.

The current HTTP helpers remain available for API tests/regression. They are not an automatic fallback for local repository failure.

## Local database

### Database identity

The browser database name is stable for this product boundary, for example `mdp-local`. Changing an application build must not silently switch to a new database name.

Schema changes use monotonically increasing IndexedDB database versions and explicit upgrade steps. Application startup must never call `deleteDatabase` as an update mechanism.

### Product object stores

Slice 03 has exactly five product object stores:

#### `memories`

Key: `id`.

Fields mirror the current Memory model:

- `id`
- `recordedAt`
- `occurredAt` (`null` in the current boundary)
- `temporalPrecision` (`unknown` in the current boundary)

#### `evidence`

Key: `id`.

Fields:

- `id`
- `memoryId`
- `kind`
- `content`
- `createdAt`

Index by `memoryId`.

Evidence is append-only/immutable.

#### `ledgerEvents`

Key: `id`.

Fields:

- `id`
- `memoryId`
- `evidenceId`
- `factId` when applicable
- `supersedesFactId` when applicable
- `type`
- `reason` when applicable
- `createdAt`

Indexes support lookup by `memoryId` and correction provenance. Ledger events are append-only/immutable.

#### `facts`

Key: `id`.

Fields:

- `id`
- `memoryId`
- `evidenceId`
- `kind`
- `content`
- `supersedesFactId` for correction facts
- `createdAt`

Indexes support lookup by `memoryId` and predecessor. The predecessor index for correction facts must enforce a single successor for one predecessor. The root/original representation must not create a shared indexed `null` key that prevents multiple independent memories; the adapter maps the persistence representation back to the domain's `null` root semantics.

Facts are append-only/immutable.

#### `currentFacts`

Key: `factId`, matching the current canonical projection identity.

Fields:

- `factId`
- `memoryId`
- `evidenceId`
- `content`
- `recordedAt`

An index by `memoryId` supports correction/history lookup. Slice 03 must not introduce a global database-level uniqueness assumption on `memoryId` that would prevent future multi-fact projections; current Slice 03 logic still requires exactly one current textual fact per memory and fails safely if the local data violates that invariant.

`CurrentFact` is mutable projection state and is reconstructible from canonical local evidence/events/facts.

## Local creation transaction

Creating a memory uses the existing `createTextMemoryRecord` domain function with:

- validated user text;
- one `recordedAt` timestamp;
- UUID v7 IDs generated by `@mdp/shared`.

One IndexedDB `readwrite` transaction spans:

```text
memories + evidence + ledgerEvents + facts + currentFacts
```

The transaction writes the complete `TextMemoryRecord`.

If any write fails or the transaction aborts, the repository rejects and no success state is published to the UI. A partially persisted memory is never accepted.

## Local deterministic query

Normal query reads only `currentFacts`; historical versions are never returned as current answers.

The logical retrieval behavior remains the approved Slice 01 behavior:

- deterministic case-insensitive substring match;
- no embeddings, AI, fuzzy interpretation, or inferred synonyms;
- deterministic tie-break compatible with the current product contract: newest `recordedAt` first, then stable `factId` order;
- no match returns `UNKNOWN` with no fabricated answer/provenance.

An old corrected statement must therefore become `UNKNOWN` when it no longer matches any current fact, while the same content remains visible through history.

## Local correction transaction

`correct` starts one multi-store IndexedDB `readwrite` transaction and, inside that transaction:

1. loads the target Memory;
2. reads CurrentFact rows for that memory and requires exactly one current textual fact;
3. compares its `factId` with `expectedCurrentFactId`;
4. returns the same stale semantic result when they differ;
5. invokes `createTextCorrectionRecord` using the current persisted fact as `previous`;
6. appends new Evidence;
7. appends the new Fact with explicit predecessor;
8. appends `MEMORY_CORRECTED` LedgerEvent with reason/provenance;
9. replaces the old CurrentFact projection with the newly returned projection;
10. reports success only after the IndexedDB transaction commits.

The domain function remains the source of truth for correction normalization and `EMPTY_CORRECTION`, `TEXT_TOO_LONG`, `NO_CHANGE`, and `REASON_TOO_LONG` semantics.

`CurrentFact.recordedAt` remains the original memory recording time, exactly as in Slice 02.

### Cross-tab concurrency

The stale check and all correction writes occur in the same IndexedDB write transaction over the relevant stores. Two tabs attempting a correction from the same base must produce exactly one successful correction; the later serialized transaction observes the changed current fact and returns stale. Silent last-write-wins is forbidden.

No tab may bypass `expectedCurrentFactId`.

## Local history and restore

History is reconstructed from local `facts`, `evidence`, `ledgerEvents`, and `currentFacts`, not from timestamps alone.

The repository reuses `orderTextFactHistory` to require:

- exactly one root;
- no duplicate successor;
- no cycle;
- no disconnected fact;
- current Fact is the tip;
- every fact and event belongs to the requested Memory;
- every fact's content/provenance agrees with its Evidence;
- exactly one creation event identifies the root;
- exactly one correction event identifies each correction fact.

Broken/corrupt local history fails safely and is never rendered as trustworthy history.

Restore is append-only: selecting an old version submits its text as a new correction against the current `factId`. Original evidence and all prior corrections remain intact.

## Error model and fail-safe behavior

The UI must not depend on HTTP-specific exceptions once the local repository is active.

The browser application boundary maps failures into stable operation semantics including:

- validation failure;
- not found;
- stale correction;
- no change;
- `LOCAL_STORAGE_UNAVAILABLE` for IndexedDB unavailable/quota/transaction/storage failure;
- a safe integrity failure when persisted local invariants are broken.

Storage/integrity errors shown to the user must not leak submitted memory text, raw IndexedDB internals, stack traces, object-store dumps, or technical UUIDs.

Mutation failures are not automatically retried. A retry requires an explicit new user action so that duplicate evidence/events cannot be created by hidden retries.

The UI may retain the user's unsaved form text in component memory after a failed local write, but it must not present that text as persisted truth and must not synthesize canonical records outside IndexedDB.

## PWA and Service Worker

### Installability

The web application becomes an installable PWA with a Web App Manifest, stable start URL/scope, standalone-capable display configuration, and required static icon assets.

The existing functional UI remains the product surface; Slice 03 does not redesign unrelated screens.

### Cache boundary

The Service Worker precaches only the application shell and versioned static assets needed to start the PWA offline.

It must not cache or synthesize memory API responses. Cache Storage is not a second memory datastore.

The following are explicitly forbidden in Slice 03:

- API response persistence as a substitute for IndexedDB;
- network-first/local fallback memory routing;
- dual-write to API and IndexedDB;
- Background Sync of memory operations;
- queued server mutations;
- automatic import of PostgreSQL memories.

### Offline reopen

After one successful online installation/load that has installed the Service Worker and cached the required shell, the user must be able to:

1. close the PWA/browser context;
2. lose network access;
3. reopen the application at its normal start URL;
4. load the UI entirely from the Service Worker cache;
5. read/write the local memory database through IndexedDB.

An unavailable NestJS API or PostgreSQL database must not prevent these local flows.

### Connectivity indicator

The application exposes a clear `Online`/`Offline` state based on browser connectivity signals.

Connectivity state is informational for Slice 03. It does not gate create/query/correct/history/restore because those operations are local.

A network transition while a local transaction is active does not cancel or invalidate that transaction.

### Controlled Service Worker updates

A newly downloaded Service Worker may wait while the current version controls an active session. The application must not unconditionally force immediate takeover in the middle of user work.

When an update is ready, the UI can expose a clear `Nova versão disponível` action. Explicit update activation may signal the waiting worker and perform a controlled reload after controller change. A normal later reload may also activate the waiting version according to the chosen implementation.

Regardless of Service Worker lifecycle, update activation must not delete or reset IndexedDB.

## IndexedDB schema migration rule

Local schema upgrades are explicit, ordered, and non-destructive.

The implementation must provide a migration structure in which each version transition is identifiable and testable. Tests must prove at least one real upgrade path using a seeded older-version database fixture and verify that existing canonical records remain present and readable after opening the current schema.

A failed upgrade must not silently recreate an empty database and must not report the application as safely writable until the upgrade failure is surfaced.

## UI behavior

The existing Slice 01–02 flows remain recognizable and keep their user-level semantics:

### Create

```text
submit text
→ domain validation/record creation
→ local transaction
→ success only after commit
```

### Query

```text
query
→ local CurrentFact scan/indexed retrieval
→ FOUND + provenance
or UNKNOWN
```

### Correct

```text
current result
→ Corrigir
→ prefilled current text
→ optional reason
→ stale-safe local transaction
→ current result updates only after commit
```

### History

```text
Ver histórico
→ reconstruct explicit local fact chain
→ original → corrections → current
```

### Restore

```text
choose old version
→ submit old text as a new correction
→ append new Evidence/Fact/Event
→ current projection moves to new tip
```

Rules:

- Offline is not displayed as an operation error by itself.
- UUIDs remain hidden from normal product presentation.
- A stale correction blocks silent continuation; the user must refresh/requery the current local state before editing again.
- A storage failure never produces `Memória salva` or `Correção salva`.
- First local use may legitimately have no memories even if the separate PostgreSQL laboratory store contains records; Slice 03 performs no import.

## Testing strategy

The cumulative regression contract remains mandatory.

### Domain regression

All existing Slice 01–02 domain tests continue unchanged unless a test-only adaptation is strictly required by repository injection. IndexedDB-specific behavior must not weaken existing domain invariants.

### Repository tests

Automated tests must cover:

- creation writes all five product records atomically;
- failed creation leaves no partial state;
- deterministic current-only query;
- correction creates new Evidence/Fact/Event and updates CurrentFact atomically;
- no-op/invalid correction leaves storage unchanged;
- stale base leaves storage unchanged;
- concurrent same-base correction yields one success and one stale result;
- history is root-to-tip and rejects broken lineage/provenance;
- restore appends a new correction instead of mutating old records;
- storage/quota/transaction failures do not return success;
- reopening the database preserves records;
- an explicit seeded older-schema upgrade preserves records.

Where Node-side IndexedDB emulation is used for fast tests, real-browser tests remain the acceptance authority for IndexedDB transaction and lifecycle behavior.

### Service Worker/PWA tests

Tests must prove:

- manifest/installability assets are present;
- required app shell is precached;
- API responses are not part of the memory cache strategy;
- a waiting update does not unexpectedly replace an active controller;
- update/reload preserves IndexedDB;
- the PWA can navigate/start offline after prior installation.

### Browser E2E acceptance flow

At least one synthetic Chromium E2E scenario must prove:

```text
load/install online
→ create local memory
→ close/reopen context
→ set browser offline
→ reopen PWA
→ query current memory
→ correct it
→ old text becomes UNKNOWN
→ query new current text
→ view full history
→ restore original text by append-only correction
→ verify three-version chain
→ reload while still offline
→ verify restored current state and history remain intact
```

Additional browser acceptance must prove:

- no memory API call is required for the approved local flow;
- API/PostgreSQL unavailability does not break local operation;
- visible Offline state is correct during the offline scenario;
- two tabs sharing the same origin cannot silently overwrite the same current fact;
- local persistence failure does not show false success;
- Service Worker update activation/reload does not erase local data.

## CI progression

Slice 03 CI extends, rather than replaces, existing CI.

It must continue to prove:

- PostgreSQL migrations/schema checks;
- all Slice 01–02 API/persistence regression tests;
- typecheck;
- lint;
- format;
- existing PRF manifests;
- build/runtime checks;
- existing E2E;
- existing PostgreSQL outage safe-envelope proof.

It adds:

- IndexedDB repository tests;
- Slice 03 architecture boundary test preventing browser/IndexedDB dependencies from entering `@mdp/domain`;
- PWA/Service Worker build verification;
- offline browser E2E;
- local persistence failure proof;
- migration preservation proof;
- same-base multi-tab stale-write proof.

## Acceptance criteria

Slice 03 is acceptable only when all of the following are true:

1. The installed application reopens without network after a prior successful installation/load.
2. Create, query, correct, history, and restore work without network.
3. All local canonical writes are transactional; partial state is not accepted.
4. Evidence, LedgerEvent, and Fact history remain append-only.
5. CurrentFact remains reconstructible and current-only query does not surface superseded content.
6. Corrections/restores reject stale bases across tabs.
7. Reload and Service Worker updates preserve IndexedDB.
8. A local storage failure never appears as successful persistence.
9. Domain packages remain independent from browser persistence APIs.
10. No automatic import, dual-write, or synchronization is introduced.
11. All cumulative Slice 01–02 tests and E2E remain green.
12. Evidence uses synthetic, non-sensitive laboratory data only.

## Explicitly out of scope

The following are not part of Slice 03:

- synchronization between IndexedDB and PostgreSQL;
- import/export between local and server memory stores;
- event upload/download;
- idempotent synchronization protocol;
- inter-device conflict resolution;
- server/local convergence;
- Transactional Outbox;
- Background Sync;
- Redis;
- BullMQ;
- workers for synchronization;
- semantic retrieval or pgvector;
- AI/embeddings;
- voice/STT/TTS;
- reminders/proactivity;
- authentication/security hardening beyond regression of existing behavior;
- backup/restore/purge product capability;
- real sensitive data;
- controlled pilot.

These remain assigned to later roadmap boundaries, especially `SLICE 04 — Synchronization` for local/server convergence.

## Invariants carried forward

Slice 03 must preserve all approved earlier invariants, including:

1. Evidence plus Memory Ledger are canonical records.
2. Original evidence is never silently overwritten.
3. Corrections append evidence/facts/events rather than mutating history.
4. Current state is a projection and remains reconstructible.
5. No evidence means `UNKNOWN`.
6. AI cannot promote itself to canonical truth; no AI is used here.
7. A failed write cannot leave accepted partial canonical state.
8. Stale corrections cannot silently win.
9. Restore is a new append-only correction, not destructive rewind.
10. Normal query returns current state only.
11. Broken provenance/history fails safely.
12. Only synthetic non-sensitive data is authorized.

## Gate boundary

Approval of this design does not authorize product implementation.

After this document is written, committed, self-reviewed, and explicitly approved as the written specification by LEANDRO, the next allowed activity is creation of the detailed Slice 03 implementation plan. Implementation itself requires separate explicit authorization and must occur on a fresh Slice 03 implementation branch/worktree under the project governance and cumulative Definition of Done.
