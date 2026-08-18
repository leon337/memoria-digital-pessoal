import type {
  SyncBootstrapPageResponse,
  SyncBootstrapStartResponse,
  SyncEventEnvelope,
  SyncPullResponse,
  SyncPushEventResult,
} from '@mdp/contracts';

export const SYNC_STORE = Symbol('SYNC_STORE');

export type SyncStoreErrorCode =
  'SYNC_CURSOR_EXPIRED' | 'SYNC_INTEGRITY_VIOLATION' | 'SYNC_BOOTSTRAP_EXPIRED';

export class SyncStoreError extends Error {
  constructor(readonly code: SyncStoreErrorCode) {
    super(code);
    this.name = 'SyncStoreError';
  }
}

export interface SyncStore {
  pushEvent(clientInstanceId: string, envelope: SyncEventEnvelope): Promise<SyncPushEventResult>;
  pull(after: string, limit: number): Promise<SyncPullResponse>;
  startBootstrap(clientInstanceId: string): Promise<SyncBootstrapStartResponse>;
  readBootstrapPage(
    bootstrapToken: string,
    offset: number,
    limit: number,
  ): Promise<SyncBootstrapPageResponse>;
}
