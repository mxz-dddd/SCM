-- CreateEnum
CREATE TYPE "tms"."CapacitySourceType" AS ENUM ('OWN_FLEET', 'CONTRACT', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "tms"."CapacityPoolStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "tms"."CapacityReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "tms"."PlanApprovalDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "tms"."CarrierTenderStatus" AS ENUM ('SENT', 'ACCEPTED', 'REJECTED', 'QUESTIONED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "tms"."QuoteRequestStatus" AS ENUM ('OPEN', 'CLOSED', 'AWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tms"."CarrierBidStatus" AS ENUM ('SUBMITTED', 'WITHDRAWN', 'AWARDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "tms"."AwardDecisionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "tms"."RetenderCaseStatus" AS ENUM ('OPEN', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "tms"."SubcontractAssignmentStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'REVOKED');

-- AlterEnum
ALTER TYPE "tms"."ConsolidationPlanStatus" ADD VALUE 'APPROVED';
ALTER TYPE "tms"."ConsolidationPlanStatus" ADD VALUE 'REJECTED';
ALTER TYPE "tms"."ShipmentStatus" ADD VALUE 'REJECTED';

-- CreateTable
CREATE TABLE "tms"."capacity_pool" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."CapacityPoolStatus" NOT NULL DEFAULT 'ACTIVE',
    "pool_no" VARCHAR(100) NOT NULL,
    "source_type" "tms"."CapacitySourceType" NOT NULL,
    "carrier_ref" VARCHAR(200) NOT NULL,
    "carrier_snapshot" JSONB NOT NULL,
    "vehicle_type" VARCHAR(100) NOT NULL,
    "region_code" VARCHAR(100) NOT NULL,
    "service_date" DATE NOT NULL,
    "total_weight_base" DECIMAL(24,12) NOT NULL,
    "total_volume_base" DECIMAL(24,12) NOT NULL,
    "total_pallets" DECIMAL(24,12) NOT NULL,
    "reserved_weight_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "reserved_volume_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "reserved_pallets" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "calendar_snapshot" JSONB NOT NULL,
    "qualification_snapshot" JSONB NOT NULL,

    CONSTRAINT "capacity_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."capacity_reservation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."CapacityReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reservation_no" VARCHAR(100) NOT NULL,
    "capacity_pool_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "weight_base" DECIMAL(24,12) NOT NULL,
    "volume_base" DECIMAL(24,12) NOT NULL,
    "pallets" DECIMAL(24,12) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "release_reason" VARCHAR(500),

    CONSTRAINT "capacity_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."transport_plan_approval" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "consolidation_plan_id" UUID NOT NULL,
    "plan_version" INTEGER NOT NULL,
    "decision" "tms"."PlanApprovalDecision" NOT NULL,
    "cost_amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "variance_percentage" DECIMAL(12,6) NOT NULL,
    "risk_snapshot" JSONB NOT NULL,
    "qualification_snapshot" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID NOT NULL,

    CONSTRAINT "transport_plan_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."carrier_tender" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."CarrierTenderStatus" NOT NULL DEFAULT 'SENT',
    "tender_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "capacity_reservation_id" UUID NOT NULL,
    "previous_tender_id" UUID,
    "carrier_ref" VARCHAR(200) NOT NULL,
    "carrier_snapshot" JSONB NOT NULL,
    "price_amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "requirement_snapshot" JSONB NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(3),
    "response_reason" VARCHAR(500),
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(500),

    CONSTRAINT "carrier_tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."quote_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."QuoteRequestStatus" NOT NULL DEFAULT 'OPEN',
    "request_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "request_type" VARCHAR(50) NOT NULL,
    "candidate_carriers" JSONB NOT NULL,
    "requirement_snapshot" JSONB NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "quote_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."carrier_bid" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."CarrierBidStatus" NOT NULL DEFAULT 'SUBMITTED',
    "quote_request_id" UUID NOT NULL,
    "carrier_ref" VARCHAR(200) NOT NULL,
    "carrier_snapshot" JSONB NOT NULL,
    "price_amount" DECIMAL(24,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "promised_at" TIMESTAMPTZ(3) NOT NULL,
    "conditions" JSONB NOT NULL,
    "score" DECIMAL(18,6),
    "score_breakdown" JSONB NOT NULL DEFAULT '{}',
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."award_decision" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."AwardDecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "quote_request_id" UUID NOT NULL,
    "carrier_bid_id" UUID NOT NULL,
    "capacity_reservation_id" UUID,
    "recommendation_snapshot" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" UUID,

    CONSTRAINT "award_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."retender_case" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."RetenderCaseStatus" NOT NULL DEFAULT 'OPEN',
    "shipment_id" UUID NOT NULL,
    "original_tender_id" UUID NOT NULL,
    "replacement_tender_id" UUID,
    "reason_code" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "original_price_amount" DECIMAL(24,6) NOT NULL,
    "replacement_price_amount" DECIMAL(24,6),
    "currency" CHAR(3) NOT NULL,
    "price_difference" DECIMAL(24,6),
    "escalation_required" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "retender_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."subcontract_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."SubcontractAssignmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "shipment_id" UUID NOT NULL,
    "parent_tender_id" UUID NOT NULL,
    "upstream_carrier_ref" VARCHAR(200) NOT NULL,
    "downstream_carrier_ref" VARCHAR(200) NOT NULL,
    "actual_carrier_ref" VARCHAR(200) NOT NULL,
    "responsibility_chain" JSONB NOT NULL,
    "visibility_scope" JSONB NOT NULL,
    "fee_layer_snapshot" JSONB NOT NULL,
    "compliance_snapshot" JSONB NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "response_reason" VARCHAR(500),

    CONSTRAINT "subcontract_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capacity_pool_tenant_date_region_vehicle_status_idx" ON "tms"."capacity_pool"("tenant_id", "service_date", "region_code", "vehicle_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capacity_pool_tenant_no_key" ON "tms"."capacity_pool"("tenant_id", "pool_no");

-- CreateIndex
CREATE INDEX "capacity_reservation_tenant_pool_status_expiry_idx" ON "tms"."capacity_reservation"("tenant_id", "capacity_pool_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "capacity_reservation_tenant_shipment_status_idx" ON "tms"."capacity_reservation"("tenant_id", "shipment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capacity_reservation_tenant_no_key" ON "tms"."capacity_reservation"("tenant_id", "reservation_no");

-- CreateIndex
CREATE INDEX "plan_approval_tenant_plan_decided_idx" ON "tms"."transport_plan_approval"("tenant_id", "consolidation_plan_id", "decided_at");

-- CreateIndex
CREATE INDEX "carrier_tender_tenant_shipment_status_sent_idx" ON "tms"."carrier_tender"("tenant_id", "shipment_id", "status", "sent_at");

-- CreateIndex
CREATE INDEX "carrier_tender_tenant_carrier_status_expiry_idx" ON "tms"."carrier_tender"("tenant_id", "carrier_ref", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_tender_tenant_no_key" ON "tms"."carrier_tender"("tenant_id", "tender_no");

-- CreateIndex
CREATE INDEX "quote_request_tenant_shipment_status_deadline_idx" ON "tms"."quote_request"("tenant_id", "shipment_id", "status", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "quote_request_tenant_no_key" ON "tms"."quote_request"("tenant_id", "request_no");

-- CreateIndex
CREATE INDEX "carrier_bid_tenant_request_status_price_idx" ON "tms"."carrier_bid"("tenant_id", "quote_request_id", "status", "price_amount");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_bid_tenant_request_carrier_key" ON "tms"."carrier_bid"("tenant_id", "quote_request_id", "carrier_ref");

-- CreateIndex
CREATE INDEX "award_decision_tenant_request_status_created_idx" ON "tms"."award_decision"("tenant_id", "quote_request_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "retender_case_tenant_shipment_status_created_idx" ON "tms"."retender_case"("tenant_id", "shipment_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "subcontract_tenant_shipment_status_created_idx" ON "tms"."subcontract_assignment"("tenant_id", "shipment_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "subcontract_tenant_tender_status_idx" ON "tms"."subcontract_assignment"("tenant_id", "parent_tender_id", "status");

CREATE UNIQUE INDEX "capacity_reservation_active_shipment_key" ON "tms"."capacity_reservation"("tenant_id","shipment_id") WHERE "status"='ACTIVE';
CREATE UNIQUE INDEX "carrier_tender_active_shipment_key" ON "tms"."carrier_tender"("tenant_id","shipment_id") WHERE "status" IN ('SENT','QUESTIONED','ACCEPTED');

ALTER TABLE "tms"."capacity_pool" ADD CONSTRAINT "capacity_pool_values_valid" CHECK ("version">0 AND "total_weight_base">0 AND "total_volume_base">0 AND "total_pallets">=0 AND "reserved_weight_base">=0 AND "reserved_volume_base">=0 AND "reserved_pallets">=0 AND "reserved_weight_base"<="total_weight_base" AND "reserved_volume_base"<="total_volume_base" AND "reserved_pallets"<="total_pallets" AND jsonb_typeof("carrier_snapshot")='object' AND jsonb_typeof("calendar_snapshot")='object' AND jsonb_typeof("qualification_snapshot")='object');
ALTER TABLE "tms"."capacity_reservation" ADD CONSTRAINT "capacity_reservation_values_valid" CHECK ("version">0 AND "weight_base">0 AND "volume_base">0 AND "pallets">=0 AND "expires_at">"created_at" AND ("status" NOT IN ('RELEASED','EXPIRED') OR "released_at" IS NOT NULL) AND ("status"<>'CONSUMED' OR "consumed_at" IS NOT NULL));
ALTER TABLE "tms"."transport_plan_approval" ADD CONSTRAINT "plan_approval_values_valid" CHECK ("version">0 AND "plan_version">0 AND "cost_amount">=0 AND length(btrim("currency"))=3 AND jsonb_typeof("risk_snapshot")='object' AND jsonb_typeof("qualification_snapshot")='object' AND length(btrim("reason"))>0);
ALTER TABLE "tms"."carrier_tender" ADD CONSTRAINT "carrier_tender_values_valid" CHECK ("version">0 AND "price_amount">=0 AND length(btrim("currency"))=3 AND "expires_at">"sent_at" AND jsonb_typeof("carrier_snapshot")='object' AND jsonb_typeof("requirement_snapshot")='object' AND ("status" NOT IN ('ACCEPTED','REJECTED','QUESTIONED','EXPIRED') OR "responded_at" IS NOT NULL) AND ("status"<>'REVOKED' OR ("revoked_at" IS NOT NULL AND "revoke_reason" IS NOT NULL)));
ALTER TABLE "tms"."quote_request" ADD CONSTRAINT "quote_request_values_valid" CHECK ("version">0 AND "request_type" IN ('QUOTE','BID') AND jsonb_typeof("candidate_carriers")='array' AND jsonb_typeof("requirement_snapshot")='object' AND ("status"='OPEN' OR "closed_at" IS NOT NULL));
ALTER TABLE "tms"."carrier_bid" ADD CONSTRAINT "carrier_bid_values_valid" CHECK ("version">0 AND "price_amount">=0 AND length(btrim("currency"))=3 AND jsonb_typeof("carrier_snapshot")='object' AND jsonb_typeof("conditions")='object' AND jsonb_typeof("score_breakdown")='object');
ALTER TABLE "tms"."award_decision" ADD CONSTRAINT "award_decision_values_valid" CHECK ("version">0 AND jsonb_typeof("recommendation_snapshot")='object' AND length(btrim("reason"))>0 AND ("status"='PROPOSED' OR ("decided_at" IS NOT NULL AND "decided_by" IS NOT NULL)));
ALTER TABLE "tms"."retender_case" ADD CONSTRAINT "retender_case_values_valid" CHECK ("version">0 AND "original_price_amount">=0 AND length(btrim("currency"))=3 AND ("replacement_price_amount" IS NULL OR "replacement_price_amount">=0) AND ("status"<>'RESOLVED' OR ("replacement_tender_id" IS NOT NULL AND "resolved_at" IS NOT NULL)));
ALTER TABLE "tms"."subcontract_assignment" ADD CONSTRAINT "subcontract_values_valid" CHECK ("version">0 AND "upstream_carrier_ref"<>"downstream_carrier_ref" AND jsonb_typeof("responsibility_chain")='array' AND jsonb_typeof("visibility_scope")='object' AND jsonb_typeof("fee_layer_snapshot")='object' AND jsonb_typeof("compliance_snapshot")='object' AND ("status"='PROPOSED' OR "responded_at" IS NOT NULL));

CREATE TRIGGER "transport_plan_approval_immutable" BEFORE UPDATE OR DELETE ON "tms"."transport_plan_approval" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
