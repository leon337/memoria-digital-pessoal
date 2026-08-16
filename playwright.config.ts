import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm serve:e2e',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      PORT: '3000',
      DATABASE_URL: 'postgresql://mdp:mdp_local_only@127.0.0.1:5432/mdp',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      VITE_API_BASE_URL: 'http://127.0.0.1:3000',
    },
  },
});
