CREATE TYPE "wms"."InboundStatus" AS ENUM ('DRAFT','EXPECTED','ARRIVED','RECEIVING','COMPLETED','CANCELLED');
CREATE TYPE "wms"."InboundSourceType" AS ENUM ('PURCHASE','RETURN','TRANSFER','PRODUCTION','ASN');
CREATE TYPE "wms"."InboundAsnMode" AS ENUM ('FULL','SIMPLIFIED','NONE');
CREATE TYPE "wms"."WmsRecordStatus" AS ENUM ('ACTIVE','INACTIVE');
CREATE TYPE "wms"."InboundPackageType" AS ENUM ('CARTON','PALLET');
CREATE TYPE "wms"."AppointmentLinkStatus" AS ENUM ('PENDING','CONFIRMED','RESCHEDULED','CANCELLED');
CREATE TYPE "wms"."ReceiptTaskStatus" AS ENUM ('OPEN','ASSIGNED','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED');
CREATE TYPE "wms"."LaborAssignmentMode" AS ENUM ('AUTO','CLAIM','TRANSFER');
CREATE TYPE "wms"."ScanResolutionStatus" AS ENUM ('RESOLVED','UNRESOLVED','MANUAL');
CREATE TYPE "wms"."BarcodeObjectType" AS ENUM ('ORDER','PRODUCT','PACKAGE','LOCATION');

CREATE TABLE "wms"."inbound_order" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,
 "status" "wms"."InboundStatus" NOT NULL DEFAULT 'DRAFT',"inbound_no" VARCHAR(100) NOT NULL,"source_type" "wms"."InboundSourceType" NOT NULL,"source_ref" VARCHAR(200) NOT NULL,"source_version" INTEGER NOT NULL,"warehouse_id" UUID NOT NULL,"owner_id" UUID NOT NULL,"supplier_id" UUID,"expected_arrival" TIMESTAMPTZ(3),"asn_mode" "wms"."InboundAsnMode" NOT NULL DEFAULT 'NONE',"appointment_snapshot" JSONB NOT NULL DEFAULT '{}',"arrival_snapshot" JSONB NOT NULL DEFAULT '{}',"completed_at" TIMESTAMPTZ(3),
 CONSTRAINT "inbound_order_values_valid" CHECK ("version">0 AND "source_version">0 AND jsonb_typeof("appointment_snapshot")='object' AND jsonb_typeof("arrival_snapshot")='object')
);
CREATE UNIQUE INDEX "inbound_order_tenant_no_key" ON "wms"."inbound_order"("tenant_id","inbound_no");
CREATE UNIQUE INDEX "inbound_order_source_key" ON "wms"."inbound_order"("tenant_id","source_type","source_ref","source_version","warehouse_id","owner_id");
CREATE INDEX "inbound_order_workbench_idx" ON "wms"."inbound_order"("tenant_id","warehouse_id","status","expected_arrival");

CREATE TABLE "wms"."inbound_line" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
 "inbound_order_id" UUID NOT NULL,"line_no" INTEGER NOT NULL,"source_line_ref" VARCHAR(200),"product_id" UUID NOT NULL,"product_snapshot" JSONB NOT NULL,"package_spec_id" UUID,"package_spec_version" INTEGER,"package_spec_snapshot" JSONB NOT NULL DEFAULT '{}',"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"batch_required" BOOLEAN NOT NULL DEFAULT false,"serial_required" BOOLEAN NOT NULL DEFAULT false,
 CONSTRAINT "inbound_line_values_valid" CHECK ("version">0 AND "line_no">0 AND "quantity_original">0 AND "quantity_base">0 AND jsonb_typeof("product_snapshot")='object' AND jsonb_typeof("package_spec_snapshot")='object')
);
CREATE UNIQUE INDEX "inbound_line_order_no_key" ON "wms"."inbound_line"("tenant_id","inbound_order_id","line_no");
CREATE INDEX "inbound_line_order_idx" ON "wms"."inbound_line"("tenant_id","inbound_order_id","status");

CREATE TABLE "wms"."inbound_package" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"inbound_order_id" UUID NOT NULL,"parent_package_id" UUID,"package_type" "wms"."InboundPackageType" NOT NULL,"lpn" VARCHAR(200) NOT NULL,"package_snapshot" JSONB NOT NULL DEFAULT '{}',CONSTRAINT "inbound_package_values_valid" CHECK ("version">0 AND "id"<>COALESCE("parent_package_id",'00000000-0000-0000-0000-000000000000') AND jsonb_typeof("package_snapshot")='object')
);
CREATE UNIQUE INDEX "inbound_package_lpn_key" ON "wms"."inbound_package"("tenant_id","lpn");
CREATE INDEX "inbound_package_tree_idx" ON "wms"."inbound_package"("tenant_id","inbound_order_id","parent_package_id");

CREATE TABLE "wms"."inbound_package_content" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"inbound_package_id" UUID NOT NULL,"inbound_line_id" UUID NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"batch_no" VARCHAR(100),CONSTRAINT "inbound_package_content_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0)
);
CREATE UNIQUE INDEX "inbound_package_content_key" ON "wms"."inbound_package_content"("tenant_id","inbound_package_id","inbound_line_id",COALESCE("batch_no",''));
CREATE INDEX "inbound_package_content_line_idx" ON "wms"."inbound_package_content"("tenant_id","inbound_line_id","status");

CREATE TABLE "wms"."appointment_order_link" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."AppointmentLinkStatus" NOT NULL DEFAULT 'PENDING',"inbound_order_id" UUID NOT NULL,"appointment_id" UUID NOT NULL,"source_version" INTEGER NOT NULL,"appointment_snapshot" JSONB NOT NULL,"expected_arrival" TIMESTAMPTZ(3),"vehicle_snapshot" JSONB NOT NULL DEFAULT '{}',"dock_id" UUID,CONSTRAINT "appointment_link_values_valid" CHECK ("version">0 AND "source_version">0 AND jsonb_typeof("appointment_snapshot")='object' AND jsonb_typeof("vehicle_snapshot")='object')
);
CREATE UNIQUE INDEX "appointment_order_link_key" ON "wms"."appointment_order_link"("tenant_id","inbound_order_id","appointment_id");
CREATE INDEX "appointment_link_appointment_idx" ON "wms"."appointment_order_link"("tenant_id","appointment_id","status");

CREATE TABLE "wms"."arrival_event" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"inbound_order_id" UUID NOT NULL,"appointment_id" UUID,"event_type" VARCHAR(50) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL,"vehicle_snapshot" JSONB NOT NULL DEFAULT '{}',"gate_id" UUID,"temporary_registration" BOOLEAN NOT NULL DEFAULT false,"approval_reference" VARCHAR(200),CONSTRAINT "arrival_event_values_valid" CHECK ("version">0 AND jsonb_typeof("vehicle_snapshot")='object' AND (NOT "temporary_registration" OR "approval_reference" IS NOT NULL))
);
CREATE INDEX "arrival_event_order_idx" ON "wms"."arrival_event"("tenant_id","inbound_order_id","occurred_at");

CREATE TABLE "wms"."receipt_task" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."ReceiptTaskStatus" NOT NULL DEFAULT 'OPEN',"task_no" VARCHAR(100) NOT NULL,"inbound_order_id" UUID NOT NULL,"dock_id" UUID,"team_id" UUID,"assigned_to" UUID,"workload" DECIMAL(24,6) NOT NULL,"workload_uom" VARCHAR(20) NOT NULL,"priority" INTEGER NOT NULL DEFAULT 50,"paused_reason" VARCHAR(500),"claimed_at" TIMESTAMPTZ(3),"completed_at" TIMESTAMPTZ(3),CONSTRAINT "receipt_task_values_valid" CHECK ("version">0 AND "workload">0 AND "priority" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "receipt_task_tenant_no_key" ON "wms"."receipt_task"("tenant_id","task_no");
CREATE INDEX "receipt_task_order_idx" ON "wms"."receipt_task"("tenant_id","inbound_order_id","status");
CREATE INDEX "receipt_task_claim_idx" ON "wms"."receipt_task"("tenant_id","status","priority","created_at");

CREATE TABLE "wms"."labor_assignment" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"receipt_task_id" UUID NOT NULL,"mode" "wms"."LaborAssignmentMode" NOT NULL,"from_assignee" UUID,"to_assignee" UUID NOT NULL,"reason" VARCHAR(500) NOT NULL,"assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "labor_assignment_values_valid" CHECK ("version">0 AND length(btrim("reason"))>0)
);
CREATE INDEX "labor_assignment_task_idx" ON "wms"."labor_assignment"("tenant_id","receipt_task_id","assigned_at");

CREATE TABLE "wms"."scan_event" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."ScanResolutionStatus" NOT NULL,"raw_barcode" VARCHAR(500) NOT NULL,"normalized_barcode" VARCHAR(500) NOT NULL,"device_id" VARCHAR(200) NOT NULL,"device_sequence" INTEGER NOT NULL,"scanned_at" TIMESTAMPTZ(3) NOT NULL,"inbound_order_id" UUID,"customer_id" UUID,"gs1_snapshot" JSONB NOT NULL DEFAULT '{}',"resolved_object_type" "wms"."BarcodeObjectType","resolved_object_id" UUID,"resolution_reason" VARCHAR(500),"resolved_by" UUID,"resolved_at" TIMESTAMPTZ(3),CONSTRAINT "scan_event_values_valid" CHECK ("version">0 AND "device_sequence">0 AND jsonb_typeof("gs1_snapshot")='object')
);
CREATE UNIQUE INDEX "scan_event_device_sequence_key" ON "wms"."scan_event"("tenant_id","device_id","device_sequence");
CREATE INDEX "scan_event_barcode_idx" ON "wms"."scan_event"("tenant_id","normalized_barcode","scanned_at");
CREATE INDEX "scan_event_resolution_idx" ON "wms"."scan_event"("tenant_id","status","created_at");

CREATE TABLE "wms"."barcode_resolution" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"scan_event_id" UUID NOT NULL,"resolution_status" "wms"."ScanResolutionStatus" NOT NULL,"object_type" "wms"."BarcodeObjectType" NOT NULL,"object_id" UUID NOT NULL,"resolution_snapshot" JSONB NOT NULL DEFAULT '{}',"reason" VARCHAR(500) NOT NULL,"resolved_by" UUID NOT NULL,"resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "barcode_resolution_values_valid" CHECK ("version">0 AND jsonb_typeof("resolution_snapshot")='object' AND length(btrim("reason"))>0)
);
CREATE UNIQUE INDEX "barcode_resolution_scan_key" ON "wms"."barcode_resolution"("tenant_id","scan_event_id");
CREATE INDEX "barcode_resolution_object_idx" ON "wms"."barcode_resolution"("tenant_id","object_type","object_id");

CREATE OR REPLACE FUNCTION "wms"."reject_inbound_fact_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'WMS inbound fact is immutable'; END; $$;
CREATE TRIGGER "inbound_package_immutable" BEFORE UPDATE OR DELETE ON "wms"."inbound_package" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_inbound_fact_mutation"();
CREATE TRIGGER "inbound_package_content_immutable" BEFORE UPDATE OR DELETE ON "wms"."inbound_package_content" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_inbound_fact_mutation"();
CREATE TRIGGER "arrival_event_immutable" BEFORE UPDATE OR DELETE ON "wms"."arrival_event" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_inbound_fact_mutation"();
CREATE TRIGGER "labor_assignment_immutable" BEFORE UPDATE OR DELETE ON "wms"."labor_assignment" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_inbound_fact_mutation"();
CREATE TRIGGER "scan_event_immutable" BEFORE UPDATE OR DELETE ON "wms"."scan_event" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_inbound_fact_mutation"();
CREATE TRIGGER "barcode_resolution_immutable" BEFORE UPDATE OR DELETE ON "wms"."barcode_resolution" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_inbound_fact_mutation"();
