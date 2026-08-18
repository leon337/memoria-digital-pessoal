import { z } from 'zod';
import {
  correctionReasonSchema,
  memoryTextSchema,
  MEMORY_TEXT_MAX_LENGTH,
  normalizedMemoryTextSchema,
} from './memory-input.js';

export { MEMORY_TEXT_MAX_LENGTH, memoryTextSchema } from './memory-input.js';
export const MEMORY_QUERY_MAX_LENGTH = 200;

export const createMemoryRequestSchema = z.object({
  text: memoryTextSchema,
});

export const memoryQuerySchema = z.string().trim().min(1).max(MEMORY_QUERY_MAX_LENGTH);

export const createMemoryResponseSchema = z.object({
  memory: z.object({
    id: z.string(),
    recordedAt: z.string(),
  }),
  fact: z.object({
    id: z.string(),
    content: z.string(),
  }),
  provenance: z.object({
    evidenceId: z.string(),
  }),
});

export const getMemoryResponseSchema = z.object({
  memory: z.object({
    id: z.string(),
    recordedAt: z.string(),
    occurredAt: z.null(),
    temporalPrecision: z.literal('unknown'),
  }),
  evidence: z.object({
    id: z.string(),
    kind: z.literal('text'),
    content: z.string(),
    createdAt: z.string(),
  }),
  fact: z.object({
    id: z.string(),
    kind: z.literal('autobiographical_statement'),
    content: z.string(),
    createdAt: z.string(),
  }),
});

const conflictFactSchema = z.object({
  factId: z.string(),
  evidenceId: z.string(),
  content: z.string(),
});

export const memoryQueryResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('FOUND'),
    answer: z.string(),
    provenance: z.object({
      memoryId: z.string(),
      evidenceId: z.string(),
      factId: z.string(),
    }),
  }),
  z.object({
    status: z.literal('UNKNOWN'),
    answer: z.null(),
    provenance: z.null(),
  }),
  z.object({
    status: z.literal('CONFLICT'),
    answer: z.null(),
    provenance: z.null(),
    conflict: z.object({
      memoryId: z.string(),
      baseline: conflictFactSchema,
      candidates: z.array(conflictFactSchema).min(2),
    }),
  }),
]);

export const resolveConflictRequestSchema = z.object({
  expectedCandidateFactIds: z
    .array(z.string().uuid())
    .min(2)
    .refine((ids) => new Set(ids).size === ids.length, 'candidate fact ids must be distinct'),
  text: normalizedMemoryTextSchema,
  reason: correctionReasonSchema.optional(),
});

export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;
export type CreateMemoryResponse = z.infer<typeof createMemoryResponseSchema>;
export type GetMemoryResponse = z.infer<typeof getMemoryResponseSchema>;
export type MemoryQueryResponse = z.infer<typeof memoryQueryResponseSchema>;
export type ResolveConflictRequest = z.infer<typeof resolveConflictRequestSchema>;
