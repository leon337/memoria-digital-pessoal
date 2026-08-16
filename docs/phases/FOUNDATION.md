# FOUNDATION — Repository & Product Bootstrap

## Mission

`MDP-001 — Memória Digital Pessoal`

## Status

`IN_REVIEW`

## Branch and review

- Branch: `foundation/repository-bootstrap`
- Pull request: `#1 — FOUNDATION: repository and product bootstrap`
- Reviewed code HEAD: `57341c228cb3303b55d1a4ff7a7dff690f97e546`
- Canonical verification run: GitHub Actions `CI` run `31935826287`
- Verification job: `95137467702`

## Scope delivered

- pnpm Workspaces monorepo;
- ESM and strict shared TypeScript baseline;
- `apps/web` React/Vite shell;
- `apps/api` NestJS shell;
- neutral `@mdp/domain`, `@mdp/contracts`, `@mdp/shared` packages;
- UUID v7 global ID primitive;
- Zod typed environment validation;
- structured safe API error envelope and request correlation ID;
- PostgreSQL 17-alpine through Docker Compose;
- Prisma 7 isolated in API persistence infrastructure;
- baseline migration with zero product tables;
- `/health/live` and `/health/ready`;
- ESLint architecture boundaries and Prettier formatting;
- Vitest unit/integration/component/architecture suites;
- Playwright Chromium E2E over built applications;
- canonical GitHub Actions CI with real PostgreSQL degradation proof.

## Explicitly not delivered

- Memory, Evidence, Fact, Ledger product behavior;
- Slice 01 textual memory flow;
- Redis/BullMQ/worker;
- pgvector or embeddings;
- generative AI;
- STT/TTS;
- object storage;
- offline/synchronization;
- advanced authentication/recovery;
- production VPS deployment;
- real sensitive data.

## Review findings

Independent review found two Important issues before readiness:

1. Browser E2E could race because the web server could answer before the API was ready. Fixed by polling `/health/ready` before navigating to the UI.
2. Domain/contracts lint boundaries did not explicitly reject Node built-in modules. Fixed by prohibiting Node built-ins/`node:*` and adding an executable `node:fs/promises` rejection test.

Both findings were fixed before the successful canonical CI run.

## Residual finding

- Minor / maintenance: GitHub Actions logs warn that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime and are currently forced to run on Node 24 by the runner. This did not affect the verified workflow result and does not alter application runtime selection.

## Current gate

Implementation and technical verification are complete, but FOUNDATION is **not yet COMPLETE**. It remains `IN_REVIEW` until LEANDRO explicitly approves the Foundation Readiness Gate and merge of PR #1.

## Next boundary

`Slice 01 — Trusted Text Memory` remains `NOT STARTED / NOT AUTHORIZED`.
