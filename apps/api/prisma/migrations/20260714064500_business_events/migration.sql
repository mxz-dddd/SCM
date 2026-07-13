ALTER TYPE "platform"."OutboxStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "platform"."OutboxStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';

CREATE TYPE "platform"."EventInboxStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

ALTER TABLE "platform"."outbox"
  ADD COLUMN "trace_id" VARCHAR(100),
  ADD COLUMN "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "partition_key" VARCHAR(250),
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lease_owner" VARCHAR(200),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_error" VARCHAR(1000),
  ADD COLUMN "dead_lettered_at" TIMESTAMPTZ(3);

UPDATE "platform"."outbox"
SET "trace_id" = "correlation_id",
    "partition_key" = "aggregate_type" || ':' || "aggregate_id"::text;

ALTER TABLE "platform"."outbox"
  ALTER COLUMN "trace_id" SET NOT NULL,
  ALTER COLUMN "partition_key" SET NOT NULL,
  ADD CONSTRAINT "outbox_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
  ADD CONSTRAINT "outbox_max_attempts_positive" CHECK ("max_attempts" > 0);

CREATE OR REPLACE FUNCTION "platform"."complete_business_event_envelope"()
RETURNS TRIGGER AS $$
BEGIN
  NEW.trace_id := COALESCE(NULLIF(NEW.trace_id, ''), NEW.correlation_id);
  NEW.partition_key := COALESCE(
    NULLIF(NEW.partition_key, ''),
    NEW.aggregate_type || ':' || NEW.aggregate_id::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbox_complete_business_event_envelope
BEFORE INSERT ON "platform"."outbox"
FOR EACH ROW EXECUTE FUNCTION "platform"."complete_business_event_envelope"();

CREATE INDEX "platform_outbox_relay_idx"
ON "platform"."outbox"("tenant_id", "status", "available_at", "lease_expires_at");

CREATE INDEX "platform_outbox_partition_version_idx"
ON "platform"."outbox"("tenant_id", "partition_key", "aggregate_version");

CREATE TABLE "platform"."event_inbox" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "platform"."EventInboxStatus" NOT NULL DEFAULT 'PROCESSING',
  "consumer" VARCHAR(150) NOT NULL,
  "event_id" UUID NOT NULL,
  "event_type" VARCHAR(150) NOT NULL,
  "aggregate_type" VARCHAR(100) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "trace_id" VARCHAR(100) NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "result" JSONB NOT NULL DEFAULT '{}',
  "failure_code" VARCHAR(100),
  "processed_at" TIMESTAMPTZ(3),
  CONSTRAINT "event_inbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_inbox_versions_positive" CHECK ("version" > 0 AND "aggregate_version" > 0 AND "schema_version" > 0),
  CONSTRAINT "event_inbox_payload_object" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE UNIQUE INDEX "event_inbox_tenant_consumer_event_key"
ON "platform"."event_inbox"("tenant_id", "consumer", "event_id");

CREATE INDEX "event_inbox_consumer_status_idx"
ON "platform"."event_inbox"("tenant_id", "consumer", "status", "created_at");

CREATE INDEX "event_inbox_aggregate_version_idx"
ON "platform"."event_inbox"("tenant_id", "consumer", "aggregate_type", "aggregate_id", "aggregate_version");

CREATE TABLE "platform"."consumer_checkpoint" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "consumer" VARCHAR(150) NOT NULL,
  "aggregate_type" VARCHAR(100) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "last_version" INTEGER NOT NULL,
  "last_event_id" UUID NOT NULL,
  CONSTRAINT "consumer_checkpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consumer_checkpoint_versions_positive" CHECK ("version" > 0 AND "last_version" > 0)
);

CREATE UNIQUE INDEX "consumer_checkpoint_aggregate_key"
ON "platform"."consumer_checkpoint"("tenant_id", "consumer", "aggregate_type", "aggregate_id");

CREATE INDEX "consumer_checkpoint_updated_idx"
ON "platform"."consumer_checkpoint"("tenant_id", "consumer", "updated_at");

CREATE OR REPLACE FUNCTION "platform"."reject_terminal_event_inbox_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('PROCESSED', 'IGNORED') THEN
    RAISE EXCEPTION 'terminal event inbox records are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_inbox_terminal_immutable
BEFORE UPDATE OR DELETE ON "platform"."event_inbox"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_terminal_event_inbox_mutation"();
