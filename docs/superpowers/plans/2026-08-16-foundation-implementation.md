# FOUNDATION Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimum reproducible web/API monorepo foundation required for Slice 01, with strict architectural boundaries, PostgreSQL/Prisma connectivity, tests, E2E, CI, and evidence-based readiness, without implementing the memory product flow.

**Architecture:** A pnpm Workspace contains `apps/web`, `apps/api`, and framework-neutral packages `@mdp/domain`, `@mdp/contracts`, and `@mdp/shared`. Workspace packages are consumed by package name and compile locally to small ESM `dist` artifacts for Node runtime use; they are never published. PostgreSQL runs in Docker Compose while web/API run on the host. Prisma lives only inside API infrastructure, and the gate proves typed configuration, safe HTTP errors, liveness/readiness, architecture restrictions, automated tests, browser E2E, and CI.

**Tech Stack:** Node.js 24 LTS, pnpm 10.x, TypeScript, React, Vite, NestJS, PostgreSQL 17, Prisma ORM 7, `@prisma/adapter-pg`, Zod, `uuid`, ESLint flat config, Prettier, Vitest, React Testing Library, `user-event`, Playwright, Docker Compose, GitHub Actions.

## Global Constraints

- Branch: `foundation/repository-bootstrap`.
- ESM everywhere; root `package.json` has `"type": "module"`.
- pnpm Workspaces only; no Nx/Turborepo.
- Internal package names: `@mdp/domain`, `@mdp/contracts`, `@mdp/shared`.
- Workspace dependencies use `workspace:*`; deep imports into package `src/` are prohibited.
- Workspace packages may compile to local `dist` for runtime. This is not publication and does not introduce a registry.
- `@mdp/domain` and `@mdp/contracts` remain framework/infrastructure neutral.
- Prisma is confined to root Prisma schema/migrations plus `apps/api/src/infrastructure/persistence/prisma/`.
- TypeScript baseline: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `forceConsistentCasingInFileNames`, `isolatedModules`.
- ESLint = quality/architecture; Prettier = formatting.
- Vitest = unit/integration/component; Playwright = browser E2E.
- PostgreSQL is the only Compose service in FOUNDATION.
- `/health/live` does not depend on PostgreSQL; `/health/ready` returns 503 when PostgreSQL is unavailable.
- UUID v7 is the global object-ID primitive.
- API errors expose safe structured codes/messages/request IDs and never raw database/framework exception text.
- Real sensitive data remains prohibited.
- No Memory/Evidence/Fact/Ledger product flow, Redis, BullMQ, worker, pgvector, embeddings, AI, STT/TTS, object storage, offline sync, advanced auth, or production deployment automation.
- FOUNDATION completion requires explicit evidence + review + LEANDRO gate approval.

## Resolved implementation details

- Node 24 is the chosen LTS line for this boundary.
- `corepack use pnpm@latest-10` pins the resolved pnpm 10 release into `packageManager`.
- Prisma 7 uses `prisma-client` with explicit ESM output and `@prisma/adapter-pg`.
- Zod validates web/API environment configuration.
- `uuid.v7()` implements UUID v7.
- Vitest uses `test.projects`.
- Playwright runs Chromium only in FOUNDATION.

---

## Task 1 — Root workspace and runtime baseline

**Files**
- Create: `.nvmrc`, `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`

**Produces**
- Node 24 + pnpm 10 workspace.
- Root scripts that always build workspace libraries before consumers that need runtime/type artifacts.

- [ ] **Step 1: Verify no workspace exists yet**

```bash
test ! -f package.json && test ! -f pnpm-workspace.yaml
```

Expected: exit `0`.

- [ ] **Step 2: Create root files**

`.nvmrc`

```text
24
```

`pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
```

`package.json`

```json
{
  "name": "memoria-digital-pessoal",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "build:packages": "pnpm -r --filter './packages/*' --if-present build",
    "typecheck": "pnpm build:packages && pnpm -r --filter './packages/*' --if-present typecheck && pnpm -r --filter './apps/*' --if-present typecheck",
    "build": "pnpm build:packages && pnpm -r --filter './apps/*' --if-present build",
    "test": "pnpm build:packages && vitest run",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier . --write",
    "format:check": "prettier . --check"
  }
}
```

`tsconfig.base.json`

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

`.gitignore`

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

- [ ] **Step 3: Pin pnpm and install root tooling**

```bash
corepack enable
corepack use pnpm@latest-10
pnpm add -Dw typescript vitest prettier eslint @eslint/js typescript-eslint globals
```

Expected: exact `packageManager: "pnpm@10.x.x"` added; `pnpm-lock.yaml` created.

- [ ] **Step 4: Validate**

```bash
node --version
pnpm --version
node -e "const p=require('./package.json'); if(!p.private || p.type!=='module' || !p.packageManager?.startsWith('pnpm@10.')) process.exit(1)"
```

Expected: Node `v24.*`, pnpm `10.*`, exit `0`.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc .gitignore package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json
git commit -m "build: establish pnpm workspace baseline"
```

---

## Task 2 — Neutral internal packages + UUID v7

**Files**
- Create: `packages/domain/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}`
- Create: `packages/contracts/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}`
- Create: `packages/shared/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts,src/id.ts,src/id.test.ts}`

**Produces**
- Runtime-importable `@mdp/*` ESM packages.
- `createId(): string` and `isUuidV7(value: string): boolean`.

- [ ] **Step 1: Create manifests/configs**

Use this manifest for domain/contracts (change `name` only):

```json
{
  "name": "@mdp/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
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
  "compilerOptions": { "lib": ["ES2023"], "types": [], "noEmit": true },
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

Domain/contracts `src/index.ts`:

```ts
export {};
```

Shared manifest:

```json
{
  "name": "@mdp/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run --config vitest.config.ts"
  }
}
```

Shared Vitest config:

```ts
import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'shared', environment: 'node', include: ['src/**/*.test.ts'] } });
```

- [ ] **Step 2: Write failing ID test**

`packages/shared/src/id.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createId, isUuidV7 } from './id.js';

describe('global id policy', () => {
  it('creates UUID v7', () => {
    const id = createId();
    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('rejects invalid/non-v7 values', () => {
    expect(isUuidV7('not-a-uuid')).toBe(false);
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});
```

`packages/shared/src/index.ts`

```ts
export { createId, isUuidV7 } from './id.js';
```

Run:

```bash
pnpm --filter @mdp/shared test
```

Expected: FAIL because `id.ts` does not exist.

- [ ] **Step 3: Install and implement UUID v7**

```bash
pnpm add uuid --filter @mdp/shared
```

`packages/shared/src/id.ts`

```ts
import { validate, v7, version } from 'uuid';

export function createId(): string { return v7(); }
export function isUuidV7(value: string): boolean { return validate(value) && version(value) === 7; }
```

- [ ] **Step 4: Prove tests/types/runtime package resolution**

```bash
pnpm --filter @mdp/shared test
pnpm -r --filter './packages/*' typecheck
pnpm build:packages
pnpm --filter @mdp/shared exec node -e "import('@mdp/shared').then(m=>{if(!m.createId || m.createId()[14]!=='7') process.exit(1)})"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages package.json pnpm-lock.yaml
git commit -m "build: add neutral workspace packages"
```

---

## Task 3 — Accessible React/Vite shell + typed web config

**Files**
- Create: `apps/web/package.json`, `tsconfig.json`, `tsconfig.app.json`, `vite.config.ts`, `index.html`
- Create: `apps/web/src/test/setup.ts`, `config/env.ts`, `config/env.test.ts`, `lib/api-health.ts`, `App.tsx`, `App.test.tsx`, `main.tsx`, `index.css`

**Produces**
- `parseWebEnv(source): WebEnv`.
- Minimal accessible FOUNDATION status UI.

- [ ] **Step 1: Create package/test config before any test runs**

`apps/web/package.json`

```json
{
  "name": "@mdp/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -p tsconfig.app.json && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 5173 --strictPort",
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

`apps/web/tsconfig.json`

```json
{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }
```

`apps/web/tsconfig.app.json`

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

`apps/web/src/test/setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/vite.config.ts`

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
});
```

- [ ] **Step 2: Write failing web-env test**

```ts
import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env.js';

describe('parseWebEnv', () => {
  it('accepts a valid API URL', () => {
    expect(parseWebEnv({ VITE_API_BASE_URL: 'http://127.0.0.1:3000' })).toEqual({ apiBaseUrl: 'http://127.0.0.1:3000' });
  });
  it('rejects missing API URL', () => expect(() => parseWebEnv({})).toThrow());
});
```

Run `pnpm --filter @mdp/web test`; expected FAIL because `env.ts` is absent.

- [ ] **Step 3: Implement web env**

```ts
import { z } from 'zod';
const schema = z.object({ VITE_API_BASE_URL: z.string().url() });
export interface WebEnv { apiBaseUrl: string }
export function parseWebEnv(source: Record<string, unknown>): WebEnv {
  const p = schema.parse(source); return { apiBaseUrl: p.VITE_API_BASE_URL };
}
export function getWebEnv(): WebEnv { return parseWebEnv(import.meta.env); }
```

- [ ] **Step 4: Write failing UI test**

`App.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

vi.mock('./lib/api-health.js', () => ({ getApiReadiness: vi.fn().mockResolvedValue('ready') }));

describe('App', () => {
  it('shows accessible readiness', async () => {
    render(<App apiBaseUrl="http://127.0.0.1:3000" />);
    expect(screen.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('API pronta');
  });
});
```

Expected: FAIL because App/readiness client are absent.

- [ ] **Step 5: Implement web shell**

`lib/api-health.ts`

```ts
export async function getApiReadiness(baseUrl: string): Promise<'ready' | 'unavailable'> {
  try { return (await fetch(`${baseUrl}/health/ready`)).ok ? 'ready' : 'unavailable'; }
  catch { return 'unavailable'; }
}
```

`App.tsx`

```tsx
import { useEffect, useState } from 'react';
import { getApiReadiness } from './lib/api-health.js';

export function App({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  useEffect(() => { void getApiReadiness(apiBaseUrl).then(setStatus); }, [apiBaseUrl]);
  const text = status === 'checking' ? 'Verificando API…' : status === 'ready' ? 'API pronta' : 'API indisponível';
  return <main><h1>Memória Digital Pessoal</h1><p>FOUNDATION técnica</p><p role="status" aria-live="polite">{text}</p></main>;
}
```

`main.tsx`

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

`index.html`

```html
<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Memória Digital Pessoal</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`index.css`

```css
:root { font-family: system-ui, sans-serif; line-height: 1.5; }
body { margin: 0; padding: 2rem; }
main { max-width: 48rem; margin: 0 auto; }
:focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }
```

- [ ] **Step 6: Verify/commit**

```bash
pnpm --filter @mdp/web test
pnpm --filter @mdp/web typecheck
VITE_API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @mdp/web build
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): add typed foundation shell"
```

---

## Task 4 — NestJS API shell + fail-fast config + request ID + safe errors + liveness

**Files**
- Create: `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `vitest.config.ts`, `vitest.integration.config.ts`
- Create: `src/config/env.ts`, `env.test.ts`, `env.module.ts`
- Create: `src/common/http/express.d.ts`, `request-id.middleware.ts`, `api-error.ts`, `api-error.filter.ts`, `api-error.filter.test.ts`
- Create: `src/health/health.controller.ts`, `health.service.ts`, `src/app.module.ts`, `src/main.ts`

**Produces**
- Typed API env.
- UUID-v7 request IDs.
- Safe error envelope.
- `/health/live`.

- [ ] **Step 1: Create package/config**

`package.json`

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
pnpm add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs zod dotenv --filter @mdp/api
pnpm add -D @nestjs/cli @nestjs/testing @types/express @types/node @types/supertest supertest --filter @mdp/api
```

`tsconfig.json`

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

`tsconfig.build.json`

```json
{ "extends": "./tsconfig.json", "exclude": ["src/**/*.test.ts", "src/**/*.integration.test.ts"] }
```

`nest-cli.json`

```json
{ "sourceRoot": "src", "compilerOptions": { "tsConfigPath": "tsconfig.build.json" } }
```

`vitest.config.ts`

```ts
import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'api', environment: 'node', include: ['src/**/*.test.ts'], exclude: ['src/**/*.integration.test.ts'] } });
```

`vitest.integration.config.ts`

```ts
import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'api-integration', environment: 'node', include: ['src/**/*.integration.test.ts'] } });
```

- [ ] **Step 2: Write failing env test**

```ts
import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env.js';
const valid = { PORT: '3000', DATABASE_URL: 'postgresql://mdp:mdp@127.0.0.1:5432/mdp', WEB_ORIGIN: 'http://127.0.0.1:5173' };

describe('parseApiEnv', () => {
  it('returns typed config', () => expect(parseApiEnv(valid)).toEqual({ port: 3000, databaseUrl: valid.DATABASE_URL, webOrigin: valid.WEB_ORIGIN }));
  it('fails without DATABASE_URL', () => expect(() => parseApiEnv({ PORT: '3000', WEB_ORIGIN: valid.WEB_ORIGIN })).toThrow());
});
```

Expected: FAIL.

- [ ] **Step 3: Implement typed env**

`env.ts`

```ts
import { z } from 'zod';
const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().refine(v => v.startsWith('postgresql://') || v.startsWith('postgres://'), 'DATABASE_URL must be PostgreSQL'),
  WEB_ORIGIN: z.string().url()
});
export interface ApiEnv { port: number; databaseUrl: string; webOrigin: string }
export function parseApiEnv(source: Record<string, unknown>): ApiEnv {
  const p = schema.parse(source); return { port: p.PORT, databaseUrl: p.DATABASE_URL, webOrigin: p.WEB_ORIGIN };
}
```

`env.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { parseApiEnv } from './env.js';
export const API_ENV = Symbol('API_ENV');
@Global()
@Module({ providers: [{ provide: API_ENV, useFactory: () => parseApiEnv(process.env) }], exports: [API_ENV] })
export class EnvModule {}
```

- [ ] **Step 4: Write failing exact error-filter tests**

`api-error.filter.test.ts`

```ts
import { ServiceUnavailableException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiErrorFilter } from './api-error.filter.js';

function harness() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = { switchToHttp: () => ({ getRequest: () => ({ requestId: 'request-123' }), getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('ApiErrorFilter', () => {
  it('hides internal exception text', () => {
    const h = harness(); new ApiErrorFilter().catch(new Error('password=secret'), h.host);
    expect(h.status).toHaveBeenCalledWith(500);
    expect(h.json).toHaveBeenCalledWith({ error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.', requestId: 'request-123' } });
    expect(JSON.stringify(h.json.mock.calls)).not.toContain('password=secret');
  });

  it('maps unavailability safely', () => {
    const h = harness(); new ApiErrorFilter().catch(new ServiceUnavailableException(), h.host);
    expect(h.status).toHaveBeenCalledWith(503);
    expect(h.json).toHaveBeenCalledWith({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Serviço temporariamente indisponível.', requestId: 'request-123' } });
  });
});
```

Expected: FAIL.

- [ ] **Step 5: Implement request ID + error contract**

`api-error.ts`

```ts
export type ApiErrorCode = 'VALIDATION_FAILED' | 'NOT_FOUND' | 'REQUEST_FAILED' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR';
export interface ApiErrorEnvelope { error: { code: ApiErrorCode; message: string; requestId: string; fields?: Record<string, string[]> } }
```

`express.d.ts`

```ts
declare global { namespace Express { interface Request { requestId: string } } }
export {};
```

`request-id.middleware.ts`

```ts
import { createId, isUuidV7 } from '@mdp/shared';
import type { NextFunction, Request, Response } from 'express';
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header('x-request-id');
  req.requestId = supplied && isUuidV7(supplied) ? supplied : createId();
  res.setHeader('x-request-id', req.requestId);
  next();
}
```

`api-error.filter.ts`

```ts
import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorCode, ApiErrorEnvelope } from './api-error.js';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp(); const req = http.getRequest<Request>(); const res = http.getResponse<Response>();
    let status = 500; let code: ApiErrorCode = 'INTERNAL_ERROR'; let message = 'Ocorreu um erro interno.';
    if (exception instanceof ServiceUnavailableException) { status = 503; code = 'SERVICE_UNAVAILABLE'; message = 'Serviço temporariamente indisponível.'; }
    else if (exception instanceof BadRequestException) { status = 400; code = 'VALIDATION_FAILED'; message = 'Os dados enviados são inválidos.'; }
    else if (exception instanceof NotFoundException) { status = 404; code = 'NOT_FOUND'; message = 'Recurso não encontrado.'; }
    else if (exception instanceof HttpException) { status = exception.getStatus(); code = 'REQUEST_FAILED'; message = 'A solicitação não pôde ser processada.'; }
    const body: ApiErrorEnvelope = { error: { code, message, requestId: req.requestId } };
    res.status(status).json(body);
  }
}
```

- [ ] **Step 6: Implement liveness/bootstrap**

`health.controller.ts`

```ts
import { Controller, Get } from '@nestjs/common';
@Controller('health')
export class HealthController { @Get('live') live(): { status: 'live' } { return { status: 'live' }; } }
```

`health.service.ts`

```ts
import { Injectable } from '@nestjs/common';
@Injectable() export class HealthService {}
```

`app.module.ts`

```ts
import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
@Module({ imports: [EnvModule], controllers: [HealthController], providers: [HealthService] }) export class AppModule {}
```

`main.ts`

```ts
import 'dotenv/config';
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
  app.enableShutdownHooks();
  await app.listen(env.port, '127.0.0.1');
}
void bootstrap();
```

- [ ] **Step 7: Verify/commit**

```bash
pnpm build:packages
pnpm --filter @mdp/api test
pnpm --filter @mdp/api typecheck
pnpm --filter @mdp/api build
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat(api): add safe foundation http shell"
```

---

## Task 5 — PostgreSQL + Prisma 7 + baseline migration + readiness

**Files**
- Create: `compose.yaml`, `.env.example`, `prisma.config.ts`, `prisma/schema.prisma`, migration files
- Create: `apps/api/src/infrastructure/persistence/prisma/prisma.service.ts`, integration test
- Create/Modify: `apps/api/src/health/health.controller.test.ts`, `health.controller.ts`, `health.service.ts`, `app.module.ts`

**Produces**
- `PRISMA_SERVICE`, `PrismaService.ping()`, `/health/ready`.

- [ ] **Step 1: Create local PostgreSQL config**

`.env.example`

```dotenv
PORT=3000
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp
WEB_ORIGIN=http://127.0.0.1:5173
VITE_API_BASE_URL=http://127.0.0.1:3000
```

`compose.yaml`

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

- [ ] **Step 2: Install/configure Prisma**

```bash
pnpm add -Dw prisma dotenv
pnpm add @prisma/client @prisma/adapter-pg pg --filter @mdp/api
pnpm add -D @types/pg --filter @mdp/api
```

`prisma/schema.prisma`

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../apps/api/src/infrastructure/persistence/prisma/generated"
  runtime      = "nodejs"
  moduleFormat = "esm"
}

datasource db { provider = "postgresql" }
```

`prisma.config.ts`

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: env('DATABASE_URL') } });
```

`prisma/migrations/migration_lock.toml`

```toml
provider = "postgresql"
```

`prisma/migrations/20260816000100_foundation_baseline/migration.sql`

```sql
-- FOUNDATION baseline: prove migration deployment without product tables.
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

- [ ] **Step 3: Prove DB/migration mechanics**

```bash
cp .env.example .env
docker compose up -d postgres
docker compose ps postgres
pnpm prisma:validate
pnpm prisma:generate
pnpm db:migrate
test "$(docker compose exec -T postgres psql -U mdp -d mdp -tAc \"SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations';\")" = "0"
```

Expected: PostgreSQL `healthy`, commands PASS, zero product tables.

- [ ] **Step 4: Write failing Prisma integration test**

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

Expected: FAIL.

- [ ] **Step 5: Implement PrismaService**

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';
export const PRISMA_SERVICE = Symbol('PRISMA_SERVICE');
export interface PrismaServiceOptions { databaseUrl: string }

export class PrismaService {
  private readonly client: PrismaClient;
  constructor(options: PrismaServiceOptions) {
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString: options.databaseUrl }) });
  }
  async ping(): Promise<void> { await this.client.$queryRaw`SELECT 1`; }
  async close(): Promise<void> { await this.client.$disconnect(); }
}
```

Run:

```bash
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm --filter @mdp/api test:integration
```

Expected: PASS.

- [ ] **Step 6: Write failing full HTTP health test**

`health.controller.test.ts`

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorFilter } from '../common/http/api-error.filter.js';
import { requestIdMiddleware } from '../common/http/request-id.middleware.js';
import { PRISMA_SERVICE } from '../infrastructure/persistence/prisma/prisma.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

const prisma = { ping: vi.fn<() => Promise<void>>() };
let app: INestApplication;

beforeEach(async () => {
  prisma.ping.mockReset(); prisma.ping.mockResolvedValue();
  const mod = await Test.createTestingModule({ controllers: [HealthController], providers: [HealthService, { provide: PRISMA_SERVICE, useValue: prisma }] }).compile();
  app = mod.createNestApplication(); app.use(requestIdMiddleware); app.useGlobalFilters(new ApiErrorFilter()); await app.init();
});
afterEach(async () => app.close());

describe('health HTTP', () => {
  it('keeps live independent from ready', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/health/live')).status).toBe(200);
    expect((await request(server).get('/health/ready')).status).toBe(200);
    prisma.ping.mockRejectedValueOnce(new Error('db down'));
    expect((await request(server).get('/health/live')).status).toBe(200);
    const failed = await request(server).get('/health/ready');
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
```

Expected: FAIL before readiness wiring.

- [ ] **Step 7: Wire readiness/provider**

`health.service.ts`

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

`health.controller.ts`

```ts
import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service.js';
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get('live') live(): { status: 'live' } { return { status: 'live' }; }
  @Get('ready') ready(): Promise<{ status: 'ready' }> { return this.health.readiness(); }
}
```

Add to `app.module.ts` imports and providers:

```ts
import { API_ENV } from './config/env.module.js';
import type { ApiEnv } from './config/env.js';
import { PRISMA_SERVICE, PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';

const prismaProvider = {
  provide: PRISMA_SERVICE,
  inject: [API_ENV],
  useFactory: (env: ApiEnv) => new PrismaService({ databaseUrl: env.databaseUrl })
};
```

`providers: [HealthService, prismaProvider]`.

- [ ] **Step 8: Verify/commit**

```bash
pnpm build:packages
pnpm --filter @mdp/api test
DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp pnpm --filter @mdp/api test:integration
pnpm --filter @mdp/api typecheck
pnpm --filter @mdp/api build
git add compose.yaml .env.example prisma.config.ts prisma apps/api package.json pnpm-lock.yaml
git commit -m "feat(api): add postgres prisma readiness"
```

---

## Task 6 — ESLint/Prettier/Vitest projects + architecture proof

**Files**
- Create: `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `tests/architecture/eslint-boundaries.test.ts`

- [ ] **Step 1: Write failing architecture test**

```ts
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('architecture lint', () => {
  it('rejects Prisma imports from domain', async () => {
    const [result] = await new ESLint().lintText("import { PrismaClient } from '@prisma/client';\nexport {};", { filePath: 'packages/domain/src/forbidden.ts' });
    expect(result?.messages.some(m => m.ruleId === 'no-restricted-imports')).toBe(true);
  });
});
```

Expected: FAIL.

- [ ] **Step 2: Implement flat ESLint config**

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
  { files: ['**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: publicApiOnly, message: 'Use @mdp/* public entry points.' }] }] } },
  { files: ['packages/domain/**/*.ts', 'packages/contracts/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [
    { group: publicApiOnly, message: 'Use workspace public entry points.' },
    { group: neutralForbidden, message: 'Domain/contracts must stay neutral.' }
  ] }] } }
);
```

- [ ] **Step 3: Prettier**

`.prettierrc.json`

```json
{ "singleQuote": true, "trailingComma": "all", "semi": true, "printWidth": 100 }
```

`.prettierignore`

```text
node_modules
dist
coverage
playwright-report
test-results
apps/api/src/infrastructure/persistence/prisma/generated
```

- [ ] **Step 4: Root Vitest projects**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { projects: [
  'apps/web/vite.config.ts',
  'apps/api/vitest.config.ts',
  'apps/api/vitest.integration.config.ts',
  'packages/shared/vitest.config.ts',
  { test: { name: 'architecture', environment: 'node', include: ['tests/architecture/**/*.test.ts'] } }
] } });
```

- [ ] **Step 5: Verify/commit**

```bash
export DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp
pnpm exec vitest run --project architecture
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
git add eslint.config.mjs .prettierrc.json .prettierignore vitest.config.ts tests/architecture package.json pnpm-lock.yaml
git commit -m "test: enforce foundation quality boundaries"
```

---

## Task 7 — Playwright browser E2E over built apps

**Files**
- Create: `playwright.config.ts`, `tests/e2e/foundation.spec.ts`
- Modify: root `package.json`

- [ ] **Step 1: Install**

```bash
pnpm add -Dw @playwright/test concurrently
pnpm exec playwright install chromium
```

- [ ] **Step 2: Add scripts**

```json
{
  "serve:e2e": "concurrently -k -n api,web \"pnpm --filter @mdp/api start\" \"pnpm --filter @mdp/web preview\"",
  "e2e": "playwright test"
}
```

- [ ] **Step 3: Write failing E2E**

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

- [ ] **Step 4: Configure Playwright**

```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm serve:e2e',
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

- [ ] **Step 5: Verify/commit**

```bash
export PORT=3000
export DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp
export WEB_ORIGIN=http://127.0.0.1:5173
export VITE_API_BASE_URL=http://127.0.0.1:3000
docker compose up -d postgres
pnpm db:migrate
pnpm build
pnpm e2e
git add playwright.config.ts tests/e2e package.json pnpm-lock.yaml
git commit -m "test: add foundation browser e2e"
```

Expected: PASS in Chromium.

---

## Task 8 — GitHub Actions CI

**Files**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create exact workflow**

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
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: docker compose up -d postgres
      - name: Wait for PostgreSQL
        run: |
          for i in {1..30}; do
            id="$(docker compose ps -q postgres)"
            [ -n "$id" ] && [ "$(docker inspect --format='{{.State.Health.Status}}' "$id")" = "healthy" ] && exit 0
            sleep 2
          done
          docker compose logs postgres
          exit 1
      - run: pnpm prisma:validate
      - run: pnpm prisma:generate
      - run: pnpm db:migrate
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm build
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm e2e
      - if: always()
        run: docker compose down
```

- [ ] **Step 2: Reproduce exact CI sequence locally**

```bash
export PORT=3000
export DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp
export WEB_ORIGIN=http://127.0.0.1:5173
export VITE_API_BASE_URL=http://127.0.0.1:3000
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

## Task 9 — Evidence, PR, review, Foundation Readiness Gate

**Files**
- Create: `docs/phases/FOUNDATION.md`, `docs/evidence/foundation/FOUNDATION-EVIDENCE-001.md`
- Modify: `docs/STATE.md`, `docs/MDP-RESUME-CARD.md`
- Create only after explicit approval: `docs/checkpoints/MDP-FOUNDATION-CHECKPOINT-001.md`

- [ ] **Step 1: Run clean full gate**

```bash
export PORT=3000
export DATABASE_URL=postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp
export WEB_ORIGIN=http://127.0.0.1:5173
export VITE_API_BASE_URL=http://127.0.0.1:3000
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

Expected: no unexpected tracked modifications; every command exits `0`.

- [ ] **Step 2: Capture degradation evidence**

Start built API (`pnpm --filter @mdp/api start`) and run:

```bash
curl -sS -o /tmp/live-healthy.json -w '%{http_code}\n' http://127.0.0.1:3000/health/live
curl -sS -o /tmp/ready-healthy.json -w '%{http_code}\n' http://127.0.0.1:3000/health/ready
docker compose stop postgres
curl -sS -o /tmp/live-db-down.json -w '%{http_code}\n' http://127.0.0.1:3000/health/live
curl -sS -o /tmp/ready-db-down.json -w '%{http_code}\n' http://127.0.0.1:3000/health/ready
docker compose start postgres
```

Expected: `200`, `200`, `200`, `503`.

- [ ] **Step 3: Write evidence using actual values only**

`FOUNDATION-EVIDENCE-001.md` must record actual:

```text
branch
HEAD SHA
Node version
pnpm version
PostgreSQL image/health
Prisma validate/generate/migrate results
no-product-table check
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

Missing actual data = gate incomplete. Do not write placeholder PASS values.

- [ ] **Step 4: Record truthful review state**

Before final gate, docs must say:

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

- [ ] **Step 5: Open PR; no auto-merge**

Title:

```text
FOUNDATION: repository and product bootstrap
```

Body links approved design, this plan, evidence, criteria, and states: `Slice 01 is not part of this PR`.

- [ ] **Step 6: Verify CI + review, then present gate**

Required:

```text
CI = PASS
review findings = resolved or classified
scope creep = none
product memory entities/flows = absent
real sensitive data = absent
```

Present exactly one result: `READY`, `READY_WITH_RESTRICTIONS`, or `BLOCKED`, with PR number, HEAD SHA, CI, evidence path, and residual findings. Do not merge without explicit LEANDRO approval.

- [ ] **Step 7: After approval, checkpoint + merge + readback**

Create `MDP-FOUNDATION-CHECKPOINT-001.md` containing actual gate result, PR number, reviewed HEAD SHA, CI result, evidence path, and final merge SHA. Update state:

```text
FOUNDATION: COMPLETE
Slice 01: NOT STARTED / NOT AUTHORIZED
Real data: NOT AUTHORIZED
```

After merge, read `docs/STATE.md` and the checkpoint from `main` to verify canonical recovery.

---

## Self-review result

- All FOUNDATION Q1–Q16 requirements map to Tasks 1–9.
- Workspace imports remain package-name based; runtime uses built ESM outputs instead of relying on Node to execute TypeScript from dependency paths.
- No Memory/Evidence/Fact/Ledger product implementation appears.
- Prisma generated/runtime code stays in API infrastructure.
- Baseline migration proves migration mechanics without inventing a product table.
- API raw environment reads are centralized in `EnvModule`; `main.ts` only loads `.env` through `dotenv/config`.
- Internal exception leakage is explicitly tested.
- Live/ready behavior is tested under database failure.
- Root typecheck/test commands build workspace packages first, avoiding missing `dist` declarations/runtime files.
- Web test configuration exists before its first test is run.
- E2E serves built API/web outputs, not watch-mode processes.
- Local gate sequence matches CI.
- No `TBD`, `TODO`, “implement later”, or unspecified implementation step remains.

## Primary references

- Node releases: https://nodejs.org/en/about/previous-releases
- Node TypeScript limitations: https://nodejs.org/download/release/v24.16.0/docs/api/typescript.html
- pnpm workspace: https://pnpm.io/workspaces
- NestJS: https://docs.nestjs.com/first-steps
- Prisma client generation: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client
- Prisma generators: https://www.prisma.io/docs/orm/prisma-schema/overview/generators
- Vitest projects: https://vitest.dev/guide/projects.html
- Playwright: https://playwright.dev/docs/intro
- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- Zod: https://zod.dev/basics
- UUID v7: https://github.com/uuidjs/uuid
