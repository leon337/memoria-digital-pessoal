import {
  apiErrorEnvelopeSchema,
  correctMemoryResponseSchema,
  createMemoryResponseSchema,
  memoryHistoryResponseSchema,
  memoryQueryResponseSchema,
  type ApiErrorCode,
  type CorrectMemoryRequest,
  type CorrectMemoryResponse,
  type CreateMemoryResponse,
  type MemoryHistoryResponse,
  type MemoryQueryResponse,
} from '@mdp/contracts';

export class MemoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | null = null,
    message = 'Memory API request failed',
  ) {
    super(message);
    this.name = 'MemoryApiError';
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  let code: ApiErrorCode | null = null;
  let message = 'Memory API request failed';
  try {
    const parsed = apiErrorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
    }
  } catch {
    // Keep the safe generic error when the response body is absent or malformed.
  }

  throw new MemoryApiError(response.status, code, message);
}

export async function createMemory(baseUrl: string, text: string): Promise<CreateMemoryResponse> {
  const response = await fetch(endpoint(baseUrl, '/memories'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  await throwIfNotOk(response);
  return createMemoryResponseSchema.parse(await response.json());
}

export async function queryMemory(baseUrl: string, query: string): Promise<MemoryQueryResponse> {
  const search = new URLSearchParams({ q: query });
  const response = await fetch(endpoint(baseUrl, `/query?${search.toString()}`));
  await throwIfNotOk(response);
  return memoryQueryResponseSchema.parse(await response.json());
}

export async function correctMemory(
  baseUrl: string,
  memoryId: string,
  request: CorrectMemoryRequest,
): Promise<CorrectMemoryResponse> {
  const response = await fetch(
    endpoint(baseUrl, `/memories/${encodeURIComponent(memoryId)}/corrections`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  );
  await throwIfNotOk(response);
  return correctMemoryResponseSchema.parse(await response.json());
}

export async function getMemoryHistory(
  baseUrl: string,
  memoryId: string,
): Promise<MemoryHistoryResponse> {
  const response = await fetch(
    endpoint(baseUrl, `/memories/${encodeURIComponent(memoryId)}/history`),
  );
  await throwIfNotOk(response);
  return memoryHistoryResponseSchema.parse(await response.json());
}
