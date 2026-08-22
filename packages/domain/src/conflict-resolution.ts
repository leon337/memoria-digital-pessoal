import { normalizeCorrectionReason, normalizeCorrectionText } from './correction.js';

export type ConflictResolutionDomainErrorCode = 'INVALID_CANDIDATES';

export class ConflictResolutionDomainError extends Error {
  constructor(readonly code: ConflictResolutionDomainErrorCode) {
    super(code);
    this.name = 'ConflictResolutionDomainError';
  }
}

export interface CreateConflictResolutionRecordInput {
  readonly memoryId: string;
  readonly baselineFactId: string;
  readonly candidateFactIds: readonly string[];
  readonly text: string;
  readonly reason?: string;
  readonly resolvedAt: Date;
  readonly ids: Readonly<{
    evidenceId: string;
    eventId: string;
    factId: string;
  }>;
}

export interface ConflictResolutionRecord {
  readonly evidence: Readonly<{
    id: string;
    memoryId: string;
    kind: 'text';
    content: string;
    createdAt: Date;
  }>;
  readonly fact: Readonly<{
    id: string;
    memoryId: string;
    evidenceId: string;
    kind: 'autobiographical_statement';
    content: string;
    supersedesFactId: null;
    createdAt: Date;
  }>;
  readonly event: Readonly<{
    id: string;
    memoryId: string;
    evidenceId: string;
    factId: string;
    supersedesFactId: null;
    type: 'CONFLICT_RESOLVED';
    reason: string | null;
    createdAt: Date;
  }>;
  readonly relations: readonly Readonly<{
    memoryId: string;
    predecessorFactId: string;
    successorFactId: string;
    relationType: 'SUPERSEDES';
  }>[];
  readonly baselineFactId: string;
}

export function createConflictResolutionRecord(
  input: CreateConflictResolutionRecordInput,
): ConflictResolutionRecord {
  const candidates = [...new Set(input.candidateFactIds)].sort();
  if (candidates.length < 2) {
    throw new ConflictResolutionDomainError('INVALID_CANDIDATES');
  }

  const content = normalizeCorrectionText(input.text);
  const reason = normalizeCorrectionReason(input.reason);

  const evidence = Object.freeze({
    id: input.ids.evidenceId,
    memoryId: input.memoryId,
    kind: 'text' as const,
    content,
    createdAt: input.resolvedAt,
  });
  const fact = Object.freeze({
    id: input.ids.factId,
    memoryId: input.memoryId,
    evidenceId: input.ids.evidenceId,
    kind: 'autobiographical_statement' as const,
    content,
    supersedesFactId: null,
    createdAt: input.resolvedAt,
  });
  const event = Object.freeze({
    id: input.ids.eventId,
    memoryId: input.memoryId,
    evidenceId: input.ids.evidenceId,
    factId: input.ids.factId,
    supersedesFactId: null,
    type: 'CONFLICT_RESOLVED' as const,
    reason,
    createdAt: input.resolvedAt,
  });
  const relations = Object.freeze(
    candidates.map((predecessorFactId) =>
      Object.freeze({
        memoryId: input.memoryId,
        predecessorFactId,
        successorFactId: input.ids.factId,
        relationType: 'SUPERSEDES' as const,
      }),
    ),
  );

  return Object.freeze({
    evidence,
    fact,
    event,
    relations,
    baselineFactId: input.baselineFactId,
  });
}
