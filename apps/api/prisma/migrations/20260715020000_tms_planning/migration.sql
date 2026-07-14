-- CreateEnum
CREATE TYPE "tms"."PlanningBatchStatus" AS ENUM ('DRAFT', 'PLANNING', 'PLANNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tms"."PlanningLockStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "tms"."ConsolidationPlanStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tms"."ShipmentStatus" AS ENUM ('PLANNED', 'APPROVED', 'TENDERED', 'ACCEPTED', 'DISPATCHED', 'TRACKING', 'DELIVERED', 'POD', 'SETTLED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tms"."TransportLegStatus" AS ENUM ('PLANNED', 'TENDERED', 'ACCEPTED', 'DISPATCHED', 'TRACKING', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tms"."TransportMode" AS ENUM ('ROAD_FTL', 'ROAD_LTL', 'EXPRESS', 'RAIL', 'SEA', 'AIR', 'MULTIMODAL');

-- CreateTable
CREATE TABLE "tms"."planning_batch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."PlanningBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "batch_no" VARCHAR(100) NOT NULL,
    "planning_date" DATE NOT NULL,
    "region_code" VARCHAR(100) NOT NULL,
    "mode" "tms"."TransportMode",
    "customer_ref" VARCHAR(200),
    "priority_from" INTEGER NOT NULL DEFAULT 1,
    "priority_to" INTEGER NOT NULL DEFAULT 999,
    "criteria" JSONB NOT NULL,
    "planned_at" TIMESTAMPTZ(3),

    CONSTRAINT "planning_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."planning_lock" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."PlanningLockStatus" NOT NULL DEFAULT 'ACTIVE',
    "planning_batch_id" UUID NOT NULL,
    "transport_order_id" UUID NOT NULL,
    "planner_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "release_reason" VARCHAR(500),

    CONSTRAINT "planning_lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."consolidation_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."ConsolidationPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "plan_no" VARCHAR(100) NOT NULL,
    "planning_batch_id" UUID NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "validated_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "consolidation_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."shipment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."ShipmentStatus" NOT NULL DEFAULT 'PLANNED',
    "shipment_no" VARCHAR(100) NOT NULL,
    "consolidation_plan_id" UUID NOT NULL,
    "mode" "tms"."TransportMode" NOT NULL,
    "origin_snapshot" JSONB NOT NULL,
    "destination_snapshot" JSONB NOT NULL,
    "pickup_window_from" TIMESTAMPTZ(3) NOT NULL,
    "delivery_window_to" TIMESTAMPTZ(3) NOT NULL,
    "total_weight_base" DECIMAL(24,12) NOT NULL,
    "total_volume_base" DECIMAL(24,12) NOT NULL,
    "total_pallets" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "temperature_min" DECIMAL(8,3),
    "temperature_max" DECIMAL(8,3),
    "requirement_snapshot" JSONB NOT NULL,

    CONSTRAINT "shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."shipment_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "shipment_id" UUID NOT NULL,
    "transport_order_id" UUID NOT NULL,
    "source_line_ref" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(24,12) NOT NULL,
    "quantity_uom" VARCHAR(20) NOT NULL,
    "quantity_base" DECIMAL(24,12) NOT NULL,
    "quantity_base_uom" VARCHAR(20) NOT NULL,
    "allocation_ratio" DECIMAL(18,12) NOT NULL,
    "weight_base" DECIMAL(24,12) NOT NULL,
    "volume_base" DECIMAL(24,12) NOT NULL,
    "item_snapshot" JSONB NOT NULL,

    CONSTRAINT "shipment_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."transport_leg" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TransportLegStatus" NOT NULL DEFAULT 'PLANNED',
    "shipment_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "mode" "tms"."TransportMode" NOT NULL,
    "carrier_ref" VARCHAR(200),
    "carrier_snapshot" JSONB NOT NULL DEFAULT '{}',
    "origin_node_snapshot" JSONB NOT NULL,
    "destination_snapshot" JSONB NOT NULL,
    "planned_start_at" TIMESTAMPTZ(3) NOT NULL,
    "planned_end_at" TIMESTAMPTZ(3) NOT NULL,
    "sla_snapshot" JSONB NOT NULL,

    CONSTRAINT "transport_leg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."mode_decision" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "shipment_id" UUID NOT NULL,
    "selected_mode" "tms"."TransportMode" NOT NULL,
    "rule_version" VARCHAR(100) NOT NULL,
    "candidates" JSONB NOT NULL,
    "explanation" JSONB NOT NULL,

    CONSTRAINT "mode_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."equipment_selection" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "transport_leg_id" UUID NOT NULL,
    "equipment_type" VARCHAR(100) NOT NULL,
    "equipment_snapshot" JSONB NOT NULL,
    "capacity_weight_base" DECIMAL(24,12) NOT NULL,
    "capacity_volume_base" DECIMAL(24,12) NOT NULL,
    "capacity_pallets" DECIMAL(24,12) NOT NULL,
    "required_weight_base" DECIMAL(24,12) NOT NULL,
    "required_volume_base" DECIMAL(24,12) NOT NULL,
    "required_pallets" DECIMAL(24,12) NOT NULL,
    "compatible" BOOLEAN NOT NULL,
    "exclusion_reasons" JSONB NOT NULL,
    "requirement_snapshot" JSONB NOT NULL,

    CONSTRAINT "equipment_selection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planning_batch_tenant_date_region_status_idx" ON "tms"."planning_batch"("tenant_id", "planning_date", "region_code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "planning_batch_tenant_no_key" ON "tms"."planning_batch"("tenant_id", "batch_no");

-- CreateIndex
CREATE INDEX "planning_lock_tenant_batch_status_created_idx" ON "tms"."planning_lock"("tenant_id", "planning_batch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "planning_lock_tenant_order_status_idx" ON "tms"."planning_lock"("tenant_id", "transport_order_id", "status");

-- CreateIndex
CREATE INDEX "consolidation_plan_tenant_batch_status_created_idx" ON "tms"."consolidation_plan"("tenant_id", "planning_batch_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_plan_tenant_no_key" ON "tms"."consolidation_plan"("tenant_id", "plan_no");

-- CreateIndex
CREATE INDEX "shipment_tenant_plan_status_created_idx" ON "tms"."shipment"("tenant_id", "consolidation_plan_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_tenant_no_key" ON "tms"."shipment"("tenant_id", "shipment_no");

-- CreateIndex
CREATE INDEX "shipment_item_tenant_shipment_line_idx" ON "tms"."shipment_item"("tenant_id", "shipment_id", "source_line_ref");

-- CreateIndex
CREATE INDEX "shipment_item_tenant_order_line_idx" ON "tms"."shipment_item"("tenant_id", "transport_order_id", "source_line_ref");

-- CreateIndex
CREATE INDEX "transport_leg_tenant_carrier_status_start_idx" ON "tms"."transport_leg"("tenant_id", "carrier_ref", "status", "planned_start_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_leg_tenant_shipment_sequence_key" ON "tms"."transport_leg"("tenant_id", "shipment_id", "sequence");

-- CreateIndex
CREATE INDEX "mode_decision_tenant_shipment_created_idx" ON "tms"."mode_decision"("tenant_id", "shipment_id", "created_at");

-- CreateIndex
CREATE INDEX "equipment_selection_tenant_leg_created_idx" ON "tms"."equipment_selection"("tenant_id", "transport_leg_id", "created_at");

CREATE UNIQUE INDEX "planning_lock_active_order_key" ON "tms"."planning_lock"("tenant_id", "transport_order_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "tms"."planning_batch" ADD CONSTRAINT "planning_batch_values_valid" CHECK ("version">0 AND "priority_from">0 AND "priority_to">="priority_from" AND length(btrim("region_code"))>0 AND jsonb_typeof("criteria")='object' AND ("status"<>'PLANNED' OR "planned_at" IS NOT NULL));
ALTER TABLE "tms"."planning_lock" ADD CONSTRAINT "planning_lock_values_valid" CHECK ("version">0 AND "expires_at">"created_at" AND ("status"='ACTIVE' OR "released_at" IS NOT NULL));
ALTER TABLE "tms"."consolidation_plan" ADD CONSTRAINT "consolidation_plan_values_valid" CHECK ("version">0 AND jsonb_typeof("policy_snapshot")='object' AND ("status"<>'VALIDATED' OR "validated_at" IS NOT NULL) AND ("status"<>'PUBLISHED' OR "published_at" IS NOT NULL));
ALTER TABLE "tms"."shipment" ADD CONSTRAINT "shipment_values_valid" CHECK ("version">0 AND "pickup_window_from"<"delivery_window_to" AND "total_weight_base">0 AND "total_volume_base">0 AND "total_pallets">=0 AND ("temperature_min" IS NULL OR ("temperature_max" IS NOT NULL AND "temperature_min"<="temperature_max")) AND jsonb_typeof("origin_snapshot")='object' AND jsonb_typeof("destination_snapshot")='object' AND jsonb_typeof("requirement_snapshot")='object');
ALTER TABLE "tms"."shipment_item" ADD CONSTRAINT "shipment_item_values_valid" CHECK ("version">0 AND "quantity">0 AND "quantity_base">0 AND "allocation_ratio">0 AND "allocation_ratio"<=1 AND "weight_base">0 AND "volume_base">0 AND jsonb_typeof("item_snapshot")='object');
ALTER TABLE "tms"."transport_leg" ADD CONSTRAINT "transport_leg_values_valid" CHECK ("version">0 AND "sequence">0 AND "planned_start_at"<"planned_end_at" AND jsonb_typeof("carrier_snapshot")='object' AND jsonb_typeof("origin_node_snapshot")='object' AND jsonb_typeof("destination_snapshot")='object' AND jsonb_typeof("sla_snapshot")='object');
ALTER TABLE "tms"."mode_decision" ADD CONSTRAINT "mode_decision_values_valid" CHECK ("version">0 AND length(btrim("rule_version"))>0 AND jsonb_typeof("candidates")='array' AND jsonb_typeof("explanation")='object');
ALTER TABLE "tms"."equipment_selection" ADD CONSTRAINT "equipment_selection_values_valid" CHECK ("version">0 AND "capacity_weight_base">0 AND "capacity_volume_base">0 AND "capacity_pallets">=0 AND "required_weight_base">0 AND "required_volume_base">0 AND "required_pallets">=0 AND jsonb_typeof("equipment_snapshot")='object' AND jsonb_typeof("exclusion_reasons")='array' AND jsonb_typeof("requirement_snapshot")='object');

CREATE TRIGGER "shipment_item_immutable" BEFORE UPDATE OR DELETE ON "tms"."shipment_item" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "mode_decision_immutable" BEFORE UPDATE OR DELETE ON "tms"."mode_decision" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "equipment_selection_immutable" BEFORE UPDATE OR DELETE ON "tms"."equipment_selection" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();

