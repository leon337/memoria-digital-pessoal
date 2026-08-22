import type { SyncEngine, SyncRuntimeStatus } from '../../lib/sync/sync-engine.js';
import { useSyncState } from '../../lib/sync/use-sync-state.js';

function statusText(status: SyncRuntimeStatus): string {
  switch (status) {
    case 'SYNCED':
      return 'Sincronizada';
    case 'PENDING':
      return 'Salva neste dispositivo; aguardando sincronização';
    case 'OFFLINE':
      return 'Offline — salva neste dispositivo';
    case 'SYNCING':
      return 'Sincronizando…';
    case 'BLOCKED':
      return 'Sincronização bloqueada';
    case 'CONFLICT':
      return 'Conflito requer resolução';
    case 'ERROR':
      return 'Não foi possível sincronizar agora';
  }
}

export function SyncStatus({ engine }: { engine: SyncEngine }) {
  const { state, synchronizeNow } = useSyncState(engine);
  const unavailable = state.status === 'SYNCING' || state.status === 'OFFLINE';

  return (
    <section className="sync-status" aria-label="Estado de sincronização">
      <p role="status" aria-live="polite">
        {statusText(state.status)}
      </p>
      <button type="button" disabled={unavailable} onClick={() => void synchronizeNow()}>
        Sincronizar agora
      </button>
    </section>
  );
}
