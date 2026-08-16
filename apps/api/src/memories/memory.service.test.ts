import { describe, expect, it, vi } from 'vitest';
import { MemoryService } from './memory.service.js';
import type { MemoryWriter } from './memory.store.js';

describe('MemoryService.register', () => {
  it('creates one deterministic record with one clock read and four IDs', async () => {
    const create = vi.fn<MemoryWriter['create']>().mockResolvedValue(undefined);
    const now = vi.fn(() => new Date('2026-08-16T09:00:00.000Z'));
    const ids = ['memory-id', 'evidence-id', 'event-id', 'fact-id'];
    const createId = vi.fn(() => ids.shift() ?? 'unexpected-id');
    const service = new MemoryService({ store: { create }, now, createId });

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

  it('does not report success when persistence fails', async () => {
    const create = vi.fn<MemoryWriter['create']>().mockRejectedValue(new Error('database failure'));
    const service = new MemoryService({
      store: { create },
      now: () => new Date('2026-08-16T09:00:00.000Z'),
      createId: () => '00000000-0000-7000-8000-000000000000',
    });

    await expect(service.register('Registro sintético.')).rejects.toThrow('database failure');
  });
});
