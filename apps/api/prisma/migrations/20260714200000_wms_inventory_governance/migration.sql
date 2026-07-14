CREATE TYPE "wms"."InventoryAdjustmentStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','REJECTED');
CREATE TYPE "wms"."InventoryAdjustmentType" AS ENUM ('GAIN','LOSS','DAMAGE','DATA_FIX');
CREATE TYPE "wms"."InventoryIssueMethod" AS ENUM ('FIFO','FEFO');
CREATE TYPE "wms"."ReplenishmentTaskStatus" AS ENUM ('PLANNED','EXECUTING','COMPLETED','FAILED','CANCELLED');
CREATE TYPE "wms"."InventoryAlertType" AS ENUM ('AGED','NEAR_EXPIRY','EXPIRED');
CREATE TYPE "wms"."InventoryAlertStatus" AS ENUM ('OPEN','ACKNOWLEDGED','RESOLVED');
CREATE TYPE "wms"."InventoryReconciliationStatus" AS ENUM ('DRAFT','MATCHED','DIFFERENCE_RECORDED','CLOSED');
CREATE TYPE "wms"."InventoryCaseStatus" AS ENUM ('OPEN','RESOLVED');

CREATE TABLE "wms"."inventory_adjustment_order" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
 "adjustment_no" VARCHAR(100) NOT NULL,"balance_id" UUID NOT NULL,"type" "wms"."InventoryAdjustmentType" NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"reason_code" VARCHAR(100) NOT NULL,"reason" VARCHAR(500) NOT NULL,"attachment_refs" JSONB NOT NULL,"financial_impact" JSONB NOT NULL,"approval_reference" VARCHAR(200),"movement_id" UUID,"posted_at" TIMESTAMPTZ(3),
 CONSTRAINT "inventory_adjustment_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0 AND length(btrim("reason_code"))>0 AND length(btrim("reason"))>0 AND jsonb_typeof("attachment_refs")='array' AND jsonb_array_length("attachment_refs")>0 AND jsonb_typeof("financial_impact")='object' AND ("status"<>'POSTED' OR ("approval_reference" IS NOT NULL AND "movement_id" IS NOT NULL AND "posted_at" IS NOT NULL)))
);
CREATE UNIQUE INDEX "inventory_adjustment_tenant_no_key" ON "wms"."inventory_adjustment_order"("tenant_id","adjustment_no");
CREATE INDEX "inventory_adjustment_workbench_idx" ON "wms"."inventory_adjustment_order"("tenant_id","status","created_at");
CREATE INDEX "inventory_adjustment_balance_idx" ON "wms"."inventory_adjustment_order"("tenant_id","balance_id","created_at");

CREATE TABLE "wms"."replenishment_policy" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
 "policy_no" VARCHAR(100) NOT NULL,"warehouse_id" UUID NOT NULL,"owner_id" UUID,"product_id" UUID NOT NULL,"pick_location_id" UUID NOT NULL,"minimum_base" DECIMAL(24,12) NOT NULL,"maximum_base" DECIMAL(24,12) NOT NULL,"lead_time_days" INTEGER NOT NULL DEFAULT 0,"issue_method" "wms"."InventoryIssueMethod" NOT NULL DEFAULT 'FEFO',"demand_snapshot" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "replenishment_policy_values_valid" CHECK ("version">0 AND "minimum_base">=0 AND "maximum_base">"minimum_base" AND "lead_time_days">=0 AND jsonb_typeof("demand_snapshot")='object')
);
CREATE UNIQUE INDEX "replenishment_policy_tenant_no_key" ON "wms"."replenishment_policy"("tenant_id","policy_no");
CREATE INDEX "replenishment_policy_lookup_idx" ON "wms"."replenishment_policy"("tenant_id","warehouse_id","product_id","status");

CREATE TABLE "wms"."replenishment_task" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."ReplenishmentTaskStatus" NOT NULL DEFAULT 'PLANNED',
 "task_no" VARCHAR(100) NOT NULL,"policy_id" UUID NOT NULL,"source_balance_id" UUID NOT NULL,"target_location_id" UUID NOT NULL,"quantity_original" DECIMAL(24,12) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"issue_method" "wms"."InventoryIssueMethod" NOT NULL,"selection_snapshot" JSONB NOT NULL,"transfer_id" UUID,"failure_reason" VARCHAR(500),"completed_at" TIMESTAMPTZ(3),
 CONSTRAINT "replenishment_task_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0 AND jsonb_typeof("selection_snapshot")='object' AND ("status"<>'COMPLETED' OR ("transfer_id" IS NOT NULL AND "completed_at" IS NOT NULL)))
);
CREATE UNIQUE INDEX "replenishment_task_tenant_no_key" ON "wms"."replenishment_task"("tenant_id","task_no");
CREATE INDEX "replenishment_task_workbench_idx" ON "wms"."replenishment_task"("tenant_id","status","created_at");
CREATE INDEX "replenishment_task_source_idx" ON "wms"."replenishment_task"("tenant_id","source_balance_id","status");

CREATE TABLE "wms"."inventory_aging_snapshot" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
 "snapshot_date" DATE NOT NULL,"balance_id" UUID NOT NULL,"inventory_lot_id" UUID,"age_days" INTEGER NOT NULL,"remaining_shelf_life_days" INTEGER,"bucket_code" VARCHAR(50) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,
 CONSTRAINT "inventory_aging_values_valid" CHECK ("version">0 AND "age_days">=0 AND "quantity_base">0 AND length(btrim("bucket_code"))>0)
);
CREATE UNIQUE INDEX "inventory_aging_snapshot_key" ON "wms"."inventory_aging_snapshot"("tenant_id","snapshot_date","balance_id");
CREATE INDEX "inventory_aging_bucket_idx" ON "wms"."inventory_aging_snapshot"("tenant_id","snapshot_date","bucket_code");

CREATE TABLE "wms"."inventory_expiry_alert" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryAlertStatus" NOT NULL DEFAULT 'OPEN',
 "alert_no" VARCHAR(100) NOT NULL,"dedupe_key" VARCHAR(300) NOT NULL,"type" "wms"."InventoryAlertType" NOT NULL,"balance_id" UUID NOT NULL,"inventory_lot_id" UUID,"severity" VARCHAR(20) NOT NULL,"action_suggestion" VARCHAR(500) NOT NULL,"snapshot" JSONB NOT NULL,"resolved_at" TIMESTAMPTZ(3),
 CONSTRAINT "inventory_expiry_alert_values_valid" CHECK ("version">0 AND length(btrim("severity"))>0 AND length(btrim("action_suggestion"))>0 AND jsonb_typeof("snapshot")='object')
);
CREATE UNIQUE INDEX "inventory_expiry_alert_dedupe_key" ON "wms"."inventory_expiry_alert"("tenant_id","dedupe_key");
CREATE INDEX "inventory_expiry_alert_workbench_idx" ON "wms"."inventory_expiry_alert"("tenant_id","status","type","created_at");

CREATE TABLE "wms"."inventory_reconciliation" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
 "reconciliation_no" VARCHAR(100) NOT NULL,"warehouse_id" UUID NOT NULL,"owner_id" UUID,"period_start" TIMESTAMPTZ(3) NOT NULL,"period_end" TIMESTAMPTZ(3) NOT NULL,"opening_base" DECIMAL(24,12) NOT NULL,"receipt_base" DECIMAL(24,12) NOT NULL,"shipment_base" DECIMAL(24,12) NOT NULL,"adjustment_base" DECIMAL(24,12) NOT NULL,"count_base" DECIMAL(24,12) NOT NULL,"closing_base" DECIMAL(24,12) NOT NULL,"erp_closing_base" DECIMAL(24,12) NOT NULL,"difference_base" DECIMAL(24,12) NOT NULL,"calculation_snapshot" JSONB NOT NULL,"closed_at" TIMESTAMPTZ(3),
 CONSTRAINT "inventory_reconciliation_values_valid" CHECK ("version">0 AND "period_end">"period_start" AND "difference_base"="erp_closing_base"-"closing_base" AND jsonb_typeof("calculation_snapshot")='object')
);
CREATE UNIQUE INDEX "inventory_reconciliation_tenant_no_key" ON "wms"."inventory_reconciliation"("tenant_id","reconciliation_no");
CREATE INDEX "inventory_reconciliation_workbench_idx" ON "wms"."inventory_reconciliation"("tenant_id","warehouse_id","status","period_end");

CREATE TABLE "wms"."inventory_reconciliation_case" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "wms"."InventoryCaseStatus" NOT NULL DEFAULT 'OPEN',
 "case_no" VARCHAR(100) NOT NULL,"reconciliation_id" UUID NOT NULL,"dedupe_key" VARCHAR(300) NOT NULL,"expected_base" DECIMAL(24,12) NOT NULL,"actual_base" DECIMAL(24,12) NOT NULL,"difference_base" DECIMAL(24,12) NOT NULL,"description" VARCHAR(1000) NOT NULL,"resolution" VARCHAR(1000),"resolved_at" TIMESTAMPTZ(3),
 CONSTRAINT "inventory_reconciliation_case_values_valid" CHECK ("version">0 AND "difference_base"="actual_base"-"expected_base" AND length(btrim("description"))>0)
);
CREATE UNIQUE INDEX "inventory_reconciliation_case_tenant_no_key" ON "wms"."inventory_reconciliation_case"("tenant_id","case_no");
CREATE UNIQUE INDEX "inventory_reconciliation_case_dedupe_key" ON "wms"."inventory_reconciliation_case"("tenant_id","dedupe_key");
CREATE INDEX "inventory_reconciliation_case_workbench_idx" ON "wms"."inventory_reconciliation_case"("tenant_id","status","created_at");

CREATE TRIGGER "inventory_aging_snapshot_immutable" BEFORE UPDATE OR DELETE ON "wms"."inventory_aging_snapshot" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
