import { createId } from '@mdp/shared';
import { Module } from '@nestjs/common';
import type { ApiEnv } from './config/env.js';
import { API_ENV, EnvModule } from './config/env.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { PrismaMemoryStore } from './infrastructure/persistence/prisma/prisma-memory.store.js';
import {
  PRISMA_SERVICE,
  PrismaService,
} from './infrastructure/persistence/prisma/prisma.service.js';
import { PrismaSyncStore } from './infrastructure/persistence/prisma/prisma-sync.store.js';
import { MemoryController } from './memories/memory.controller.js';
import { MEMORY_SERVICE, MemoryService } from './memories/memory.service.js';
import { MEMORY_STORE, type MemoryStore } from './memories/memory.store.js';
import { SyncController } from './sync/sync.controller.js';
import { SYNC_SERVICE, SyncService } from './sync/sync.service.js';
import { SYNC_STORE, type SyncStore } from './sync/sync.store.js';

const prismaProvider = {
  provide: PRISMA_SERVICE,
  inject: [API_ENV],
  useFactory: (env: ApiEnv) => new PrismaService({ databaseUrl: env.databaseUrl }),
};

const memoryStoreProvider = {
  provide: MEMORY_STORE,
  inject: [PRISMA_SERVICE],
  useFactory: (prisma: PrismaService) => new PrismaMemoryStore(prisma),
};

const memoryServiceProvider = {
  provide: MEMORY_SERVICE,
  inject: [MEMORY_STORE],
  useFactory: (store: MemoryStore) => new MemoryService({ store, now: () => new Date(), createId }),
};

const syncStoreProvider = {
  provide: SYNC_STORE,
  inject: [PRISMA_SERVICE, API_ENV],
  useFactory: (prisma: PrismaService, env: ApiEnv) => new PrismaSyncStore({ prisma, env }),
};

const syncServiceProvider = {
  provide: SYNC_SERVICE,
  inject: [SYNC_STORE, API_ENV],
  useFactory: (store: SyncStore, env: ApiEnv) => new SyncService(store, env.syncMaxBatchSize),
};

@Module({
  imports: [EnvModule],
  controllers: [HealthController, MemoryController, SyncController],
  providers: [
    HealthService,
    prismaProvider,
    memoryStoreProvider,
    memoryServiceProvider,
    syncStoreProvider,
    syncServiceProvider,
  ],
})
export class AppModule {}
