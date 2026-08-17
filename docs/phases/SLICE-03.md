# SLICE 03 — Local PWA + Offline

## State

`TECHNICALLY VALIDATED / READY_FOR_GOVERNANCE / NOT MERGED`

Slice 03 moves the active PWA memory path to IndexedDB behind a browser `MemoryRepository`, while retaining NestJS/PostgreSQL as a separately regression-tested backend boundary.

## Delivered

- installable PWA and offline app shell;
- `mdp-local` IndexedDB v2 with five product stores;
- non-destructive v1→v2 migration;
- local create/query/correct/history/restore;
- atomic multi-store writes;
- current-only deterministic literal query;
- append-only correction lineage;
- same-base stale-write prevention across tabs;
- safe local storage/integrity errors;
- local readiness independent of API readiness;
- controlled Service Worker update prompt;
- isolated offline Chromium acceptance without API server.

## Validation

Technical code HEAD `14bb9792c3a1186332c1b74ba3f39b7dae4907e6` passed CI `32023403748` / job `95367614875`, including `3/3` legacy E2E and `5/5` offline E2E plus PostgreSQL outage regression.

## Boundaries retained

No synchronization, import/export, dual-write, Background Sync, semantic retrieval, AI, voice, real sensitive data or pilot is authorized.

## Gate

Technical validation is not delivery completion. PR #6 remains unmerged pending LEANDRO HUMAN_GATE and subsequent post-merge validation.
