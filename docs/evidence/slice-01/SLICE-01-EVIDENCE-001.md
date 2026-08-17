# SLICE-01-EVIDENCE-001 — Trusted Text Memory

## Identity

- Mission: `MDP-001 — Memória Digital Pessoal`
- Boundary: `SLICE 01 — Trusted Text Memory`
- Initial evidence date: `2026-08-16`
- Closeout date: `2026-08-17`
- Pull request: `#2 — SLICE 01: trusted text memory`
- Final branch HEAD: `47b7c6bacd5f0d74a184a61ea5ae5d7f94401c5f`
- Merge commit: `65a3100d86b111e10e696f086ea39a448bb1c05a`
- Validated product-code HEAD: `de8185ed1a152c12828bee02a4c8acc3398a6d7d`
- Canonical product-code CI: `31972155005` / job `95226131010`
- Post-merge `main` CI: `31991656625` / job `95276180583`
- Evidence classification: laboratory / synthetic data only

## Result

`COMPLETE / ENTREGUE / MERGED / POST-MERGE VALIDATED`

This record proves the Slice 01 implementation, remediation, validation, review, independent audit, human authorization, integration and post-merge verification. Completion does not permit real sensitive data, pilot or Slice 02.

## Acceptance evidence

| # | Acceptance criterion | Procedure / evidence | Result |
|---|---|---|---|
| 1 | Atomic Memory + Evidence + `MEMORY_CREATED` + Fact + CurrentFact | Real PostgreSQL integration test and migration | PASS |
| 2 | Original text preserved unchanged | Domain/integration round-trip including valid surrounding whitespace | PASS |
| 3 | `Fact.content === Evidence.content` | Domain and PostgreSQL assertions | PASS |
| 4 | Evidence and Ledger cannot be silently overwritten | No mutation routes; executable scope invariant | PASS |
| 5 | Deterministic case-insensitive literal substring query | Parameterized `strpos(lower(content), lower(parameter))` | PASS |
| 6 | Multiple matches use stable ordering | Newest `recordedAt`, then ascending `factId` | PASS |
| 7 | FOUND carries provenance | Service/controller/component/E2E linkage | PASS |
| 8 | No match returns explicit `UNKNOWN` | Contract, service, component and browser tests | PASS |
| 9 | Forced persistence failure leaves no partial state | Late `current_facts` failure inside real PostgreSQL transaction | PASS |
| 10 | Unit, integration, architecture and browser E2E pass | Canonical CI `31972155005` and post-merge CI `31991656625` | PASS |
| 11 | Foundation regressions remain green | Health/readiness, Foundation E2E and outage proof | PASS |
| 12 | Only synthetic, non-sensitive data is used | Synthetic fixtures and explicit laboratory warning | PASS |
| 13 | No out-of-scope AI/infrastructure enters Slice 01 | Architecture scope test and dependency boundary | PASS |
| 14 | Evidence, review, CI and gate are complete before merge | Review/audit/gates completed; HUMAN_GATE approved; PR #2 merged; post-merge CI passed | PASS |

## Post-review defect and TDD remediation

Codex identified a P2 defect after the original gate-readiness checkpoint: Prisma connection-capacity errors `P2024` and `P2037` were not classified as persistence unavailability and could escape as generic HTTP 500 responses.

The finding was reproduced before production code was changed:

- RED test-only commit: `b5199578a570ed13e49be92464e1e14d0ca2eb6c`.
- RED CI `31972074965` / job `95225939147`: both new regression tests failed; all 51 pre-existing tests passed.
- Root cause: the explicit availability allowlist omitted `P2024` and `P2037`.
- Minimal fix: commit `de8185ed1a152c12828bee02a4c8acc3398a6d7d` adds only those two Prisma codes.
- GREEN CI `31972155005` / job `95226131010`: 18 test files / 53 tests passed; build and 2 E2E tests passed; real PostgreSQL outage still returned safe 503 behavior.
- The PR review thread was answered with this evidence and resolved.

No future-slice functionality was introduced by the fix.

## Proven persistence and outage behavior

The product schema remains exactly:

```text
current_facts
evidence
facts
ledger_events
memories
```

Canonical and post-merge CI prove migrations, exact table allowlist, atomic rollback, literal parameterized retrieval, safe `SERVICE_UNAVAILABLE` responses, and no submitted-content/SQL leakage during the database-outage proof.

## Review, audit and gate evidence

MESTRE technical review fixed:

1. Important — synthetic-only restriction missing from the functional UI.
2. Important — web copy drift from the approved plan.
3. Validation defect — ambiguous Playwright selector after exact copy alignment.

Post-review Codex P2:

4. Connection-pool exhaustion (`P2024`/`P2037`) not mapped to service unavailable — FIXED and regression-tested.

Final review state:

- Open Critical findings: `0`.
- Open Important findings: `0`.
- Open review threads: `0`.

Independent MCF audit:

- Auditor role: Emily.
- Artifact: `docs/audits/SLICE-01-INDEPENDENT-MCF-AUDIT-001.md`.
- Verdict at audit time: `PASS_FOR_GATE`.

Gate sequence after audit:

- LÉO internal gate: PASS.
- HUMAN_GATE: explicitly APPROVED by LEANDRO on `2026-08-17`.
- PR #2 merge: SUCCESS at `65a3100d86b111e10e696f086ea39a448bb1c05a`.
- Post-merge `main` CI `31991656625`: PASS.

## Known limitations and safety boundary

- Retrieval is intentionally literal, not semantic.
- No correction/history, offline, sync, embeddings, AI, voice, reminders, advanced auth, backup/restore/purge or pilot behavior is claimed.
- Real sensitive data remains prohibited.
- Slice 02 remains unauthorized.
- GitHub Actions logs retain the maintenance warning that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime and are forced by the runner to Node 24.

## Closeout boundary

Slice 01 is complete and integrated. This closeout does not authorize any next-slice or sensitive-data boundary.
