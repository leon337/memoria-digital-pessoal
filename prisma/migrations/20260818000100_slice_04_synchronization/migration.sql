DROP INDEX IF EXISTS "facts_supersedes_fact_id_key";
CREATE UNIQUE INDEX "facts_id_memory_id_key" ON "facts"("id", "memory_id");

CREATE TABLE "fact_relations" (
  "memory_id" UUID NOT NULL,
  "predecessor_fact_id" UUID NOT NULL,
  "successor_fact_id" UUID NOT NULL,
  "relation_type" VARCHAR(32) NOT NULL,
  CONSTRAINT "fact_relations_pkey" PRIMARY KEY ("predecessor_fact_id", "successor_fact_id"),
  CONSTRAINT "fact_relations_no_self_edge_check" CHECK ("predecessor_fact_id" <> "successor_fact_id"),
  CONSTRAINT "fact_relations_type_check" CHECK ("relation_type" = 'SUPERSEDES'),
  CONSTRAINT "fact_relations_predecessor_fkey" FOREIGN KEY ("predecessor_fact_id", "memory_id") REFERENCES "facts"("id", "memory_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fact_relations_successor_fkey" FOREIGN KEY ("successor_fact_id", "memory_id") REFERENCES "facts"("id", "memory_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fact_relations_memory_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "fact_relations_memory_id_idx" ON "fact_relations"("memory_id");
CREATE INDEX "fact_relations_predecessor_idx" ON "fact_relations"("predecessor_fact_id");
CREATE INDEX "fact_relations_successor_idx" ON "fact_relations"("successor_fact_id");

INSERT INTO "fact_relations" ("memory_id", "predecessor_fact_id", "successor_fact_id", "relation_type")
SELECT "memory_id", "supersedes_fact_id", "id", 'SUPERSEDES'
FROM "facts"
WHERE "supersedes_fact_id" IS NOT NULL;

CREATE TABLE "sync_feed_state" (
  "id" INTEGER NOT NULL,
  "current_sequence" BIGINT NOT NULL,
  CONSTRAINT "sync_feed_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sync_feed_state_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "sync_feed_state_sequence_check" CHECK ("current_sequence" >= 0)
);
INSERT INTO "sync_feed_state" ("id", "current_sequence") VALUES (1, 0);

CREATE TABLE "sync_outbox" (
  "sequence" BIGINT NOT NULL,
  "event_id" UUID NOT NULL,
  "protocol_version" INTEGER NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "memory_id" UUID NOT NULL,
  "origin_client_instance_id" UUID,
  "payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sync_outbox_pkey" PRIMARY KEY ("sequence"),
  CONSTRAINT "sync_outbox_event_id_key" UNIQUE ("event_id"),
  CONSTRAINT "sync_outbox_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "sync_outbox_protocol_check" CHECK ("protocol_version" > 0),
  CONSTRAINT "sync_outbox_memory_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "sync_outbox_memory_id_idx" ON "sync_outbox"("memory_id");
CREATE INDEX "sync_outbox_created_at_idx" ON "sync_outbox"("created_at");

CREATE TABLE "sync_conflicts" (
  "memory_id" UUID NOT NULL,
  "baseline_fact_id" UUID NOT NULL,
  "candidate_fact_ids" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "resolution_fact_id" UUID,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("memory_id"),
  CONSTRAINT "sync_conflicts_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED')),
  CONSTRAINT "sync_conflicts_candidates_array_check" CHECK (jsonb_typeof("candidate_fact_ids") = 'array'),
  CONSTRAINT "sync_conflicts_memory_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sync_conflicts_baseline_fkey" FOREIGN KEY ("baseline_fact_id") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sync_conflicts_resolution_fkey" FOREIGN KEY ("resolution_fact_id") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "sync_bootstrap_snapshots" (
  "token" UUID NOT NULL,
  "high_watermark" BIGINT NOT NULL,
  "records" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sync_bootstrap_snapshots_pkey" PRIMARY KEY ("token"),
  CONSTRAINT "sync_bootstrap_snapshots_watermark_check" CHECK ("high_watermark" >= 0),
  CONSTRAINT "sync_bootstrap_snapshots_records_array_check" CHECK (jsonb_typeof("records") = 'array')
);
CREATE INDEX "sync_bootstrap_snapshots_expires_at_idx" ON "sync_bootstrap_snapshots"("expires_at");

ALTER TABLE "ledger_events"
ADD CONSTRAINT "ledger_events_conflict_resolved_fact_link_check"
CHECK (
  "type" <> 'CONFLICT_RESOLVED'
  OR ("fact_id" IS NOT NULL AND "supersedes_fact_id" IS NULL)
);
