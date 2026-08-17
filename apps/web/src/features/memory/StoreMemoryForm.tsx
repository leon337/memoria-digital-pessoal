import { MEMORY_TEXT_MAX_LENGTH } from '@mdp/contracts';
import { useState, type FormEvent } from 'react';
import { createMemory } from '../../lib/memory-api.js';

export function StoreMemoryForm({ apiBaseUrl, enabled }: { apiBaseUrl: string; enabled: boolean }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<
    { kind: 'success'; text: string } | { kind: 'error'; text: string } | null
  >(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    if (!enabled || text.trim().length === 0) {
      setMessage({ kind: 'error', text: 'Digite uma lembrança antes de guardar.' });
      return;
    }

    setSaving(true);
    try {
      await createMemory(apiBaseUrl, text);
      setText('');
      setMessage({ kind: 'success', text: 'Lembrança guardada.' });
    } catch {
      setMessage({
        kind: 'error',
        text: 'Não foi possível guardar a lembrança. Tente novamente quando o serviço estiver disponível.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="memory-card" aria-labelledby="store-memory-title">
      <h2 id="store-memory-title">Guardar uma lembrança</h2>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="memory-text">Lembrança</label>
        <textarea
          id="memory-text"
          name="memoryText"
          rows={6}
          maxLength={MEMORY_TEXT_MAX_LENGTH}
          value={text}
          disabled={!enabled || saving}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="field-hint">Até {MEMORY_TEXT_MAX_LENGTH} caracteres.</p>
        <button type="submit" disabled={!enabled || saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
      {message?.kind === 'success' ? (
        <p role="status" aria-live="polite" className="feedback">
          {message.text}
        </p>
      ) : null}
      {message?.kind === 'error' ? (
        <p role="alert" className="feedback">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
