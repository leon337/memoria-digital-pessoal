# MDP-CONCEPTUAL-ARCHITECTURE-001

## Status

Conceptual Architecture Q1–Q16: COMPLETE.

## Decisions

### Q1 — Core model
Hybrid architecture: immutable Ledger + current state projection + knowledge graph + semantic index.

### Q2 — Originals and facts
Preserve immutable original records and derive atomic facts from them.

### Q3 — Epistemic model
Every fact may carry an epistemic state, evidence and internal confidence. Confidence alone never makes a fact confirmed.

### Q4 — Conflicts
Resolve contextually using evidence, time and risk while preserving conflicting versions and their provenance.

### Q5 — Sync semantics
Event-oriented offline synchronization with deterministic merge and preserved conflicts. No global server-wins, client-wins or last-write-wins policy.

### Q6 — Canonical truth
Evidence plus Memory Ledger are canonical. Current state, graph and semantic index are projections. AI is an interpreter, not the source of truth.

### Q7 — Retrieval
Intent/entities + semantic search + time + graph + current state → original evidence → epistemic/risk policy → answer.

### Q8 — Audio retention
Selective preservation of original audio based on importance and consent. Transcript, facts and metadata may be retained independently; raw audio is optional.

### Q9 — IDs
Generate global IDs locally. Separate IDs exist for memory, event, evidence, fact and entity.

### Q10 — Deletion
Two-stage deletion: deletion request → trash/quarantine → permanent purge propagated to facts, projections, graph, embeddings, media, caches and devices. Ledger retains only a minimal non-content tombstone/event when necessary.

### Q11 — Time
Use occurred_at, recorded_at, modified_at and synced_at with explicit temporal precision such as exact, approximate, range, daypart, date-only or unknown. Never invent precision.

### Q12 — Entity resolution
Canonical entity + aliases + probabilistic and reversible entity resolution. Ambiguity is preserved; clarification may be requested; merges are reversible.

### Q13 — Ontology
Controlled evolving ontology. Canonical relations are versioned, migratable and provenance-aware. LLMs cannot invent canonical relation types arbitrarily.

### Q14 — Encryption direction
Layered encryption with envelope encryption and protected recovery. Exact operational recovery mechanism is deferred to technical design.

### Q15 — Local-first architecture
Local-First + Cloud Intelligence. Essential offline functionality is local; full graph, semantic retrieval, advanced AI and backup may be cloud-side.

### Q16 — AI decoupling
AI is behind capability contracts/adapters such as TranscribeAudio, GenerateEmbedding, ExtractFacts, ResolveEntities and GenerateAnswer. Providers do not own ledger, provenance, conflict, risk or deletion policy.

## Conceptual components

- C01 PWA Client
- C02 Local Memory Store
- C03 Local Event Ledger
- C04 Sync Engine
- C05 Central Memory Ledger
- C06 Evidence Store
- C07 Projection Engine
- C08 Entity Resolution Engine
- C09 Knowledge Graph
- C10 Semantic Retrieval Index
- C11 Epistemic Policy Engine
- C12 Risk Policy Engine
- C13 AI Capability Gateway
- C14 Encryption/Key Management
- C15 Backup/Recovery

## Core invariants

- AI is not canonical truth.
- Originals are not silently overwritten.
- Confirmed information has provenance.
- Confidence score is not truth.
- Conflicts are preserved.
- Embeddings are not evidence.
- Current state is reconstructible.
- Sync must not silently destroy information.
- Temporal precision is never invented.
- Entity merges are reversible.
- Purge removes derivatives.
- AI provider is replaceable.
- High-risk facts require stronger evidence.
- Lack of evidence means UNKNOWN.

## Architecture validation tests

T01 offline record; T02 later sync; T03 correction preserving original; T04 conflict traceability; T05 provenance; T06 no-evidence → UNKNOWN; T07 semantic retrieval; T08 ambiguous identity not auto-merged; T09 purge removes derivatives; T10 AI outage leaves basic local functions alive.
