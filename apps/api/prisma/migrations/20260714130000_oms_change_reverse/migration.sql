-- CreateEnum
CREATE TYPE "oms"."OrderChangeStatus" AS ENUM ('PENDING_CONFIRMATIONS', 'APPLIED', 'REJECTED', 'COMPENSATING', 'FAILED');

-- CreateEnum
CREATE TYPE "oms"."DomainConfirmationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "oms"."BackorderStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "oms"."BackorderDisposition" AS ENUM ('WAIT', 'SUBSTITUTE', 'REALLOCATE', 'CANCEL');

-- CreateEnum
CREATE TYPE "oms"."SubstitutionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "oms"."RmaStatus" AS ENUM ('REQUESTED', 'AUTHORIZED', 'REJECTED', 'RECEIVED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "oms"."RmaResolution" AS ENUM ('REFUND', 'EXCHANGE', 'REPAIR', 'REJECT');

-- AlterEnum
ALTER TYPE "oms"."OrderStatus" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "oms"."order_change" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "oms"."OrderChangeStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATIONS',
    "business_order_id" UUID NOT NULL,
    "order_version" INTEGER NOT NULL,
    "requested_changes" JSONB NOT NULL,
    "impact_assessment" JSONB NOT NULL,
    "required_domains" TEXT[],
    "applied_order_version" INTEGER,
    "failure_reason" VARCHAR(1000),

    CONSTRAINT "order_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oms"."change_domain_confirmation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "oms"."DomainConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "order_change_id" UUID NOT NULL,
    "domain" VARCHAR(50) NOT NULL,
    "reason" VARCHAR(1000),
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "change_domain_confirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oms"."order_line_progress" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "business_order_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "source_version" INTEGER NOT NULL,
    "promised_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "allocated_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "shipped_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "delivered_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "cancelled_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "base_uom" VARCHAR(20) NOT NULL,

    CONSTRAINT "order_line_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oms"."backorder" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "oms"."BackorderStatus" NOT NULL DEFAULT 'OPEN',
    "business_order_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "quantity_base" DECIMAL(24,12) NOT NULL,
    "base_uom" VARCHAR(20) NOT NULL,
    "disposition" "oms"."BackorderDisposition" NOT NULL DEFAULT 'WAIT',
    "reason" VARCHAR(1000) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "backorder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oms"."substitution_proposal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "oms"."SubstitutionStatus" NOT NULL DEFAULT 'PENDING',
    "business_order_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "original_product_id" UUID NOT NULL,
    "replacement_product_id" UUID NOT NULL,
    "quantity_original" DECIMAL(24,12) NOT NULL,
    "original_uom" VARCHAR(20) NOT NULL,
    "quantity_base" DECIMAL(24,12) NOT NULL,
    "base_uom" VARCHAR(20) NOT NULL,
    "compatibility_snapshot" JSONB NOT NULL,
    "price_delta" DECIMAL(24,6),
    "currency" CHAR(3),
    "respond_by" TIMESTAMPTZ(3) NOT NULL,
    "timeout_policy" "oms"."BackorderDisposition" NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "decision_reason" VARCHAR(1000),

    CONSTRAINT "substitution_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oms"."return_merchandise_authorization" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "oms"."RmaStatus" NOT NULL DEFAULT 'REQUESTED',
    "rma_no" VARCHAR(100) NOT NULL,
    "business_order_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "return_by" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "resolution" "oms"."RmaResolution",
    "reverse_shipment_request_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "return_merchandise_authorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oms"."rma_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "rma_id" UUID NOT NULL,
    "source_order_line_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_original" DECIMAL(24,12) NOT NULL,
    "original_uom" VARCHAR(20) NOT NULL,
    "quantity_base" DECIMAL(24,12) NOT NULL,
    "base_uom" VARCHAR(20) NOT NULL,
    "item_condition" VARCHAR(100) NOT NULL,

    CONSTRAINT "rma_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_change_order_idx" ON "oms"."order_change"("tenant_id", "business_order_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "change_confirmation_status_idx" ON "oms"."change_domain_confirmation"("tenant_id", "order_change_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_confirmation_domain_key" ON "oms"."change_domain_confirmation"("tenant_id", "order_change_id", "domain");

-- CreateIndex
CREATE INDEX "order_line_progress_order_idx" ON "oms"."order_line_progress"("tenant_id", "business_order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_progress_line_key" ON "oms"."order_line_progress"("tenant_id", "order_line_id");

-- CreateIndex
CREATE INDEX "backorder_order_idx" ON "oms"."backorder"("tenant_id", "business_order_id", "status");

-- CreateIndex
CREATE INDEX "substitution_order_idx" ON "oms"."substitution_proposal"("tenant_id", "business_order_id", "status", "respond_by");

-- CreateIndex
CREATE INDEX "rma_order_idx" ON "oms"."return_merchandise_authorization"("tenant_id", "business_order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rma_tenant_no_key" ON "oms"."return_merchandise_authorization"("tenant_id", "rma_no");

-- CreateIndex
CREATE INDEX "rma_line_source_idx" ON "oms"."rma_line"("tenant_id", "source_order_line_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rma_line_no_key" ON "oms"."rma_line"("tenant_id", "rma_id", "line_no");

ALTER TABLE "oms"."order_change" ADD CONSTRAINT "order_change_values_valid" CHECK ("version">0 AND "order_version">0 AND jsonb_typeof("requested_changes")='object' AND jsonb_typeof("impact_assessment")='object');
ALTER TABLE "oms"."change_domain_confirmation" ADD CONSTRAINT "change_confirmation_values_valid" CHECK ("version">0 AND length(btrim("domain"))>0);
ALTER TABLE "oms"."order_line_progress" ADD CONSTRAINT "order_line_progress_values_valid" CHECK ("version">0 AND "source_version">0 AND "promised_base">=0 AND "allocated_base">=0 AND "shipped_base">=0 AND "delivered_base">=0 AND "cancelled_base">=0 AND "delivered_base"<="shipped_base" AND "shipped_base"<="allocated_base" AND "allocated_base"<="promised_base");
ALTER TABLE "oms"."backorder" ADD CONSTRAINT "backorder_values_valid" CHECK ("version">0 AND "quantity_base">0);
ALTER TABLE "oms"."substitution_proposal" ADD CONSTRAINT "substitution_values_valid" CHECK ("version">0 AND "original_product_id"<>"replacement_product_id" AND "quantity_original">0 AND "quantity_base">0 AND (("price_delta" IS NULL AND "currency" IS NULL) OR ("price_delta" IS NOT NULL AND "currency" IS NOT NULL)) AND jsonb_typeof("compatibility_snapshot")='object');
ALTER TABLE "oms"."return_merchandise_authorization" ADD CONSTRAINT "rma_values_valid" CHECK ("version">0 AND length(btrim("reason"))>0);
ALTER TABLE "oms"."rma_line" ADD CONSTRAINT "rma_line_values_valid" CHECK ("version">0 AND "line_no">0 AND "quantity_original">0 AND "quantity_base">0);
CREATE TRIGGER "rma_line_immutable" BEFORE UPDATE OR DELETE ON "oms"."rma_line" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
