-- CreateEnum
CREATE TYPE "billing"."SettlementVoucherStatus" AS ENUM ('DRAFT', 'CALCULATED', 'VALIDATED', 'APPROVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "billing"."BillingVoucherRecordStatus" AS ENUM ('ACTIVE');

-- CreateEnum
CREATE TYPE "billing"."VoucherApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "billing"."BillingAccrualStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "billing"."BillingReversalStatus" AS ENUM ('POSTED');

-- CreateTable
CREATE TABLE "billing"."settlement_voucher" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."SettlementVoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "voucher_no" VARCHAR(100) NOT NULL,
    "direction" "billing"."BillingDirection" NOT NULL,
    "partner_ref" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "business_type" VARCHAR(100) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal_amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "approval_threshold" DECIMAL(24,6) NOT NULL,
    "manual_adjustment" BOOLEAN NOT NULL DEFAULT false,
    "adjustment_reason" VARCHAR(1000),
    "contract_snapshot" JSONB NOT NULL DEFAULT '[]',
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" UUID,

    CONSTRAINT "settlement_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."voucher_calculation_selection" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingVoucherRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "voucher_id" UUID NOT NULL,
    "calculation_id" UUID NOT NULL,
    "calculation_snapshot" JSONB NOT NULL,

    CONSTRAINT "voucher_calculation_selection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_voucher_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingVoucherRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "voucher_id" UUID NOT NULL,
    "calculation_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_line_ref" UUID NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "tax_component" BOOLEAN NOT NULL DEFAULT false,
    "source_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_voucher_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."voucher_validation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingVoucherRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "voucher_id" UUID NOT NULL,
    "validation_no" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "approval_required" BOOLEAN NOT NULL,
    "check_snapshot" JSONB NOT NULL,
    "error_snapshot" JSONB NOT NULL,
    "approval_reason_snapshot" JSONB NOT NULL,

    CONSTRAINT "voucher_validation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."voucher_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingVoucherRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "voucher_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "from_status" "billing"."SettlementVoucherStatus",
    "to_status" "billing"."SettlementVoucherStatus" NOT NULL,
    "command" VARCHAR(50) NOT NULL,
    "decision_snapshot" JSONB NOT NULL,

    CONSTRAINT "voucher_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."voucher_approval_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."VoucherApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "voucher_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "candidate_role" VARCHAR(100) NOT NULL,
    "route_reason_snapshot" JSONB NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "decision_reason" VARCHAR(1000),

    CONSTRAINT "voucher_approval_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_accrual_voucher" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingAccrualStatus" NOT NULL DEFAULT 'DRAFT',
    "accrual_no" VARCHAR(100) NOT NULL,
    "calculation_id" UUID NOT NULL,
    "accounting_date" DATE NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "basis_snapshot" JSONB NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "reversed_at" TIMESTAMPTZ(3),

    CONSTRAINT "billing_accrual_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_accrual_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingVoucherRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "accrual_voucher_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_line_ref" UUID NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "source_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_accrual_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_reversal_voucher" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingReversalStatus" NOT NULL DEFAULT 'POSTED',
    "reversal_no" VARCHAR(100) NOT NULL,
    "accrual_voucher_id" UUID NOT NULL,
    "actual_voucher_id" UUID NOT NULL,
    "reversal_amount" DECIMAL(24,6) NOT NULL,
    "difference_amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_reversal_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_reversal_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingVoucherRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "reversal_voucher_id" UUID NOT NULL,
    "accrual_line_id" UUID NOT NULL,
    "actual_voucher_line_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "accrual_amount" DECIMAL(24,6) NOT NULL,
    "actual_amount" DECIMAL(24,6) NOT NULL,
    "difference_amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "link_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_reversal_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_voucher_workbench_idx" ON "billing"."settlement_voucher"("tenant_id", "direction", "status", "period_from", "period_to");

-- CreateIndex
CREATE INDEX "settlement_voucher_partner_idx" ON "billing"."settlement_voucher"("tenant_id", "partner_ref", "business_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_voucher_tenant_no_key" ON "billing"."settlement_voucher"("tenant_id", "voucher_no");

-- CreateIndex
CREATE INDEX "voucher_selection_lookup_idx" ON "billing"."voucher_calculation_selection"("tenant_id", "calculation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_selection_calculation_key" ON "billing"."voucher_calculation_selection"("tenant_id", "voucher_id", "calculation_id");

-- CreateIndex
CREATE INDEX "billing_voucher_line_calculation_idx" ON "billing"."billing_voucher_line"("tenant_id", "voucher_id", "calculation_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_voucher_line_no_key" ON "billing"."billing_voucher_line"("tenant_id", "voucher_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "billing_voucher_source_once_key" ON "billing"."billing_voucher_line"("tenant_id", "source_type", "source_line_ref");

-- CreateIndex
CREATE INDEX "voucher_validation_created_idx" ON "billing"."voucher_validation"("tenant_id", "voucher_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_validation_no_key" ON "billing"."voucher_validation"("tenant_id", "voucher_id", "validation_no");

-- CreateIndex
CREATE INDEX "voucher_status_history_created_idx" ON "billing"."voucher_status_history"("tenant_id", "voucher_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_status_history_sequence_key" ON "billing"."voucher_status_history"("tenant_id", "voucher_id", "sequence");

-- CreateIndex
CREATE INDEX "voucher_approval_inbox_idx" ON "billing"."voucher_approval_task"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_approval_attempt_key" ON "billing"."voucher_approval_task"("tenant_id", "voucher_id", "attempt");

-- CreateIndex
CREATE INDEX "billing_accrual_status_date_idx" ON "billing"."billing_accrual_voucher"("tenant_id", "status", "accounting_date");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accrual_tenant_no_key" ON "billing"."billing_accrual_voucher"("tenant_id", "accrual_no");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accrual_calculation_key" ON "billing"."billing_accrual_voucher"("tenant_id", "calculation_id");

-- CreateIndex
CREATE INDEX "billing_accrual_line_idx" ON "billing"."billing_accrual_line"("tenant_id", "accrual_voucher_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accrual_line_no_key" ON "billing"."billing_accrual_line"("tenant_id", "accrual_voucher_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accrual_source_once_key" ON "billing"."billing_accrual_line"("tenant_id", "source_type", "source_line_ref");

-- CreateIndex
CREATE INDEX "billing_reversal_actual_idx" ON "billing"."billing_reversal_voucher"("tenant_id", "actual_voucher_id", "posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_reversal_tenant_no_key" ON "billing"."billing_reversal_voucher"("tenant_id", "reversal_no");

-- CreateIndex
CREATE UNIQUE INDEX "billing_reversal_link_key" ON "billing"."billing_reversal_voucher"("tenant_id", "accrual_voucher_id", "actual_voucher_id");

-- CreateIndex
CREATE INDEX "billing_reversal_line_idx" ON "billing"."billing_reversal_line"("tenant_id", "reversal_voucher_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_reversal_line_no_key" ON "billing"."billing_reversal_line"("tenant_id", "reversal_voucher_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "billing_reversal_line_link_key" ON "billing"."billing_reversal_line"("tenant_id", "accrual_line_id", "actual_voucher_line_id");

ALTER TABLE "billing"."settlement_voucher"
  ADD CONSTRAINT "settlement_voucher_period_valid" CHECK ("period_to" >= "period_from"),
  ADD CONSTRAINT "settlement_voucher_amounts_nonnegative" CHECK ("subtotal_amount" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0 AND "approval_threshold" >= 0);
ALTER TABLE "billing"."billing_accrual_voucher"
  ADD CONSTRAINT "billing_accrual_amount_nonnegative" CHECK ("amount" >= 0);

CREATE OR REPLACE FUNCTION "billing"."reject_billing_voucher_fact_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Billing voucher facts are immutable' USING ERRCODE = '55000'; END; $$;
CREATE TRIGGER "voucher_selection_immutable" BEFORE UPDATE OR DELETE ON "billing"."voucher_calculation_selection" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_voucher_fact_mutation"();
CREATE TRIGGER "billing_voucher_line_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_voucher_line" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_voucher_fact_mutation"();
CREATE TRIGGER "voucher_validation_immutable" BEFORE UPDATE OR DELETE ON "billing"."voucher_validation" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_voucher_fact_mutation"();
CREATE TRIGGER "voucher_status_history_immutable" BEFORE UPDATE OR DELETE ON "billing"."voucher_status_history" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_voucher_fact_mutation"();
CREATE TRIGGER "billing_accrual_line_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_accrual_line" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_voucher_fact_mutation"();
CREATE TRIGGER "billing_reversal_voucher_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_reversal_voucher" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_voucher_fact_mutation"();
CREATE TRIGGER "billing_reversal_line_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_reversal_line" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_voucher_fact_mutation"();
