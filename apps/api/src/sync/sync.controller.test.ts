import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorFilter } from '../common/http/api-error.filter.js';
import { requestIdMiddleware } from '../common/http/request-id.middleware.js';
import { SyncController } from './sync.controller.js';
import { SYNC_SERVICE, SyncService } from './sync.service.js';
import type { SyncStore } from './sync.store.js';
import { SyncStoreError } from './sync.store.js';

const clientInstanceId = '0198c000-0000-7000-8000-000000000001';
const memoryId = '0198c000-0000-7000-8000-000000000002';
const evidenceId = '0198c000-0000-7000-8000-000000000003';
const eventId = '0198c000-0000-7000-8000-000000000004';
const factId = '0198c000-0000-7000-8000-000000000005';
const bootstrapToken = '0198c000-0000-7000-8000-000000000006';

function createEnvelope() {
  const createdAt = '2026-08-18T08:00:00.000Z';
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'MEMORY_CREATED',
    memoryId,
    predecessorFactIds: [],
    records: [
      {
        kind: 'memory',
        id: memoryId,
        recordedAt: createdAt,
        occurredAt: null,
        temporalPrecision: 'unknown',
      },
      {
        kind: 'evidence',
        id: evidenceId,
        memoryId,
        evidenceKind: 'text',
        content: 'Registro sintético.',
        createdAt,
      },
      {
        kind: 'ledgerEvent',
        id: eventId,
        memoryId,
        evidenceId,
        factId: null,
        supersedesFactId: null,
        eventType: 'MEMORY_CREATED',
        reason: null,
        createdAt,
      },
      {
        kind: 'fact',
        id: factId,
        memoryId,
        evidenceId,
        factKind: 'autobiographical_statement',
        content: 'Registro sintético.',
        createdAt,
      },
    ],
  };
}

const store = {
  pushEvent: vi.fn(),
  pull: vi.fn(),
  startBootstrap: vi.fn(),
  readBootstrapPage: vi.fn(),
};

let app: INestApplication;

beforeEach(async () => {
  store.pushEvent.mockReset();
  store.pull.mockReset();
  store.startBootstrap.mockReset();
  store.readBootstrapPage.mockReset();

  const service = new SyncService(store as unknown as SyncStore, 50);
  const moduleRef = await Test.createTestingModule({
    controllers: [SyncController],
    providers: [{ provide: SYNC_SERVICE, useValue: service }],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ApiErrorFilter());
  await app.init();
});

afterEach(async () => {
  await app.close();
});

describe('sync HTTP', () => {
  it('returns structured 400 for an unsupported protocol version', async () => {
    const response = await request(app.getHttpServer())
      .post('/sync/v1/push')
      .send({ protocolVersion: 999, clientInstanceId, events: [createEnvelope()] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('SYNC_PROTOCOL_UNSUPPORTED');
    expect(response.body.error.requestId).toEqual(expect.any(String));
    expect(store.pushEvent).not.toHaveBeenCalled();
  });

  it('keeps per-event push outcomes on HTTP 200', async () => {
    store.pushEvent.mockResolvedValueOnce({ eventId, status: 'CONFLICT' });
    const response = await request(app.getHttpServer())
      .post('/sync/v1/push')
      .send({ protocolVersion: 1, clientInstanceId, events: [createEnvelope()] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      protocolVersion: 1,
      results: [{ eventId, status: 'CONFLICT' }],
    });
  });

  it('maps expired cursor and bootstrap token to structured 410 responses', async () => {
    store.pull.mockRejectedValueOnce(new SyncStoreError('SYNC_CURSOR_EXPIRED'));
    const pull = await request(app.getHttpServer()).get('/sync/v1/pull').query({
      after: '0',
      limit: '10',
    });
    expect(pull.status).toBe(410);
    expect(pull.body.error.code).toBe('SYNC_CURSOR_EXPIRED');

    store.readBootstrapPage.mockRejectedValueOnce(new SyncStoreError('SYNC_BOOTSTRAP_EXPIRED'));
    const page = await request(app.getHttpServer())
      .get(`/sync/v1/bootstrap/${bootstrapToken}`)
      .query({ offset: '0', limit: '10' });
    expect(page.status).toBe(410);
    expect(page.body.error.code).toBe('SYNC_BOOTSTRAP_EXPIRED');
  });

  it('maps integrity failures to structured 409', async () => {
    store.pull.mockRejectedValueOnce(new SyncStoreError('SYNC_INTEGRITY_VIOLATION'));
    const response = await request(app.getHttpServer()).get('/sync/v1/pull').query({
      after: '0',
      limit: '10',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SYNC_INTEGRITY_VIOLATION');
  });

  it('returns safe 503 without leaking persistence details or payload content', async () => {
    store.pushEvent.mockRejectedValueOnce(new Error('secret SQL containing Registro sintético.'));
    const response = await request(app.getHttpServer())
      .post('/sync/v1/push')
      .send({ protocolVersion: 1, clientInstanceId, events: [createEnvelope()] });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SYNC_SERVICE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('secret SQL');
    expect(JSON.stringify(response.body)).not.toContain('Registro sintético');
  });
});
