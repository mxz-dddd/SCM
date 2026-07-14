ALTER TYPE "wms"."InventoryMovementType" ADD VALUE 'OWNERSHIP_OUT';
ALTER TYPE "wms"."InventoryMovementType" ADD VALUE 'OWNERSHIP_IN';
CREATE TYPE "wms"."InventoryCountType" AS ENUM ('CYCLE','FULL');
CREATE TYPE "wms"."InventoryCountStatus" AS ENUM ('PLANNED','COUNTING','REVIEWING','POSTED','CLOSED','CANCELLED');
CREATE TYPE "wms"."InventoryCountLineStatus" AS ENUM ('OPEN','COUNTED','RECOUNTED','APPROVED','POSTED');
CREATE TYPE "wms"."CountFreezeStatus" AS ENUM ('ACTIVE','RELEASED');

CREATE TABLE "wms"."inventory_transfer_task" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"task_no" VARCHAR(100) NOT NULL,"source_balance_id" UUID NOT NULL,"target_balance_id" UUID NOT NULL,"source_location_id" UUID NOT NULL,"target_location_id" UUID NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"reason" VARCHAR(500) NOT NULL,"movement_id" UUID NOT NULL,"completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "inventory_transfer_task_values_valid" CHECK ("version">0 AND "source_location_id"<>"target_location_id" AND "quantity_original">0 AND "quantity_base">0 AND length(btrim("reason"))>0)
);
CREATE UNIQUE INDEX "inventory_transfer_task_tenant_no_key" ON "wms"."inventory_transfer_task"("tenant_id","task_no");
CREATE INDEX "inventory_transfer_task_source_idx" ON "wms"."inventory_transfer_task"("tenant_id","source_balance_id","created_at");

CREATE TABLE "wms"."ownership_transfer" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"transfer_no" VARCHAR(100) NOT NULL,"source_balance_id" UUID NOT NULL,"target_balance_id" UUID NOT NULL,"from_owner_id" UUID NOT NULL,"to_owner_id" UUID NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"contract_reference" VARCHAR(200) NOT NULL,"approval_reference" VARCHAR(200) NOT NULL,"reason" VARCHAR(500) NOT NULL,"outbound_movement_id" UUID NOT NULL,"inbound_movement_id" UUID NOT NULL,"charge_fact_snapshot" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "ownership_transfer_values_valid" CHECK ("version">0 AND "from_owner_id"<>"to_owner_id" AND "quantity_original">0 AND "quantity_base">0 AND length(btrim("contract_reference"))>0 AND length(btrim("approval_reference"))>0 AND length(btrim("reason"))>0 AND jsonb_typeof("charge_fact_snapshot")='object')
);
CREATE UNIQUE INDEX "ownership_transfer_tenant_no_key" ON "wms"."ownership_transfer"("tenant_id","transfer_no");
CREATE INDEX "ownership_transfer_source_idx" ON "wms"."ownership_transfer"("tenant_id","source_balance_id","created_at");

CREATE TABLE "wms"."capacity_check" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"location_id" UUID NOT NULL,"business_type" VARCHAR(100) NOT NULL,"business_ref" VARCHAR(200) NOT NULL,"allowed" BOOLEAN NOT NULL,"constraint_snapshot" JSONB NOT NULL,"exclusion_reasons" JSONB NOT NULL DEFAULT '[]',
 CONSTRAINT "capacity_check_values_valid" CHECK ("version">0 AND jsonb_typeof("constraint_snapshot")='object' AND jsonb_typeof("exclusion_reasons")='array')
);
CREATE INDEX "capacity_check_location_idx" ON "wms"."capacity_check"("tenant_id","location_id","created_at");

CREATE TABLE "wms"."inventory_count_order" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryCountStatus" NOT NULL DEFAULT 'PLANNED',"count_no" VARCHAR(100) NOT NULL,"type" "wms"."InventoryCountType" NOT NULL,"warehouse_id" UUID NOT NULL,"owner_id" UUID,"blind" BOOLEAN NOT NULL DEFAULT true,"freeze_inventory" BOOLEAN NOT NULL DEFAULT false,"criteria_snapshot" JSONB NOT NULL DEFAULT '{}',"started_at" TIMESTAMPTZ(3),"reviewed_at" TIMESTAMPTZ(3),"posted_at" TIMESTAMPTZ(3),"closed_at" TIMESTAMPTZ(3),
 CONSTRAINT "inventory_count_order_values_valid" CHECK ("version">0 AND jsonb_typeof("criteria_snapshot")='object')
);
CREATE UNIQUE INDEX "inventory_count_order_tenant_no_key" ON "wms"."inventory_count_order"("tenant_id","count_no");
CREATE INDEX "inventory_count_order_workbench_idx" ON "wms"."inventory_count_order"("tenant_id","warehouse_id","status","created_at");

CREATE TABLE "wms"."inventory_count_line" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryCountLineStatus" NOT NULL DEFAULT 'OPEN',"count_order_id" UUID NOT NULL,"balance_id" UUID NOT NULL,"location_id" UUID NOT NULL,"dimension_snapshot" JSONB NOT NULL,"expected_quantity_original" DECIMAL(24,12) NOT NULL,"expected_quantity_base" DECIMAL(24,12) NOT NULL,"first_count_original" DECIMAL(24,12),"first_count_base" DECIMAL(24,12),"recount_original" DECIMAL(24,12),"recount_base" DECIMAL(24,12),"approved_quantity_original" DECIMAL(24,12),"approved_quantity_base" DECIMAL(24,12),"variance_reason" VARCHAR(500),"approval_reference" VARCHAR(200),
 CONSTRAINT "inventory_count_line_values_valid" CHECK ("version">0 AND "expected_quantity_original">=0 AND "expected_quantity_base">=0 AND ("first_count_original" IS NULL OR "first_count_original">=0) AND ("first_count_base" IS NULL OR "first_count_base">=0) AND ("recount_original" IS NULL OR "recount_original">=0) AND ("recount_base" IS NULL OR "recount_base">=0) AND jsonb_typeof("dimension_snapshot")='object')
);
CREATE UNIQUE INDEX "inventory_count_line_balance_key" ON "wms"."inventory_count_line"("tenant_id","count_order_id","balance_id");
CREATE INDEX "inventory_count_line_order_idx" ON "wms"."inventory_count_line"("tenant_id","count_order_id","status","location_id");

CREATE TABLE "wms"."inventory_count_freeze" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."CountFreezeStatus" NOT NULL DEFAULT 'ACTIVE',"count_order_id" UUID NOT NULL,"count_line_id" UUID NOT NULL,"balance_id" UUID NOT NULL,"location_id" UUID NOT NULL,"hold_id" UUID NOT NULL,"frozen_original" DECIMAL(24,12) NOT NULL,"frozen_base" DECIMAL(24,12) NOT NULL,"released_at" TIMESTAMPTZ(3),
 CONSTRAINT "inventory_count_freeze_values_valid" CHECK ("version">0 AND "frozen_original">=0 AND "frozen_base">=0)
);
CREATE UNIQUE INDEX "inventory_count_freeze_balance_key" ON "wms"."inventory_count_freeze"("tenant_id","count_order_id","balance_id");
CREATE INDEX "inventory_count_freeze_order_idx" ON "wms"."inventory_count_freeze"("tenant_id","count_order_id","status","location_id");

CREATE TRIGGER "inventory_transfer_task_immutable" BEFORE UPDATE OR DELETE ON "wms"."inventory_transfer_task" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "ownership_transfer_immutable" BEFORE UPDATE OR DELETE ON "wms"."ownership_transfer" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "capacity_check_immutable" BEFORE UPDATE OR DELETE ON "wms"."capacity_check" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
