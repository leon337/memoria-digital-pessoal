import { createMemoryRequestSchema, memoryQuerySchema } from '@mdp/contracts';
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
