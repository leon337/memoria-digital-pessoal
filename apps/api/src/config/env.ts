import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must be PostgreSQL'
    ),
  WEB_ORIGIN: z.string().url()
});

export interface ApiEnv {
  port: number;
  databaseUrl: string;
  webOrigin: string;
}

export function parseApiEnv(source: Record<string, unknown>): ApiEnv {
  const parsed = schema.parse(source);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    webOrigin: parsed.WEB_ORIGIN
  };
}
