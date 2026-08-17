import type { CorrectMemoryRequest } from '@mdp/contracts';
import { CorrectionDomainError, createTextCorrectionRecord } from '@mdp/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  MemoryNotFoundError,
  NoChangeCorrectionError,
  StaleCorrectionError,
} from './memory.errors.js';
import { MemoryService } from './memory.service.js';
import type { MemoryStore } from './memory.store.js';

function makeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    create: async () => undefined,
    getById: async () => null,
    findLiteral: async () => null,
    correct: async () => ({ status: 'NOT_FOUND' }),
    history: async () => null,
    ...overrides,
  };
}

const request: CorrectMemoryRequest = {
  text: 'Texto corrigido.',
  expectedCurrentFactId: '0198c000-0000-7000-8000-000000000001',
  reason: 'ajuste',
};

function correctedRecord() {
  return createTextCorrectionRecord({
    memoryId: '0198c000-0000-7000-8000-000000000010',
    previous: {
      factId: request.expectedCurrentFactId,
      evidenceId: '0198c000-0000-7000-8000-000000000002',
      content: 'Texto original.',
      recordedAt: new Date('2026-08-16T09:00:00.000Z'),
    },
    text: request.text,
    reason: request.reason,
    correctedAt: new Date('2026-08-17T05:30:00.000Z'),
    ids: {
      evidenceId: '0198c000-0000-7000-8000-000000000003',
      eventId: '0198c000-0000-7000-8000-000000000004',
      factId: '0198c000-0000-7000-8000-000000000005',
    },
  });
}

describe('MemoryService correction and history', () => {
  it('uses one clock read and exactly three generated IDs for a correction', async () => {
    const record = correctedRecord();
    const correct = vi.fn<MemoryStore['correct']>().mockResolvedValue({
      status: 'CORRECTED',
      record,
    });
    const now = vi.fn(() => new Date('2026-08-17T05:30:00.000Z'));
    const ids = [record.evidence.id, record.event.id, record.fact.id];
    const createId = vi.fn(() => ids.shift() ?? 'unexpected');
    const service = new MemoryService({ store: makeStore({ correct }), now, createId });

    const response = await service.correct(record.fact.memoryId, request);

    expect(now).toHaveBeenCalledTimes(1);
    expect(createId).toHaveBeenCalledTimes(3);
    expect(correct).toHaveBeenCalledWith({
      memoryId: record.fact.memoryId,
      expectedCurrentFactId: request.expectedCurrentFactId,
      text: request.text,
      reason: request.reason,
      correctedAt: new Date('2026-08-17T05:30:00.000Z'),
      ids: {
        evidenceId: record.evidence.id,
        eventId: record.event.id,
        factId: record.fact.id,
      },
    });
    expect(response).toEqual({
      memoryId: record.fact.memoryId,
      current: {
        factId: record.fact.id,
        evidenceId: record.evidence.id,
        content: record.fact.content,
        recordedAt: '2026-08-16T09:00:00.000Z',
        correctedAt: '2026-08-17T05:30:00.000Z',
      },
      correction: {
        eventId: record.event.id,
        supersedesFactId: request.expectedCurrentFactId,
        reason: 'ajuste',
      },
    });
  });

  it('maps persistence outcomes to explicit application errors', async () => {
    const stale = new MemoryService({
      store: makeStore({
        correct: async () => ({
          status: 'STALE',
          currentFactId: '0198c000-0000-7000-8000-000000000099',
        }),
      }),
      now: () => new Date(),
      createId: () => '0198c000-0000-7000-8000-000000000003',
    });
    await expect(stale.correct('0198c000-0000-7000-8000-000000000010', request)).rejects.toBeInstanceOf(
      StaleCorrectionError,
    );

    const missing = new MemoryService({
      store: makeStore(),
      now: () => new Date(),
      createId: () => '0198c000-0000-7000-8000-000000000003',
    });
    await expect(missing.correct('0198c000-0000-7000-8000-000000000010', request)).rejects.toBeInstanceOf(
      MemoryNotFoundError,
    );
  });

  it('maps domain NO_CHANGE without pretending persistence succeeded', async () => {
    const service = new MemoryService({
      store: makeStore({
        correct: async () => {
          throw new CorrectionDomainError('NO_CHANGE');
        },
      }),
      now: () => new Date(),
      createId: () => '0198c000-0000-7000-8000-000000000003',
    });

    await expect(service.correct('0198c000-0000-7000-8000-000000000010', request)).rejects.toBeInstanceOf(
      NoChangeCorrectionError,
    );
  });

  it('maps stored history timestamps to the public ISO contract', async () => {
    const history = vi.fn<MemoryStore['history']>().mockResolvedValue({
      memoryId: '0198c000-0000-7000-8000-000000000010',
      versions: [
        {
          factId: '0198c000-0000-7000-8000-000000000001',
          evidenceId: '0198c000-0000-7000-8000-000000000002',
          content: 'Texto original.',
          createdAt: new Date('2026-08-16T09:00:00.000Z'),
          reason: null,
          supersedesFactId: null,
          eventId: '0198c000-0000-7000-8000-000000000003',
          isOriginal: true,
          isCurrent: true,
        },
      ],
    });
    const service = new MemoryService({
      store: makeStore({ history }),
      now: () => new Date(),
      createId: () => 'unused',
    });

    await expect(service.history('0198c000-0000-7000-8000-000000000010')).resolves.toEqual({
      memoryId: '0198c000-0000-7000-8000-000000000010',
      versions: [
        expect.objectContaining({
          createdAt: '2026-08-16T09:00:00.000Z',
          isOriginal: true,
          isCurrent: true,
        }),
      ],
    });
    await expect(
      new MemoryService({ store: makeStore(), now: () => new Date(), createId: () => 'unused' }).history(
        '0198c000-0000-7000-8000-000000000010',
      ),
    ).resolves.toBeNull();
  });
});
