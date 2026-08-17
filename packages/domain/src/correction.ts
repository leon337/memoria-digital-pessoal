export type CorrectionDomainErrorCode =
  'EMPTY_CORRECTION' | 'TEXT_TOO_LONG' | 'NO_CHANGE' | 'REASON_TOO_LONG' | 'BROKEN_HISTORY';

export class CorrectionDomainError extends Error {
  constructor(readonly code: CorrectionDomainErrorCode) {
    super(code);
    this.name = 'CorrectionDomainError';
  }
}

export interface CreateTextCorrectionRecordInput {
  readonly memoryId: string;
  readonly previous: Readonly<{
    factId: string;
    evidenceId: string;
    content: string;
    recordedAt: Date;
  }>;
  readonly text: string;
  readonly reason?: string;
  readonly correctedAt: Date;
  readonly ids: Readonly<{
    evidenceId: string;
    eventId: string;
    factId: string;
  }>;
}

export interface TextCorrectionRecord {
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
    supersedesFactId: string;
    createdAt: Date;
  }>;
  readonly event: Readonly<{
    id: string;
    memoryId: string;
    evidenceId: string;
    factId: string;
    supersedesFactId: string;
    type: 'MEMORY_CORRECTED';
    reason: string | null;
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

export interface TextFactHistoryNode {
  readonly factId: string;
  readonly evidenceId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly supersedesFactId: string | null;
}

export type OrderedTextFactHistoryNode = TextFactHistoryNode & {
  readonly isOriginal: boolean;
  readonly isCurrent: boolean;
};

export function createTextCorrectionRecord(
  input: CreateTextCorrectionRecordInput,
): TextCorrectionRecord {
  const content = input.text.trim();
  if (content.length === 0) {
    throw new CorrectionDomainError('EMPTY_CORRECTION');
  }
  if (content.length > 4000) {
    throw new CorrectionDomainError('TEXT_TOO_LONG');
  }
  if (content === input.previous.content.trim()) {
    throw new CorrectionDomainError('NO_CHANGE');
  }

  const normalizedReason = input.reason?.trim() ?? '';
  if (normalizedReason.length > 500) {
    throw new CorrectionDomainError('REASON_TOO_LONG');
  }

  const evidence = Object.freeze({
    id: input.ids.evidenceId,
    memoryId: input.memoryId,
    kind: 'text' as const,
    content,
    createdAt: input.correctedAt,
  });
  const fact = Object.freeze({
    id: input.ids.factId,
    memoryId: input.memoryId,
    evidenceId: input.ids.evidenceId,
    kind: 'autobiographical_statement' as const,
    content,
    supersedesFactId: input.previous.factId,
    createdAt: input.correctedAt,
  });
  const event = Object.freeze({
    id: input.ids.eventId,
    memoryId: input.memoryId,
    evidenceId: input.ids.evidenceId,
    factId: input.ids.factId,
    supersedesFactId: input.previous.factId,
    type: 'MEMORY_CORRECTED' as const,
    reason: normalizedReason.length === 0 ? null : normalizedReason,
    createdAt: input.correctedAt,
  });
  const currentFact = Object.freeze({
    factId: input.ids.factId,
    memoryId: input.memoryId,
    evidenceId: input.ids.evidenceId,
    content,
    recordedAt: input.previous.recordedAt,
  });

  return Object.freeze({ evidence, fact, event, currentFact });
}

export function orderTextFactHistory(
  nodes: readonly TextFactHistoryNode[],
  currentFactId: string,
): OrderedTextFactHistoryNode[] {
  const roots = nodes.filter((node) => node.supersedesFactId === null);
  if (roots.length !== 1) {
    throw new CorrectionDomainError('BROKEN_HISTORY');
  }

  const successor = new Map<string, TextFactHistoryNode>();
  for (const node of nodes) {
    if (node.supersedesFactId === null) {
      continue;
    }
    if (successor.has(node.supersedesFactId)) {
      throw new CorrectionDomainError('BROKEN_HISTORY');
    }
    successor.set(node.supersedesFactId, node);
  }

  const ordered: TextFactHistoryNode[] = [];
  const visited = new Set<string>();
  let cursor: TextFactHistoryNode | undefined = roots[0];
  while (cursor) {
    if (visited.has(cursor.factId)) {
      throw new CorrectionDomainError('BROKEN_HISTORY');
    }
    visited.add(cursor.factId);
    ordered.push(cursor);
    cursor = successor.get(cursor.factId);
  }

  if (ordered.length !== nodes.length || ordered.at(-1)?.factId !== currentFactId) {
    throw new CorrectionDomainError('BROKEN_HISTORY');
  }

  return ordered.map((node, index) => ({
    ...node,
    isOriginal: index === 0,
    isCurrent: node.factId === currentFactId,
  }));
}
