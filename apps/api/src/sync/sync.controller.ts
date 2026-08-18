import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CodedHttpException } from '../common/http/api-error.js';
import { SYNC_SERVICE, SyncService, SyncServiceError } from './sync.service.js';
import { SyncStoreError } from './sync.store.js';

@Controller('sync/v1')
export class SyncController {
  constructor(@Inject(SYNC_SERVICE) private readonly service: SyncService) {}

  @Post('push')
  @HttpCode(200)
  push(@Body() body: unknown) {
    return this.mapErrors(() => this.service.push(body));
  }

  @Post('bootstrap/start')
  @HttpCode(200)
  startBootstrap(@Body() body: unknown) {
    return this.mapErrors(() => this.service.startBootstrap(body));
  }

  @Get('bootstrap/:token')
  bootstrapPage(@Param('token') token: string, @Query() query: unknown) {
    return this.mapErrors(() => this.service.bootstrapPage(token, query));
  }

  @Get('pull')
  pull(@Query() query: unknown) {
    return this.mapErrors(() => this.service.pull(query));
  }

  private async mapErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code =
        error instanceof SyncServiceError || error instanceof SyncStoreError ? error.code : null;
      switch (code) {
        case 'VALIDATION_FAILED':
          throw new CodedHttpException('VALIDATION_FAILED', 400, 'Os dados enviados são inválidos.');
        case 'SYNC_PROTOCOL_UNSUPPORTED':
          throw new CodedHttpException(
            'SYNC_PROTOCOL_UNSUPPORTED',
            400,
            'A versão do protocolo de sincronização não é suportada.',
          );
        case 'SYNC_BLOCKED':
          throw new CodedHttpException('SYNC_BLOCKED', 400, 'A sincronização foi bloqueada.');
        case 'SYNC_INTEGRITY_VIOLATION':
          throw new CodedHttpException(
            'SYNC_INTEGRITY_VIOLATION',
            409,
            'A sincronização detectou uma violação de integridade.',
          );
        case 'SYNC_CURSOR_EXPIRED':
          throw new CodedHttpException(
            'SYNC_CURSOR_EXPIRED',
            410,
            'O cursor de sincronização expirou.',
          );
        case 'SYNC_BOOTSTRAP_EXPIRED':
          throw new CodedHttpException(
            'SYNC_BOOTSTRAP_EXPIRED',
            410,
            'O bootstrap de sincronização expirou.',
          );
        case 'SYNC_SERVICE_UNAVAILABLE':
          throw new CodedHttpException(
            'SYNC_SERVICE_UNAVAILABLE',
            503,
            'Serviço de sincronização temporariamente indisponível.',
          );
        default:
          throw error;
      }
    }
  }
}
