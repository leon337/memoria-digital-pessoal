# PHASE-03-PLAN — SLICE 03 Local PWA + Offline

## Objective

Make the existing textual-memory PWA usable on one browser/device without network access while preserving Slice 01–02 trust, correction, history, provenance and PostgreSQL regression guarantees.

## Approved flow

```text
PWA app shell
→ MemoryRepository
→ IndexedDbMemoryRepository
→ atomic five-store local persistence
→ create/query/correct/history/restore
→ reload/reopen offline
```

The NestJS/PostgreSQL path remains regression-tested but is not the active PWA persistence route in Slice 03.

## Required invariants

1. Domain stays independent from browser/IndexedDB/PWA APIs.
2. Evidence, LedgerEvent and Fact history are append-only.
3. CurrentFact is reconstructible projection state.
4. Normal query returns current state only.
5. No evidence/current match means UNKNOWN.
6. Local mutations are all-or-nothing.
7. Stale corrections cannot silently win across tabs.
8. Restore appends a new correction.
9. App updates and v1→v2 migration preserve IndexedDB.
10. Local storage failure cannot produce false success.
11. No API fallback, dual-write, import, Background Sync or synchronization.
12. Real sensitive data and pilot remain prohibited.

## Verification plan

- contract/domain/API/PostgreSQL cumulative regression;
- IndexedDB schema, migration, transaction and integrity tests;
- React local-first/readiness/connectivity tests;
- architecture scope guards;
- PWA build artifact verification;
- legacy Chromium E2E;
- isolated Chromium offline E2E with no API server;
- multi-tab stale conflict;
- storage-failure fail-safe proof;
- browser v1→v2 migration proof;
- real PostgreSQL outage proof;
- full CI on the exact qualifying branch head.
