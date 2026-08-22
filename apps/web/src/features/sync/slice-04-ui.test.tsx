import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import type { MemoryRepository } from '../../lib/memory-repository.js';
import type { SyncEngine } from '../../lib/sync/sync-engine.js';
import { QueryMemoryForm } from '../memory/QueryMemoryForm.js';
import { StoreMemoryForm } from '../memory/StoreMemoryForm.js';

function repository(overrides: Partial<MemoryRepository> = {}): MemoryRepository {
  return {
    ready: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({
      memory: {
        id: '0198d400-0000-7000-8000-000000000001',
        recordedAt: '2026-08-22T14:30:00.000Z',
      },
      fact: { id: '0198d400-0000-7000-8000-000000000002', content: 'Registro sintético.' },
      provenance: { evidenceId: '0198d400-0000-7000-8000-000000000003' },
    }),
    query: vi.fn(),
    correct: vi.fn(),
    resolveConflict: vi.fn(),
    history: vi.fn(),
    ...overrides,
  };
}

function syncEngine() {
  const synchronize = vi.fn().mockResolvedValue(undefined);
  const engine = {
    synchronize,
    getState: vi.fn().mockReturnValue({ status: 'PENDING' }),
    subscribe: vi.fn((listener: (state: { status: 'PENDING' }) => void) => {
      listener({ status: 'PENDING' });
      return () => undefined;
    }),
  } as unknown as SyncEngine;
  return { engine, synchronize };
}

describe('Slice 04 synchronization UI contract', () => {
  it('offers manual synchronization and delegates it to the SyncEngine', async () => {
    const user = userEvent.setup();
    const local = repository();
    const { engine, synchronize } = syncEngine();
    const SyncAwareApp = App as unknown as ComponentType<{
      repository: MemoryRepository;
      syncEngine: SyncEngine;
    }>;

    render(<SyncAwareApp repository={local} syncEngine={engine} />);

    await user.click(await screen.findByRole('button', { name: /Sincronizar agora/i }));
    expect(synchronize).toHaveBeenCalledWith('manual');
  });

  it('reports a local save without claiming remote synchronization', async () => {
    const user = userEvent.setup();
    const local = repository();

    render(<StoreMemoryForm repository={local} enabled />);
    await user.type(screen.getByLabelText('Lembrança'), 'Registro sintético.');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(/Salva neste dispositivo/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Sincronizada$/i)).not.toBeInTheDocument();
  });

  it('renders a causal conflict instead of a normal answer', async () => {
    const user = userEvent.setup();
    const local = repository({
      query: vi.fn().mockResolvedValue({
        status: 'CONFLICT',
        answer: null,
        provenance: null,
        conflict: {
          memoryId: '0198d400-0000-7000-8000-000000000010',
          baseline: {
            factId: '0198d400-0000-7000-8000-000000000011',
            evidenceId: '0198d400-0000-7000-8000-000000000012',
            content: 'Versão A',
          },
          candidates: [
            {
              factId: '0198d400-0000-7000-8000-000000000013',
              evidenceId: '0198d400-0000-7000-8000-000000000014',
              content: 'Versão B',
            },
            {
              factId: '0198d400-0000-7000-8000-000000000015',
              evidenceId: '0198d400-0000-7000-8000-000000000016',
              content: 'Versão C',
            },
          ],
        },
      }),
    });

    render(<QueryMemoryForm repository={local} enabled />);
    await user.type(screen.getByLabelText('Palavra ou frase'), 'Versão');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText(/Conflito/i)).toBeInTheDocument();
    expect(screen.getByText('Versão B')).toBeInTheDocument();
    expect(screen.getByText('Versão C')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resolver conflito/i })).toBeInTheDocument();
    expect(screen.queryByText('Fonte: lembrança guardada')).not.toBeInTheDocument();
  });
});
