import { useEffect, useState } from 'react';

export type ConnectivityState = 'online' | 'offline';

export function useConnectivity(): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>(() =>
    navigator.onLine ? 'online' : 'offline',
  );

  useEffect(() => {
    const markOnline = () => setState('online');
    const markOffline = () => setState('offline');

    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  return state;
}
