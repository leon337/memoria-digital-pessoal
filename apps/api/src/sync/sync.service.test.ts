import type { SyncEventEnvelope } from '@mdp/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncService, SyncServiceError } from './sync.service.js';
import { SyncStoreError, type SyncStore } from './sync.store.js';

const clientInstanceId = '0198c000-0000-7000-8000-000000000001';
const memoryId = '0198c000-0000-7000-8000-000000000002';
const evidenceId = '0198c000-0000-7000-8000-000000000003';
const eventId = '0198c000-0000-7000-8000-000000000004';
const factId = '0198c000-0000-7000-8000-000000000005';
const bootstrapToken = '0198c000-0000-7000-8000-000000000006';

function createEnvelope(): SyncEventEnvelope {
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

let service: SyncService;

beforeEach(() => {
  store.pushEvent.mockReset();
  store.pull.mockReset();
  store.startBootstrap.mockReset();
  store.readBootstrapPage.mockReset();
  service = new SyncService(store as unknown as SyncStore, 50);
});

describe('SyncService', () => {
  it('rejects an unsupported protocol version explicitly', async () => {
    await expect(
      service.push({ protocolVersion: 999, clientInstanceId, events: [createEnvelope()] }),
    ).rejects.toMatchObject({ code: 'SYNC_PROTOCOL_UNSUPPORTED' });
    expect(store.pushEvent).not.toHaveBeenCalled();
  });

  it('returns one stable result for every pushed event', async () => {
    store.pushEvent.mockResolvedValue({ eventId, status: 'APPLIED' });

    await expect(
      service.push({ protocolVersion: 1, clientInstanceId, events: [createEnvelope()] }),
    ).resolves.toEqual({
      protocolVersion: 1,
      results: [{ eventId, status: 'APPLIED' }],
    });
    expect(store.pushEvent).toHaveBeenCalledWith(clientInstanceId, createEnvelope());
  });

  it('blocks push and pull requests above the configured batch size', async () => {
    const events = Array.from({ length: 51 }, () => createEnvelope());
    await expect(service.push({ protocolVersion: 1, clientInstanceId, events })).rejects.toEqual(
      expect.objectContaining<Partial<SyncServiceError>>({ code: 'SYNC_BLOCKED' }),
    );
    await expect(service.pull({ after: '0', limit: '51' })).rejects.toMatchObject({
      code: 'SYNC_BLOCKED',
    });
    expect(store.pushEvent).not.toHaveBeenCalled();
    expect(store.pull).not.toHaveBeenCalled();
  });

  it('preserves cursor and bootstrap expiry codes from the store', async () => {
    store.pull.mockRejectedValueOnce(new SyncStoreError('SYNC_CURSOR_EXPIRED'));
    await expect(service.pull({ after: '0', limit: '10' })).rejects.toMatchObject({
      code: 'SYNC_CURSOR_EXPIRED',
    });

    store.readBootstrapPage.mockRejectedValueOnce(new SyncStoreError('SYNC_BOOTSTRAP_EXPIRED'));
    await expect(
      service.bootstrapPage(bootstrapToken, { offset: '0', limit: '10' }),
    ).rejects.toMatchObject({ code: 'SYNC_BOOTSTRAP_EXPIRED' });
  });

  it('maps an unexpected persistence failure to service unavailable', async () => {
    store.pull.mockRejectedValueOnce(new Error('secret SQL and synthetic payload'));
    await expect(service.pull({ after: '0', limit: '10' })).rejects.toMatchObject({
      code: 'SYNC_SERVICE_UNAVAILABLE',
    });
  });
});
