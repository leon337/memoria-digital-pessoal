import {
  SYNC_PROTOCOL_VERSION,
  syncBootstrapStartRequestSchema,
  syncCursorSchema,
  syncPushRequestSchema,
  type SyncBootstrapPageResponse,
  type SyncBootstrapStartResponse,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@mdp/contracts';
import { z } from 'zod';
import { SyncStoreError, type SyncStore } from './sync.store.js';

export const SYNC_SERVICE = Symbol('SYNC_SERVICE');

export type SyncServiceErrorCode =
  | 'VALIDATION_FAILED'
  | 'SYNC_PROTOCOL_UNSUPPORTED'
  | 'SYNC_BLOCKED'
  | 'SYNC_SERVICE_UNAVAILABLE';

export class SyncServiceError extends Error {
  constructor(readonly code: SyncServiceErrorCode) {
    super(code);
    this.name = 'SyncServiceError';
  }
}

const pullQuerySchema = z.object({
  after: syncCursorSchema,
  limit: z.coerce.number().int().positive(),
});

const bootstrapPageQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().positive(),
});

function rejectUnsupportedProtocol(input: unknown): void {
  if (!input || typeof input !== 'object' || !('protocolVersion' in input)) {
    return;
  }
  if ((input as { protocolVersion?: unknown }).protocolVersion !== SYNC_PROTOCOL_VERSION) {
    throw new SyncServiceError('SYNC_PROTOCOL_UNSUPPORTED');
  }
}

export class SyncService {
  constructor(
    private readonly store: SyncStore,
    private readonly maxBatch: number,
  ) {}

  async push(input: unknown): Promise<SyncPushResponse> {
    rejectUnsupportedProtocol(input);
    const parsed = syncPushRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new SyncServiceError('VALIDATION_FAILED');
    }
    if (parsed.data.events.length > this.maxBatch) {
      throw new SyncServiceError('SYNC_BLOCKED');
    }

    return this.mapStoreFailure(async () => {
      const results = [];
      for (const event of parsed.data.events) {
        results.push(await this.store.pushEvent(parsed.data.clientInstanceId, event));
      }
      return { protocolVersion: SYNC_PROTOCOL_VERSION, results };
    });
  }

  async startBootstrap(input: unknown): Promise<SyncBootstrapStartResponse> {
    rejectUnsupportedProtocol(input);
    const parsed = syncBootstrapStartRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new SyncServiceError('VALIDATION_FAILED');
    }
    return this.mapStoreFailure(() => this.store.startBootstrap(parsed.data.clientInstanceId));
  }

  async bootstrapPage(
    bootstrapToken: string,
    query: unknown,
  ): Promise<SyncBootstrapPageResponse> {
    const parsed = bootstrapPageQuerySchema.safeParse(query);
    if (!z.string().uuid().safeParse(bootstrapToken).success || !parsed.success) {
      throw new SyncServiceError('VALIDATION_FAILED');
    }
    if (parsed.data.limit > this.maxBatch) {
      throw new SyncServiceError('SYNC_BLOCKED');
    }
    return this.mapStoreFailure(() =>
      this.store.readBootstrapPage(bootstrapToken, parsed.data.offset, parsed.data.limit),
    );
  }

  async pull(query: unknown): Promise<SyncPullResponse> {
    const parsed = pullQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new SyncServiceError('VALIDATION_FAILED');
    }
    if (parsed.data.limit > this.maxBatch) {
      throw new SyncServiceError('SYNC_BLOCKED');
    }
    return this.mapStoreFailure(() => this.store.pull(parsed.data.after, parsed.data.limit));
  }

  private async mapStoreFailure<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SyncStoreError || error instanceof SyncServiceError) {
        throw error;
      }
      throw new SyncServiceError('SYNC_SERVICE_UNAVAILABLE');
    }
  }
}
