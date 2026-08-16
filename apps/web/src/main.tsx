import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { getWebEnv } from './config/env.js';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

const env = getWebEnv();

createRoot(root).render(
  <StrictMode>
    <App apiBaseUrl={env.apiBaseUrl} />
  </StrictMode>,
);
