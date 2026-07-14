CREATE TYPE "wms"."OutboundOrderStatus" AS ENUM ('DRAFT','RELEASED','WAVED','ALLOCATED','CANCELLED');
CREATE TYPE "wms"."OutboundOrderType" AS ENUM ('SALES','TRANSFER','RETURN_VENDOR');
CREATE TYPE "wms"."WavePlanStatus" AS ENUM ('DRAFT','PLANNED','RELEASED','COMPLETED','CANCELLED');
CREATE TYPE "wms"."OutboundShortageStatus" AS ENUM ('OPEN','RESOLVED');
CREATE TYPE "wms"."ShortageResolutionType" AS ENUM ('WAIT_INBOUND','TRIGGER_REPLENISHMENT','SUBSTITUTE_LOT','CHANGE_WAREHOUSE','SPLIT_ORDER','SHORT_SHIP');

CREATE TABLE "wms"."outbound_order" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."OutboundOrderStatus" NOT NULL DEFAULT 'DRAFT',
 "outbound_no" VARCHAR(100) NOT NULL,"source_ref" VARCHAR(200) NOT NULL,"type" "wms"."OutboundOrderType" NOT NULL,"warehouse_id" UUID NOT NULL,"owner_id" UUID NOT NULL,"customer_id" UUID,"carrier_mode" VARCHAR(100),"route_code" VARCHAR(100),"temperature_zone" VARCHAR(50),"service_level" VARCHAR(100) NOT NULL,"destination_snapshot" JSONB NOT NULL,"cutoff_at" TIMESTAMPTZ(3) NOT NULL,"source_snapshot" JSONB NOT NULL,"released_at" TIMESTAMPTZ(3),
 CONSTRAINT "outbound_order_values_valid" CHECK ("version">0 AND length(btrim("source_ref"))>0 AND length(btrim("service_level"))>0 AND jsonb_typeof("destination_snapshot")='object' AND "destination_snapshot"<>'{}'::jsonb AND jsonb_typeof("source_snapshot")='object' AND ("status"<>'RELEASED' OR "released_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "outbound_order_tenant_no_key" ON "wms"."outbound_order"("tenant_id","outbound_no");
CREATE UNIQUE INDEX "outbound_order_source_key" ON "wms"."outbound_order"("tenant_id","source_ref");
CREATE INDEX "outbound_order_workbench_idx" ON "wms"."outbound_order"("tenant_id","warehouse_id","status","cutoff_at");

CREATE TABLE "wms"."outbound_line" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
 "outbound_order_id" UUID NOT NULL,"line_no" INTEGER NOT NULL,"product_id" UUID NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"allocated_original" DECIMAL(24,12) NOT NULL DEFAULT 0,"allocated_base" DECIMAL(24,12) NOT NULL DEFAULT 0,"shortage_original" DECIMAL(24,12) NOT NULL DEFAULT 0,"shortage_base" DECIMAL(24,12) NOT NULL DEFAULT 0,"allocation_constraints" JSONB NOT NULL DEFAULT '{}',"product_snapshot" JSONB NOT NULL,
 CONSTRAINT "outbound_line_values_valid" CHECK ("version">0 AND "line_no">0 AND "quantity_original">0 AND "quantity_base">0 AND "allocated_original">=0 AND "allocated_base">=0 AND "shortage_original">=0 AND "shortage_base">=0 AND "allocated_original"+"shortage_original"<="quantity_original" AND "allocated_base"+"shortage_base"<="quantity_base" AND jsonb_typeof("allocation_constraints")='object' AND jsonb_typeof("product_snapshot")='object')
);
CREATE UNIQUE INDEX "outbound_line_order_no_key" ON "wms"."outbound_line"("tenant_id","outbound_order_id","line_no");
CREATE INDEX "outbound_line_product_idx" ON "wms"."outbound_line"("tenant_id","product_id","status");

CREATE TABLE "wms"."wave_template" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
 "template_no" VARCHAR(100) NOT NULL,"name" VARCHAR(200) NOT NULL,"warehouse_id" UUID NOT NULL,"criteria" JSONB NOT NULL,"strategy" JSONB NOT NULL,"capacity_snapshot" JSONB NOT NULL,"workload_factors" JSONB NOT NULL,
 CONSTRAINT "wave_template_values_valid" CHECK ("version">0 AND length(btrim("name"))>0 AND jsonb_typeof("criteria")='object' AND jsonb_typeof("strategy")='object' AND jsonb_typeof("capacity_snapshot")='object' AND jsonb_typeof("workload_factors")='object')
);
CREATE UNIQUE INDEX "wave_template_tenant_no_key" ON "wms"."wave_template"("tenant_id","template_no");
CREATE INDEX "wave_template_lookup_idx" ON "wms"."wave_template"("tenant_id","warehouse_id","status");

CREATE TABLE "wms"."wave_plan" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WavePlanStatus" NOT NULL DEFAULT 'DRAFT',
 "wave_no" VARCHAR(100) NOT NULL,"template_id" UUID NOT NULL,"warehouse_id" UUID NOT NULL,"cutoff_at" TIMESTAMPTZ(3) NOT NULL,"capacity_snapshot" JSONB NOT NULL,"workload_snapshot" JSONB NOT NULL,"simulation_snapshot" JSONB NOT NULL,"planned_at" TIMESTAMPTZ(3),"released_at" TIMESTAMPTZ(3),"completed_at" TIMESTAMPTZ(3),
 CONSTRAINT "wave_plan_values_valid" CHECK ("version">0 AND jsonb_typeof("capacity_snapshot")='object' AND jsonb_typeof("workload_snapshot")='object' AND jsonb_typeof("simulation_snapshot")='object' AND ("status"<>'PLANNED' OR "planned_at" IS NOT NULL) AND ("status"<>'RELEASED' OR "released_at" IS NOT NULL) AND ("status"<>'COMPLETED' OR "completed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "wave_plan_tenant_no_key" ON "wms"."wave_plan"("tenant_id","wave_no");
CREATE INDEX "wave_plan_workbench_idx" ON "wms"."wave_plan"("tenant_id","warehouse_id","status","cutoff_at");

CREATE TABLE "wms"."wave_order" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"wave_id" UUID NOT NULL,"outbound_order_id" UUID NOT NULL,"selection_snapshot" JSONB NOT NULL,
 CONSTRAINT "wave_order_values_valid" CHECK ("version">0 AND jsonb_typeof("selection_snapshot")='object')
);
CREATE UNIQUE INDEX "wave_order_membership_key" ON "wms"."wave_order"("tenant_id","wave_id","outbound_order_id");
CREATE INDEX "wave_order_outbound_idx" ON "wms"."wave_order"("tenant_id","outbound_order_id","status");

CREATE TABLE "wms"."outbound_allocation" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"wave_id" UUID NOT NULL,"outbound_order_id" UUID NOT NULL,"outbound_line_id" UUID NOT NULL,"balance_id" UUID NOT NULL,"reservation_id" UUID NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"strategy_trace" JSONB NOT NULL,
 CONSTRAINT "outbound_allocation_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0 AND jsonb_typeof("strategy_trace")='object')
);
CREATE UNIQUE INDEX "outbound_allocation_dimension_key" ON "wms"."outbound_allocation"("tenant_id","wave_id","outbound_line_id","balance_id");
CREATE INDEX "outbound_allocation_line_idx" ON "wms"."outbound_allocation"("tenant_id","outbound_line_id","created_at");

CREATE TABLE "wms"."outbound_shortage_case" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."OutboundShortageStatus" NOT NULL DEFAULT 'OPEN',"case_no" VARCHAR(100) NOT NULL,"wave_id" UUID NOT NULL,"outbound_order_id" UUID NOT NULL,"outbound_line_id" UUID NOT NULL,"requested_base" DECIMAL(24,12) NOT NULL,"allocated_base" DECIMAL(24,12) NOT NULL,"shortage_base" DECIMAL(24,12) NOT NULL,"options_snapshot" JSONB NOT NULL,"resolution_type" "wms"."ShortageResolutionType","resolution_snapshot" JSONB,"resolved_at" TIMESTAMPTZ(3),
 CONSTRAINT "outbound_shortage_values_valid" CHECK ("version">0 AND "requested_base">0 AND "allocated_base">=0 AND "shortage_base">0 AND "allocated_base"+"shortage_base"="requested_base" AND jsonb_typeof("options_snapshot")='object' AND ("status"<>'RESOLVED' OR ("resolution_type" IS NOT NULL AND "resolution_snapshot" IS NOT NULL AND "resolved_at" IS NOT NULL)))
);
CREATE UNIQUE INDEX "outbound_shortage_wave_line_key" ON "wms"."outbound_shortage_case"("tenant_id","wave_id","outbound_line_id");
CREATE UNIQUE INDEX "outbound_shortage_tenant_no_key" ON "wms"."outbound_shortage_case"("tenant_id","case_no");
CREATE INDEX "outbound_shortage_workbench_idx" ON "wms"."outbound_shortage_case"("tenant_id","status","created_at");

CREATE TABLE "wms"."outbound_reallocation" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"shortage_case_id" UUID NOT NULL,"type" "wms"."ShortageResolutionType" NOT NULL,"resolution_snapshot" JSONB NOT NULL,"oms_event_ref" UUID NOT NULL,
 CONSTRAINT "outbound_reallocation_values_valid" CHECK ("version">0 AND jsonb_typeof("resolution_snapshot")='object')
);
CREATE INDEX "outbound_reallocation_case_idx" ON "wms"."outbound_reallocation"("tenant_id","shortage_case_id","created_at");

CREATE TRIGGER "wave_order_immutable" BEFORE UPDATE OR DELETE ON "wms"."wave_order" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "outbound_allocation_immutable" BEFORE UPDATE OR DELETE ON "wms"."outbound_allocation" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "outbound_reallocation_immutable" BEFORE UPDATE OR DELETE ON "wms"."outbound_reallocation" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
