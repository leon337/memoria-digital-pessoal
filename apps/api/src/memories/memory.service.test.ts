import { describe, expect, it, vi } from 'vitest';
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

describe('MemoryService', () => {
  it('registers one deterministic record with one clock read and four IDs', async () => {
    const create = vi.fn<MemoryStore['create']>().mockResolvedValue(undefined);
    const now = vi.fn(() => new Date('2026-08-16T09:00:00.000Z'));
    const ids = ['memory-id', 'evidence-id', 'event-id', 'fact-id'];
    const createId = vi.fn(() => ids.shift() ?? 'unexpected-id');
    const service = new MemoryService({ store: makeStore({ create }), now, createId });

    const result = await service.register('  Minha irmã se chama Ana.  ');

    expect(now).toHaveBeenCalledTimes(1);
    expect(createId).toHaveBeenCalledTimes(4);
    expect(create).toHaveBeenCalledTimes(1);
    const record = create.mock.calls[0]?.[0];
    expect(record?.evidence.content).toBe('  Minha irmã se chama Ana.  ');
    expect(record?.fact.content).toBe(record?.evidence.content);
    expect(record?.currentFact.content).toBe(record?.fact.content);
    expect(record?.event.type).toBe('MEMORY_CREATED');
    expect(result).toEqual({
      memory: {
        id: 'memory-id',
        recordedAt: '2026-08-16T09:00:00.000Z',
      },
      fact: {
        id: 'fact-id',
        content: '  Minha irmã se chama Ana.  ',
      },
      provenance: {
        evidenceId: 'evidence-id',
      },
    });
  });

  it('does not report registration success when persistence fails', async () => {
    const create = vi.fn<MemoryStore['create']>().mockRejectedValue(new Error('database failure'));
    const service = new MemoryService({
      store: makeStore({ create }),
      now: () => new Date('2026-08-16T09:00:00.000Z'),
      createId: () => '00000000-0000-7000-8000-000000000000',
    });

    await expect(service.register('Registro sintético.')).rejects.toThrow('database failure');
  });

  it('maps persisted memory with exact evidence and deterministic fact', async () => {
    const getById = vi.fn<MemoryStore['getById']>().mockResolvedValue({
      memory: {
        id: 'memory-id',
        recordedAt: new Date('2026-08-16T09:00:00.000Z'),
        occurredAt: null,
        temporalPrecision: 'unknown',
      },
      evidence: {
        id: 'evidence-id',
        kind: 'text',
        content: '  Minha irmã se chama Ana.  ',
        createdAt: new Date('2026-08-16T09:00:00.000Z'),
      },
      fact: {
        id: 'fact-id',
        kind: 'autobiographical_statement',
        content: '  Minha irmã se chama Ana.  ',
        createdAt: new Date('2026-08-16T09:00:00.000Z'),
      },
    });
    const service = new MemoryService({
      store: makeStore({ getById }),
      now: () => new Date(),
      createId: () => 'unused',
    });

    const result = await service.get('memory-id');

    expect(getById).toHaveBeenCalledWith('memory-id');
    expect(result?.evidence.content).toBe('  Minha irmã se chama Ana.  ');
    expect(result?.fact.content).toBe(result?.evidence.content);
    expect(result?.memory.occurredAt).toBeNull();
    expect(result?.memory.temporalPrecision).toBe('unknown');
  });

  it('maps a query hit with provenance and trims only the query', async () => {
    const findLiteral = vi.fn<MemoryStore['findLiteral']>().mockResolvedValue({
      memoryId: 'memory-id',
      evidenceId: 'evidence-id',
      factId: 'fact-id',
      content: '  Minha irmã se chama Ana.  ',
      recordedAt: new Date('2026-08-16T09:00:00.000Z'),
    });
    const service = new MemoryService({
      store: makeStore({ findLiteral }),
      now: () => new Date(),
      createId: () => 'unused',
    });

    const result = await service.query('  ANA  ');

    expect(findLiteral).toHaveBeenCalledWith('ANA');
    expect(result).toEqual({
      status: 'FOUND',
      answer: '  Minha irmã se chama Ana.  ',
      provenance: {
        memoryId: 'memory-id',
        evidenceId: 'evidence-id',
        factId: 'fact-id',
      },
    });
  });

  it('returns explicit UNKNOWN when no matching evidence exists', async () => {
    const service = new MemoryService({
      store: makeStore(),
      now: () => new Date(),
      createId: () => 'unused',
    });

    await expect(service.query('ausente')).resolves.toEqual({
      status: 'UNKNOWN',
      answer: null,
      provenance: null,
    });
    await expect(service.get('missing')).resolves.toBeNull();
  });
});
