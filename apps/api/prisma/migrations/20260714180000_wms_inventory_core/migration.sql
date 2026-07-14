CREATE TYPE "wms"."InventoryStockStatus" AS ENUM ('AVAILABLE','PENDING_INSPECTION','HOLD','DAMAGED','EXPIRED','PENDING_DISPOSITION');
CREATE TYPE "wms"."InventoryMovementType" AS ENUM ('RECEIPT','PUTAWAY','PICK','TRANSFER','ADJUSTMENT','SHIPMENT','STATUS_CHANGE','HOLD','RELEASE_HOLD','RESERVE','RELEASE_RESERVATION');
CREATE TYPE "wms"."InventoryHoldStatus" AS ENUM ('ACTIVE','RELEASED','CONSUMED');
CREATE TYPE "wms"."InventoryReservationStatus" AS ENUM ('RESERVED','RELEASED','CONSUMED','EXPIRED');

CREATE TABLE "wms"."inventory_balance" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryStockStatus" NOT NULL DEFAULT 'AVAILABLE',"warehouse_id" UUID NOT NULL,"location_id" UUID NOT NULL,"owner_id" UUID NOT NULL,"product_id" UUID NOT NULL,"inventory_lot_id" UUID,"serial_number_id" UUID,"handling_unit_id" UUID,"on_hand_original" DECIMAL(24,12) NOT NULL DEFAULT 0,"on_hand_base" DECIMAL(24,12) NOT NULL DEFAULT 0,"available_original" DECIMAL(24,12) NOT NULL DEFAULT 0,"available_base" DECIMAL(24,12) NOT NULL DEFAULT 0,"allocated_original" DECIMAL(24,12) NOT NULL DEFAULT 0,"allocated_base" DECIMAL(24,12) NOT NULL DEFAULT 0,"hold_original" DECIMAL(24,12) NOT NULL DEFAULT 0,"hold_base" DECIMAL(24,12) NOT NULL DEFAULT 0,"in_transit_original" DECIMAL(24,12) NOT NULL DEFAULT 0,"in_transit_base" DECIMAL(24,12) NOT NULL DEFAULT 0,"original_uom" VARCHAR(20) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,
 CONSTRAINT "inventory_balance_values_valid" CHECK ("version">0 AND "on_hand_original">=0 AND "on_hand_base">=0 AND "available_original">=0 AND "available_base">=0 AND "allocated_original">=0 AND "allocated_base">=0 AND "hold_original">=0 AND "hold_base">=0 AND "in_transit_original">=0 AND "in_transit_base">=0 AND "available_original"="on_hand_original"-"allocated_original"-"hold_original" AND "available_base"="on_hand_base"-"allocated_base"-"hold_base")
);
CREATE UNIQUE INDEX "inventory_balance_dimension_key" ON "wms"."inventory_balance"("tenant_id","warehouse_id","location_id","owner_id","product_id","inventory_lot_id","serial_number_id","handling_unit_id","status") NULLS NOT DISTINCT;
CREATE INDEX "inventory_balance_lookup_idx" ON "wms"."inventory_balance"("tenant_id","warehouse_id","product_id","status");
CREATE INDEX "inventory_balance_owner_idx" ON "wms"."inventory_balance"("tenant_id","owner_id","product_id","status");

CREATE TABLE "wms"."inventory_movement" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"movement_no" VARCHAR(100) NOT NULL,"balance_id" UUID NOT NULL,"type" "wms"."InventoryMovementType" NOT NULL,"from_dimensions" JSONB NOT NULL DEFAULT '{}',"to_dimensions" JSONB NOT NULL DEFAULT '{}',"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,"business_type" VARCHAR(100) NOT NULL,"business_ref" VARCHAR(200) NOT NULL,"trace_id" VARCHAR(100) NOT NULL,"chain_sequence" INTEGER NOT NULL,"previous_hash" CHAR(64),"movement_hash" CHAR(64) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "inventory_movement_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0 AND "chain_sequence">0 AND length(btrim("business_ref"))>0 AND length(btrim("trace_id"))>0)
);
CREATE UNIQUE INDEX "inventory_movement_tenant_no_key" ON "wms"."inventory_movement"("tenant_id","movement_no");
CREATE UNIQUE INDEX "inventory_movement_chain_sequence_key" ON "wms"."inventory_movement"("tenant_id","balance_id","chain_sequence");
CREATE INDEX "inventory_movement_business_idx" ON "wms"."inventory_movement"("tenant_id","business_type","business_ref","occurred_at");
CREATE INDEX "inventory_movement_balance_idx" ON "wms"."inventory_movement"("tenant_id","balance_id","occurred_at");

CREATE TABLE "wms"."inventory_status_change" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"change_no" VARCHAR(100) NOT NULL,"source_balance_id" UUID NOT NULL,"target_balance_id" UUID NOT NULL,"from_status" "wms"."InventoryStockStatus" NOT NULL,"to_status" "wms"."InventoryStockStatus" NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"reason" VARCHAR(500) NOT NULL,"approval_reference" VARCHAR(200),"movement_id" UUID NOT NULL,
 CONSTRAINT "inventory_status_change_values_valid" CHECK ("version">0 AND "from_status"<>"to_status" AND "quantity_original">0 AND "quantity_base">0 AND length(btrim("reason"))>0)
);
CREATE UNIQUE INDEX "inventory_status_change_tenant_no_key" ON "wms"."inventory_status_change"("tenant_id","change_no");
CREATE INDEX "inventory_status_change_source_idx" ON "wms"."inventory_status_change"("tenant_id","source_balance_id","created_at");

CREATE TABLE "wms"."inventory_hold" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryHoldStatus" NOT NULL DEFAULT 'ACTIVE',"hold_no" VARCHAR(100) NOT NULL,"balance_id" UUID NOT NULL,"scope_type" VARCHAR(50) NOT NULL,"scope_ref" VARCHAR(200),"scope_snapshot" JSONB NOT NULL DEFAULT '{}',"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"reason" VARCHAR(500) NOT NULL,"requires_approval" BOOLEAN NOT NULL DEFAULT false,"approval_reference" VARCHAR(200),"released_at" TIMESTAMPTZ(3),"release_reason" VARCHAR(500),
 CONSTRAINT "inventory_hold_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0 AND length(btrim("reason"))>0 AND jsonb_typeof("scope_snapshot")='object')
);
CREATE UNIQUE INDEX "inventory_hold_tenant_no_key" ON "wms"."inventory_hold"("tenant_id","hold_no");
CREATE INDEX "inventory_hold_balance_idx" ON "wms"."inventory_hold"("tenant_id","balance_id","status","created_at");

CREATE TABLE "wms"."inventory_reservation" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryReservationStatus" NOT NULL DEFAULT 'RESERVED',"reservation_no" VARCHAR(100) NOT NULL,"balance_id" UUID NOT NULL,"source_type" VARCHAR(50) NOT NULL,"source_ref" VARCHAR(200) NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"expires_at" TIMESTAMPTZ(3),"released_at" TIMESTAMPTZ(3),"release_reason" VARCHAR(500),
 CONSTRAINT "inventory_reservation_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0 AND length(btrim("source_type"))>0 AND length(btrim("source_ref"))>0)
);
CREATE UNIQUE INDEX "inventory_reservation_tenant_no_key" ON "wms"."inventory_reservation"("tenant_id","reservation_no");
CREATE INDEX "inventory_reservation_balance_idx" ON "wms"."inventory_reservation"("tenant_id","balance_id","status","expires_at");
CREATE INDEX "inventory_reservation_source_idx" ON "wms"."inventory_reservation"("tenant_id","source_type","source_ref","status");

CREATE TABLE "wms"."allocation_detail" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"reservation_id" UUID NOT NULL,"balance_id" UUID NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"business_snapshot" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "allocation_detail_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0 AND jsonb_typeof("business_snapshot")='object')
);
CREATE INDEX "allocation_detail_reservation_idx" ON "wms"."allocation_detail"("tenant_id","reservation_id","created_at");

CREATE TRIGGER "inventory_movement_immutable" BEFORE UPDATE OR DELETE ON "wms"."inventory_movement" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "inventory_status_change_immutable" BEFORE UPDATE OR DELETE ON "wms"."inventory_status_change" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "allocation_detail_immutable" BEFORE UPDATE OR DELETE ON "wms"."allocation_detail" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
