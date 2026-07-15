CREATE TYPE "platform"."EventConsumerMode" AS ENUM ('EVERY_EVENT', 'LATEST_STATE');
CREATE TYPE "platform"."EventDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED', 'DEAD_LETTER');

CREATE TABLE "platform"."event_delivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "platform"."EventDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "event_id" UUID NOT NULL,
  "consumer" VARCHAR(150) NOT NULL,
  "endpoint" VARCHAR(500) NOT NULL,
  "partition_key" VARCHAR(250) NOT NULL,
  "aggregate_type" VARCHAR(100) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "source_occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "source_event_created_at" TIMESTAMPTZ(3) NOT NULL,
  "mode" "platform"."EventConsumerMode" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" VARCHAR(200),
  "lease_expires_at" TIMESTAMPTZ(3),
  "processed_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(1000),
  "response_snapshot" JSONB,
  CONSTRAINT "event_delivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_delivery_versions_positive" CHECK ("version" > 0 AND "aggregate_version" > 0),
  CONSTRAINT "event_delivery_attempts_valid" CHECK ("attempt_count" >= 0 AND "max_attempts" > 0),
  CONSTRAINT "event_delivery_endpoint_internal" CHECK ("endpoint" LIKE '/api/v1/%')
);

CREATE UNIQUE INDEX "event_delivery_tenant_event_consumer_key"
ON "platform"."event_delivery"("tenant_id", "event_id", "consumer");

CREATE INDEX "event_delivery_claim_idx"
ON "platform"."event_delivery"("tenant_id", "status", "available_at", "lease_expires_at");

CREATE INDEX "event_delivery_partition_order_idx"
ON "platform"."event_delivery"("tenant_id", "consumer", "partition_key", "source_occurred_at", "source_event_created_at", "event_id");

CREATE INDEX "event_delivery_event_status_idx"
ON "platform"."event_delivery"("tenant_id", "event_id", "status");

CREATE OR REPLACE FUNCTION "platform"."protect_terminal_event_delivery"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('PROCESSED', 'IGNORED', 'DEAD_LETTER') THEN
    RAISE EXCEPTION 'terminal event delivery records cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('PROCESSED', 'IGNORED') THEN
    RAISE EXCEPTION 'successful event delivery records are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'DEAD_LETTER' AND NEW.status NOT IN ('PENDING', 'IGNORED') THEN
    RAISE EXCEPTION 'dead-letter delivery requires replay or skip transition' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_delivery_terminal_immutable
BEFORE UPDATE OR DELETE ON "platform"."event_delivery"
FOR EACH ROW EXECUTE FUNCTION "platform"."protect_terminal_event_delivery"();
