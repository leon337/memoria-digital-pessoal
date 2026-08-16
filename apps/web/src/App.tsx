import { useEffect, useState } from 'react';
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

  return (
    <main>
      <h1>Memória Digital Pessoal</h1>
      <p>FOUNDATION técnica</p>
      <p role="status" aria-live="polite">
        {text}
      </p>
    </main>
  );
}
