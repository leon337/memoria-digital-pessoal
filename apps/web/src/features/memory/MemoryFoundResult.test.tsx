import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRepositoryError, type MemoryRepository } from '../../lib/memory-repository.js';
import { MemoryFoundResult } from './MemoryFoundResult.js';

const found = {
  status: 'FOUND' as const,
  answer: 'Minha irmã se chama Ana.',
  provenance: {
    memoryId: 'memory-1',
    evidenceId: 'evidence-1',
    factId: 'fact-1',
  },
};

function repository(): MemoryRepository {
  return {
    ready: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    query: vi.fn(),
    correct: vi.fn(),
    resolveConflict: vi.fn(),
    history: vi.fn(),
  };
}

describe('MemoryFoundResult', () => {
  it('corrects through the local repository and publishes the new current result', async () => {
    const user = userEvent.setup();
    const local = repository();
    const onCurrentChange = vi.fn();
    vi.mocked(local.correct).mockResolvedValue({
      memoryId: 'memory-1',
      current: {
        factId: 'fact-2',
        evidenceId: 'evidence-2',
        content: 'Minha irmã se chama Beatriz.',
        recordedAt: '2026-08-16T09:00:00.000Z',
        correctedAt: '2026-08-17T05:00:00.000Z',
      },
      correction: {
        eventId: 'event-2',
        supersedesFactId: 'fact-1',
        reason: 'Correção factual',
      },
    });

    render(
      <MemoryFoundResult repository={local} result={found} onCurrentChange={onCurrentChange} />,
    );

    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    const text = screen.getByLabelText('Texto corrigido');
    await user.clear(text);
    await user.type(text, 'Minha irmã se chama Beatriz.');
    await user.type(screen.getByLabelText('Motivo (opcional)'), 'Correção factual');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(local.correct).toHaveBeenCalledWith('memory-1', {
      text: 'Minha irmã se chama Beatriz.',
      expectedCurrentFactId: 'fact-1',
      reason: 'Correção factual',
    });
    expect(onCurrentChange).toHaveBeenCalledWith({
      status: 'FOUND',
      answer: 'Minha irmã se chama Beatriz.',
      provenance: {
        memoryId: 'memory-1',
        evidenceId: 'evidence-2',
        factId: 'fact-2',
      },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Correção salva');
  });

  it('blocks another correction after a stale local write until a fresh query arrives', async () => {
    const user = userEvent.setup();
    const local = repository();
    vi.mocked(local.correct).mockRejectedValue(new MemoryRepositoryError('STALE_CORRECTION'));

    render(<MemoryFoundResult repository={local} result={found} onCurrentChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    const text = screen.getByLabelText('Texto corrigido');
    await user.clear(text);
    await user.type(text, 'Uma versão concorrente.');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A lembrança mudou');
    expect(screen.queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument();
    expect(local.correct).toHaveBeenCalledTimes(1);
  });

  it('renders local history without technical ids and restores old text as a new correction', async () => {
    const user = userEvent.setup();
    const local = repository();
    const current = {
      ...found,
      answer: 'Versão B.',
      provenance: { ...found.provenance, evidenceId: 'evidence-2', factId: 'fact-2' },
    };
    vi.mocked(local.history).mockResolvedValue({
      memoryId: 'memory-1',
      versions: [
        {
          factId: 'fact-1',
          evidenceId: 'evidence-1',
          content: 'Versão A.',
          createdAt: '2026-08-16T09:00:00.000Z',
          reason: null,
          isOriginal: true,
          isCurrent: false,
          supersedesFactId: null,
          predecessorFactIds: [],
          eventId: 'event-1',
        },
        {
          factId: 'fact-2',
          evidenceId: 'evidence-2',
          content: 'Versão B.',
          createdAt: '2026-08-17T05:00:00.000Z',
          reason: 'Ajuste sintético',
          isOriginal: false,
          isCurrent: true,
          supersedesFactId: 'fact-1',
          predecessorFactIds: ['fact-1'],
          eventId: 'event-2',
        },
      ],
    });
    vi.mocked(local.correct).mockResolvedValue({
      memoryId: 'memory-1',
      current: {
        factId: 'fact-3',
        evidenceId: 'evidence-3',
        content: 'Versão A.',
        recordedAt: '2026-08-16T09:00:00.000Z',
        correctedAt: '2026-08-17T06:00:00.000Z',
      },
      correction: {
        eventId: 'event-3',
        supersedesFactId: 'fact-2',
        reason: null,
      },
    });

    render(<MemoryFoundResult repository={local} result={current} onCurrentChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Ver histórico' }));
    const history = await screen.findByRole('region', { name: 'Histórico da lembrança' });
    const versions = within(history).getAllByRole('listitem');
    expect(versions).toHaveLength(2);
    expect(versions[0]).toHaveTextContent('Versão A.');
    expect(versions[0]).toHaveTextContent('Original');
    expect(versions[1]).toHaveTextContent('Versão B.');
    expect(versions[1]).toHaveTextContent('Atual');
    expect(versions[1]).toHaveTextContent('Ajuste sintético');
    expect(history).not.toHaveTextContent('evidence-1');
    expect(history).not.toHaveTextContent('event-1');
    expect(history).not.toHaveTextContent('fact-1');

    await user.click(
      within(versions[0] as HTMLElement).getByRole('button', {
        name: 'Usar este texto como nova correção',
      }),
    );
    expect(screen.getByLabelText('Texto corrigido')).toHaveValue('Versão A.');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(local.correct).toHaveBeenCalledWith('memory-1', {
      text: 'Versão A.',
      expectedCurrentFactId: 'fact-2',
    });
  });

  it('maps local storage failure to a user-safe correction error', async () => {
    const user = userEvent.setup();
    const local = repository();
    vi.mocked(local.correct).mockRejectedValue(
      new MemoryRepositoryError('LOCAL_STORAGE_UNAVAILABLE'),
    );
    render(<MemoryFoundResult repository={local} result={found} onCurrentChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    const text = screen.getByLabelText('Texto corrigido');
    await user.clear(text);
    await user.type(text, 'Correção sintética segura.');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('armazenamento local');
    expect(screen.queryByText('Correção salva.')).not.toBeInTheDocument();
  });
});
