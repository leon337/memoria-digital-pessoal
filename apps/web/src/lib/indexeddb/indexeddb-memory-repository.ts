import {
  correctMemoryRequestSchema,
  createMemoryRequestSchema,
  memoryQuerySchema,
  type CorrectMemoryRequest,
  type CorrectMemoryResponse,
  type CreateMemoryResponse,
  type MemoryHistoryResponse,
  type MemoryQueryResponse,
} from '@mdp/contracts';
import {
  CorrectionDomainError,
  createTextCorrectionRecord,
  createTextMemoryRecord,
  orderTextFactHistory,
} from '@mdp/domain';
import { createId } from '@mdp/shared';
import { MemoryRepositoryError, type MemoryRepository } from '../memory-repository.js';
import {
  PRODUCT_STORES,
  openMdpLocalDatabase,
  requestAsPromise,
  transactionDone,
  type LocalCurrentFactRecord,
  type LocalEvidenceRecord,
  type LocalFactRecord,
  type LocalLedgerEventRecord,
  type LocalMemoryRecord,
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

function datesEqual(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

export class IndexedDbMemoryRepository implements MemoryRepository {
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

  async correct(memoryId: string, request: CorrectMemoryRequest): Promise<CorrectMemoryResponse> {
    const parsed = correctMemoryRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new MemoryRepositoryError('VALIDATION_FAILED');
    }

    return this.withMappedFailure(async () => {
      const db = await this.database();
      const transaction = db.transaction(PRODUCT_STORES, 'readwrite');
      const done = transactionDone(transaction);
      const memoryRequest = transaction.objectStore('memories').get(memoryId);
      const currentRequest = transaction
        .objectStore('currentFacts')
        .index('memoryId')
        .getAll(memoryId);
      const [memory, currentRows] = await Promise.all([
        requestAsPromise<LocalMemoryRecord | undefined>(memoryRequest),
        requestAsPromise<LocalCurrentFactRecord[]>(currentRequest),
      ]);

      if (!memory) {
        throw new MemoryRepositoryError('NOT_FOUND');
      }
      if (currentRows.length !== 1) {
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }
      const current = currentRows[0];
      if (!current) {
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }
      if (current.factId !== parsed.data.expectedCurrentFactId) {
        throw new MemoryRepositoryError('STALE_CORRECTION');
      }

      const correctedAt = this.now();
      let record;
      try {
        record = createTextCorrectionRecord({
          memoryId,
          previous: {
            factId: current.factId,
            evidenceId: current.evidenceId,
            content: current.content,
            recordedAt: current.recordedAt,
          },
          text: parsed.data.text,
          ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
          correctedAt,
          ids: {
            evidenceId: this.nextId(),
            eventId: this.nextId(),
            factId: this.nextId(),
          },
        });
      } catch (error) {
        if (error instanceof CorrectionDomainError) {
          if (error.code === 'NO_CHANGE') {
            throw new MemoryRepositoryError('NO_CHANGE', error);
          }
          throw new MemoryRepositoryError('VALIDATION_FAILED', error);
        }
        throw error;
      }

      transaction.objectStore('evidence').add(record.evidence);
      transaction.objectStore('facts').add(record.fact);
      transaction.objectStore('ledgerEvents').add(record.event);
      transaction.objectStore('currentFacts').delete(current.factId);
      transaction.objectStore('currentFacts').add(record.currentFact);
      await done;

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
    }, 'LOCAL_DATA_INTEGRITY_ERROR');
  }

  async history(memoryId: string): Promise<MemoryHistoryResponse> {
    return this.withMappedFailure(async () => {
      const db = await this.database();
      const transaction = db.transaction(PRODUCT_STORES, 'readonly');
      const done = transactionDone(transaction);

      const memoryRequest = transaction.objectStore('memories').get(memoryId);
      const evidenceRequest = transaction
        .objectStore('evidence')
        .index('memoryId')
        .getAll(memoryId);
      const eventsRequest = transaction
        .objectStore('ledgerEvents')
        .index('memoryId')
        .getAll(memoryId);
      const factsRequest = transaction.objectStore('facts').index('memoryId').getAll(memoryId);
      const currentRequest = transaction
        .objectStore('currentFacts')
        .index('memoryId')
        .getAll(memoryId);

      const [memory, evidence, events, facts, currentRows] = await Promise.all([
        requestAsPromise<LocalMemoryRecord | undefined>(memoryRequest),
        requestAsPromise<LocalEvidenceRecord[]>(evidenceRequest),
        requestAsPromise<LocalLedgerEventRecord[]>(eventsRequest),
        requestAsPromise<LocalFactRecord[]>(factsRequest),
        requestAsPromise<LocalCurrentFactRecord[]>(currentRequest),
      ]);
      await done;

      if (!memory) {
        throw new MemoryRepositoryError('NOT_FOUND');
      }
      if (
        memory.occurredAt !== null ||
        memory.temporalPrecision !== 'unknown' ||
        currentRows.length !== 1 ||
        facts.length === 0
      ) {
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }

      const current = currentRows[0];
      if (
        !current ||
        current.memoryId !== memoryId ||
        !datesEqual(current.recordedAt, memory.recordedAt)
      ) {
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }

      const evidenceById = new Map(evidence.map((item) => [item.id, item]));
      for (const fact of facts) {
        const source = evidenceById.get(fact.evidenceId);
        if (
          fact.memoryId !== memoryId ||
          fact.kind !== 'autobiographical_statement' ||
          !source ||
          source.memoryId !== memoryId ||
          source.kind !== 'text' ||
          source.content !== fact.content
        ) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
      }

      const currentFact = facts.find((fact) => fact.id === current.factId);
      const currentEvidence = evidenceById.get(current.evidenceId);
      if (
        !currentFact ||
        !currentEvidence ||
        currentFact.evidenceId !== current.evidenceId ||
        currentFact.content !== current.content ||
        currentEvidence.content !== current.content
      ) {
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }

      let ordered;
      try {
        ordered = orderTextFactHistory(
          facts.map((fact) => ({
            factId: fact.id,
            evidenceId: fact.evidenceId,
            content: fact.content,
            createdAt: fact.createdAt,
            supersedesFactId: fact.supersedesFactId ?? null,
          })),
          current.factId,
        );
      } catch (error) {
        if (error instanceof CorrectionDomainError && error.code === 'BROKEN_HISTORY') {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR', error);
        }
        throw error;
      }

      const versions = ordered.map((node) => {
        if (node.isOriginal) {
          const creationEvents = events.filter(
            (event) => event.type === 'MEMORY_CREATED' && event.evidenceId === node.evidenceId,
          );
          if (creationEvents.length !== 1) {
            throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
          }
          const event = creationEvents[0];
          if (
            !event ||
            event.memoryId !== memoryId ||
            event.factId !== undefined ||
            event.supersedesFactId !== undefined
          ) {
            throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
          }
          return {
            factId: node.factId,
            evidenceId: node.evidenceId,
            content: node.content,
            createdAt: node.createdAt.toISOString(),
            reason: null,
            isOriginal: true,
            isCurrent: node.isCurrent,
            supersedesFactId: null,
            predecessorFactIds: [],
            eventId: event.id,
          };
        }

        const correctionEvents = events.filter(
          (event) => event.type === 'MEMORY_CORRECTED' && event.factId === node.factId,
        );
        if (correctionEvents.length !== 1) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
        const event = correctionEvents[0];
        if (
          !event ||
          event.memoryId !== memoryId ||
          event.evidenceId !== node.evidenceId ||
          event.supersedesFactId !== node.supersedesFactId
        ) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
        return {
          factId: node.factId,
          evidenceId: node.evidenceId,
          content: node.content,
          createdAt: node.createdAt.toISOString(),
          reason: event.reason ?? null,
          isOriginal: false,
          isCurrent: node.isCurrent,
          supersedesFactId: node.supersedesFactId,
          predecessorFactIds: node.supersedesFactId === null ? [] : [node.supersedesFactId],
          eventId: event.id,
        };
      });

      return { memoryId, versions };
    }, 'LOCAL_DATA_INTEGRITY_ERROR');
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
