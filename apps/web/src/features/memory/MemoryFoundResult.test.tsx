import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { correctMemory, getMemoryHistory, MemoryApiError } from '../../lib/memory-api.js';
import { MemoryFoundResult } from './MemoryFoundResult.js';

vi.mock('../../lib/memory-api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/memory-api.js')>('../../lib/memory-api.js');
  return {
    ...actual,
    correctMemory: vi.fn(),
    getMemoryHistory: vi.fn(),
  };
});

const correctMemoryMock = vi.mocked(correctMemory);
const getMemoryHistoryMock = vi.mocked(getMemoryHistory);

const found = {
  status: 'FOUND' as const,
  answer: 'Minha irmã se chama Ana.',
  provenance: {
    memoryId: 'memory-1',
    evidenceId: 'evidence-1',
    factId: 'fact-1',
  },
};

beforeEach(() => {
  correctMemoryMock.mockReset();
  getMemoryHistoryMock.mockReset();
});

describe('MemoryFoundResult', () => {
  it('corrects inline from the displayed current fact and publishes the new current result', async () => {
    const user = userEvent.setup();
    const onCurrentChange = vi.fn();
    correctMemoryMock.mockResolvedValue({
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
      <MemoryFoundResult
        apiBaseUrl="http://api"
        result={found}
        onCurrentChange={onCurrentChange}
      />,
    );

    expect(screen.getByText(found.answer)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corrigir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver histórico' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    const text = screen.getByLabelText('Texto corrigido');
    expect(text).toHaveValue(found.answer);
    await user.clear(text);
    await user.type(text, 'Minha irmã se chama Beatriz.');
    await user.type(screen.getByLabelText('Motivo (opcional)'), 'Correção factual');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(correctMemoryMock).toHaveBeenCalledTimes(1);
    expect(correctMemoryMock).toHaveBeenCalledWith('http://api', 'memory-1', {
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
    expect(screen.queryByLabelText('Texto corrigido')).not.toBeInTheDocument();
  });

  it('blocks another correction after a stale write until a fresh query result arrives', async () => {
    const user = userEvent.setup();
    correctMemoryMock.mockRejectedValue(new MemoryApiError(409, 'STALE_CORRECTION'));

    render(<MemoryFoundResult apiBaseUrl="http://api" result={found} onCurrentChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    const text = screen.getByLabelText('Texto corrigido');
    await user.clear(text);
    await user.type(text, 'Uma versão concorrente.');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A lembrança mudou');
    expect(screen.queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument();
    expect(correctMemoryMock).toHaveBeenCalledTimes(1);
  });

  it('renders server history in order and reuses an old text with the current fact as concurrency base', async () => {
    const user = userEvent.setup();
    const current = {
      ...found,
      answer: 'Versão B.',
      provenance: { ...found.provenance, evidenceId: 'evidence-2', factId: 'fact-2' },
    };
    getMemoryHistoryMock.mockResolvedValue({
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
          eventId: 'event-2',
        },
      ],
    });
    correctMemoryMock.mockResolvedValue({
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

    render(
      <MemoryFoundResult apiBaseUrl="http://api" result={current} onCurrentChange={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Ver histórico' }));
    const history = await screen.findByRole('region', { name: 'Histórico da lembrança' });
    const versions = within(history).getAllByRole('listitem');
    expect(versions).toHaveLength(2);
    expect(versions[0]).toHaveTextContent('Versão A.');
    expect(versions[0]).toHaveTextContent('Original');
    expect(versions[1]).toHaveTextContent('Versão B.');
    expect(versions[1]).toHaveTextContent('Atual');
    expect(versions[1]).toHaveTextContent('Ajuste sintético');

    await user.click(
      within(versions[0] as HTMLElement).getByRole('button', {
        name: 'Usar este texto como nova correção',
      }),
    );
    expect(screen.getByLabelText('Texto corrigido')).toHaveValue('Versão A.');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(correctMemoryMock).toHaveBeenCalledWith('http://api', 'memory-1', {
      text: 'Versão A.',
      expectedCurrentFactId: 'fact-2',
    });
  });
});
