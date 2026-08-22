import { MEMORY_TEXT_MAX_LENGTH } from '@mdp/contracts';
import { useState, type FormEvent } from 'react';
import { MemoryRepositoryError, type MemoryRepository } from '../../lib/memory-repository.js';

export function StoreMemoryForm({
  repository,
  enabled,
}: {
  repository: MemoryRepository;
  enabled: boolean;
}) {
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
      await repository.create(text);
      setText('');
      setMessage({
        kind: 'success',
        text: 'Salva neste dispositivo. A sincronização ocorrerá quando disponível.',
      });
    } catch (error) {
      if (error instanceof MemoryRepositoryError && error.code === 'LOCAL_STORAGE_UNAVAILABLE') {
        setMessage({
          kind: 'error',
          text: 'Não foi possível guardar a lembrança porque o armazenamento local está indisponível.',
        });
      } else if (error instanceof MemoryRepositoryError && error.code === 'VALIDATION_FAILED') {
        setMessage({ kind: 'error', text: 'Revise o texto da lembrança antes de guardar.' });
      } else {
        setMessage({
          kind: 'error',
          text: 'Não foi possível guardar a lembrança no armazenamento local.',
        });
      }
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
