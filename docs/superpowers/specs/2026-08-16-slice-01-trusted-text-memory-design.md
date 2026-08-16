# Slice 01 — Trusted Text Memory — Design

## Status

- Mission: `MDP-001 — Memória Digital Pessoal`
- Boundary: `SLICE 01 — Trusted Text Memory`
- Design status: `APPROVED_BY_LEANDRO`
- Approved approach: `A — Deterministic Textual Fact`
- Human authorization to enter Slice 01: granted by LEANDRO on `2026-08-16`
- Design approval: granted by LEANDRO on `2026-08-16`
- Branch: `slice/01-trusted-text-memory`
- Real sensitive data: `NOT AUTHORIZED`

## Objective

Deliver the first trustworthy vertical product slice without generative AI:

```text
text input
  → immutable preserved evidence
  → MEMORY_CREATED ledger event
  → simple deterministic fact
  → current-state projection
  → textual query
  → answer with provenance
```

The slice proves that the system can preserve what the user explicitly records, retrieve it later, and explain the source of the answer without inventing information.

## Design choice

### Selected — A: Deterministic Textual Fact

The original user-entered text is preserved verbatim as Evidence. The slice derives a minimal structured Fact whose semantic payload is the explicit autobiographical statement itself; Slice 01 does not attempt semantic decomposition, entity extraction, relation inference, summarization, or generative interpretation.

Textual retrieval is deterministic and database-backed. A successful answer returns the matched statement plus provenance to the original Evidence. A query without sufficient matching evidence returns `UNKNOWN`.

### Rejected — B: Manual structured form

Rejected for Slice 01 because asking the user to fill subject/predicate/value fields increases cognitive load and is not needed to prove the first vertical slice.

### Rejected — C: Rule-based semantic parser

Rejected because heuristic extraction would create an avoidable interpretation layer and could produce false structured meaning before the deterministic core is proven.

## Architectural invariants

This slice must preserve the already approved invariants:

1. Evidence plus Memory Ledger are canonical.
2. Original evidence is immutable and never silently overwritten.
3. Current-state records are projections and must be reconstructible.
4. Lack of evidence means `UNKNOWN`.
5. No confidence score can promote a claim to truth.
6. Temporal precision is never invented.
7. AI is not canonical truth and no generative AI is used in this slice.
8. Embeddings are not evidence and are not used in this slice.
9. No partial canonical state may remain after a failed memory registration.
10. Only synthetic, non-sensitive laboratory data is permitted.

## Domain model

Slice 01 introduces five minimum product concepts.

### Memory

Represents one user act of recording a textual memory.

Minimum fields:

- `id`: UUID v7
- `recordedAt`: timestamp generated at successful registration
- `occurredAt`: nullable; remains `null` unless an explicit occurrence time is supplied by a future authorized capability
- `temporalPrecision`: `unknown` in Slice 01 unless later expanded by an authorized boundary

Memory does not duplicate the original text. The canonical content lives in Evidence.

### Evidence

Immutable original textual evidence.

Minimum fields:

- `id`: UUID v7
- `memoryId`: parent Memory
- `kind`: `text`
- `content`: exact text submitted by the user after transport-level decoding; no semantic rewriting
- `createdAt`

Rules:

- content is append-only/immutable;
- no update endpoint exists in Slice 01;
- corrections belong to Slice 02;
- deleting/purging evidence is outside Slice 01.

### LedgerEvent

Canonical event recording the creation of a memory.

Minimum fields:

- `id`: UUID v7
- `memoryId`
- `type`: `MEMORY_CREATED`
- `evidenceId`
- `createdAt`

Rules:

- append-only;
- event content references canonical IDs rather than duplicating mutable projections.

### Fact

A deterministic fact derived only from the explicit user statement.

Minimum fields:

- `id`: UUID v7
- `memoryId`
- `evidenceId`
- `kind`: `autobiographical_statement`
- `content`: the explicit statement used for deterministic retrieval
- `createdAt`

Slice 01 does not extract entities, predicates, relations, emotions, medical interpretations, or inferred meaning. `Fact.content` remains traceable to the Evidence content.

### CurrentFact

Reconstructible current-state projection for deterministic consultation.

Minimum fields:

- `factId`
- `memoryId`
- `evidenceId`
- `content`
- `recordedAt`

It is not canonical truth. It may be rebuilt from Evidence + Ledger + Fact data.

## Persistence and transaction boundary

`POST /memories` executes one database transaction that creates:

1. Memory;
2. Evidence;
3. `MEMORY_CREATED` LedgerEvent;
4. Fact;
5. CurrentFact.

If any step fails, the complete transaction rolls back. No partial Memory, Evidence, event, Fact, or CurrentFact may remain.

PostgreSQL remains the only product datastore introduced for this slice. Prisma stays isolated inside API persistence infrastructure; domain packages must not depend on Prisma or Node-native infrastructure APIs.

## API design

### `POST /memories`

Request:

```json
{
  "text": "Minha irmã se chama Ana."
}
```

Validation:

- text is required;
- text must contain non-whitespace content;
- a conservative maximum length must be enforced in the implementation plan and shared contract;
- no HTML execution or rich-text semantics are required.

Success: `201 Created`.

Response returns stable IDs and the stored statement without internal persistence details.

Example shape:

```json
{
  "memory": {
    "id": "<uuid-v7>",
    "recordedAt": "<iso-8601>"
  },
  "fact": {
    "id": "<uuid-v7>",
    "content": "Minha irmã se chama Ana."
  },
  "provenance": {
    "evidenceId": "<uuid-v7>"
  }
}
```

### `GET /memories/:id`

Returns the registered memory with its original textual Evidence and provenance identifiers.

A missing memory returns the existing safe `NOT_FOUND` API envelope.

### `GET /query?q=<text>`

Performs deterministic textual retrieval over CurrentFact content using PostgreSQL capabilities available without introducing embeddings or an external search service.

Initial retrieval requirements:

- case-insensitive;
- deterministic ordering;
- stable tie-breaking;
- no semantic inference;
- no generated paraphrase;
- result must carry provenance.

A successful response returns one best deterministic match for Slice 01 plus its Evidence reference.

Example:

```json
{
  "status": "FOUND",
  "answer": "Minha irmã se chama Ana.",
  "provenance": {
    "memoryId": "<uuid-v7>",
    "evidenceId": "<uuid-v7>",
    "factId": "<uuid-v7>"
  }
}
```

If no evidence satisfies the deterministic match rule:

```json
{
  "status": "UNKNOWN",
  "answer": null,
  "provenance": null
}
```

The implementation plan must define the precise lexical matching expression and ordering so identical inputs produce reproducible results.

## Web experience

The PWA exposes two primary smartphone-first actions.

### Store a memory

- heading and explicit label: `Guardar uma lembrança`;
- large multiline text input;
- large primary save control;
- visible success confirmation after persisted API response;
- failure does not display a false success state.

### Consult memories

- heading and explicit label: `Consultar minhas lembranças`;
- text query input;
- result displays the stored statement;
- source/provenance is visible through a human-readable source indicator;
- `UNKNOWN` is presented clearly when no matching evidence exists.

Accessibility baseline:

- semantic headings and labels;
- keyboard operability;
- visible focus behavior inherited or explicitly provided;
- accessible status/error announcements;
- controls sized for low-friction smartphone use;
- no information conveyed only by color.

Detailed visual styling is not a Slice 01 acceptance requirement.

## Error handling

The existing structured safe API error envelope remains mandatory.

Required behavior:

- malformed/empty input → safe validation error;
- missing memory → safe not-found error;
- database unavailable → safe service-unavailable behavior where applicable;
- internal exceptions must not leak SQL, credentials, stack traces, or evidence content unnecessarily;
- request correlation ID remains present for failures.

No automatic retry may create duplicate canonical memory records.

## Security and privacy boundary

Slice 01 is laboratory-only with synthetic data.

Required constraints:

- no real autobiographical or sensitive data;
- no analytics or background capture;
- no automatic monitoring;
- no medical diagnosis or health inference;
- no generative AI provider;
- no external data processor added for product content.

Authentication hardening, encryption-at-rest application design, recovery, step-up authentication, and pilot controls remain later boundaries and do not become implicit scope for Slice 01.

## Explicitly out of scope

- correction/history workflows (Slice 02);
- IndexedDB/offline PWA behavior (Slice 03);
- synchronization (Slice 04);
- pgvector/semantic embeddings (Slice 05);
- generative AI or AI fact extraction (Slice 06);
- voice/STT/TTS (Slice 07);
- reminders/proactivity (Slice 08);
- advanced auth, passkeys, encryption/recovery hardening (Slice 09);
- backup/restore/purge (Slice 10);
- dedicated accessibility/product hardening (Slice 11);
- real sensitive data;
- controlled pilot.

## Testing strategy

### Unit/domain

Prove:

- UUID/global ID contracts remain valid;
- deterministic domain objects cannot silently mutate canonical Evidence/Ledger concepts;
- query result mapping preserves provenance;
- `UNKNOWN` is explicit rather than represented as fabricated content.

### Integration

Against real PostgreSQL, prove:

- the full registration transaction creates all five required records;
- forced failure rolls back the complete transaction;
- original Evidence content round-trips unchanged;
- query retrieves a stored fact deterministically;
- missing query evidence returns `UNKNOWN`;
- retrieved answer references the correct Evidence;
- health/readiness regression remains green.

### Architecture/invariant

Prove:

- domain/contracts stay independent from Prisma and Node infrastructure;
- Evidence and Ledger have no update path in Slice 01;
- no AI, embeddings, Redis, BullMQ, worker or object-storage dependency enters the slice.

### Browser E2E

With synthetic data, prove:

1. open the built PWA;
2. store a text memory;
3. receive visible persisted success;
4. query using matching text/terms;
5. see the stored statement;
6. see source/provenance indication;
7. query unrelated text;
8. see explicit `UNKNOWN` behavior.

The E2E must use the built web/API applications and real PostgreSQL, following the Foundation verification pattern.

## Acceptance criteria

Slice 01 implementation is acceptable only when all criteria below are reproducibly demonstrated:

1. Registering text atomically creates Memory + Evidence + `MEMORY_CREATED` + Fact + CurrentFact.
2. Original text is preserved and retrievable unchanged.
3. Evidence and Ledger cannot be silently overwritten through Slice 01 behavior.
4. A deterministic textual query retrieves a stored fact.
5. A found answer carries Memory/Fact/Evidence provenance.
6. A query with no matching evidence returns `UNKNOWN` and no fabricated answer.
7. A forced persistence failure leaves no partial canonical/projection state.
8. Unit, integration, architecture/invariant and browser E2E tests pass.
9. Foundation regression checks continue to pass.
10. Only synthetic non-sensitive test data is used.
11. No out-of-scope infrastructure or AI capability is introduced.
12. Evidence, review, CI and the Slice 01 gate are complete before merge.

## Delivery and gate rule

The Slice follows the canonical delivery sequence:

```text
IMPLEMENTATION
→ AUTOMATED TESTS
→ E2E
→ ACCEPTANCE CRITERIA
→ INVARIANTS
→ EVIDENCE
→ REVIEW
→ CI
→ GATE
```

Code existence is not completion.

The branch must not be merged merely because CI is green. Completion and integration require the gate appropriate to the project governance. Real sensitive data remains unauthorized regardless of Slice 01 completion.

## Implementation planning handoff

After this written specification is reviewed and approved, create a detailed implementation plan before writing code. The plan must decompose work into small verifiable steps, define the precise lexical query algorithm, schema/migration changes, API/domain boundaries, test-first sequence, E2E evidence, and review/CI checkpoints.
