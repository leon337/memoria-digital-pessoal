import {
  SYNC_PROTOCOL_VERSION,
  correctMemoryRequestSchema,
  createMemoryRequestSchema,
  memoryQuerySchema,
  resolveConflictRequestSchema,
  type CorrectMemoryRequest,
  type CorrectMemoryResponse,
  type CreateMemoryResponse,
  type MemoryHistoryResponse,
  type MemoryQueryResponse,
  type ResolveConflictRequest,
  type SyncEventEnvelope,
} from '@mdp/contracts';
import {
  ConflictResolutionDomainError,
  CorrectionDomainError,
  FactGraphDomainError,
  createConflictResolutionRecord,
  createTextCorrectionRecord,
  createTextMemoryRecord,
  deriveMemoryProjection,
  orderFactGraphHistory,
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
  type LocalFactRelationRecord,
  type LocalLedgerEventRecord,
  type LocalMemoryRecord,
  type LocalSyncConflictRecord,
  type LocalSyncOutboxRecord,
} from './mdp-local-db.js';

interface IndexedDbMemoryRepositoryDependencies {
  factory?: IDBFactory;
  now?: () => Date;
  createId?: () => string;
}

type FailureFallback = 'LOCAL_STORAGE_UNAVAILABLE' | 'LOCAL_DATA_INTEGRITY_ERROR';

const MEMORY_WRITE_STORES = [
  ...PRODUCT_STORES,
  'factRelations',
  'syncOutbox',
  'syncConflicts',
];

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

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function graphProjection(
  facts: readonly LocalFactRecord[],
  relations: readonly LocalFactRelationRecord[],
) {
  try {
    return deriveMemoryProjection(
      facts.map((fact) => ({ factId: fact.id, createdAt: fact.createdAt })),
      [...relations],
    );
  } catch (error) {
    if (error instanceof FactGraphDomainError) {
      throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR', error);
    }
    throw error;
  }
}

function orderedGraphHistory(
  facts: readonly LocalFactRecord[],
  relations: readonly LocalFactRelationRecord[],
) {
  try {
    return orderFactGraphHistory(
      facts.map((fact) => ({ factId: fact.id, createdAt: fact.createdAt })),
      [...relations],
    );
  } catch (error) {
    if (error instanceof FactGraphDomainError) {
      throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR', error);
    }
    throw error;
  }
}

function pendingOutbox(envelope: SyncEventEnvelope): LocalSyncOutboxRecord {
  return {
    eventId: envelope.eventId,
    memoryId: envelope.memoryId,
    envelope,
    status: 'PENDING',
    attempt: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
  };
}

function creationEnvelope(
  record: ReturnType<typeof createTextMemoryRecord>,
): SyncEventEnvelope {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    eventId: record.event.id,
    eventType: 'MEMORY_CREATED',
    memoryId: record.memory.id,
    predecessorFactIds: [],
    records: [
      {
        kind: 'memory',
        id: record.memory.id,
        recordedAt: record.memory.recordedAt.toISOString(),
        occurredAt: null,
        temporalPrecision: 'unknown',
      },
      {
        kind: 'evidence',
        id: record.evidence.id,
        memoryId: record.evidence.memoryId,
        evidenceKind: 'text',
        content: record.evidence.content,
        createdAt: record.evidence.createdAt.toISOString(),
      },
      {
        kind: 'ledgerEvent',
        id: record.event.id,
        memoryId: record.event.memoryId,
        evidenceId: record.event.evidenceId,
        factId: null,
        supersedesFactId: null,
        eventType: 'MEMORY_CREATED',
        reason: null,
        createdAt: record.event.createdAt.toISOString(),
      },
      {
        kind: 'fact',
        id: record.fact.id,
        memoryId: record.fact.memoryId,
        evidenceId: record.fact.evidenceId,
        factKind: 'autobiographical_statement',
        content: record.fact.content,
        createdAt: record.fact.createdAt.toISOString(),
      },
    ],
  };
}

function correctionEnvelope(
  memory: LocalMemoryRecord,
  record: ReturnType<typeof createTextCorrectionRecord>,
  relation: LocalFactRelationRecord,
): SyncEventEnvelope {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    eventId: record.event.id,
    eventType: 'MEMORY_CORRECTED',
    memoryId: memory.id,
    predecessorFactIds: [relation.predecessorFactId],
    records: [
      {
        kind: 'memory',
        id: memory.id,
        recordedAt: memory.recordedAt.toISOString(),
        occurredAt: null,
        temporalPrecision: 'unknown',
      },
      {
        kind: 'evidence',
        id: record.evidence.id,
        memoryId: record.evidence.memoryId,
        evidenceKind: 'text',
        content: record.evidence.content,
        createdAt: record.evidence.createdAt.toISOString(),
      },
      {
        kind: 'ledgerEvent',
        id: record.event.id,
        memoryId: record.event.memoryId,
        evidenceId: record.event.evidenceId,
        factId: record.event.factId,
        supersedesFactId: record.event.supersedesFactId,
        eventType: 'MEMORY_CORRECTED',
        reason: record.event.reason,
        createdAt: record.event.createdAt.toISOString(),
      },
      {
        kind: 'fact',
        id: record.fact.id,
        memoryId: record.fact.memoryId,
        evidenceId: record.fact.evidenceId,
        factKind: 'autobiographical_statement',
        content: record.fact.content,
        createdAt: record.fact.createdAt.toISOString(),
      },
      {
        kind: 'factRelation',
        memoryId: relation.memoryId,
        predecessorFactId: relation.predecessorFactId,
        successorFactId: relation.successorFactId,
        relationType: 'SUPERSEDES',
      },
    ],
  };
}

function resolutionEnvelope(
  memory: LocalMemoryRecord,
  record: ReturnType<typeof createConflictResolutionRecord>,
  predecessorFactIds: string[],
): SyncEventEnvelope {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    eventId: record.event.id,
    eventType: 'CONFLICT_RESOLVED',
    memoryId: memory.id,
    predecessorFactIds,
    records: [
      {
        kind: 'memory',
        id: memory.id,
        recordedAt: memory.recordedAt.toISOString(),
        occurredAt: null,
        temporalPrecision: 'unknown',
      },
      {
        kind: 'evidence',
        id: record.evidence.id,
        memoryId: record.evidence.memoryId,
        evidenceKind: 'text',
        content: record.evidence.content,
        createdAt: record.evidence.createdAt.toISOString(),
      },
      {
        kind: 'ledgerEvent',
        id: record.event.id,
        memoryId: record.event.memoryId,
        evidenceId: record.event.evidenceId,
        factId: record.event.factId,
        supersedesFactId: null,
        eventType: 'CONFLICT_RESOLVED',
        reason: record.event.reason,
        createdAt: record.event.createdAt.toISOString(),
      },
      {
        kind: 'fact',
        id: record.fact.id,
        memoryId: record.fact.memoryId,
        evidenceId: record.fact.evidenceId,
        factKind: 'autobiographical_statement',
        content: record.fact.content,
        createdAt: record.fact.createdAt.toISOString(),
      },
      ...record.relations.map((relation) => ({
        kind: 'factRelation' as const,
        memoryId: relation.memoryId,
        predecessorFactId: relation.predecessorFactId,
        successorFactId: relation.successorFactId,
        relationType: 'SUPERSEDES' as const,
      })),
    ],
  };
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
      const envelope = creationEnvelope(record);

      const transaction = db.transaction(MEMORY_WRITE_STORES, 'readwrite');
      transaction.objectStore('memories').add(record.memory);
      transaction.objectStore('evidence').add(record.evidence);
      transaction.objectStore('ledgerEvents').add(record.event);
      transaction.objectStore('facts').add(record.fact);
      transaction.objectStore('currentFacts').add(record.currentFact);
      transaction.objectStore('syncOutbox').add(pendingOutbox(envelope));
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
      const transaction = db.transaction(
        ['currentFacts', 'syncConflicts', 'facts', 'factRelations'],
        'readonly',
      );
      const done = transactionDone(transaction);
      const currentRequest = transaction.objectStore('currentFacts').getAll();
      const conflictsRequest = transaction
        .objectStore('syncConflicts')
        .index('status')
        .getAll('OPEN');
      const factsRequest = transaction.objectStore('facts').getAll();
      const relationsRequest = transaction.objectStore('factRelations').getAll();
      const [currentFacts, conflicts, facts, relations] = await Promise.all([
        requestAsPromise<LocalCurrentFactRecord[]>(currentRequest),
        requestAsPromise<LocalSyncConflictRecord[]>(conflictsRequest),
        requestAsPromise<LocalFactRecord[]>(factsRequest),
        requestAsPromise<LocalFactRelationRecord[]>(relationsRequest),
      ]);
      await done;

      const normalized = parsed.data.toLowerCase();
      for (const conflict of conflicts) {
        const memoryFacts = facts.filter((fact) => fact.memoryId === conflict.memoryId);
        const memoryRelations = relations.filter(
          (relation) => relation.memoryId === conflict.memoryId,
        );
        const projection = graphProjection(memoryFacts, memoryRelations);
        if (
          projection.status !== 'CONFLICT' ||
          projection.baselineFactId !== conflict.baselineFactId ||
          !sameIdSet(projection.candidateFactIds, conflict.candidateFactIds)
        ) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }

        const baseline = memoryFacts.find((fact) => fact.id === projection.baselineFactId);
        const candidates = projection.candidateFactIds.map((factId) =>
          memoryFacts.find((fact) => fact.id === factId),
        );
        if (!baseline || candidates.some((candidate) => !candidate)) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
        const candidateFacts = candidates as LocalFactRecord[];
        if (
          !baseline.content.toLowerCase().includes(normalized) &&
          !candidateFacts.some((candidate) => candidate.content.toLowerCase().includes(normalized))
        ) {
          continue;
        }

        return {
          status: 'CONFLICT',
          answer: null,
          provenance: null,
          conflict: {
            memoryId: conflict.memoryId,
            baseline: {
              factId: baseline.id,
              evidenceId: baseline.evidenceId,
              content: baseline.content,
            },
            candidates: candidateFacts.map((candidate) => ({
              factId: candidate.id,
              evidenceId: candidate.evidenceId,
              content: candidate.content,
            })),
          },
        };
      }

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
      const transaction = db.transaction(MEMORY_WRITE_STORES, 'readwrite');
      const done = transactionDone(transaction);
      const memoryRequest = transaction.objectStore('memories').get(memoryId);
      const currentRequest = transaction
        .objectStore('currentFacts')
        .index('memoryId')
        .getAll(memoryId);
      const conflictRequest = transaction.objectStore('syncConflicts').get(memoryId);
      const [memory, currentRows, conflict] = await Promise.all([
        requestAsPromise<LocalMemoryRecord | undefined>(memoryRequest),
        requestAsPromise<LocalCurrentFactRecord[]>(currentRequest),
        requestAsPromise<LocalSyncConflictRecord | undefined>(conflictRequest),
      ]);

      if (!memory) {
        throw new MemoryRepositoryError('NOT_FOUND');
      }
      if (conflict?.status === 'OPEN') {
        throw new MemoryRepositoryError('CONFLICT_REQUIRES_RESOLUTION');
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

      const relation: LocalFactRelationRecord = {
        memoryId,
        predecessorFactId: current.factId,
        successorFactId: record.fact.id,
        relationType: 'SUPERSEDES',
      };
      const envelope = correctionEnvelope(memory, record, relation);

      transaction.objectStore('evidence').add(record.evidence);
      transaction.objectStore('facts').add(record.fact);
      transaction.objectStore('ledgerEvents').add(record.event);
      transaction.objectStore('factRelations').add(relation);
      transaction.objectStore('currentFacts').delete(current.factId);
      transaction.objectStore('currentFacts').add(record.currentFact);
      transaction.objectStore('syncOutbox').add(pendingOutbox(envelope));
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

  async resolveConflict(
    memoryId: string,
    request: ResolveConflictRequest,
  ): Promise<CorrectMemoryResponse> {
    const parsed = resolveConflictRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new MemoryRepositoryError('VALIDATION_FAILED');
    }

    return this.withMappedFailure(async () => {
      const db = await this.database();
      const transaction = db.transaction(MEMORY_WRITE_STORES, 'readwrite');
      const done = transactionDone(transaction);
      const memoryRequest = transaction.objectStore('memories').get(memoryId);
      const conflictRequest = transaction.objectStore('syncConflicts').get(memoryId);
      const factsRequest = transaction.objectStore('facts').index('memoryId').getAll(memoryId);
      const relationsRequest = transaction
        .objectStore('factRelations')
        .index('memoryId')
        .getAll(memoryId);
      const currentRequest = transaction
        .objectStore('currentFacts')
        .index('memoryId')
        .getAll(memoryId);
      const [memory, conflict, facts, relations, currentRows] = await Promise.all([
        requestAsPromise<LocalMemoryRecord | undefined>(memoryRequest),
        requestAsPromise<LocalSyncConflictRecord | undefined>(conflictRequest),
        requestAsPromise<LocalFactRecord[]>(factsRequest),
        requestAsPromise<LocalFactRelationRecord[]>(relationsRequest),
        requestAsPromise<LocalCurrentFactRecord[]>(currentRequest),
      ]);

      if (!memory) {
        throw new MemoryRepositoryError('NOT_FOUND');
      }
      if (
        conflict?.status !== 'OPEN' ||
        !sameIdSet(conflict.candidateFactIds, parsed.data.expectedCandidateFactIds)
      ) {
        throw new MemoryRepositoryError('CONFLICT_REQUIRES_RESOLUTION');
      }
      if (currentRows.length !== 0) {
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }

      const projection = graphProjection(facts, relations);
      if (
        projection.status !== 'CONFLICT' ||
        projection.baselineFactId !== conflict.baselineFactId ||
        !sameIdSet(projection.candidateFactIds, conflict.candidateFactIds)
      ) {
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }

      const resolvedAt = this.now();
      let record;
      try {
        record = createConflictResolutionRecord({
          memoryId,
          baselineFactId: projection.baselineFactId,
          candidateFactIds: projection.candidateFactIds,
          text: parsed.data.text,
          ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
          resolvedAt,
          ids: {
            evidenceId: this.nextId(),
            eventId: this.nextId(),
            factId: this.nextId(),
          },
        });
      } catch (error) {
        if (error instanceof ConflictResolutionDomainError || error instanceof CorrectionDomainError) {
          throw new MemoryRepositoryError('VALIDATION_FAILED', error);
        }
        throw error;
      }

      const canonicalCandidates = [...projection.candidateFactIds].sort();
      const localFact: LocalFactRecord = {
        id: record.fact.id,
        memoryId: record.fact.memoryId,
        evidenceId: record.fact.evidenceId,
        kind: record.fact.kind,
        content: record.fact.content,
        createdAt: record.fact.createdAt,
      };
      const localEvent: LocalLedgerEventRecord = {
        id: record.event.id,
        memoryId: record.event.memoryId,
        evidenceId: record.event.evidenceId,
        factId: record.event.factId,
        type: 'CONFLICT_RESOLVED',
        reason: record.event.reason,
        createdAt: record.event.createdAt,
      };
      const currentFact: LocalCurrentFactRecord = {
        factId: record.fact.id,
        memoryId,
        evidenceId: record.evidence.id,
        content: record.fact.content,
        recordedAt: memory.recordedAt,
      };
      const envelope = resolutionEnvelope(memory, record, canonicalCandidates);

      transaction.objectStore('evidence').add(record.evidence);
      transaction.objectStore('facts').add(localFact);
      transaction.objectStore('ledgerEvents').add(localEvent);
      for (const relation of record.relations) {
        transaction.objectStore('factRelations').add(relation);
      }
      transaction.objectStore('currentFacts').add(currentFact);
      transaction.objectStore('syncConflicts').put({
        ...conflict,
        status: 'RESOLVED',
        resolutionFactId: record.fact.id,
        updatedAt: resolvedAt,
      } satisfies LocalSyncConflictRecord);
      transaction.objectStore('syncOutbox').add(pendingOutbox(envelope));
      await done;

      return {
        memoryId,
        current: {
          factId: currentFact.factId,
          evidenceId: currentFact.evidenceId,
          content: currentFact.content,
          recordedAt: currentFact.recordedAt.toISOString(),
          correctedAt: record.fact.createdAt.toISOString(),
        },
        correction: {
          eventId: record.event.id,
          supersedesFactId: projection.baselineFactId,
          reason: record.event.reason,
        },
      };
    }, 'LOCAL_DATA_INTEGRITY_ERROR');
  }

  async history(memoryId: string): Promise<MemoryHistoryResponse> {
    return this.withMappedFailure(async () => {
      const db = await this.database();
      const transaction = db.transaction(
        [...PRODUCT_STORES, 'factRelations', 'syncConflicts'],
        'readonly',
      );
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
      const relationsRequest = transaction
        .objectStore('factRelations')
        .index('memoryId')
        .getAll(memoryId);
      const conflictRequest = transaction.objectStore('syncConflicts').get(memoryId);

      const [memory, evidence, events, facts, currentRows, relations, conflict] = await Promise.all([
        requestAsPromise<LocalMemoryRecord | undefined>(memoryRequest),
        requestAsPromise<LocalEvidenceRecord[]>(evidenceRequest),
        requestAsPromise<LocalLedgerEventRecord[]>(eventsRequest),
        requestAsPromise<LocalFactRecord[]>(factsRequest),
        requestAsPromise<LocalCurrentFactRecord[]>(currentRequest),
        requestAsPromise<LocalFactRelationRecord[]>(relationsRequest),
        requestAsPromise<LocalSyncConflictRecord | undefined>(conflictRequest),
      ]);
      await done;

      if (
        !memory ||
        memory.occurredAt !== null ||
        memory.temporalPrecision !== 'unknown' ||
        facts.length === 0
      ) {
        if (!memory) {
          throw new MemoryRepositoryError('NOT_FOUND');
        }
        throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
      }

      const evidenceById = new Map(evidence.map((item) => [item.id, item]));
      const factsById = new Map(facts.map((item) => [item.id, item]));
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

      const projection = graphProjection(facts, relations);
      const ordered = orderedGraphHistory(facts, relations);
      let current: LocalCurrentFactRecord | undefined;
      if (projection.status === 'RESOLVED') {
        if (currentRows.length !== 1 || conflict?.status === 'OPEN') {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
        current = currentRows[0];
        if (
          !current ||
          current.factId !== projection.currentFactId ||
          current.memoryId !== memoryId ||
          !datesEqual(current.recordedAt, memory.recordedAt)
        ) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
        if (conflict?.status === 'RESOLVED' && conflict.resolutionFactId !== current.factId) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
        const currentFact = factsById.get(current.factId);
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
      } else {
        if (
          currentRows.length !== 0 ||
          conflict?.status !== 'OPEN' ||
          conflict.baselineFactId !== projection.baselineFactId ||
          !sameIdSet(conflict.candidateFactIds, projection.candidateFactIds)
        ) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
      }

      const versions = ordered.map((node) => {
        const fact = factsById.get(node.factId);
        if (!fact) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
        const isCurrent = projection.status === 'RESOLVED' && node.factId === projection.currentFactId;

        if (node.predecessorFactIds.length === 0) {
          const creationEvents = events.filter(
            (event) => event.type === 'MEMORY_CREATED' && event.evidenceId === fact.evidenceId,
          );
          const event = creationEvents[0];
          if (
            creationEvents.length !== 1 ||
            !event ||
            event.memoryId !== memoryId ||
            event.factId !== undefined ||
            event.supersedesFactId !== undefined
          ) {
            throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
          }
          return {
            factId: fact.id,
            evidenceId: fact.evidenceId,
            content: fact.content,
            createdAt: fact.createdAt.toISOString(),
            reason: null,
            isOriginal: true,
            isCurrent,
            supersedesFactId: null,
            predecessorFactIds: [],
            eventId: event.id,
          };
        }

        if (node.predecessorFactIds.length === 1) {
          const predecessorFactId = node.predecessorFactIds[0]!;
          const correctionEvents = events.filter(
            (event) => event.type === 'MEMORY_CORRECTED' && event.factId === fact.id,
          );
          const event = correctionEvents[0];
          if (
            correctionEvents.length !== 1 ||
            !event ||
            event.memoryId !== memoryId ||
            event.evidenceId !== fact.evidenceId ||
            event.supersedesFactId !== predecessorFactId
          ) {
            throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
          }
          return {
            factId: fact.id,
            evidenceId: fact.evidenceId,
            content: fact.content,
            createdAt: fact.createdAt.toISOString(),
            reason: event.reason ?? null,
            isOriginal: false,
            isCurrent,
            supersedesFactId: predecessorFactId,
            predecessorFactIds: node.predecessorFactIds,
            eventId: event.id,
          };
        }

        const resolutionEvents = events.filter(
          (event) => event.type === 'CONFLICT_RESOLVED' && event.factId === fact.id,
        );
        const event = resolutionEvents[0];
        if (
          resolutionEvents.length !== 1 ||
          !event ||
          event.memoryId !== memoryId ||
          event.evidenceId !== fact.evidenceId ||
          event.supersedesFactId !== undefined
        ) {
          throw new MemoryRepositoryError('LOCAL_DATA_INTEGRITY_ERROR');
        }
        return {
          factId: fact.id,
          evidenceId: fact.evidenceId,
          content: fact.content,
          createdAt: fact.createdAt.toISOString(),
          reason: event.reason ?? null,
          isOriginal: false,
          isCurrent,
          supersedesFactId: null,
          predecessorFactIds: node.predecessorFactIds,
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
