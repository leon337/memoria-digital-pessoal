import { z } from 'zod';

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'STALE_CORRECTION',
  'NO_CHANGE',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
