import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateNotice } from './PwaUpdateNotice.js';

const state = vi.hoisted(() => ({
  offlineReady: false,
  needRefresh: false,
  setOfflineReady: vi.fn(),
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn<() => Promise<void>>(),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    offlineReady: [state.offlineReady, state.setOfflineReady],
    needRefresh: [state.needRefresh, state.setNeedRefresh],
    updateServiceWorker: state.updateServiceWorker,
  }),
}));

beforeEach(() => {
  state.offlineReady = false;
  state.needRefresh = false;
  state.setOfflineReady.mockReset();
  state.setNeedRefresh.mockReset();
  state.updateServiceWorker.mockReset();
  state.updateServiceWorker.mockResolvedValue(undefined);
});

describe('PwaUpdateNotice', () => {
  it('renders nothing while there is no offline-ready or update notification', () => {
    render(<PwaUpdateNotice />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(state.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('reports that the application is ready offline without activating another worker', () => {
    state.offlineReady = true;
    render(<PwaUpdateNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('Aplicação pronta para uso offline.');
    expect(screen.queryByRole('button', { name: 'Atualizar agora' })).not.toBeInTheDocument();
    expect(state.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('prompts for an update and activates it only after explicit user action', async () => {
    const user = userEvent.setup();
    state.needRefresh = true;
    render(<PwaUpdateNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('Nova versão disponível.');
    expect(state.updateServiceWorker).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Atualizar agora' }));

    expect(state.updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(state.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('dismisses the current notification without forcing activation', async () => {
    const user = userEvent.setup();
    state.needRefresh = true;
    render(<PwaUpdateNotice />);

    await user.click(screen.getByRole('button', { name: 'Agora não' }));

    expect(state.setOfflineReady).toHaveBeenCalledWith(false);
    expect(state.setNeedRefresh).toHaveBeenCalledWith(false);
    expect(state.updateServiceWorker).not.toHaveBeenCalled();
  });
});
