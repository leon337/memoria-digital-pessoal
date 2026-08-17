import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryRepository } from '../../lib/memory-repository.js';
import { QueryMemoryForm } from './QueryMemoryForm.js';

function repository(): MemoryRepository {
  return {
    ready: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    query: vi.fn(),
    correct: vi.fn(),
    history: vi.fn(),
  };
}

describe('QueryMemoryForm', () => {
  it('shows the current statement and correction/history actions for FOUND', async () => {
    const user = userEvent.setup();
    const local = repository();
    vi.mocked(local.query).mockResolvedValue({
      status: 'FOUND',
      answer: 'Minha irmã se chama Ana.',
      provenance: {
        memoryId: 'memory-id',
        evidenceId: 'evidence-id',
        factId: 'fact-id',
      },
    });
    render(<QueryMemoryForm repository={local} enabled />);

    await user.type(screen.getByLabelText('Palavra ou frase'), '  Ana  ');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(local.query).toHaveBeenCalledWith('Ana');
    expect(await screen.findByText('Minha irmã se chama Ana.')).toBeInTheDocument();
    expect(screen.getByText('Fonte: lembrança guardada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corrigir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver histórico' })).toBeInTheDocument();
  });

  it('keeps correction success feedback after publishing the new local current fact', async () => {
    const user = userEvent.setup();
    const local = repository();
    vi.mocked(local.query).mockResolvedValue({
      status: 'FOUND',
      answer: 'Minha irmã se chama Ana.',
      provenance: {
        memoryId: 'memory-id',
        evidenceId: 'evidence-id',
        factId: 'fact-1',
      },
    });
    vi.mocked(local.correct).mockResolvedValue({
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
    render(<QueryMemoryForm repository={local} enabled />);

    await user.type(screen.getByLabelText('Palavra ou frase'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    await screen.findByText('Minha irmã se chama Ana.');

    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    const text = screen.getByLabelText('Texto corrigido');
    await user.clear(text);
    await user.type(text, 'Minha irmã se chama Beatriz.');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

    expect(local.correct).toHaveBeenCalledWith('memory-id', {
      text: 'Minha irmã se chama Beatriz.',
      expectedCurrentFactId: 'fact-1',
    });
    expect(await screen.findByText('Minha irmã se chama Beatriz.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Correção salva');
  });

  it('presents UNKNOWN without fabricating an answer or correction actions', async () => {
    const user = userEvent.setup();
    const local = repository();
    vi.mocked(local.query).mockResolvedValue({ status: 'UNKNOWN', answer: null, provenance: null });
    render(<QueryMemoryForm repository={local} enabled />);

    await user.type(screen.getByLabelText('Palavra ou frase'), 'ausente');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Não encontrei uma lembrança registrada que corresponda a essa busca.',
    );
    expect(screen.queryByText('Fonte: lembrança guardada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver histórico' })).not.toBeInTheDocument();
  });

  it('explains literal search behavior and disables only for local storage readiness failure', () => {
    render(<QueryMemoryForm repository={repository()} enabled={false} />);
    expect(
      screen.getByText(
        'A busca desta etapa procura palavras ou frases exatamente dentro das lembranças guardadas.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Palavra ou frase')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Consultar' })).toBeDisabled();
  });
});
