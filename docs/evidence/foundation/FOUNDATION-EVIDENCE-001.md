# FOUNDATION-EVIDENCE-001

## Identity

- Mission: `MDP-001 — Memória Digital Pessoal`
- Boundary: `FOUNDATION — Repository & Product Bootstrap`
- Branch: `foundation/repository-bootstrap`
- Pull request: `#1`
- Reviewed code HEAD: `57341c228cb3303b55d1a4ff7a7dff690f97e546`
- Canonical CI run: `31935826287`
- Canonical CI job: `95137467702`
- CI conclusion: `success`

## Runtime and dependency evidence

- GitHub runner OS: Ubuntu 24.04.4 LTS
- Node: `v24.19.0`
- pnpm: `10.34.0`
- TypeScript: `6.0.3`
- Prisma: `7.9.1`
- Vitest: `4.1.10`
- Playwright: `1.62.1`
- PostgreSQL image: `postgres:17-alpine`

## Database and migration evidence

Canonical CI proved:

- PostgreSQL container started and reached Docker health `healthy`;
- `prisma validate`: PASS;
- `prisma generate`: PASS;
- generated Prisma Client version: `7.9.1`;
- `prisma migrate deploy`: PASS;
- migration `20260816000100_foundation_baseline`: applied successfully;
- product-table assertion: PASS with count `0` excluding Prisma's migration table.

This confirms migration mechanics without introducing Memory/Evidence/Fact/Ledger tables.

## Quality evidence

Canonical CI results:

- frozen-lockfile install: PASS;
- TypeScript typecheck: PASS;
- ESLint: PASS;
- Prettier `format:check`: PASS (`All matched files use Prettier code style!`);
- Vitest: `8` test files PASS, `13` tests PASS;
- API real PostgreSQL integration test: PASS;
- architecture-boundary tests: PASS, including Prisma and Node built-in rejection from domain;
- package runtime import through `@mdp/shared`: PASS;
- web build: PASS;
- API build: PASS.

## Browser E2E evidence

Playwright Chromium result:

- test: `web observes API and PostgreSQL readiness`;
- result: `1 passed`;
- duration reported by Playwright: `3.6s`.

The E2E waits for API readiness, loads the built web application, verifies the accessible product heading/status, and confirms `/health/ready = 200`.

## Health/degradation evidence

The built API was started against the real Compose PostgreSQL service. Canonical CI captured:

```text
healthy live=200 ready=200
db-down live=200 ready=503
```

Bodies captured:

```json
{"status":"live"}
{"status":"ready"}
{"status":"live"}
{"error":{"code":"SERVICE_UNAVAILABLE","message":"Serviço temporariamente indisponível.","requestId":"<generated UUID v7>"}}
```

The evidence demonstrates that liveness remains independent from PostgreSQL readiness and that database failure is converted to the safe API error contract rather than leaking an infrastructure exception.

## Scope evidence

PR #1 changed only FOUNDATION files: workspace/tooling, web/API shells, neutral packages, Prisma/Compose, tests, CI, and FOUNDATION design/plan documents. No product Memory/Evidence/Fact/Ledger implementation is present.

Real sensitive data used: `none`.

## Independent review result

Two Important findings were discovered and resolved before this evidence run:

1. E2E API startup race — FIXED and verified.
2. Missing explicit Node built-in prohibition in neutral domain/contracts — FIXED and verified with an architecture test.

Open Critical findings: `0`.
Open Important findings: `0`.

## Residual findings

- Minor CI-maintenance warning: GitHub runner reports Node-runtime deprecation warnings for `actions/checkout@v4` and `actions/setup-node@v4`; the runner forces those actions onto Node 24 and the workflow passed. Track as future maintenance, not a FOUNDATION blocker.
- pnpm reports Prisma install scripts as ignored under pnpm 10's build-script policy; explicit `prisma validate`, `prisma generate`, migration, integration, build and runtime checks all passed in the canonical run.

## Evidence assessment

All executable technical criteria of the Foundation Readiness Gate were demonstrated successfully on reviewed code HEAD `57341c228cb3303b55d1a4ff7a7dff690f97e546` by CI run `31935826287`.

A subsequent docs/state commit must also pass canonical CI before a final READY recommendation is presented.

FOUNDATION remains `IN_REVIEW`; merge and completion require explicit LEANDRO approval.
