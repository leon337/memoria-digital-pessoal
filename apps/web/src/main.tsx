import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { IndexedDbMemoryRepository } from './lib/indexeddb/indexeddb-memory-repository.js';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

const repository = new IndexedDbMemoryRepository();

createRoot(root).render(
  <StrictMode>
    <App repository={repository} />
  </StrictMode>,
);
