-- CreateEnum
CREATE TYPE "integration"."IntegrationExchangeStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'PARTIAL', 'FAILED', 'ACKNOWLEDGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationLineStatus" AS ENUM ('PENDING', 'PROCESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "integration"."IntegrationMappingStatus" AS ENUM ('DRAFT', 'TESTED', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationWebhookStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'RETRY_WAIT', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "integration"."IntegrationMessageStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER', 'REPLAYED');

-- CreateTable
CREATE TABLE "integration"."file_exchange" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationExchangeStatus" NOT NULL DEFAULT 'RECEIVED',
    "direction" "integration"."IntegrationDirection" NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "partner_ref" VARCHAR(200) NOT NULL,
    "business_ref" VARCHAR(200),
    "file_name" VARCHAR(255) NOT NULL,
    "directory" VARCHAR(500) NOT NULL,
    "format" VARCHAR(30) NOT NULL,
    "encryption" VARCHAR(30) NOT NULL,
    "content_digest" CHAR(64) NOT NULL,
    "object_ref" VARCHAR(500) NOT NULL,
    "line_count" INTEGER NOT NULL,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "acknowledged_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "file_exchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."file_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationLineStatus" NOT NULL DEFAULT 'PENDING',
    "file_exchange_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "business_ref" VARCHAR(200),
    "source_payload" JSONB NOT NULL,
    "result_payload" JSONB,
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(1000),

    CONSTRAINT "file_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."ack_message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "file_exchange_id" UUID NOT NULL,
    "ack_type" VARCHAR(30) NOT NULL,
    "payload" JSONB NOT NULL,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "ack_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."webhook_subscription" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationWebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" VARCHAR(200) NOT NULL,
    "endpoint_url" VARCHAR(500) NOT NULL,
    "event_types" JSONB NOT NULL,
    "object_scopes" JSONB NOT NULL DEFAULT '[]',
    "secret_hash" CHAR(64) NOT NULL,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "base_delay_seconds" INTEGER NOT NULL DEFAULT 30,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."delivery_attempt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "subscription_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "signature" VARCHAR(128) NOT NULL,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" VARCHAR(200),
    "lease_expires_at" TIMESTAMPTZ(3),
    "response_status" INTEGER,
    "response_digest" CHAR(64),
    "error_message" VARCHAR(1000),
    "delivered_at" TIMESTAMPTZ(3),

    CONSTRAINT "delivery_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."mapping_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationMappingStatus" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "source_system" VARCHAR(100) NOT NULL,
    "target_object" VARCHAR(100) NOT NULL,
    "active_version_number" INTEGER,

    CONSTRAINT "mapping_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."mapping_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationMappingStatus" NOT NULL DEFAULT 'DRAFT',
    "definition_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "sample_input" JSONB NOT NULL,
    "expected_output" JSONB NOT NULL,
    "test_result" JSONB,
    "tested_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "mapping_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."transform_result" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "mapping_version_id" UUID NOT NULL,
    "message_id" UUID,
    "source_payload" JSONB NOT NULL,
    "output_payload" JSONB NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_snapshot" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "transform_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."integration_message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "direction" "integration"."IntegrationDirection" NOT NULL,
    "channel" VARCHAR(30) NOT NULL,
    "message_type" VARCHAR(200) NOT NULL,
    "business_ref" VARCHAR(200),
    "correlation_id" VARCHAR(100) NOT NULL,
    "source_ref" UUID,
    "replay_of_message_id" UUID,
    "mapping_version_id" UUID,
    "original_payload" JSONB NOT NULL,
    "processed_payload" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(1000),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "integration_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."replay_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "original_message_id" UUID NOT NULL,
    "replay_message_id" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "mapping_version_id" UUID,

    CONSTRAINT "replay_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_file_exchange_status_idx" ON "integration"."file_exchange"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_file_exchange_digest_key" ON "integration"."file_exchange"("tenant_id", "partner_ref", "content_digest");

-- CreateIndex
CREATE INDEX "integration_file_line_status_idx" ON "integration"."file_line"("tenant_id", "file_exchange_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_file_line_number_key" ON "integration"."file_line"("tenant_id", "file_exchange_id", "line_number");

-- CreateIndex
CREATE INDEX "integration_ack_message_created_idx" ON "integration"."ack_message"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_ack_message_type_key" ON "integration"."ack_message"("tenant_id", "file_exchange_id", "ack_type");

-- CreateIndex
CREATE INDEX "integration_webhook_subscription_status_idx" ON "integration"."webhook_subscription"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "integration_delivery_attempt_due_idx" ON "integration"."delivery_attempt"("tenant_id", "status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_delivery_attempt_number_key" ON "integration"."delivery_attempt"("tenant_id", "subscription_id", "message_id", "attempt_number");

-- CreateIndex
CREATE INDEX "integration_mapping_definition_status_idx" ON "integration"."mapping_definition"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_mapping_definition_code_key" ON "integration"."mapping_definition"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "integration_mapping_version_status_idx" ON "integration"."mapping_version"("tenant_id", "definition_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_mapping_version_number_key" ON "integration"."mapping_version"("tenant_id", "definition_id", "version_number");

-- CreateIndex
CREATE INDEX "integration_transform_result_mapping_idx" ON "integration"."transform_result"("tenant_id", "mapping_version_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_message_status_idx" ON "integration"."integration_message"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "integration_message_business_idx" ON "integration"."integration_message"("tenant_id", "business_ref", "created_at");

-- CreateIndex
CREATE INDEX "integration_replay_record_original_idx" ON "integration"."replay_record"("tenant_id", "original_message_id", "created_at");

ALTER TABLE "integration"."file_exchange" ADD CONSTRAINT "integration_file_counts_check" CHECK ("line_count" >= 0 AND "processed_count" >= 0 AND "rejected_count" >= 0 AND "processed_count" + "rejected_count" <= "line_count");
ALTER TABLE "integration"."file_line" ADD CONSTRAINT "integration_file_line_number_check" CHECK ("line_number" > 0);
ALTER TABLE "integration"."webhook_subscription" ADD CONSTRAINT "integration_webhook_retry_check" CHECK ("max_attempts" BETWEEN 1 AND 20 AND "base_delay_seconds" BETWEEN 1 AND 86400);
ALTER TABLE "integration"."delivery_attempt" ADD CONSTRAINT "integration_delivery_attempt_number_check" CHECK ("attempt_number" > 0);
ALTER TABLE "integration"."mapping_version" ADD CONSTRAINT "integration_mapping_version_number_check" CHECK ("version_number" > 0);
ALTER TABLE "integration"."integration_message" ADD CONSTRAINT "integration_message_metrics_check" CHECK ("attempt_count" >= 0 AND ("duration_ms" IS NULL OR "duration_ms" >= 0));

CREATE OR REPLACE FUNCTION "integration"."reject_exchange_fact_mutation"()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'integration exchange facts are immutable' USING ERRCODE = '55000'; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "integration"."guard_mapping_version"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status IN ('PUBLISHED', 'RETIRED') AND (to_jsonb(OLD) - ARRAY['status','updated_at','updated_by','version']) <> (to_jsonb(NEW) - ARRAY['status','updated_at','updated_by','version'])) THEN
    RAISE EXCEPTION 'published mapping versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "integration"."guard_original_message"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.original_payload <> NEW.original_payload OR OLD.replay_of_message_id IS DISTINCT FROM NEW.replay_of_message_id THEN
    RAISE EXCEPTION 'original integration messages are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "integration"."guard_file_line_source"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.source_payload <> NEW.source_payload OR OLD.file_exchange_id <> NEW.file_exchange_id OR OLD.line_number <> NEW.line_number THEN
    RAISE EXCEPTION 'original file lines are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "integration_ack_message_immutable" BEFORE UPDATE OR DELETE ON "integration"."ack_message" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_exchange_fact_mutation"();
CREATE TRIGGER "integration_transform_result_immutable" BEFORE UPDATE OR DELETE ON "integration"."transform_result" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_exchange_fact_mutation"();
CREATE TRIGGER "integration_replay_record_immutable" BEFORE UPDATE OR DELETE ON "integration"."replay_record" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_exchange_fact_mutation"();
CREATE TRIGGER "integration_mapping_version_guard" BEFORE UPDATE OR DELETE ON "integration"."mapping_version" FOR EACH ROW EXECUTE FUNCTION "integration"."guard_mapping_version"();
CREATE TRIGGER "integration_message_original_guard" BEFORE UPDATE OR DELETE ON "integration"."integration_message" FOR EACH ROW EXECUTE FUNCTION "integration"."guard_original_message"();
CREATE TRIGGER "integration_file_line_source_guard" BEFORE UPDATE OR DELETE ON "integration"."file_line" FOR EACH ROW EXECUTE FUNCTION "integration"."guard_file_line_source"();
