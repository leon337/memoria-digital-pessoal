import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

async function lintDomain(source: string) {
  const [result] = await new ESLint().lintText(source, {
    filePath: 'packages/domain/src/forbidden.ts',
  });
  return result;
}

describe('architecture lint', () => {
  it('rejects Prisma imports from domain', async () => {
    const result = await lintDomain("import { PrismaClient } from '@prisma/client';\nexport {};");

    expect(result?.messages.some((message) => message.ruleId === 'no-restricted-imports')).toBe(
      true,
    );
  });

  it('rejects Node platform imports from domain', async () => {
    const result = await lintDomain("import { readFile } from 'node:fs/promises';\nexport { readFile };");

    expect(result?.messages.some((message) => message.ruleId === 'no-restricted-imports')).toBe(
      true,
    );
  });
});
