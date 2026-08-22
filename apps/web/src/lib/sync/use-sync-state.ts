import { useEffect, useState } from 'react';
import type { SyncEngine, SyncRuntimeState } from './sync-engine.js';

export function useSyncState(engine: SyncEngine) {
  const [state, setState] = useState<SyncRuntimeState>(() => engine.getState());

  useEffect(() => engine.subscribe(setState), [engine]);

  return {
    state,
    synchronizeNow: () => engine.synchronize('manual'),
  };
}
