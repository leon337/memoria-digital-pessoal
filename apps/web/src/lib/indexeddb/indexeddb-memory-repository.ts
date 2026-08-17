import {
  createMemoryRequestSchema,
  memoryQuerySchema,
  type CreateMemoryResponse,
  type MemoryQueryResponse,
} from '@mdp/contracts';
import { createTextMemoryRecord } from '@mdp/domain';
import { createId } from '@mdp/shared';
import { MemoryRepositoryError } from '../memory-repository.js';
import {
  PRODUCT_STORES,
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
  type LocalCurrentFactRecord,
} from './mdp-local-db.js';

interface IndexedDbMemoryRepositoryDependencies {
  factory?: IDBFactory;
  now?: () => Date;
  createId?: () => string;
}

type FailureFallback = 'LOCAL_STORAGE_UNAVAILABLE' | 'LOCAL_DATA_INTEGRITY_ERROR';

const unavailableErrorNames = new Set([
  'QuotaExceededError',
  'InvalidStateError',
  'NotReadableError',
  'UnknownError',
  'VersionError',
]);

const integrityErrorNames = new Set(['ConstraintError', 'DataError']);

function errorName(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('name' in error)) {
    return null;
  }
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

export class IndexedDbMemoryRepository {
  private readonly factory: IDBFactory;
  private readonly now: () => Date;
  private readonly nextId: () => string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dependencies: IndexedDbMemoryRepositoryDependencies = {}) {
    this.factory = dependencies.factory ?? indexedDB;
    this.now = dependencies.now ?? (() => new Date());
    this.nextId = dependencies.createId ?? createId;
  }

  async ready(): Promise<void> {
    await this.withMappedFailure(async () => {
      await this.database();
    }, 'LOCAL_STORAGE_UNAVAILABLE');
  }

  async create(text: string): Promise<CreateMemoryResponse> {
    const parsed = createMemoryRequestSchema.safeParse({ text });
    if (!parsed.success) {
      throw new MemoryRepositoryError('VALIDATION_FAILED');
    }

    return this.withMappedFailure(async () => {
      const db = await this.database();
      const recordedAt = this.now();
      const record = createTextMemoryRecord({
        text: parsed.data.text,
        recordedAt,
        ids: {
          memoryId: this.nextId(),
          evidenceId: this.nextId(),
          eventId: this.nextId(),
          factId: this.nextId(),
        },
      });

      const transaction = db.transaction(PRODUCT_STORES, 'readwrite');
      transaction.objectStore('memories').add(record.memory);
      transaction.objectStore('evidence').add(record.evidence);
      transaction.objectStore('ledgerEvents').add(record.event);
      transaction.objectStore('facts').add(record.fact);
      transaction.objectStore('currentFacts').add(record.currentFact);
      await transactionDone(transaction);

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
    }, 'LOCAL_DATA_INTEGRITY_ERROR');
  }

  async query(query: string): Promise<MemoryQueryResponse> {
    const parsed = memoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new MemoryRepositoryError('VALIDATION_FAILED');
    }

    return this.withMappedFailure(async () => {
      const db = await this.database();
      const transaction = db.transaction('currentFacts', 'readonly');
      const done = transactionDone(transaction);
      const currentFacts = await requestAsPromise<LocalCurrentFactRecord[]>(
        transaction.objectStore('currentFacts').getAll(),
      );
      await done;

      const normalized = parsed.data.toLowerCase();
      const matches = currentFacts.filter((fact) =>
        fact.content.toLowerCase().includes(normalized),
      );
      matches.sort((left, right) => {
        const newest = right.recordedAt.getTime() - left.recordedAt.getTime();
        return newest !== 0 ? newest : left.factId.localeCompare(right.factId);
      });

      const hit = matches[0];
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
    }, 'LOCAL_STORAGE_UNAVAILABLE');
  }

  private database(): Promise<IDBDatabase> {
    this.dbPromise ??= openMdpLocalDatabase(this.factory);
    return this.dbPromise;
  }

  private async withMappedFailure<T>(
    operation: () => Promise<T>,
    fallback: FailureFallback,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MemoryRepositoryError) {
        throw error;
      }

      const name = errorName(error);
      if (name && unavailableErrorNames.has(name)) {
        throw new MemoryRepositoryError('LOCAL_STORAGE_UNAVAILABLE', error);
      }
      if (name && integrityErrorNames.has(name)) {
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR', error);
      }
      throw new MemoryRepositoryError(fallback, error);
    }
  }
}
