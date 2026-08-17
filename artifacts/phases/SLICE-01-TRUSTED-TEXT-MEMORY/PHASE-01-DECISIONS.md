# PHASE-01 — Decisions

## 2026-08-16 — Human authorization

LEANDRO explicitly authorized entry into `Slice 01 — Trusted Text Memory`.

## 2026-08-16 — Design choice

LEANDRO approved `Option A — Deterministic Textual Fact`.

## 2026-08-16 — Written specification

LEANDRO approved the written Slice 01 specification.

## 2026-08-16 — Execution mode

LEANDRO selected inline execution.

## 2026-08-16 — CI execution adaptation

Because this interface manipulates the repository through the GitHub connector rather than a local worktree, PR #2 was opened before implementation to expose pull-request CI. Temporary branch-only workflows were constrained to repair tasks and removed after use.

## 2026-08-16 — Rollback-test correction

MESTRE rejected the plan's duplicate-PK rollback injection as the final test mechanism because a constraint violation is not database unavailability. A temporary PostgreSQL trigger fails the final projection insert and proves full transaction rollback without corrupting outage classification.

Classification: `REQUIRED_FOR_ACCEPTANCE`.

## 2026-08-16 — Review finding 1

Important: the functional UI did not visibly state the synthetic-only laboratory restriction.

Decision: fix before gate readiness.

Result: fixed by `f790ed443a52ce4d6ce954c16f275697f35a805e` and covered by App/E2E tests.

## 2026-08-16 — Review finding 2

Important: web copy diverged from the exact approved implementation-plan copy.

Decision: align copy before gate readiness.

Result: fixed by `ec9e78128e19742ba856fc5d95df014229a934c3` and covered by component/E2E tests.

## 2026-08-16 — Post-review P2 finding

Codex identified that Prisma `P2024` and `P2037` connection-capacity failures were not classified as persistence unavailability.

Decision: reproduce by TDD before changing production code.

Evidence:

- RED test-only commit: `b5199578a570ed13e49be92464e1e14d0ca2eb6c`;
- RED CI: `31972074965` / job `95225939147` — two new tests failed while 51 existing tests passed;
- minimal fix commit: `de8185ed1a152c12828bee02a4c8acc3398a6d7d`;
- GREEN CI: `31972155005` / job `95226131010` — 53/53 tests, build and E2E passed.

Result: finding fixed and review thread resolved.

## 2026-08-16 — Independent audit

Emily performed the independent MCF audit after remediation.

Artifact: `docs/audits/SLICE-01-INDEPENDENT-MCF-AUDIT-001.md`.

Decision: `PASS_FOR_GATE`.

## 2026-08-16 — LÉO internal gate

Inputs: completed implementation, PRF, fresh CI, resolved findings, independent audit and zero open Critical/Important findings.

Decision: PASS and escalate to HUMAN_GATE.

## 2026-08-17 — HUMAN_GATE

LEANDRO explicitly authorized:

- merge of PR #2 into `main`;
- formal completion of Slice 01 after post-merge verification.

The authorization explicitly does not cover real sensitive data, pilot or Slice 02.

Decision: `APPROVED`.

## 2026-08-17 — Integration

PR #2 was merged with merge method `merge` to preserve the RED/GREEN, review and PRF history.

Merge commit: `65a3100d86b111e10e696f086ea39a448bb1c05a`.

Result: SUCCESS.

## 2026-08-17 — Post-merge validation

`main` CI `31991656625` / job `95276180583` completed successfully across migrations, exact schema boundary, typecheck, lint, format, PRF manifest, 53 tests, build, 2 E2E tests and real PostgreSQL outage degradation.

Decision: close Slice 01 as `ENTREGUE / COMPLETE`.

## Residual authorization boundary

- Real sensitive data: `NOT AUTHORIZED`.
- Pilot: `NOT AUTHORIZED`.
- Slice 02: `NOT STARTED / NOT AUTHORIZED`.
