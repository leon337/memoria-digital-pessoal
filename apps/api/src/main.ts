import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiErrorFilter } from './common/http/api-error.filter.js';
import { requestIdMiddleware } from './common/http/request-id.middleware.js';
import type { ApiEnv } from './config/env.js';
import { API_ENV } from './config/env.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get<ApiEnv>(API_ENV);
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableCors({ origin: env.webOrigin });
  app.enableShutdownHooks();
  await app.listen(env.port, '127.0.0.1');
}

void bootstrap();
