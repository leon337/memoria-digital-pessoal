# SLICE-03-EVIDENCE-001 — Local PWA + Offline

## Status

`TECHNICALLY VALIDATED / READY_FOR_GOVERNANCE / NOT MERGED`

- baseline main: `8a81bc36c0316f1321f7ab61770097da420d6975`
- technical validation HEAD: `14bb9792c3a1186332c1b74ba3f39b7dae4907e6`
- PR: `#6` (draft/open)
- CI: `32023403748` / job `95367614875` — PASS
- real sensitive data: `NOT AUTHORIZED`
- pilot: `NOT AUTHORIZED`
- Slice 04 synchronization: `NOT AUTHORIZED`

## Evidence

The exact technical validation job passed: frozen install, PostgreSQL migration/schema regression, typecheck, lint, format, Slice 01–02 PRF manifests, full automated suite, build, PWA app-shell verifier, UUID v7 runtime check, legacy Chromium E2E, isolated offline Chromium E2E, and real PostgreSQL outage proof.

Browser acceptance:
- legacy E2E: `3/3` PASS;
- offline E2E: `5/5` PASS;
- full offline create → query → correct → history → append-only restore → reload: PASS;
- no memory API traffic in isolated offline flow: PASS;
- two-tab same-base correction: one success + one `STALE_CORRECTION`: PASS;
- local storage failure: no false success: PASS;
- IndexedDB v1 → v2 browser migration remains readable/writable: PASS;
- update check/controller message/reload preserves IndexedDB: PASS.

Persistence/architecture:
- DB `mdp-local`, shipping version `2`;
- exactly five product stores;
- v2 migration adds indexes without destructive reset;
- domain has no browser persistence/PWA dependencies;
- active PWA memory components do not import HTTP memory client;
- Service Worker uses prompt update behavior and no runtime API cache/Background Sync.

PostgreSQL regression remains intact: exactly five product tables and Slice 02 correction schema checks pass. With PostgreSQL stopped, live remains `200`, ready becomes `503`, memory write returns safe `503 SERVICE_UNAVAILABLE`, with no submitted text or SQL detail leaked.

## Evidence qualification notes

Playwright's network-offline emulation and the UI's browser connectivity signal are exercised separately: the context network is disabled, and the DOM `offline` event is dispatched to test the visual state.

The browser Service Worker test proves persistence across update check/controller message/reload. The waiting-worker activation rule is separately covered by unit tests that call activation only after explicit user action.

## Governance

Implementation was explicitly authorized by LEANDRO on 2026-08-17. MESTRE performed a structured self-review; no independent Emily/LÉO audit is claimed. Merge remains pending HUMAN_GATE.
