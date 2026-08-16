import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorFilter } from '../common/http/api-error.filter.js';
import { requestIdMiddleware } from '../common/http/request-id.middleware.js';
import { MemoryController } from './memory.controller.js';
import { MEMORY_SERVICE } from './memory.service.js';
import { MemoryStoreUnavailableError } from './memory.store.js';

const validId = '0198c000-0000-7000-8000-000000000001';
const service = {
  register: vi.fn(),
  get: vi.fn(),
  query: vi.fn(),
};
let app: INestApplication;

beforeEach(async () => {
  service.register.mockReset();
  service.get.mockReset();
  service.query.mockReset();
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

describe('memory HTTP', () => {
  it('creates a memory and preserves the original valid string', async () => {
    service.register.mockResolvedValue({
      memory: { id: validId, recordedAt: '2026-08-16T09:00:00.000Z' },
      fact: { id: validId, content: '  Minha irmã se chama Ana.  ' },
      provenance: { evidenceId: validId },
    });

    const response = await request(app.getHttpServer())
      .post('/memories')
      .send({ text: '  Minha irmã se chama Ana.  ' });

    expect(response.status).toBe(201);
    expect(service.register).toHaveBeenCalledWith('  Minha irmã se chama Ana.  ');
    expect(response.body.fact.content).toBe('  Minha irmã se chama Ana.  ');
  });

  it('rejects blank and oversized memory input with the safe envelope', async () => {
    for (const text of ['   ', 'x'.repeat(4001)]) {
      const response = await request(app.getHttpServer()).post('/memories').send({ text });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.requestId).toEqual(expect.any(String));
    }
    expect(service.register).not.toHaveBeenCalled();
  });

  it('returns a memory by UUID v7 and maps missing records to NOT_FOUND', async () => {
    service.get.mockResolvedValueOnce({
      memory: {
        id: validId,
        recordedAt: '2026-08-16T09:00:00.000Z',
        occurredAt: null,
        temporalPrecision: 'unknown',
      },
      evidence: {
        id: validId,
        kind: 'text',
        content: 'Registro sintético.',
        createdAt: '2026-08-16T09:00:00.000Z',
      },
      fact: {
        id: validId,
        kind: 'autobiographical_statement',
        content: 'Registro sintético.',
        createdAt: '2026-08-16T09:00:00.000Z',
      },
    });
    expect((await request(app.getHttpServer()).get(`/memories/${validId}`)).status).toBe(200);

    service.get.mockResolvedValueOnce(null);
    const missing = await request(app.getHttpServer()).get(`/memories/${validId}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a non-UUID-v7 memory ID before persistence', async () => {
    const response = await request(app.getHttpServer()).get('/memories/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(service.get).not.toHaveBeenCalled();
  });

  it('returns FOUND or UNKNOWN for valid literal queries', async () => {
    service.query.mockResolvedValueOnce({
      status: 'FOUND',
      answer: 'Minha irmã se chama Ana.',
      provenance: { memoryId: validId, evidenceId: validId, factId: validId },
    });
    const found = await request(app.getHttpServer()).get('/query').query({ q: '  Ana  ' });
    expect(found.status).toBe(200);
    expect(service.query).toHaveBeenCalledWith('Ana');
    expect(found.body.status).toBe('FOUND');

    service.query.mockResolvedValueOnce({ status: 'UNKNOWN', answer: null, provenance: null });
    const unknown = await request(app.getHttpServer()).get('/query').query({ q: 'ausente' });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ status: 'UNKNOWN', answer: null, provenance: null });
  });

  it('rejects malformed queries without calling the service', async () => {
    for (const q of ['   ', 'x'.repeat(201)]) {
      const response = await request(app.getHttpServer()).get('/query').query({ q });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('maps store unavailability to a safe 503 envelope without leaking the cause', async () => {
    service.register.mockRejectedValue(
      new MemoryStoreUnavailableError(new Error('secret SQL and synthetic evidence')),
    );
    const response = await request(app.getHttpServer())
      .post('/memories')
      .send({ text: 'Registro sintético.' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('secret SQL');
    expect(JSON.stringify(response.body)).not.toContain('Registro sintético');
  });
});
