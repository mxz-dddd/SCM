CREATE TYPE "billing"."BillingCalculationStatus" AS ENUM ('CALCULATED');
CREATE TYPE "billing"."BillingCalculationRecordStatus" AS ENUM ('ACTIVE');
CREATE TYPE "billing"."BillingDirection" AS ENUM ('RECEIVABLE', 'PAYABLE');

CREATE TABLE "billing"."billing_calculation" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingCalculationStatus" NOT NULL DEFAULT 'CALCULATED',
  "calculation_no" VARCHAR(100) NOT NULL, "calculation_version" INTEGER NOT NULL,
  "charge_fact_id" UUID NOT NULL, "fact_correction_id" UUID, "rate_match_id" UUID NOT NULL,
  "rate_version_ref" UUID NOT NULL, "rate_version_number" INTEGER NOT NULL,
  "direction" "billing"."BillingDirection" NOT NULL, "business_ref" VARCHAR(200) NOT NULL,
  "charge_type" VARCHAR(100) NOT NULL, "source_currency" CHAR(3) NOT NULL,
  "settlement_currency" CHAR(3) NOT NULL, "subtotal_amount" DECIMAL(24,6) NOT NULL,
  "accessorial_amount" DECIMAL(24,6) NOT NULL, "tax_amount" DECIMAL(24,6) NOT NULL,
  "total_amount" DECIMAL(24,6) NOT NULL, "calculated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_calculation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_calculation_version_positive" CHECK ("calculation_version" > 0),
  CONSTRAINT "billing_calculation_amounts_nonnegative" CHECK ("subtotal_amount" >= 0 AND "accessorial_amount" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0)
);
CREATE UNIQUE INDEX "billing_calculation_tenant_no_key" ON "billing"."billing_calculation"("tenant_id", "calculation_no");
CREATE UNIQUE INDEX "billing_calculation_fact_version_key" ON "billing"."billing_calculation"("tenant_id", "charge_fact_id", "direction", "calculation_version");
CREATE INDEX "billing_calculation_workbench_idx" ON "billing"."billing_calculation"("tenant_id", "status", "calculated_at");
CREATE INDEX "billing_calculation_business_idx" ON "billing"."billing_calculation"("tenant_id", "business_ref", "direction");

CREATE TABLE "billing"."billing_calculation_line" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingCalculationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "calculation_id" UUID NOT NULL, "line_no" INTEGER NOT NULL, "line_type" VARCHAR(50) NOT NULL,
  "basis_type" VARCHAR(50) NOT NULL, "basis_quantity" DECIMAL(24,6) NOT NULL, "basis_uom" VARCHAR(20) NOT NULL,
  "tier_from" DECIMAL(24,6), "tier_to" DECIMAL(24,6), "rate_amount" DECIMAL(24,6) NOT NULL,
  "currency" CHAR(3) NOT NULL, "unrounded_amount" DECIMAL(24,12) NOT NULL,
  "rounded_amount" DECIMAL(24,6) NOT NULL, "rounding_difference" DECIMAL(24,12) NOT NULL,
  "expression_snapshot" JSONB NOT NULL, "tier_snapshot" JSONB NOT NULL,
  CONSTRAINT "billing_calculation_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_calculation_line_no_key" ON "billing"."billing_calculation_line"("tenant_id", "calculation_id", "line_no");
CREATE INDEX "billing_calculation_line_idx" ON "billing"."billing_calculation_line"("tenant_id", "calculation_id", "line_type");

CREATE TABLE "billing"."accessorial_charge" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingCalculationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "calculation_id" UUID NOT NULL, "line_no" INTEGER NOT NULL, "code" VARCHAR(100) NOT NULL,
  "charge_type" VARCHAR(50) NOT NULL, "method" VARCHAR(30) NOT NULL,
  "condition_snapshot" JSONB NOT NULL, "basis_snapshot" JSONB NOT NULL,
  "unrounded_amount" DECIMAL(24,12) NOT NULL, "amount" DECIMAL(24,6) NOT NULL,
  "rounding_difference" DECIMAL(24,12) NOT NULL, "currency" CHAR(3) NOT NULL,
  CONSTRAINT "accessorial_charge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accessorial_charge_line_no_key" ON "billing"."accessorial_charge"("tenant_id", "calculation_id", "line_no");
CREATE INDEX "accessorial_charge_calculation_idx" ON "billing"."accessorial_charge"("tenant_id", "calculation_id", "charge_type");

CREATE TABLE "billing"."tax_detail" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingCalculationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "calculation_id" UUID NOT NULL, "tax_mode" VARCHAR(20) NOT NULL, "tax_rate" DECIMAL(12,6) NOT NULL,
  "taxable_amount" DECIMAL(24,6) NOT NULL, "tax_amount" DECIMAL(24,6) NOT NULL,
  "total_with_tax" DECIMAL(24,6) NOT NULL, "currency" CHAR(3) NOT NULL,
  "rounding_snapshot" JSONB NOT NULL, CONSTRAINT "tax_detail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tax_detail_calculation_key" ON "billing"."tax_detail"("tenant_id", "calculation_id");
CREATE INDEX "tax_detail_created_idx" ON "billing"."tax_detail"("tenant_id", "created_at", "calculation_id");

CREATE TABLE "billing"."fx_conversion" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingCalculationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "calculation_id" UUID NOT NULL, "rate_date" DATE NOT NULL, "source_currency" CHAR(3) NOT NULL,
  "target_currency" CHAR(3) NOT NULL, "exchange_rate" DECIMAL(24,12) NOT NULL,
  "source_name" VARCHAR(100) NOT NULL, "source_amount" DECIMAL(24,6) NOT NULL,
  "unrounded_target_amount" DECIMAL(24,12) NOT NULL, "target_amount" DECIMAL(24,6) NOT NULL,
  "rounding_mode" VARCHAR(20) NOT NULL, "rounding_scale" INTEGER NOT NULL,
  "rounding_difference" DECIMAL(24,12) NOT NULL, CONSTRAINT "fx_conversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fx_conversion_rate_positive" CHECK ("exchange_rate" > 0),
  CONSTRAINT "fx_conversion_scale_valid" CHECK ("rounding_scale" BETWEEN 0 AND 6)
);
CREATE UNIQUE INDEX "fx_conversion_calculation_key" ON "billing"."fx_conversion"("tenant_id", "calculation_id");
CREATE INDEX "fx_conversion_rate_idx" ON "billing"."fx_conversion"("tenant_id", "rate_date", "source_currency", "target_currency");

CREATE TABLE "billing"."calculation_trace" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingCalculationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "calculation_id" UUID NOT NULL, "trace_version" INTEGER NOT NULL DEFAULT 1,
  "fact_snapshot" JSONB NOT NULL, "correction_snapshot" JSONB NOT NULL,
  "rate_match_snapshot" JSONB NOT NULL, "rate_version_snapshot" JSONB NOT NULL,
  "expression_snapshot" JSONB NOT NULL, "tier_snapshot" JSONB NOT NULL,
  "accessorial_snapshot" JSONB NOT NULL, "tax_snapshot" JSONB NOT NULL,
  "fx_snapshot" JSONB NOT NULL, "output_snapshot" JSONB NOT NULL,
  CONSTRAINT "calculation_trace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calculation_trace_calculation_key" ON "billing"."calculation_trace"("tenant_id", "calculation_id");
CREATE INDEX "calculation_trace_created_idx" ON "billing"."calculation_trace"("tenant_id", "created_at", "calculation_id");

CREATE OR REPLACE FUNCTION "billing"."reject_billing_calculation_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Billing calculations and traces are immutable' USING ERRCODE = '55000'; END; $$;
CREATE TRIGGER "billing_calculation_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_calculation" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_calculation_mutation"();
CREATE TRIGGER "billing_calculation_line_immutable" BEFORE UPDATE OR DELETE ON "billing"."billing_calculation_line" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_calculation_mutation"();
CREATE TRIGGER "accessorial_charge_immutable" BEFORE UPDATE OR DELETE ON "billing"."accessorial_charge" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_calculation_mutation"();
CREATE TRIGGER "tax_detail_immutable" BEFORE UPDATE OR DELETE ON "billing"."tax_detail" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_calculation_mutation"();
CREATE TRIGGER "fx_conversion_immutable" BEFORE UPDATE OR DELETE ON "billing"."fx_conversion" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_calculation_mutation"();
CREATE TRIGGER "calculation_trace_immutable" BEFORE UPDATE OR DELETE ON "billing"."calculation_trace" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_calculation_mutation"();
