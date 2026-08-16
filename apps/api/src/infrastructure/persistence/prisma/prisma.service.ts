import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export const PRISMA_SERVICE = Symbol('PRISMA_SERVICE');

export interface PrismaServiceOptions {
  databaseUrl: string;
}

export class PrismaService {
  private readonly client: PrismaClient;

  constructor(options: PrismaServiceOptions) {
    const adapter = new PrismaPg({ connectionString: options.databaseUrl });
    this.client = new PrismaClient({ adapter });
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}
