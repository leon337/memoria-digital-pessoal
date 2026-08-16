import { MEMORY_QUERY_MAX_LENGTH, type MemoryQueryResponse } from '@mdp/contracts';
import { useState, type FormEvent } from 'react';
import { queryMemory } from '../../lib/memory-api.js';

export function QueryMemoryForm({ apiBaseUrl, enabled }: { apiBaseUrl: string; enabled: boolean }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MemoryQueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setResult(null);
    setError(null);
    const normalized = query.trim();
    if (!enabled || normalized.length === 0) {
      setError('Digite uma palavra ou frase para consultar.');
      return;
    }

    setLoading(true);
    try {
      setResult(await queryMemory(apiBaseUrl, normalized));
    } catch {
      setError('Não foi possível consultar as lembranças agora.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="memory-card" aria-labelledby="query-memory-title">
      <h2 id="query-memory-title">Consultar minhas lembranças</h2>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="memory-query">Palavra ou frase</label>
        <input
          id="memory-query"
          name="memoryQuery"
          type="search"
          maxLength={MEMORY_QUERY_MAX_LENGTH}
          value={query}
          disabled={!enabled || loading}
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby="memory-query-help"
        />
        <p id="memory-query-help" className="field-hint">
          A busca desta versão procura palavras ou frases exatamente registradas.
        </p>
        <button type="submit" disabled={!enabled || loading}>
          {loading ? 'Consultando…' : 'Consultar lembranças'}
        </button>
      </form>

      {result?.status === 'FOUND' ? (
        <div role="status" aria-live="polite" className="query-result">
          <p className="recorded-memory">{result.answer}</p>
          <p className="provenance">
            Fonte registrada · memória {result.provenance.memoryId} · evidência{' '}
            {result.provenance.evidenceId}
          </p>
        </div>
      ) : null}
      {result?.status === 'UNKNOWN' ? (
        <p role="status" aria-live="polite" className="feedback">
          Não encontrei uma lembrança com essas palavras.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="feedback">
          {error}
        </p>
      ) : null}
    </section>
  );
}
