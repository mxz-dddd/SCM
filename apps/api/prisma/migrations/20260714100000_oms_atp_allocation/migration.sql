ALTER TYPE "oms"."OrderStatus" ADD VALUE 'ALLOCATED';
CREATE TYPE "oms"."AllocationStatus" AS ENUM ('PROPOSED','RESERVED','RELEASED','FAILED');

CREATE TABLE "oms"."inventory_availability_projection" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "warehouse_id" UUID NOT NULL, "owner_id" UUID NOT NULL, "product_id" UUID NOT NULL, "batch_no" VARCHAR(100) NOT NULL DEFAULT '', "base_uom" VARCHAR(20) NOT NULL,
  "on_hand" DECIMAL(24,12) NOT NULL, "allocated" DECIMAL(24,12) NOT NULL DEFAULT 0, "hold" DECIMAL(24,12) NOT NULL DEFAULT 0, "in_transit" DECIMAL(24,12) NOT NULL DEFAULT 0, "expected_inbound" DECIMAL(24,12) NOT NULL DEFAULT 0, "safety_stock" DECIMAL(24,12) NOT NULL DEFAULT 0,
  "promise_date" TIMESTAMPTZ(3), "uncertainty" VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED', "source_version" INTEGER NOT NULL, "snapshot_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "availability_projection_values_valid" CHECK ("version">0 AND "source_version">0 AND "on_hand">=0 AND "allocated">=0 AND "hold">=0 AND "in_transit">=0 AND "expected_inbound">=0 AND "safety_stock">=0 AND "allocated"+"hold"<="on_hand")
);
CREATE UNIQUE INDEX "availability_projection_natural_key" ON "oms"."inventory_availability_projection"("tenant_id","warehouse_id","owner_id","product_id","batch_no");
CREATE INDEX "availability_projection_lookup_idx" ON "oms"."inventory_availability_projection"("tenant_id","product_id","owner_id","status");

CREATE TABLE "oms"."availability_promise" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "product_id" UUID NOT NULL, "owner_id" UUID NOT NULL, "requested_quantity" DECIMAL(24,12) NOT NULL, "base_uom" VARCHAR(20) NOT NULL, "available_now" DECIMAL(24,12) NOT NULL, "projected_available" DECIMAL(24,12) NOT NULL, "promise_date" TIMESTAMPTZ(3), "snapshot_at" TIMESTAMPTZ(3) NOT NULL, "uncertainty" VARCHAR(30) NOT NULL, "component_snapshot" JSONB NOT NULL,
  CONSTRAINT "availability_promise_values_valid" CHECK ("version">0 AND "requested_quantity">0 AND "available_now">=0 AND "projected_available">=0 AND jsonb_typeof("component_snapshot")='array')
);
CREATE INDEX "availability_promise_lookup_idx" ON "oms"."availability_promise"("tenant_id","product_id","owner_id","created_at");

CREATE TABLE "oms"."sourcing_decision" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "business_order_id" UUID NOT NULL, "order_version" INTEGER NOT NULL, "rule_set_code" VARCHAR(100) NOT NULL, "rule_set_version_number" INTEGER NOT NULL, "evaluation_trace_id" UUID NOT NULL, "selected_candidate_id" UUID, "candidates" JSONB NOT NULL, "exclusions" JSONB NOT NULL, "input_snapshot" JSONB NOT NULL,
  CONSTRAINT "sourcing_decision_values_valid" CHECK ("version">0 AND "order_version">0 AND "rule_set_version_number">0 AND jsonb_typeof("candidates")='array' AND jsonb_typeof("exclusions")='array' AND jsonb_typeof("input_snapshot")='object')
);
CREATE INDEX "sourcing_decision_order_idx" ON "oms"."sourcing_decision"("tenant_id","business_order_id","created_at");

CREATE TABLE "oms"."order_allocation" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."AllocationStatus" NOT NULL DEFAULT 'PROPOSED',
  "business_order_id" UUID NOT NULL, "order_line_id" UUID NOT NULL, "decision_id" UUID NOT NULL, "projection_id" UUID, "warehouse_id" UUID, "owner_id" UUID NOT NULL, "product_id" UUID NOT NULL, "batch_no" VARCHAR(100) NOT NULL DEFAULT '',
  "quantity_original" DECIMAL(24,12) NOT NULL, "original_uom" VARCHAR(20) NOT NULL, "quantity_base" DECIMAL(24,12) NOT NULL, "base_uom" VARCHAR(20) NOT NULL, "reservation_key" VARCHAR(200) NOT NULL, "failure_code" VARCHAR(100), "reserved_at" TIMESTAMPTZ(3), "released_at" TIMESTAMPTZ(3),
  CONSTRAINT "order_allocation_values_valid" CHECK ("version">0 AND "quantity_original">0 AND "quantity_base">0),
  CONSTRAINT "order_allocation_state_valid" CHECK (("status"='RESERVED')=("reserved_at" IS NOT NULL AND "failure_code" IS NULL AND "projection_id" IS NOT NULL AND "warehouse_id" IS NOT NULL) OR "status" IN ('PROPOSED','RELEASED','FAILED'))
);
CREATE UNIQUE INDEX "order_allocation_reservation_key" ON "oms"."order_allocation"("tenant_id","reservation_key");
CREATE INDEX "order_allocation_order_idx" ON "oms"."order_allocation"("tenant_id","business_order_id","status");
CREATE INDEX "order_allocation_projection_idx" ON "oms"."order_allocation"("tenant_id","projection_id","status");

CREATE TRIGGER "availability_promise_immutable" BEFORE UPDATE OR DELETE ON "oms"."availability_promise" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "sourcing_decision_immutable" BEFORE UPDATE OR DELETE ON "oms"."sourcing_decision" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
