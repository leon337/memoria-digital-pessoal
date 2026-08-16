# SLICE-01-EVIDENCE-001 — Trusted Text Memory

## Identity

- Mission: `MDP-001 — Memória Digital Pessoal`
- Boundary: `SLICE 01 — Trusted Text Memory`
- Date: `2026-08-16`
- Branch: `slice/01-trusted-text-memory`
- Pull request: `#2 — SLICE 01: trusted text memory`
- Reviewed code HEAD: `07a41381f7bc47d9f048f90f3b36fcc6f85e03d1`
- Canonical reviewed-code CI: `31939889153` / job `95147424876`
- Evidence classification: laboratory / synthetic data only

## Result

`IN_REVIEW / READY_FOR_GATE`

This record proves implementation and validation readiness. It does not authorize merge, mark Slice 01 complete, permit real sensitive data, or authorize Slice 02.

## Acceptance evidence

| # | Acceptance criterion | Procedure / evidence | Result |
|---|---|---|---|
| 1 | Atomic Memory + Evidence + `MEMORY_CREATED` + Fact + CurrentFact | Real PostgreSQL integration test `prisma-memory.store.integration.test.ts`; migration and CI | PASS |
| 2 | Original text preserved unchanged | Contracts/domain/integration tests include valid leading/trailing whitespace round trip | PASS |
| 3 | `Fact.content === Evidence.content` | Domain and real PostgreSQL integration assertions | PASS |
| 4 | Evidence and Ledger cannot be silently overwritten through Slice 01 behavior | No PUT/PATCH/DELETE memory feature routes; executable scope invariant | PASS |
| 5 | Deterministic case-insensitive literal substring query | Parameterized `strpos(lower(content), lower(parameter))` integration test | PASS |
| 6 | Multiple matches use stable ordering | Integration test proves newest `recordedAt`, then ascending `factId` | PASS |
| 7 | FOUND carries provenance | Service/controller/component/E2E proofs preserve Memory/Fact/Evidence linkage; UI renders human-readable source | PASS |
| 8 | No match returns explicit `UNKNOWN` with no fabricated answer | Contract, service, component and browser E2E tests | PASS |
| 9 | Forced persistence failure leaves no partial state | Deliberate final-projection insert failure inside real PostgreSQL transaction; all five table counts remain zero | PASS |
| 10 | Unit, integration, architecture/invariant and browser E2E tests pass | Canonical CI `31939889153` | PASS |
| 11 | Foundation regressions remain green | Health/readiness, Foundation browser E2E and database-outage proof in canonical CI | PASS |
| 12 | Only synthetic, non-sensitive test data is used | Synthetic fixtures plus explicit laboratory warning in UI | PASS |
| 13 | No out-of-scope AI/infrastructure enters Slice 01 | Architecture scope test checks exact five models and forbidden dependencies | PASS |
| 14 | Evidence, review, CI and gate boundary are enforced before merge | PR #2 remains open/not merged; this evidence + PRF + review findings recorded | PASS FOR GATE READINESS |

## Persistence and schema evidence

The migration introduces exactly these product tables:

```text
current_facts
evidence
facts
ledger_events
memories
```

Canonical CI asserts that exact allowlist after migrations. No Redis, BullMQ, pgvector, object storage, AI provider, worker, voice, offline or synchronization infrastructure was introduced.

## Query evidence

Slice 01 retrieval is literal and parameterized:

```text
strpos(lower(content), lower(query)) > 0
ORDER BY recorded_at DESC, fact_id ASC
```

Integration tests prove case-insensitive matching, literal `%` and `_`, deterministic ordering, provenance, and `UNKNOWN`.

## Transaction rollback evidence

The approved plan proposed a duplicate-PK failure. During implementation this was corrected: a synthetic database trigger fails the final `current_facts` insert after the prior canonical inserts. This avoids misclassifying a data-integrity violation as service unavailability while proving the actual acceptance invariant: a late persistence failure rolls back Memory, Evidence, LedgerEvent, Fact and CurrentFact together.

## Outage evidence

Canonical CI starts the built API with PostgreSQL healthy, proves live/ready `200/200`, stops PostgreSQL, proves live/ready `200/503`, and performs a real `POST /memories` while the database is unavailable. The memory request returns a safe `503 SERVICE_UNAVAILABLE` envelope without SQL or submitted content leakage.

## Review evidence

MESTRE performed a full-diff technical review. Findings:

1. Important — the synthetic-only laboratory restriction was not visible in the functional UI. Fixed by commit `f790ed443a52ce4d6ce954c16f275697f35a805e` with automated coverage.
2. Important — web copy diverged from the exact approved implementation-plan copy. Fixed by commit `ec9e78128e19742ba856fc5d95df014229a934c3` with component/E2E coverage.
3. Validation defect — after copy alignment, the E2E label selector became ambiguous. Fixed by role-specific selectors and canonical formatting in `07a41381f7bc47d9f048f90f3b36fcc6f85e03d1`.

Open Critical findings: `0`.
Open Important findings: `0`.

This MESTRE review is not represented as Emily's independent MCF audit. Independent MCF audit remains a gate input and must not be inferred from this document.

## Execution failure and recovery trace

- `31938251896` — RED: frozen lockfile detected workspace dependency drift.
- `31938282421` — recovery PASS: temporary branch-only lockfile repair changed only `pnpm-lock.yaml`; helper workflow removed.
- `31938312773` — RED: formatting.
- `31938399126` — format recovery PASS.
- `31938438913` — Task 1 full CI PASS.
- `31938560238` — Task 2 schema/migration full CI PASS.
- `31938652083` — RED: Task 3 formatting.
- `31938704632` — Task 3 format recovery PASS.
- `31938733775` — Task 3 tests PASS.
- `31938834501` — RED: Task 4 formatting.
- `31938999059` — RED: Task 5 formatting.
- `31939182334` — canonical HTTP/web formatting recovery.
- `31939219339` — RED: React test DOM isolation.
- `31939294468` — recovery PASS including real PostgreSQL 503 proof.
- `31939371905` — RED: Task 7 scope-test formatting.
- `31939445337` — Task 7 format recovery PASS.
- `31939473156` — Task 7 full CI PASS before review fixes.
- `31939687037` — RED: E2E selector ambiguity after exact copy alignment.
- `31939832073` — RED: final selector fix required canonical formatting.
- `31939889153` — canonical reviewed-code CI PASS on `07a41381f7bc47d9f048f90f3b36fcc6f85e03d1`.

## Known limitations

- Literal retrieval intentionally does not understand natural-language questions, synonyms, stemming or semantics.
- No correction/history, offline, sync, embeddings, AI, voice, reminders, advanced auth, backup/restore/purge or pilot behavior is claimed.
- Real sensitive data remains prohibited.
- GitHub Actions logs retain the existing maintenance warning that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime and are forced by the runner to Node 24.
- Independent MCF audit is not simulated and remains a gate input.

## Gate boundary

Evidence is sufficient to present Slice 01 for its governed gate. PR #2 must remain unmerged until the required gate process authorizes integration.
