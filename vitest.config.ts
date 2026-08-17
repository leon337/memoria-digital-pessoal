import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/web/vite.config.ts',
      'apps/api/vitest.config.ts',
      'apps/api/vitest.integration.config.ts',
      'packages/shared/vitest.config.ts',
      {
        test: {
          name: 'contracts',
          environment: 'node',
          include: ['packages/contracts/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'domain',
          environment: 'node',
          include: ['packages/domain/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'architecture',
          environment: 'node',
          include: ['tests/architecture/**/*.test.ts'],
        },
      },
    ],
  },
});
