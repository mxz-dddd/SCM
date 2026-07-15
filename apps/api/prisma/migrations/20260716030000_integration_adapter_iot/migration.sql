-- CreateEnum
CREATE TYPE "integration"."IntegrationAdapterType" AS ENUM ('ERP', 'FINANCE');

-- CreateEnum
CREATE TYPE "integration"."IntegrationAdapterStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationAdapterCommandStatus" AS ENUM ('NORMALIZED', 'DISPATCHED', 'ACKNOWLEDGED', 'FAILED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationDeviceType" AS ENUM ('RF', 'PRINTER', 'SCALE', 'GATE', 'GPS', 'TEMPERATURE');

-- CreateEnum
CREATE TYPE "integration"."IntegrationDeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationDeviceCertificateStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationDeviceCommandStatus" AS ENUM ('QUEUED', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "integration"."adapter_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationAdapterStatus" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "adapter_type" "integration"."IntegrationAdapterType" NOT NULL,
    "vendor" VARCHAR(100) NOT NULL,
    "capabilities" JSONB NOT NULL,
    "active_version_number" INTEGER,

    CONSTRAINT "adapter_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."adapter_version" (
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
    "expected_canonical" JSONB NOT NULL,
    "test_result" JSONB,
    "tested_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "adapter_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."adapter_command" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationAdapterCommandStatus" NOT NULL DEFAULT 'NORMALIZED',
    "definition_id" UUID NOT NULL,
    "adapter_version_id" UUID NOT NULL,
    "capability" VARCHAR(30) NOT NULL,
    "direction" "integration"."IntegrationDirection" NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "external_ref" VARCHAR(200) NOT NULL,
    "vendor_payload" JSONB NOT NULL,
    "canonical_payload" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "dispatched_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(1000),

    CONSTRAINT "adapter_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."adapter_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "command_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "canonical_payload" JSONB NOT NULL,
    "vendor_response" JSONB,
    "source_version" INTEGER NOT NULL,

    CONSTRAINT "adapter_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."device" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationDeviceStatus" NOT NULL DEFAULT 'PENDING',
    "hardware_id" VARCHAR(150) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "device_type" "integration"."IntegrationDeviceType" NOT NULL,
    "capabilities" JSONB NOT NULL,
    "active_certificate_fingerprint" VARCHAR(128) NOT NULL,
    "certificate_valid_until" TIMESTAMPTZ(3) NOT NULL,
    "heartbeat_timeout_seconds" INTEGER NOT NULL DEFAULT 300,
    "telemetry_per_minute_limit" INTEGER NOT NULL DEFAULT 60,
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "firmware_version" VARCHAR(100),

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."device_certificate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationDeviceCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_id" UUID NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "rotated_to_certificate_id" UUID,

    CONSTRAINT "device_certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."device_heartbeat" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "firmware_version" VARCHAR(100),
    "health_snapshot" JSONB NOT NULL,

    CONSTRAINT "device_heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."device_command" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationDeviceCommandStatus" NOT NULL DEFAULT 'QUEUED',
    "device_id" UUID NOT NULL,
    "command_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3),
    "error_code" VARCHAR(100),

    CONSTRAINT "device_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."device_command_ack" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "outcome" VARCHAR(30) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_command_ack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."device_telemetry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_id" UUID NOT NULL,
    "telemetry_type" VARCHAR(100) NOT NULL,
    "sequence" VARCHAR(100) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "value_snapshot" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,

    CONSTRAINT "device_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."telemetry_usage_bucket" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_id" UUID NOT NULL,
    "bucket_start" TIMESTAMPTZ(3) NOT NULL,
    "sample_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "telemetry_usage_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_adapter_definition_status_idx" ON "integration"."adapter_definition"("tenant_id", "status", "adapter_type");

-- CreateIndex
CREATE UNIQUE INDEX "integration_adapter_definition_code_key" ON "integration"."adapter_definition"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "integration_adapter_version_status_idx" ON "integration"."adapter_version"("tenant_id", "definition_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_adapter_version_number_key" ON "integration"."adapter_version"("tenant_id", "definition_id", "version_number");

-- CreateIndex
CREATE INDEX "integration_adapter_command_status_idx" ON "integration"."adapter_command"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "integration_adapter_command_business_idx" ON "integration"."adapter_command"("tenant_id", "business_ref", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_adapter_command_external_key" ON "integration"."adapter_command"("tenant_id", "definition_id", "external_ref", "content_hash");

-- CreateIndex
CREATE INDEX "integration_adapter_event_command_idx" ON "integration"."adapter_event"("tenant_id", "command_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_device_status_idx" ON "integration"."device"("tenant_id", "status", "device_type");

-- CreateIndex
CREATE UNIQUE INDEX "integration_device_hardware_key" ON "integration"."device"("tenant_id", "hardware_id");

-- CreateIndex
CREATE INDEX "integration_device_certificate_status_idx" ON "integration"."device_certificate"("tenant_id", "device_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_device_certificate_fingerprint_key" ON "integration"."device_certificate"("tenant_id", "fingerprint");

-- CreateIndex
CREATE INDEX "integration_device_heartbeat_device_idx" ON "integration"."device_heartbeat"("tenant_id", "device_id", "occurred_at");

-- CreateIndex
CREATE INDEX "integration_device_command_status_idx" ON "integration"."device_command"("tenant_id", "device_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_device_command_sequence_key" ON "integration"."device_command"("tenant_id", "device_id", "sequence");

-- CreateIndex
CREATE INDEX "integration_device_command_ack_device_idx" ON "integration"."device_command_ack"("tenant_id", "device_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_device_command_ack_key" ON "integration"."device_command_ack"("tenant_id", "command_id");

-- CreateIndex
CREATE INDEX "integration_device_telemetry_device_idx" ON "integration"."device_telemetry"("tenant_id", "device_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_device_telemetry_sequence_key" ON "integration"."device_telemetry"("tenant_id", "device_id", "sequence");

-- CreateIndex
CREATE INDEX "integration_telemetry_usage_bucket_time_idx" ON "integration"."telemetry_usage_bucket"("tenant_id", "bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "integration_telemetry_usage_bucket_key" ON "integration"."telemetry_usage_bucket"("tenant_id", "device_id", "bucket_start");

ALTER TABLE "integration"."adapter_version" ADD CONSTRAINT "integration_adapter_version_number_check" CHECK ("version_number" > 0);
ALTER TABLE "integration"."device" ADD CONSTRAINT "integration_device_policy_check" CHECK ("heartbeat_timeout_seconds" BETWEEN 10 AND 86400 AND "telemetry_per_minute_limit" BETWEEN 1 AND 10000);
ALTER TABLE "integration"."device_certificate" ADD CONSTRAINT "integration_device_certificate_validity_check" CHECK ("valid_until" > "valid_from");
ALTER TABLE "integration"."device_command" ADD CONSTRAINT "integration_device_command_sequence_check" CHECK ("sequence" > 0);
ALTER TABLE "integration"."telemetry_usage_bucket" ADD CONSTRAINT "integration_telemetry_usage_count_check" CHECK ("sample_count" >= 0);

CREATE OR REPLACE FUNCTION "integration"."guard_adapter_version"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status IN ('PUBLISHED', 'RETIRED') AND (to_jsonb(OLD) - ARRAY['status','updated_at','updated_by','version']) <> (to_jsonb(NEW) - ARRAY['status','updated_at','updated_by','version'])) THEN
    RAISE EXCEPTION 'published adapter versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "integration_adapter_version_guard" BEFORE UPDATE OR DELETE ON "integration"."adapter_version" FOR EACH ROW EXECUTE FUNCTION "integration"."guard_adapter_version"();
CREATE TRIGGER "integration_adapter_event_immutable" BEFORE UPDATE OR DELETE ON "integration"."adapter_event" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_exchange_fact_mutation"();
CREATE TRIGGER "integration_device_heartbeat_immutable" BEFORE UPDATE OR DELETE ON "integration"."device_heartbeat" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_exchange_fact_mutation"();
CREATE TRIGGER "integration_device_command_ack_immutable" BEFORE UPDATE OR DELETE ON "integration"."device_command_ack" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_exchange_fact_mutation"();
CREATE TRIGGER "integration_device_telemetry_immutable" BEFORE UPDATE OR DELETE ON "integration"."device_telemetry" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_exchange_fact_mutation"();
