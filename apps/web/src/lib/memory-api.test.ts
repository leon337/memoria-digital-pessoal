import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  correctMemory,
  createMemory,
  getMemoryHistory,
  MemoryApiError,
  queryMemory,
} from './memory-api.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('memory API client', () => {
  it('posts the exact memory text once without trimming or retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        {
          memory: { id: 'memory-id', recordedAt: '2026-08-16T09:00:00.000Z' },
          fact: { id: 'fact-id', content: '  Minha irmã se chama Ana.  ' },
          provenance: { evidenceId: 'evidence-id' },
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createMemory('http://127.0.0.1:3000/', '  Minha irmã se chama Ana.  ');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '  Minha irmã se chama Ana.  ' }),
    });
    expect(result.fact.content).toBe('  Minha irmã se chama Ana.  ');
  });

  it('throws after one failed POST and does not retry automatically', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: {} }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createMemory('http://api', 'Registro sintético.')).rejects.toEqual(
      expect.objectContaining<Partial<MemoryApiError>>({ status: 503 }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('encodes literal query characters and parses explicit UNKNOWN', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ status: 'UNKNOWN', answer: null, provenance: null }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryMemory('http://api', '%_ sintético');

    expect(fetchMock).toHaveBeenCalledWith('http://api/query?q=%25_+sint%C3%A9tico');
    expect(result).toEqual({ status: 'UNKNOWN', answer: null, provenance: null });
  });

  it('posts exactly one correction request and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        {
          memoryId: 'm1',
          current: {
            factId: 'f2',
            evidenceId: 'e2',
            content: 'B.',
            recordedAt: '2026-08-16T09:00:00.000Z',
            correctedAt: '2026-08-17T05:00:00.000Z',
          },
          correction: { eventId: 'ev2', supersedesFactId: 'f1', reason: null },
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await correctMemory('http://api/', 'm1', {
      text: 'B.',
      expectedCurrentFactId: 'f1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://api/memories/m1/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'B.', expectedCurrentFactId: 'f1' }),
    });
    expect(result.current.factId).toBe('f2');
  });

  it('preserves STALE_CORRECTION and does not retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        {
          error: {
            code: 'STALE_CORRECTION',
            message: 'A lembrança mudou desde a última consulta.',
            requestId: 'r1',
          },
        },
        409,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      correctMemory('http://api', 'm1', { text: 'B.', expectedCurrentFactId: 'f1' }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<MemoryApiError>>({
        status: 409,
        code: 'STALE_CORRECTION',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads and validates history exactly once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        memoryId: 'm1',
        versions: [
          {
            factId: 'f1',
            evidenceId: 'e1',
            content: 'A.',
            createdAt: '2026-08-16T09:00:00.000Z',
            reason: null,
            isOriginal: true,
            isCurrent: true,
            supersedesFactId: null,
            eventId: 'ev1',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getMemoryHistory('http://api/', 'm1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://api/memories/m1/history');
    expect(result).toMatchObject({ memoryId: 'm1' });
  });
});
