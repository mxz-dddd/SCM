CREATE TYPE "wms"."PackTaskStatus" AS ENUM ('OPEN','PACKING','EXCEPTION','PACKED','CANCELLED');
CREATE TYPE "wms"."PackageUnitStatus" AS ENUM ('OPEN','SEALED','LABELLED','STAGED','LOADED','SHIPPED','CANCELLED');
CREATE TYPE "wms"."WeightExceptionStatus" AS ENUM ('OPEN','RESOLVED');
CREATE TYPE "wms"."ShippingLabelStatus" AS ENUM ('ACTIVE','VOID');
CREATE TYPE "wms"."StagingTaskStatus" AS ENUM ('OPEN','STAGED','RETURNED','CANCELLED');
CREATE TYPE "wms"."LoadTaskStatus" AS ENUM ('OPEN','LOADING','LOADED','SHIPPED','CANCELLED');
CREATE TYPE "wms"."CancellationPlanStatus" AS ENUM ('PLANNED','COMPLETED','REJECTED');
ALTER TYPE "wms"."OutboundOrderStatus" ADD VALUE 'PACKED';
ALTER TYPE "wms"."OutboundOrderStatus" ADD VALUE 'STAGED';
ALTER TYPE "wms"."OutboundOrderStatus" ADD VALUE 'LOADED';
ALTER TYPE "wms"."OutboundOrderStatus" ADD VALUE 'SHIPPED';

CREATE TABLE "wms"."pack_task" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,
  "status" "wms"."PackTaskStatus" NOT NULL DEFAULT 'OPEN',"task_no" VARCHAR(100) NOT NULL,"outbound_order_id" UUID NOT NULL,"recommendation_snapshot" JSONB NOT NULL,"rule_snapshot" JSONB NOT NULL,"started_at" TIMESTAMPTZ(3),"completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "pack_task_values_valid" CHECK ("version">0 AND jsonb_typeof("recommendation_snapshot")='object' AND jsonb_typeof("rule_snapshot")='object' AND ("status"<>'PACKED' OR "completed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "pack_task_order_key" ON "wms"."pack_task"("tenant_id","outbound_order_id");
CREATE UNIQUE INDEX "pack_task_tenant_no_key" ON "wms"."pack_task"("tenant_id","task_no");
CREATE INDEX "pack_task_workbench_idx" ON "wms"."pack_task"("tenant_id","status","created_at");

CREATE TABLE "wms"."package_unit" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,
  "status" "wms"."PackageUnitStatus" NOT NULL DEFAULT 'OPEN',"package_no" VARCHAR(100) NOT NULL,"pack_task_id" UUID NOT NULL,"outbound_order_id" UUID NOT NULL,"parent_package_id" UUID,"box_type_code" VARCHAR(100) NOT NULL,"material_snapshot" JSONB NOT NULL,"service_snapshot" JSONB NOT NULL,
  "theoretical_weight" DECIMAL(24,6) NOT NULL,"theoretical_volume" DECIMAL(24,6) NOT NULL,"actual_weight" DECIMAL(24,6),"actual_volume" DECIMAL(24,6),"temperature_zone" VARCHAR(50),"route_code" VARCHAR(100),"sealed_at" TIMESTAMPTZ(3),
  CONSTRAINT "package_unit_values_valid" CHECK ("version">0 AND "theoretical_weight">=0 AND "theoretical_volume">=0 AND ("actual_weight" IS NULL OR "actual_weight">0) AND ("actual_volume" IS NULL OR "actual_volume">0) AND jsonb_typeof("material_snapshot")='object' AND jsonb_typeof("service_snapshot")='object' AND ("status" IN ('OPEN','CANCELLED') OR "sealed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "package_unit_tenant_no_key" ON "wms"."package_unit"("tenant_id","package_no");
CREATE INDEX "package_unit_order_idx" ON "wms"."package_unit"("tenant_id","outbound_order_id","status","created_at");

CREATE TABLE "wms"."package_item" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "package_id" UUID NOT NULL,"pick_task_line_id" UUID NOT NULL,"allocation_id" UUID NOT NULL,"product_id" UUID NOT NULL,"inventory_lot_id" UUID,"serial_number_id" UUID,"quantity_base" DECIMAL(24,12) NOT NULL,
  CONSTRAINT "package_item_values_valid" CHECK ("version">0 AND "quantity_base">0)
);
CREATE INDEX "package_item_package_idx" ON "wms"."package_item"("tenant_id","package_id","created_at");
CREATE INDEX "package_item_allocation_idx" ON "wms"."package_item"("tenant_id","allocation_id");

CREATE TABLE "wms"."package_measurement" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "package_id" UUID NOT NULL,"device_id" VARCHAR(200) NOT NULL,"device_sequence" BIGINT NOT NULL,"source" VARCHAR(100) NOT NULL,"weight" DECIMAL(24,6) NOT NULL,"length" DECIMAL(24,6) NOT NULL,"width" DECIMAL(24,6) NOT NULL,"height" DECIMAL(24,6) NOT NULL,"volume" DECIMAL(24,6) NOT NULL,"measured_at" TIMESTAMPTZ(3) NOT NULL,"raw_snapshot" JSONB NOT NULL,
  CONSTRAINT "package_measurement_values_valid" CHECK ("version">0 AND "device_sequence">0 AND "weight">0 AND "length">0 AND "width">0 AND "height">0 AND "volume">0 AND jsonb_typeof("raw_snapshot")='object')
);
CREATE UNIQUE INDEX "package_measurement_device_seq_key" ON "wms"."package_measurement"("tenant_id","device_id","device_sequence");
CREATE INDEX "package_measurement_package_idx" ON "wms"."package_measurement"("tenant_id","package_id","created_at");

CREATE TABLE "wms"."weight_exception" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WeightExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "package_id" UUID NOT NULL,"measurement_id" UUID NOT NULL,"exception_no" VARCHAR(100) NOT NULL,"variance_snapshot" JSONB NOT NULL,"resolution_snapshot" JSONB,"resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "weight_exception_values_valid" CHECK ("version">0 AND jsonb_typeof("variance_snapshot")='object' AND ("status"<>'RESOLVED' OR ("resolution_snapshot" IS NOT NULL AND "resolved_at" IS NOT NULL)))
);
CREATE UNIQUE INDEX "weight_exception_tenant_no_key" ON "wms"."weight_exception"("tenant_id","exception_no");
CREATE INDEX "weight_exception_package_idx" ON "wms"."weight_exception"("tenant_id","package_id","status","created_at");

CREATE TABLE "wms"."shipping_label" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."ShippingLabelStatus" NOT NULL,
  "package_id" UUID NOT NULL,"label_type" VARCHAR(100) NOT NULL,"label_version" INTEGER NOT NULL,"template_version" VARCHAR(100) NOT NULL,"content_ref" VARCHAR(500) NOT NULL,"action" VARCHAR(50) NOT NULL,"supersedes_id" UUID,"reason" VARCHAR(500),
  CONSTRAINT "shipping_label_values_valid" CHECK ("version">0 AND "label_version">0 AND "action" IN ('ISSUE','REPRINT','VOID') AND (("status"='VOID' AND "reason" IS NOT NULL) OR "status"='ACTIVE'))
);
CREATE UNIQUE INDEX "shipping_label_package_version_key" ON "wms"."shipping_label"("tenant_id","package_id","label_type","label_version");
CREATE INDEX "shipping_label_package_idx" ON "wms"."shipping_label"("tenant_id","package_id","status","created_at");

CREATE TABLE "wms"."staging_task" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."StagingTaskStatus" NOT NULL DEFAULT 'OPEN',
  "task_no" VARCHAR(100) NOT NULL,"package_id" UUID NOT NULL,"outbound_order_id" UUID NOT NULL,"staging_location_id" UUID NOT NULL,"route_code" VARCHAR(100) NOT NULL,"shipment_ref" VARCHAR(200) NOT NULL,"trip_ref" VARCHAR(200) NOT NULL,"load_sequence" INTEGER NOT NULL,"capacity_snapshot" JSONB NOT NULL,"staged_at" TIMESTAMPTZ(3),"returned_at" TIMESTAMPTZ(3),
  CONSTRAINT "staging_task_values_valid" CHECK ("version">0 AND "load_sequence">0 AND jsonb_typeof("capacity_snapshot")='object' AND ("status"<>'STAGED' OR "staged_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "staging_task_package_key" ON "wms"."staging_task"("tenant_id","package_id");
CREATE UNIQUE INDEX "staging_task_tenant_no_key" ON "wms"."staging_task"("tenant_id","task_no");
CREATE INDEX "staging_task_route_idx" ON "wms"."staging_task"("tenant_id","route_code","trip_ref","status");

CREATE TABLE "wms"."load_task" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."LoadTaskStatus" NOT NULL DEFAULT 'OPEN',
  "task_no" VARCHAR(100) NOT NULL,"outbound_order_id" UUID NOT NULL,"shipment_ref" VARCHAR(200) NOT NULL,"dock_ref" VARCHAR(200) NOT NULL,"vehicle_ref" VARCHAR(200) NOT NULL,"seal_no" VARCHAR(200) NOT NULL,"temperature_zone" VARCHAR(50),"expected_snapshot" JSONB NOT NULL,"loaded_at" TIMESTAMPTZ(3),"shipped_at" TIMESTAMPTZ(3),
  CONSTRAINT "load_task_values_valid" CHECK ("version">0 AND jsonb_typeof("expected_snapshot")='object' AND ("status" NOT IN ('LOADED','SHIPPED') OR "loaded_at" IS NOT NULL) AND ("status"<>'SHIPPED' OR "shipped_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "load_task_order_key" ON "wms"."load_task"("tenant_id","outbound_order_id");
CREATE UNIQUE INDEX "load_task_tenant_no_key" ON "wms"."load_task"("tenant_id","task_no");
CREATE INDEX "load_task_shipment_idx" ON "wms"."load_task"("tenant_id","shipment_ref","status","created_at");

CREATE TABLE "wms"."load_confirmation" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "load_task_id" UUID NOT NULL,"package_id" UUID NOT NULL,"device_id" VARCHAR(200) NOT NULL,"device_sequence" BIGINT NOT NULL,"scan_snapshot" JSONB NOT NULL,"confirmed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "load_confirmation_values_valid" CHECK ("version">0 AND "device_sequence">0 AND jsonb_typeof("scan_snapshot")='object')
);
CREATE UNIQUE INDEX "load_confirmation_package_key" ON "wms"."load_confirmation"("tenant_id","load_task_id","package_id");
CREATE UNIQUE INDEX "load_confirmation_device_seq_key" ON "wms"."load_confirmation"("tenant_id","device_id","device_sequence");

CREATE TABLE "wms"."outbound_dispatch" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "outbound_order_id" UUID NOT NULL,"load_task_id" UUID NOT NULL,"shipment_ref" VARCHAR(200) NOT NULL,"actual_at" TIMESTAMPTZ(3) NOT NULL,"package_snapshot" JSONB NOT NULL,"inventory_snapshot" JSONB NOT NULL,
  CONSTRAINT "outbound_dispatch_values_valid" CHECK ("version">0 AND jsonb_typeof("package_snapshot")='object' AND jsonb_typeof("inventory_snapshot")='object')
);
CREATE UNIQUE INDEX "outbound_dispatch_order_key" ON "wms"."outbound_dispatch"("tenant_id","outbound_order_id");

CREATE TABLE "wms"."cancellation_plan" (
  "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."CancellationPlanStatus" NOT NULL,
  "plan_no" VARCHAR(100) NOT NULL,"outbound_order_id" UUID NOT NULL,"from_status" "wms"."OutboundOrderStatus" NOT NULL,"reason_code" VARCHAR(100) NOT NULL,"reason" VARCHAR(500) NOT NULL,"compensation_steps" JSONB NOT NULL,"completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "cancellation_plan_values_valid" CHECK ("version">0 AND length(btrim("reason_code"))>0 AND length(btrim("reason"))>0 AND jsonb_typeof("compensation_steps")='object' AND ("status"<>'COMPLETED' OR "completed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "cancellation_plan_tenant_no_key" ON "wms"."cancellation_plan"("tenant_id","plan_no");
CREATE INDEX "cancellation_plan_order_idx" ON "wms"."cancellation_plan"("tenant_id","outbound_order_id","created_at");

CREATE TRIGGER "package_item_immutable" BEFORE UPDATE OR DELETE ON "wms"."package_item" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "package_measurement_immutable" BEFORE UPDATE OR DELETE ON "wms"."package_measurement" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "shipping_label_immutable" BEFORE UPDATE OR DELETE ON "wms"."shipping_label" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "load_confirmation_immutable" BEFORE UPDATE OR DELETE ON "wms"."load_confirmation" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "outbound_dispatch_immutable" BEFORE UPDATE OR DELETE ON "wms"."outbound_dispatch" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
