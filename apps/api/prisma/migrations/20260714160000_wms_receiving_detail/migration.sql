CREATE TYPE "wms"."ReceiptMode" AS ENUM ('BLIND','ORDERED');
CREATE TYPE "wms"."ReceiptLineStatus" AS ENUM ('CONFIRMED','VOIDED');
CREATE TYPE "wms"."ReceivingVarianceType" AS ENUM ('QUANTITY','PACKAGING','DAMAGE','TEMPERATURE','DOCUMENT');
CREATE TYPE "wms"."ReceivingDisposition" AS ENUM ('PENDING','SUPPLEMENTED','REJECTED','QUALITY_REVIEW');
CREATE TYPE "wms"."InventoryLotStatus" AS ENUM ('RECEIVED','QUARANTINED');
CREATE TYPE "wms"."SerialNumberStatus" AS ENUM ('RECEIVED','QUARANTINED');
CREATE TYPE "wms"."HandlingUnitStatus" AS ENUM ('ACTIVE','SPLIT','MERGED','CLOSED');
CREATE TYPE "wms"."HandlingUnitType" AS ENUM ('CARTON','PALLET');
CREATE TYPE "wms"."HandlingUnitEventType" AS ENUM ('CREATED','BUILT','SPLIT','MERGED');
CREATE TYPE "wms"."LabelJobStatus" AS ENUM ('REQUESTED','PRINTED','FAILED');

CREATE TABLE "wms"."receipt_line" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."ReceiptLineStatus" NOT NULL DEFAULT 'CONFIRMED',
 "inbound_order_id" UUID NOT NULL,"inbound_line_id" UUID NOT NULL,"receipt_task_id" UUID NOT NULL,"mode" "wms"."ReceiptMode" NOT NULL,"product_id" UUID NOT NULL,"product_snapshot" JSONB NOT NULL,"package_spec_id" UUID,"package_spec_version" INTEGER,"package_spec_snapshot" JSONB NOT NULL DEFAULT '{}',
 "expected_quantity_original" DECIMAL(24,12) NOT NULL,"expected_original_uom" VARCHAR(20) NOT NULL,"expected_quantity_base" DECIMAL(24,12) NOT NULL,"expected_base_uom" VARCHAR(20) NOT NULL,
 "received_quantity_original" DECIMAL(24,12) NOT NULL,"received_original_uom" VARCHAR(20) NOT NULL,"received_quantity_base" DECIMAL(24,12) NOT NULL,"received_base_uom" VARCHAR(20) NOT NULL,
 "accepted_quantity_original" DECIMAL(24,12) NOT NULL,"accepted_quantity_base" DECIMAL(24,12) NOT NULL,"rejected_quantity_original" DECIMAL(24,12) NOT NULL,"rejected_quantity_base" DECIMAL(24,12) NOT NULL,"pending_quantity_original" DECIMAL(24,12) NOT NULL,"pending_quantity_base" DECIMAL(24,12) NOT NULL,
 "variance_reason" VARCHAR(500),"authorization_reference" VARCHAR(200),"received_at" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "receipt_line_values_valid" CHECK ("version">0 AND "expected_quantity_original">0 AND "expected_quantity_base">0 AND "received_quantity_original">0 AND "received_quantity_base">0 AND "accepted_quantity_original">=0 AND "accepted_quantity_base">=0 AND "rejected_quantity_original">=0 AND "rejected_quantity_base">=0 AND "pending_quantity_original">=0 AND "pending_quantity_base">=0 AND "received_quantity_original"="accepted_quantity_original"+"rejected_quantity_original"+"pending_quantity_original" AND "received_quantity_base"="accepted_quantity_base"+"rejected_quantity_base"+"pending_quantity_base" AND jsonb_typeof("product_snapshot")='object' AND jsonb_typeof("package_spec_snapshot")='object')
);
CREATE INDEX "receipt_line_inbound_idx" ON "wms"."receipt_line"("tenant_id","inbound_order_id","inbound_line_id","status");
CREATE INDEX "receipt_line_task_idx" ON "wms"."receipt_line"("tenant_id","receipt_task_id","received_at");

CREATE TABLE "wms"."receiving_variance" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."ReceivingDisposition" NOT NULL DEFAULT 'PENDING',
 "variance_no" VARCHAR(100) NOT NULL,"inbound_order_id" UUID NOT NULL,"receipt_line_id" UUID,"type" "wms"."ReceivingVarianceType" NOT NULL,"reason" VARCHAR(500) NOT NULL,"quantity_delta_original" DECIMAL(24,12),"original_uom" VARCHAR(20),"quantity_delta_base" DECIMAL(24,12),"base_uom" VARCHAR(20),"temperature" DECIMAL(10,3),"temperature_uom" VARCHAR(10),"photo_refs" JSONB NOT NULL DEFAULT '[]',"disposition_reason" VARCHAR(500),"resolved_at" TIMESTAMPTZ(3),"supplier_notification_ref" UUID,"purchase_notification_ref" UUID,
 CONSTRAINT "receiving_variance_values_valid" CHECK ("version">0 AND length(btrim("reason"))>0 AND jsonb_typeof("photo_refs")='array' AND (("quantity_delta_original" IS NULL AND "quantity_delta_base" IS NULL) OR ("quantity_delta_original" IS NOT NULL AND "quantity_delta_base" IS NOT NULL AND "original_uom" IS NOT NULL AND "base_uom" IS NOT NULL)))
);
CREATE UNIQUE INDEX "receiving_variance_tenant_no_key" ON "wms"."receiving_variance"("tenant_id","variance_no");
CREATE INDEX "receiving_variance_workbench_idx" ON "wms"."receiving_variance"("tenant_id","inbound_order_id","status","type");

CREATE TABLE "wms"."inventory_lot" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryLotStatus" NOT NULL,"inbound_order_id" UUID NOT NULL,"receipt_line_id" UUID NOT NULL,"product_id" UUID NOT NULL,"owner_id" UUID NOT NULL,"supplier_batch_no" VARCHAR(200) NOT NULL,"production_date" DATE,"expiry_date" DATE,"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"quarantine_reason" VARCHAR(500),
 CONSTRAINT "inventory_lot_values_valid" CHECK ("version">0 AND length(btrim("supplier_batch_no"))>0 AND "quantity_original">0 AND "quantity_base">0 AND ("production_date" IS NULL OR "expiry_date" IS NULL OR "production_date"<="expiry_date") AND ("status"<>'QUARANTINED' OR "quarantine_reason" IS NOT NULL))
);
CREATE INDEX "inventory_lot_trace_idx" ON "wms"."inventory_lot"("tenant_id","product_id","supplier_batch_no","status");
CREATE INDEX "inventory_lot_receipt_idx" ON "wms"."inventory_lot"("tenant_id","inbound_order_id","receipt_line_id");

CREATE TABLE "wms"."serial_number" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."SerialNumberStatus" NOT NULL,"serial_number" VARCHAR(300) NOT NULL,"inbound_order_id" UUID NOT NULL,"receipt_line_id" UUID NOT NULL,"inventory_lot_id" UUID,"product_id" UUID NOT NULL,
 CONSTRAINT "serial_number_values_valid" CHECK ("version">0 AND length(btrim("serial_number"))>0)
);
CREATE UNIQUE INDEX "serial_number_tenant_serial_key" ON "wms"."serial_number"("tenant_id","serial_number");
CREATE INDEX "serial_number_product_idx" ON "wms"."serial_number"("tenant_id","product_id","status");

CREATE TABLE "wms"."handling_unit" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."HandlingUnitStatus" NOT NULL DEFAULT 'ACTIVE',"inbound_order_id" UUID NOT NULL,"parent_handling_unit_id" UUID,"type" "wms"."HandlingUnitType" NOT NULL,"lpn" VARCHAR(200) NOT NULL,"label_number" VARCHAR(200) NOT NULL,"mixed_allowed" BOOLEAN NOT NULL DEFAULT false,
 CONSTRAINT "handling_unit_values_valid" CHECK ("version">0 AND "id"<>COALESCE("parent_handling_unit_id",'00000000-0000-0000-0000-000000000000'))
);
CREATE UNIQUE INDEX "handling_unit_tenant_lpn_key" ON "wms"."handling_unit"("tenant_id","lpn");
CREATE UNIQUE INDEX "handling_unit_tenant_label_key" ON "wms"."handling_unit"("tenant_id","label_number");
CREATE INDEX "handling_unit_tree_idx" ON "wms"."handling_unit"("tenant_id","inbound_order_id","parent_handling_unit_id","status");

CREATE TABLE "wms"."handling_unit_content" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"handling_unit_id" UUID NOT NULL,"receipt_line_id" UUID NOT NULL,"product_id" UUID NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,
 CONSTRAINT "handling_unit_content_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0)
);
CREATE UNIQUE INDEX "handling_unit_content_key" ON "wms"."handling_unit_content"("tenant_id","handling_unit_id","receipt_line_id");
CREATE INDEX "handling_unit_content_receipt_idx" ON "wms"."handling_unit_content"("tenant_id","receipt_line_id","status");

CREATE TABLE "wms"."handling_unit_event" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"handling_unit_id" UUID NOT NULL,"type" "wms"."HandlingUnitEventType" NOT NULL,"source_handling_unit_id" UUID,"target_handling_unit_id" UUID,"from_parent_id" UUID,"to_parent_id" UUID,"payload" JSONB NOT NULL DEFAULT '{}',"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "handling_unit_event_values_valid" CHECK ("version">0 AND jsonb_typeof("payload")='object')
);
CREATE INDEX "handling_unit_event_idx" ON "wms"."handling_unit_event"("tenant_id","handling_unit_id","occurred_at");

CREATE TABLE "wms"."label_job" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."LabelJobStatus" NOT NULL DEFAULT 'REQUESTED',"handling_unit_id" UUID NOT NULL,"job_no" VARCHAR(100) NOT NULL,"label_number" VARCHAR(200) NOT NULL,"reprint_of_job_id" UUID,"reason" VARCHAR(500) NOT NULL,"copies" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "label_job_values_valid" CHECK ("version">0 AND length(btrim("reason"))>0 AND "copies" BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX "label_job_tenant_no_key" ON "wms"."label_job"("tenant_id","job_no");
CREATE INDEX "label_job_handling_unit_idx" ON "wms"."label_job"("tenant_id","handling_unit_id","created_at");

CREATE OR REPLACE FUNCTION "wms"."reject_receiving_fact_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'WMS receiving fact is immutable'; END; $$;
CREATE TRIGGER "receipt_line_immutable" BEFORE UPDATE OR DELETE ON "wms"."receipt_line" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "inventory_lot_immutable" BEFORE UPDATE OR DELETE ON "wms"."inventory_lot" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "serial_number_immutable" BEFORE UPDATE OR DELETE ON "wms"."serial_number" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "handling_unit_event_immutable" BEFORE UPDATE OR DELETE ON "wms"."handling_unit_event" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
