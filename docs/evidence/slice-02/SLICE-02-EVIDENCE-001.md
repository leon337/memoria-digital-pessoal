# SLICE-02-EVIDENCE-001 — Correction & History

## Identity

- Mission: `MDP-001 — Memória Digital Pessoal`
- Boundary: `SLICE 02 — Correction & History`
- Evidence date: `2026-08-17`
- Pull request: `#4 — SLICE 02: correction and history`
- Validated branch HEAD: `361214e97e9b70df7092ee1f6d5c3944446edda0`
- Canonical pre-gate CI: `32000681041` / job `95300284264`
- Evidence classification: laboratory / synthetic data only

## Result

`TECHNICALLY VALIDATED / PRE-GATE / NOT MERGED`

This record proves the implemented Slice 02 behavior and the fresh pre-gate validation of the current branch. It does not claim independent audit, LÉO gate, HUMAN_GATE approval, merge or post-merge completion.

## Acceptance evidence

| # | Acceptance criterion | Procedure / evidence | Result |
|---|---|---|---|
| 1 | Correction never mutates original Evidence/Fact | Domain + real PostgreSQL integration assertions | PASS |
| 2 | Every accepted correction appends Evidence + `MEMORY_CORRECTED` + Fact | Domain, Prisma and integration tests | PASS |
| 3 | Corrected Fact explicitly references predecessor | `supersedesFactId` domain/schema/integration checks | PASS |
| 4 | Correction writes and CurrentFact reprojection are atomic | Real PostgreSQL transaction + forced projection-update trigger failure | PASS |
| 5 | Same-base concurrent corrections cannot silently overwrite | Real PostgreSQL concurrency test: one `CORRECTED`, one `STALE` | PASS |
| 6 | Blank/no-change corrections create no new accepted version | Contract/domain/service/controller tests | PASS |
| 7 | Normal query exposes only current state | Store integration + browser E2E: old `Ana` becomes `UNKNOWN`, new `Beatriz` is `FOUND` | PASS |
| 8 | History preserves root-to-tip semantic chain | Domain ordering + PostgreSQL provenance validation + web/E2E | PASS |
| 9 | Uncorrected history has exactly one original/current version | Integration history test | PASS |
| 10 | Restore/undo appends a new correction rather than deleting history | Component + browser E2E yields three-version chain | PASS |
| 11 | Stale write produces stable conflict behavior | Service/controller/web tests for `STALE_CORRECTION` / HTTP 409 | PASS |
| 12 | Correction validation/no-op errors are stable | Contracts/controller/web tests for 422 validation/`NO_CHANGE` | PASS |
| 13 | Correction/history flows work end-to-end in PWA | Playwright `correction-history.spec.ts` | PASS |
| 14 | Database outage maps correction to safe 503 | Real PostgreSQL stop + `verify-slice02-correction-outage.mjs` | PASS |
| 15 | Physical schema enforces correction lineage constraints | CI PostgreSQL catalog assertions | PASS |
| 16 | Slice 01 regressions remain green | Existing unit/integration/architecture/E2E/PRF checks | PASS |
| 17 | No out-of-scope infrastructure or sixth table enters Slice 02 | Architecture scope tests + exact table allowlist | PASS |
| 18 | Only synthetic laboratory data is used | Synthetic fixtures + visible PWA laboratory warning | PASS |

## Canonical validation output

Fresh CI `32000681041` / job `95300284264` on HEAD `361214e97e9b70df7092ee1f6d5c3944446edda0` produced:

```text
fact_lineage_column=1 fact_lineage_unique=1 ledger_columns=3 correction_check=1
Test Files 25 passed (25)
Tests 95 passed (95)
Running 3 tests using 1 worker
3 passed (6.8s)
slice02 correction outage=503 SERVICE_UNAVAILABLE safe-envelope
healthy live=200 ready=200
db-down live=200 ready=503 memory=503
```

The correction-outage probe also asserts that the submitted correction text and SQL details do not appear in the returned error body.

## Proven persistence model

The product schema remains exactly five tables:

```text
current_facts
evidence
facts
ledger_events
memories
```

Slice 02 physically adds correction lineage within those existing tables:

- `facts.supersedes_fact_id` UUID;
- unique `facts_supersedes_fact_id_key`;
- self-reference from corrected fact to predecessor;
- `ledger_events.fact_id`;
- `ledger_events.supersedes_fact_id`;
- `ledger_events.reason varchar(500)`;
- `ledger_events_memory_corrected_fact_links_check`.

No parallel mutable history table was introduced.

## Concurrency and rollback evidence

`PrismaMemoryStore.correct()` acquires a stable row lock on the Memory record before comparing `expectedCurrentFactId`. Two simultaneous corrections from the same base therefore serialize: the first accepted correction advances CurrentFact; the second sees the advanced fact and returns stale rather than overwriting it.

A synthetic PostgreSQL trigger forces the final CurrentFact update to fail. The integration test proves all newly appended correction rows are rolled back, leaving the original five-record state intact.

## Current-only retrieval and append-only restore

The browser proof stores a synthetic statement containing `Ana`, corrects it to `Beatriz`, verifies that literal query `Ana` becomes `UNKNOWN` and `Beatriz` becomes `FOUND`, opens the two-version history, then reuses the original text as a new correction. The final history contains three versions and the last appended version is current. No historical row is removed or rewritten.

## Review-driven TDD remediation

A final MESTRE review identified an accessible-feedback defect after successful correction: publishing the new current fact through the parent caused the child effect to erase `Correção salva` immediately.

Evidence:

- RED test-only commit: `1218f03805cca35b3e447d123b18869adbbd3282`.
- RED CI: `32000553631` / job `95299911316`.
- RED outcome: the 94 pre-existing tests passed; the newly added parent-rerender feedback regression failed.
- Fix: `361214e97e9b70df7092ee1f6d5c3944446edda0` distinguishes the component's own published fact from a fresh external query and preserves feedback only for the internal update.
- GREEN CI: `32000681041` / job `95300284264`, 95/95 tests and 3/3 E2E PASS.

## Known maintenance note

GitHub Actions reports that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime and the runner forces them to Node 24. The repository itself requires Node `>=24 <25`, and product validation passed. This is a CI-maintenance note, not a Slice 02 product blocker.

## Governance state

- Pull request #4: OPEN / NOT MERGED.
- Independent Emily audit: NOT PERFORMED in this runtime; no external auditor execution is claimed.
- LÉO internal gate: NOT PERFORMED in this runtime; no internal-agent execution is claimed.
- HUMAN_GATE: PENDING; authority belongs exclusively to LEANDRO.
- Merge authorization: NOT GRANTED.
- Real sensitive data: NOT AUTHORIZED.
- Pilot: NOT AUTHORIZED.
- Slice 03: NOT AUTHORIZED.

## Pre-gate conclusion

The branch is technically validated for the approved Slice 02 boundary with reproducible synthetic evidence. Green CI does not itself complete the governance sequence or authorize merge.