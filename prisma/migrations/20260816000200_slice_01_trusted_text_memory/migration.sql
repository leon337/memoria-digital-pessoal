-- SLICE 01 — Trusted Text Memory
-- Exactly five product tables are authorized in this boundary.

CREATE TABLE "memories" (
    "id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3),
    "temporal_precision" VARCHAR(32) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_events" (
    "id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ledger_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "facts" (
    "id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "current_facts" (
    "fact_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "current_facts_pkey" PRIMARY KEY ("fact_id")
);

CREATE INDEX "evidence_memory_id_idx" ON "evidence"("memory_id");
CREATE INDEX "ledger_events_memory_id_idx" ON "ledger_events"("memory_id");
CREATE INDEX "facts_memory_id_idx" ON "facts"("memory_id");
CREATE INDEX "current_facts_recorded_at_fact_id_idx" ON "current_facts"("recorded_at", "fact_id");

ALTER TABLE "evidence"
    ADD CONSTRAINT "evidence_memory_id_fkey"
    FOREIGN KEY ("memory_id") REFERENCES "memories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_events"
    ADD CONSTRAINT "ledger_events_memory_id_fkey"
    FOREIGN KEY ("memory_id") REFERENCES "memories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_events"
    ADD CONSTRAINT "ledger_events_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "facts"
    ADD CONSTRAINT "facts_memory_id_fkey"
    FOREIGN KEY ("memory_id") REFERENCES "memories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "facts"
    ADD CONSTRAINT "facts_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "current_facts"
    ADD CONSTRAINT "current_facts_fact_id_fkey"
    FOREIGN KEY ("fact_id") REFERENCES "facts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "current_facts"
    ADD CONSTRAINT "current_facts_memory_id_fkey"
    FOREIGN KEY ("memory_id") REFERENCES "memories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "current_facts"
    ADD CONSTRAINT "current_facts_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
