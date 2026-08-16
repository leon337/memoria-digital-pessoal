import { ServiceUnavailableException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiErrorFilter } from './api-error.filter.js';

function createHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const response = { status };
  const request = { requestId: 'request-123' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response
    })
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
        requestId: 'request-123'
      }
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('password=secret');
  });

  it('maps service unavailability safely', () => {
    const { host, json, status } = createHost();
    new ApiErrorFilter().catch(new ServiceUnavailableException('db down'), host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0]?.[0]?.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
