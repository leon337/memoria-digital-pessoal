import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

vi.mock('./lib/api-health.js', () => ({
  getApiReadiness: vi.fn().mockResolvedValue('ready'),
}));

describe('App', () => {
  it('preserves Foundation readiness and exposes the two Slice 01 actions', async () => {
    render(<App apiBaseUrl="http://127.0.0.1:3000" />);

    expect(screen.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeInTheDocument();
    expect(await screen.findByText('API pronta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Guardar uma lembrança' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Consultar minhas lembranças' }),
    ).toBeInTheDocument();
  });
});
