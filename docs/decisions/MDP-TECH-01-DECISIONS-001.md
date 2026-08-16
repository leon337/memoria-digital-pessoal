# MDP-TECH-01-DECISIONS-001

## Status

TECH-01 Q1–Q16: COMPLETE.

## Decisions

### Q1 — Environment progression
Laboratory with synthetic data → controlled pilot with low-risk real data → progressive expansion. Real sensitive data only after persistence, sync, deletion, backup, recovery and security are validated.

### Q2 — Infrastructure model
Hybrid infrastructure: user-controlled VPS as core/lab plus external managed services when concretely advantageous. Do not force all capabilities onto one host.

### Q3 — Operational database
PostgreSQL as the main operational database with progressive specialization instead of separate graph/vector databases in the MVP.

### Q4 — Local PWA persistence
IndexedDB behind abstract repositories such as MemoryRepository, LedgerRepository and SyncQueueRepository, preserving the option to move to SQLite/WASM later.

### Q5 — Backend
Node.js LTS + TypeScript + NestJS modular monolith. One backend deploy initially, with explicit module boundaries for Memory, Evidence, Ledger, Entity, Retrieval, Sync, AI Gateway, Security and Reminder.

### Q6 — Frontend
React + TypeScript + Vite client-side PWA, separate from the NestJS backend. IndexedDB, Service Worker and local sync logic live client-side.

### Q7 — Data access
Prisma for common data access plus explicit SQL for specialized cases, behind repository contracts. Domain types do not depend on Prisma types.

### Q8 — Semantic retrieval
PostgreSQL + pgvector. Embeddings are derived/rebuildable projections, not truth. Start with exact vector search; evaluate approximate indexes only if scale justifies them.

### Q9 — Binary evidence storage
S3-compatible object storage behind EvidenceStorage. Local S3-compatible storage in lab; managed or hardened S3-compatible storage for real pilot. PostgreSQL stores metadata, hash, storage key and provenance rather than being forced to hold all binary blobs.

### Q10 — Authentication
Passkey primary + trusted session + protected separate recovery. No traditional password as the normal daily primary credential. Sensitive actions may require step-up authentication.

### Q11 — Recovery
Multi-layer configurable recovery with no universal master key. Recovery may combine recovery code, trusted second device and optionally preauthorized assisted recovery.

### Q12 — Key hierarchy
User-level wrapping key/KEK plus DEKs for sensitive content behind a KeyManagement contract supporting wrap, unwrap, rotate, rewrap, revoke and destroy. Envelope encryption is the direction.

### Q13 — Async execution
PostgreSQL Transactional Outbox + BullMQ/Redis + workers. PostgreSQL remains truth; Redis is execution infrastructure, not canonical state. Worker may be a separate process in the same monorepo rather than a microservice.

### Q14 — Speech input
Local browser audio capture + replaceable SpeechToText contract. Future local STT remains possible. Raw audio evidence → transcript with confidence/alternatives → validation → Memory Engine. Transcript does not automatically become truth.

### Q15 — Speech output
TextToSpeech contract with local-first/browser output, optional cloud provider and future local model. Accessibility controls apply; risk policy may prevent automatic speech of sensitive information.

### Q16 — Deployment baseline
Docker Compose reproducibly on Ubuntu VPS with independent reverse proxy/HTTPS, web, API, worker, PostgreSQL+pgvector, Redis and object storage services as those capabilities become necessary. Persistent volumes, healthchecks, backup/restore, logs, versioned configuration and secrets outside code are required. Kubernetes is premature.

## Technical stack baseline

- Frontend: React + TypeScript + Vite PWA
- Local persistence: IndexedDB behind abstract repositories
- Backend: Node.js LTS + TypeScript + NestJS modular monolith
- Database: PostgreSQL + pgvector
- Data access: Prisma + explicit specialized SQL
- Async: Transactional Outbox + BullMQ + Redis + NestJS worker
- Binary storage: S3-compatible
- Auth: passkeys + trusted session + multi-layer recovery
- Crypto: envelope encryption + user key + DEKs + KeyManagement abstraction
- Voice input: local browser capture + SpeechToText contract
- Voice output: TextToSpeech contract
- Infrastructure: Ubuntu + Docker Compose

## Intended code organization

```text
memory-digital/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── domain/
│   ├── contracts/
│   ├── schemas/
│   ├── shared/
│   └── config/
├── prisma/
├── infra/
├── docs/
└── tests/
```

## Domain isolation

The domain package must not import Prisma, Redis, NestJS, pgvector, AI SDKs or S3 SDKs.

## Open implementation choices

Exact reverse proxy, object storage implementation, STT/LLM/embedding/TTS providers, KMS, IndexedDB library, WebAuthn library, session duration, trash retention, backup details, observability stack, CI/CD, public domain and final product name remain open until their boundary requires a decision.
