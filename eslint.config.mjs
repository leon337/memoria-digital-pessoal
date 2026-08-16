import js from '@eslint/js';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

const publicApiOnly = ['@mdp/*/*', '**/packages/*/src/*'];
const neutralForbidden = [
  ...builtinModules,
  'node:*',
  '@nestjs/*',
  '@prisma/*',
  'react',
  'react-dom',
  'pg',
  'redis',
  'ioredis',
  'bullmq',
  '**/apps/*',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'playwright-report/**',
      'test-results/**',
      'apps/api/src/infrastructure/persistence/prisma/generated/**',
    ],
  },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
  },
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'tests/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: publicApiOnly,
              message: 'Use @mdp/* public entry points.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: publicApiOnly,
              message: 'Use workspace public entry points.',
            },
            {
              group: neutralForbidden,
              message: 'Domain/contracts must stay framework and infrastructure neutral.',
            },
          ],
        },
      ],
    },
  },
);
