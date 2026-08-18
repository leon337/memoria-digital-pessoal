import type {
  CorrectMemoryRequest,
  CorrectMemoryResponse,
  CreateMemoryResponse,
  GetMemoryResponse,
  MemoryHistoryResponse,
  MemoryQueryResponse,
} from '@mdp/contracts';
import { CorrectionDomainError, createTextMemoryRecord } from '@mdp/domain';
import {
  MemoryNotFoundError,
  NoChangeCorrectionError,
  StaleCorrectionError,
} from './memory.errors.js';
import type { MemoryStore } from './memory.store.js';

export const MEMORY_SERVICE = Symbol('MEMORY_SERVICE');

export interface MemoryServiceOptions {
  store: MemoryStore;
  now: () => Date;
  createId: () => string;
}

export class MemoryService {
  private readonly store: MemoryStore;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: MemoryServiceOptions) {
    this.store = options.store;
    this.now = options.now;
    this.createId = options.createId;
  }

  async register(text: string): Promise<CreateMemoryResponse> {
    const recordedAt = this.now();
    const record = createTextMemoryRecord({
      text,
      recordedAt,
      ids: {
        memoryId: this.createId(),
        evidenceId: this.createId(),
        eventId: this.createId(),
        factId: this.createId(),
      },
    });

    await this.store.create(record);

    return {
      memory: {
        id: record.memory.id,
        recordedAt: record.memory.recordedAt.toISOString(),
      },
      fact: {
        id: record.fact.id,
        content: record.fact.content,
      },
      provenance: {
        evidenceId: record.evidence.id,
      },
    };
  }

  async get(id: string): Promise<GetMemoryResponse | null> {
    const stored = await this.store.getById(id);
    if (!stored) {
      return null;
    }

    return {
      memory: {
        id: stored.memory.id,
        recordedAt: stored.memory.recordedAt.toISOString(),
        occurredAt: null,
        temporalPrecision: 'unknown',
      },
      evidence: {
        id: stored.evidence.id,
        kind: 'text',
        content: stored.evidence.content,
        createdAt: stored.evidence.createdAt.toISOString(),
      },
      fact: {
        id: stored.fact.id,
        kind: 'autobiographical_statement',
        content: stored.fact.content,
        createdAt: stored.fact.createdAt.toISOString(),
      },
    };
  }

  async query(query: string): Promise<MemoryQueryResponse> {
    const hit = await this.store.findLiteral(query.trim());
    if (!hit) {
      return { status: 'UNKNOWN', answer: null, provenance: null };
    }

    return {
      status: 'FOUND',
      answer: hit.content,
      provenance: {
        memoryId: hit.memoryId,
        evidenceId: hit.evidenceId,
        factId: hit.factId,
      },
    };
  }

  async correct(memoryId: string, request: CorrectMemoryRequest): Promise<CorrectMemoryResponse> {
    const correctedAt = this.now();
    const ids = {
      evidenceId: this.createId(),
      eventId: this.createId(),
      factId: this.createId(),
    };

    let result;
    try {
      result = await this.store.correct({
        memoryId,
        expectedCurrentFactId: request.expectedCurrentFactId,
        text: request.text,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        correctedAt,
        ids,
      });
    } catch (error) {
      if (error instanceof CorrectionDomainError && error.code === 'NO_CHANGE') {
        throw new NoChangeCorrectionError();
      }
      throw error;
    }

    if (result.status === 'NOT_FOUND') {
      throw new MemoryNotFoundError();
    }
    if (result.status === 'STALE') {
      throw new StaleCorrectionError(result.currentFactId);
    }

    const record = result.record;
    return {
      memoryId,
      current: {
        factId: record.currentFact.factId,
        evidenceId: record.currentFact.evidenceId,
        content: record.currentFact.content,
        recordedAt: record.currentFact.recordedAt.toISOString(),
        correctedAt: record.fact.createdAt.toISOString(),
      },
      correction: {
        eventId: record.event.id,
        supersedesFactId: record.event.supersedesFactId,
        reason: record.event.reason,
      },
    };
  }

  async history(memoryId: string): Promise<MemoryHistoryResponse | null> {
    const stored = await this.store.history(memoryId);
    if (!stored) {
      return null;
    }

    return {
      memoryId: stored.memoryId,
      versions: stored.versions.map((version) => ({
        factId: version.factId,
        evidenceId: version.evidenceId,
        content: version.content,
        createdAt: version.createdAt.toISOString(),
        reason: version.reason,
        isOriginal: version.isOriginal,
        isCurrent: version.isCurrent,
        supersedesFactId: version.supersedesFactId,
        predecessorFactIds:
          version.supersedesFactId === null ? [] : [version.supersedesFactId],
        eventId: version.eventId,
      })),
    };
  }
}
