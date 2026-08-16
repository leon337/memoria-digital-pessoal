import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

vi.mock('./lib/api-health.js', () => ({
  getApiReadiness: vi.fn().mockResolvedValue('ready'),
}));

describe('App', () => {
  it('shows accessible FOUNDATION readiness', async () => {
    render(<App apiBaseUrl="http://127.0.0.1:3000" />);

    expect(screen.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('API pronta');
  });
});
