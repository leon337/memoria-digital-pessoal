# MDP-PLAN-01-DECISIONS-001

## Status

PLAN-01 Q1–Q16: COMPLETE and consolidated.

## Decisions

### Q1
Minimum foundation + progressive vertical slices. Every slice follows objective → implementation → tests → evidence → acceptance → gate. No infrastructure is built merely because it may be useful later.

### Q2
First executable vertical slice: trustworthy textual memory end-to-end. Flow: text memory → preserved evidence → MEMORY_CREATED → simple structured fact → current state → textual query → answer + provenance. No generative AI in Slice 01.

### Q3
Foundation includes product/domain/quality minimum: apps/web, apps/api, packages/domain, packages/contracts, packages/shared, PostgreSQL, Prisma, minimum Docker Compose, automated tests, lint/format, validated environment configuration and healthcheck. Strict TypeScript, versioned migrations, global IDs, domain contracts and structured errors. Redis, BullMQ, worker, pgvector, object storage, STT, TTS and AI providers remain out.

### Q4
Definition of Done is evidence-based: implementation → automated tests → end-to-end test → acceptance criteria → evidence → review → gate.

### Q5
Roadmap progresses by capability, introducing risk and complexity only when needed: Foundation → trusted textual memory → correction/history → local/offline → sync → semantic retrieval → AI → voice → reminders/proactivity → security/recovery → backup/restore/purge → accessibility/hardening → controlled pilot.

### Q6
Generative AI enters only after deterministic core and semantic retrieval have been proven. If AI is disabled, canonical memory remains intact and auditable.

### Q7
Security is progressive by boundary. Security architecture/constraints start early; passkeys, envelope encryption, recovery and step-up hardening become formal before pilot. Synthetic data only in laboratory until readiness.

### Q8
Backup/restore evolve progressively. Restore must be proven in a clean environment. Complete purge is validated before pilot.

### Q9
Accessibility is continuous across UI slices, with dedicated hardening and real usability validation before pilot.

### Q10
Validation uses a pyramid of unit, integration, contract, E2E, invariant and failure/recovery tests. Each critical architectural invariant must have at least one executable proof.

### Q11
One branch + PR per verifiable slice/boundary. The next slice starts from the integrated validated state of the previous one.

### Q12
CI is progressive. Foundation begins with install, typecheck, lint, unit tests, builds and migration validation; later boundaries add integration, E2E, offline/sync, AI/provider, security, backup/restore/purge, accessibility and readiness checks. Required checks must pass before integration.

### Q13
Canonical minimum documentation is persisted per slice. Another chat or agent must be able to recover state without reconstructing conversation history.

### Q14
Scope changes are classified. BLOCKER and REQUIRED_FOR_ACCEPTANCE may enter the current slice; FUTURE_OR_IMPROVEMENT goes to backlog.

### Q15
Regression is cumulative by invariant plus boundary-specific tests. Previously approved guarantees become permanent contracts.

### Q16
Pilot requires a multidisciplinary Pilot Readiness Gate followed by explicit HUMAN_GATE authorization from LEANDRO. Readiness classifications are READY, READY_WITH_RESTRICTIONS or BLOCKED.

## Universal delivery rule

Code existence is not completion. Behavior must be demonstrated by reproducible evidence.
