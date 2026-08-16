# MDP-001 — FOUNDATION Design Specification

Date: 2026-08-16
Status: APPROVED DESIGN / USER REVIEW PENDING
Mission: `MDP-001 — Memória Digital Pessoal`
Boundary: `FOUNDATION — Repository & Product Bootstrap`
Branch: `foundation/repository-bootstrap`

## 1. Purpose

Establish the minimum technical foundation required to implement Slice 01 without prematurely introducing capabilities that belong to later boundaries.

The FOUNDATION proves that the repository can host a reproducible, typed, testable web/API monorepo connected to PostgreSQL, with explicit architectural boundaries and evidence-based readiness.

The FOUNDATION does **not** implement the memory product domain flow yet.

## 2. Scope

### In scope

- pnpm workspace monorepo;
- React + TypeScript + Vite web application scaffold;
- Node.js + TypeScript + NestJS API scaffold;
- internal packages `@mdp/domain`, `@mdp/contracts`, `@mdp/shared`;
- shared strict TypeScript baseline;
- ESM across the monorepo;
- ESLint for code quality and architectural rules;
- Prettier for formatting;
- Vitest as the standard unit/integration/component test runner;
- React Testing Library + user-event for frontend behavior tests;
- Playwright for critical browser E2E;
- PostgreSQL in Docker Compose for local development;
- Prisma schema and versioned migrations;
- typed environment validation with fail-fast startup;
- UUID v7 generation policy;
- API liveness/readiness endpoints;
- stable structured API error envelope;
- minimum CI checks;
- reproducible evidence for the FOUNDATION gate.

### Out of scope

- Memory, Evidence, Fact or Ledger product behavior;
- textual memory creation/query flow;
- Redis;
- BullMQ;
- async worker;
- pgvector;
- embeddings;
- generative AI;
- STT/TTS;
- object storage;
- offline-first behavior;
- synchronization;
- passkey/recovery hardening;
- production VPS deployment.

## 3. Repository structure

```text
memoria-digital-pessoal/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── domain/
│   ├── contracts/
│   └── shared/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── infra/
├── docs/
├── tests/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── tsconfig.base.json
```

The monorepo uses pnpm Workspaces only. Nx and Turborepo are explicitly deferred until task orchestration or caching complexity justifies them.

## 4. Module system

ESM is the default everywhere.

The root package declares `"type": "module"`. Apps and internal packages use `import`/`export`. The FOUNDATION does not publish dual ESM/CommonJS builds.

A dependency-specific compatibility exception is allowed only when unavoidable and must not change the monorepo-wide default.

## 5. Internal package contracts

Internal workspace packages are named:

- `@mdp/domain`
- `@mdp/contracts`
- `@mdp/shared`

Consumers import only through each package public entry point. Deep imports into `packages/*/src/...` are prohibited.

Workspace dependencies use `workspace:*`.

### Dependency direction

```text
apps/web ─┐
          ├──> @mdp/* public APIs
apps/api ─┘

apps/web  -X-> apps/api source
apps/api  -X-> apps/web source
```

### Domain isolation

`@mdp/domain` must not import:

- React;
- NestJS;
- Prisma;
- PostgreSQL-specific libraries;
- Node platform APIs;
- browser platform APIs;
- Redis/BullMQ;
- AI SDKs;
- S3 SDKs.

The domain package remains framework-neutral and infrastructure-neutral.

`@mdp/contracts` defines stable ports/interfaces required between domain/application logic and infrastructure adapters. It also remains framework-neutral.

`@mdp/shared` contains only genuinely cross-cutting primitives and utilities. It must not become a dumping ground for unrelated code.

## 6. TypeScript strategy

`tsconfig.base.json` owns the common strict baseline. Each app/package extends it and adds only environment-specific settings.

Required baseline guarantees include:

- `strict`;
- `noUncheckedIndexedAccess`;
- `exactOptionalPropertyTypes`;
- `noImplicitOverride`;
- `forceConsistentCasingInFileNames`;
- `isolatedModules`.

Environment specialization:

- web: React/Vite and DOM types;
- api: Node/NestJS types;
- domain/contracts/shared: neutral TypeScript without implicit Node or DOM assumptions.

## 7. Lint and formatting

ESLint owns code-quality and architectural checks.

Prettier owns mechanical formatting.

Expected root scripts:

```text
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
```

Architectural linting should be able to reject forbidden imports into `@mdp/domain` and related neutral packages.

## 8. Test architecture

### Vitest

Vitest is the standard runner for:

- unit tests;
- integration tests;
- package tests;
- React component/behavior tests.

Projects use environment-appropriate configuration:

- web: browser-like React test environment;
- api: Node;
- domain/contracts/shared: Node-compatible neutral tests.

### Frontend behavior tests

React Testing Library + user-event are the standard for component behavior.

Tests prefer:

- role;
- accessible name;
- label;
- visible text.

Tests should avoid coupling to internal component state, CSS selectors or broad snapshot testing as the main strategy.

### Browser E2E

Playwright owns critical full-browser flows.

The FOUNDATION E2E is intentionally small and proves only infrastructure integration:

```text
browser opens web app
→ web loads successfully
→ API is reachable
→ readiness reports healthy with PostgreSQL available
```

Slice 01 will extend E2E to the actual memory flow.

## 9. Environment configuration

Environment access follows:

```text
.env
→ schema validation
→ typed configuration
→ application
```

Rules:

- invalid required configuration causes fail-fast startup;
- secrets are never committed;
- `.env.example` contains safe placeholders only;
- modules do not read `process.env` arbitrarily;
- web validates only web-relevant variables;
- API validates only API-relevant variables;
- valid and invalid configuration paths are tested.

## 10. Persistence boundary

PostgreSQL is the operational database baseline.

Prisma is restricted to API infrastructure.

```text
@mdp/domain
@mdp/contracts
@mdp/shared
        ↑
        │ no Prisma types
apps/api/application
        ↑
apps/api/infrastructure/persistence/prisma
        ↑
PostgreSQL
```

Prisma-generated types must not become domain types or public API contracts.

Specialized SQL, when later required, must remain behind the same infrastructure/repository boundaries.

## 11. Prisma layout

The canonical database definition lives at repository root:

```text
prisma/
├── schema.prisma
└── migrations/
```

Runtime integration lives under API infrastructure:

```text
apps/api/src/infrastructure/persistence/prisma/
├── prisma.service.ts
└── adapters/
```

The root `prisma/` directory owns schema evolution and versioned migrations. API infrastructure owns runtime access.

## 12. Local development and Docker Compose

During FOUNDATION development:

```text
Docker Compose
└── PostgreSQL
    ├── persistent volume
    └── healthcheck

Host
├── pnpm dev:web
└── pnpm dev:api
```

The FOUNDATION does not require web/API production containers yet.

The Compose file must be structured so later boundaries can add services such as worker, Redis, object storage and reverse proxy without invalidating the local-development model.

## 13. API health model

Two endpoints are required.

### `GET /health/live`

Answers whether the API process is alive. It must not depend on PostgreSQL availability.

Expected healthy result: HTTP 200.

### `GET /health/ready`

Answers whether the application is ready to serve requests. In the FOUNDATION it verifies at minimum:

- valid runtime configuration;
- PostgreSQL connectivity.

Expected behavior:

```text
PostgreSQL available
→ /health/live  = 200
→ /health/ready = 200

PostgreSQL unavailable
→ /health/live  = 200
→ /health/ready = 503
```

## 14. Global IDs

UUID v7 is the standard global ID format.

IDs are generated at the edge that creates an object rather than exclusively by PostgreSQL.

Future creation points may include:

- browser/offline client;
- API;
- worker.

This FOUNDATION establishes the reusable ID primitive/policy but does not create product Memory/Evidence/Ledger records yet.

## 15. HTTP error contract

The API exposes a stable application error envelope rather than raw framework/database exceptions.

Base shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Os dados enviados são inválidos.",
    "requestId": "..."
  }
}
```

Validation errors may add structured `fields` information.

Rules:

- HTTP status communicates protocol semantics;
- `error.code` is stable for client logic;
- `message` is safe and user-comprehensible;
- `requestId` supports log correlation;
- Prisma/PostgreSQL messages are not exposed;
- stack traces are not returned to clients;
- frontend logic must not depend on exact human-readable message text.

## 16. Minimum CI contract

The FOUNDATION CI must execute the checks appropriate to this boundary:

- dependency install using the lockfile;
- TypeScript typecheck;
- ESLint;
- Prettier format check;
- Vitest suites;
- web build;
- API build;
- Prisma schema/migration validation;
- minimum Playwright E2E with PostgreSQL available.

A required check failing blocks integration of the FOUNDATION branch.

CI is progressive: later slices extend the suite instead of replacing these guarantees.

## 17. Error and failure handling

The FOUNDATION must explicitly prove these failure behaviors:

1. Missing/invalid required environment variable → application fails startup with a controlled configuration error.
2. PostgreSQL unavailable → API process remains live but readiness returns 503.
3. PostgreSQL/Prisma internal error → client receives the stable safe error contract, not implementation details.
4. Test/build/lint/format failure → CI gate fails.
5. Forbidden architectural import → static quality check fails.

## 18. Foundation Readiness Gate

The FOUNDATION is `COMPLETE` only when reproducible evidence proves all required categories.

### Monorepo

- pnpm workspace is functional;
- `apps/web` exists and builds;
- `apps/api` exists and builds;
- `@mdp/domain`, `@mdp/contracts`, `@mdp/shared` resolve by package name.

### Quality

- strict TypeScript checks pass;
- lint passes;
- format check passes;
- Vitest passes;
- React behavior test passes;
- Playwright minimum E2E passes.

### Database

- PostgreSQL starts through Docker Compose;
- database container healthcheck passes;
- Prisma schema validates;
- initial migration applies successfully;
- API can connect to PostgreSQL.

### Configuration

- typed validation is active;
- fail-fast behavior is tested;
- `.env.example` contains no secret value.

### API

- `/health/live` behaves as specified;
- `/health/ready` behaves as specified;
- structured error envelope is implemented and tested;
- request correlation ID is exposed in errors and available for logging correlation.

### Architecture

- domain is independent of Prisma/NestJS/React/platform APIs;
- internal imports use `@mdp/*` public APIs rather than deep relative imports;
- architectural restrictions are testable or lint-enforced.

### CI and evidence

- required CI checks pass;
- commands required to reproduce the gate are documented;
- relevant outputs are captured under the project evidence convention;
- branch receives review before merge;
- the FOUNDATION gate is explicitly recorded.

## 19. Acceptance evidence

At gate time, evidence should include at minimum:

- exact commit SHA;
- CI/check results;
- successful workspace install/typecheck/lint/format/test/build outputs;
- Docker Compose PostgreSQL health result;
- successful migration result;
- API live/ready responses under healthy database conditions;
- live/ready responses with database intentionally unavailable;
- Playwright result;
- architecture-boundary check result;
- PR/review reference;
- Foundation gate decision.

## 20. Non-goals and YAGNI guardrails

The implementation must not add infrastructure merely because it is likely to be useful later.

In particular, the FOUNDATION must reject scope creep toward:

- Redis/BullMQ;
- worker processes;
- pgvector;
- LLM/embedding/STT/TTS providers;
- S3-compatible object storage;
- product memory entities/flows;
- offline sync;
- advanced authentication;
- production deployment automation.

If one of these becomes necessary to satisfy a FOUNDATION acceptance criterion, it must be classified as a finding and explicitly justified rather than silently introduced.

## 21. Decision register — FOUNDATION Q1–Q16

1. pnpm Workspaces without Nx/Turborepo.
2. ESM throughout the monorepo.
3. Internal packages consumed as `@mdp/*` workspace packages.
4. Shared strict TypeScript base plus controlled specialization.
5. ESLint + Prettier with separate responsibilities.
6. Vitest as the standard monorepo test runner.
7. React Testing Library + user-event for behavior-oriented frontend tests.
8. Typed central environment validation with fail-fast startup.
9. Prisma restricted to API infrastructure.
10. Root `prisma/` schema/migrations plus runtime adapters in API infrastructure.
11. Docker Compose for PostgreSQL; web/API run on host during development.
12. Separate `/health/live` and `/health/ready` endpoints.
13. UUID v7 generated at the creation edge.
14. Stable structured API error envelope with application error codes and request ID.
15. Playwright for critical browser E2E.
16. Evidence-based Foundation Readiness Gate.

## 22. Transition condition

After this specification is reviewed and approved in its written form, the next action is to create a detailed implementation plan. No scaffold or product code may be written before that plan exists and is approved for execution.
