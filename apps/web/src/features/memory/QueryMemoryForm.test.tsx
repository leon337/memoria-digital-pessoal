import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { correctMemory, queryMemory } from '../../lib/memory-api.js';
import { QueryMemoryForm } from './QueryMemoryForm.js';

vi.mock('../../lib/memory-api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/memory-api.js')>('../../lib/memory-api.js');
  return {
    ...actual,
    correctMemory: vi.fn(),
    queryMemory: vi.fn(),
  };
});

const correctMemoryMock = vi.mocked(correctMemory);
const queryMemoryMock = vi.mocked(queryMemory);

beforeEach(() => {
  correctMemoryMock.mockReset();
  queryMemoryMock.mockReset();
});

describe('QueryMemoryForm', () => {
  it('shows the exact recorded statement, provenance and correction/history actions for FOUND', async () => {
    const user = userEvent.setup();
    queryMemoryMock.mockResolvedValue({
      status: 'FOUND',
      answer: 'Minha irmã se chama Ana.',
      provenance: {
        memoryId: 'memory-id',
        evidenceId: 'evidence-id',
        factId: 'fact-id',
      },
    });
    render(<QueryMemoryForm apiBaseUrl="http://api" enabled />);

    await user.type(screen.getByLabelText('Palavra ou frase'), '  Ana  ');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(queryMemoryMock).toHaveBeenCalledWith('http://api', 'Ana');
    expect(await screen.findByText('Minha irmã se chama Ana.')).toBeInTheDocument();
    expect(screen.getByText('Fonte: lembrança guardada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corrigir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver histórico' })).toBeInTheDocument();
  });

  it('keeps correction success feedback after the parent publishes the new current fact', async () => {
    const user = userEvent.setup();
    queryMemoryMock.mockResolvedValue({
      status: 'FOUND',
      answer: 'Minha irmã se chama Ana.',
      provenance: {
        memoryId: 'memory-id',
        evidenceId: 'evidence-id',
        factId: 'fact-1',
      },
    });
    correctMemoryMock.mockResolvedValue({
      memoryId: 'memory-id',
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
        reason: null,
      },
    });
    render(<QueryMemoryForm apiBaseUrl="http://api" enabled />);

    await user.type(screen.getByLabelText('Palavra ou frase'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    await screen.findByText('Minha irmã se chama Ana.');

    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    const text = screen.getByLabelText('Texto corrigido');
    await user.clear(text);
    await user.type(text, 'Minha irmã se chama Beatriz.');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(await screen.findByText('Minha irmã se chama Beatriz.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Correção salva');
  });

  it('presents UNKNOWN without fabricating an answer or correction actions', async () => {
    const user = userEvent.setup();
    queryMemoryMock.mockResolvedValue({ status: 'UNKNOWN', answer: null, provenance: null });
    render(<QueryMemoryForm apiBaseUrl="http://api" enabled />);

    await user.type(screen.getByLabelText('Palavra ou frase'), 'ausente');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Não encontrei uma lembrança registrada que corresponda a essa busca.',
    );
    expect(screen.queryByText('Fonte: lembrança guardada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver histórico' })).not.toBeInTheDocument();
  });

  it('explains literal search behavior and is disabled when the API is unavailable', () => {
    render(<QueryMemoryForm apiBaseUrl="http://api" enabled={false} />);
    expect(
      screen.getByText(
        'A busca desta etapa procura palavras ou frases exatamente dentro das lembranças guardadas.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Palavra ou frase')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Consultar' })).toBeDisabled();
  });
});
