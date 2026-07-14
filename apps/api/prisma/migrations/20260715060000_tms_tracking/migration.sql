-- CreateEnum
CREATE TYPE "tms"."MilestonePlanStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "tms"."ShipmentMilestoneStatus" AS ENUM ('PLANNED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "tms"."DriverTaskStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tms"."TrackingEventStatus" AS ENUM ('ACCEPTED', 'CANDIDATE', 'CONFLICT');

-- CreateEnum
CREATE TYPE "tms"."DriverOfflineCommandStatus" AS ENUM ('PROCESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "tms"."PositionPointStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "tms"."GeofenceEventStatus" AS ENUM ('CANDIDATE', 'CONFIRMED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "tms"."EtaPredictionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "tms"."milestone_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."MilestonePlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "template_snapshot" JSONB NOT NULL,
    "time_zone" VARCHAR(100) NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."shipment_milestone" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."ShipmentMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "milestone_plan_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "planned_at" TIMESTAMPTZ(3) NOT NULL,
    "actual_at" TIMESTAMPTZ(3),
    "actual_source" VARCHAR(50),
    "tracking_event_id" UUID,
    "location_snapshot" JSONB NOT NULL,
    "requirement_snapshot" JSONB NOT NULL,

    CONSTRAINT "shipment_milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."driver_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."DriverTaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "task_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "vehicle_assignment_id" UUID NOT NULL,
    "milestone_plan_id" UUID NOT NULL,
    "driver_ref" UUID NOT NULL,
    "device_id" VARCHAR(200) NOT NULL,
    "device_snapshot" JSONB NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "last_offline_sequence" INTEGER NOT NULL DEFAULT 0,
    "current_milestone_sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "driver_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."tracking_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TrackingEventStatus" NOT NULL DEFAULT 'ACCEPTED',
    "event_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "driver_task_id" UUID,
    "milestone_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "location_snapshot" JSONB NOT NULL,
    "evidence_snapshot" JSONB NOT NULL,
    "device_id" VARCHAR(200),
    "device_sequence" INTEGER,
    "conflict_event_id" UUID,

    CONSTRAINT "tracking_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."driver_offline_command" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."DriverOfflineCommandStatus" NOT NULL DEFAULT 'PROCESSED',
    "driver_task_id" UUID NOT NULL,
    "device_id" VARCHAR(200) NOT NULL,
    "device_sequence" INTEGER NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "command_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejection_reason" VARCHAR(500),

    CONSTRAINT "driver_offline_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."position_point" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."PositionPointStatus" NOT NULL,
    "shipment_id" UUID NOT NULL,
    "vehicle_assignment_id" UUID NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "source_event_id" VARCHAR(200) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracy_meters" DECIMAL(12,3) NOT NULL,
    "speed_kph" DECIMAL(12,3),
    "heading_degrees" DECIMAL(8,3),
    "raw_snapshot" JSONB NOT NULL,
    "rejection_reason" VARCHAR(500),

    CONSTRAINT "position_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."track_segment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "shipment_id" UUID NOT NULL,
    "from_position_point_id" UUID NOT NULL,
    "to_position_point_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,
    "distance_meters" DECIMAL(18,3) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "calculation_snapshot" JSONB NOT NULL,

    CONSTRAINT "track_segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."geofence_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."GeofenceEventStatus" NOT NULL DEFAULT 'CANDIDATE',
    "shipment_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "position_point_id" UUID NOT NULL,
    "event_type" VARCHAR(20) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "geofence_snapshot" JSONB NOT NULL,
    "driver_event_id" UUID,
    "conflict_reason" VARCHAR(500),

    CONSTRAINT "geofence_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."eta_prediction" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."EtaPredictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "shipment_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "predicted_at" TIMESTAMPTZ(3) NOT NULL,
    "confidence" DECIMAL(8,6) NOT NULL,
    "change_minutes" DECIMAL(12,3) NOT NULL,
    "significant_change" BOOLEAN NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "algorithm_snapshot" JSONB NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eta_prediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestone_plan_tenant_shipment_idx" ON "tms"."milestone_plan"("tenant_id", "shipment_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_plan_tenant_no_key" ON "tms"."milestone_plan"("tenant_id", "plan_no");

-- CreateIndex
CREATE INDEX "shipment_milestone_tenant_shipment_idx" ON "tms"."shipment_milestone"("tenant_id", "shipment_id", "status", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_milestone_tenant_plan_sequence_key" ON "tms"."shipment_milestone"("tenant_id", "milestone_plan_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_milestone_tenant_plan_code_key" ON "tms"."shipment_milestone"("tenant_id", "milestone_plan_id", "code");

-- CreateIndex
CREATE INDEX "driver_task_tenant_driver_idx" ON "tms"."driver_task"("tenant_id", "driver_ref", "status", "created_at");

-- CreateIndex
CREATE INDEX "driver_task_tenant_device_idx" ON "tms"."driver_task"("tenant_id", "device_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "driver_task_tenant_no_key" ON "tms"."driver_task"("tenant_id", "task_no");

-- CreateIndex
CREATE UNIQUE INDEX "driver_task_tenant_assignment_key" ON "tms"."driver_task"("tenant_id", "vehicle_assignment_id");

-- CreateIndex
CREATE INDEX "tracking_event_tenant_shipment_time_idx" ON "tms"."tracking_event"("tenant_id", "shipment_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "tracking_event_tenant_task_sequence_idx" ON "tms"."tracking_event"("tenant_id", "driver_task_id", "device_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_event_tenant_no_key" ON "tms"."tracking_event"("tenant_id", "event_no");

-- CreateIndex
CREATE INDEX "offline_command_tenant_task_sequence_idx" ON "tms"."driver_offline_command"("tenant_id", "driver_task_id", "device_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "offline_command_tenant_device_sequence_key" ON "tms"."driver_offline_command"("tenant_id", "device_id", "device_sequence");

-- CreateIndex
CREATE INDEX "position_point_tenant_shipment_idx" ON "tms"."position_point"("tenant_id", "shipment_id", "status", "recorded_at");

-- CreateIndex
CREATE INDEX "position_point_tenant_assignment_idx" ON "tms"."position_point"("tenant_id", "vehicle_assignment_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "position_point_tenant_source_event_key" ON "tms"."position_point"("tenant_id", "source", "source_event_id");

-- CreateIndex
CREATE INDEX "track_segment_tenant_shipment_idx" ON "tms"."track_segment"("tenant_id", "shipment_id", "started_at", "ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "track_segment_tenant_points_key" ON "tms"."track_segment"("tenant_id", "from_position_point_id", "to_position_point_id");

-- CreateIndex
CREATE INDEX "geofence_event_tenant_shipment_idx" ON "tms"."geofence_event"("tenant_id", "shipment_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "geofence_event_tenant_milestone_idx" ON "tms"."geofence_event"("tenant_id", "milestone_id", "status", "occurred_at");

-- CreateIndex
CREATE INDEX "eta_prediction_tenant_shipment_idx" ON "tms"."eta_prediction"("tenant_id", "shipment_id", "status", "calculated_at");

-- CreateIndex
CREATE INDEX "eta_prediction_tenant_milestone_idx" ON "tms"."eta_prediction"("tenant_id", "milestone_id", "calculated_at");

ALTER TABLE "tms"."milestone_plan" ADD CONSTRAINT "milestone_plan_values_valid" CHECK ("version">0 AND jsonb_typeof("template_snapshot")='object' AND length(btrim("time_zone"))>0);
ALTER TABLE "tms"."shipment_milestone" ADD CONSTRAINT "shipment_milestone_values_valid" CHECK ("version">0 AND "sequence">0 AND jsonb_typeof("location_snapshot")='object' AND jsonb_typeof("requirement_snapshot")='object' AND ("status"<>'COMPLETED' OR ("actual_at" IS NOT NULL AND "tracking_event_id" IS NOT NULL)));
ALTER TABLE "tms"."driver_task" ADD CONSTRAINT "driver_task_values_valid" CHECK ("version">0 AND "last_offline_sequence">=0 AND "current_milestone_sequence">=0 AND jsonb_typeof("device_snapshot")='object' AND ("status"<>'ACCEPTED' OR "accepted_at" IS NOT NULL));
ALTER TABLE "tms"."tracking_event" ADD CONSTRAINT "tracking_event_values_valid" CHECK ("version">0 AND jsonb_typeof("location_snapshot")='object' AND jsonb_typeof("evidence_snapshot")='object' AND ("device_sequence" IS NULL OR "device_sequence">0));
ALTER TABLE "tms"."driver_offline_command" ADD CONSTRAINT "driver_offline_command_values_valid" CHECK ("version">0 AND "device_sequence">0 AND length("content_hash")=64 AND jsonb_typeof("payload")='object' AND jsonb_typeof("result")='object');
ALTER TABLE "tms"."position_point" ADD CONSTRAINT "position_point_values_valid" CHECK ("version">0 AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "accuracy_meters">=0 AND jsonb_typeof("raw_snapshot")='object' AND (("status"='ACCEPTED' AND "rejection_reason" IS NULL) OR ("status"='REJECTED' AND "rejection_reason" IS NOT NULL)));
ALTER TABLE "tms"."track_segment" ADD CONSTRAINT "track_segment_values_valid" CHECK ("version">0 AND "ended_at">"started_at" AND "distance_meters">=0 AND "duration_seconds">0 AND jsonb_typeof("calculation_snapshot")='object');
ALTER TABLE "tms"."geofence_event" ADD CONSTRAINT "geofence_event_values_valid" CHECK ("version">0 AND "event_type" IN ('ENTER','EXIT') AND jsonb_typeof("geofence_snapshot")='object' AND ("status"<>'CONFLICT' OR "driver_event_id" IS NOT NULL));
ALTER TABLE "tms"."eta_prediction" ADD CONSTRAINT "eta_prediction_values_valid" CHECK ("version">0 AND "confidence" BETWEEN 0 AND 1 AND jsonb_typeof("input_snapshot")='object' AND jsonb_typeof("algorithm_snapshot")='object');

CREATE TRIGGER "tracking_event_immutable" BEFORE UPDATE OR DELETE ON "tms"."tracking_event" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "driver_offline_command_immutable" BEFORE UPDATE OR DELETE ON "tms"."driver_offline_command" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "position_point_immutable" BEFORE UPDATE OR DELETE ON "tms"."position_point" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "track_segment_immutable" BEFORE UPDATE OR DELETE ON "tms"."track_segment" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "geofence_event_immutable" BEFORE UPDATE OR DELETE ON "tms"."geofence_event" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "eta_prediction_immutable" BEFORE UPDATE OR DELETE ON "tms"."eta_prediction" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
