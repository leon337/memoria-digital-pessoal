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
- stable public memory/correction response contracts and validation schemas in `@mdp/contracts`;
- UUID v7 generation in `@mdp/shared`;
- a PostgreSQL `MemoryStore` implementation in the API;
- a React web application whose memory flows currently call `memory-api.ts` directly;
- an application-level API readiness check that currently gates the memory forms;
- the five conceptual product entities `Memory`, `Evidence`, `LedgerEvent`, `Fact`, and `CurrentFact` in PostgreSQL.

Slice 03 does not move IndexedDB into the domain package and does not replace the API persistence implementation. It introduces a browser-side application repository boundary and selects its IndexedDB implementation as the active persistence path for the PWA. The current API readiness gate must stop controlling whether memory operations are enabled, because an unavailable API is expected and valid during local offline operation.

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

The browser repository may depend on `@mdp/domain`, `@mdp/contracts`, and `@mdp/shared`. Domain rules and contract validation are reused rather than reimplemented inside persistence code.

### Browser application repository

The PWA introduces one application-facing `MemoryRepository` abstraction with the operations needed by the existing UI:

```text
create(text)
query(query)
correct(memoryId, { text, expectedCurrentFactId, reason? })
history(memoryId)
```

Restore remains an invocation of `correct` using the chosen historical content and the currently loaded `factId` as the concurrency base. There is no destructive rewind method.

The repository returns the existing stable contract shapes (`CreateMemoryResponse`, `MemoryQueryResponse`, `CorrectMemoryResponse`, `MemoryHistoryResponse`) so the UI does not gain persistence-specific data structures. Date values stored as IndexedDB `Date` objects are serialized to the existing ISO-8601 contract strings only at the repository/application boundary.

Before entering local persistence/domain logic, the repository reuses the existing contract validators:

- `createMemoryRequestSchema` for creation;
- `memoryQuerySchema` for query;
- `correctMemoryRequestSchema` for correction/restore.

This prevents the browser path from drifting from already approved length, whitespace, and query-validation behavior.

The current HTTP helpers remain available for API tests/regression. They are not an automatic fallback for local repository failure.

### Application composition

The top-level application constructs/injects the local `MemoryRepository` into the memory forms/components instead of passing `apiBaseUrl` as the persistence dependency of those components.

The existing API readiness check must not disable create/query/correct/history/restore. It may remain only as non-blocking diagnostic/laboratory information if retained at all. Slice 03 product readiness is based on successful local database initialization, not PostgreSQL/API availability.

If IndexedDB cannot be initialized safely, memory mutations are disabled and the application shows a local-storage failure state; online connectivity does not convert that failure into an API fallback.

## Local database

### Database identity

The browser database name for Slice 03 is exactly:

```text
mdp-local
```

Application builds must keep that name stable. Changing an application version must not silently switch to a new database name.

Schema changes use monotonically increasing IndexedDB database versions and explicit upgrade steps. Application startup must never call `deleteDatabase` as an update mechanism.

### Slice 03 schema versions

The Slice 03 shipping database version is `2` so the slice proves a real non-destructive migration path rather than only declaring future migration support.

- Version `1`: creates the five product stores with their key paths and core records.
- Version `2`: adds the indexes required by query/correction/history while preserving all valid version-1 records.

A new installation upgrading from oldVersion `0` applies the version-1 and version-2 steps in order. A migration test seeds a valid version-1 database, opens it with the current version-2 code, and proves all seeded canonical records remain present and readable.

No extra product store is introduced solely to prove migration.

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

Version 2 index: non-unique `memoryId`.

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

Version 2 indexes: non-unique `memoryId`, `factId`, and `supersedesFactId` where corresponding keys exist.

Ledger events are append-only/immutable.

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

Version 2 indexes:

- non-unique `memoryId`;
- unique `supersedesFactId` for records that contain a predecessor key.

For the root/original fact, the persisted representation omits the `supersedesFactId` property so it is not indexed as a shared `null` key. The adapter maps the missing root key back to the domain/history representation `supersedesFactId: null`. This preserves one-successor-per-predecessor without preventing multiple independent root facts.

Facts are append-only/immutable.

#### `currentFacts`

Key: `factId`, matching the current canonical projection identity.

Fields:

- `factId`
- `memoryId`
- `evidenceId`
- `content`
- `recordedAt`

Version 2 index: non-unique `memoryId`.

Slice 03 must not introduce a global database-level uniqueness assumption on `memoryId` that would prevent future multi-fact projections. Current Slice 03 logic still requires exactly one current textual fact per memory and fails safely if the local data violates that invariant.

`CurrentFact` is mutable projection state and is reconstructible from canonical local evidence/events/facts.

## Local creation transaction

Creation first validates `{ text }` through `createMemoryRequestSchema`, then uses the existing `createTextMemoryRecord` domain function with:

- the validated original text value, preserving the existing Slice 01 valid-text whitespace semantics;
- one `recordedAt` timestamp;
- UUID v7 IDs generated by `@mdp/shared`.

One IndexedDB `readwrite` transaction spans:

```text
memories + evidence + ledgerEvents + facts + currentFacts
```

The transaction writes the complete `TextMemoryRecord`.

If any write fails or the transaction aborts, the repository rejects and no success state is published to the UI. A partially persisted memory is never accepted.

The original `MEMORY_CREATED` persisted event uses no correction-only `factId`, `supersedesFactId`, or `reason` value; the local representation must preserve the same semantics as the current PostgreSQL record.

## Local deterministic query

Query input is validated/normalized by `memoryQuerySchema` before retrieval.

Normal query reads only `currentFacts`; historical versions are never returned as current answers.

The logical retrieval behavior remains the approved Slice 01 behavior:

- deterministic case-insensitive substring match;
- no embeddings, AI, fuzzy interpretation, or inferred synonyms;
- deterministic tie-break compatible with the current product contract: newest `recordedAt` first, then stable ascending `factId` order;
- no match returns `UNKNOWN` with no fabricated answer/provenance.

An old corrected statement must therefore become `UNKNOWN` when it no longer matches any current fact, while the same content remains visible through history.

Slice 03 does not introduce a semantic-search index. A bounded local scan over CurrentFact records is acceptable for this boundary; semantic/performance expansion belongs to later slices.

## Local correction transaction

Correction/restore input is validated through `correctMemoryRequestSchema` before the transactional mutation.

`correct` starts one multi-store IndexedDB `readwrite` transaction and, inside that transaction:

1. loads the target Memory;
2. reads CurrentFact rows for that memory and requires exactly one current textual fact;
3. compares its `factId` with `expectedCurrentFactId`;
4. returns the same stale semantic result when they differ;
5. invokes `createTextCorrectionRecord` using the current persisted fact as `previous`;
6. appends new Evidence;
7. appends the new Fact with explicit predecessor;
8. appends `MEMORY_CORRECTED` LedgerEvent with reason/provenance;
9. deletes the old CurrentFact record keyed by the old fact ID and inserts the new CurrentFact projection in the same transaction;
10. reports success only after the IndexedDB transaction commits.

The domain function remains the source of truth for correction normalization and `EMPTY_CORRECTION`, `TEXT_TOO_LONG`, `NO_CHANGE`, and `REASON_TOO_LONG` semantics.

`CurrentFact.recordedAt` remains the original memory recording time, exactly as in Slice 02.

### Cross-tab concurrency

The stale check and all correction writes occur in the same IndexedDB write transaction over the relevant stores. Two tabs attempting a correction from the same base must produce exactly one successful correction; the later serialized transaction observes the changed current fact and returns stale. Silent last-write-wins is forbidden.

The unique correction-predecessor index is a second persistence defense against creating two successor Facts for one predecessor.

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

- `VALIDATION_FAILED`;
- `NOT_FOUND`;
- `STALE_CORRECTION`;
- `NO_CHANGE`;
- `LOCAL_STORAGE_UNAVAILABLE` for IndexedDB unavailable/quota/transaction/storage failure;
- `LOCAL_DATA_INTEGRITY_ERROR` when persisted local invariants cannot be trusted.

These browser-operation codes are not required to become HTTP API error codes; they belong to the PWA repository/application boundary unless a later slice deliberately unifies them.

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

### Connectivity and local readiness

The application exposes a clear `Online`/`Offline` state based on browser connectivity signals.

Connectivity state is informational for Slice 03. It does not gate create/query/correct/history/restore because those operations are local.

A network transition while a local transaction is active does not cancel or invalidate that transaction.

Separately, the application tracks local repository readiness. `LOCAL_STORAGE_UNAVAILABLE` is a real blocking condition for local writes; `Offline` is not.

The existing `API pronta/API indisponível` status must no longer determine whether the memory forms are enabled.

### Controlled Service Worker updates

A newly downloaded Service Worker may wait while the current version controls an active session. The application must not unconditionally force immediate takeover in the middle of user work.

When an update is ready, the UI can expose a clear `Nova versão disponível` action. Explicit update activation may signal the waiting worker and perform a controlled reload after controller change. A normal later reload may also activate the waiting version according to the chosen implementation.

Regardless of Service Worker lifecycle, update activation must not delete or reset IndexedDB.

## IndexedDB schema migration rule

Local schema upgrades are explicit, ordered, and non-destructive.

The implementation must expose the version-1 and version-2 upgrade steps as separately testable migration logic. The version-2 upgrade adds indexes only and must not rewrite valid canonical content.

Tests must seed a version-1 database containing at least one complete valid textual memory, open it with the current version-2 code, and verify that:

- all five canonical/projection records still exist;
- query still returns the same current content/provenance;
- history remains reconstructible;
- a subsequent correction can commit normally.

A failed upgrade must not silently recreate an empty database and must not report the application as safely writable until the upgrade failure is surfaced.

## UI behavior

The existing Slice 01–02 flows remain recognizable and keep their user-level semantics:

### Create

```text
submit text
→ contract validation + domain record creation
→ local transaction
→ success only after commit
```

### Query

```text
query
→ contract validation
→ local CurrentFact retrieval
→ FOUND + provenance
or UNKNOWN
```

### Correct

```text
current result
→ Corrigir
→ prefilled current text
→ optional reason
→ contract validation
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
- The laboratory warning requiring synthetic data remains visible and applicable offline.

## Testing strategy

The cumulative regression contract remains mandatory.

### Domain and contract regression

All existing Slice 01–02 domain/contract tests continue unchanged unless a test-only adaptation is strictly required by repository injection. IndexedDB-specific behavior must not weaken existing domain or validation invariants.

### Repository tests

Automated tests must cover:

- creation validation matches `createMemoryRequestSchema`;
- query validation matches `memoryQuerySchema`;
- correction validation matches `correctMemoryRequestSchema`;
- creation writes all five product records atomically;
- failed creation leaves no partial state;
- deterministic current-only query;
- correction creates new Evidence/Fact/Event and updates CurrentFact atomically;
- no-op/invalid correction leaves storage unchanged;
- stale base leaves storage unchanged;
- concurrent same-base correction yields one success and one stale result;
- unique predecessor persistence defense prevents fact forks;
- history is root-to-tip and rejects broken lineage/provenance;
- restore appends a new correction instead of mutating old records;
- storage/quota/transaction failures do not return success;
- reopening the database preserves records;
- seeded version-1 → version-2 migration preserves records and remains writable.

Where Node-side IndexedDB emulation is used for fast tests, real-browser tests remain the acceptance authority for IndexedDB transaction and lifecycle behavior.

### Service Worker/PWA tests

Tests must prove:

- manifest/installability assets are present;
- required app shell is precached;
- API responses are not part of the memory cache strategy;
- a waiting update does not unexpectedly replace an active controller;
- update/reload preserves IndexedDB;
- the PWA can navigate/start offline after prior installation;
- API readiness does not gate local memory forms.

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
- Service Worker update activation/reload does not erase local data;
- seeded IndexedDB v1 data survives production v2 upgrade.

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
- version-1 → version-2 migration preservation proof;
- same-base multi-tab stale-write proof.

## Acceptance criteria

Slice 03 is acceptable only when all of the following are true:

1. The installed application reopens without network after a prior successful installation/load.
2. Create, query, correct, history, and restore work without network.
3. All local canonical writes are transactional; partial state is not accepted.
4. Evidence, LedgerEvent, and Fact history remain append-only.
5. CurrentFact remains reconstructible and current-only query does not surface superseded content.
6. Corrections/restores reject stale bases across tabs.
7. Reload, schema migration, and Service Worker updates preserve IndexedDB.
8. A local storage failure never appears as successful persistence.
9. Domain packages remain independent from browser persistence APIs.
10. API readiness/connectivity cannot disable otherwise healthy local memory operations.
11. No automatic import, dual-write, fallback routing, or synchronization is introduced.
12. All cumulative Slice 01–02 tests and E2E remain green.
13. Evidence uses synthetic, non-sensitive laboratory data only.

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
