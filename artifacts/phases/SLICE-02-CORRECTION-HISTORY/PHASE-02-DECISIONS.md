# PHASE-02-DECISIONS — Correction & History

## Product/design decisions approved by LEANDRO

1. Corrections are full-text immutable versions.
2. Original evidence is never overwritten.
3. Normal queries return current state only.
4. Repeated corrections form an unlimited linear chain.
5. Correction reason is optional.
6. Blank correction is rejected.
7. Stale correction is rejected rather than silently overwritten.
8. Every corrected Fact explicitly references its predecessor.
9. Corrections emit immutable `MEMORY_CORRECTED` events.
10. History is displayed original→corrections→current.
11. Slice 02 corrects textual content only.
12. No-change correction is rejected.
13. Uncorrected memory has one-version history.
14. Undo/restore creates a new correction.
15. Evidence + event + fact + CurrentFact update are one transaction.
16. Slice 02 includes domain→persistence→API→PWA→E2E.
17. Actions appear on a `FOUND` query result; no general memory list/details screen.
18. Correction form is inline and prefilled.
19. Successful correction immediately publishes new current state and concise feedback.

## Architecture choice

Chosen approach: append-only Evidence + Fact + LedgerEvent with explicit lineage and transactional CurrentFact projection. No separate `FactVersion` table and no full event-sourcing refactor.

## Concurrency choice

`expectedCurrentFactId` is mandatory and PostgreSQL correction serialization locks the stable Memory row. Same-base concurrent writes result in one accepted correction and one stale conflict.

## Runtime/execution note

LEANDRO selected execution mode `1 — Subagent-Driven`. This conversation runtime did not expose a separate subagent dispatcher. MESTRE therefore preserved task-level isolation, TDD, diff review and CI gates without falsely claiming independent subagent execution.

## Governance decision still pending

Technical validation does not authorize merge. Independent Emily audit and LÉO internal gate are not claimed as performed. HUMAN_GATE remains exclusively LEANDRO's authority.
