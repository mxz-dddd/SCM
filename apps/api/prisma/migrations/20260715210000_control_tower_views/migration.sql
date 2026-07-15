-- CreateEnum
CREATE TYPE "control"."ControlProjectionRecordStatus" AS ENUM ('ACTIVE');

-- CreateTable
CREATE TABLE "control"."projection_cursor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "last_aggregate_version" INTEGER NOT NULL,
    "last_event_id" UUID NOT NULL,
    "last_event_type" VARCHAR(200) NOT NULL,
    "projected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projection_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."timeline_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "event_id" UUID NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "event_type" VARCHAR(200) NOT NULL,
    "source_domain" VARCHAR(50) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "trace_id" VARCHAR(200) NOT NULL,
    "causation_id" UUID,
    "replay_status" VARCHAR(30) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "attachment_snapshot" JSONB NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "timeline_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."order_control_view" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "business_ref" VARCHAR(200) NOT NULL,
    "order_ref" VARCHAR(200) NOT NULL,
    "current_stage" VARCHAR(50) NOT NULL,
    "current_status" VARCHAR(100) NOT NULL,
    "completion_rate" DECIMAL(8,4) NOT NULL,
    "promised_at" TIMESTAMPTZ(3),
    "stage_snapshot" JSONB NOT NULL,
    "blocking_snapshot" JSONB NOT NULL,
    "source_versions" JSONB NOT NULL,
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_control_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."inventory_network_view" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "warehouse_ref" VARCHAR(200) NOT NULL,
    "owner_ref" VARCHAR(200) NOT NULL,
    "product_ref" VARCHAR(200) NOT NULL,
    "region_ref" VARCHAR(200) NOT NULL,
    "available_quantity" DECIMAL(24,6) NOT NULL,
    "hold_quantity" DECIMAL(24,6) NOT NULL,
    "in_transit_quantity" DECIMAL(24,6) NOT NULL,
    "base_uom" VARCHAR(20) NOT NULL,
    "aging_days" INTEGER NOT NULL,
    "turnover_days" DECIMAL(12,4) NOT NULL,
    "stockout_risk" DECIMAL(8,4) NOT NULL,
    "source_version" INTEGER NOT NULL,
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_network_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."transport_network_view" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "shipment_ref" VARCHAR(200) NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "vehicle_ref" VARCHAR(200),
    "route_ref" VARCHAR(200) NOT NULL,
    "current_node_ref" VARCHAR(200),
    "node_snapshot" JSONB NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "eta_at" TIMESTAMPTZ(3),
    "delayed" BOOLEAN NOT NULL DEFAULT false,
    "temperature_alert" BOOLEAN NOT NULL DEFAULT false,
    "heat_weight" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "source_version" INTEGER NOT NULL,
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_network_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."yard_control_view" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "warehouse_ref" VARCHAR(200) NOT NULL,
    "dock_ref" VARCHAR(200) NOT NULL,
    "future_capacity" DECIMAL(24,6) NOT NULL,
    "arrived_today" INTEGER NOT NULL,
    "queue_count" INTEGER NOT NULL,
    "occupied" BOOLEAN NOT NULL,
    "operation_minutes" INTEGER NOT NULL,
    "late_count" INTEGER NOT NULL,
    "no_show_count" INTEGER NOT NULL,
    "wms_reference_snapshot" JSONB NOT NULL,
    "tms_reference_snapshot" JSONB NOT NULL,
    "source_version" INTEGER NOT NULL,
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yard_control_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "control_projection_cursor_business_idx" ON "control"."projection_cursor"("tenant_id", "business_ref", "projected_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_projection_cursor_aggregate_key" ON "control"."projection_cursor"("tenant_id", "aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "control_timeline_business_idx" ON "control"."timeline_event"("tenant_id", "business_ref", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "control_timeline_trace_idx" ON "control"."timeline_event"("tenant_id", "trace_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_timeline_event_id_key" ON "control"."timeline_event"("tenant_id", "event_id");

-- CreateIndex
CREATE INDEX "order_control_view_stage_idx" ON "control"."order_control_view"("tenant_id", "current_stage", "current_status", "refreshed_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_control_view_business_key" ON "control"."order_control_view"("tenant_id", "business_ref");

-- CreateIndex
CREATE INDEX "inventory_network_view_risk_idx" ON "control"."inventory_network_view"("tenant_id", "region_ref", "warehouse_ref", "stockout_risk");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_network_view_scope_key" ON "control"."inventory_network_view"("tenant_id", "warehouse_ref", "owner_ref", "product_ref", "region_ref");

-- CreateIndex
CREATE INDEX "transport_network_view_route_idx" ON "control"."transport_network_view"("tenant_id", "route_ref", "delayed", "temperature_alert");

-- CreateIndex
CREATE UNIQUE INDEX "transport_network_view_shipment_key" ON "control"."transport_network_view"("tenant_id", "shipment_ref");

-- CreateIndex
CREATE INDEX "yard_control_view_warehouse_idx" ON "control"."yard_control_view"("tenant_id", "warehouse_ref", "occupied", "queue_count");

-- CreateIndex
CREATE UNIQUE INDEX "yard_control_view_dock_key" ON "control"."yard_control_view"("tenant_id", "warehouse_ref", "dock_ref");

ALTER TABLE "control"."order_control_view" ADD CONSTRAINT "order_control_completion_check" CHECK ("completion_rate" >= 0 AND "completion_rate" <= 1);
ALTER TABLE "control"."inventory_network_view" ADD CONSTRAINT "inventory_network_quantity_check" CHECK ("available_quantity" >= 0 AND "hold_quantity" >= 0 AND "in_transit_quantity" >= 0 AND "aging_days" >= 0 AND "turnover_days" >= 0 AND "stockout_risk" >= 0 AND "stockout_risk" <= 1);
ALTER TABLE "control"."transport_network_view" ADD CONSTRAINT "transport_network_heat_check" CHECK ("heat_weight" >= 0);
ALTER TABLE "control"."yard_control_view" ADD CONSTRAINT "yard_control_measure_check" CHECK ("future_capacity" >= 0 AND "arrived_today" >= 0 AND "queue_count" >= 0 AND "operation_minutes" >= 0 AND "late_count" >= 0 AND "no_show_count" >= 0);

CREATE OR REPLACE FUNCTION "control"."reject_control_timeline_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'control timeline events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "control"."reject_control_projection_delete"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'control projections cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "control_timeline_event_immutable" BEFORE UPDATE OR DELETE ON "control"."timeline_event" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_timeline_mutation"();
CREATE TRIGGER "control_projection_cursor_no_delete" BEFORE DELETE ON "control"."projection_cursor" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_projection_delete"();
CREATE TRIGGER "order_control_view_no_delete" BEFORE DELETE ON "control"."order_control_view" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_projection_delete"();
CREATE TRIGGER "inventory_network_view_no_delete" BEFORE DELETE ON "control"."inventory_network_view" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_projection_delete"();
CREATE TRIGGER "transport_network_view_no_delete" BEFORE DELETE ON "control"."transport_network_view" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_projection_delete"();
CREATE TRIGGER "yard_control_view_no_delete" BEFORE DELETE ON "control"."yard_control_view" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_projection_delete"();
