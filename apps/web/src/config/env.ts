import { z } from 'zod';

const schema = z.object({
  VITE_API_BASE_URL: z.string().url(),
});

export interface WebEnv {
  apiBaseUrl: string;
}

export function parseWebEnv(source: Record<string, unknown>): WebEnv {
  const parsed = schema.parse(source);
  return { apiBaseUrl: parsed.VITE_API_BASE_URL };
}

export function getWebEnv(): WebEnv {
  return parseWebEnv(import.meta.env);
}
