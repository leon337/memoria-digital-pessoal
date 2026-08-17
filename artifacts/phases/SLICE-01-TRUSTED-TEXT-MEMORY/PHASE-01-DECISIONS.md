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

Because this interface manipulates the repository through the GitHub connector rather than a local worktree, PR #2 was opened in draft before implementation solely to expose pull-request CI. Temporary branch-only workflows were allowed only for constrained lockfile/format repairs and were removed immediately after use.

## 2026-08-16 — Rollback-test correction

MESTRE rejected the plan's duplicate-PK rollback injection as the final test mechanism because a constraint violation is not database unavailability. A temporary PostgreSQL trigger now fails the final projection insert and proves full transaction rollback without corrupting outage classification.

Classification: `REQUIRED_FOR_ACCEPTANCE`.

## 2026-08-16 — Review finding 1

Important: the functional UI did not visibly state the synthetic-only laboratory restriction.

Decision: fix before gate readiness.

Result: fixed by `f790ed443a52ce4d6ce954c16f275697f35a805e` and covered by App/E2E tests.

## 2026-08-16 — Review finding 2

Important: web copy diverged from the exact approved implementation-plan copy.

Decision: align copy before gate readiness.

Result: fixed by `ec9e78128e19742ba856fc5d95df014229a934c3` and covered by component/E2E tests.

## 2026-08-16 — Final technical review

Reviewed code HEAD: `07a41381f7bc47d9f048f90f3b36fcc6f85e03d1`.

MESTRE review result:

- Critical open: `0`
- Important open: `0`

This is not represented as Emily's independent MCF audit. Independent audit remains an input to the governed gate.

## 2026-08-16 — Integration boundary

No merge is authorized by implementation or green CI. Real sensitive data remains prohibited. Slice 02 remains unauthorized.
