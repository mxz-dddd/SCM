ALTER TYPE "wms"."InventoryLotStatus" ADD VALUE 'QUALITY_HOLD';
ALTER TYPE "wms"."InventoryLotStatus" ADD VALUE 'RELEASED';
ALTER TYPE "wms"."InventoryLotStatus" ADD VALUE 'RETURNED';
ALTER TYPE "wms"."InventoryLotStatus" ADD VALUE 'REWORK';
ALTER TYPE "wms"."InventoryLotStatus" ADD VALUE 'DOWNGRADED';
ALTER TYPE "wms"."InventoryLotStatus" ADD VALUE 'SCRAPPED';
ALTER TYPE "wms"."InventoryLotStatus" ADD VALUE 'REJECTED';
ALTER TYPE "wms"."SerialNumberStatus" ADD VALUE 'QUALITY_HOLD';
ALTER TYPE "wms"."SerialNumberStatus" ADD VALUE 'RELEASED';
ALTER TYPE "wms"."SerialNumberStatus" ADD VALUE 'RETURNED';
ALTER TYPE "wms"."SerialNumberStatus" ADD VALUE 'REWORK';
ALTER TYPE "wms"."SerialNumberStatus" ADD VALUE 'DOWNGRADED';
ALTER TYPE "wms"."SerialNumberStatus" ADD VALUE 'SCRAPPED';
ALTER TYPE "wms"."SerialNumberStatus" ADD VALUE 'REJECTED';
DROP TRIGGER "inventory_lot_immutable" ON "wms"."inventory_lot";
DROP TRIGGER "serial_number_immutable" ON "wms"."serial_number";

CREATE TYPE "wms"."QualityInspectionStatus" AS ENUM ('PENDING','INSPECTING','ACCEPTED','REJECTED','HOLD');
CREATE TYPE "wms"."InspectionPlanMode" AS ENUM ('EXEMPT','FULL','SAMPLE');
CREATE TYPE "wms"."QualityDispositionType" AS ENUM ('RETURN_SUPPLIER','REWORK','DOWNGRADE','SCRAP','CONCESSION');
CREATE TYPE "wms"."PutawayDecisionStatus" AS ENUM ('PROPOSED','CONFIRMED','OVERRIDDEN');
CREATE TYPE "wms"."PutawayTaskStatus" AS ENUM ('OPEN','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE "wms"."CrossDockStatus" AS ENUM ('PROPOSED','RESERVED','COMPLETED','CANCELLED');

CREATE TABLE "wms"."quality_inspection" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."QualityInspectionStatus" NOT NULL DEFAULT 'PENDING',"inspection_no" VARCHAR(100) NOT NULL,"inbound_order_id" UUID NOT NULL,"receipt_line_id" UUID NOT NULL,"inventory_lot_id" UUID,"product_id" UUID NOT NULL,"supplier_id" UUID,"plan_mode" "wms"."InspectionPlanMode" NOT NULL,"plan_snapshot" JSONB NOT NULL,"risk_score" DECIMAL(10,4) NOT NULL DEFAULT 0,"sample_size" INTEGER NOT NULL,"attachment_refs" JSONB NOT NULL DEFAULT '[]',"started_at" TIMESTAMPTZ(3),"completed_at" TIMESTAMPTZ(3),"result_summary" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "quality_inspection_values_valid" CHECK ("version">0 AND "risk_score" BETWEEN 0 AND 100 AND "sample_size">=0 AND jsonb_typeof("plan_snapshot")='object' AND jsonb_typeof("attachment_refs")='array' AND jsonb_typeof("result_summary")='object')
);
CREATE UNIQUE INDEX "quality_inspection_tenant_no_key" ON "wms"."quality_inspection"("tenant_id","inspection_no");
CREATE INDEX "quality_inspection_workbench_idx" ON "wms"."quality_inspection"("tenant_id","inbound_order_id","status","created_at");
CREATE INDEX "quality_inspection_lot_idx" ON "wms"."quality_inspection"("tenant_id","inventory_lot_id","status");

CREATE TABLE "wms"."quality_inspection_result" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"inspection_id" UUID NOT NULL,"item_code" VARCHAR(100) NOT NULL,"sample_ref" VARCHAR(100) NOT NULL,"expected_snapshot" JSONB NOT NULL,"measured_snapshot" JSONB NOT NULL,"passed" BOOLEAN NOT NULL,"attachment_refs" JSONB NOT NULL DEFAULT '[]',
 CONSTRAINT "quality_result_values_valid" CHECK ("version">0 AND jsonb_typeof("expected_snapshot")='object' AND jsonb_typeof("measured_snapshot")='object' AND jsonb_typeof("attachment_refs")='array')
);
CREATE UNIQUE INDEX "quality_result_item_sample_key" ON "wms"."quality_inspection_result"("tenant_id","inspection_id","item_code","sample_ref");
CREATE INDEX "quality_result_inspection_idx" ON "wms"."quality_inspection_result"("tenant_id","inspection_id","passed");

CREATE TABLE "wms"."quality_disposition" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"disposition_no" VARCHAR(100) NOT NULL,"inbound_order_id" UUID NOT NULL,"inspection_id" UUID NOT NULL,"inventory_lot_id" UUID,"type" "wms"."QualityDispositionType" NOT NULL,"reason" VARCHAR(500) NOT NULL,"approval_reference" VARCHAR(200),"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"charge_fact_snapshot" JSONB NOT NULL DEFAULT '{}',"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "quality_disposition_values_valid" CHECK ("version">0 AND length(btrim("reason"))>0 AND "quantity_original">0 AND "quantity_base">0 AND jsonb_typeof("charge_fact_snapshot")='object' AND ("type"<>'CONCESSION' OR "approval_reference" IS NOT NULL))
);
CREATE UNIQUE INDEX "quality_disposition_tenant_no_key" ON "wms"."quality_disposition"("tenant_id","disposition_no");
CREATE INDEX "quality_disposition_inbound_idx" ON "wms"."quality_disposition"("tenant_id","inbound_order_id","inspection_id");

CREATE TABLE "wms"."putaway_decision" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."PutawayDecisionStatus" NOT NULL DEFAULT 'PROPOSED',"inbound_order_id" UUID NOT NULL,"handling_unit_id" UUID NOT NULL,"product_id" UUID NOT NULL,"inventory_lot_id" UUID,"rule_set_code" VARCHAR(100) NOT NULL,"evaluation_trace_id" UUID NOT NULL,"candidate_snapshot" JSONB NOT NULL,"exclusion_snapshot" JSONB NOT NULL DEFAULT '[]',"selected_location_id" UUID NOT NULL,"selected_location_snapshot" JSONB NOT NULL,"override_reason" VARCHAR(500),
 CONSTRAINT "putaway_decision_values_valid" CHECK ("version">0 AND jsonb_typeof("candidate_snapshot")='array' AND jsonb_typeof("exclusion_snapshot")='array' AND jsonb_typeof("selected_location_snapshot")='object' AND ("status"<>'OVERRIDDEN' OR "override_reason" IS NOT NULL))
);
CREATE INDEX "putaway_decision_workbench_idx" ON "wms"."putaway_decision"("tenant_id","inbound_order_id","status","created_at");
CREATE INDEX "putaway_decision_unit_idx" ON "wms"."putaway_decision"("tenant_id","handling_unit_id","status");

CREATE TABLE "wms"."putaway_task" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."PutawayTaskStatus" NOT NULL DEFAULT 'OPEN',"task_no" VARCHAR(100) NOT NULL,"inbound_order_id" UUID NOT NULL,"putaway_decision_id" UUID NOT NULL,"handling_unit_id" UUID NOT NULL,"source_location_id" UUID,"target_location_id" UUID NOT NULL,"assigned_to" UUID,"path_sequence" INTEGER NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"started_at" TIMESTAMPTZ(3),"completed_at" TIMESTAMPTZ(3),
 CONSTRAINT "putaway_task_values_valid" CHECK ("version">0 AND "path_sequence">=0 AND "quantity_original">0 AND "quantity_base">0)
);
CREATE UNIQUE INDEX "putaway_task_tenant_no_key" ON "wms"."putaway_task"("tenant_id","task_no");
CREATE INDEX "putaway_task_path_idx" ON "wms"."putaway_task"("tenant_id","inbound_order_id","status","path_sequence");
CREATE INDEX "putaway_task_assignee_idx" ON "wms"."putaway_task"("tenant_id","assigned_to","status");

CREATE TABLE "wms"."putaway_movement" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"putaway_task_id" UUID NOT NULL,"inbound_order_id" UUID NOT NULL,"handling_unit_id" UUID NOT NULL,"scanned_lpn" VARCHAR(200) NOT NULL,"source_location_id" UUID,"scanned_source_code" VARCHAR(100),"target_location_id" UUID NOT NULL,"scanned_target_code" VARCHAR(100) NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "putaway_movement_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0)
);
CREATE UNIQUE INDEX "putaway_movement_task_key" ON "wms"."putaway_movement"("tenant_id","putaway_task_id");
CREATE INDEX "putaway_movement_inbound_idx" ON "wms"."putaway_movement"("tenant_id","inbound_order_id","occurred_at");

CREATE TABLE "wms"."cross_dock_allocation" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."CrossDockStatus" NOT NULL DEFAULT 'PROPOSED',"inbound_order_id" UUID NOT NULL,"receipt_line_id" UUID NOT NULL,"inventory_lot_id" UUID,"product_id" UUID NOT NULL,"demand_ref" VARCHAR(200) NOT NULL,"demand_snapshot" JSONB NOT NULL,"staging_location_id" UUID NOT NULL,"staging_location_snapshot" JSONB NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"window_start" TIMESTAMPTZ(3) NOT NULL,"window_end" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "cross_dock_values_valid" CHECK ("version">0 AND length(btrim("demand_ref"))>0 AND "quantity_original">0 AND "quantity_base">0 AND "window_start"<"window_end" AND jsonb_typeof("demand_snapshot")='object' AND jsonb_typeof("staging_location_snapshot")='object')
);
CREATE UNIQUE INDEX "cross_dock_demand_receipt_key" ON "wms"."cross_dock_allocation"("tenant_id","demand_ref","receipt_line_id");
CREATE INDEX "cross_dock_workbench_idx" ON "wms"."cross_dock_allocation"("tenant_id","inbound_order_id","status","window_end");

CREATE TRIGGER "quality_result_immutable" BEFORE UPDATE OR DELETE ON "wms"."quality_inspection_result" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "quality_disposition_immutable" BEFORE UPDATE OR DELETE ON "wms"."quality_disposition" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "putaway_movement_immutable" BEFORE UPDATE OR DELETE ON "wms"."putaway_movement" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
