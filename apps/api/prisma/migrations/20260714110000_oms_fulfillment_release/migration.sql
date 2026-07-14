ALTER TYPE "oms"."OrderStatus" ADD VALUE 'RELEASED';
CREATE TYPE "oms"."FulfillmentStatus" AS ENUM ('DRAFT','RELEASED','ACCEPTED','EXECUTING','COMPLETED','FAILED','CANCELLED');
CREATE TYPE "oms"."FulfillmentType" AS ENUM ('INBOUND','OUTBOUND','TRANSFER');
CREATE TYPE "oms"."ShipmentRequestStatus" AS ENUM ('OPEN','SUBMITTED','ACCEPTED','EXECUTING','COMPLETED','FAILED','CANCELLED');
CREATE TYPE "oms"."ShipmentMode" AS ENUM ('DIRECT','MULTI_LEG');
CREATE TYPE "oms"."ReleaseBatchStatus" AS ENUM ('PROCESSING','COMPLETED','PARTIAL','FAILED');

CREATE TABLE "oms"."fulfillment_order" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."FulfillmentStatus" NOT NULL DEFAULT 'DRAFT',
  "fulfillment_no" VARCHAR(100) NOT NULL, "business_order_id" UUID NOT NULL, "order_version" INTEGER NOT NULL, "warehouse_id" UUID NOT NULL, "owner_id" UUID NOT NULL, "type" "oms"."FulfillmentType" NOT NULL, "planned_date" DATE, "release_batch_id" UUID, "source_version" INTEGER NOT NULL DEFAULT 0, "external_reference" VARCHAR(200), "progress_snapshot" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "fulfillment_order_values_valid" CHECK ("version">0 AND "order_version">0 AND "source_version">=0 AND jsonb_typeof("progress_snapshot")='object')
);
CREATE UNIQUE INDEX "fulfillment_order_tenant_no_key" ON "oms"."fulfillment_order"("tenant_id","fulfillment_no");
CREATE INDEX "fulfillment_order_order_idx" ON "oms"."fulfillment_order"("tenant_id","business_order_id","status");
CREATE INDEX "fulfillment_order_warehouse_idx" ON "oms"."fulfillment_order"("tenant_id","warehouse_id","status","planned_date");

CREATE TABLE "oms"."fulfillment_line" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "fulfillment_order_id" UUID NOT NULL, "source_order_line_id" UUID NOT NULL, "allocation_id" UUID NOT NULL, "line_no" INTEGER NOT NULL, "product_id" UUID NOT NULL, "product_snapshot" JSONB NOT NULL, "quantity_original" DECIMAL(24,12) NOT NULL, "original_uom" VARCHAR(20) NOT NULL, "quantity_base" DECIMAL(24,12) NOT NULL, "base_uom" VARCHAR(20) NOT NULL, "executed_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
  CONSTRAINT "fulfillment_line_values_valid" CHECK ("version">0 AND "line_no">0 AND "quantity_original">0 AND "quantity_base">0 AND "executed_base">=0 AND "executed_base"<="quantity_base" AND jsonb_typeof("product_snapshot")='object')
);
CREATE UNIQUE INDEX "fulfillment_line_order_line_no_key" ON "oms"."fulfillment_line"("tenant_id","fulfillment_order_id","line_no");
CREATE INDEX "fulfillment_line_source_idx" ON "oms"."fulfillment_line"("tenant_id","source_order_line_id","status");

CREATE TABLE "oms"."shipment_request" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."ShipmentRequestStatus" NOT NULL DEFAULT 'OPEN',
  "request_no" VARCHAR(100) NOT NULL, "business_order_id" UUID NOT NULL, "fulfillment_order_id" UUID, "mode" "oms"."ShipmentMode" NOT NULL, "origin_address_id" UUID, "origin_address_snapshot" JSONB NOT NULL, "destination_address_id" UUID, "destination_address_snapshot" JSONB NOT NULL, "pickup_from" TIMESTAMPTZ(3), "pickup_until" TIMESTAMPTZ(3), "delivery_from" TIMESTAMPTZ(3), "delivery_until" TIMESTAMPTZ(3), "weight" DECIMAL(24,12), "weight_uom" VARCHAR(20), "volume" DECIMAL(24,12), "volume_uom" VARCHAR(20), "temperature_min" DECIMAL(8,3), "temperature_max" DECIMAL(8,3), "service_level" VARCHAR(100), "release_batch_id" UUID, "request_snapshot" JSONB NOT NULL,
  CONSTRAINT "shipment_request_values_valid" CHECK ("version">0 AND (("weight" IS NULL AND "weight_uom" IS NULL) OR ("weight">=0 AND "weight_uom" IS NOT NULL)) AND (("volume" IS NULL AND "volume_uom" IS NULL) OR ("volume">=0 AND "volume_uom" IS NOT NULL)) AND (("temperature_min" IS NULL AND "temperature_max" IS NULL) OR ("temperature_min" IS NOT NULL AND "temperature_max" IS NOT NULL AND "temperature_min"<="temperature_max")) AND jsonb_typeof("origin_address_snapshot")='object' AND jsonb_typeof("destination_address_snapshot")='object' AND jsonb_typeof("request_snapshot")='object')
);
CREATE UNIQUE INDEX "shipment_request_tenant_no_key" ON "oms"."shipment_request"("tenant_id","request_no");
CREATE INDEX "shipment_request_order_idx" ON "oms"."shipment_request"("tenant_id","business_order_id","status");

CREATE TABLE "oms"."shipment_leg" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "shipment_request_id" UUID NOT NULL, "sequence" INTEGER NOT NULL, "from_address_id" UUID, "from_address_snapshot" JSONB NOT NULL, "to_address_id" UUID, "to_address_snapshot" JSONB NOT NULL, "window_from" TIMESTAMPTZ(3), "window_until" TIMESTAMPTZ(3),
  CONSTRAINT "shipment_leg_values_valid" CHECK ("version">0 AND "sequence">0 AND jsonb_typeof("from_address_snapshot")='object' AND jsonb_typeof("to_address_snapshot")='object' AND ("window_from" IS NULL OR "window_until" IS NULL OR "window_from"<="window_until"))
);
CREATE UNIQUE INDEX "shipment_leg_request_sequence_key" ON "oms"."shipment_leg"("tenant_id","shipment_request_id","sequence");
CREATE INDEX "shipment_leg_request_idx" ON "oms"."shipment_leg"("tenant_id","shipment_request_id","status");

CREATE TABLE "oms"."order_release_batch" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."ReleaseBatchStatus" NOT NULL DEFAULT 'PROCESSING',
  "batch_no" VARCHAR(100) NOT NULL, "mode" VARCHAR(20) NOT NULL, "calendar_code" VARCHAR(100) NOT NULL, "requested_count" INTEGER NOT NULL, "processed_count" INTEGER NOT NULL DEFAULT 0, "failed_count" INTEGER NOT NULL DEFAULT 0, "results" JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "order_release_batch_values_valid" CHECK ("version">0 AND "requested_count">0 AND "processed_count">=0 AND "failed_count">=0 AND "processed_count"+"failed_count"<="requested_count" AND jsonb_typeof("results")='array')
);
CREATE UNIQUE INDEX "order_release_batch_tenant_no_key" ON "oms"."order_release_batch"("tenant_id","batch_no");
CREATE INDEX "order_release_batch_status_idx" ON "oms"."order_release_batch"("tenant_id","status","created_at");

CREATE TRIGGER "shipment_leg_immutable" BEFORE UPDATE OR DELETE ON "oms"."shipment_leg" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
