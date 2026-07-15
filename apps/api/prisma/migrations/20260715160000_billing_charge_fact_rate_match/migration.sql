CREATE TYPE "billing"."BillingFactStatus" AS ENUM ('ACTIVE');
CREATE TYPE "billing"."RateMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED');
CREATE TYPE "billing"."RateMatchExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "billing"."charge_fact" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingFactStatus" NOT NULL DEFAULT 'ACTIVE',
  "event_id" VARCHAR(200) NOT NULL, "source_domain" VARCHAR(20) NOT NULL,
  "source_event_type" VARCHAR(150) NOT NULL, "aggregate_ref" VARCHAR(200) NOT NULL,
  "business_ref" VARCHAR(200) NOT NULL, "charge_type" VARCHAR(100) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL, "quantity_original" DECIMAL(24,6) NOT NULL,
  "quantity_uom" VARCHAR(20) NOT NULL, "quantity_base" DECIMAL(24,6) NOT NULL,
  "quantity_base_uom" VARCHAR(20) NOT NULL, "amount" DECIMAL(24,6), "currency" CHAR(3) NOT NULL,
  "party_ref" UUID NOT NULL, "organization_ref" UUID, "route_ref" VARCHAR(200),
  "service_type" VARCHAR(100) NOT NULL, "dimensions" JSONB NOT NULL DEFAULT '{}',
  "source_snapshot" JSONB NOT NULL, "content_hash" CHAR(64) NOT NULL,
  CONSTRAINT "charge_fact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "charge_fact_quantities_nonnegative" CHECK ("quantity_original" >= 0 AND "quantity_base" >= 0),
  CONSTRAINT "charge_fact_amount_valid" CHECK ("amount" IS NULL OR "amount" >= 0)
);
CREATE UNIQUE INDEX "charge_fact_tenant_event_key" ON "billing"."charge_fact"("tenant_id", "event_id");
CREATE UNIQUE INDEX "charge_fact_business_charge_key" ON "billing"."charge_fact"("tenant_id", "business_ref", "charge_type");
CREATE INDEX "charge_fact_occurred_business_idx" ON "billing"."charge_fact"("tenant_id", "occurred_at", "business_ref");
CREATE INDEX "charge_fact_match_dimension_idx" ON "billing"."charge_fact"("tenant_id", "party_ref", "service_type", "currency");

CREATE TABLE "billing"."fact_correction" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingFactStatus" NOT NULL DEFAULT 'ACTIVE',
  "charge_fact_id" UUID NOT NULL, "correction_no" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL, "corrected_snapshot" JSONB NOT NULL,
  "previous_hash" CHAR(64) NOT NULL, "content_hash" CHAR(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fact_correction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fact_correction_tenant_no_key" ON "billing"."fact_correction"("tenant_id", "correction_no");
CREATE UNIQUE INDEX "fact_correction_content_key" ON "billing"."fact_correction"("tenant_id", "charge_fact_id", "content_hash");
CREATE INDEX "fact_correction_fact_time_idx" ON "billing"."fact_correction"("tenant_id", "charge_fact_id", "occurred_at");

CREATE TABLE "billing"."rate_match" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."RateMatchStatus" NOT NULL,
  "match_key" VARCHAR(200) NOT NULL, "charge_fact_id" UUID NOT NULL, "fact_correction_id" UUID,
  "fact_occurred_at" TIMESTAMPTZ(3) NOT NULL, "contract_ref" UUID, "rate_card_ref" UUID,
  "rate_version_ref" UUID, "rate_version_number" INTEGER, "base_rate" DECIMAL(24,6),
  "currency" CHAR(3) NOT NULL, "priority" INTEGER,
  "matched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_match_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rate_match_tenant_key" ON "billing"."rate_match"("tenant_id", "match_key");
CREATE INDEX "rate_match_fact_time_idx" ON "billing"."rate_match"("tenant_id", "charge_fact_id", "matched_at");
CREATE INDEX "rate_match_status_time_idx" ON "billing"."rate_match"("tenant_id", "status", "matched_at");

CREATE TABLE "billing"."match_trace" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."BillingFactStatus" NOT NULL DEFAULT 'ACTIVE',
  "rate_match_id" UUID NOT NULL, "trace_version" INTEGER NOT NULL DEFAULT 1,
  "input_snapshot" JSONB NOT NULL, "candidate_snapshot" JSONB NOT NULL,
  "decision_snapshot" JSONB NOT NULL,
  CONSTRAINT "match_trace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "match_trace_rate_match_key" ON "billing"."match_trace"("tenant_id", "rate_match_id");
CREATE INDEX "match_trace_created_idx" ON "billing"."match_trace"("tenant_id", "created_at", "rate_match_id");

CREATE TABLE "billing"."rate_match_exception" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "billing"."RateMatchExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "charge_fact_id" UUID NOT NULL, "rate_match_id" UUID NOT NULL, "code" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL, "candidate_snapshot" JSONB NOT NULL,
  "resolved_at" TIMESTAMPTZ(3), CONSTRAINT "rate_match_exception_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rate_match_exception_match_key" ON "billing"."rate_match_exception"("tenant_id", "rate_match_id");
CREATE INDEX "rate_match_exception_workbench_idx" ON "billing"."rate_match_exception"("tenant_id", "status", "created_at");

CREATE OR REPLACE FUNCTION "billing"."reject_billing_fact_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Billing facts and traces are immutable' USING ERRCODE = '55000'; END; $$;
CREATE TRIGGER "charge_fact_immutable" BEFORE UPDATE OR DELETE ON "billing"."charge_fact" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_fact_mutation"();
CREATE TRIGGER "fact_correction_immutable" BEFORE UPDATE OR DELETE ON "billing"."fact_correction" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_fact_mutation"();
CREATE TRIGGER "rate_match_immutable" BEFORE UPDATE OR DELETE ON "billing"."rate_match" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_fact_mutation"();
CREATE TRIGGER "match_trace_immutable" BEFORE UPDATE OR DELETE ON "billing"."match_trace" FOR EACH ROW EXECUTE FUNCTION "billing"."reject_billing_fact_mutation"();
