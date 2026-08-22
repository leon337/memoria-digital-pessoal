import {
  CORRECTION_REASON_MAX_LENGTH,
  MEMORY_TEXT_MAX_LENGTH,
  type MemoryQueryResponse,
} from '@mdp/contracts';
import { useState, type FormEvent } from 'react';
import { MemoryRepositoryError, type MemoryRepository } from '../../lib/memory-repository.js';

type Conflict = Extract<MemoryQueryResponse, { status: 'CONFLICT' }>['conflict'];
type FoundResult = Extract<MemoryQueryResponse, { status: 'FOUND' }>;

interface ConflictResolutionPanelProps {
  repository: MemoryRepository;
  conflict: Conflict;
  onResolved: (result: FoundResult) => void;
}

export function ConflictResolutionPanel({
  repository,
  conflict,
  onResolved,
}: ConflictResolutionPanelProps) {
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedText = text.trim();
    if (normalizedText.length === 0) {
      setError('Escolha uma versão ou escreva uma nova versão confirmada.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const normalizedReason = reason.trim();
      const response = await repository.resolveConflict(conflict.memoryId, {
        expectedCandidateFactIds: conflict.candidates.map((candidate) => candidate.factId),
        text: normalizedText,
        ...(normalizedReason.length === 0 ? {} : { reason: normalizedReason }),
      });
      onResolved({
        status: 'FOUND',
        answer: response.current.content,
        provenance: {
          memoryId: response.memoryId,
          evidenceId: response.current.evidenceId,
          factId: response.current.factId,
        },
      });
    } catch (caught) {
      if (
        caught instanceof MemoryRepositoryError &&
        caught.code === 'CONFLICT_REQUIRES_RESOLUTION'
      ) {
        setError('O conflito mudou. Consulte novamente antes de resolver.');
      } else if (
        caught instanceof MemoryRepositoryError &&
        caught.code === 'LOCAL_STORAGE_UNAVAILABLE'
      ) {
        setError('Não foi possível resolver porque o armazenamento local está indisponível.');
      } else if (
        caught instanceof MemoryRepositoryError &&
        caught.code === 'LOCAL_DATA_INTEGRITY_ERROR'
      ) {
        setError('Não foi possível validar o conflito armazenado localmente.');
      } else {
        setError('Não foi possível resolver o conflito agora.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="conflict-panel" aria-labelledby="conflict-title">
      <h3 id="conflict-title">Conflito na lembrança</h3>
      <p>Versão de referência: {conflict.baseline.content}</p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving}>
          <legend>Versões preservadas</legend>
          {conflict.candidates.map((candidate) => (
            <label key={candidate.factId}>
              <input
                type="radio"
                name="conflictCandidate"
                value={candidate.factId}
                onChange={() => setText(candidate.content)}
              />
              {candidate.content}
            </label>
          ))}
        </fieldset>

        <label htmlFor="conflict-resolution-text">Nova versão confirmada</label>
        <textarea
          id="conflict-resolution-text"
          rows={5}
          maxLength={MEMORY_TEXT_MAX_LENGTH}
          value={text}
          disabled={saving}
          onChange={(event) => setText(event.target.value)}
        />

        <label htmlFor="conflict-resolution-reason">Motivo (opcional)</label>
        <input
          id="conflict-resolution-reason"
          maxLength={CORRECTION_REASON_MAX_LENGTH}
          value={reason}
          disabled={saving}
          onChange={(event) => setReason(event.target.value)}
        />

        <button type="submit" disabled={saving}>
          {saving ? 'Resolvendo…' : 'Resolver conflito'}
        </button>
      </form>
      {error ? (
        <p role="alert" className="feedback">
          {error}
        </p>
      ) : null}
    </section>
  );
}
