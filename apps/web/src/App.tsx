import { useEffect, useState } from 'react';
import { QueryMemoryForm } from './features/memory/QueryMemoryForm.js';
import { StoreMemoryForm } from './features/memory/StoreMemoryForm.js';
import { PwaUpdateNotice } from './features/pwa/PwaUpdateNotice.js';
import { SyncStatus } from './features/sync/SyncStatus.js';
import type { MemoryRepository } from './lib/memory-repository.js';
import type { SyncEngine } from './lib/sync/sync-engine.js';
import { useConnectivity } from './lib/use-connectivity.js';

interface AppProps {
  repository: MemoryRepository;
  syncEngine?: SyncEngine;
}

export function App({ repository, syncEngine }: AppProps) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const connectivity = useConnectivity();

  useEffect(() => {
    let active = true;
    setStatus('checking');
    void repository.ready().then(
      () => {
        if (active) setStatus('ready');
      },
      () => {
        if (active) setStatus('unavailable');
      },
    );
    return () => {
      active = false;
    };
  }, [repository]);

  useEffect(() => {
    if (!syncEngine) return;
    if (navigator.onLine) void syncEngine.synchronize('startup').catch(() => undefined);
    const onOnline = () => void syncEngine.synchronize('online').catch(() => undefined);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncEngine]);

  const readinessText =
    status === 'checking'
      ? 'Preparando armazenamento local…'
      : status === 'ready'
        ? 'Armazenamento local pronto'
        : 'Armazenamento local indisponível';
  const enabled = status === 'ready';

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Memória Digital Pessoal</h1>
        <p>Guarde uma lembrança e encontre depois as palavras que foram registradas.</p>
        <aside className="lab-warning" aria-label="Ambiente de laboratório">
          <strong>Ambiente de laboratório.</strong> Use somente dados sintéticos. Não registre dados
          pessoais ou lembranças reais nesta versão.
        </aside>
        <p role="status" aria-live="polite" className="api-status">
          {readinessText}
        </p>
        <p className="connectivity-status" aria-live="polite">
          {connectivity === 'online' ? 'Online' : 'Offline'}
        </p>
      </header>

      <PwaUpdateNotice />
      {syncEngine ? <SyncStatus engine={syncEngine} /> : null}

      <div className="memory-grid">
        <StoreMemoryForm repository={repository} enabled={enabled} />
        <QueryMemoryForm repository={repository} enabled={enabled} />
      </div>
    </main>
  );
}
