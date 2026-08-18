import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryRepository } from './lib/memory-repository.js';
import { useConnectivity } from './lib/use-connectivity.js';
import { App } from './App.js';

vi.mock('./lib/use-connectivity.js', () => ({
  useConnectivity: vi.fn(),
}));

const useConnectivityMock = vi.mocked(useConnectivity);

function repository(ready: () => Promise<void> = () => Promise.resolve()): MemoryRepository {
  return {
    ready: vi.fn(ready),
    create: vi.fn(),
    query: vi.fn(),
    correct: vi.fn(),
    resolveConflict: vi.fn(),
    history: vi.fn(),
  };
}

beforeEach(() => {
  useConnectivityMock.mockReturnValue('online');
});

describe('App', () => {
  it('enables memory actions after the local repository is ready without consulting API readiness', async () => {
    const local = repository();
    render(<App repository={local} />);

    expect(screen.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeInTheDocument();
    expect(await screen.findByText('Armazenamento local pronto')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(local.ready).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Lembrança')).toBeEnabled();
    expect(screen.getByLabelText('Palavra ou frase')).toBeEnabled();
  });

  it('keeps local actions enabled while offline when IndexedDB is healthy', async () => {
    useConnectivityMock.mockReturnValue('offline');
    const local = repository();
    render(<App repository={local} />);

    expect(await screen.findByText('Armazenamento local pronto')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByLabelText('Lembrança')).toBeEnabled();
    expect(screen.getByLabelText('Palavra ou frase')).toBeEnabled();
  });

  it('disables local actions when IndexedDB readiness fails', async () => {
    const local = repository(() => Promise.reject(new Error('storage unavailable')));
    render(<App repository={local} />);

    expect(await screen.findByText('Armazenamento local indisponível')).toBeInTheDocument();
    expect(screen.getByLabelText('Lembrança')).toBeDisabled();
    expect(screen.getByLabelText('Palavra ou frase')).toBeDisabled();
  });

  it('makes the synthetic-only laboratory boundary explicit', () => {
    render(<App repository={repository()} />);

    expect(screen.getByLabelText('Ambiente de laboratório')).toHaveTextContent(
      'Use somente dados sintéticos',
    );
    expect(screen.getByLabelText('Ambiente de laboratório')).toHaveTextContent(
      'Não registre dados pessoais ou lembranças reais nesta versão.',
    );
  });
});
