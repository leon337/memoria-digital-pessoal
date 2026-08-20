import type { SyncPushRequest } from '@mdp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { SyncApiClient, SyncApiError } from './sync-api.js';

const clientInstanceId = '0198d200-0000-7000-8000-000000000001';
const memoryId = '0198d200-0000-7000-8000-000000000002';
const evidenceId = '0198d200-0000-7000-8000-000000000003';
const eventId = '0198d200-0000-7000-8000-000000000004';
const factId = '0198d200-0000-7000-8000-000000000005';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const pushRequest: SyncPushRequest = {
  protocolVersion: 1,
  clientInstanceId,
  events: [
    {
      protocolVersion: 1,
      eventId,
      eventType: 'MEMORY_CREATED',
      memoryId,
      predecessorFactIds: [],
      records: [
        {
          kind: 'memory',
          id: memoryId,
          recordedAt: '2026-08-20T09:30:00.000Z',
          occurredAt: null,
          temporalPrecision: 'unknown',
        },
        {
          kind: 'evidence',
          id: evidenceId,
          memoryId,
          evidenceKind: 'text',
          content: 'Registro sintético.',
          createdAt: '2026-08-20T09:30:00.000Z',
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
          createdAt: '2026-08-20T09:30:00.000Z',
        },
        {
          kind: 'fact',
          id: factId,
          memoryId,
          evidenceId,
          factKind: 'autobiographical_statement',
          content: 'Registro sintético.',
          createdAt: '2026-08-20T09:30:00.000Z',
        },
      ],
    },
  ],
};

describe('SyncApiClient', () => {
  it('serializes push without cache and validates the response contract', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ protocolVersion: 1, results: [{ eventId, status: 'APPLIED' }] }),
      );
    const client = new SyncApiClient('http://127.0.0.1:3000/', fetchFn);

    await expect(client.push(pushRequest)).resolves.toEqual({
      protocolVersion: 1,
      results: [{ eventId, status: 'APPLIED' }],
    });
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:3000/sync/v1/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushRequest),
      cache: 'no-store',
    });
  });

  it('serializes pull and bootstrap URLs deterministically', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ protocolVersion: 1, events: [], nextCursor: '7', hasMore: false }),
      )
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          bootstrapToken: '0198d200-0000-7000-8000-000000000006',
          highWatermarkCursor: '7',
          totalRecords: 0,
        }),
      )
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          bootstrapToken: '0198d200-0000-7000-8000-000000000006',
          records: [],
          nextOffset: null,
        }),
      );
    const client = new SyncApiClient('http://127.0.0.1:3000', fetchFn);

    await client.pull('7', 50);
    await client.startBootstrap({ protocolVersion: 1, clientInstanceId });
    await client.readBootstrapPage('0198d200-0000-7000-8000-000000000006', 0, 50);

    expect(fetchFn.mock.calls[0]).toEqual([
      'http://127.0.0.1:3000/sync/v1/pull?after=7&limit=50',
      { cache: 'no-store' },
    ]);
    expect(fetchFn.mock.calls[1]).toEqual([
      'http://127.0.0.1:3000/sync/v1/bootstrap/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 1, clientInstanceId }),
        cache: 'no-store',
      },
    ]);
    expect(fetchFn.mock.calls[2]).toEqual([
      'http://127.0.0.1:3000/sync/v1/bootstrap/0198d200-0000-7000-8000-000000000006?offset=0&limit=50',
      { cache: 'no-store' },
    ]);
  });

  it('maps structured sync HTTP errors without leaking an untrusted body', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          error: {
            code: 'SYNC_SERVICE_UNAVAILABLE',
            message: 'Synchronization service unavailable',
            requestId: 'request-1',
          },
        },
        503,
      ),
    );
    const client = new SyncApiClient('http://127.0.0.1:3000', fetchFn);

    await expect(client.pull('0', 50)).rejects.toMatchObject({
      name: 'SyncApiError',
      status: 503,
      code: 'SYNC_SERVICE_UNAVAILABLE',
      message: 'Synchronization service unavailable',
    } satisfies Partial<SyncApiError>);
  });

  it('uses a safe generic error for malformed error responses', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>database details</html>', { status: 503 }));
    const client = new SyncApiClient('http://127.0.0.1:3000', fetchFn);

    await expect(client.pull('0', 50)).rejects.toMatchObject({
      status: 503,
      code: null,
      message: 'Synchronization request failed',
    });
  });
});
