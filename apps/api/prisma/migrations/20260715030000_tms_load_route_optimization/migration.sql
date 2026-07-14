-- CreateEnum
CREATE TYPE "tms"."LoadPlanStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tms"."RoutePlanStatus" AS ENUM ('DRAFT', 'OPTIMIZED', 'SELECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tms"."OptimizationScenarioStatus" AS ENUM ('PROPOSED', 'SELECTED', 'REJECTED');

-- CreateTable
CREATE TABLE "tms"."load_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."LoadPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "load_plan_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "equipment_selection_id" UUID NOT NULL,
    "layout_snapshot" JSONB NOT NULL,
    "validated_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "load_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."load_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "load_plan_id" UUID NOT NULL,
    "shipment_item_id" UUID NOT NULL,
    "assignment_no" INTEGER NOT NULL,
    "position" JSONB NOT NULL,
    "adjustment_type" VARCHAR(50) NOT NULL,
    "adjustment_ref" VARCHAR(200),
    "validation" JSONB NOT NULL,

    CONSTRAINT "load_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."utilization_metric" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "load_plan_id" UUID NOT NULL,
    "calculation_no" INTEGER NOT NULL,
    "weight_utilization" DECIMAL(12,6) NOT NULL,
    "volume_utilization" DECIMAL(12,6) NOT NULL,
    "pallet_utilization" DECIMAL(12,6) NOT NULL,
    "value_utilization" DECIMAL(12,6) NOT NULL,
    "compatible" BOOLEAN NOT NULL,
    "exclusion_reasons" JSONB NOT NULL,
    "calculation_trace" JSONB NOT NULL,

    CONSTRAINT "utilization_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."route_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."RoutePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "route_plan_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "constraint_snapshot" JSONB NOT NULL,
    "selected_scenario_id" UUID,
    "optimized_at" TIMESTAMPTZ(3),
    "selected_at" TIMESTAMPTZ(3),

    CONSTRAINT "route_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."route_stop" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "route_plan_id" UUID NOT NULL,
    "stop_ref" VARCHAR(200) NOT NULL,
    "stop_type" VARCHAR(50) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "location_snapshot" JSONB NOT NULL,
    "window_from" TIMESTAMPTZ(3) NOT NULL,
    "window_to" TIMESTAMPTZ(3) NOT NULL,
    "planned_arrival" TIMESTAMPTZ(3) NOT NULL,
    "planned_departure" TIMESTAMPTZ(3) NOT NULL,
    "service_minutes" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "route_stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."optimization_scenario" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."OptimizationScenarioStatus" NOT NULL DEFAULT 'PROPOSED',
    "route_plan_id" UUID NOT NULL,
    "parent_scenario_id" UUID,
    "scenario_no" INTEGER NOT NULL,
    "objective_weights" JSONB NOT NULL,
    "stop_sequence" JSONB NOT NULL,
    "locked_stop_refs" JSONB NOT NULL,
    "score" DECIMAL(18,6) NOT NULL,
    "score_breakdown" JSONB NOT NULL,
    "explanation" JSONB NOT NULL,
    "constraint_results" JSONB NOT NULL,

    CONSTRAINT "optimization_scenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "load_plan_tenant_shipment_status_created_idx" ON "tms"."load_plan"("tenant_id", "shipment_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "load_plan_tenant_no_key" ON "tms"."load_plan"("tenant_id", "load_plan_no");

-- CreateIndex
CREATE INDEX "load_assignment_tenant_plan_item_no_idx" ON "tms"."load_assignment"("tenant_id", "load_plan_id", "shipment_item_id", "assignment_no");

-- CreateIndex
CREATE INDEX "utilization_metric_tenant_plan_created_idx" ON "tms"."utilization_metric"("tenant_id", "load_plan_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "utilization_metric_tenant_plan_calculation_key" ON "tms"."utilization_metric"("tenant_id", "load_plan_id", "calculation_no");

-- CreateIndex
CREATE INDEX "route_plan_tenant_shipment_status_created_idx" ON "tms"."route_plan"("tenant_id", "shipment_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "route_plan_tenant_no_key" ON "tms"."route_plan"("tenant_id", "route_plan_no");

-- CreateIndex
CREATE INDEX "route_stop_tenant_plan_sequence_idx" ON "tms"."route_stop"("tenant_id", "route_plan_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "route_stop_tenant_plan_ref_key" ON "tms"."route_stop"("tenant_id", "route_plan_id", "stop_ref");

-- CreateIndex
CREATE INDEX "optimization_scenario_tenant_plan_status_score_idx" ON "tms"."optimization_scenario"("tenant_id", "route_plan_id", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "optimization_scenario_tenant_plan_no_key" ON "tms"."optimization_scenario"("tenant_id", "route_plan_id", "scenario_no");

ALTER TABLE "tms"."load_plan" ADD CONSTRAINT "load_plan_values_valid" CHECK ("version">0 AND jsonb_typeof("layout_snapshot")='object' AND ("status"<>'VALIDATED' OR "validated_at" IS NOT NULL) AND ("status"<>'PUBLISHED' OR "published_at" IS NOT NULL));
ALTER TABLE "tms"."load_assignment" ADD CONSTRAINT "load_assignment_values_valid" CHECK ("version">0 AND "assignment_no">0 AND jsonb_typeof("position")='object' AND jsonb_typeof("validation")='object');
ALTER TABLE "tms"."utilization_metric" ADD CONSTRAINT "utilization_metric_values_valid" CHECK ("version">0 AND "calculation_no">0 AND "weight_utilization">=0 AND "volume_utilization">=0 AND "pallet_utilization">=0 AND "value_utilization">=0 AND jsonb_typeof("exclusion_reasons")='array' AND jsonb_typeof("calculation_trace")='object');
ALTER TABLE "tms"."route_plan" ADD CONSTRAINT "route_plan_values_valid" CHECK ("version">0 AND jsonb_typeof("input_snapshot")='object' AND jsonb_typeof("constraint_snapshot")='object' AND ("status"<>'OPTIMIZED' OR "optimized_at" IS NOT NULL) AND ("status"<>'SELECTED' OR ("selected_at" IS NOT NULL AND "selected_scenario_id" IS NOT NULL)));
ALTER TABLE "tms"."route_stop" ADD CONSTRAINT "route_stop_values_valid" CHECK ("version">0 AND "sequence">0 AND "service_minutes">=0 AND "window_from"<="window_to" AND "planned_arrival"<="planned_departure" AND "planned_arrival">="window_from" AND "planned_arrival"<="window_to" AND jsonb_typeof("location_snapshot")='object');
ALTER TABLE "tms"."optimization_scenario" ADD CONSTRAINT "optimization_scenario_values_valid" CHECK ("version">0 AND "scenario_no">0 AND jsonb_typeof("objective_weights")='object' AND jsonb_typeof("stop_sequence")='array' AND jsonb_typeof("locked_stop_refs")='array' AND jsonb_typeof("score_breakdown")='object' AND jsonb_typeof("explanation")='object' AND jsonb_typeof("constraint_results")='object');

CREATE TRIGGER "load_assignment_immutable" BEFORE UPDATE OR DELETE ON "tms"."load_assignment" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "utilization_metric_immutable" BEFORE UPDATE OR DELETE ON "tms"."utilization_metric" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "route_stop_immutable" BEFORE UPDATE OR DELETE ON "tms"."route_stop" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
