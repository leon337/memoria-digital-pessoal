import {
  createMemoryResponseSchema,
  memoryQueryResponseSchema,
  type CreateMemoryResponse,
  type MemoryQueryResponse,
} from '@mdp/contracts';

export class MemoryApiError extends Error {
  constructor(
    readonly status: number,
    message = 'Memory API request failed',
  ) {
    super(message);
    this.name = 'MemoryApiError';
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export async function createMemory(
  baseUrl: string,
  text: string,
): Promise<CreateMemoryResponse> {
  const response = await fetch(endpoint(baseUrl, '/memories'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new MemoryApiError(response.status);
  }
  return createMemoryResponseSchema.parse(await response.json());
}

export async function queryMemory(
  baseUrl: string,
  query: string,
): Promise<MemoryQueryResponse> {
  const search = new URLSearchParams({ q: query });
  const response = await fetch(endpoint(baseUrl, `/query?${search.toString()}`));
  if (!response.ok) {
    throw new MemoryApiError(response.status);
  }
  return memoryQueryResponseSchema.parse(await response.json());
}
