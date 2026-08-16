import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryMemory } from '../../lib/memory-api.js';
import { QueryMemoryForm } from './QueryMemoryForm.js';

vi.mock('../../lib/memory-api.js', () => ({
  queryMemory: vi.fn(),
}));

const queryMemoryMock = vi.mocked(queryMemory);

beforeEach(() => {
  queryMemoryMock.mockReset();
});

describe('QueryMemoryForm', () => {
  it('shows the exact recorded statement and visible provenance for FOUND', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Consultar lembranças' }));

    expect(queryMemoryMock).toHaveBeenCalledWith('http://api', 'Ana');
    expect(await screen.findByText('Minha irmã se chama Ana.')).toBeInTheDocument();
    expect(screen.getByText(/Fonte registrada/)).toHaveTextContent('evidência evidence-id');
  });

  it('presents UNKNOWN without fabricating an answer', async () => {
    const user = userEvent.setup();
    queryMemoryMock.mockResolvedValue({ status: 'UNKNOWN', answer: null, provenance: null });
    render(<QueryMemoryForm apiBaseUrl="http://api" enabled />);

    await user.type(screen.getByLabelText('Palavra ou frase'), 'ausente');
    await user.click(screen.getByRole('button', { name: 'Consultar lembranças' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Não encontrei uma lembrança com essas palavras.',
    );
    expect(screen.queryByText(/Fonte registrada/)).not.toBeInTheDocument();
  });

  it('explains literal search behavior and is disabled when the API is unavailable', () => {
    render(<QueryMemoryForm apiBaseUrl="http://api" enabled={false} />);
    expect(
      screen.getByText('A busca desta versão procura palavras ou frases exatamente registradas.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Palavra ou frase')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Consultar lembranças' })).toBeDisabled();
  });
});
