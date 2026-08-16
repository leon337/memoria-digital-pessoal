# FOUNDATION Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimum reproducible web/API monorepo foundation required for Slice 01, with strict architectural boundaries, PostgreSQL/Prisma connectivity, tests, E2E, CI, and evidence-based readiness, without implementing the memory product flow.

**Architecture:** A pnpm Workspace contains `apps/web`, `apps/api`, and framework-neutral packages `@mdp/domain`, `@mdp/contracts`, and `@mdp/shared`. Workspace packages are consumed by package name and emit small ESM `dist` artifacts for Node runtime use; they are never published to a registry. PostgreSQL runs in Docker Compose while web/API run on the host. Prisma lives only in API infrastructure, and quality gates enforce ESM, strict TypeScript, safe configuration, API health/error contracts, critical E2E, and repository evidence.

**Tech Stack:** Node.js 24 LTS, pnpm 10.x, TypeScript, React, Vite, NestJS, PostgreSQL 17, Prisma ORM 7, `@prisma/adapter-pg`, Zod, `uuid`, ESLint flat config, Prettier, Vitest, React Testing Library, `user-event`, Playwright, Docker Compose, GitHub Actions.

## Global Constraints

- Branch: `foundation/repository-bootstrap`.
- ESM throughout the monorepo; root package declares `"type": "module"`.
- pnpm Workspaces only; no Nx or Turborepo.
- Internal package names are exactly `@mdp/domain`, `@mdp/contracts`, and `@mdp/shared`.
- Internal dependencies use `workspace:*`; consumers import only package public APIs.
- Workspace package build output is local ESM `dist`; this is runtime compilation, not publication and not a registry workflow.
- `@mdp/domain` and `@mdp/contracts` remain framework-neutral and infrastructure-neutral.
- Prisma is restricted to `apps/api/src/infrastructure/persistence/prisma/` plus root Prisma schema/migrations.
- TypeScript baseline enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `forceConsistentCasingInFileNames`, and `isolatedModules`.
- ESLint owns code-quality/architectural checks; Prettier owns formatting.
- Vitest owns unit/integration/component tests; Playwright owns critical browser E2E.
- PostgreSQL is the only Docker Compose service in FOUNDATION.
- `/health/live` must not depend on PostgreSQL; `/health/ready` must return 503 when PostgreSQL is unavailable.
- UUID v7 is the global object-ID policy; product entities are not introduced in FOUNDATION.
- API errors expose stable `error.code`, safe `message`, and `requestId`; raw Prisma/PostgreSQL errors and stack traces are never returned.
- Real sensitive data remains prohibited.
- Do not add Redis, BullMQ, worker processes, pgvector, AI, embeddings, STT/TTS, object storage, offline sync, advanced auth, or production deployment automation.
- The FOUNDATION is not complete until the evidence-based readiness gate is recorded and explicitly approved.

## Resolved implementation baseline

- Use Node.js 24 because it is an LTS line at plan time; do not use Node 26 Current for this boundary.
- Run `corepack use pnpm@latest-10` during Task 1; Corepack writes the resolved exact pnpm 10 version into `packageManager`.
- Use Prisma ORM 7 `prisma-client` generator with explicit `output`, `runtime = "nodejs"`, and `moduleFormat = "esm"`.
- Use `@prisma/adapter-pg` for PostgreSQL runtime connectivity.
- Use the `uuid` package `v7()` API for UUID v7 generation.
- Use Zod for typed web/API environment parsing.
- Use ESLint flat config (`eslint.config.mjs`) and `typescript-eslint`.
- Use Vitest `test.projects`, not deprecated workspace configuration.
- Playwright FOUNDATION coverage targets Chromium only; extra engines are outside this boundary.

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
- `prisma.config.ts` — Prisma schema, migrations, datasource configuration.

### Packages

Each package has `package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/index.ts`, and local `dist/` output. `dist/` stays gitignored.

- `packages/domain/` — neutral domain boundary placeholder, no product entities.
- `packages/contracts/` — neutral contract boundary placeholder.
- `packages/shared/src/id.ts` — UUID v7 primitive.
- `packages/shared/src/id.test.ts` — UUID v7 behavior test.
- `packages/shared/vitest.config.ts` — shared package tests.

### Web

- `apps/web/package.json`, `tsconfig*.json`, `vite.config.ts`, `index.html` — Vite/React app shell.
- `apps/web/src/config/env.ts`, `env.test.ts` — typed Vite environment parsing.
- `apps/web/src/lib/api-health.ts` — API readiness client.
- `apps/web/src/App.tsx`, `App.test.tsx` — accessible FOUNDATION status UI/test.
- `apps/web/src/test/setup.ts`, `main.tsx`, `index.css` — app bootstrap.

### API

- `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json` — Nest shell.
- `apps/api/vitest.config.ts` — API unit tests.
- `apps/api/vitest.integration.config.ts` — API real-database integration tests.
- `apps/api/src/config/env.ts`, `env.test.ts`, `env.module.ts` — typed environment boundary.
- `apps/api/src/common/http/express.d.ts` — typed request augmentation.
- `apps/api/src/common/http/request-id.middleware.ts` — correlation ID.
- `apps/api/src/common/http/api-error.ts`, `api-error.filter.ts`, `api-error.filter.test.ts` — safe error contract.
- `apps/api/src/health/health.controller.ts`, `health.service.ts`, `health.controller.test.ts` — live/ready endpoints.
- `apps/api/src/infrastructure/persistence/prisma/generated/` — generated Prisma client, gitignored.
- `apps/api/src/infrastructure/persistence/prisma/prisma.service.ts`, integration test — PostgreSQL adapter.
- `apps/api/src/app.module.ts`, `main.ts` — composition/bootstrap.

### Prisma / tests / CI / docs

- `prisma/schema.prisma` — no product models; Prisma client generator only.
- `prisma/migrations/migration_lock.toml`.
- `prisma/migrations/20260816000100_foundation_baseline/migration.sql` — no-product baseline migration.
- `tests/architecture/eslint-boundaries.test.ts` — executable import-boundary proof.
- `tests/e2e/foundation.spec.ts` — browser → web → API → PostgreSQL readiness.
- `.github/workflows/ci.yml` — FOUNDATION CI.
- `docs/phases/FOUNDATION.md`, `docs/evidence/foundation/FOUNDATION-EVIDENCE-001.md`.
- `docs/checkpoints/MDP-FOUNDATION-CHECKPOINT-001.md` — only after gate approval.
- `docs/STATE.md`, `docs/MDP-RESUME-CARD.md` — truthful state transitions only.

---

### Task 1: Establish root workspace and runtime baseline

**Files:**
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

**Interfaces:**
- Consumes: documentation-only repository.
- Produces: Node 24 + pnpm workspace root and strict shared TypeScript baseline.

- [ ] **Step 1: Verify workspace files are absent**

```bash
test ! -f package.json && test ! -f pnpm-workspace.yaml
```

Expected: exit code `0`.

- [ ] **Step 2: Create runtime/workspace files**

`.nvmrc`:

```text
24
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

`package.json`:

```json
{
  "name": "memoria-digital-pessoal",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "build:packages": "pnpm -r --filter './packages/*' --if-present build",
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

`tsconfig.base.json`:

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

`.gitignore`:

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

```bash
corepack enable
corepack use pnpm@latest-10
```

Expected: `package.json` gains exact `packageManager: "pnpm@10.x.x"`.

- [ ] **Step 4: Install root quality/test dependencies**

```bash
pnpm add -Dw typescript vitest prettier eslint @eslint/js typescript-eslint globals
```

Expected: `pnpm-lock.yaml` exists.

- [ ] **Step 5: Validate runtime/manifest**

```bash
node --version
pnpm --version
node -e "const p=require('./package.json'); if(!p.private || p.type!=='module' || !p.packageManager?.startsWith('pnpm@10.')) process.exit(1)"
```

Expected: Node `v24.*`, pnpm `10.*`, final command exit `0`.

- [ ] **Step 6: Commit**

```bash
git add .nvmrc .gitignore package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json
git commit -m "build: establish pnpm workspace baseline"
```

---

### Task 2: Create neutral workspace packages and UUID v7 primitive

**Files:**
- Create: `packages/domain/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}`
- Create: `packages/contracts/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}`
- Create: `packages/shared/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts,src/id.ts,src/id.test.ts}`

**Interfaces:**
- Consumes: root workspace.
- Produces: runtime-importable ESM packages by name; `createId(): string`; `isUuidV7(value: string): boolean`.

- [ ] **Step 1: Create package manifests and TS configs**

Use this manifest for `@mdp/domain` and `@mdp/contracts`, changing only `name`:

```json
{
  "name": "@mdp/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "build": "tsc -p tsconfig.build.json"
  }
}
```

`tsconfig.json` for all three packages:

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

`tsconfig.build.json` for all three:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["src/**/*.test.ts"]
}
```

Create `src/index.ts` in domain/contracts:

```ts
export {};
```

Create `packages/shared/package.json` with the same `exports` and scripts plus:

```json
{
  "name": "@mdp/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run --config vitest.config.ts"
  }
}
```

- [ ] **Step 2: Create the failing UUID test and test config**

`packages/shared/vitest.config.ts`:

```ts
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
```

`packages/shared/src/id.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createId, isUuidV7 } from './id.js';

describe('global id policy', () => {
  it('creates UUID version 7', () => {
    const id = createId();
    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('rejects invalid/non-v7 identifiers', () => {
    expect(isUuidV7('not-a-uuid')).toBe(false);
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});
```

`packages/shared/src/index.ts`:

```ts
export { createId, isUuidV7 } from './id.js';
```

Run:

```bash
pnpm --filter @mdp/shared test
```

Expected: FAIL because `id.ts` is absent.

- [ ] **Step 3: Install and implement UUID v7**

```bash
pnpm add uuid --filter @mdp/shared
```

`packages/shared/src/id.ts`:

```ts
import { validate, v7, version } from 'uuid';

export function createId(): string {
  return v7();
}

export function isUuidV7(value: string): boolean {
  return validate(value) && version(value) === 7;
}
```

- [ ] **Step 4: Test/typecheck/build packages**

```bash
pnpm --filter @mdp/shared test
pnpm -r --filter './packages/*' typecheck
pnpm build:packages
pnpm --filter @mdp/shared exec node -e "import('@mdp/shared').then(m=>{if(!m.createId || m.createId()[14]!=='7') process.exit(1)})"
```

Expected: all PASS; the final Node command proves package-name runtime resolution through `dist`.

- [ ] **Step 5: Commit**

```bash
git add packages package.json pnpm-lock.yaml
git commit -m "build: add neutral workspace packages"
```

---

### Task 3: Build minimal accessible React/Vite shell with typed config

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`, `tsconfig.app.json`, `vite.config.ts`, `index.html`
- Create/Test: `apps/web/src/config/env.ts`, `env.test.ts`
- Create: `apps/web/src/lib/api-health.ts`
- Create/Test: `apps/web/src/App.tsx`, `App.test.tsx`
- Create: `apps/web/src/test/setup.ts`, `main.tsx`, `index.css`

**Interfaces:**
- Consumes: `VITE_API_BASE_URL`.
- Produces: `parseWebEnv(source): WebEnv`, `getApiReadiness(baseUrl)`, accessible status page.

- [ ] **Step 1: Create package/config and install dependencies**

`apps/web/package.json`:

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
    "test": "vitest run --config vite.config.ts"
  }
}
```

Install:

```bash
pnpm add react react-dom zod --filter @mdp/web
pnpm add -D vite @vitejs/plugin-react @types/react @types/react-dom jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event --filter @mdp/web
```

`apps/web/tsconfig.json`:

```json
{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }
```

`apps/web/tsconfig.app.json`:

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

- [ ] **Step 2: Write failing web-env tests**

`apps/web/src/config/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env.js';

describe('parseWebEnv', () => {
  it('accepts a valid API URL', () => {
    expect(parseWebEnv({ VITE_API_BASE_URL: 'http://127.0.0.1:3000' })).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3000'
    });
  });

  it('rejects missing API URL', () => {
    expect(() => parseWebEnv({})).toThrow();
  });
});
```

Expected first run: FAIL because `env.ts` is absent.

- [ ] **Step 3: Implement typed web env**

`apps/web/src/config/env.ts`:

```ts
import { z } from 'zod';

const schema = z.object({ VITE_API_BASE_URL: z.string().url() });

export interface WebEnv { apiBaseUrl: string }

export function parseWebEnv(source: Record<string, unknown>): WebEnv {
  const parsed = schema.parse(source);
  return { apiBaseUrl: parsed.VITE_API_BASE_URL };
}

export function getWebEnv(): WebEnv {
  return parseWebEnv(import.meta.env);
}
```

Run `pnpm --filter @mdp/web test`; env tests now PASS.

- [ ] **Step 4: Write failing UI behavior test**

`apps/web/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

vi.mock('./lib/api-health.js', () => ({ getApiReadiness: vi.fn().mockResolvedValue('ready') }));

describe('App', () => {
  it('shows accessible FOUNDATION readiness', async () => {
    render(<App apiBaseUrl="http://127.0.0.1:3000" />);
    expect(screen.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('API pronta');
  });
});
```

Expected: FAIL because App/readiness client do not exist.

- [ ] **Step 5: Implement readiness client/UI/bootstrap**

`apps/web/src/lib/api-health.ts`:

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

`apps/web/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getApiReadiness } from './lib/api-health.js';

export function App({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');

  useEffect(() => { void getApiReadiness(apiBaseUrl).then(setStatus); }, [apiBaseUrl]);

  const text = status === 'checking' ? 'Verificando API…' : status === 'ready' ? 'API pronta' : 'API indisponível';

  return (
    <main>
      <h1>Memória Digital Pessoal</h1>
      <p>FOUNDATION técnica</p>
      <p role="status" aria-live="polite">{text}</p>
    </main>
  );
}
```

`apps/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { getWebEnv } from './config/env.js';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
const env = getWebEnv();

createRoot(root).render(<StrictMode><App apiBaseUrl={env.apiBaseUrl} /></StrictMode>);
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Memória Digital Pessoal</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`apps/web/src/index.css`:

```css
:root { font-family: system-ui, sans-serif; line-height: 1.5; }
body { margin: 0; padding: 2rem; }
main { max-width: 48rem; margin: 0 auto; }
:focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }
```

- [ ] **Step 6: Configure Vite/Vitest**

`apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
});
```

- [ ] **Step 7: Verify and commit**

```bash
pnpm --filter @mdp/web test
pnpm --filter @mdp/web typecheck
VITE_API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @mdp/web build
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): add typed foundation shell"
```

Expected: all commands PASS.

---

### Task 4: Build NestJS API shell, typed config, request IDs, safe errors, and liveness

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`
- Create: `apps/api/vitest.config.ts`, `vitest.integration.config.ts`
- Create/Test: `src/config/env.ts`, `env.test.ts`, `env.module.ts`
- Create: `src/common/http/express.d.ts`, `request-id.middleware.ts`, `api-error.ts`
- Create/Test: `src/common/http/api-error.filter.ts`, `api-error.filter.test.ts`
- Create: `src/health/health.controller.ts`, `health.service.ts`
- Create: `src/app.module.ts`, `main.ts`

**Interfaces:**
- Consumes: `@mdp/shared.createId()`, `PORT`, `DATABASE_URL`, `WEB_ORIGIN`.
- Produces: typed env, `x-request-id`, safe error envelope, `GET /health/live`.

- [ ] **Step 1: Create API package/config and install dependencies**

`apps/api/package.json`:

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
    "test": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  },
  "dependencies": { "@mdp/shared": "workspace:*" }
}
```

Install:

```bash
pnpm add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs zod --filter @mdp/api
pnpm add -D @nestjs/cli @nestjs/testing @types/express @types/node @types/supertest supertest --filter @mdp/api
```

`apps/api/tsconfig.json`:

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

`apps/api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/**/*.integration.test.ts"]
}
```

`apps/api/nest-cli.json`:

```json
{ "sourceRoot": "src", "compilerOptions": { "tsConfigPath": "tsconfig.build.json" } }
```

`apps/api/vitest.config.ts`:

```ts
import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'api', environment: 'node', include: ['src/**/*.test.ts'], exclude: ['src/**/*.integration.test.ts'] } });
```

`apps/api/vitest.integration.config.ts`:

```ts
import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'api-integration', environment: 'node', include: ['src/**/*.integration.test.ts'] } });
```

- [ ] **Step 2: Write failing env tests**

`apps/api/src/config/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env.js';

const valid = { PORT: '3000', DATABASE_URL: 'postgresql://mdp:mdp@127.0.0.1:5432/mdp', WEB_ORIGIN: 'http://127.0.0.1:5173' };

describe('parseApiEnv', () => {
  it('returns typed config', () => {
    expect(parseApiEnv(valid)).toEqual({ port: 3000, databaseUrl: valid.DATABASE_URL, webOrigin: valid.WEB_ORIGIN });
  });

  it('fails without DATABASE_URL', () => {
    expect(() => parseApiEnv({ PORT: '3000', WEB_ORIGIN: valid.WEB_ORIGIN })).toThrow();
  });
});
```

Expected: FAIL because `env.ts` is absent.

- [ ] **Step 3: Implement typed env and global DI token**

`apps/api/src/config/env.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().refine(v => v.startsWith('postgresql://') || v.startsWith('postgres://'), 'DATABASE_URL must be PostgreSQL'),
  WEB_ORIGIN: z.string().url()
});

export interface ApiEnv { port: number; databaseUrl: string; webOrigin: string }

export function parseApiEnv(source: Record<string, unknown>): ApiEnv {
  const p = schema.parse(source);
  return { port: p.PORT, databaseUrl: p.DATABASE_URL, webOrigin: p.WEB_ORIGIN };
}
```

`apps/api/src/config/env.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { parseApiEnv } from './env.js';

export const API_ENV = Symbol('API_ENV');

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: () => parseApiEnv(process.env) }],
  exports: [API_ENV]
})
export class EnvModule {}
```

Run env tests; expected PASS.

- [ ] **Step 4: Write failing error-filter tests**

Test two cases using mocked `ArgumentsHost`: raw `Error('password=secret')` must produce status 500 + safe body; `ServiceUnavailableException` must produce status 503 + `SERVICE_UNAVAILABLE`. Use request `{ requestId: 'request-123' }` and capture `response.status().json()`.

Required assertions:

```ts
expect(internalBody).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.', requestId: 'request-123' } });
expect(JSON.stringify(internalBody)).not.toContain('password=secret');
expect(unavailableBody.error.code).toBe('SERVICE_UNAVAILABLE');
```

Expected: FAIL because filter does not exist.

- [ ] **Step 5: Implement request ID and exact safe error mapping**

`api-error.ts`:

```ts
export type ApiErrorCode = 'VALIDATION_FAILED' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'SERVICE_UNAVAILABLE';
export interface ApiErrorEnvelope { error: { code: ApiErrorCode; message: string; requestId: string; fields?: Record<string, string[]> } }
```

`express.d.ts`:

```ts
declare global { namespace Express { interface Request { requestId: string } } }
export {};
```

`request-id.middleware.ts`:

```ts
import { createId } from '@mdp/shared';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header('x-request-id');
  req.requestId = supplied && supplied.length <= 128 ? supplied : createId();
  res.setHeader('x-request-id', req.requestId);
  next();
}
```

`api-error.filter.ts`:

```ts
import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorCode, ApiErrorEnvelope } from './api-error.js';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    let status = 500;
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let message = 'Ocorreu um erro interno.';

    if (exception instanceof ServiceUnavailableException) {
      status = 503; code = 'SERVICE_UNAVAILABLE'; message = 'Serviço temporariamente indisponível.';
    } else if (exception instanceof BadRequestException) {
      status = 400; code = 'VALIDATION_FAILED'; message = 'Os dados enviados são inválidos.';
    } else if (exception instanceof NotFoundException) {
      status = 404; code = 'NOT_FOUND'; message = 'Recurso não encontrado.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = 'A solicitação não pôde ser processada.';
    }

    const body: ApiErrorEnvelope = { error: { code, message, requestId: request.requestId } };
    response.status(status).json(body);
  }
}
```

Run error tests; expected PASS.

- [ ] **Step 6: Implement liveness and bootstrap**

`health.controller.ts` at this task contains only:

```ts
import { Controller, Get } from '@nestjs/common';
@Controller('health')
export class HealthController {
  @Get('live') live(): { status: 'live' } { return { status: 'live' }; }
}
```

`health.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
@Injectable()
export class HealthService {}
```

`app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';

@Module({ imports: [EnvModule], controllers: [HealthController], providers: [HealthService] })
export class AppModule {}
```

`main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { API_ENV } from './config/env.module.js';
import type { ApiEnv } from './config/env.js';
import { ApiErrorFilter } from './common/http/api-error.filter.js';
import { requestIdMiddleware } from './common/http/request-id.middleware.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get<ApiEnv>(API_ENV);
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableCors({ origin: env.webOrigin });
  await app.listen(env.port, '127.0.0.1');
}
void bootstrap();
```

- [ ] **Step 7: Verify and commit**

```bash
pnpm build:packages
pnpm --filter @mdp/api test
pnpm --filter @mdp/api typecheck
pnpm --filter @mdp/api build
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat(api): add safe foundation http shell"
```

Expected: all PASS.

---

### Task 5: Add PostgreSQL Compose, Prisma 7, baseline migration, and readiness

**Files:**
- Create: `compose.yaml`, `.env.example`, `prisma.config.ts`, `prisma/schema.prisma`
- Create: `prisma/migrations/migration_lock.toml`, `20260816000100_foundation_baseline/migration.sql`
- Create/Test: `apps/api/src/infrastructure/persistence/prisma/prisma.service.ts`, integration test
- Modify/Test: `apps/api/src/health/health.service.ts`, `health.controller.ts`, `health.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`, root `package.json`

**Interfaces:**
- Produces: `PRISMA_SERVICE`; `PrismaService.ping(): Promise<void>`; `PrismaService.close(): Promise<void>`; `/health/ready`.

- [ ] **Step 1: Create local-only PostgreSQL configuration**

`.env.example`:

```dotenv
PORT=3000
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp
WEB_ORIGIN=http://127.0.0.1:5173
VITE_API_BASE_URL=http://127.0.0.1:3000
```

`compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: mdp
      POSTGRES_USER: mdp
      POSTGRES_PASSWORD: mdp_local_only
    ports: ['127.0.0.1:5432:5432']
    volumes: [mdp_postgres_data:/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U mdp -d mdp']
      interval: 2s
      timeout: 3s
      retries: 20
volumes:
  mdp_postgres_data:
```

- [ ] **Step 2: Install/configure Prisma 7**

```bash
pnpm add -Dw prisma dotenv
pnpm add @prisma/client @prisma/adapter-pg pg --filter @mdp/api
pnpm add -D @types/pg --filter @mdp/api
```

`prisma/schema.prisma`:

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../apps/api/src/infrastructure/persistence/prisma/generated"
  runtime      = "nodejs"
  moduleFormat = "esm"
}

datasource db { provider = "postgresql" }
```

`prisma.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: env('DATABASE_URL') } });
```

`migration_lock.toml`:

```toml
provider = "postgresql"
```

`migration.sql`:

```sql
-- FOUNDATION baseline: proves migration deployment without product tables.
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

- [ ] **Step 3: Start/validate database mechanics**

```bash
cp .env.example .env
docker compose up -d postgres
docker compose ps postgres
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
```

Expected: container `healthy`; validation/generation/migration PASS; no product table exists.

- [ ] **Step 4: Write failing Prisma integration test**

`prisma.service.integration.test.ts`:

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

Expected: FAIL before service exists.

- [ ] **Step 5: Implement exact Prisma adapter**

`prisma.service.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export const PRISMA_SERVICE = Symbol('PRISMA_SERVICE');
export interface PrismaServiceOptions { databaseUrl: string }

export class PrismaService {
  private readonly client: PrismaClient;

  constructor(options: PrismaServiceOptions) {
    const adapter = new PrismaPg({ connectionString: options.databaseUrl });
    this.client = new PrismaClient({ adapter });
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}
```

Run:

```bash
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm --filter @mdp/api test:integration
```

Expected: PASS.

- [ ] **Step 6: Write failing HTTP health tests**

Create a Nest testing module with `HealthController`, `HealthService`, mocked `PRISMA_SERVICE`, request middleware and global `ApiErrorFilter`. Assert:

```ts
expect((await request(server).get('/health/live')).status).toBe(200);
expect((await request(server).get('/health/ready')).status).toBe(200);
prisma.ping.mockRejectedValueOnce(new Error('db down'));
expect((await request(server).get('/health/live')).status).toBe(200);
const failed = await request(server).get('/health/ready');
expect(failed.status).toBe(503);
expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
```

Expected before wiring: FAIL.

- [ ] **Step 7: Wire readiness and Prisma provider exactly**

`health.service.ts`:

```ts
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PRISMA_SERVICE, type PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async readiness(): Promise<{ status: 'ready' }> {
    try { await this.prisma.ping(); return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException(); }
  }
}
```

Add to `health.controller.ts`:

```ts
constructor(private readonly health: HealthService) {}
@Get('ready') ready(): Promise<{ status: 'ready' }> { return this.health.readiness(); }
```

Add provider to `app.module.ts`:

```ts
{
  provide: PRISMA_SERVICE,
  inject: [API_ENV],
  useFactory: (env: ApiEnv) => new PrismaService({ databaseUrl: env.databaseUrl })
}
```

and include `HealthService` in providers. Import types/tokens from their exact files.

- [ ] **Step 8: Verify healthy/down invariant and commit**

```bash
pnpm build:packages
pnpm --filter @mdp/api test
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm --filter @mdp/api test:integration
pnpm --filter @mdp/api typecheck
pnpm --filter @mdp/api build
```

Then with API running:

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
docker compose stop postgres
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
docker compose start postgres
```

Expected statuses: `200`, `200`, `200`, `503`.

```bash
git add compose.yaml .env.example prisma.config.ts prisma apps/api package.json pnpm-lock.yaml
git commit -m "feat(api): add postgres prisma readiness"
```

---

### Task 6: Enforce lint, formatting, Vitest projects, and architecture boundaries

**Files:**
- Create: `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`
- Test: `tests/architecture/eslint-boundaries.test.ts`

**Interfaces:**
- Produces: repository `lint`, `format:check`, root multi-project tests, executable forbidden-import proof.

- [ ] **Step 1: Write failing architecture-lint test**

`tests/architecture/eslint-boundaries.test.ts`:

```ts
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('architecture lint boundaries', () => {
  it('rejects Prisma imports from domain', async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText("import { PrismaClient } from '@prisma/client';\nexport {};", { filePath: 'packages/domain/src/forbidden.ts' });
    expect(result?.messages.some(m => m.ruleId === 'no-restricted-imports')).toBe(true);
  });
});
```

Expected: FAIL before ESLint config.

- [ ] **Step 2: Implement exact ESLint flat config**

`eslint.config.mjs`:

```js
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const publicApiOnly = ['@mdp/*/*', '**/packages/*/src/*'];
const neutralForbidden = ['@nestjs/*', '@prisma/*', 'react', 'react-dom', 'pg', 'redis', 'ioredis', 'bullmq', '**/apps/*'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'playwright-report/**', 'test-results/**', 'apps/api/src/infrastructure/persistence/prisma/generated/**'] },
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: globals.node } },
  ...tseslint.configs.recommended,
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  { files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'tests/**/*.ts', '*.ts'], languageOptions: { globals: globals.node } },
  { files: ['**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: publicApiOnly, message: 'Import workspace packages through @mdp/* public entry points.' }] }] } },
  { files: ['packages/domain/**/*.ts', 'packages/contracts/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [
    { group: publicApiOnly, message: 'Import workspace packages through public entry points.' },
    { group: neutralForbidden, message: 'Domain/contracts must remain framework and infrastructure neutral.' }
  ] }] } }
);
```

- [ ] **Step 3: Configure Prettier**

`.prettierrc.json`:

```json
{ "singleQuote": true, "trailingComma": "all", "semi": true, "printWidth": 100 }
```

`.prettierignore`:

```text
node_modules
dist
coverage
playwright-report
test-results
apps/api/src/infrastructure/persistence/prisma/generated
```

- [ ] **Step 4: Configure root Vitest projects**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/web/vite.config.ts',
      'apps/api/vitest.config.ts',
      'apps/api/vitest.integration.config.ts',
      'packages/shared/vitest.config.ts',
      { test: { name: 'architecture', environment: 'node', include: ['tests/architecture/**/*.test.ts'] } }
    ]
  }
});
```

- [ ] **Step 5: Verify and commit**

With PostgreSQL healthy and `DATABASE_URL` set:

```bash
pnpm test -- --project architecture
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Expected: all PASS.

```bash
git add eslint.config.mjs .prettierrc.json .prettierignore vitest.config.ts tests/architecture package.json pnpm-lock.yaml
git commit -m "test: enforce foundation quality boundaries"
```

---

### Task 7: Add critical Playwright E2E

**Files:**
- Create: `playwright.config.ts`
- Test: `tests/e2e/foundation.spec.ts`
- Modify: root `package.json`

**Interfaces:**
- Produces: `pnpm e2e` proving browser → web → API → PostgreSQL readiness.

- [ ] **Step 1: Install Playwright/Concurrently**

```bash
pnpm add -Dw @playwright/test concurrently
pnpm exec playwright install chromium
```

- [ ] **Step 2: Add deterministic root dev/E2E scripts**

Add to root scripts:

```json
{
  "dev:web": "pnpm build:packages && pnpm --filter @mdp/web dev",
  "dev:api": "pnpm build:packages && pnpm --filter @mdp/api dev",
  "dev:e2e": "pnpm build:packages && concurrently -k -s first -n api,web \"pnpm --filter @mdp/api dev\" \"pnpm --filter @mdp/web dev\"",
  "e2e": "playwright test"
}
```

- [ ] **Step 3: Write failing E2E**

`tests/e2e/foundation.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('web observes API/PostgreSQL readiness', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API pronta');

  const ready = await request.get('http://127.0.0.1:3000/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
});
```

Expected: FAIL before Playwright config/server orchestration.

- [ ] **Step 4: Configure Chromium E2E**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev:e2e',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      PORT: '3000',
      DATABASE_URL: 'postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      VITE_API_BASE_URL: 'http://127.0.0.1:3000'
    }
  }
});
```

- [ ] **Step 5: Verify and commit**

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm db:migrate
pnpm e2e
git add playwright.config.ts tests/e2e package.json pnpm-lock.yaml
git commit -m "test: add foundation browser e2e"
```

Expected: Chromium PASS.

---

### Task 8: Add reproducible GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: one workflow that fails on install/type/lint/format/test/build/migration/E2E failures.

- [ ] **Step 1: Create workflow**

`.github/workflows/ci.yml`:

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
        with: { node-version: '24' }
      - name: Enable Corepack
        run: corepack enable
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Start PostgreSQL
        run: docker compose up -d postgres
      - name: Wait for PostgreSQL health
        run: |
          for i in {1..30}; do
            id="$(docker compose ps -q postgres)"
            [ -n "$id" ] && [ "$(docker inspect --format='{{.State.Health.Status}}' "$id")" = "healthy" ] && exit 0
            sleep 2
          done
          docker compose logs postgres
          exit 1
      - name: Prisma validate
        run: pnpm prisma:validate
      - name: Prisma generate
        run: pnpm prisma:generate
      - name: Migrate
        run: pnpm db:migrate
      - name: Typecheck
        run: pnpm typecheck
      - name: Lint
        run: pnpm lint
      - name: Format
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

- [ ] **Step 2: Reproduce CI locally**

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

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add foundation verification workflow"
```

---

### Task 9: Record evidence, open review, and run Foundation Readiness Gate

**Files:**
- Create: `docs/phases/FOUNDATION.md`
- Create: `docs/evidence/foundation/FOUNDATION-EVIDENCE-001.md`
- Modify: `docs/STATE.md`, `docs/MDP-RESUME-CARD.md`
- Create only after explicit gate approval: `docs/checkpoints/MDP-FOUNDATION-CHECKPOINT-001.md`

**Interfaces:**
- Produces: auditable gate packet; no automatic merge.

- [ ] **Step 1: Run complete gate from clean tracked state**

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

Expected: no unexpected tracked changes; every command exits `0`.

- [ ] **Step 2: Capture database-failure invariant**

With API running:

```bash
curl -sS -o /tmp/live-healthy.json -w '%{http_code}\n' http://127.0.0.1:3000/health/live
curl -sS -o /tmp/ready-healthy.json -w '%{http_code}\n' http://127.0.0.1:3000/health/ready
docker compose stop postgres
curl -sS -o /tmp/live-db-down.json -w '%{http_code}\n' http://127.0.0.1:3000/health/live
curl -sS -o /tmp/ready-db-down.json -w '%{http_code}\n' http://127.0.0.1:3000/health/ready
docker compose start postgres
```

Expected status lines: `200`, `200`, `200`, `503`.

- [ ] **Step 3: Write evidence with actual values only**

`FOUNDATION-EVIDENCE-001.md` must contain actual:

```text
branch
HEAD SHA
Node version
pnpm version
PostgreSQL image + health
Prisma validation/generation/migration results
typecheck/lint/format results
Vitest results
web/API build results
Playwright result
healthy live/ready responses
database-down live/ready responses
architecture-boundary result
CI run/check reference
PR number
review result
residual findings
```

Missing data means gate incomplete; do not write placeholders or mark PASS.

- [ ] **Step 4: Record truthful IN_REVIEW state**

`docs/phases/FOUNDATION.md`, `docs/STATE.md`, and `docs/MDP-RESUME-CARD.md` must show:

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

- [ ] **Step 5: Open PR without auto-merge**

Title:

```text
FOUNDATION: repository and product bootstrap
```

Body links approved design, this plan, evidence file, readiness criteria, and explicitly states `Slice 01 is not part of this PR`.

- [ ] **Step 6: Verify CI/review and present gate**

Required before recommendation:

```text
CI = PASS
review findings = resolved or explicitly classified
unexpected scope = none
memory product entities/flows = absent
real sensitive data = absent
```

Present exactly one classification: `READY`, `READY_WITH_RESTRICTIONS`, or `BLOCKED`, with PR, HEAD SHA, CI, evidence, and residual findings. Do not merge without explicit LEANDRO approval.

- [ ] **Step 7: After explicit approval, checkpoint and merge**

Create `MDP-FOUNDATION-CHECKPOINT-001.md` containing actual classification, PR number, reviewed HEAD SHA, CI result, evidence path, and final merge SHA. Update canonical state to:

```text
FOUNDATION: COMPLETE
Slice 01: NOT STARTED / NOT AUTHORIZED
Real data: NOT AUTHORIZED
```

Read `docs/STATE.md` and the checkpoint back from `main` after merge to prove canonical recovery.

---

## Plan self-review result

- **Spec coverage:** Q1–Q16 and all design sections map to Tasks 1–9.
- **Runtime package consistency:** `@mdp/*` imports remain by package name, while ESM `dist` avoids relying on Node execution of TypeScript from dependency paths.
- **Scope:** no Memory, Evidence, Fact, Ledger, sync, AI, voice, auth hardening, pgvector, Redis, or object storage implementation exists in this plan.
- **Database YAGNI:** migration mechanics are proved with a no-product baseline instead of inventing an application table.
- **Prisma boundary:** generated/runtime code remains inside API infrastructure.
- **Config:** raw `process.env` is centralized at API env provider; Prisma CLI uses its own root config.
- **Errors:** raw exception content has an explicit non-leak test.
- **Health:** live/ready degradation behavior is explicitly tested and evidenced.
- **IDs:** UUID v7 implementation is tested and runtime-importable.
- **Tests:** unit/component, real DB integration, architecture lint, and browser E2E are separated and represented.
- **CI:** local gate sequence matches workflow sequence.
- **Evidence:** completion cannot be claimed with missing actual values.
- **Merge:** auto-merge is prohibited; final Foundation gate requires explicit LEANDRO approval.
- **Placeholder/ambiguity scan:** no `TBD`, `TODO`, “implement later”, or unspecified implementation/error-handling instruction remains.

## Primary implementation references

- Node.js releases: https://nodejs.org/en/about/previous-releases
- Node.js TypeScript runtime limitations: https://nodejs.org/download/release/v24.16.0/docs/api/typescript.html
- pnpm workspace: https://pnpm.io/workspaces
- NestJS: https://docs.nestjs.com/first-steps and https://docs.nestjs.com/techniques/configuration
- Prisma: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client
- Prisma generators: https://www.prisma.io/docs/orm/prisma-schema/overview/generators
- Vitest projects: https://vitest.dev/guide/projects.html
- Playwright: https://playwright.dev/docs/intro
- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- typescript-eslint: https://typescript-eslint.io/getting-started/
- Zod: https://zod.dev/basics
- UUID v7: https://github.com/uuidjs/uuid
