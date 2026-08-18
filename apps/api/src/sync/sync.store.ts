import type { SyncEventEnvelope, SyncPushEventResult } from '@mdp/contracts';

export const SYNC_STORE = Symbol('SYNC_STORE');

export interface SyncStore {
  pushEvent(clientInstanceId: string, envelope: SyncEventEnvelope): Promise<SyncPushEventResult>;
}
