import {
  CORRECTION_REASON_MAX_LENGTH,
  MEMORY_TEXT_MAX_LENGTH,
  type MemoryHistoryResponse,
  type MemoryQueryResponse,
} from '@mdp/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { correctMemory, getMemoryHistory, MemoryApiError } from '../../lib/memory-api.js';

type FoundResult = Extract<MemoryQueryResponse, { status: 'FOUND' }>;

interface MemoryFoundResultProps {
  apiBaseUrl: string;
  result: FoundResult;
  onCurrentChange: (next: FoundResult) => void;
}

export function MemoryFoundResult({ apiBaseUrl, result, onCurrentChange }: MemoryFoundResultProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(result.answer);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [history, setHistory] = useState<MemoryHistoryResponse | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setText(result.answer);
    setReason('');
    setSaving(false);
    setStale(false);
    setFeedback(null);
    setActionError(null);
    setHistory(null);
    setShowHistory(false);
    setHistoryLoading(false);
    setHistoryError(null);
  }, [result.answer, result.provenance.factId]);

  function startEditing(nextText = result.answer): void {
    setText(nextText);
    setReason('');
    setEditing(true);
    setFeedback(null);
    setActionError(null);
  }

  function cancelEditing(): void {
    setEditing(false);
    setText(result.answer);
    setReason('');
    setActionError(null);
  }

  async function saveCorrection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedText = text.trim();
    if (normalizedText.length === 0) {
      setActionError('Digite o texto corrigido.');
      return;
    }

    setSaving(true);
    setFeedback(null);
    setActionError(null);
    try {
      const normalizedReason = reason.trim();
      const response = await correctMemory(apiBaseUrl, result.provenance.memoryId, {
        text: normalizedText,
        expectedCurrentFactId: result.provenance.factId,
        ...(normalizedReason.length === 0 ? {} : { reason: normalizedReason }),
      });

      setEditing(false);
      setText(response.current.content);
      setReason('');
      setHistory(null);
      setShowHistory(false);
      setFeedback('Correção salva.');
      onCurrentChange({
        status: 'FOUND',
        answer: response.current.content,
        provenance: {
          memoryId: response.memoryId,
          evidenceId: response.current.evidenceId,
          factId: response.current.factId,
        },
      });
    } catch (error) {
      if (error instanceof MemoryApiError && error.code === 'STALE_CORRECTION') {
        setStale(true);
        setEditing(false);
        setActionError(
          'A lembrança mudou desde esta consulta. Consulte novamente antes de corrigir.',
        );
      } else if (error instanceof MemoryApiError && error.code === 'NO_CHANGE') {
        setActionError('A correção não altera o texto atual.');
      } else if (error instanceof MemoryApiError && error.code === 'VALIDATION_FAILED') {
        setActionError('Revise o texto e o motivo da correção.');
      } else {
        setActionError('Não foi possível salvar a correção agora.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(): Promise<void> {
    if (showHistory) {
      setShowHistory(false);
      return;
    }

    setShowHistory(true);
    setHistoryError(null);
    if (history) {
      return;
    }

    setHistoryLoading(true);
    try {
      setHistory(await getMemoryHistory(apiBaseUrl, result.provenance.memoryId));
    } catch {
      setHistoryError('Não foi possível carregar o histórico agora.');
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div className="query-result">
      <p className="recorded-memory">{result.answer}</p>
      <p className="provenance">Fonte: lembrança guardada</p>

      {!stale && !editing ? (
        <div className="memory-actions">
          <button type="button" onClick={() => startEditing()}>
            Corrigir
          </button>
          <button type="button" onClick={() => void openHistory()}>
            {showHistory ? 'Ocultar histórico' : 'Ver histórico'}
          </button>
        </div>
      ) : null}

      {editing ? (
        <form className="correction-form" onSubmit={(event) => void saveCorrection(event)}>
          <label htmlFor="memory-correction-text">Texto corrigido</label>
          <textarea
            id="memory-correction-text"
            rows={5}
            maxLength={MEMORY_TEXT_MAX_LENGTH}
            value={text}
            disabled={saving}
            onChange={(event) => setText(event.target.value)}
          />

          <label htmlFor="memory-correction-reason">Motivo (opcional)</label>
          <input
            id="memory-correction-reason"
            maxLength={CORRECTION_REASON_MAX_LENGTH}
            value={reason}
            disabled={saving}
            onChange={(event) => setReason(event.target.value)}
          />

          <div className="memory-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar correção'}
            </button>
            <button type="button" disabled={saving} onClick={cancelEditing}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {feedback ? (
        <p role="status" aria-live="polite" className="feedback">
          {feedback}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="feedback">
          {actionError}
        </p>
      ) : null}

      {showHistory ? (
        <section className="memory-history" aria-label="Histórico da lembrança">
          <h3>Histórico</h3>
          {historyLoading ? <p className="feedback">Carregando histórico…</p> : null}
          {historyError ? (
            <p role="alert" className="feedback">
              {historyError}
            </p>
          ) : null}
          {history ? (
            <ol className="history-list">
              {history.versions.map((version) => (
                <li key={version.factId} className="history-version">
                  <div className="history-version-heading">
                    <strong>
                      {version.isOriginal ? 'Original' : 'Correção'}
                      {version.isCurrent ? ' · Atual' : ''}
                    </strong>
                    <time dateTime={version.createdAt}>{version.createdAt}</time>
                  </div>
                  <p>{version.content}</p>
                  {version.reason ? <p>Motivo: {version.reason}</p> : null}
                  <p className="provenance">
                    Evidência: {version.evidenceId} · Evento: {version.eventId}
                  </p>
                  {!version.isCurrent && !stale ? (
                    <button type="button" onClick={() => startEditing(version.content)}>
                      Usar este texto como nova correção
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
