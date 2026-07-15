-- CreateEnum
CREATE TYPE "billing"."ReconciliationStatementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISPUTED', 'ADJUSTED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "billing"."ReconciliationRecordStatus" AS ENUM ('ACTIVE');

-- CreateEnum
CREATE TYPE "billing"."ReconciliationDisputeCategory" AS ENUM ('MISSING', 'RATE', 'QUANTITY', 'SERVICE', 'TAX', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "billing"."ReconciliationDisputeStatus" AS ENUM ('OPEN', 'EVIDENCE_REQUESTED', 'ACCEPTED', 'REJECTED', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "billing"."BillingAdjustmentType" AS ENUM ('ADJUSTMENT', 'CLAIM_DEDUCTION');

-- CreateEnum
CREATE TYPE "billing"."BillingAdjustmentDirection" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "billing"."BillingAdjustmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED');

-- CreateEnum
CREATE TYPE "billing"."BillingAdjustmentApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "billing"."SettlementVoucherStatus" ADD VALUE 'RECONCILED';

-- CreateTable
CREATE TABLE "billing"."reconciliation_statement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."ReconciliationStatementStatus" NOT NULL DEFAULT 'DRAFT',
    "statement_no" VARCHAR(100) NOT NULL,
    "direction" "billing"."BillingDirection" NOT NULL,
    "partner_ref" UUID NOT NULL,
    "partner_snapshot" JSONB NOT NULL,
    "contract_ref" VARCHAR(200) NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal_amount" DECIMAL(24,6) NOT NULL,
    "tax_amount" DECIMAL(24,6) NOT NULL,
    "total_amount" DECIMAL(24,6) NOT NULL,
    "voucher_count" INTEGER NOT NULL,
    "line_count" INTEGER NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "published_by" UUID,
    "reconciled_at" TIMESTAMPTZ(3),
    "reconciled_by" UUID,

    CONSTRAINT "reconciliation_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."reconciliation_statement_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."ReconciliationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "statement_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "voucher_line_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_line_ref" UUID NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "tax_component" BOOLEAN NOT NULL DEFAULT false,
    "voucher_snapshot" JSONB NOT NULL,
    "business_snapshot" JSONB NOT NULL,

    CONSTRAINT "reconciliation_statement_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."reconciliation_statement_attachment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."ReconciliationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "statement_id" UUID NOT NULL,
    "attachment_ref" VARCHAR(500) NOT NULL,
    "attachment_snapshot" JSONB NOT NULL,

    CONSTRAINT "reconciliation_statement_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."reconciliation_statement_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."ReconciliationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "statement_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "statement_status" "billing"."ReconciliationStatementStatus" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "reconciliation_statement_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."reconciliation_dispute" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."ReconciliationDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "dispute_no" VARCHAR(100) NOT NULL,
    "statement_id" UUID NOT NULL,
    "statement_line_id" UUID,
    "category" "billing"."ReconciliationDisputeCategory" NOT NULL,
    "disputed_amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "raised_by_type" VARCHAR(30) NOT NULL,
    "resolution_note" VARCHAR(2000),
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,

    CONSTRAINT "reconciliation_dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."reconciliation_communication" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."ReconciliationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "dispute_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "actor_type" VARCHAR(30) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "evidence_snapshot" JSONB NOT NULL,

    CONSTRAINT "reconciliation_communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_adjustment_voucher" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "adjustment_no" VARCHAR(100) NOT NULL,
    "adjustment_type" "billing"."BillingAdjustmentType" NOT NULL,
    "direction" "billing"."BillingAdjustmentDirection" NOT NULL,
    "source_voucher_id" UUID NOT NULL,
    "statement_id" UUID,
    "dispute_id" UUID,
    "reason" VARCHAR(2000) NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejected_by" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by" UUID,

    CONSTRAINT "billing_adjustment_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_allocation_detail" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."ReconciliationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "adjustment_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "target_type" VARCHAR(30) NOT NULL,
    "target_ref" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "target_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_allocation_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_adjustment_approval_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingAdjustmentApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "adjustment_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "candidate_role" VARCHAR(100) NOT NULL,
    "route_snapshot" JSONB NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "decision_reason" VARCHAR(2000),

    CONSTRAINT "billing_adjustment_approval_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_adjustment_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."ReconciliationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "adjustment_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "from_status" "billing"."BillingAdjustmentStatus",
    "to_status" "billing"."BillingAdjustmentStatus" NOT NULL,
    "command" VARCHAR(50) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_adjustment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_statement_workbench_idx" ON "billing"."reconciliation_statement"("tenant_id", "status", "period_from", "period_to");

-- CreateIndex
CREATE INDEX "reconciliation_statement_partner_idx" ON "billing"."reconciliation_statement"("tenant_id", "partner_ref", "contract_ref", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_statement_tenant_no_key" ON "billing"."reconciliation_statement"("tenant_id", "statement_no");

-- CreateIndex
CREATE INDEX "reconciliation_statement_line_idx" ON "billing"."reconciliation_statement_line"("tenant_id", "statement_id", "voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_statement_line_no_key" ON "billing"."reconciliation_statement_line"("tenant_id", "statement_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_voucher_line_once_key" ON "billing"."reconciliation_statement_line"("tenant_id", "voucher_line_id");

-- CreateIndex
CREATE INDEX "reconciliation_statement_attachment_idx" ON "billing"."reconciliation_statement_attachment"("tenant_id", "statement_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_statement_attachment_key" ON "billing"."reconciliation_statement_attachment"("tenant_id", "statement_id", "attachment_ref");

-- CreateIndex
CREATE INDEX "reconciliation_statement_version_idx" ON "billing"."reconciliation_statement_version"("tenant_id", "statement_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_statement_version_key" ON "billing"."reconciliation_statement_version"("tenant_id", "statement_id", "version_no");

-- CreateIndex
CREATE INDEX "reconciliation_dispute_statement_idx" ON "billing"."reconciliation_dispute"("tenant_id", "statement_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "reconciliation_dispute_line_idx" ON "billing"."reconciliation_dispute"("tenant_id", "statement_line_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_dispute_tenant_no_key" ON "billing"."reconciliation_dispute"("tenant_id", "dispute_no");

-- CreateIndex
CREATE INDEX "reconciliation_communication_idx" ON "billing"."reconciliation_communication"("tenant_id", "dispute_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_communication_sequence_key" ON "billing"."reconciliation_communication"("tenant_id", "dispute_id", "sequence");

-- CreateIndex
CREATE INDEX "billing_adjustment_workbench_idx" ON "billing"."billing_adjustment_voucher"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "billing_adjustment_source_idx" ON "billing"."billing_adjustment_voucher"("tenant_id", "source_voucher_id", "status");

-- CreateIndex
CREATE INDEX "billing_adjustment_dispute_idx" ON "billing"."billing_adjustment_voucher"("tenant_id", "statement_id", "dispute_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_adjustment_tenant_no_key" ON "billing"."billing_adjustment_voucher"("tenant_id", "adjustment_no");

-- CreateIndex
CREATE INDEX "billing_allocation_target_idx" ON "billing"."billing_allocation_detail"("tenant_id", "adjustment_id", "target_type", "target_ref");

-- CreateIndex
CREATE UNIQUE INDEX "billing_allocation_line_no_key" ON "billing"."billing_allocation_detail"("tenant_id", "adjustment_id", "line_no");

-- CreateIndex
CREATE INDEX "billing_adjustment_approval_inbox_idx" ON "billing"."billing_adjustment_approval_task"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_adjustment_approval_attempt_key" ON "billing"."billing_adjustment_approval_task"("tenant_id", "adjustment_id", "attempt");

-- CreateIndex
CREATE INDEX "billing_adjustment_history_idx" ON "billing"."billing_adjustment_status_history"("tenant_id", "adjustment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_adjustment_history_sequence_key" ON "billing"."billing_adjustment_status_history"("tenant_id", "adjustment_id", "sequence");

ALTER TABLE "billing"."reconciliation_statement" ADD CONSTRAINT "reconciliation_statement_amount_check" CHECK ("subtotal_amount" + "tax_amount" = "total_amount" AND "voucher_count" > 0 AND "line_count" > 0);
ALTER TABLE "billing"."reconciliation_dispute" ADD CONSTRAINT "reconciliation_dispute_amount_check" CHECK ("disputed_amount" > 0);
ALTER TABLE "billing"."billing_adjustment_voucher" ADD CONSTRAINT "billing_adjustment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "billing"."billing_allocation_detail" ADD CONSTRAINT "billing_allocation_amount_check" CHECK ("amount" > 0);

CREATE OR REPLACE FUNCTION "billing"."reject_reconciliation_fact_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing reconciliation and adjustment facts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "billing"."protect_reconciliation_statement"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reconciliation statements cannot be deleted';
  END IF;
  IF OLD."status" = 'RECONCILED' OR
     OLD."statement_no" IS DISTINCT FROM NEW."statement_no" OR
     OLD."direction" IS DISTINCT FROM NEW."direction" OR
     OLD."partner_ref" IS DISTINCT FROM NEW."partner_ref" OR
     OLD."partner_snapshot" IS DISTINCT FROM NEW."partner_snapshot" OR
     OLD."contract_ref" IS DISTINCT FROM NEW."contract_ref" OR
     OLD."period_from" IS DISTINCT FROM NEW."period_from" OR
     OLD."period_to" IS DISTINCT FROM NEW."period_to" OR
     OLD."currency" IS DISTINCT FROM NEW."currency" OR
     OLD."subtotal_amount" IS DISTINCT FROM NEW."subtotal_amount" OR
     OLD."tax_amount" IS DISTINCT FROM NEW."tax_amount" OR
     OLD."total_amount" IS DISTINCT FROM NEW."total_amount" OR
     OLD."voucher_count" IS DISTINCT FROM NEW."voucher_count" OR
     OLD."line_count" IS DISTINCT FROM NEW."line_count" THEN
    RAISE EXCEPTION 'reconciliation statement basis is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "billing"."protect_billing_adjustment"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing adjustments cannot be deleted';
  END IF;
  IF OLD."status" = 'POSTED' OR
     OLD."adjustment_no" IS DISTINCT FROM NEW."adjustment_no" OR
     OLD."adjustment_type" IS DISTINCT FROM NEW."adjustment_type" OR
     OLD."direction" IS DISTINCT FROM NEW."direction" OR
     OLD."source_voucher_id" IS DISTINCT FROM NEW."source_voucher_id" OR
     OLD."statement_id" IS DISTINCT FROM NEW."statement_id" OR
     OLD."dispute_id" IS DISTINCT FROM NEW."dispute_id" OR
     OLD."reason" IS DISTINCT FROM NEW."reason" OR
     OLD."amount" IS DISTINCT FROM NEW."amount" OR
     OLD."currency" IS DISTINCT FROM NEW."currency" OR
     OLD."source_snapshot" IS DISTINCT FROM NEW."source_snapshot" THEN
    RAISE EXCEPTION 'billing adjustment basis is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reconciliation_statement_protected" BEFORE UPDATE OR DELETE ON "billing"."reconciliation_statement" FOR EACH ROW EXECUTE FUNCTION "billing"."protect_reconciliation_statement"();
CREATE TRIGGER "reconciliation_statement_line_immutable" BEFORE UPDATE OR DELETE ON "billing"."reconciliation_statement_line" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_reconciliation_fact_mutation"();
CREATE TRIGGER "reconciliation_statement_attachment_immutable" BEFORE UPDATE OR DELETE ON "billing"."reconciliation_statement_attachment" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_reconciliation_fact_mutation"();
CREATE TRIGGER "reconciliation_statement_version_immutable" BEFORE UPDATE OR DELETE ON "billing"."reconciliation_statement_version" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_reconciliation_fact_mutation"();
CREATE TRIGGER "reconciliation_communication_immutable" BEFORE UPDATE OR DELETE ON "billing"."reconciliation_communication" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_reconciliation_fact_mutation"();
CREATE TRIGGER "billing_adjustment_protected" BEFORE UPDATE OR DELETE ON "billing"."billing_adjustment_voucher" FOR EACH ROW EXECUTE FUNCTION "billing"."protect_billing_adjustment"();
CREATE TRIGGER "billing_allocation_detail_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_allocation_detail" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_reconciliation_fact_mutation"();
CREATE TRIGGER "billing_adjustment_history_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_adjustment_status_history" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_reconciliation_fact_mutation"();
