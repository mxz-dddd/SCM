-- CreateEnum
CREATE TYPE "wms"."ValueAddedType" AS ENUM ('RELABEL', 'REPACK', 'KITTING', 'DISASSEMBLY', 'ASSEMBLY');

-- CreateEnum
CREATE TYPE "wms"."ValueAddedOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'QUALITY_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "wms"."LaborAssignmentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "wms"."OfflineCommandStatus" AS ENUM ('ACCEPTED', 'APPLIED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "wms"."DeviceCommandStatus" AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "wms"."value_added_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."ValueAddedOrderStatus" NOT NULL DEFAULT 'OPEN',
    "order_no" VARCHAR(100) NOT NULL,
    "type" "wms"."ValueAddedType" NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "source_ref" VARCHAR(200) NOT NULL,
    "process_version" VARCHAR(100) NOT NULL,
    "workcell_ref" VARCHAR(200),
    "assignee_ref" VARCHAR(200),
    "input_snapshot" JSONB NOT NULL,
    "instruction_snapshot" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "value_added_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."value_added_operation_fact" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "value_added_order_id" UUID NOT NULL,
    "input_quantity_base" DECIMAL(24,12) NOT NULL,
    "output_quantity_base" DECIMAL(24,12) NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "output_snapshot" JSONB NOT NULL,
    "process_trace" JSONB NOT NULL,
    "quality_snapshot" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "value_added_operation_fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."value_added_label_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "value_added_order_id" UUID NOT NULL,
    "handling_unit_ref" VARCHAR(200) NOT NULL,
    "old_label" VARCHAR(200) NOT NULL,
    "new_label" VARCHAR(200) NOT NULL,
    "reason_code" VARCHAR(100) NOT NULL,
    "event_snapshot" JSONB NOT NULL,

    CONSTRAINT "value_added_label_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."labor_standard" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "task_type" VARCHAR(100) NOT NULL,
    "standard_version" VARCHAR(100) NOT NULL,
    "minutes_per_unit" DECIMAL(24,6) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "rule_snapshot" JSONB NOT NULL,

    CONSTRAINT "labor_standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."labor_work_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."LaborAssignmentStatus" NOT NULL DEFAULT 'OPEN',
    "assignment_no" VARCHAR(100) NOT NULL,
    "task_type" VARCHAR(100) NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "assignee_type" VARCHAR(50) NOT NULL,
    "assignee_ref" VARCHAR(200) NOT NULL,
    "standard_id" UUID NOT NULL,
    "quantity_base" DECIMAL(24,12) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "labor_work_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."labor_metric" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "labor_assignment_id" UUID NOT NULL,
    "standard_minutes" DECIMAL(24,6) NOT NULL,
    "actual_minutes" DECIMAL(24,6) NOT NULL,
    "wait_minutes" DECIMAL(24,6) NOT NULL,
    "completed_quantity_base" DECIMAL(24,12) NOT NULL,
    "quality_score" DECIMAL(12,6) NOT NULL,
    "exception_count" INTEGER NOT NULL,
    "performance_score" DECIMAL(12,6) NOT NULL,
    "metric_snapshot" JSONB NOT NULL,

    CONSTRAINT "labor_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."offline_command" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."OfflineCommandStatus" NOT NULL,
    "device_id" VARCHAR(200) NOT NULL,
    "device_sequence" BIGINT NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "command_type" VARCHAR(100) NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "business_version" INTEGER NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "result_snapshot" JSONB NOT NULL,

    CONSTRAINT "offline_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."offline_sync_conflict" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."InventoryCaseStatus" NOT NULL DEFAULT 'OPEN',
    "device_id" VARCHAR(200) NOT NULL,
    "device_sequence" BIGINT NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "reason_code" VARCHAR(100) NOT NULL,
    "conflict_snapshot" JSONB NOT NULL,
    "resolution_snapshot" JSONB,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "offline_sync_conflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."device_command" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."DeviceCommandStatus" NOT NULL DEFAULT 'PENDING',
    "command_no" VARCHAR(100) NOT NULL,
    "adapter_type" VARCHAR(100) NOT NULL,
    "device_ref" VARCHAR(200) NOT NULL,
    "command_type" VARCHAR(100) NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "timeout_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "result_snapshot" JSONB,

    CONSTRAINT "device_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."device_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_command_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "device_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms"."warehouse_charge_fact" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "wms"."WmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "fact_type" VARCHAR(100) NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(24,12) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "fact_snapshot" JSONB NOT NULL,

    CONSTRAINT "warehouse_charge_fact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vas_order_workbench_idx" ON "wms"."value_added_order"("tenant_id", "warehouse_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vas_order_tenant_no_key" ON "wms"."value_added_order"("tenant_id", "order_no");

-- CreateIndex
CREATE INDEX "vas_operation_order_idx" ON "wms"."value_added_operation_fact"("tenant_id", "value_added_order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "vas_label_order_idx" ON "wms"."value_added_label_event"("tenant_id", "value_added_order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vas_label_new_tenant_key" ON "wms"."value_added_label_event"("tenant_id", "new_label");

-- CreateIndex
CREATE INDEX "labor_standard_lookup_idx" ON "wms"."labor_standard"("tenant_id", "task_type", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "labor_standard_version_key" ON "wms"."labor_standard"("tenant_id", "task_type", "standard_version");

-- CreateIndex
CREATE INDEX "labor_assignment_assignee_idx" ON "wms"."labor_work_assignment"("tenant_id", "assignee_ref", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "labor_assignment_tenant_no_key" ON "wms"."labor_work_assignment"("tenant_id", "assignment_no");

-- CreateIndex
CREATE INDEX "labor_metric_created_idx" ON "wms"."labor_metric"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "labor_metric_assignment_key" ON "wms"."labor_metric"("tenant_id", "labor_assignment_id");

-- CreateIndex
CREATE INDEX "offline_command_queue_idx" ON "wms"."offline_command"("tenant_id", "device_id", "status", "device_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "offline_command_device_seq_key" ON "wms"."offline_command"("tenant_id", "device_id", "device_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "offline_command_idempotency_key" ON "wms"."offline_command"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "offline_conflict_device_idx" ON "wms"."offline_sync_conflict"("tenant_id", "device_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "device_command_status_idx" ON "wms"."device_command"("tenant_id", "adapter_type", "status", "timeout_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_command_tenant_no_key" ON "wms"."device_command"("tenant_id", "command_no");

-- CreateIndex
CREATE INDEX "device_event_command_idx" ON "wms"."device_event"("tenant_id", "device_command_id", "occurred_at");

-- CreateIndex
CREATE INDEX "warehouse_charge_fact_business_idx" ON "wms"."warehouse_charge_fact"("tenant_id", "business_ref", "fact_type", "occurred_at");

ALTER TABLE "wms"."value_added_order" ADD CONSTRAINT "vas_order_values_valid" CHECK ("version">0 AND length(btrim("source_ref"))>0 AND length(btrim("process_version"))>0 AND jsonb_typeof("input_snapshot")='object' AND jsonb_typeof("instruction_snapshot")='object' AND ("status"<>'COMPLETED' OR "completed_at" IS NOT NULL));
ALTER TABLE "wms"."value_added_operation_fact" ADD CONSTRAINT "vas_operation_values_valid" CHECK ("version">0 AND "input_quantity_base">=0 AND "output_quantity_base">=0 AND jsonb_typeof("input_snapshot")='object' AND jsonb_typeof("output_snapshot")='object' AND jsonb_typeof("process_trace")='object' AND jsonb_typeof("quality_snapshot")='object');
ALTER TABLE "wms"."value_added_label_event" ADD CONSTRAINT "vas_label_values_valid" CHECK ("version">0 AND length(btrim("old_label"))>0 AND length(btrim("new_label"))>0 AND "old_label"<>"new_label" AND length(btrim("reason_code"))>0);
ALTER TABLE "wms"."labor_standard" ADD CONSTRAINT "labor_standard_values_valid" CHECK ("version">0 AND "minutes_per_unit">0 AND ("effective_to" IS NULL OR "effective_to">"effective_from") AND jsonb_typeof("rule_snapshot")='object');
ALTER TABLE "wms"."labor_work_assignment" ADD CONSTRAINT "labor_assignment_values_valid" CHECK ("version">0 AND "quantity_base">0 AND "assignee_type" IN ('PERSON','TEAM','VENDOR') AND ("status"<>'COMPLETED' OR "completed_at" IS NOT NULL));
ALTER TABLE "wms"."labor_metric" ADD CONSTRAINT "labor_metric_values_valid" CHECK ("version">0 AND "standard_minutes">=0 AND "actual_minutes">0 AND "wait_minutes">=0 AND "completed_quantity_base">0 AND "quality_score" BETWEEN 0 AND 100 AND "exception_count">=0 AND "performance_score">=0 AND jsonb_typeof("metric_snapshot")='object');
ALTER TABLE "wms"."offline_command" ADD CONSTRAINT "offline_command_values_valid" CHECK ("version">0 AND "device_sequence">0 AND "business_version">0 AND length("payload_hash")=64 AND jsonb_typeof("payload")='object' AND jsonb_typeof("result_snapshot")='object');
ALTER TABLE "wms"."offline_sync_conflict" ADD CONSTRAINT "offline_conflict_values_valid" CHECK ("version">0 AND "device_sequence">0 AND jsonb_typeof("conflict_snapshot")='object' AND ("status"<>'RESOLVED' OR ("resolution_snapshot" IS NOT NULL AND "resolved_at" IS NOT NULL)));
ALTER TABLE "wms"."device_command" ADD CONSTRAINT "device_command_values_valid" CHECK ("version">0 AND "timeout_at">"created_at" AND jsonb_typeof("payload")='object' AND ("status" NOT IN ('ACKNOWLEDGED','FAILED','TIMED_OUT') OR "completed_at" IS NOT NULL));
ALTER TABLE "wms"."device_event" ADD CONSTRAINT "device_event_values_valid" CHECK ("version">0 AND jsonb_typeof("payload")='object');
ALTER TABLE "wms"."warehouse_charge_fact" ADD CONSTRAINT "warehouse_charge_fact_values_valid" CHECK ("version">0 AND "quantity">0 AND length(btrim("uom"))>0 AND jsonb_typeof("fact_snapshot")='object');

CREATE TRIGGER "vas_operation_fact_immutable" BEFORE UPDATE OR DELETE ON "wms"."value_added_operation_fact" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "vas_label_event_immutable" BEFORE UPDATE OR DELETE ON "wms"."value_added_label_event" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "labor_metric_immutable" BEFORE UPDATE OR DELETE ON "wms"."labor_metric" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "offline_command_immutable" BEFORE UPDATE OR DELETE ON "wms"."offline_command" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "device_event_immutable" BEFORE UPDATE OR DELETE ON "wms"."device_event" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
CREATE TRIGGER "warehouse_charge_fact_immutable" BEFORE UPDATE OR DELETE ON "wms"."warehouse_charge_fact" FOR EACH ROW EXECUTE FUNCTION "wms"."reject_receiving_fact_mutation"();
