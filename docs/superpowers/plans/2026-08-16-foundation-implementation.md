# FOUNDATION Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimum reproducible web/API monorepo foundation required for Slice 01, with strict architectural boundaries, PostgreSQL/Prisma connectivity, tests, E2E, CI, and evidence-based readiness, without implementing the memory product flow.

**Architecture:** A pnpm Workspace contains `apps/web`, `apps/api`, and framework-neutral packages `@mdp/domain`, `@mdp/contracts`, and `@mdp/shared`. PostgreSQL runs in Docker Compose while web/API run on the host for development. Prisma lives only in API infrastructure, and quality gates enforce ESM, strict TypeScript, safe configuration, API health/error contracts, critical E2E, and repository evidence.

**Tech Stack:** Node.js 24 LTS, pnpm 10.x, TypeScript, React, Vite, NestJS, PostgreSQL, Prisma ORM 7, `@prisma/adapter-pg`, Zod, `uuid`, ESLint flat config, Prettier, Vitest, React Testing Library, `user-event`, Playwright, Docker Compose, GitHub Actions.

## Global Constraints

- Branch: `foundation/repository-bootstrap`.
- ESM throughout the monorepo; root package declares `"type": "module"`.
- pnpm Workspaces only; no Nx or Turborepo.
- Internal package names are exactly `@mdp/domain`, `@mdp/contracts`, and `@mdp/shared`.
- Internal dependencies use `workspace:*`; deep imports into `packages/*/src/...` are prohibited.
- `@mdp/domain` and `@mdp/contracts` remain framework-neutral and infrastructure-neutral.
- Prisma is restricted to `apps/api/src/infrastructure/persistence/prisma/` plus root Prisma schema/migrations.
- TypeScript baseline enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `forceConsistentCasingInFileNames`, and `isolatedModules`.
- ESLint owns code-quality/architectural checks; Prettier owns formatting.
- Vitest owns unit/integration/component tests; Playwright owns critical browser E2E.
- PostgreSQL is the only Docker Compose service in FOUNDATION.
- `/health/live` must not depend on PostgreSQL; `/health/ready` must return 503 when PostgreSQL is unavailable.
- UUID v7 is the global object-ID policy; product entities are not introduced in FOUNDATION.
- API errors expose a stable `error.code`, safe `message`, and `requestId`; raw Prisma/PostgreSQL errors and stack traces are not returned to clients.
- Real sensitive data remains prohibited.
- Do not add Redis, BullMQ, worker processes, pgvector, AI, embeddings, STT/TTS, object storage, offline sync, advanced auth, or production deployment automation.
- The FOUNDATION is not complete until the evidence-based readiness gate is recorded and reviewed.

## Resolved implementation baseline

- Use Node.js 24 because it is an LTS line at plan time; do not use Node 26 Current for this boundary.
- Run `corepack use pnpm@latest-10` once during Task 1 so `packageManager` is pinned to the resolved pnpm 10 release in `package.json`.
- Use Prisma ORM 7 `prisma-client` generator with explicit `output` and `moduleFormat = "esm"`.
- Use `@prisma/adapter-pg` for PostgreSQL runtime connectivity.
- Use the `uuid` package `v7()` API for UUID v7 generation.
- Use Zod for typed web/API environment parsing.
- Use ESLint flat config (`eslint.config.mjs`) and `typescript-eslint`.
- Use Vitest `test.projects` rather than deprecated workspace configuration.
- Playwright FOUNDATION coverage targets Chromium only; additional engines are deferred.

---

## Planned file map

### Root

- `package.json` — workspace scripts, package-manager pin, Node engine.
- `pnpm-workspace.yaml` — workspace package globs.
- `pnpm-lock.yaml` — reproducible dependency graph.
- `.nvmrc` — Node 24 baseline.
- `.gitignore` — secrets, generated Prisma client, builds, test artifacts.
- `.env.example` — safe local-development variables only.
- `tsconfig.base.json` — shared strict compiler baseline.
- `eslint.config.mjs` — quality and architecture rules.
- `.prettierrc.json`, `.prettierignore` — formatting contract.
- `vitest.config.ts` — multi-project test entry point.
- `playwright.config.ts` — Chromium E2E and local web-server orchestration.
- `compose.yaml` — PostgreSQL development service.
- `prisma.config.ts` — Prisma schema, migrations, and datasource configuration.

### Packages

- `packages/domain/package.json`, `tsconfig.json`, `src/index.ts` — neutral domain boundary placeholder, no product entities.
- `packages/contracts/package.json`, `tsconfig.json`, `src/index.ts` — neutral contract boundary placeholder.
- `packages/shared/package.json`, `tsconfig.json`, `src/index.ts` — public shared API.
- `packages/shared/src/id.ts` — UUID v7 primitive.
- `packages/shared/src/id.test.ts` — UUID v7 behavior test.

### Web

- `apps/web/package.json`, `tsconfig*.json`, `vite.config.ts`, `index.html` — Vite/React app shell.
- `apps/web/src/config/env.ts` — typed Vite environment parsing.
- `apps/web/src/config/env.test.ts` — valid/invalid web config tests.
- `apps/web/src/lib/api-health.ts` — API readiness client.
- `apps/web/src/App.tsx` — FOUNDATION status UI only.
- `apps/web/src/App.test.tsx` — accessibility-oriented behavior test.
- `apps/web/src/test/setup.ts` — Testing Library setup.
- `apps/web/src/main.tsx`, `src/index.css` — app entry and minimal CSS.

### API

- `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json` — Nest app shell.
- `apps/api/src/config/env.ts` — Zod API configuration parser.
- `apps/api/src/config/env.test.ts` — fail-fast configuration tests.
- `apps/api/src/config/env.module.ts` — single process-env access boundary and DI token.
- `apps/api/src/common/http/request-id.middleware.ts` — request correlation ID.
- `apps/api/src/common/http/express.d.ts` — typed `requestId` augmentation.
- `apps/api/src/common/http/api-error.ts` — stable error shape/codes.
- `apps/api/src/common/http/api-error.filter.ts` — safe exception mapping.
- `apps/api/src/common/http/api-error.filter.test.ts` — mapping tests including internal-error hiding.
- `apps/api/src/health/health.controller.ts` — `/health/live` and `/health/ready` routes.
- `apps/api/src/health/health.service.ts` — readiness logic.
- `apps/api/src/health/health.controller.test.ts` — HTTP health behavior with database success/failure.
- `apps/api/src/infrastructure/persistence/prisma/generated/` — generated client, gitignored.
- `apps/api/src/infrastructure/persistence/prisma/prisma.service.ts` — Prisma adapter and `ping()`.
- `apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts` — real PostgreSQL connectivity test.
- `apps/api/src/app.module.ts`, `src/main.ts` — application composition/bootstrap.

### Prisma / infra / tests / CI

- `prisma/schema.prisma` — empty product schema plus generated Prisma client configuration.
- `prisma/migrations/migration_lock.toml` — PostgreSQL migration provider lock.
- `prisma/migrations/20260816000100_foundation_baseline/migration.sql` — no-product baseline migration (`SELECT 1;`) proving deployment mechanics without product tables.
- `tests/architecture/eslint-boundaries.test.ts` — executable proof that forbidden domain imports are rejected.
- `tests/e2e/foundation.spec.ts` — browser → web → API → PostgreSQL readiness flow.
- `.github/workflows/ci.yml` — complete FOUNDATION CI.
- `docs/phases/FOUNDATION.md` — boundary execution record.
- `docs/evidence/foundation/FOUNDATION-EVIDENCE-001.md` — gate evidence.
- `docs/checkpoints/MDP-FOUNDATION-CHECKPOINT-001.md` — completion checkpoint created only after review/gate approval.
- `docs/STATE.md`, `docs/MDP-RESUME-CARD.md` — updated only when execution state actually changes.

---

### Task 1: Establish the root workspace and runtime baseline

**Files:**
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Modify later in this task: `package.json` via Corepack package-manager pin

**Interfaces:**
- Consumes: repository root with documentation only.
- Produces: pnpm workspace root; Node 24 runtime constraint; shared TypeScript baseline used by every later task.

- [ ] **Step 1: Verify the workspace does not yet exist**

Run:

```bash
 test ! -f package.json && test ! -f pnpm-workspace.yaml
```

Expected: exit code `0`.

- [ ] **Step 2: Create the root runtime/workspace files**

Create `.nvmrc`:

```text
24
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Create initial `package.json`:

```json
{
  "name": "memoria-digital-pessoal",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24 <25"
  },
  "scripts": {
    "typecheck": "pnpm -r --if-present typecheck",
    "build": "pnpm -r --if-present build",
    "test": "vitest run",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier . --write",
    "format:check": "prettier . --check"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
playwright-report/
test-results/
apps/api/src/infrastructure/persistence/prisma/generated/
.DS_Store
```

- [ ] **Step 3: Enable Corepack and pin pnpm 10**

Run:

```bash
corepack enable
corepack use pnpm@latest-10
```

Expected: `package.json` now contains an exact `packageManager: "pnpm@10.x.x"` value.

- [ ] **Step 4: Install the first root development dependencies**

Run:

```bash
pnpm add -Dw typescript vitest prettier eslint @eslint/js typescript-eslint
```

Expected: `pnpm-lock.yaml` is created.

- [ ] **Step 5: Validate runtime and root manifest**

Run:

```bash
node --version
pnpm --version
node -e "const p=require('./package.json'); if(!p.private || p.type!=='module' || !p.packageManager?.startsWith('pnpm@10.')) process.exit(1)"
```

Expected: Node reports `v24.*`, pnpm reports `10.*`, final command exits `0`.

- [ ] **Step 6: Commit the root workspace baseline**

```bash
git add .nvmrc .gitignore package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json
git commit -m "build: establish pnpm workspace baseline"
```

---

### Task 2: Create neutral internal packages and the UUID v7 primitive

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/id.ts`
- Test: `packages/shared/src/id.test.ts`

**Interfaces:**
- Consumes: root workspace and `tsconfig.base.json`.
- Produces: public packages `@mdp/domain`, `@mdp/contracts`, `@mdp/shared`; `createId(): string`; `isUuidV7(value: string): boolean`.

- [ ] **Step 1: Create package manifests/configs with public entry points**

Use this manifest pattern for `packages/domain/package.json`:

```json
{
  "name": "@mdp/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  }
}
```

Use the same file for `@mdp/contracts`, changing only `name`. For `@mdp/shared`, also add dependency `"uuid": "^13.0.0"` only if the resolved current package is major 13; otherwise use the exact current major installed by `pnpm add uuid --filter @mdp/shared` and let the lockfile pin it.

Create this `tsconfig.json` in all three packages:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": [],
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

Create neutral entry points for domain/contracts:

```ts
export {};
```

- [ ] **Step 2: Write the failing UUID v7 test**

Create `packages/shared/src/id.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createId, isUuidV7 } from './id.js';

describe('global id policy', () => {
  it('creates RFC UUID version 7 identifiers', () => {
    const id = createId();

    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('rejects non-v7 UUID strings', () => {
    expect(isUuidV7('not-a-uuid')).toBe(false);
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});
```

Create `packages/shared/src/index.ts` before running the test:

```ts
export { createId, isUuidV7 } from './id.js';
```

- [ ] **Step 3: Run the shared-package test and verify failure**

Run:

```bash
pnpm --filter @mdp/shared test -- id.test.ts
```

Expected: FAIL because `src/id.ts` does not exist.

- [ ] **Step 4: Install and implement UUID v7**

Run:

```bash
pnpm add uuid --filter @mdp/shared
```

Create `packages/shared/src/id.ts`:

```ts
import { validate, v7, version } from 'uuid';

export function createId(): string {
  return v7();
}

export function isUuidV7(value: string): boolean {
  return validate(value) && version(value) === 7;
}
```

- [ ] **Step 5: Run package tests/typechecks**

```bash
pnpm --filter @mdp/shared test
pnpm -r --filter './packages/*' typecheck
```

Expected: PASS.

- [ ] **Step 6: Verify package-name resolution rather than deep imports**

Run:

```bash
pnpm install
pnpm --filter @mdp/shared exec node -e "import('@mdp/shared').then(m=>{if(!m.createId) process.exit(1)})"
```

Expected: exit code `0`.

- [ ] **Step 7: Commit internal package boundaries**

```bash
git add packages package.json pnpm-lock.yaml
git commit -m "build: add neutral workspace packages"
```

---

### Task 3: Build the minimal accessible React/Vite web shell with typed config

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.app.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/config/env.ts`
- Test: `apps/web/src/config/env.test.ts`
- Create: `apps/web/src/lib/api-health.ts`
- Create: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/index.css`

**Interfaces:**
- Consumes: `@mdp/shared` workspace package; `VITE_API_BASE_URL`.
- Produces: `parseWebEnv(source): WebEnv`; `getApiReadiness(baseUrl): Promise<'ready' | 'unavailable'>`; accessible FOUNDATION status page.

- [ ] **Step 1: Create web package and install dependencies**

Create `apps/web/package.json`:

```json
{
  "name": "@mdp/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -p tsconfig.app.json && vite build",
    "typecheck": "tsc --noEmit -p tsconfig.app.json",
    "test": "vitest run --project web"
  },
  "dependencies": {
    "@mdp/shared": "workspace:*"
  }
}
```

Run:

```bash
pnpm add react react-dom zod --filter @mdp/web
pnpm add -D vite @vitejs/plugin-react @types/react @types/react-dom jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event --filter @mdp/web
```

Create `apps/web/tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

Create `apps/web/tsconfig.app.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 2: Write failing web config tests**

Create `apps/web/src/config/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env.js';

describe('parseWebEnv', () => {
  it('accepts an HTTP API base URL', () => {
    expect(parseWebEnv({ VITE_API_BASE_URL: 'http://127.0.0.1:3000' })).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3000',
    });
  });

  it('rejects missing API base URL', () => {
    expect(() => parseWebEnv({})).toThrow();
  });
});
```

Run:

```bash
pnpm --filter @mdp/web test -- env.test.ts
```

Expected: FAIL because `env.ts` does not exist.

- [ ] **Step 3: Implement typed web environment parsing**

Create `apps/web/src/config/env.ts`:

```ts
import { z } from 'zod';

const webEnvSchema = z.object({
  VITE_API_BASE_URL: z.url(),
});

export interface WebEnv {
  apiBaseUrl: string;
}

export function parseWebEnv(source: Record<string, unknown>): WebEnv {
  const parsed = webEnvSchema.parse(source);
  return { apiBaseUrl: parsed.VITE_API_BASE_URL };
}

export function getWebEnv(): WebEnv {
  return parseWebEnv(import.meta.env);
}
```

Run the config test again; expected PASS.

- [ ] **Step 4: Write failing React behavior test**

Create `apps/web/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

vi.mock('./lib/api-health.js', () => ({
  getApiReadiness: vi.fn().mockResolvedValue('ready'),
}));

describe('App', () => {
  it('shows the FOUNDATION status using accessible text', async () => {
    render(<App apiBaseUrl="http://127.0.0.1:3000" />);

    expect(screen.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeInTheDocument();
    expect(await screen.findByText('API pronta')).toBeInTheDocument();
  });
});
```

Expected initial result: FAIL because `App.tsx` does not exist.

- [ ] **Step 5: Implement API readiness client and minimal UI**

Create `apps/web/src/lib/api-health.ts`:

```ts
export async function getApiReadiness(baseUrl: string): Promise<'ready' | 'unavailable'> {
  try {
    const response = await fetch(`${baseUrl}/health/ready`);
    return response.ok ? 'ready' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
```

Create `apps/web/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getApiReadiness } from './lib/api-health.js';

export interface AppProps {
  apiBaseUrl: string;
}

export function App({ apiBaseUrl }: AppProps) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');

  useEffect(() => {
    void getApiReadiness(apiBaseUrl).then(setStatus);
  }, [apiBaseUrl]);

  const statusText =
    status === 'checking' ? 'Verificando API…' : status === 'ready' ? 'API pronta' : 'API indisponível';

  return (
    <main>
      <h1>Memória Digital Pessoal</h1>
      <p>FOUNDATION técnica</p>
      <p role="status" aria-live="polite">{statusText}</p>
    </main>
  );
}
```

Create `apps/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Create `apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { getWebEnv } from './config/env.js';
import './index.css';

const env = getWebEnv();
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App apiBaseUrl={env.apiBaseUrl} />
  </StrictMode>,
);
```

Create minimal `index.html` and `src/index.css`; CSS must preserve readable defaults and must not hide focus outlines.

- [ ] **Step 6: Add Vite/Vitest configuration for the web project**

Create `apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

- [ ] **Step 7: Verify web tests/typecheck/build**

```bash
pnpm --filter @mdp/web test
pnpm --filter @mdp/web typecheck
VITE_API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @mdp/web build
```

Expected: PASS.

- [ ] **Step 8: Commit the web shell**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): add typed foundation shell"
```

---

### Task 4: Build the NestJS API shell, fail-fast config, request IDs, safe errors, and liveness

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/src/config/env.ts`
- Test: `apps/api/src/config/env.test.ts`
- Create: `apps/api/src/config/env.module.ts`
- Create: `apps/api/src/common/http/express.d.ts`
- Create: `apps/api/src/common/http/request-id.middleware.ts`
- Create: `apps/api/src/common/http/api-error.ts`
- Create: `apps/api/src/common/http/api-error.filter.ts`
- Test: `apps/api/src/common/http/api-error.filter.test.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.service.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/main.ts`

**Interfaces:**
- Consumes: `@mdp/shared.createId()`, `PORT`, `DATABASE_URL`, `WEB_ORIGIN`.
- Produces: `parseApiEnv(source): ApiEnv`; request correlation header `x-request-id`; stable error envelope; `GET /health/live`.

- [ ] **Step 1: Create API package and install Nest/config/test dependencies**

Create `apps/api/package.json` with scripts:

```json
{
  "name": "@mdp/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run --project api"
  },
  "dependencies": {
    "@mdp/shared": "workspace:*"
  }
}
```

Run:

```bash
pnpm add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs zod --filter @mdp/api
pnpm add -D @nestjs/cli @nestjs/testing @types/express @types/node @types/supertest supertest --filter @mdp/api
```

Create `apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2023"],
    "types": ["node"],
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `tsconfig.build.json` excluding tests, and `nest-cli.json` with `sourceRoot: "src"` and `compilerOptions.tsConfigPath: "tsconfig.build.json"`.

- [ ] **Step 2: Write failing API environment tests**

Create `apps/api/src/config/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env.js';

const valid = {
  PORT: '3000',
  DATABASE_URL: 'postgresql://mdp:mdp@127.0.0.1:5432/mdp',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
};

describe('parseApiEnv', () => {
  it('returns typed configuration', () => {
    expect(parseApiEnv(valid)).toEqual({
      port: 3000,
      databaseUrl: valid.DATABASE_URL,
      webOrigin: valid.WEB_ORIGIN,
    });
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => parseApiEnv({ PORT: '3000', WEB_ORIGIN: valid.WEB_ORIGIN })).toThrow();
  });
});
```

Expected first run: FAIL because `env.ts` does not exist.

- [ ] **Step 3: Implement Zod configuration and single process-env access boundary**

Create `apps/api/src/config/env.ts`:

```ts
import { z } from 'zod';

const apiEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://')),
  WEB_ORIGIN: z.url(),
});

export interface ApiEnv {
  port: number;
  databaseUrl: string;
  webOrigin: string;
}

export function parseApiEnv(source: Record<string, unknown>): ApiEnv {
  const parsed = apiEnvSchema.parse(source);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    webOrigin: parsed.WEB_ORIGIN,
  };
}
```

Create `apps/api/src/config/env.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { parseApiEnv } from './env.js';

export const API_ENV = Symbol('API_ENV');

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: () => parseApiEnv(process.env) }],
  exports: [API_ENV],
})
export class EnvModule {}
```

Run the env tests; expected PASS.

- [ ] **Step 4: Write failing safe-error filter tests**

Create a unit test that constructs a mocked `ArgumentsHost`, supplies an error containing `password=secret`, and verifies the serialized body is exactly safe:

```ts
expect(body).toEqual({
  error: {
    code: 'INTERNAL_ERROR',
    message: 'Ocorreu um erro interno.',
    requestId: 'request-123',
  },
});
expect(JSON.stringify(body)).not.toContain('password=secret');
```

Expected: FAIL before the filter exists.

- [ ] **Step 5: Implement request ID and error contract**

Create `api-error.ts`:

```ts
export type ApiErrorCode = 'VALIDATION_FAILED' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'SERVICE_UNAVAILABLE';

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    fields?: Record<string, string[]>;
  };
}
```

Create Express augmentation so `Request` has `requestId: string`.

Create `request-id.middleware.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';
import { createId } from '@mdp/shared';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header('x-request-id');
  req.requestId = supplied && supplied.length <= 128 ? supplied : createId();
  res.setHeader('x-request-id', req.requestId);
  next();
}
```

Create an `@Catch()` filter that maps `HttpException` safely, maps status 503 to `SERVICE_UNAVAILABLE`, otherwise returns `INTERNAL_ERROR`, always using `request.requestId` and never serializing the original exception object.

- [ ] **Step 6: Implement liveness controller and application bootstrap**

Before database integration, create `HealthService.isReady()` returning `false` or throwing a clear `Database not configured` sentinel; Task 5 replaces it with Prisma-backed readiness. `/health/live` must already be complete and return:

```json
{ "status": "live" }
```

Create `main.ts` so bootstrap:

1. obtains typed `ApiEnv` from DI;
2. installs `requestIdMiddleware`;
3. installs the global safe error filter;
4. enables CORS only for `env.webOrigin`;
5. listens on `env.port`.

Do not access `process.env` from any other application module.

- [ ] **Step 7: Run API tests/typecheck/build**

```bash
pnpm --filter @mdp/api test
pnpm --filter @mdp/api typecheck
pnpm --filter @mdp/api build
```

Expected: PASS. The readiness success case is deferred to Task 5, but liveness must be complete.

- [ ] **Step 8: Commit API shell and safe HTTP contracts**

```bash
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat(api): add safe foundation http shell"
```

---

### Task 5: Add PostgreSQL Compose, Prisma 7 infrastructure, migration baseline, and readiness

**Files:**
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `prisma.config.ts`
- Create: `prisma/schema.prisma`
- Create: `prisma/migrations/migration_lock.toml`
- Create: `prisma/migrations/20260816000100_foundation_baseline/migration.sql`
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma.service.ts`
- Test: `apps/api/src/infrastructure/persistence/prisma/prisma.service.integration.test.ts`
- Modify: `apps/api/src/health/health.service.ts`
- Test: `apps/api/src/health/health.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ApiEnv.databaseUrl` and root Prisma schema.
- Produces: `PrismaService.ping(): Promise<void>`; `/health/ready` = 200 only when PostgreSQL answers.

- [ ] **Step 1: Create safe local PostgreSQL Compose configuration**

Create `.env.example`:

```dotenv
PORT=3000
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp
WEB_ORIGIN=http://127.0.0.1:5173
VITE_API_BASE_URL=http://127.0.0.1:3000
```

Create `compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: mdp
      POSTGRES_USER: mdp
      POSTGRES_PASSWORD: mdp_local_only
    ports:
      - '127.0.0.1:5432:5432'
    volumes:
      - mdp_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U mdp -d mdp']
      interval: 2s
      timeout: 3s
      retries: 20

volumes:
  mdp_postgres_data:
```

The password is explicitly local-only and appears only in `.env.example`/Compose development configuration, never as a real credential.

- [ ] **Step 2: Install Prisma 7 PostgreSQL dependencies**

Run:

```bash
pnpm add -Dw prisma dotenv
pnpm add @prisma/client @prisma/adapter-pg pg --filter @mdp/api
pnpm add -D @types/pg --filter @mdp/api
```

- [ ] **Step 3: Configure Prisma 7 ESM generation**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../apps/api/src/infrastructure/persistence/prisma/generated"
  runtime      = "nodejs"
  moduleFormat = "esm"
}

datasource db {
  provider = "postgresql"
}
```

Create `prisma.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

Create `prisma/migrations/migration_lock.toml`:

```toml
provider = "postgresql"
```

Create `prisma/migrations/20260816000100_foundation_baseline/migration.sql`:

```sql
-- FOUNDATION baseline: proves Prisma migration deployment without creating product tables.
SELECT 1;
```

Add root scripts:

```json
{
  "prisma:validate": "prisma validate",
  "prisma:generate": "prisma generate",
  "db:migrate": "prisma migrate deploy"
}
```

- [ ] **Step 4: Start PostgreSQL and prove container health**

```bash
cp .env.example .env
docker compose up -d postgres
docker compose ps postgres
```

Expected: PostgreSQL reaches `healthy`.

- [ ] **Step 5: Validate/generate/apply baseline migration**

```bash
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
```

Expected: schema valid; client generated; migration recorded in `_prisma_migrations`; no product table is created.

- [ ] **Step 6: Write failing Prisma connectivity integration test**

Create `prisma.service.integration.test.ts` with this core assertion:

```ts
import { describe, expect, it } from 'vitest';
import { PrismaService } from './prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration test');

describe('PrismaService integration', () => {
  it('pings PostgreSQL', async () => {
    const service = new PrismaService({ databaseUrl });
    await expect(service.ping()).resolves.toBeUndefined();
    await service.close();
  });
});
```

Expected initial result: FAIL because `PrismaService` does not exist.

- [ ] **Step 7: Implement PrismaService behind API infrastructure**

Implement `PrismaService` as a composition wrapper around generated `PrismaClient` and `PrismaPg`, with constructor input:

```ts
export interface PrismaServiceOptions {
  databaseUrl: string;
}
```

Required public methods:

```ts
ping(): Promise<void>
close(): Promise<void>
```

`ping()` executes `SELECT 1` using Prisma raw query functionality. No generated Prisma type is exported from the file.

Run the integration test; expected PASS.

- [ ] **Step 8: Write readiness HTTP tests before wiring Prisma**

Create `health.controller.test.ts` using Nest Testing + Supertest with a mocked `PrismaService` provider.

Required assertions:

```ts
// database healthy
expect((await request(app.getHttpServer()).get('/health/live')).status).toBe(200);
expect((await request(app.getHttpServer()).get('/health/ready')).status).toBe(200);

// database fails
prisma.ping.mockRejectedValueOnce(new Error('db down'));
expect((await request(app.getHttpServer()).get('/health/live')).status).toBe(200);
expect((await request(app.getHttpServer()).get('/health/ready')).status).toBe(503);
```

Expected before wiring: readiness tests FAIL.

- [ ] **Step 9: Wire Prisma readiness**

`HealthService` depends on `PrismaService` and implements:

```ts
async readiness(): Promise<{ status: 'ready' }> {
  try {
    await this.prisma.ping();
    return { status: 'ready' };
  } catch {
    throw new ServiceUnavailableException('Database unavailable');
  }
}
```

`HealthController` routes:

```text
GET /health/live  -> { status: 'live' }
GET /health/ready -> HealthService.readiness()
```

Register Prisma as an infrastructure provider using `API_ENV.databaseUrl`. Do not expose Prisma through `@mdp/domain`, `@mdp/contracts`, or `@mdp/shared`.

- [ ] **Step 10: Verify healthy and unhealthy readiness manually**

With API running:

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
docker compose stop postgres
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
docker compose start postgres
```

Expected sequence: `200`, `200`, `200`, `503`.

- [ ] **Step 11: Commit database/readiness infrastructure**

```bash
git add compose.yaml .env.example prisma.config.ts prisma apps/api package.json pnpm-lock.yaml
git commit -m "feat(api): add postgres prisma readiness"
```

---

### Task 6: Enforce lint, formatting, TypeScript projects, and architectural boundaries

**Files:**
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `vitest.config.ts`
- Test: `tests/architecture/eslint-boundaries.test.ts`
- Modify: root `package.json`

**Interfaces:**
- Consumes: all source paths created by Tasks 1–5.
- Produces: repository-level `lint`, `format:check`, `typecheck`, `test`; executable forbidden-import proof.

- [ ] **Step 1: Write the failing architectural lint test**

Create `tests/architecture/eslint-boundaries.test.ts` using ESLint's Node API:

```ts
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('architecture lint boundaries', () => {
  it('rejects Prisma imports from domain', async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText("import { PrismaClient } from '@prisma/client';\nexport {};", {
      filePath: 'packages/domain/src/forbidden.ts',
    });

    expect(result?.messages.some((message) => message.ruleId === 'no-restricted-imports')).toBe(true);
  });
});
```

Expected: FAIL until ESLint config defines the restriction.

- [ ] **Step 2: Implement ESLint flat config**

Create `eslint.config.mjs` using `@eslint/js` and `typescript-eslint`. Add separate rule objects for `packages/domain/**/*.ts` and `packages/contracts/**/*.ts` with `no-restricted-imports` forbidding at minimum:

```text
@nestjs/*
@prisma/*
react
react-dom
pg
redis
ioredis
bullmq
```

Also forbid patterns reaching `apps/*` and deep workspace imports matching `../../apps/*` or `packages/*/src/*` where applicable.

Use recommended TypeScript rules first; do not add stylistic lint rules that duplicate Prettier.

- [ ] **Step 3: Configure Prettier**

Create `.prettierrc.json`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true,
  "printWidth": 100
}
```

Create `.prettierignore`:

```text
node_modules
dist
coverage
playwright-report
test-results
apps/api/src/infrastructure/persistence/prisma/generated
```

- [ ] **Step 4: Configure root Vitest projects**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/web/vite.config.ts',
      {
        test: {
          name: 'api',
          environment: 'node',
          include: ['apps/api/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'architecture',
          environment: 'node',
          include: ['tests/architecture/**/*.test.ts'],
        },
      },
    ],
  },
});
```

- [ ] **Step 5: Run the architectural lint test and full quality commands**

```bash
pnpm test -- --project architecture
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Expected: all PASS.

- [ ] **Step 6: Commit repository quality gates**

```bash
git add eslint.config.mjs .prettierrc.json .prettierignore vitest.config.ts tests package.json pnpm-lock.yaml
git commit -m "test: enforce foundation quality boundaries"
```

---

### Task 7: Add critical Playwright browser E2E

**Files:**
- Create: `playwright.config.ts`
- Test: `tests/e2e/foundation.spec.ts`
- Modify: root `package.json`

**Interfaces:**
- Consumes: PostgreSQL on `127.0.0.1:5432`, API on `127.0.0.1:3000`, web on `127.0.0.1:5173`.
- Produces: `pnpm e2e` proving browser → web → API → PostgreSQL readiness.

- [ ] **Step 1: Install Playwright and process orchestration helper**

```bash
pnpm add -Dw @playwright/test concurrently
pnpm exec playwright install chromium
```

- [ ] **Step 2: Add deterministic root development/E2E scripts**

Add:

```json
{
  "dev:web": "pnpm --filter @mdp/web dev",
  "dev:api": "pnpm --filter @mdp/api dev",
  "dev:e2e": "concurrently -k -s first -n api,web \"pnpm dev:api\" \"pnpm dev:web\"",
  "e2e": "playwright test"
}
```

- [ ] **Step 3: Write failing browser E2E**

Create `tests/e2e/foundation.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('web loads and observes API/PostgreSQL readiness', async ({ page, request }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API pronta');

  const ready = await request.get('http://127.0.0.1:3000/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
});
```

Expected before config/server orchestration: FAIL.

- [ ] **Step 4: Configure Playwright for Chromium only**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev:e2e',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: '3000',
      DATABASE_URL: 'postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      VITE_API_BASE_URL: 'http://127.0.0.1:3000'
    }
  }
});
```

- [ ] **Step 5: Run full E2E with a clean database dependency**

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm db:migrate
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm e2e
```

Expected: Chromium E2E PASS.

- [ ] **Step 6: Commit E2E proof**

```bash
git add playwright.config.ts tests/e2e package.json pnpm-lock.yaml
git commit -m "test: add foundation browser e2e"
```

---

### Task 8: Add reproducible GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify if necessary: root scripts only to make CI commands explicit and local-reproducible.

**Interfaces:**
- Consumes: all repository checks from Tasks 1–7.
- Produces: one required CI workflow that fails on install/type/lint/format/test/build/migration/E2E failures.

- [ ] **Step 1: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  foundation:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      PORT: '3000'
      DATABASE_URL: postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp
      WEB_ORIGIN: http://127.0.0.1:5173
      VITE_API_BASE_URL: http://127.0.0.1:3000

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Enable Corepack
        run: corepack enable

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Start PostgreSQL
        run: docker compose up -d postgres

      - name: Wait for PostgreSQL health
        run: |
          for i in {1..30}; do
            if [ "$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q postgres)")" = "healthy" ]; then
              exit 0
            fi
            sleep 2
          done
          docker compose logs postgres
          exit 1

      - name: Validate Prisma schema
        run: pnpm prisma:validate

      - name: Generate Prisma client
        run: pnpm prisma:generate

      - name: Apply migrations
        run: pnpm db:migrate

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Format check
        run: pnpm format:check

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Install Chromium
        run: pnpm exec playwright install --with-deps chromium

      - name: E2E
        run: pnpm e2e

      - name: Stop services
        if: always()
        run: docker compose down
```

- [ ] **Step 2: Reproduce the CI command sequence locally**

Run exactly, in order:

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm e2e
```

Expected: all PASS.

- [ ] **Step 3: Commit CI**

```bash
git add .github/workflows/ci.yml package.json pnpm-lock.yaml
git commit -m "ci: add foundation verification workflow"
```

---

### Task 9: Record execution evidence, open review, and run the Foundation Readiness Gate

**Files:**
- Create: `docs/phases/FOUNDATION.md`
- Create: `docs/evidence/foundation/FOUNDATION-EVIDENCE-001.md`
- Modify: `docs/STATE.md`
- Modify: `docs/MDP-RESUME-CARD.md`
- Create only after gate approval: `docs/checkpoints/MDP-FOUNDATION-CHECKPOINT-001.md`

**Interfaces:**
- Consumes: exact commit SHA, CI run/check results, local verification outputs, PR/review result.
- Produces: auditable Foundation gate packet; no automatic merge.

- [ ] **Step 1: Run the complete gate from a clean repository state**

```bash
git status --short
pnpm install --frozen-lockfile
docker compose down -v
docker compose up -d postgres
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm e2e
```

Expected:

- initial `git status --short` has no unexpected tracked modifications;
- PostgreSQL becomes healthy;
- every command exits `0`;
- Playwright FOUNDATION E2E passes.

- [ ] **Step 2: Prove the database-failure invariant separately**

Run API, then:

```bash
curl -sS -o /tmp/live-healthy.json -w '%{http_code}' http://127.0.0.1:3000/health/live
a=$(curl -sS -o /tmp/ready-healthy.json -w '%{http_code}' http://127.0.0.1:3000/health/ready)
docker compose stop postgres
b=$(curl -sS -o /tmp/live-db-down.json -w '%{http_code}' http://127.0.0.1:3000/health/live)
c=$(curl -sS -o /tmp/ready-db-down.json -w '%{http_code}' http://127.0.0.1:3000/health/ready)
printf '%s %s %s\n' "$a" "$b" "$c"
docker compose start postgres
```

Expected printed values: `200 200 503` (plus the first live curl itself returning `200`). Store the response bodies in evidence without secrets.

- [ ] **Step 3: Create the evidence record with no placeholders**

`docs/evidence/foundation/FOUNDATION-EVIDENCE-001.md` must record actual values for:

```text
branch
HEAD SHA
Node version
pnpm version
PostgreSQL image
Docker health result
Prisma validation result
migration result
typecheck result
lint result
format result
Vitest result
web build result
API build result
Playwright result
healthy live response
healthy ready response
database-down live response
database-down ready response
architecture-boundary test result
CI run/check reference
PR number
review result
residual findings
```

If a value is unavailable, the gate is not complete; do not write `TBD` or mark PASS.

- [ ] **Step 4: Create/update the phase record while keeping status truthful**

`docs/phases/FOUNDATION.md` must state `IN_REVIEW` until the PR, CI, evidence and review all pass. Update `docs/STATE.md` and `docs/MDP-RESUME-CARD.md` to show:

```text
BOOT-01: COMPLETE
FOUNDATION: IN_REVIEW
Slice 01: NOT STARTED / NOT AUTHORIZED
Real data: NOT AUTHORIZED
```

Commit:

```bash
git add docs
git commit -m "docs: record foundation verification evidence"
```

- [ ] **Step 5: Open a pull request without auto-merge**

PR title:

```text
FOUNDATION: repository and product bootstrap
```

PR body must link:

- approved design spec;
- implementation plan;
- `FOUNDATION-EVIDENCE-001.md`;
- exact Foundation Readiness criteria;
- explicit statement: `Slice 01 is not part of this PR`.

Do not enable auto-merge.

- [ ] **Step 6: Verify GitHub CI and perform review**

Required before gate recommendation:

```text
CI = PASS
review findings = resolved or explicitly classified
unexpected scope = none
memory product entities/flows = absent
real sensitive data = absent
```

If CI or review fails, fix on the same branch, rerun the relevant task tests, rerun the complete gate, and update evidence with the new HEAD SHA.

- [ ] **Step 7: Present the Foundation Readiness Gate to LEANDRO**

Present only one of:

```text
READY
READY_WITH_RESTRICTIONS
BLOCKED
```

Include the exact PR, HEAD SHA, CI result, evidence file, residual findings, and confirmation that Slice 01 remains unauthorized.

Do not merge until LEANDRO explicitly approves the FOUNDATION gate.

- [ ] **Step 8: After explicit gate approval, record the checkpoint and merge**

Create `docs/checkpoints/MDP-FOUNDATION-CHECKPOINT-001.md` with actual:

- approved gate classification;
- PR number;
- reviewed HEAD SHA;
- CI result;
- merge commit SHA after merge;
- evidence path;
- statement `Slice 01 remains NOT STARTED / NOT AUTHORIZED unless separately authorized`.

Update canonical state to:

```text
FOUNDATION: COMPLETE
Slice 01: NOT STARTED / NOT AUTHORIZED
Product memory implementation: NOT STARTED
Real data: NOT AUTHORIZED
```

The checkpoint commit/merge must be verified by reading `docs/STATE.md` and the checkpoint back from `main`.

---

## Plan self-review checklist

Before execution begins, the plan author verified:

- Spec coverage: every FOUNDATION design section maps to Tasks 1–9.
- Scope: no Memory/Evidence/Fact/Ledger product behavior is planned.
- Database baseline: migration mechanics are proved with a no-product SQL baseline rather than inventing an application table.
- Prisma 7: generated client output is explicit, ESM, and confined to API infrastructure.
- Configuration: only the API environment provider and Prisma CLI config access raw environment sources; application modules consume typed configuration.
- Error safety: internal exception text is explicitly tested not to leak.
- Health invariant: live remains 200 while readiness becomes 503 with PostgreSQL down.
- ID consistency: `createId()` uses UUID v7 and is cross-runtime-safe for future browser/API use.
- Testing: Vitest projects, RTL behavior, architecture lint proof, real DB integration, and Playwright E2E are all represented.
- CI: exact local commands correspond to the GitHub Actions workflow.
- Evidence: completion cannot be claimed with missing actual values.
- Merge safety: no auto-merge; explicit LEANDRO gate remains required.
- Placeholder scan: no implementation step relies on `TBD`, `TODO`, “implement later”, or unspecified error handling.

## Primary implementation references

- Node.js release status: https://nodejs.org/en/about/previous-releases
- pnpm workspaces: https://pnpm.io/workspaces
- NestJS first steps/configuration: https://docs.nestjs.com/first-steps and https://docs.nestjs.com/techniques/configuration
- Prisma client generation: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client
- Prisma generator reference: https://www.prisma.io/docs/orm/prisma-schema/overview/generators
- Vitest projects: https://vitest.dev/guide/projects.html
- Playwright installation/runtime requirements: https://playwright.dev/docs/intro
- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- typescript-eslint: https://typescript-eslint.io/getting-started/
- Zod schema parsing: https://zod.dev/basics
- UUID v7 API: https://github.com/uuidjs/uuid
