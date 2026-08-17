import { expect, it } from 'vitest';
import { apiErrorEnvelopeSchema } from './api-error.js';

it.each(['STALE_CORRECTION', 'NO_CHANGE', 'SERVICE_UNAVAILABLE'] as const)(
  'parses stable error code %s',
  (code) => {
    expect(
      apiErrorEnvelopeSchema.parse({
        error: { code, message: 'safe', requestId: 'request-1' },
      }).error.code,
    ).toBe(code);
  },
);

it('rejects unknown error codes', () => {
  expect(
    apiErrorEnvelopeSchema.safeParse({
      error: { code: 'SOMETHING_ELSE', message: 'safe', requestId: 'request-1' },
    }).success,
  ).toBe(false);
});
