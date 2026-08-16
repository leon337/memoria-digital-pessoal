import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  PRISMA_SERVICE,
  type PrismaService
} from '../infrastructure/persistence/prisma/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async readiness(): Promise<{ status: 'ready' }> {
    try {
      await this.prisma.ping();
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
