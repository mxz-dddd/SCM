-- CreateEnum
CREATE TYPE "control"."ControlReconciliationType" AS ENUM ('ORDER_FULFILLMENT', 'INVENTORY_MOVEMENT', 'SHIPMENT_POD', 'BILLING_VOUCHER');

-- CreateEnum
CREATE TYPE "control"."ControlReconciliationSide" AS ENUM ('SOURCE', 'TARGET');

-- CreateEnum
CREATE TYPE "control"."ControlReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "control"."ControlReconciliationOutcome" AS ENUM ('MATCHED', 'MISMATCH', 'MISSING_SOURCE', 'MISSING_TARGET');

-- CreateEnum
CREATE TYPE "control"."ControlReconciliationCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "control"."reconciliation_observation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "reconciliation_type" "control"."ControlReconciliationType" NOT NULL,
    "side" "control"."ControlReconciliationSide" NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "source_domain" VARCHAR(30) NOT NULL,
    "source_version" INTEGER NOT NULL,
    "event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "metric_snapshot" JSONB NOT NULL,
    "snapshot_hash" CHAR(64) NOT NULL,

    CONSTRAINT "reconciliation_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."reconciliation_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "reconciliation_type" "control"."ControlReconciliationType" NOT NULL,
    "trigger_ref" VARCHAR(200) NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "observation_count" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "difference_count" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),
    "failure_reason" VARCHAR(1000),

    CONSTRAINT "reconciliation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."reconciliation_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "reconciliation_run_id" UUID NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "outcome" "control"."ControlReconciliationOutcome" NOT NULL,
    "source_observation_id" UUID,
    "target_observation_id" UUID,
    "source_snapshot" JSONB NOT NULL,
    "target_snapshot" JSONB NOT NULL,
    "difference_snapshot" JSONB NOT NULL,

    CONSTRAINT "reconciliation_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."reconciliation_case" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlReconciliationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "case_no" VARCHAR(100) NOT NULL,
    "reconciliation_type" "control"."ControlReconciliationType" NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "reconciliation_run_id" UUID NOT NULL,
    "reconciliation_item_id" UUID NOT NULL,
    "reason_code" VARCHAR(100) NOT NULL,
    "difference_snapshot" JSONB NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "resolution" VARCHAR(1000),

    CONSTRAINT "reconciliation_case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "control_reconciliation_observation_period_idx" ON "control"."reconciliation_observation"("tenant_id", "reconciliation_type", "occurred_at", "business_ref");

-- CreateIndex
CREATE UNIQUE INDEX "control_reconciliation_observation_version_key" ON "control"."reconciliation_observation"("tenant_id", "reconciliation_type", "business_ref", "side", "source_version");

-- CreateIndex
CREATE INDEX "control_reconciliation_run_period_idx" ON "control"."reconciliation_run"("tenant_id", "reconciliation_type", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "control_reconciliation_run_trigger_key" ON "control"."reconciliation_run"("tenant_id", "reconciliation_type", "trigger_ref");

-- CreateIndex
CREATE INDEX "control_reconciliation_item_outcome_idx" ON "control"."reconciliation_item"("tenant_id", "outcome", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_reconciliation_item_business_key" ON "control"."reconciliation_item"("tenant_id", "reconciliation_run_id", "business_ref");

-- CreateIndex
CREATE INDEX "control_reconciliation_case_lookup_idx" ON "control"."reconciliation_case"("tenant_id", "reconciliation_type", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_reconciliation_case_no_key" ON "control"."reconciliation_case"("tenant_id", "case_no");

CREATE UNIQUE INDEX "control_reconciliation_open_case_key"
ON "control"."reconciliation_case"("tenant_id", "reconciliation_type", "business_ref")
WHERE "status" = 'OPEN';

ALTER TABLE "control"."reconciliation_observation"
ADD CONSTRAINT "control_reconciliation_observation_version_check"
CHECK ("source_version" > 0);

ALTER TABLE "control"."reconciliation_run"
ADD CONSTRAINT "control_reconciliation_run_values_check"
CHECK (
  "period_end" > "period_start"
  AND "observation_count" >= 0
  AND "matched_count" >= 0
  AND "difference_count" >= 0
  AND "matched_count" + "difference_count" <= "observation_count"
);

CREATE OR REPLACE FUNCTION "control"."reject_terminal_reconciliation_run_mutation"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status IN ('COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'terminal reconciliation runs are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "control"."reject_terminal_reconciliation_case_mutation"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'RESOLVED' THEN
    RAISE EXCEPTION 'terminal reconciliation cases are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "control_reconciliation_observation_immutable"
BEFORE UPDATE OR DELETE ON "control"."reconciliation_observation"
FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();

CREATE TRIGGER "control_reconciliation_item_immutable"
BEFORE UPDATE OR DELETE ON "control"."reconciliation_item"
FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();

CREATE TRIGGER "control_reconciliation_run_terminal_immutable"
BEFORE UPDATE OR DELETE ON "control"."reconciliation_run"
FOR EACH ROW EXECUTE FUNCTION "control"."reject_terminal_reconciliation_run_mutation"();

CREATE TRIGGER "control_reconciliation_case_terminal_immutable"
BEFORE UPDATE OR DELETE ON "control"."reconciliation_case"
FOR EACH ROW EXECUTE FUNCTION "control"."reject_terminal_reconciliation_case_mutation"();
