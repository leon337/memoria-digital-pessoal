import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemory } from '../../lib/memory-api.js';
import { StoreMemoryForm } from './StoreMemoryForm.js';

vi.mock('../../lib/memory-api.js', () => ({
  createMemory: vi.fn(),
}));

const createMemoryMock = vi.mocked(createMemory);

beforeEach(() => {
  createMemoryMock.mockReset();
});

describe('StoreMemoryForm', () => {
  it('preserves text, reports success only after persistence and clears the field', async () => {
    const user = userEvent.setup();
    createMemoryMock.mockResolvedValue({
      memory: { id: 'memory-id', recordedAt: '2026-08-16T09:00:00.000Z' },
      fact: { id: 'fact-id', content: '  Minha irmã se chama Ana.  ' },
      provenance: { evidenceId: 'evidence-id' },
    });
    render(<StoreMemoryForm apiBaseUrl="http://api" enabled />);

    const input = screen.getByLabelText('Lembrança');
    await user.type(input, '  Minha irmã se chama Ana.  ');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(createMemoryMock).toHaveBeenCalledTimes(1);
    expect(createMemoryMock).toHaveBeenCalledWith('http://api', '  Minha irmã se chama Ana.  ');
    expect(await screen.findByRole('status')).toHaveTextContent('Lembrança guardada.');
    expect(input).toHaveValue('');
  });

  it('does not show false success when persistence fails', async () => {
    const user = userEvent.setup();
    createMemoryMock.mockRejectedValue(new Error('unavailable'));
    render(<StoreMemoryForm apiBaseUrl="http://api" enabled />);

    await user.type(screen.getByLabelText('Lembrança'), 'Registro sintético.');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível guardar');
    expect(screen.queryByText('Lembrança guardada.')).not.toBeInTheDocument();
  });

  it('is disabled while the API is unavailable', () => {
    render(<StoreMemoryForm apiBaseUrl="http://api" enabled={false} />);
    expect(screen.getByLabelText('Lembrança')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });
});
