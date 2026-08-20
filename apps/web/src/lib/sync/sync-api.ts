import {
  apiErrorEnvelopeSchema,
  syncBootstrapPageResponseSchema,
  syncBootstrapStartResponseSchema,
  syncErrorCodeSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncBootstrapPageResponse,
  type SyncBootstrapStartRequest,
  type SyncBootstrapStartResponse,
  type SyncCursor,
  type SyncErrorCode,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@mdp/contracts';

export class SyncApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: SyncErrorCode | null = null,
    message = 'Synchronization request failed',
  ) {
    super(message);
    this.name = 'SyncApiError';
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) return;

  let code: SyncErrorCode | null = null;
  let message = 'Synchronization request failed';

  try {
    const parsedEnvelope = apiErrorEnvelopeSchema.safeParse(await response.json());
    if (parsedEnvelope.success) {
      const parsedCode = syncErrorCodeSchema.safeParse(parsedEnvelope.data.error.code);
      if (parsedCode.success) {
        code = parsedCode.data;
        message = parsedEnvelope.data.error.message;
      }
    }
  } catch {
    // Preserve the safe generic error for absent or malformed response bodies.
  }

  throw new SyncApiError(response.status, code, message);
}

export class SyncApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const response = await this.fetchFn(endpoint(this.baseUrl, '/sync/v1/push'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    await throwIfNotOk(response);
    return syncPushResponseSchema.parse(await response.json());
  }

  async pull(after: SyncCursor, limit: number): Promise<SyncPullResponse> {
    const query = new URLSearchParams({ after, limit: String(limit) });
    const response = await this.fetchFn(
      endpoint(this.baseUrl, `/sync/v1/pull?${query.toString()}`),
      { cache: 'no-store' },
    );
    await throwIfNotOk(response);
    return syncPullResponseSchema.parse(await response.json());
  }

  async startBootstrap(request: SyncBootstrapStartRequest): Promise<SyncBootstrapStartResponse> {
    const response = await this.fetchFn(endpoint(this.baseUrl, '/sync/v1/bootstrap/start'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
    await throwIfNotOk(response);
    return syncBootstrapStartResponseSchema.parse(await response.json());
  }

  async readBootstrapPage(
    bootstrapToken: string,
    offset: number,
    limit: number,
  ): Promise<SyncBootstrapPageResponse> {
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    const response = await this.fetchFn(
      endpoint(
        this.baseUrl,
        `/sync/v1/bootstrap/${encodeURIComponent(bootstrapToken)}?${query.toString()}`,
      ),
      { cache: 'no-store' },
    );
    await throwIfNotOk(response);
    return syncBootstrapPageResponseSchema.parse(await response.json());
  }
}
