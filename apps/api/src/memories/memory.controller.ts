import {
  correctMemoryRequestSchema,
  createMemoryRequestSchema,
  memoryQuerySchema,
} from '@mdp/contracts';
import { isUuidV7 } from '@mdp/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CodedHttpException } from '../common/http/api-error.js';
import {
  MemoryNotFoundError,
  NoChangeCorrectionError,
  StaleCorrectionError,
} from './memory.errors.js';
import { MEMORY_SERVICE, MemoryService } from './memory.service.js';
import { MemoryStoreUnavailableError } from './memory.store.js';

@Controller()
export class MemoryController {
  constructor(@Inject(MEMORY_SERVICE) private readonly service: MemoryService) {}

  @Post('memories')
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const parsed = createMemoryRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException();
    }

    return this.mapAvailability(() => this.service.register(parsed.data.text));
  }

  @Get('memories/:id')
  async get(@Param('id') id: string) {
    if (!isUuidV7(id)) {
      throw new BadRequestException();
    }

    const memory = await this.mapAvailability(() => this.service.get(id));
    if (!memory) {
      throw new NotFoundException();
    }
    return memory;
  }

  @Post('memories/:id/corrections')
  @HttpCode(201)
  async correct(@Param('id') id: string, @Body() body: unknown) {
    if (!isUuidV7(id)) {
      throw new BadRequestException();
    }

    const parsed = correctMemoryRequestSchema.safeParse(body);
    if (!parsed.success || !isUuidV7(parsed.data.expectedCurrentFactId)) {
      throw new CodedHttpException(
        'VALIDATION_FAILED',
        422,
        'Os dados enviados são inválidos.',
      );
    }

    try {
      return await this.mapAvailability(() => this.service.correct(id, parsed.data));
    } catch (error) {
      if (error instanceof MemoryNotFoundError) {
        throw new NotFoundException();
      }
      if (error instanceof StaleCorrectionError) {
        throw new CodedHttpException(
          'STALE_CORRECTION',
          409,
          'A lembrança mudou desde a última consulta.',
        );
      }
      if (error instanceof NoChangeCorrectionError) {
        throw new CodedHttpException(
          'NO_CHANGE',
          422,
          'A correção não altera o texto atual.',
        );
      }
      throw error;
    }
  }

  @Get('memories/:id/history')
  async history(@Param('id') id: string) {
    if (!isUuidV7(id)) {
      throw new BadRequestException();
    }

    const history = await this.mapAvailability(() => this.service.history(id));
    if (!history) {
      throw new NotFoundException();
    }
    return history;
  }

  @Get('query')
  async query(@Query('q') q: unknown) {
    const parsed = memoryQuerySchema.safeParse(q);
    if (!parsed.success) {
      throw new BadRequestException();
    }

    return this.mapAvailability(() => this.service.query(parsed.data));
  }

  private async mapAvailability<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MemoryStoreUnavailableError) {
        throw new ServiceUnavailableException();
      }
      throw error;
    }
  }
}
