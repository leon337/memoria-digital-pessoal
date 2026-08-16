import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';

@Module({
  imports: [EnvModule],
  controllers: [HealthController],
  providers: [HealthService]
})
export class AppModule {}
