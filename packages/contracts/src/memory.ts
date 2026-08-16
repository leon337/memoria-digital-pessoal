import { z } from 'zod';

export const MEMORY_TEXT_MAX_LENGTH = 4000;
export const MEMORY_QUERY_MAX_LENGTH = 200;

export const createMemoryRequestSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(MEMORY_TEXT_MAX_LENGTH)
    .refine(
      (value) => value.trim().length > 0,
      'text must contain non-whitespace content',
    ),
});

export const memoryQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_QUERY_MAX_LENGTH);

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
]);

export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;
export type CreateMemoryResponse = z.infer<typeof createMemoryResponseSchema>;
export type GetMemoryResponse = z.infer<typeof getMemoryResponseSchema>;
export type MemoryQueryResponse = z.infer<typeof memoryQueryResponseSchema>;
