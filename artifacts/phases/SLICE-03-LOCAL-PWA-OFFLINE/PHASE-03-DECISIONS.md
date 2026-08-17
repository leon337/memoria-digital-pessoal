# PHASE-03-DECISIONS — Local PWA + Offline

## Product/design decisions approved by LEANDRO

1. The complete delivered textual-memory flow works offline: create, query, correct, history, append-only restore.
2. IndexedDB is the active PWA memory source for Slice 03; there is no API/IndexedDB runtime switching.
3. Local persistence mirrors the five conceptual entities: Memory, Evidence, LedgerEvent, Fact, CurrentFact.
4. Service Worker owns app-shell/static-asset availability only; memory data stays in IndexedDB.
5. All local mutations are atomic multi-store IndexedDB transactions.
6. UUID v7 identifiers are generated client-side and remain definitive.
7. Local schema migration is versioned and non-destructive.
8. Offline is informational, not an operation failure when local persistence is healthy.
9. Existing PostgreSQL memories are not imported automatically.
10. Correction/restore requires expectedCurrentFactId and rejects stale bases.
11. Service Worker updates use controlled prompt behavior.
12. Local persistence fails safe: no completed transaction means no success.
13. Browser application uses an explicit MemoryRepository boundary.

## Frozen local schema

- database: `mdp-local`
- shipping version: `2`
- v1 stores: `memories`, `evidence`, `ledgerEvents`, `facts`, `currentFacts`
- v2: indexes only, preserving valid v1 content
- correction predecessor index is unique
- `currentFacts.memoryId` is non-unique

## Execution/governance note

LEANDRO explicitly authorized implementation on 2026-08-17. This runtime did not expose an independent subagent dispatcher. MESTRE therefore executed inline with task-level TDD and CI evidence without claiming independent Emily/LÉO execution.

Technical qualification does not authorize merge. HUMAN_GATE remains exclusively LEANDRO's authority.
