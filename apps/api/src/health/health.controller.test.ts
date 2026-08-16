import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorFilter } from '../common/http/api-error.filter.js';
import { requestIdMiddleware } from '../common/http/request-id.middleware.js';
import { PRISMA_SERVICE } from '../infrastructure/persistence/prisma/prisma.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

const prisma = { ping: vi.fn(async (): Promise<void> => undefined) };
let app: INestApplication;

beforeEach(async () => {
  prisma.ping.mockReset();
  prisma.ping.mockResolvedValue(undefined);
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [HealthService, { provide: PRISMA_SERVICE, useValue: prisma }],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ApiErrorFilter());
  await app.init();
});

afterEach(async () => {
  await app.close();
});

describe('health HTTP', () => {
  it('keeps liveness independent from readiness', async () => {
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
