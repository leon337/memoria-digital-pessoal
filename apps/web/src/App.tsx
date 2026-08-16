import { useEffect, useState } from 'react';
import { QueryMemoryForm } from './features/memory/QueryMemoryForm.js';
import { StoreMemoryForm } from './features/memory/StoreMemoryForm.js';
import { getApiReadiness } from './lib/api-health.js';

export function App({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');

  useEffect(() => {
    void getApiReadiness(apiBaseUrl).then(setStatus);
  }, [apiBaseUrl]);

  const text =
    status === 'checking'
      ? 'Verificando API…'
      : status === 'ready'
        ? 'API pronta'
        : 'API indisponível';
  const enabled = status === 'ready';

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Memória Digital Pessoal</h1>
        <p>Guarde uma lembrança e encontre depois as palavras que foram registradas.</p>
        <p role="status" aria-live="polite" className="api-status">
          {text}
        </p>
      </header>

      <div className="memory-grid">
        <StoreMemoryForm apiBaseUrl={apiBaseUrl} enabled={enabled} />
        <QueryMemoryForm apiBaseUrl={apiBaseUrl} enabled={enabled} />
      </div>
    </main>
  );
}
