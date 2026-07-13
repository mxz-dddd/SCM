-- CreateEnum
CREATE TYPE "platform"."JobTriggerType" AS ENUM ('ONCE', 'CRON', 'EVENT');

-- CreateEnum
CREATE TYPE "platform"."JobDefinitionStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "platform"."JobRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "platform"."JobLogLevel" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "platform"."job_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."JobDefinitionStatus" NOT NULL DEFAULT 'ACTIVE',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "handler" VARCHAR(100) NOT NULL,
    "trigger_type" "platform"."JobTriggerType" NOT NULL,
    "cron_expression" VARCHAR(100),
    "event_name" VARCHAR(150),
    "run_at" TIMESTAMPTZ(3),
    "concurrency_limit" INTEGER NOT NULL DEFAULT 1,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 300,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "backoff_seconds" INTEGER NOT NULL DEFAULT 30,
    "default_payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "job_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."job_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."JobRunStatus" NOT NULL DEFAULT 'QUEUED',
    "job_definition_id" UUID NOT NULL,
    "definition_version" INTEGER NOT NULL,
    "handler" VARCHAR(100) NOT NULL,
    "trigger_type" "platform"."JobTriggerType" NOT NULL,
    "trigger_ref" VARCHAR(200),
    "payload" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "timeout_seconds" INTEGER NOT NULL,
    "backoff_seconds" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "heartbeat_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "lease_owner" VARCHAR(200),
    "lease_expires_at" TIMESTAMPTZ(3),
    "cancellation_reason" VARCHAR(500),
    "failure_code" VARCHAR(100),
    "result" JSONB NOT NULL DEFAULT '{}',
    "result_file_object_id" UUID,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."job_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "job_run_id" UUID NOT NULL,
    "level" "platform"."JobLogLevel" NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "job_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_definition_tenant_status_trigger_idx" ON "platform"."job_definition"("tenant_id", "status", "trigger_type");

-- CreateIndex
CREATE UNIQUE INDEX "job_definition_tenant_code_key" ON "platform"."job_definition"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "job_run_tenant_definition_status_scheduled_idx" ON "platform"."job_run"("tenant_id", "job_definition_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "job_run_tenant_status_lease_idx" ON "platform"."job_run"("tenant_id", "status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "job_log_tenant_run_created_idx" ON "platform"."job_log"("tenant_id", "job_run_id", "created_at");

CREATE TRIGGER job_log_immutable
BEFORE UPDATE OR DELETE ON "platform"."job_log"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();
