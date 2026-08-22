import {
  syncErrorCodeSchema,
  type SyncBootstrapPageResponse,
  type SyncBootstrapStartRequest,
  type SyncBootstrapStartResponse,
  type SyncCanonicalRecord,
  type SyncCursor,
  type SyncErrorCode,
  type SyncPullResponse,
  type SyncPushEventResult,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@mdp/contracts';
import type { LocalMemorySyncStatus } from '../indexeddb/indexeddb-sync-store.js';
import type { LocalSyncOutboxRecord } from '../indexeddb/mdp-local-db.js';
import { MAX_FOREGROUND_RETRIES, classifySyncFailure, computeRetryDelay } from './retry.js';

export type SyncReason = 'startup' | 'online' | 'manual';

export type SyncRuntimeStatus = LocalMemorySyncStatus | 'OFFLINE' | 'SYNCING' | 'ERROR';

export interface SyncRuntimeState {
  status: SyncRuntimeStatus;
  reason?: SyncReason;
  errorCode?: SyncErrorCode | null;
}

export interface SyncEngineApi {
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
  pull(after: SyncCursor, limit: number): Promise<SyncPullResponse>;
  startBootstrap(request: SyncBootstrapStartRequest): Promise<SyncBootstrapStartResponse>;
  readBootstrapPage(
    bootstrapToken: string,
    offset: number,
    limit: number,
  ): Promise<SyncBootstrapPageResponse>;
}

export interface SyncEngineLocalStore {
  getConfirmedCursor(): Promise<SyncCursor | null>;
  getOrCreateClientInstanceId(): Promise<string>;
  listPending(limit: number, now: Date): Promise<LocalSyncOutboxRecord[]>;
  applyPushResults(results: SyncPushEventResult[], now: Date): Promise<void>;
  applyPullPage(page: SyncPullResponse): Promise<void>;
  stageBootstrapPage(bootstrapToken: string, records: SyncCanonicalRecord[]): Promise<void>;
  discardBootstrap(bootstrapToken: string): Promise<void>;
  promoteBootstrap(bootstrapToken: string, watermark: SyncCursor): Promise<void>;
  getGlobalStatus(): Promise<LocalMemorySyncStatus>;
}

interface SyncEngineDependencies {
  local: SyncEngineLocalStore;
  api: SyncEngineApi;
  online?: () => boolean;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
  batchSize?: number;
}

const MAX_SYNC_ROUNDS = 20;
const MAX_BOOTSTRAP_RESTARTS = 3;

function defaultOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function errorCode(error: unknown): SyncErrorCode | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const parsed = syncErrorCodeSchema.safeParse((error as { code?: unknown }).code);
  return parsed.success ? parsed.data : null;
}

export class SyncEngine {
  private readonly local: SyncEngineLocalStore;
  private readonly api: SyncEngineApi;
  private readonly online: () => boolean;
  private readonly now: () => Date;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly random: () => number;
  private readonly batchSize: number;
  private readonly listeners = new Set<(state: SyncRuntimeState) => void>();
  private state: SyncRuntimeState;
  private inFlight: Promise<void> | null = null;

  constructor(dependencies: SyncEngineDependencies) {
    this.local = dependencies.local;
    this.api = dependencies.api;
    this.online = dependencies.online ?? defaultOnline;
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.random = dependencies.random ?? Math.random;
    this.batchSize = Math.max(1, Math.floor(dependencies.batchSize ?? 50));
    this.state = { status: this.online() ? 'PENDING' : 'OFFLINE' };
  }

  subscribe(listener: (state: SyncRuntimeState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncRuntimeState {
    return this.state;
  }

  synchronize(reason: SyncReason): Promise<void> {
    if (!this.online()) {
      this.emit({ status: 'OFFLINE' });
      return Promise.resolve();
    }
    if (this.inFlight) return this.inFlight;

    const task = this.runCycle(reason)
      .catch((error: unknown) => {
        this.emit({ status: 'ERROR', reason, errorCode: errorCode(error) });
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = task;
    return task;
  }

  private async runCycle(reason: SyncReason): Promise<void> {
    this.emit({ status: 'SYNCING', reason });

    if ((await this.local.getConfirmedCursor()) === null) {
      await this.bootstrap();
    }

    for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
      const pending = await this.local.listPending(this.batchSize, this.now());
      if (pending.length > 0) {
        const clientInstanceId = await this.local.getOrCreateClientInstanceId();
        const response = await this.withRetry(() =>
          this.api.push({
            protocolVersion: 1,
            clientInstanceId,
            events: pending.map((row) => row.envelope),
          }),
        );
        await this.local.applyPushResults(response.results, this.now());
      }

      let cursor = await this.local.getConfirmedCursor();
      if (cursor === null) {
        await this.bootstrap();
        cursor = await this.local.getConfirmedCursor();
        if (cursor === null) throw new Error('Bootstrap did not establish a confirmed cursor');
      }

      let pull: SyncPullResponse;
      try {
        pull = await this.withRetry(() => this.api.pull(cursor, this.batchSize));
      } catch (error) {
        if (errorCode(error) === 'SYNC_CURSOR_EXPIRED') {
          await this.bootstrap();
          continue;
        }
        throw error;
      }

      await this.local.applyPullPage(pull);
      if (!pull.hasMore && pending.length === 0) {
        this.emit({ status: await this.local.getGlobalStatus() });
        return;
      }
    }

    throw new Error('Synchronization round limit exceeded');
  }

  private async bootstrap(): Promise<void> {
    const clientInstanceId = await this.local.getOrCreateClientInstanceId();

    for (let restart = 0; restart <= MAX_BOOTSTRAP_RESTARTS; restart += 1) {
      const start = await this.withRetry(() =>
        this.api.startBootstrap({ protocolVersion: 1, clientInstanceId }),
      );

      try {
        let offset: number | null = 0;
        while (offset !== null) {
          const page = await this.withRetry(() =>
            this.api.readBootstrapPage(start.bootstrapToken, offset!, this.batchSize),
          );
          await this.local.stageBootstrapPage(start.bootstrapToken, page.records);
          offset = page.nextOffset;
        }
        await this.local.promoteBootstrap(start.bootstrapToken, start.highWatermarkCursor);
        return;
      } catch (error) {
        if (errorCode(error) !== 'SYNC_BOOTSTRAP_EXPIRED') throw error;
        await this.local.discardBootstrap(start.bootstrapToken);
        if (restart === MAX_BOOTSTRAP_RESTARTS) throw error;
      }
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let retry = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (classifySyncFailure(error) !== 'TRANSIENT' || retry >= MAX_FOREGROUND_RETRIES) {
          throw error;
        }
        await this.sleep(computeRetryDelay(retry, this.random));
        retry += 1;
      }
    }
  }

  private emit(state: SyncRuntimeState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
