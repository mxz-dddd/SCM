CREATE TYPE "oms"."OrderExceptionStatus" AS ENUM ('OPEN','ASSIGNED','IN_PROGRESS','RETRYING','COMPENSATING','RESOLVED','CLOSED');
CREATE TYPE "oms"."OrderExceptionSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE "oms"."SlaClockStatus" AS ENUM ('ACTIVE','PAUSED','WARNING','BREACHED','COMPLETED','CANCELLED');
CREATE TYPE "oms"."SlaStage" AS ENUM ('CONFIRMATION','ALLOCATION','RELEASE','SHIPMENT','DELIVERY');
CREATE TYPE "oms"."SettlementRequestStatus" AS ENUM ('REQUESTED','ACCEPTED','REJECTED','CANCELLED');

CREATE TABLE "oms"."order_exception_case" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OrderExceptionStatus" NOT NULL DEFAULT 'OPEN', "business_order_id" UUID NOT NULL, "exception_type" VARCHAR(100) NOT NULL,
  "dedupe_key" VARCHAR(300) NOT NULL, "severity" "oms"."OrderExceptionSeverity" NOT NULL DEFAULT 'MEDIUM', "responsible_domain" VARCHAR(50) NOT NULL,
  "assigned_to" UUID, "description" VARCHAR(1000) NOT NULL, "source_ref" VARCHAR(300), "retry_command" JSONB, "compensation_command" JSONB,
  "last_attempt_at" TIMESTAMPTZ(3), "attempt_count" INTEGER NOT NULL DEFAULT 0, "resolution" VARCHAR(1000), "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "order_exception_case_pkey" PRIMARY KEY ("id"), CONSTRAINT "order_exception_values_valid" CHECK ("version">0 AND "attempt_count">=0 AND length(btrim("description"))>0)
);
CREATE UNIQUE INDEX "order_exception_dedupe_key" ON "oms"."order_exception_case"("tenant_id","dedupe_key");
CREATE INDEX "order_exception_workbench_idx" ON "oms"."order_exception_case"("tenant_id","status","severity","created_at");
CREATE INDEX "order_exception_order_idx" ON "oms"."order_exception_case"("tenant_id","business_order_id","status");

CREATE TABLE "oms"."sla_clock" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."SlaClockStatus" NOT NULL DEFAULT 'ACTIVE', "business_order_id" UUID NOT NULL, "stage" "oms"."SlaStage" NOT NULL,
  "source_version" INTEGER NOT NULL, "responsible_domain" VARCHAR(50) NOT NULL, "calendar_code" VARCHAR(100) NOT NULL, "calendar_snapshot" JSONB NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL, "warning_at" TIMESTAMPTZ(3) NOT NULL, "due_at" TIMESTAMPTZ(3) NOT NULL, "paused_at" TIMESTAMPTZ(3),
  "paused_seconds" INTEGER NOT NULL DEFAULT 0, "pause_reason" VARCHAR(500), "breached_at" TIMESTAMPTZ(3), "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "sla_clock_pkey" PRIMARY KEY ("id"), CONSTRAINT "sla_clock_values_valid" CHECK ("version">0 AND "source_version">0 AND "paused_seconds">=0 AND "warning_at">="started_at" AND "due_at">="warning_at" AND jsonb_typeof("calendar_snapshot")='object')
);
CREATE UNIQUE INDEX "sla_clock_order_stage_key" ON "oms"."sla_clock"("tenant_id","business_order_id","stage");
CREATE INDEX "sla_clock_monitor_idx" ON "oms"."sla_clock"("tenant_id","status","warning_at","due_at");

CREATE TABLE "oms"."sla_breach_event" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE', "sla_clock_id" UUID NOT NULL, "business_order_id" UUID NOT NULL,
  "stage" "oms"."SlaStage" NOT NULL, "responsible_domain" VARCHAR(50) NOT NULL, "breached_at" TIMESTAMPTZ(3) NOT NULL,
  "overdue_seconds" INTEGER NOT NULL, "escalation_level" INTEGER NOT NULL,
  CONSTRAINT "sla_breach_event_pkey" PRIMARY KEY ("id"), CONSTRAINT "sla_breach_values_valid" CHECK ("version">0 AND "overdue_seconds">=0 AND "escalation_level">0)
);
CREATE INDEX "sla_breach_order_idx" ON "oms"."sla_breach_event"("tenant_id","business_order_id","breached_at");

CREATE TABLE "oms"."settlement_request" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."SettlementRequestStatus" NOT NULL DEFAULT 'REQUESTED', "request_no" VARCHAR(100) NOT NULL, "business_order_id" UUID NOT NULL,
  "order_version" INTEGER NOT NULL, "source_version" INTEGER NOT NULL DEFAULT 0, "currency" CHAR(3) NOT NULL, "commercial_amount" DECIMAL(24,6) NOT NULL, "discount_amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
  "service_amount" DECIMAL(24,6) NOT NULL DEFAULT 0, "requested_amount" DECIMAL(24,6) NOT NULL, "commercial_snapshot" JSONB NOT NULL,
  "fulfillment_snapshot" JSONB NOT NULL, "billing_reference" VARCHAR(200), "rejection_reason" VARCHAR(1000),
  CONSTRAINT "settlement_request_pkey" PRIMARY KEY ("id"), CONSTRAINT "settlement_request_values_valid" CHECK ("version">0 AND "order_version">0 AND "commercial_amount">=0 AND "discount_amount">=0 AND "service_amount">=0 AND "requested_amount">=0 AND jsonb_typeof("commercial_snapshot")='object' AND jsonb_typeof("fulfillment_snapshot")='object')
);
CREATE UNIQUE INDEX "settlement_request_tenant_no_key" ON "oms"."settlement_request"("tenant_id","request_no");
CREATE UNIQUE INDEX "settlement_request_order_version_key" ON "oms"."settlement_request"("tenant_id","business_order_id","order_version");
CREATE INDEX "settlement_request_status_idx" ON "oms"."settlement_request"("tenant_id","status","created_at");

CREATE TABLE "oms"."charge_fact_ref" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE', "settlement_request_id" UUID NOT NULL, "source_domain" VARCHAR(50) NOT NULL,
  "fact_type" VARCHAR(100) NOT NULL, "fact_id" VARCHAR(200) NOT NULL, "fact_snapshot" JSONB NOT NULL,
  CONSTRAINT "charge_fact_ref_pkey" PRIMARY KEY ("id"), CONSTRAINT "charge_fact_values_valid" CHECK ("version">0 AND jsonb_typeof("fact_snapshot")='object')
);
CREATE UNIQUE INDEX "charge_fact_ref_key" ON "oms"."charge_fact_ref"("tenant_id","settlement_request_id","source_domain","fact_type","fact_id");

CREATE TABLE "oms"."batch_command_result" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."ReleaseBatchStatus" NOT NULL DEFAULT 'PROCESSING', "action" VARCHAR(50) NOT NULL, "requested_count" INTEGER NOT NULL,
  "succeeded_count" INTEGER NOT NULL DEFAULT 0, "failed_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "batch_command_result_pkey" PRIMARY KEY ("id"), CONSTRAINT "batch_command_values_valid" CHECK ("version">0 AND "requested_count">0 AND "succeeded_count">=0 AND "failed_count">=0 AND "succeeded_count"+"failed_count"<="requested_count")
);
CREATE INDEX "batch_command_actor_idx" ON "oms"."batch_command_result"("tenant_id","created_by","created_at");

CREATE TABLE "oms"."batch_command_item" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE', "batch_command_result_id" UUID NOT NULL, "business_order_id" UUID NOT NULL,
  "succeeded" BOOLEAN NOT NULL, "result_snapshot" JSONB NOT NULL, "error_code" VARCHAR(100), "error_message" VARCHAR(1000),
  CONSTRAINT "batch_command_item_pkey" PRIMARY KEY ("id"), CONSTRAINT "batch_command_item_values_valid" CHECK ("version">0 AND jsonb_typeof("result_snapshot")='object')
);
CREATE UNIQUE INDEX "batch_command_item_order_key" ON "oms"."batch_command_item"("tenant_id","batch_command_result_id","business_order_id");

CREATE TRIGGER "sla_breach_event_immutable" BEFORE UPDATE OR DELETE ON "oms"."sla_breach_event" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "charge_fact_ref_immutable" BEFORE UPDATE OR DELETE ON "oms"."charge_fact_ref" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "batch_command_item_immutable" BEFORE UPDATE OR DELETE ON "oms"."batch_command_item" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
