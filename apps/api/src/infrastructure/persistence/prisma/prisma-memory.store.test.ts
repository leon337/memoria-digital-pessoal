import { describe, expect, it } from 'vitest';
import { MemoryStoreUnavailableError } from '../../../memories/memory.store.js';
import { PrismaMemoryStore } from './prisma-memory.store.js';
import type { PrismaService } from './prisma.service.js';

function rejectingPrisma(code: string): PrismaService {
  return {
    run: async () => {
      throw Object.assign(new Error(`synthetic ${code}`), { code });
    },
  } as unknown as PrismaService;
}

describe('PrismaMemoryStore availability mapping', () => {
  for (const code of ['P2024', 'P2037']) {
    it(`maps ${code} connection-capacity failures to store unavailable`, async () => {
      const store = new PrismaMemoryStore(rejectingPrisma(code));

      await expect(store.findLiteral('synthetic')).rejects.toBeInstanceOf(
        MemoryStoreUnavailableError,
      );
    });
  }
});
