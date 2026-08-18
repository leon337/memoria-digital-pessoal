import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must be PostgreSQL',
    ),
  WEB_ORIGIN: z.string().url(),
  SYNC_MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
  SYNC_OUTBOX_MAX_ENTRIES: z.coerce.number().int().min(1).max(1_000_000).default(10000),
  SYNC_BOOTSTRAP_TTL_SECONDS: z.coerce.number().int().min(1).max(86400).default(900),
});

export interface ApiEnv {
  port: number;
  databaseUrl: string;
  webOrigin: string;
  syncMaxBatchSize: number;
  syncOutboxMaxEntries: number;
  syncBootstrapTtlSeconds: number;
}

export function parseApiEnv(source: Record<string, unknown>): ApiEnv {
  const parsed = schema.parse(source);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    webOrigin: parsed.WEB_ORIGIN,
    syncMaxBatchSize: parsed.SYNC_MAX_BATCH_SIZE,
    syncOutboxMaxEntries: parsed.SYNC_OUTBOX_MAX_ENTRIES,
    syncBootstrapTtlSeconds: parsed.SYNC_BOOTSTRAP_TTL_SECONDS,
  };
}
