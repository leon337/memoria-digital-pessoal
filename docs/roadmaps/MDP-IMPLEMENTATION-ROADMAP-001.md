# MDP-IMPLEMENTATION-ROADMAP-001

## Mission

`MDP-001 — Memória Digital Pessoal`

## Strategy

Minimum foundation followed by progressive vertical slices. Complexity is introduced only when required by the active capability boundary.

## Sequence

1. FOUNDATION — Repository & Product Bootstrap
2. SLICE 01 — Trusted Text Memory
3. SLICE 02 — Correction & History
4. SLICE 03 — Local PWA + Offline
5. SLICE 04 — Synchronization
6. SLICE 05 — Semantic Retrieval
7. SLICE 06 — AI Assisted Memory
8. SLICE 07 — Voice
9. SLICE 08 — Reminders & Controlled Proactivity
10. SLICE 09 — Security & Recovery Hardening
11. SLICE 10 — Backup, Restore & Purge
12. SLICE 11 — Accessibility & Product Hardening
13. PILOT READINESS GATE
14. HUMAN_GATE — LEANDRO
15. SLICE 12 — Controlled Pilot

## Universal Definition of Done

IMPLEMENTATION → AUTOMATED TESTS → E2E → ACCEPTANCE CRITERIA → INVARIANTS → EVIDENCE → REVIEW → CI → GATE

## Foundation minimum

- `apps/web`
- `apps/api`
- `packages/domain`
- `packages/contracts`
- `packages/shared`
- PostgreSQL
- Prisma
- minimum Docker Compose
- automated tests
- lint/format
- validated environment configuration
- healthcheck

Not yet included in Foundation:
- Redis
- BullMQ
- worker
- pgvector
- object storage
- STT
- TTS
- AI providers

## Slice 01 — Trusted Text Memory

Objective: prove trustworthy textual memory without generative AI.

Flow: text input → preserved evidence → MEMORY_CREATED → structured fact → current state → textual query → answer + provenance.

Must prove:
- memory registration;
- evidence preservation;
- Ledger event;
- fact creation;
- query retrieves fact;
- answer points to source;
- automated tests pass;
- E2E flow is reproducible.

Explicitly excluded: AI, embeddings, voice, offline, sync, pgvector, Redis and object storage.

## Slice 02 — Correction & History

Correction, history preservation, reprojection and traceability. Corrections never silently destroy original evidence.

## Slice 03 — Local PWA + Offline

IndexedDB behind repository abstractions, Service Worker and essential offline operation. Domain must not depend directly on IndexedDB.

## Slice 04 — Synchronization

Event-oriented synchronization, idempotency, retry, conflict preservation and convergence. Transactional Outbox is introduced; Redis/BullMQ/worker only if required by this boundary.

## Slice 05 — Semantic Retrieval

PostgreSQL + pgvector semantic projection. Embeddings are rebuildable and are never treated as evidence.

## Slice 06 — AI Assisted Memory

AI capability contracts such as ExtractFacts, ResolveEntities, SummarizeEvidence and GenerateAnswer. AI output cannot self-promote to confirmed truth. Provider failure must not corrupt or disable canonical memory.

## Slice 07 — Voice

Voice input/output behind SpeechToText and TextToSpeech contracts, with ambiguity handling and evidence preservation. S3-compatible evidence storage is introduced when needed for audio.

## Slice 08 — Reminders & Controlled Proactivity

Reminders and context-aware proactivity governed by risk. High-risk claims require stronger evidence.

## Slice 09 — Security & Recovery Hardening

Passkeys, trusted sessions, envelope encryption, hierarchical keys, KeyManagement, recovery and step-up authentication. No universal master password.

## Slice 10 — Backup, Restore & Purge

Backup must be restored into a clean environment and validated. Permanent purge propagates to canonical data, facts, projections, embeddings, media, caches and synchronized clients, preserving at most a minimal non-content tombstone when required.

## Slice 11 — Accessibility & Product Hardening

Accessibility and usability hardening across critical flows, including real validation that the user can register and later recover a memory with minimal or no technical assistance.

## Pilot Readiness

Review product, architecture, quality, security, backup/restore, purge, privacy, accessibility, observability and residual risks.

Possible outcomes:
- READY
- READY_WITH_RESTRICTIONS
- BLOCKED

Even READY does not start the pilot automatically. Explicit HUMAN_GATE authorization from LEANDRO is mandatory.

## Slice 12 — Controlled Pilot

Limited real-world pilot only after readiness plus explicit authorization. Start with low-risk memories and a constrained scope. The pilot is not a medical diagnostic system and is not blanket surveillance.

## Git strategy

```text
main
 ├── foundation/repository-bootstrap
 ├── slice/01-trusted-text-memory
 ├── slice/02-correction-history
 ├── slice/03-local-offline
 ├── slice/04-synchronization
 ├── slice/05-semantic-retrieval
 ├── slice/06-ai-assisted-memory
 ├── slice/07-voice
 ├── slice/08-reminders-proactivity
 ├── slice/09-security-recovery
 ├── slice/10-backup-restore-purge
 ├── slice/11-accessibility-hardening
 └── slice/12-controlled-pilot
```

Rule: SLICE N → GATE → MERGE → SLICE N+1.

## CI progression

Foundation: install, typecheck, lint, unit, web build, API build, migration validation.

Slices 01–02: integration, E2E, domain invariants.

Slices 03–04: offline, sync, retry, idempotency, conflict tests.

Slices 05–07: vector retrieval, provider contracts, AI failure modes, voice pipeline.

Slices 09–10: security, recovery, backup, restore and purge.

Slice 11+: accessibility, pilot readiness and full regression.

## Finding classification

- BLOCKER → resolve in current boundary.
- REQUIRED_FOR_ACCEPTANCE → incorporate in current boundary.
- FUTURE_OR_IMPROVEMENT → backlog.

## Regression rule

Every approved invariant becomes part of the cumulative regression contract.
