import { Module } from '@nestjs/common';
import type { ApiEnv } from './config/env.js';
import { API_ENV, EnvModule } from './config/env.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import {
  PRISMA_SERVICE,
  PrismaService
} from './infrastructure/persistence/prisma/prisma.service.js';

const prismaProvider = {
  provide: PRISMA_SERVICE,
  inject: [API_ENV],
  useFactory: (env: ApiEnv) => new PrismaService({ databaseUrl: env.databaseUrl })
};

@Module({
  imports: [EnvModule],
  controllers: [HealthController],
  providers: [HealthService, prismaProvider]
})
export class AppModule {}
