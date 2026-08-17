# PHASE-02-PLAN — SLICE 02 Correction & History

## Objective

Deliver append-only textual correction and traceable history as the next progressive vertical slice after Trusted Text Memory.

## Approved flow

```text
FOUND current memory
→ Corrigir inline
→ expectedCurrentFactId + full corrected text + optional reason
→ validate blank/no-change/stale
→ one PostgreSQL transaction
→ new Evidence
→ new Fact.supersedesFactId
→ MEMORY_CORRECTED
→ CurrentFact reprojection
→ current-only normal query
→ ordered immutable history
```

## Required invariants

1. Original Evidence and historical Facts are immutable.
2. Correction chain is linear and explicit.
3. CurrentFact identifies exactly the accepted tip.
4. Blank/no-op/stale correction cannot create an accepted replacement.
5. Concurrent same-base writes cannot silently overwrite.
6. Correction persistence is atomic.
7. History is ordered from explicit lineage, not timestamps.
8. Restore is a new append-only correction.
9. Normal query reads current state only.
10. Real sensitive data and pilot remain prohibited.

## Verification plan

- domain and contract tests;
- real PostgreSQL integration tests for atomicity, rollback, history and concurrency;
- physical schema catalog assertions;
- HTTP service/controller tests for 404/409/422/503;
- typed web-client tests;
- React component tests for correction/history/stale/restore;
- Playwright browser E2E for Ana→Beatriz→UNKNOWN/current→history→append-only restore;
- real PostgreSQL outage proof for correction safe envelope;
- architecture scope checks preserving exactly five product tables and excluding future-slice infrastructure;
- full regression, build, lint, typecheck and format gates.

## Governance plan

Implementation technical readiness is necessary but not sufficient for merge. Evidence and PRF must be frozen first. Independent audit/LÉO execution must not be fabricated when unavailable. HUMAN_GATE remains exclusively LEANDRO's authority. Merge and post-merge completion are separate governed steps.
