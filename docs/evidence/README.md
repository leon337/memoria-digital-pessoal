# MDP-001 — Evidence Conventions

## Purpose

Evidence proves that a phase, slice or gate actually satisfied its acceptance criteria. Agent statements are not sufficient evidence by themselves.

## Evidence principles

1. Evidence must be reproducible or independently inspectable.
2. Evidence must point to the exact boundary it supports.
3. Evidence must not contain real sensitive user data before Pilot Readiness + HUMAN_GATE.
4. Synthetic fixtures and redacted samples are preferred during laboratory phases.
5. A PASS without a supporting artifact or verifiable result is not a completed gate.

## Typical evidence

- automated test output;
- CI run/check result;
- migration result;
- API response using synthetic fixtures;
- E2E reproduction steps/result;
- relevant logs with secrets and personal data removed;
- screenshots when visual behavior matters;
- backup/restore verification result;
- purge verification result;
- security/recovery test result;
- commit SHA;
- PR number and review result;
- gate report.

## Naming

Use boundary-oriented names, for example:

`FOUNDATION-EVIDENCE-001.md`

`SLICE-01-EVIDENCE-001.md`

`PILOT-READINESS-EVIDENCE-001.md`

## Minimum evidence record

Each record should contain:
- mission/boundary ID;
- date/time when relevant;
- acceptance criterion being proven;
- procedure or command used;
- observed result;
- PASS/FAIL/BLOCKED classification;
- artifact/reference;
- commit/PR when applicable;
- known limitations.

## Safety

Never commit passwords, API keys, recovery secrets, encryption keys, private tokens or unredacted sensitive personal evidence to the repository.
