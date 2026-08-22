import { z } from 'zod';
import { correctionReasonSchema, normalizedMemoryTextSchema } from './memory-input.js';

export { CORRECTION_REASON_MAX_LENGTH, correctionReasonSchema } from './memory-input.js';

export const correctMemoryRequestSchema = z.object({
  text: normalizedMemoryTextSchema,
  expectedCurrentFactId: z.string().min(1),
  reason: correctionReasonSchema.optional(),
});

export const correctMemoryResponseSchema = z.object({
  memoryId: z.string(),
  current: z.object({
    factId: z.string(),
    evidenceId: z.string(),
    content: z.string(),
    recordedAt: z.string(),
    correctedAt: z.string(),
  }),
  correction: z.object({
    eventId: z.string(),
    supersedesFactId: z.string(),
    reason: z.string().nullable(),
  }),
});

export const memoryHistoryVersionSchema = z.object({
  factId: z.string(),
  evidenceId: z.string(),
  content: z.string(),
  createdAt: z.string(),
  reason: z.string().nullable(),
  isOriginal: z.boolean(),
  isCurrent: z.boolean(),
  supersedesFactId: z.string().nullable(),
  predecessorFactIds: z.array(z.string()),
  eventId: z.string(),
});

export const memoryHistoryResponseSchema = z.object({
  memoryId: z.string(),
  versions: z.array(memoryHistoryVersionSchema).min(1),
});

export type CorrectMemoryRequest = z.infer<typeof correctMemoryRequestSchema>;
export type CorrectMemoryResponse = z.infer<typeof correctMemoryResponseSchema>;
export type MemoryHistoryVersion = z.infer<typeof memoryHistoryVersionSchema>;
export type MemoryHistoryResponse = z.infer<typeof memoryHistoryResponseSchema>;
