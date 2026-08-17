ALTER TABLE "facts" ADD COLUMN "supersedes_fact_id" UUID;

CREATE UNIQUE INDEX "facts_supersedes_fact_id_key"
ON "facts"("supersedes_fact_id");

ALTER TABLE "facts"
ADD CONSTRAINT "facts_supersedes_fact_id_fkey"
FOREIGN KEY ("supersedes_fact_id") REFERENCES "facts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_events" ADD COLUMN "fact_id" UUID;
ALTER TABLE "ledger_events" ADD COLUMN "supersedes_fact_id" UUID;
ALTER TABLE "ledger_events" ADD COLUMN "reason" VARCHAR(500);

CREATE INDEX "ledger_events_fact_id_idx" ON "ledger_events"("fact_id");
CREATE INDEX "ledger_events_supersedes_fact_id_idx" ON "ledger_events"("supersedes_fact_id");

ALTER TABLE "ledger_events"
ADD CONSTRAINT "ledger_events_fact_id_fkey"
FOREIGN KEY ("fact_id") REFERENCES "facts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_events"
ADD CONSTRAINT "ledger_events_supersedes_fact_id_fkey"
FOREIGN KEY ("supersedes_fact_id") REFERENCES "facts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_events"
ADD CONSTRAINT "ledger_events_memory_corrected_fact_links_check"
CHECK (
  "type" <> 'MEMORY_CORRECTED'
  OR ("fact_id" IS NOT NULL AND "supersedes_fact_id" IS NOT NULL)
);
