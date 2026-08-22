import { z } from 'zod';

export const MEMORY_TEXT_MAX_LENGTH = 4000;
export const CORRECTION_REASON_MAX_LENGTH = 500;

export const memoryTextSchema = z
  .string()
  .min(1)
  .max(MEMORY_TEXT_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, 'text must contain non-whitespace content');

export const normalizedMemoryTextSchema = memoryTextSchema.transform((value) => value.trim());

export const correctionReasonSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(CORRECTION_REASON_MAX_LENGTH));
