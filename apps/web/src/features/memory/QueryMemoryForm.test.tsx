import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryMemory } from '../../lib/memory-api.js';
import { QueryMemoryForm } from './QueryMemoryForm.js';

vi.mock('../../lib/memory-api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/memory-api.js')>('../../lib/memory-api.js');
  return {
    ...actual,
    queryMemory: vi.fn(),
  };
});

const queryMemoryMock = vi.mocked(queryMemory);

beforeEach(() => {
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
