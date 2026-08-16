import { describe, expect, it } from 'vitest';
import { PrismaService } from './prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for integration test');
}

describe('PrismaService integration', () => {
  it('pings PostgreSQL', async () => {
    const service = new PrismaService({ databaseUrl });
    await expect(service.ping()).resolves.toBeUndefined();
    await service.close();
  });
});
