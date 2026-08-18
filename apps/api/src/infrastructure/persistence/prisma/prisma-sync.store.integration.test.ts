import type { SyncEventEnvelope } from '@mdp/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaSyncStore } from './prisma-sync.store.js';
import { PrismaService } from './prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for integration test');
}

const service = new PrismaService({ databaseUrl });
const store = new PrismaSyncStore({ prisma: service });
const clientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ids = {
  memoryId: '33333333-3333-4333-8333-333333333331',
  rootEvidenceId: '33333333-3333-4333-8333-333333333332',
  rootEventId: '33333333-3333-4333-8333-333333333333',
  rootFactId: '33333333-3333-4333-8333-333333333334',
  branchBEvidenceId: '44444444-4444-4444-8444-444444444441',
  branchBEventId: '44444444-4444-4444-8444-444444444442',
  branchBFactId: '44444444-4444-4444-8444-444444444443',
  branchCEvidenceId: '55555555-5555-4555-8555-555555555551',
  branchCEventId: '55555555-5555-4555-8555-555555555552',
  branchCFactId: '55555555-5555-4555-8555-555555555553',
  missingFactId: '66666666-6666-4666-8666-666666666661',
  missingEvidenceId: '66666666-6666-4666-8666-666666666662',
  missingEventId: '66666666-6666-4666-8666-666666666663',
  missingSuccessorFactId: '66666666-6666-4666-8666-666666666664',
} as const;

const recordedAt = '2026-08-18T03:00:00.000Z';

function memoryRecord() {
  return {
    kind: 'memory' as const,
    id: ids.memoryId,
    recordedAt,
    occurredAt: null,
    temporalPrecision: 'unknown' as const,
  };
}

function createEnvelope(text = 'Raiz sintética.'): SyncEventEnvelope {
  return {
    protocolVersion: 1,
    eventId: ids.rootEventId,
    eventType: 'MEMORY_CREATED',
    memoryId: ids.memoryId,
    predecessorFactIds: [],
    records: [
      memoryRecord(),
      {
        kind: 'evidence',
        id: ids.rootEvidenceId,
        memoryId: ids.memoryId,
        evidenceKind: 'text',
        content: text,
        createdAt: recordedAt,
      },
      {
        kind: 'ledgerEvent',
        id: ids.rootEventId,
        memoryId: ids.memoryId,
        evidenceId: ids.rootEvidenceId,
        factId: null,
        supersedesFactId: null,
        eventType: 'MEMORY_CREATED',
        reason: null,
        createdAt: recordedAt,
      },
      {
        kind: 'fact',
        id: ids.rootFactId,
        memoryId: ids.memoryId,
        evidenceId: ids.rootEvidenceId,
        factKind: 'autobiographical_statement',
        content: text,
        createdAt: recordedAt,
      },
    ],
  };
}

function correctionEnvelope(input: {
  eventId: string;
  evidenceId: string;
  factId: string;
  predecessorFactId: string;
  text: string;
  createdAt: string;
}): SyncEventEnvelope {
  return {
    protocolVersion: 1,
    eventId: input.eventId,
    eventType: 'MEMORY_CORRECTED',
    memoryId: ids.memoryId,
    predecessorFactIds: [input.predecessorFactId],
    records: [
      memoryRecord(),
      {
        kind: 'evidence',
        id: input.evidenceId,
        memoryId: ids.memoryId,
        evidenceKind: 'text',
        content: input.text,
        createdAt: input.createdAt,
      },
      {
        kind: 'ledgerEvent',
        id: input.eventId,
        memoryId: ids.memoryId,
        evidenceId: input.evidenceId,
        factId: input.factId,
        supersedesFactId: input.predecessorFactId,
        eventType: 'MEMORY_CORRECTED',
        reason: null,
        createdAt: input.createdAt,
      },
      {
        kind: 'fact',
        id: input.factId,
        memoryId: ids.memoryId,
        evidenceId: input.evidenceId,
        factKind: 'autobiographical_statement',
        content: input.text,
        createdAt: input.createdAt,
      },
      {
        kind: 'factRelation',
        memoryId: ids.memoryId,
        predecessorFactId: input.predecessorFactId,
        successorFactId: input.factId,
        relationType: 'SUPERSEDES',
      },
    ],
  };
}

async function clearSynchronizationData(): Promise<void> {
  await service.run(async (client) => {
    await client.$transaction(async (tx) => {
      await tx.syncOutbox.deleteMany();
      await tx.syncConflict.deleteMany();
      await tx.syncBootstrapSnapshot.deleteMany();
      await tx.factRelation.deleteMany();
      await tx.currentFact.deleteMany();
      await tx.ledgerEvent.deleteMany();
      await tx.fact.deleteMany();
      await tx.evidence.deleteMany();
      await tx.memory.deleteMany();
      await tx.syncFeedState.update({ where: { id: 1 }, data: { currentSequence: 0n } });
    });
  });
}

beforeEach(clearSynchronizationData);

afterAll(async () => {
  await clearSynchronizationData();
  await service.close();
});

describe('PrismaSyncStore integration', () => {
  it('returns APPLIED and exact replay ALREADY_APPLIED', async () => {
    const envelope = createEnvelope();

    await expect(store.pushEvent(clientId, envelope)).resolves.toEqual({
      eventId: ids.rootEventId,
      status: 'APPLIED',
    });
    await expect(store.pushEvent(clientId, envelope)).resolves.toEqual({
      eventId: ids.rootEventId,
      status: 'ALREADY_APPLIED',
    });
  });

  it('returns INVALID when the same eventId is reused with a changed payload', async () => {
    await store.pushEvent(clientId, createEnvelope());

    await expect(store.pushEvent(clientId, createEnvelope('Payload alterado.'))).resolves.toEqual({
      eventId: ids.rootEventId,
      status: 'INVALID',
      code: 'SYNC_INTEGRITY_VIOLATION',
    });
  });

  it('returns sorted unique missing predecessors without partially applying the event', async () => {
    await store.pushEvent(clientId, createEnvelope());
    const envelope = correctionEnvelope({
      eventId: ids.missingEventId,
      evidenceId: ids.missingEvidenceId,
      factId: ids.missingSuccessorFactId,
      predecessorFactId: ids.missingFactId,
      text: 'Depende de predecessor ausente.',
      createdAt: '2026-08-18T03:01:00.000Z',
    });

    await expect(store.pushEvent(clientId, envelope)).resolves.toEqual({
      eventId: ids.missingEventId,
      status: 'DEPENDENCY_MISSING',
      missingFactIds: [ids.missingFactId],
    });
    await service.run(async (client) => {
      await expect(client.fact.findUnique({ where: { id: ids.missingSuccessorFactId } })).resolves.toBeNull();
      await expect(client.syncOutbox.findUnique({ where: { eventId: ids.missingEventId } })).resolves.toBeNull();
    });
  });

  it('durably accepts a concurrent branch as CONFLICT and replays it idempotently', async () => {
    await store.pushEvent(clientId, createEnvelope());
    const branchB = correctionEnvelope({
      eventId: ids.branchBEventId,
      evidenceId: ids.branchBEvidenceId,
      factId: ids.branchBFactId,
      predecessorFactId: ids.rootFactId,
      text: 'Ramo B.',
      createdAt: '2026-08-18T03:02:00.000Z',
    });
    const branchC = correctionEnvelope({
      eventId: ids.branchCEventId,
      evidenceId: ids.branchCEvidenceId,
      factId: ids.branchCFactId,
      predecessorFactId: ids.rootFactId,
      text: 'Ramo C.',
      createdAt: '2026-08-18T03:03:00.000Z',
    });

    await expect(store.pushEvent(clientId, branchB)).resolves.toEqual({
      eventId: ids.branchBEventId,
      status: 'APPLIED',
    });
    await expect(store.pushEvent(clientId, branchC)).resolves.toEqual({
      eventId: ids.branchCEventId,
      status: 'CONFLICT',
    });
    await expect(store.pushEvent(clientId, branchC)).resolves.toEqual({
      eventId: ids.branchCEventId,
      status: 'ALREADY_APPLIED',
    });

    await service.run(async (client) => {
      await expect(client.syncConflict.findUnique({ where: { memoryId: ids.memoryId } })).resolves.toMatchObject({
        baselineFactId: ids.rootFactId,
        candidateFactIds: [ids.branchBFactId, ids.branchCFactId],
        status: 'OPEN',
      });
      await expect(client.currentFact.count({ where: { memoryId: ids.memoryId } })).resolves.toBe(0);
      await expect(client.syncOutbox.findUnique({ where: { eventId: ids.branchCEventId } })).resolves.not.toBeNull();
    });
  });
});
