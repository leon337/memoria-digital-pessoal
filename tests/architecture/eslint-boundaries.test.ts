import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('architecture lint', () => {
  it('rejects Prisma imports from domain', async () => {
    const [result] = await new ESLint().lintText(
      "import { PrismaClient } from '@prisma/client';\nexport {};",
      { filePath: 'packages/domain/src/forbidden.ts' },
    );

    expect(result?.messages.some((message) => message.ruleId === 'no-restricted-imports')).toBe(
      true,
    );
  });
});
