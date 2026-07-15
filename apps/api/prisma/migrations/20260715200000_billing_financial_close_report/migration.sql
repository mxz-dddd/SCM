-- CreateEnum
CREATE TYPE "billing"."BillingInvoiceStatus" AS ENUM ('ISSUED', 'PARTIALLY_REVERSED', 'REVERSED');

-- CreateEnum
CREATE TYPE "billing"."BillingInvoiceKind" AS ENUM ('STANDARD', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "billing"."BillingInvoiceSourceType" AS ENUM ('STATEMENT_LINE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "billing"."BillingPaymentStatus" AS ENUM ('UNMATCHED', 'PARTIALLY_ALLOCATED', 'ALLOCATED');

-- CreateEnum
CREATE TYPE "billing"."BillingPaymentType" AS ENUM ('NORMAL', 'REFUND', 'FEE', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "billing"."BillingSettlementTargetType" AS ENUM ('INVOICE', 'VOUCHER');

-- CreateEnum
CREATE TYPE "billing"."AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "billing"."BillingPeriodRecordStatus" AS ENUM ('ACTIVE');

-- CreateEnum
CREATE TYPE "billing"."SettlementReportStatus" AS ENUM ('GENERATED');

-- CreateEnum
CREATE TYPE "billing"."SettlementDimensionType" AS ENUM ('PARTNER', 'WAREHOUSE', 'ROUTE', 'ORDER', 'SERVICE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "billing"."SettlementVoucherStatus" ADD VALUE 'INVOICED';
ALTER TYPE "billing"."SettlementVoucherStatus" ADD VALUE 'PAID';
ALTER TYPE "billing"."SettlementVoucherStatus" ADD VALUE 'CLOSED';

-- CreateTable
CREATE TABLE "billing"."billing_invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "invoice_no" VARCHAR(200) NOT NULL,
    "kind" "billing"."BillingInvoiceKind" NOT NULL,
    "original_invoice_id" UUID,
    "statement_id" UUID NOT NULL,
    "direction" "billing"."BillingDirection" NOT NULL,
    "invoice_party_ref" VARCHAR(200) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "subtotal_amount" DECIMAL(24,6) NOT NULL,
    "tax_amount" DECIMAL(24,6) NOT NULL,
    "total_amount" DECIMAL(24,6) NOT NULL,
    "reversed_amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "attachment_snapshot" JSONB NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_invoice_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingPeriodRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "source_type" "billing"."BillingInvoiceSourceType" NOT NULL,
    "source_ref" UUID NOT NULL,
    "original_invoice_line_id" UUID,
    "amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "tax_component" BOOLEAN NOT NULL DEFAULT false,
    "source_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingPaymentStatus" NOT NULL DEFAULT 'UNMATCHED',
    "payment_no" VARCHAR(100) NOT NULL,
    "external_ref" VARCHAR(200) NOT NULL,
    "direction" "billing"."BillingDirection" NOT NULL,
    "payment_type" "billing"."BillingPaymentType" NOT NULL,
    "transaction_date" DATE NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "allocated_amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "fee_amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "unallocated_amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "counterparty_ref" VARCHAR(200) NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "source_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_settlement_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingPeriodRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "payment_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "target_type" "billing"."BillingSettlementTargetType" NOT NULL,
    "target_ref" UUID NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "fee_amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "target_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_settlement_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_accounting_period" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "period_key" VARCHAR(20) NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "closing_started_at" TIMESTAMPTZ(3),
    "closing_started_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "reopened_at" TIMESTAMPTZ(3),
    "reopened_by" UUID,
    "reopen_reason" VARCHAR(2000),

    CONSTRAINT "billing_accounting_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_period_close_check" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingPeriodRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "period_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "check_snapshot" JSONB NOT NULL,
    "error_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_period_close_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_period_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingPeriodRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "period_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "from_status" "billing"."AccountingPeriodStatus",
    "to_status" "billing"."AccountingPeriodStatus" NOT NULL,
    "command" VARCHAR(50) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_period_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_settlement_report" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."SettlementReportStatus" NOT NULL DEFAULT 'GENERATED',
    "report_key" VARCHAR(100) NOT NULL,
    "report_version" INTEGER NOT NULL,
    "dimension_type" "billing"."SettlementDimensionType" NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "revenue_amount" DECIMAL(24,6) NOT NULL,
    "cost_amount" DECIMAL(24,6) NOT NULL,
    "accrual_amount" DECIMAL(24,6) NOT NULL,
    "adjustment_amount" DECIMAL(24,6) NOT NULL,
    "paid_amount" DECIMAL(24,6) NOT NULL,
    "margin_amount" DECIMAL(24,6) NOT NULL,
    "input_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_settlement_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_settlement_metric" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingPeriodRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "report_id" UUID NOT NULL,
    "dimension_ref" VARCHAR(200) NOT NULL,
    "dimension_snapshot" JSONB NOT NULL,
    "revenue_amount" DECIMAL(24,6) NOT NULL,
    "cost_amount" DECIMAL(24,6) NOT NULL,
    "accrual_amount" DECIMAL(24,6) NOT NULL,
    "adjustment_amount" DECIMAL(24,6) NOT NULL,
    "paid_amount" DECIMAL(24,6) NOT NULL,
    "margin_amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "billing_settlement_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_settlement_metric_trace" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "billing"."BillingPeriodRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "metric_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "voucher_line_id" UUID NOT NULL,
    "calculation_id" UUID NOT NULL,
    "calculation_source_type" VARCHAR(40) NOT NULL,
    "calculation_source_ref" UUID NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "direction" "billing"."BillingDirection" NOT NULL,
    "trace_snapshot" JSONB NOT NULL,

    CONSTRAINT "billing_settlement_metric_trace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_invoice_statement_idx" ON "billing"."billing_invoice"("tenant_id", "statement_id", "kind", "status");

-- CreateIndex
CREATE INDEX "billing_invoice_credit_idx" ON "billing"."billing_invoice"("tenant_id", "original_invoice_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoice_tenant_no_key" ON "billing"."billing_invoice"("tenant_id", "invoice_no");

-- CreateIndex
CREATE INDEX "billing_invoice_line_source_idx" ON "billing"."billing_invoice_line"("tenant_id", "source_type", "source_ref", "created_at");

-- CreateIndex
CREATE INDEX "billing_invoice_line_credit_idx" ON "billing"."billing_invoice_line"("tenant_id", "original_invoice_line_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoice_line_no_key" ON "billing"."billing_invoice_line"("tenant_id", "invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "billing_payment_workbench_idx" ON "billing"."billing_payment"("tenant_id", "status", "transaction_date");

-- CreateIndex
CREATE INDEX "billing_payment_counterparty_idx" ON "billing"."billing_payment"("tenant_id", "counterparty_ref", "direction", "status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_tenant_no_key" ON "billing"."billing_payment"("tenant_id", "payment_no");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_external_key" ON "billing"."billing_payment"("tenant_id", "external_ref");

-- CreateIndex
CREATE INDEX "billing_settlement_allocation_target_idx" ON "billing"."billing_settlement_allocation"("tenant_id", "target_type", "target_ref", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_settlement_allocation_line_key" ON "billing"."billing_settlement_allocation"("tenant_id", "payment_id", "line_no");

-- CreateIndex
CREATE INDEX "billing_accounting_period_status_idx" ON "billing"."billing_accounting_period"("tenant_id", "status", "period_from", "period_to");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounting_period_key" ON "billing"."billing_accounting_period"("tenant_id", "period_key");

-- CreateIndex
CREATE INDEX "billing_period_close_check_idx" ON "billing"."billing_period_close_check"("tenant_id", "period_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_period_close_check_attempt_key" ON "billing"."billing_period_close_check"("tenant_id", "period_id", "attempt");

-- CreateIndex
CREATE INDEX "billing_period_status_history_idx" ON "billing"."billing_period_status_history"("tenant_id", "period_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_period_status_history_key" ON "billing"."billing_period_status_history"("tenant_id", "period_id", "sequence");

-- CreateIndex
CREATE INDEX "billing_settlement_report_period_idx" ON "billing"."billing_settlement_report"("tenant_id", "dimension_type", "period_from", "period_to");

-- CreateIndex
CREATE UNIQUE INDEX "billing_settlement_report_version_key" ON "billing"."billing_settlement_report"("tenant_id", "report_key", "report_version");

-- CreateIndex
CREATE INDEX "billing_settlement_metric_idx" ON "billing"."billing_settlement_metric"("tenant_id", "report_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_settlement_metric_dimension_key" ON "billing"."billing_settlement_metric"("tenant_id", "report_id", "dimension_ref");

-- CreateIndex
CREATE INDEX "billing_settlement_metric_trace_idx" ON "billing"."billing_settlement_metric_trace"("tenant_id", "metric_id", "calculation_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_settlement_metric_trace_line_key" ON "billing"."billing_settlement_metric_trace"("tenant_id", "metric_id", "voucher_line_id");

ALTER TABLE "billing"."billing_invoice" ADD CONSTRAINT "billing_invoice_amount_check" CHECK ("subtotal_amount" + "tax_amount" = "total_amount" AND "total_amount" <> 0 AND "reversed_amount" >= 0);
ALTER TABLE "billing"."billing_payment" ADD CONSTRAINT "billing_payment_amount_check" CHECK ("amount" <> 0 AND "fee_amount" >= 0);
ALTER TABLE "billing"."billing_settlement_allocation" ADD CONSTRAINT "billing_settlement_allocation_amount_check" CHECK ("amount" <> 0 AND "fee_amount" >= 0);
ALTER TABLE "billing"."billing_accounting_period" ADD CONSTRAINT "billing_accounting_period_range_check" CHECK ("period_to" >= "period_from");

CREATE OR REPLACE FUNCTION "billing"."reject_financial_fact_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing financial facts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "billing"."protect_billing_invoice"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'billing invoices cannot be deleted'; END IF;
  IF OLD."invoice_no" IS DISTINCT FROM NEW."invoice_no" OR
     OLD."kind" IS DISTINCT FROM NEW."kind" OR
     OLD."original_invoice_id" IS DISTINCT FROM NEW."original_invoice_id" OR
     OLD."statement_id" IS DISTINCT FROM NEW."statement_id" OR
     OLD."direction" IS DISTINCT FROM NEW."direction" OR
     OLD."invoice_party_ref" IS DISTINCT FROM NEW."invoice_party_ref" OR
     OLD."invoice_date" IS DISTINCT FROM NEW."invoice_date" OR
     OLD."subtotal_amount" IS DISTINCT FROM NEW."subtotal_amount" OR
     OLD."tax_amount" IS DISTINCT FROM NEW."tax_amount" OR
     OLD."total_amount" IS DISTINCT FROM NEW."total_amount" OR
     OLD."currency" IS DISTINCT FROM NEW."currency" OR
     OLD."attachment_snapshot" IS DISTINCT FROM NEW."attachment_snapshot" OR
     OLD."source_snapshot" IS DISTINCT FROM NEW."source_snapshot" THEN
    RAISE EXCEPTION 'billing invoice basis is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "billing"."protect_billing_payment"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'billing payments cannot be deleted'; END IF;
  IF OLD."payment_no" IS DISTINCT FROM NEW."payment_no" OR
     OLD."external_ref" IS DISTINCT FROM NEW."external_ref" OR
     OLD."direction" IS DISTINCT FROM NEW."direction" OR
     OLD."payment_type" IS DISTINCT FROM NEW."payment_type" OR
     OLD."transaction_date" IS DISTINCT FROM NEW."transaction_date" OR
     OLD."amount" IS DISTINCT FROM NEW."amount" OR
     OLD."currency" IS DISTINCT FROM NEW."currency" OR
     OLD."counterparty_ref" IS DISTINCT FROM NEW."counterparty_ref" OR
     OLD."source" IS DISTINCT FROM NEW."source" OR
     OLD."source_snapshot" IS DISTINCT FROM NEW."source_snapshot" THEN
    RAISE EXCEPTION 'billing payment basis is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "billing"."protect_billing_period"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'billing periods cannot be deleted'; END IF;
  IF OLD."period_key" IS DISTINCT FROM NEW."period_key" OR
     OLD."period_from" IS DISTINCT FROM NEW."period_from" OR
     OLD."period_to" IS DISTINCT FROM NEW."period_to" THEN
    RAISE EXCEPTION 'billing period range is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_invoice_protected" BEFORE UPDATE OR DELETE ON "billing"."billing_invoice" FOR EACH ROW EXECUTE FUNCTION "billing"."protect_billing_invoice"();
CREATE TRIGGER "billing_invoice_line_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_invoice_line" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_financial_fact_mutation"();
CREATE TRIGGER "billing_payment_protected" BEFORE UPDATE OR DELETE ON "billing"."billing_payment" FOR EACH ROW EXECUTE FUNCTION "billing"."protect_billing_payment"();
CREATE TRIGGER "billing_settlement_allocation_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_settlement_allocation" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_financial_fact_mutation"();
CREATE TRIGGER "billing_accounting_period_protected" BEFORE UPDATE OR DELETE ON "billing"."billing_accounting_period" FOR EACH ROW EXECUTE FUNCTION "billing"."protect_billing_period"();
CREATE TRIGGER "billing_period_close_check_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_period_close_check" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_financial_fact_mutation"();
CREATE TRIGGER "billing_period_status_history_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_period_status_history" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_financial_fact_mutation"();
CREATE TRIGGER "billing_settlement_report_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_settlement_report" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_financial_fact_mutation"();
CREATE TRIGGER "billing_settlement_metric_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_settlement_metric" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_financial_fact_mutation"();
CREATE TRIGGER "billing_settlement_metric_trace_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_settlement_metric_trace" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_financial_fact_mutation"();
