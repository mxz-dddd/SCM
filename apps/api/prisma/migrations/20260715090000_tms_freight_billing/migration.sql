CREATE TYPE "tms"."ChargeFactSource" AS ENUM ('PLANNED','CONFIRMED');
CREATE TYPE "tms"."ChargeCalculationStatus" AS ENUM ('CALCULATED','EXCEPTION');
CREATE TYPE "tms"."ChargeDirection" AS ENUM ('PAYABLE','RECEIVABLE');
CREATE TYPE "tms"."AccrualVoucherStatus" AS ENUM ('DRAFT','POSTED','REVERSED');
CREATE TYPE "tms"."BillingExceptionStatus" AS ENUM ('OPEN','RESOLVED');
CREATE TYPE "tms"."StatementStatus" AS ENUM ('DRAFT','CONFIRMED','DISPUTED','ADJUSTED','VOUCHERED');
CREATE TYPE "tms"."SettlementLineStatus" AS ENUM ('ACTIVE');
CREATE TYPE "tms"."FinancialVoucherStatus" AS ENUM ('DRAFT','APPROVED','INVOICED','PAID','CLOSED');

CREATE TABLE "tms"."freight_charge_fact" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"fact_no" VARCHAR(100) NOT NULL,"shipment_id" UUID NOT NULL,"source" "tms"."ChargeFactSource" NOT NULL,"fact_type" VARCHAR(50) NOT NULL,"value" DECIMAL(24,12) NOT NULL,"uom" VARCHAR(20) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL,"source_reference" VARCHAR(200) NOT NULL,"fact_snapshot" JSONB NOT NULL,
 CONSTRAINT "freight_charge_fact_values_check" CHECK ("value">=0 AND "fact_type" IN ('DISTANCE','WEIGHT','VOLUME','EQUIPMENT','DURATION','WAITING','HANDLING','MILESTONE','EXCEPTION') AND jsonb_typeof("fact_snapshot")='object')
);
CREATE UNIQUE INDEX "freight_charge_fact_tenant_no_key" ON "tms"."freight_charge_fact"("tenant_id","fact_no");
CREATE UNIQUE INDEX "freight_charge_fact_source_key" ON "tms"."freight_charge_fact"("tenant_id","shipment_id","source","fact_type","source_reference");
CREATE INDEX "freight_charge_fact_shipment_idx" ON "tms"."freight_charge_fact"("tenant_id","shipment_id","occurred_at");

CREATE TABLE "tms"."charge_calculation" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."ChargeCalculationStatus" NOT NULL,"calculation_no" VARCHAR(100) NOT NULL,"calculation_version" INTEGER NOT NULL,"shipment_id" UUID NOT NULL,"freight_charge_fact_id" UUID NOT NULL,"direction" "tms"."ChargeDirection" NOT NULL,"contract_id" UUID NOT NULL,"rate_version_id" UUID,"rate_version_number" INTEGER,"base_amount" DECIMAL(24,6) NOT NULL,"surcharge_amount" DECIMAL(24,6) NOT NULL,"tax_amount" DECIMAL(24,6) NOT NULL,"total_amount" DECIMAL(24,6) NOT NULL,"currency" CHAR(3) NOT NULL,"calculation_trace" JSONB NOT NULL,"exception_code" VARCHAR(100),"calculated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "charge_calculation_values_check" CHECK ("calculation_version">0 AND "base_amount">=0 AND "surcharge_amount">=0 AND "tax_amount">=0 AND "total_amount"="base_amount"+"surcharge_amount"+"tax_amount" AND jsonb_typeof("calculation_trace")='object' AND (("status"='CALCULATED' AND "rate_version_id" IS NOT NULL AND "rate_version_number" IS NOT NULL AND "exception_code" IS NULL) OR ("status"='EXCEPTION' AND "rate_version_id" IS NULL AND "exception_code" IS NOT NULL)))
);
CREATE UNIQUE INDEX "charge_calculation_tenant_no_key" ON "tms"."charge_calculation"("tenant_id","calculation_no");
CREATE UNIQUE INDEX "charge_calculation_shipment_version_key" ON "tms"."charge_calculation"("tenant_id","shipment_id","direction","calculation_version");
CREATE INDEX "charge_calculation_workbench_idx" ON "tms"."charge_calculation"("tenant_id","status","direction","calculated_at");

CREATE TABLE "tms"."billing_exception" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."BillingExceptionStatus" NOT NULL DEFAULT 'OPEN',"shipment_id" UUID NOT NULL,"charge_calculation_id" UUID NOT NULL,"code" VARCHAR(100) NOT NULL,"reason" VARCHAR(1000) NOT NULL,"candidate_snapshot" JSONB NOT NULL,"resolved_at" TIMESTAMPTZ(3),
 CONSTRAINT "billing_exception_values_check" CHECK (jsonb_typeof("candidate_snapshot")='array' AND (("status"='OPEN' AND "resolved_at" IS NULL) OR ("status"='RESOLVED' AND "resolved_at" IS NOT NULL)))
);
CREATE UNIQUE INDEX "billing_exception_calculation_key" ON "tms"."billing_exception"("tenant_id","charge_calculation_id");
CREATE INDEX "billing_exception_workbench_idx" ON "tms"."billing_exception"("tenant_id","status","created_at");

CREATE TABLE "tms"."accrual_voucher" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."AccrualVoucherStatus" NOT NULL DEFAULT 'DRAFT',"voucher_no" VARCHAR(100) NOT NULL,"shipment_id" UUID NOT NULL,"charge_calculation_id" UUID NOT NULL,"amount" DECIMAL(24,6) NOT NULL,"currency" CHAR(3) NOT NULL,"accounting_date" DATE NOT NULL,"basis_snapshot" JSONB NOT NULL,"posted_at" TIMESTAMPTZ(3),"reversal_of_id" UUID,
 CONSTRAINT "accrual_voucher_values_check" CHECK (jsonb_typeof("basis_snapshot")='object' AND (("status"='DRAFT' AND "posted_at" IS NULL) OR ("status" IN ('POSTED','REVERSED') AND "posted_at" IS NOT NULL)))
);
CREATE UNIQUE INDEX "accrual_voucher_tenant_no_key" ON "tms"."accrual_voucher"("tenant_id","voucher_no");
CREATE UNIQUE INDEX "accrual_voucher_original_calculation_key" ON "tms"."accrual_voucher"("tenant_id","charge_calculation_id") WHERE "reversal_of_id" IS NULL;
CREATE INDEX "accrual_voucher_status_date_idx" ON "tms"."accrual_voucher"("tenant_id","status","accounting_date");

CREATE TABLE "tms"."carrier_statement" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."StatementStatus" NOT NULL DEFAULT 'DRAFT',"statement_no" VARCHAR(100) NOT NULL,"carrier_ref" VARCHAR(200) NOT NULL,"contract_id" UUID NOT NULL,"period_from" DATE NOT NULL,"period_to" DATE NOT NULL,"subtotal" DECIMAL(24,6) NOT NULL,"tax_amount" DECIMAL(24,6) NOT NULL,"total_amount" DECIMAL(24,6) NOT NULL,"currency" CHAR(3) NOT NULL,"dispute_snapshot" JSONB NOT NULL DEFAULT '{}',"confirmed_at" TIMESTAMPTZ(3),CONSTRAINT "carrier_statement_values_check" CHECK ("period_to">="period_from" AND "total_amount"="subtotal"+"tax_amount" AND jsonb_typeof("dispute_snapshot")='object')
);
CREATE UNIQUE INDEX "carrier_statement_tenant_no_key" ON "tms"."carrier_statement"("tenant_id","statement_no");
CREATE INDEX "carrier_statement_partner_idx" ON "tms"."carrier_statement"("tenant_id","carrier_ref","status","period_from");

CREATE TABLE "tms"."customer_statement" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."StatementStatus" NOT NULL DEFAULT 'DRAFT',"statement_no" VARCHAR(100) NOT NULL,"customer_ref" VARCHAR(200) NOT NULL,"contract_id" UUID NOT NULL,"period_from" DATE NOT NULL,"period_to" DATE NOT NULL,"subtotal" DECIMAL(24,6) NOT NULL,"tax_amount" DECIMAL(24,6) NOT NULL,"total_amount" DECIMAL(24,6) NOT NULL,"currency" CHAR(3) NOT NULL,"pricing_snapshot" JSONB NOT NULL,"dispute_snapshot" JSONB NOT NULL DEFAULT '{}',"confirmed_at" TIMESTAMPTZ(3),CONSTRAINT "customer_statement_values_check" CHECK ("period_to">="period_from" AND "total_amount"="subtotal"+"tax_amount" AND jsonb_typeof("pricing_snapshot")='object' AND jsonb_typeof("dispute_snapshot")='object')
);
CREATE UNIQUE INDEX "customer_statement_tenant_no_key" ON "tms"."customer_statement"("tenant_id","statement_no");
CREATE INDEX "customer_statement_partner_idx" ON "tms"."customer_statement"("tenant_id","customer_ref","status","period_from");

CREATE TABLE "tms"."settlement_statement_line" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."SettlementLineStatus" NOT NULL DEFAULT 'ACTIVE',"direction" "tms"."ChargeDirection" NOT NULL,"statement_id" UUID NOT NULL,"charge_calculation_id" UUID NOT NULL,"shipment_id" UUID NOT NULL,"amount" DECIMAL(24,6) NOT NULL,"tax_amount" DECIMAL(24,6) NOT NULL,"currency" CHAR(3) NOT NULL,"line_snapshot" JSONB NOT NULL,CONSTRAINT "settlement_statement_line_values_check" CHECK ("amount">=0 AND "tax_amount">=0 AND jsonb_typeof("line_snapshot")='object')
);
CREATE UNIQUE INDEX "settlement_line_calculation_key" ON "tms"."settlement_statement_line"("tenant_id","direction","charge_calculation_id");
CREATE INDEX "settlement_line_statement_idx" ON "tms"."settlement_statement_line"("tenant_id","direction","statement_id");

CREATE TABLE "tms"."ap_voucher" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."FinancialVoucherStatus" NOT NULL DEFAULT 'DRAFT',"voucher_no" VARCHAR(100) NOT NULL,"carrier_statement_id" UUID NOT NULL,"amount" DECIMAL(24,6) NOT NULL,"tax_amount" DECIMAL(24,6) NOT NULL,"currency" CHAR(3) NOT NULL,"source_snapshot" JSONB NOT NULL,"approved_at" TIMESTAMPTZ(3),"paid_at" TIMESTAMPTZ(3),CONSTRAINT "ap_voucher_values_check" CHECK ("amount">=0 AND "tax_amount">=0 AND jsonb_typeof("source_snapshot")='object')
);
CREATE UNIQUE INDEX "ap_voucher_tenant_no_key" ON "tms"."ap_voucher"("tenant_id","voucher_no");
CREATE UNIQUE INDEX "ap_voucher_statement_key" ON "tms"."ap_voucher"("tenant_id","carrier_statement_id");

CREATE TABLE "tms"."ar_voucher" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."FinancialVoucherStatus" NOT NULL DEFAULT 'DRAFT',"voucher_no" VARCHAR(100) NOT NULL,"customer_statement_id" UUID NOT NULL,"amount" DECIMAL(24,6) NOT NULL,"tax_amount" DECIMAL(24,6) NOT NULL,"currency" CHAR(3) NOT NULL,"source_snapshot" JSONB NOT NULL,"approved_at" TIMESTAMPTZ(3),"paid_at" TIMESTAMPTZ(3),CONSTRAINT "ar_voucher_values_check" CHECK ("amount">=0 AND "tax_amount">=0 AND jsonb_typeof("source_snapshot")='object')
);
CREATE UNIQUE INDEX "ar_voucher_tenant_no_key" ON "tms"."ar_voucher"("tenant_id","voucher_no");
CREATE UNIQUE INDEX "ar_voucher_statement_key" ON "tms"."ar_voucher"("tenant_id","customer_statement_id");

CREATE TRIGGER freight_charge_fact_immutable BEFORE UPDATE OR DELETE ON "tms"."freight_charge_fact" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER charge_calculation_immutable BEFORE UPDATE OR DELETE ON "tms"."charge_calculation" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER settlement_statement_line_immutable BEFORE UPDATE OR DELETE ON "tms"."settlement_statement_line" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
