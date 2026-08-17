import { useRegisterSW } from 'virtual:pwa-register/react';

export function PwaUpdateNotice() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offlineReady && !needRefresh) {
    return null;
  }

  function dismiss(): void {
    setOfflineReady(false);
    setNeedRefresh(false);
  }

  return (
    <aside className="pwa-update-notice" aria-label="Estado da aplicação offline">
      <p role="status" aria-live="polite">
        {needRefresh ? 'Nova versão disponível.' : 'Aplicação pronta para uso offline.'}
      </p>
      <div className="memory-actions">
        {needRefresh ? (
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            Atualizar agora
          </button>
        ) : null}
        <button type="button" onClick={dismiss}>
          Agora não
        </button>
      </div>
    </aside>
  );
}
