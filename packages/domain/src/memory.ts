export interface TextMemoryRecord {
  readonly memory: Readonly<{
    id: string;
    recordedAt: Date;
    occurredAt: null;
    temporalPrecision: 'unknown';
  }>;
  readonly evidence: Readonly<{
    id: string;
    memoryId: string;
    kind: 'text';
    content: string;
    createdAt: Date;
  }>;
  readonly event: Readonly<{
    id: string;
    memoryId: string;
    evidenceId: string;
    type: 'MEMORY_CREATED';
    createdAt: Date;
  }>;
  readonly fact: Readonly<{
    id: string;
    memoryId: string;
    evidenceId: string;
    kind: 'autobiographical_statement';
    content: string;
    createdAt: Date;
  }>;
  readonly currentFact: Readonly<{
    factId: string;
    memoryId: string;
    evidenceId: string;
    content: string;
    recordedAt: Date;
  }>;
}

export interface CreateTextMemoryRecordInput {
  readonly text: string;
  readonly recordedAt: Date;
  readonly ids: Readonly<{
    memoryId: string;
    evidenceId: string;
    eventId: string;
    factId: string;
  }>;
}

export function createTextMemoryRecord(input: CreateTextMemoryRecordInput): TextMemoryRecord {
  const { text, recordedAt, ids } = input;

  const memory = Object.freeze({
    id: ids.memoryId,
    recordedAt,
    occurredAt: null,
    temporalPrecision: 'unknown' as const,
  });
  const evidence = Object.freeze({
    id: ids.evidenceId,
    memoryId: ids.memoryId,
    kind: 'text' as const,
    content: text,
    createdAt: recordedAt,
  });
  const event = Object.freeze({
    id: ids.eventId,
    memoryId: ids.memoryId,
    evidenceId: ids.evidenceId,
    type: 'MEMORY_CREATED' as const,
    createdAt: recordedAt,
  });
  const fact = Object.freeze({
    id: ids.factId,
    memoryId: ids.memoryId,
    evidenceId: ids.evidenceId,
    kind: 'autobiographical_statement' as const,
    content: text,
    createdAt: recordedAt,
  });
  const currentFact = Object.freeze({
    factId: ids.factId,
    memoryId: ids.memoryId,
    evidenceId: ids.evidenceId,
    content: text,
    recordedAt,
  });

  return Object.freeze({ memory, evidence, event, fact, currentFact });
}
