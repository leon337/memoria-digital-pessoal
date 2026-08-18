import type {
  CorrectMemoryRequest,
  CorrectMemoryResponse,
  CreateMemoryResponse,
  GetMemoryResponse,
  MemoryHistoryResponse,
  MemoryQueryResponse,
} from '@mdp/contracts';
import {
  CorrectionDomainError,
  createTextCorrectionRecord,
  createTextMemoryRecord,
  type CreateTextMemoryRecordInput,
} from '@mdp/domain';
import type { UuidV7Generator } from '@mdp/shared';
import { MemoryNotFoundError } from './errors/memory-not-found.error.js';
import { MemoryUnavailableError } from './errors/memory-unavailable.error.js';
import { NoChangeCorrectionError } from './errors/no-change-correction.error.js';
import { StaleCorrectionError } from './errors/stale-correction.error.js';
import type { MemoryStore } from './memory.store.js';

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly createId: UuidV7Generator,
    private readonly now: () => Date,
  ) {}

  async create(text: string): Promise<CreateMemoryResponse> {
    const recordedAt = this.now();
    const input: CreateTextMemoryRecordInput = {
      text,
      recordedAt,
      ids: {
        memoryId: this.createId(),
        evidenceId: this.createId(),
        eventId: this.createId(),
        factId: this.createId(),
      },
    };
    const record = createTextMemoryRecord(input);

    try {
      await this.store.create(record);
    } catch (error) {
      if (error instanceof MemoryUnavailableError) {
        throw error;
      }
      throw error;
    }

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

  async get(memoryId: string): Promise<GetMemoryResponse | null> {
    const stored = await this.store.get(memoryId);
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
    const result = await this.store.query(query);
    if (result.status === 'UNKNOWN') {
      return {
        status: 'UNKNOWN',
        answer: null,
        provenance: null,
      };
    }

    return {
      status: 'FOUND',
      answer: result.fact.content,
      provenance: {
        memoryId: result.memoryId,
        evidenceId: result.evidence.id,
        factId: result.fact.id,
      },
    };
  }

  async correct(memoryId: string, request: CorrectMemoryRequest): Promise<CorrectMemoryResponse> {
    const correctedAt = this.now();
    let result;
    try {
      result = await this.store.correct({
        memoryId,
        expectedCurrentFactId: request.expectedCurrentFactId,
        createRecord: (previous) =>
          createTextCorrectionRecord({
            memoryId,
            previous,
            text: request.text,
            reason: request.reason,
            correctedAt,
            ids: {
              evidenceId: this.createId(),
              eventId: this.createId(),
              factId: this.createId(),
            },
          }),
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
