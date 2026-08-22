import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { getWebEnv } from './config/env.js';
import { IndexedDbMemoryRepository } from './lib/indexeddb/indexeddb-memory-repository.js';
import { IndexedDbSyncStore } from './lib/indexeddb/indexeddb-sync-store.js';
import { SyncApiClient } from './lib/sync/sync-api.js';
import { SyncEngine } from './lib/sync/sync-engine.js';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

const repository = new IndexedDbMemoryRepository();
const syncStore = new IndexedDbSyncStore();
const syncApi = new SyncApiClient(getWebEnv().apiBaseUrl);
const syncEngine = new SyncEngine({ local: syncStore, api: syncApi });

createRoot(root).render(
  <StrictMode>
    <App repository={repository} syncEngine={syncEngine} />
  </StrictMode>,
);
