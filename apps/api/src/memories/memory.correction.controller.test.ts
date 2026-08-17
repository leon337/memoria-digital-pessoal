import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorFilter } from '../common/http/api-error.filter.js';
import { requestIdMiddleware } from '../common/http/request-id.middleware.js';
import { MemoryController } from './memory.controller.js';
import {
  MemoryNotFoundError,
  NoChangeCorrectionError,
  StaleCorrectionError,
} from './memory.errors.js';
import { MEMORY_SERVICE } from './memory.service.js';
import { MemoryStoreUnavailableError } from './memory.store.js';

const memoryId = '0198c000-0000-7000-8000-000000000010';
const oldFactId = '0198c000-0000-7000-8000-000000000001';
const newFactId = '0198c000-0000-7000-8000-000000000005';
const service = {
  register: vi.fn(),
  get: vi.fn(),
  query: vi.fn(),
  correct: vi.fn(),
  history: vi.fn(),
};
let app: INestApplication;

beforeEach(async () => {
  for (const fn of Object.values(service)) fn.mockReset();
  const moduleRef = await Test.createTestingModule({
    controllers: [MemoryController],
    providers: [{ provide: MEMORY_SERVICE, useValue: service }],
  }).compile();
  app = moduleRef.createNestApplication();
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ApiErrorFilter());
  await app.init();
});

afterEach(async () => {
  await app.close();
});

function correctionBody(overrides: Record<string, unknown> = {}) {
  return {
    text: 'Texto corrigido.',
    expectedCurrentFactId: oldFactId,
    reason: 'ajuste',
    ...overrides,
  };
}

describe('memory correction/history HTTP', () => {
  it('creates a correction with HTTP 201', async () => {
    service.correct.mockResolvedValue({
      memoryId,
      current: {
        factId: newFactId,
        evidenceId: '0198c000-0000-7000-8000-000000000003',
        content: 'Texto corrigido.',
        recordedAt: '2026-08-16T09:00:00.000Z',
        correctedAt: '2026-08-17T05:30:00.000Z',
      },
      correction: {
        eventId: '0198c000-0000-7000-8000-000000000004',
        supersedesFactId: oldFactId,
        reason: 'ajuste',
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/memories/${memoryId}/corrections`)
      .send(correctionBody());

    expect(response.status).toBe(201);
    expect(service.correct).toHaveBeenCalledWith(memoryId, correctionBody());
    expect(response.body.current.factId).toBe(newFactId);
  });

  it('uses 400 for malformed memoryId and 422 for malformed correction body/current fact', async () => {
    const badMemory = await request(app.getHttpServer())
      .post('/memories/not-a-uuid/corrections')
      .send(correctionBody());
    expect(badMemory.status).toBe(400);
    expect(badMemory.body.error.code).toBe('VALIDATION_FAILED');

    for (const body of [
      correctionBody({ expectedCurrentFactId: 'bad-id' }),
      correctionBody({ text: '   ' }),
      correctionBody({ text: 'x'.repeat(4001) }),
      correctionBody({ reason: 'x'.repeat(501) }),
    ]) {
      const response = await request(app.getHttpServer())
        .post(`/memories/${memoryId}/corrections`)
        .send(body);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it.each([
    [new MemoryNotFoundError(), 404, 'NOT_FOUND'],
    [new StaleCorrectionError(newFactId), 409, 'STALE_CORRECTION'],
    [new NoChangeCorrectionError(), 422, 'NO_CHANGE'],
  ] as const)('maps correction application error to %i/%s', async (error, status, code) => {
    service.correct.mockRejectedValue(error);
    const response = await request(app.getHttpServer())
      .post(`/memories/${memoryId}/corrections`)
      .send(correctionBody());
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('maps correction store outage to safe 503', async () => {
    service.correct.mockRejectedValue(
      new MemoryStoreUnavailableError(new Error('secret sql correction content')),
    );
    const response = await request(app.getHttpServer())
      .post(`/memories/${memoryId}/corrections`)
      .send(correctionBody());
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('secret sql');
  });

  it('returns history or NOT_FOUND', async () => {
    service.history.mockResolvedValueOnce({
      memoryId,
      versions: [
        {
          factId: oldFactId,
          evidenceId: '0198c000-0000-7000-8000-000000000002',
          content: 'Texto original.',
          createdAt: '2026-08-16T09:00:00.000Z',
          reason: null,
          supersedesFactId: null,
          eventId: '0198c000-0000-7000-8000-000000000003',
          isOriginal: true,
          isCurrent: true,
        },
      ],
    });
    const found = await request(app.getHttpServer()).get(`/memories/${memoryId}/history`);
    expect(found.status).toBe(200);
    expect(found.body.versions).toHaveLength(1);

    service.history.mockResolvedValueOnce(null);
    const missing = await request(app.getHttpServer()).get(`/memories/${memoryId}/history`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
