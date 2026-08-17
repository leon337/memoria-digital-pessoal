# Slice 04 — Synchronization — Design

Date: 2026-08-17
Status: DESIGN APPROVED IN DIALOGUE / WRITTEN SPEC PENDING HUMAN REVIEW
Repository baseline: `main@0637cbd32ed7e4a3b484cfebf771f9871cad2eb8`
Design branch: `design/slice-04-synchronization`

## 1. Governance and authorization boundary

LEANDRO authorized the MDP program to proceed sequentially through definition, design, and planning for Slices 04–11, starting with Slice 04. That authorization explicitly does **not** authorize implementation or merge.

For Slice 04:

- definition/design/planning: AUTHORIZED;
- implementation: NOT AUTHORIZED;
- merge: NOT AUTHORIZED;
- real sensitive data: NOT AUTHORIZED;
- pilot: NOT AUTHORIZED;
- Slice 05 implementation: NOT AUTHORIZED.

The required lifecycle remains:

`design → human approval → plan → explicit implementation authorization → implementation → tests → E2E → evidence → review → CI → HUMAN_GATE merge`

This document records the design approved section-by-section in dialogue. It is not an implementation authorization.

## 2. Objective

Slice 04 connects the local-first IndexedDB memory repository delivered in Slice 03 with the PostgreSQL-backed server boundary delivered in earlier slices.

The goal is **reliable bidirectional synchronization with idempotency, retry, conflict preservation, and convergence** while preserving the MDP invariants:

- Evidence and Ledger history are not silently overwritten;
- conflicts remain explicit;
- AI is not canonical truth;
- current state remains reconstructible;
- transient failures cannot become data loss;
- local operation remains functional offline.

The synchronization protocol is event-oriented. It does not replace the local repository with a server cache and does not introduce server-wins semantics.

## 3. Baseline

At the Slice 03 boundary:

- the PWA uses a local `MemoryRepository` backed by IndexedDB;
- IndexedDB stores `Memory`, `Evidence`, `LedgerEvent`, `Fact`, and `CurrentFact`;
- local create/correct/history/restore operate without server persistence;
- UUID v7 identifiers are generated client-side and are definitive;
- PostgreSQL contains the corresponding canonical product structures for the server path;
- there is no active synchronization between the two persistence boundaries.

Slice 04 must connect these boundaries without data remapping or silent replacement.

## 4. High-level architecture

```text
┌─────────────────────────────────────┐
│              PWA / React            │
│                                     │
│  MemoryRepository                   │
│        │                            │
│        ▼                            │
│  IndexedDB mdp-local                │
│  ├── memories                       │
│  ├── evidence                       │
│  ├── ledgerEvents                   │
│  ├── facts                          │
│  ├── currentFacts                   │
│  ├── factRelations                  │
│  ├── syncOutbox                     │
│  ├── syncState                      │
│  ├── syncConflicts                  │
│  └── bootstrap staging              │
│        │                            │
│        ▼                            │
│  SyncEngine                         │
│  ├── bootstrap                      │
│  ├── push                           │
│  ├── pull                           │
│  ├── retry/backoff                  │
│  └── reprojection                   │
└─────────────────┬───────────────────┘
                  │ HTTP / protocol v1
                  ▼
┌─────────────────────────────────────┐
│              NestJS API             │
│                                     │
│  SyncController / SyncService       │
│        │                            │
│        ▼                            │
│  PostgreSQL                         │
│  ├── memories                       │
│  ├── evidence                       │
│  ├── ledger_events                  │
│  ├── facts                          │
│  ├── current_facts                  │
│  ├── fact_relations                 │
│  ├── conflict projection            │
│  └── sync_outbox                    │
└─────────────────────────────────────┘
```

### Architectural rules

1. The PWA remains local-first. Offline create, query, correction, history, and restore remain functional.
2. PostgreSQL coordinates durable convergence but does not win conflicts by authority.
3. Evidence, Ledger events, Facts, and causal relations form the canonical historical basis.
4. `CurrentFact`, conflict state, and synchronization status are reconstructible projections.
5. Synchronization is event-oriented; the UI does not dual-write to IndexedDB and the API.
6. The server uses a Transactional Outbox.
7. Redis, BullMQ, WebSocket, and mandatory Service Worker Background Sync are outside this Slice unless a demonstrated requirement invalidates this design.

## 5. Synchronization direction and convergence authority

Synchronization is fully bidirectional:

```text
Device → Server
Device ← Server
```

The server is the common durable coordination point for multiple devices, but canonical truth is not defined as "whatever the server currently says". Conflict resolution is causal and explicit.

After successful synchronization, all participating replicas must be able to converge to the same causal graph and the same reconstructible projections.

## 6. Synchronization unit

The synchronization unit is an immutable domain event plus the immutable dependencies required to apply it.

Initial event types in scope are:

- `MEMORY_CREATED`;
- `MEMORY_CORRECTED`;
- `CONFLICT_RESOLVED`.

Deletion/purge event semantics are not introduced in Slice 04.

`CurrentFact` is not transported as an independent source of truth. It is reprojected from canonical records.

## 7. Causal model: Fact graph

### 7.1 Why the Slice 03 linear model must evolve

The Slice 03 model represents correction with a single `supersedesFactId`, and the existing uniqueness constraint prevents two successor facts from pointing at the same predecessor. That cannot represent a real concurrent branch.

Slice 04 therefore moves to explicit N:N causal relations.

### 7.2 FactRelation

Conceptual model:

```text
FactRelation
├── predecessorFactId
├── successorFactId
└── relationType = SUPERSEDES
```

It supports:

```text
normal correction:
A → B

concurrent branch:
A → B
A → C

explicit resolution:
B → D
C → D
```

A predecessor may have multiple successors and a resolution fact may have multiple predecessors.

### 7.3 Migration

The Slice 04 migration must:

1. create the relation structure;
2. convert each existing linear `supersedesFactId` into an equivalent `FactRelation`;
3. preserve all existing UUIDs and historical content;
4. validate that all previous causal edges remain represented;
5. stop treating the old field as the definitive causal representation.

No history is invented and no identifiers are remapped.

## 8. Current state and conflicts

### 8.1 Normal state

For a non-conflicted chain:

```text
A → B → C
CurrentFact = C
```

### 8.2 Open conflict

For concurrent successors:

```text
    A
   / \
  B   C
```

The projection is conceptually:

```text
ConflictProjection
├── memoryId
├── baselineFactId = A
├── candidateFactIds = [B, C]
├── status = OPEN
└── resolutionFactId = null
```

`A` remains the last non-contested baseline, but normal queries must not silently present A, B, or C as a resolved current truth. They must expose the conflict state.

### 8.3 Human resolution

Conflict resolution is explicit and append-only. The user may choose one candidate or provide new content, but the resolution always creates a new Fact and Ledger event.

```text
B ─┐
   ├→ D
C ─┘
```

`D` becomes current only after the resolution is non-contested.

If two devices independently resolve the same conflict before synchronizing, those resolution events may themselves branch. The same causal rules apply recursively; there is no special last-write-wins rule for resolutions.

## 9. Protocol versioning

Every synchronization contract carries an explicit `protocolVersion`.

Unknown or unsupported protocol versions fail closed:

- no canonical write;
- no local pending event removal;
- no cursor advancement;
- stable error such as `SYNC_PROTOCOL_UNSUPPORTED`;
- UI may require application update.

URL versioning alone is insufficient because persisted/retried envelopes must identify their own contract version.

## 10. Client instance identity

Each PWA installation owns a persistent opaque `clientInstanceId` generated as UUID v7.

It identifies an installation operationally and may be used for diagnostics, origin metadata, and multi-device tests.

It is explicitly **not**:

- a user identity;
- a credential;
- proof of authorization;
- a trusted-device assertion.

Authentication, passkeys, trusted sessions, and secure user-device association remain Slice 09 concerns.

## 11. Protocol operations

Synchronization consists of three explicit operations:

1. `bootstrap` — establish/re-establish a consistent local base;
2. `push` — send pending local events;
3. `pull` — receive ordered server feed entries after a confirmed cursor.

A normal foreground session follows `push → pull → repeat until converged`, with dependency recovery allowed between cycles.

### 11.1 Bootstrap

Bootstrap is required for:

- first synchronization of a device;
- recovery after cursor expiration.

The server captures a consistent logical snapshot and a `highWatermarkCursor` at the same boundary. Snapshot and cursor must not be read independently.

Conceptual start response:

```text
BootstrapStartResponse
├── protocolVersion
├── bootstrapToken
├── highWatermarkCursor
└── page metadata
```

The bootstrap is paginated over one fixed snapshot identified by `bootstrapToken`. New writes occurring after the snapshot belong to later `pull` results after `highWatermarkCursor`.

The token has limited operational validity and is not an authentication credential.

### 11.2 Bootstrap staging

Bootstrap pages are first written to isolated local staging. Partial snapshots must not appear as synchronized state.

Only after all expected pages are received and validated is the bootstrap promoted atomically into the local canonical stores/projections and the high-watermark cursor confirmed.

If bootstrap fails or expires:

- incomplete staging may be discarded;
- existing local data remains usable;
- local pending events remain preserved;
- cursor is not advanced;
- bootstrap can restart safely.

If bootstrap data conflicts with local pending history, both branches are preserved and an explicit conflict is opened. Neither server-wins nor local-wins semantics apply.

### 11.3 Push

`push` sends a limited batch of local pending events.

Conceptual request:

```text
PushRequest
├── protocolVersion
├── clientInstanceId
└── events[]
    ├── eventId
    ├── eventType
    ├── memoryId
    ├── causalMetadata
    └── immutablePayload
```

Processing is atomic per event, not per batch. One invalid/conflicted event does not roll back independent events whose dependencies are satisfied.

Stable per-event outcomes include:

- `APPLIED`;
- `ALREADY_APPLIED`;
- `CONFLICT`;
- `DEPENDENCY_MISSING`;
- `BLOCKED`;
- `INVALID` / integrity-specific errors.

A conflict result may mean the event was durably preserved but opened/extended a conflict; it is not equivalent to data loss.

### 11.4 Pull

`pull` reads entries strictly after the client's last confirmed cursor, ordered by the server Outbox sequence.

Conceptual response:

```text
PullResponse
├── protocolVersion
├── events[]
│   ├── sequence
│   ├── eventId
│   ├── eventType
│   └── immutablePayload
├── nextCursor
└── hasMore
```

One page is applied to IndexedDB in one transaction, including reprojection and cursor update. If any part fails, the transaction rolls back and the cursor remains unchanged.

Repeated delivery of the same page must remain safe.

## 12. Idempotency

The canonical `eventId` is the synchronization idempotency key. Retry never generates a new event identifier.

Server rules:

- unknown valid `eventId` → validate and apply;
- same `eventId` + equivalent immutable content → `ALREADY_APPLIED`;
- same `eventId` + different content → integrity violation, no write.

This produces exactly-once logical effects over a transport that may deliver at least once.

## 13. Causality and out-of-order delivery

Timestamps, network arrival order, and UUID ordering do not determine causal truth.

Causality is represented by explicit Fact relations and expected predecessor references.

If an event arrives before a required predecessor, the server returns `DEPENDENCY_MISSING` and identifies the missing dependency where possible. No partial canonical write and no Outbox entry are created for that rejected attempt.

The client preserves the event, synchronizes/obtains the dependency, and retries using the same `eventId`.

The server does not maintain an indefinite queue of incomplete orphan events in this Slice.

## 14. Server Transactional Outbox

The server writes canonical changes and the corresponding synchronization envelope in one PostgreSQL transaction.

Conceptually:

```text
BEGIN
  canonical domain writes
  FactRelation writes
  reconstructible projection updates
  SyncOutbox write
COMMIT
```

Any failure rolls back the complete operation.

### 14.1 Outbox record

Conceptual fields:

```text
SyncOutbox
├── sequence
├── eventId
├── protocolVersion
├── eventType
├── memoryId
├── originClientInstanceId
├── immutablePayload
└── createdAt
```

`sequence` is monotonic server feed ordering. It is operational ordering only; it does not establish causality or truth.

The payload is immutable and self-contained for client application. It includes the canonical records needed by the event, such as Ledger event, Evidence, Fact, and Fact relations. Projections are reconstructed, not treated as canonical payload truth.

## 15. Outbox retention and cursor expiration

The server Outbox has configurable operational retention. It is not a second permanent Ledger.

Removing old Outbox rows must never remove corresponding Evidence, Ledger events, Facts, or causal relations.

If a client cursor predates the oldest available retained sequence, the server returns a stable `CURSOR_EXPIRED` outcome and the client performs safe rebootstrap while preserving local pending work.

No fixed semantic retention period is embedded in the domain contract.

## 16. Local IndexedDB evolution

Slice 04 evolves the local database non-destructively. The shipping version number is determined in the implementation plan, but the migration must add dedicated structures equivalent to:

```text
existing product stores
├── memories
├── evidence
├── ledgerEvents
├── facts
└── currentFacts

new causal domain structure
└── factRelations

sync infrastructure
├── syncOutbox
├── syncState
└── syncConflicts

bootstrap infrastructure
└── isolated staging
```

These stores remain separated by responsibility:

- `factRelations` = canonical causal graph structure;
- `syncOutbox` / `syncState` = operational synchronization state;
- `syncConflicts` = reconstructible conflict projection;
- staging = incomplete bootstrap isolation.

The migration must preserve existing data and UUIDs and remain writable after upgrade. If migration cannot preserve integrity, it must fail rather than silently drop records.

## 17. Local write atomicity

A local create/correct/resolve action and its local synchronization pending record belong to the same IndexedDB transaction.

There must be no successful local domain mutation that becomes undiscoverable by the synchronization engine because its pending-sync write failed.

The UI continues to call the local repository, not a dual-write facade.

## 18. SyncEngine

A dedicated `SyncEngine` coordinates transport without becoming a truth-decider.

Responsibilities:

- detect pending work;
- bootstrap/rebootstrap;
- issue paginated push;
- pull by cursor;
- apply pull pages atomically;
- resolve `DEPENDENCY_MISSING` workflows;
- run retry/backoff;
- reproject operational status and conflicts;
- expose synchronization state to the UI.

It must not overwrite immutable Evidence, choose conflict winners, or bypass causal validation.

## 19. Retry policy

Automatic retries run in foreground using limited exponential backoff plus jitter.

Useful triggers include:

- application launch while online;
- transition from offline to online;
- pending work detection;
- explicit `Synchronize now` user action.

Transient failures such as network errors, timeouts, and retryable 5xx responses enter retry wait. Permanent/integrity/protocol/conflict states do not loop indefinitely.

Reload or application close never removes pending work.

Mandatory Service Worker Background Sync is not required for correctness.

## 20. UI synchronization state

The UI exposes both global state and, when useful, per-memory state.

Global examples:

- `OFFLINE`;
- `SYNCED`;
- `PENDING`;
- `SYNCING`;
- `CONFLICT`;
- `ERROR`.

Per-memory examples:

- `LOCAL_PENDING`;
- `SYNCING`;
- `SYNCED`;
- `CONFLICT`;
- `BLOCKED`.

These are operational projections and are not fields of canonical Memory/Fact truth.

The UI must distinguish local persistence from remote synchronization. For example, an offline creation may truthfully say "saved on this device; synchronization pending" and must not claim remote synchronization before confirmation.

## 21. Batching and pagination

Push, pull, and bootstrap use bounded pages/batches.

Rules:

- server defines a maximum supported batch size;
- client may request a lower limit;
- pull order is server Outbox sequence order;
- no cursor advancement before local page commit;
- failed pages can be retried from the last confirmed cursor;
- oversized payloads are rejected before partial canonical writes;
- bootstrap pages all belong to the same snapshot token.

Streaming is not required.

## 22. Authentication and security boundary

Slice 04 is implemented and validated using synthetic/controlled data. It does not claim a finished user-authentication security boundary.

`clientInstanceId` must never be interpreted as authenticated identity.

The protocol must be designed so Slice 09 can place authenticated principal/session/device authorization in front of synchronization without changing the causal model.

Completion of Slice 04 does not authorize real sensitive data.

## 23. Deletion and purge boundary

Slice 04 does not introduce deletion/purge synchronization semantics.

Out of scope:

- `MEMORY_DELETED` semantics;
- purge propagation;
- content tombstone rules;
- remote wipe;
- removal across projections/embeddings/media/caches/synced clients.

These belong to Slice 10. Outbox retention is operational cleanup and must never be confused with purge.

## 24. Infrastructure boundary

The Slice 04 baseline is NestJS + PostgreSQL + IndexedDB.

Not required in this Slice:

- Redis;
- BullMQ;
- separate worker process;
- WebSocket real-time channel;
- peer-to-peer synchronization;
- mandatory Service Worker Background Sync.

These may be introduced later only when a proven requirement justifies the complexity.

## 25. Error model

The implementation plan must define stable synchronization error/result codes consistent with this design. At minimum, semantics must exist for:

- protocol unsupported;
- cursor expired;
- bootstrap expired;
- dependency missing;
- conflict;
- integrity violation;
- transient service unavailability;
- blocked/permanent pending work.

HTTP status is transport metadata; clients must consume stable structured sync codes rather than infer semantics only from generic HTTP status.

## 26. Test strategy

### 26.1 Unit tests

Must cover at least:

- local Outbox creation;
- event idempotency;
- backoff calculation/classification;
- cursor evolution;
- dependency missing;
- branching detection;
- CurrentFact reprojection;
- conflict reprojection;
- multi-predecessor resolution;
- protocol-version rejection.

### 26.2 Persistence/transaction tests

IndexedDB must prove:

- local domain write + pending-sync write are atomic;
- pull page + projections + cursor are atomic;
- bootstrap staging/promotion preserves preexisting local work;
- migration from Slice 03 data is non-destructive.

PostgreSQL must prove with the real database engine:

- canonical write + FactRelation + SyncOutbox are atomic;
- transaction rollback prevents partial canonical/outbox states;
- idempotent replay does not duplicate canonical history.

### 26.3 Protocol contract tests

Must exercise stable outcomes including:

- `APPLIED`;
- `ALREADY_APPLIED`;
- `CONFLICT`;
- `DEPENDENCY_MISSING`;
- `CURSOR_EXPIRED`;
- protocol unsupported;
- integrity violation;
- bootstrap token expiration;
- pagination and limits.

### 26.4 Required E2E scenarios

At minimum:

1. offline create/correct → online sync → server/local converge;
2. server commits but response is lost → retry same event → no duplication;
3. device A creates → device B pulls → same IDs/state;
4. two devices correct the same predecessor → both branches preserved → conflict open;
5. human resolves conflict → all replicas converge → prior branches remain in history;
6. dependent event arrives before predecessor → `DEPENDENCY_MISSING` → dependency recovery → retry succeeds;
7. new empty device bootstraps existing server history and then pulls incrementally;
8. bootstrap encounters local pending branch against server branch → both preserved → explicit conflict;
9. cursor expires after Outbox pruning → safe rebootstrap → local pending work preserved;
10. pull page fails during local application → transaction rollback → cursor unchanged → retry safe;
11. bootstrap fails mid-pagination → partial staging is not visible as synchronized state;
12. unsupported protocol version → no write, no pending-loss, no cursor advancement.

## 27. Acceptance invariants

Slice 04 cannot pass technical acceptance if any of these are false:

- I1 — no silent overwrite;
- I2 — original Evidence is never destroyed by synchronization;
- I3 — retries do not duplicate events/effects;
- I4 — same `eventId` with different content fails closed;
- I5 — cursor advances only after corresponding local commit;
- I6 — server never commits canonical sync-visible change without corresponding Outbox entry in the same transaction;
- I7 — conflicts preserve all valid branches;
- I8 — timestamps do not resolve causal truth;
- I9 — device remains functional offline;
- I10 — synchronization failure does not imply local data loss;
- I11 — rebootstrap does not erase pending local operations;
- I12 — replicas can converge after failures/conflicts/resolution;
- I13 — CurrentFact and conflict projections remain reconstructible;
- I14 — purge/deletion semantics are not accidentally introduced;
- I15 — no real sensitive data is required for validation.

## 28. Definition of Done

Slice 04 is technically ready for a merge gate only after all of the following are demonstrated:

### Architecture and migration

- non-destructive IndexedDB migration from the Slice 03 schema;
- causal N:N Fact relation support;
- persistent local synchronization metadata;
- server Transactional Outbox atomic with canonical write;
- reconstructible projections.

### Protocol

- versioned bootstrap/push/pull;
- bounded pagination;
- idempotency;
- cursor semantics;
- dependency recovery;
- safe rebootstrap;
- compatibility rejection without data loss.

### Convergence

Device A, Device B, and server converge after:

- offline work;
- retries;
- duplicate delivery;
- out-of-order dependency delivery;
- conflict;
- human resolution;
- cursor expiration/rebootstrap.

### Regression

Slices 01–03 behavior must continue to pass, including:

- trusted text create/query;
- correction/history/restore;
- local offline operation;
- PWA persistence across reload/update;
- PostgreSQL outage safety.

### Evidence pipeline

`implementation → automated tests → E2E → real PostgreSQL proofs → failure injection → invariants → evidence → review → CI → HUMAN_GATE merge`

A green CI run is necessary but is not merge authorization.

## 29. Non-goals / later slices

Explicitly out of Slice 04:

- semantic retrieval / pgvector — Slice 05;
- AI / embeddings / generation — Slice 06;
- voice/audio — Slice 07;
- reminders/proactivity — Slice 08;
- passkeys/trusted sessions/security hardening — Slice 09;
- backup/restore/purge propagation — Slice 10;
- final accessibility/product hardening — Slice 11;
- real controlled pilot — Slice 12 after Pilot Readiness + HUMAN_GATE.

## 30. Approved design decisions

The dialogue approved the following decisions, all with Option A:

1. full bidirectional synchronization;
2. immutable event + dependency synchronization unit;
3. preserve concurrent branches and expose explicit conflict;
4. push/pull sessions with monotonic server cursor;
5. dedicated Transactional Outbox;
6. foreground automatic synchronization + manual action;
7. consistent bootstrap + cursor while preserving local operations;
8. canonical `eventId` as idempotency key;
9. explicit human conflict resolution via append-only event;
10. last non-contested baseline + explicit conflict projection;
11. PostgreSQL/API in-process baseline, no Redis/BullMQ;
12. bounded exponential retry + manual retry;
13. deletion/purge outside Slice 04;
14. push atomic per event, pull atomic per page;
15. persistent `clientInstanceId` per installation;
16. causal domain references, not timestamps/vector clocks;
17. server coordinates convergence; Evidence/Ledger remain canonical historical basis;
18. limited Outbox retention + safe rebootstrap;
19. explicit protocol versioning;
20. consistent bootstrap snapshot + high-watermark cursor in one logical boundary;
21. explicit N:N causal Fact graph;
22. dedicated IndexedDB stores by responsibility;
23. immutable self-contained server Outbox envelopes;
24. `DEPENDENCY_MISSING` + dependency recovery + retry;
25. global + per-memory synchronization status;
26. bounded deterministic batching/pagination;
27. fixed-snapshot paginated bootstrap with token;
28. isolated bootstrap staging + atomic promotion;
29. preserve local and server branches when bootstrap discovers conflict;
30. controlled/synthetic validation without pretending authentication.

## 31. Final design boundary

This design is complete enough to produce a detailed implementation plan after human review of this written specification.

Until a later explicit gate is granted:

- no Slice 04 production code is authorized;
- no schema migration is authorized;
- no implementation PR/merge is authorized;
- no real sensitive data is authorized;
- no pilot is authorized.
