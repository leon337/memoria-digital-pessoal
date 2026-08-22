import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRepositoryError, type MemoryRepository } from '../../lib/memory-repository.js';
import { StoreMemoryForm } from './StoreMemoryForm.js';

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

describe('StoreMemoryForm', () => {
  it('reports local persistence without claiming synchronization and clears the field', async () => {
    const user = userEvent.setup();
    const local = repository();
    vi.mocked(local.create).mockResolvedValue({
      memory: { id: 'memory-id', recordedAt: '2026-08-17T09:00:00.000Z' },
      fact: { id: 'fact-id', content: '  Minha irmã se chama Ana.  ' },
      provenance: { evidenceId: 'evidence-id' },
    });
    render(<StoreMemoryForm repository={local} enabled />);

    const input = screen.getByLabelText('Lembrança');
    await user.type(input, '  Minha irmã se chama Ana.  ');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(local.create).toHaveBeenCalledWith('  Minha irmã se chama Ana.  ');
    expect(await screen.findByRole('status')).toHaveTextContent('Salva neste dispositivo.');
    expect(screen.queryByText(/^Sincronizada$/i)).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('does not show false success when local storage fails', async () => {
    const user = userEvent.setup();
    const local = repository();
    vi.mocked(local.create).mockRejectedValue(
      new MemoryRepositoryError('LOCAL_STORAGE_UNAVAILABLE'),
    );
    render(<StoreMemoryForm repository={local} enabled />);

    await user.type(screen.getByLabelText('Lembrança'), 'Registro sintético.');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('armazenamento local');
    expect(screen.queryByText(/Salva neste dispositivo/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Lembrança')).toHaveValue('Registro sintético.');
  });

  it('is disabled only when local repository readiness is unavailable', () => {
    render(<StoreMemoryForm repository={repository()} enabled={false} />);
    expect(screen.getByLabelText('Lembrança')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });
});
