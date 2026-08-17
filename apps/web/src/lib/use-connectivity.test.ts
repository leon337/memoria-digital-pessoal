import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConnectivity } from './use-connectivity.js';

describe('useConnectivity', () => {
  it('tracks browser online/offline events without treating offline as a failure', () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    let online = true;
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => online,
    });

    const { result, unmount } = renderHook(() => useConnectivity());
    expect(result.current).toBe('online');

    act(() => {
      online = false;
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe('offline');

    act(() => {
      online = true;
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe('online');

    unmount();
    if (original) {
      Object.defineProperty(Navigator.prototype, 'onLine', original);
    } else {
      vi.restoreAllMocks();
    }
  });
});
