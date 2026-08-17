# SLICE-01-EVIDENCE-001 — Trusted Text Memory

## Identity

- Mission: `MDP-001 — Memória Digital Pessoal`
- Boundary: `SLICE 01 — Trusted Text Memory`
- Date: `2026-08-16`
- Branch: `slice/01-trusted-text-memory`
- Pull request: `#2 — SLICE 01: trusted text memory`
- Validated product-code HEAD: `de8185ed1a152c12828bee02a4c8acc3398a6d7d`
- Canonical product-code CI: `31972155005` / job `95226131010`
- Evidence classification: laboratory / synthetic data only

## Result

`IN_REVIEW / READY_FOR_GATE`

This record proves implementation, remediation, validation and independent-audit readiness. It does not authorize merge, mark Slice 01 complete, permit real sensitive data, pilot, or authorize Slice 02.

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
| 10 | Unit, integration, architecture and browser E2E pass | Canonical CI `31972155005` | PASS |
| 11 | Foundation regressions remain green | Health/readiness, Foundation E2E and outage proof | PASS |
| 12 | Only synthetic, non-sensitive data is used | Synthetic fixtures and explicit laboratory warning | PASS |
| 13 | No out-of-scope AI/infrastructure enters Slice 01 | Architecture scope test and dependency boundary | PASS |
| 14 | Evidence, review, CI and gate are complete before merge | Evidence/review/CI/audit are gate-ready; merge remains blocked pending governed gate | PASS FOR GATE READINESS |

## Post-review defect and TDD remediation

Codex identified a P2 defect after the original gate-readiness checkpoint: Prisma connection-capacity errors `P2024` and `P2037` were not classified as persistence unavailability and could escape as generic HTTP 500 responses.

The finding was independently reproduced before production code was changed:

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

Canonical CI proves migrations, exact table allowlist, atomic rollback, literal parameterized retrieval, safe `SERVICE_UNAVAILABLE` responses, and no submitted-content/SQL leakage during the database-outage proof.

## Review and audit evidence

MESTRE technical review previously fixed:
1. Important — synthetic-only restriction missing from the functional UI.
2. Important — web copy drift from the approved plan.
3. Validation defect — ambiguous Playwright selector after exact copy alignment.

Post-review Codex P2:
4. Connection-pool exhaustion (`P2024`/`P2037`) not mapped to service unavailable — FIXED and regression-tested.

Current review state:
- Open Critical findings: `0`.
- Open Important findings: `0`.
- Open review threads: `0`.

Independent MCF audit:
- Auditor role: Emily.
- Artifact: `docs/audits/SLICE-01-INDEPENDENT-MCF-AUDIT-001.md`.
- Verdict: `PASS_FOR_GATE`.
- Merge authorization: `NOT GRANTED`.

## Known limitations and safety boundary

- Retrieval is intentionally literal, not semantic.
- No correction/history, offline, sync, embeddings, AI, voice, reminders, advanced auth, backup/restore/purge or pilot behavior is claimed.
- Real sensitive data remains prohibited.
- Slice 02 remains unauthorized.
- GitHub Actions logs retain the maintenance warning that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime and are forced by the runner to Node 24.

## Gate boundary

Evidence is sufficient to enter the governed Slice 01 gate. PR #2 must remain unmerged until the applicable internal gate and HUMAN_GATE authorize integration.
