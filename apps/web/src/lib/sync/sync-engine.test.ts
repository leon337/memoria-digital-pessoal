import type {
  SyncBootstrapPageResponse,
  SyncBootstrapStartResponse,
  SyncEventEnvelope,
  SyncPullResponse,
  SyncPushResponse,
} from '@mdp/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { LocalSyncOutboxRecord } from '../indexeddb/mdp-local-db.js';
import { SyncApiError } from './sync-api.js';
import {
  SyncEngine,
  type SyncEngineApi,
  type SyncEngineLocalStore,
  type SyncRuntimeState,
} from './sync-engine.js';

const clientInstanceId = '0198d400-0000-7000-8000-000000000001';
const memoryId = '0198d400-0000-7000-8000-000000000002';
const evidenceId = '0198d400-0000-7000-8000-000000000003';
const eventId = '0198d400-0000-7000-8000-000000000004';
const factId = '0198d400-0000-7000-8000-000000000005';
const bootstrapToken = '0198d400-0000-7000-8000-000000000006';
const replacementBootstrapToken = '0198d400-0000-7000-8000-000000000007';

const envelope: SyncEventEnvelope = {
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
};

const pending: LocalSyncOutboxRecord = {
  eventId,
  memoryId,
  envelope,
  status: 'PENDING',
  attempt: 0,
  nextAttemptAt: null,
  lastErrorCode: null,
};

function emptyPull(nextCursor = '0'): SyncPullResponse {
  return { protocolVersion: 1, events: [], nextCursor, hasMore: false };
}

function bootstrapStart(
  token = bootstrapToken,
  highWatermarkCursor = '5',
): SyncBootstrapStartResponse {
  return {
    protocolVersion: 1,
    bootstrapToken: token,
    highWatermarkCursor,
    totalRecords: 0,
  };
}

function bootstrapPage(token = bootstrapToken): SyncBootstrapPageResponse {
  return { protocolVersion: 1, bootstrapToken: token, records: [], nextOffset: null };
}

function createLocalStore() {
  return {
    getConfirmedCursor: vi.fn<SyncEngineLocalStore['getConfirmedCursor']>().mockResolvedValue('0'),
    getOrCreateClientInstanceId: vi
      .fn<SyncEngineLocalStore['getOrCreateClientInstanceId']>()
      .mockResolvedValue(clientInstanceId),
    listPending: vi.fn<SyncEngineLocalStore['listPending']>().mockResolvedValue([]),
    applyPushResults: vi.fn<SyncEngineLocalStore['applyPushResults']>().mockResolvedValue(undefined),
    applyPullPage: vi.fn<SyncEngineLocalStore['applyPullPage']>().mockResolvedValue(undefined),
    stageBootstrapPage: vi
      .fn<SyncEngineLocalStore['stageBootstrapPage']>()
      .mockResolvedValue(undefined),
    promoteBootstrap: vi.fn<SyncEngineLocalStore['promoteBootstrap']>().mockResolvedValue(undefined),
    discardBootstrap: vi.fn<SyncEngineLocalStore['discardBootstrap']>().mockResolvedValue(undefined),
    getGlobalStatus: vi
      .fn<SyncEngineLocalStore['getGlobalStatus']>()
      .mockResolvedValue('SYNCED'),
  };
}

function createApi() {
  return {
    push: vi
      .fn<SyncEngineApi['push']>()
      .mockResolvedValue({ protocolVersion: 1, results: [] } satisfies SyncPushResponse),
    pull: vi.fn<SyncEngineApi['pull']>().mockResolvedValue(emptyPull()),
    startBootstrap: vi
      .fn<SyncEngineApi['startBootstrap']>()
      .mockResolvedValue(bootstrapStart()),
    readBootstrapPage: vi
      .fn<SyncEngineApi['readBootstrapPage']>()
      .mockResolvedValue(bootstrapPage()),
  };
}

describe('SyncEngine', () => {
  it('does not touch the network while offline and reports OFFLINE', async () => {
    const local = createLocalStore();
    const api = createApi();
    const states: SyncRuntimeState[] = [];
    const engine = new SyncEngine({ local, api, online: () => false });
    engine.subscribe((state) => states.push(state));

    await engine.synchronize('manual');

    expect(api.push).not.toHaveBeenCalled();
    expect(api.pull).not.toHaveBeenCalled();
    expect(api.startBootstrap).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ status: 'OFFLINE' });
  });

  it('bootstraps a null cursor before pulling', async () => {
    const local = createLocalStore();
    local.getConfirmedCursor.mockResolvedValueOnce(null).mockResolvedValue('5');
    const api = createApi();
    api.pull.mockResolvedValue(emptyPull('5'));
    const engine = new SyncEngine({ local, api, online: () => true });

    await engine.synchronize('startup');

    expect(api.startBootstrap).toHaveBeenCalledWith({
      protocolVersion: 1,
      clientInstanceId,
    });
    expect(api.readBootstrapPage).toHaveBeenCalledWith(bootstrapToken, 0, 50);
    expect(local.stageBootstrapPage).toHaveBeenCalledWith(bootstrapToken, []);
    expect(local.promoteBootstrap).toHaveBeenCalledWith(bootstrapToken, '5');
    expect(api.pull).toHaveBeenCalledWith('5', 50);
  });

  it('pushes pending work before pulling and completes after the queue drains', async () => {
    const local = createLocalStore();
    local.listPending.mockResolvedValueOnce([pending]).mockResolvedValue([]);
    local.getConfirmedCursor
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce('0')
      .mockResolvedValue('1');
    const api = createApi();
    api.push.mockResolvedValue({
      protocolVersion: 1,
      results: [{ eventId, status: 'APPLIED' }],
    });
    api.pull.mockResolvedValue(emptyPull('1'));
    const engine = new SyncEngine({ local, api, online: () => true });

    await engine.synchronize('manual');

    expect(api.push).toHaveBeenCalledWith({
      protocolVersion: 1,
      clientInstanceId,
      events: [envelope],
    });
    expect(local.applyPushResults).toHaveBeenCalledWith(
      [{ eventId, status: 'APPLIED' }],
      expect.any(Date),
    );
    expect(api.pull.mock.invocationCallOrder[0]).toBeGreaterThan(api.push.mock.invocationCallOrder[0]!);
    expect(local.getGlobalStatus).toHaveBeenCalledTimes(1);
  });

  it('pulls dependencies and retries a DEPENDENCY_MISSING event on the next round', async () => {
    const local = createLocalStore();
    local.listPending.mockResolvedValueOnce([pending]).mockResolvedValueOnce([pending]).mockResolvedValue([]);
    local.getConfirmedCursor.mockResolvedValue('0');
    const api = createApi();
    api.push
      .mockResolvedValueOnce({
        protocolVersion: 1,
        results: [
          {
            eventId,
            status: 'DEPENDENCY_MISSING',
            missingFactIds: ['0198d400-0000-7000-8000-000000000008'],
          },
        ],
      })
      .mockResolvedValueOnce({
        protocolVersion: 1,
        results: [{ eventId, status: 'APPLIED' }],
      });
    api.pull.mockResolvedValue(emptyPull('0'));
    const engine = new SyncEngine({ local, api, online: () => true });

    await engine.synchronize('manual');

    expect(api.push).toHaveBeenCalledTimes(2);
    expect(api.pull).toHaveBeenCalledTimes(3);
    expect(api.pull.mock.invocationCallOrder[0]).toBeLessThan(api.push.mock.invocationCallOrder[1]!);
  });

  it('rebootstraps safely when the pull cursor expires', async () => {
    const local = createLocalStore();
    local.getConfirmedCursor.mockResolvedValueOnce('2').mockResolvedValue('5');
    const api = createApi();
    api.pull
      .mockRejectedValueOnce(new SyncApiError(410, 'SYNC_CURSOR_EXPIRED', 'cursor expired'))
      .mockResolvedValueOnce(emptyPull('5'));
    const engine = new SyncEngine({ local, api, online: () => true });

    await engine.synchronize('online');

    expect(api.startBootstrap).toHaveBeenCalledTimes(1);
    expect(local.promoteBootstrap).toHaveBeenCalledWith(bootstrapToken, '5');
    expect(api.pull).toHaveBeenLastCalledWith('5', 50);
  });

  it('discards expired bootstrap staging and restarts with a fresh token', async () => {
    const local = createLocalStore();
    local.getConfirmedCursor.mockResolvedValueOnce(null).mockResolvedValue('7');
    const api = createApi();
    api.startBootstrap
      .mockResolvedValueOnce(bootstrapStart(bootstrapToken, '5'))
      .mockResolvedValueOnce(bootstrapStart(replacementBootstrapToken, '7'));
    api.readBootstrapPage
      .mockRejectedValueOnce(
        new SyncApiError(410, 'SYNC_BOOTSTRAP_EXPIRED', 'bootstrap expired'),
      )
      .mockResolvedValueOnce(bootstrapPage(replacementBootstrapToken));
    api.pull.mockResolvedValue(emptyPull('7'));
    const engine = new SyncEngine({ local, api, online: () => true });

    await engine.synchronize('startup');

    expect(local.discardBootstrap).toHaveBeenCalledWith(bootstrapToken);
    expect(api.startBootstrap).toHaveBeenCalledTimes(2);
    expect(local.promoteBootstrap).toHaveBeenCalledWith(replacementBootstrapToken, '7');
  });

  it('coalesces concurrent synchronization requests into one in-flight cycle', async () => {
    const local = createLocalStore();
    let resolvePull!: (response: SyncPullResponse) => void;
    const pullPromise = new Promise<SyncPullResponse>((resolve) => {
      resolvePull = resolve;
    });
    const api = createApi();
    api.pull.mockReturnValue(pullPromise);
    const engine = new SyncEngine({ local, api, online: () => true });

    const first = engine.synchronize('manual');
    const second = engine.synchronize('online');

    expect(second).toBe(first);
    expect(api.pull).toHaveBeenCalledTimes(1);
    resolvePull(emptyPull());
    await first;
  });

  it('bounds foreground retries for transient failures', async () => {
    const local = createLocalStore();
    local.listPending.mockResolvedValue([pending]);
    const api = createApi();
    api.push.mockRejectedValue(
      new SyncApiError(503, 'SYNC_SERVICE_UNAVAILABLE', 'temporarily unavailable'),
    );
    const sleep = vi.fn(async () => undefined);
    const engine = new SyncEngine({
      local,
      api,
      online: () => true,
      sleep,
      random: () => 0.5,
    });

    await expect(engine.synchronize('manual')).rejects.toMatchObject({
      code: 'SYNC_SERVICE_UNAVAILABLE',
    });

    expect(api.push).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([500, 1000, 2000, 4000, 8000]);
  });
});
