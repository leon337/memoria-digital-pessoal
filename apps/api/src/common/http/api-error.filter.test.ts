import { ServiceUnavailableException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiErrorFilter } from './api-error.filter.js';
import { CodedHttpException } from './api-error.js';

function createHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const response = { status };
  const request = { requestId: 'request-123' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('ApiErrorFilter', () => {
  it('hides internal exception content', () => {
    const { host, json, status } = createHost();
    new ApiErrorFilter().catch(new Error('password=secret'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro interno.',
        requestId: 'request-123',
      },
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('password=secret');
  });

  it('maps service unavailability safely', () => {
    const { host, json, status } = createHost();
    new ApiErrorFilter().catch(new ServiceUnavailableException('db down'), host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0]?.[0]?.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it.each([
    ['STALE_CORRECTION', 409, 'A lembrança mudou desde a última consulta.'],
    ['NO_CHANGE', 422, 'A correção não altera o texto atual.'],
  ] as const)('preserves coded error %s', (code, expectedStatus, safeMessage) => {
    const { host, json, status } = createHost();
    new ApiErrorFilter().catch(new CodedHttpException(code, expectedStatus, safeMessage), host);

    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json).toHaveBeenCalledWith({
      error: { code, message: safeMessage, requestId: 'request-123' },
    });
  });
});
