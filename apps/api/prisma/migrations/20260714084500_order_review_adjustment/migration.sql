ALTER TYPE "oms"."OrderStatus" ADD VALUE 'APPROVED';
ALTER TYPE "oms"."OrderStatus" ADD VALUE 'REJECTED';
ALTER TYPE "oms"."OrderStatus" ADD VALUE 'HOLD';
CREATE TYPE "oms"."OrderReviewStatus" AS ENUM ('AUTO_APPROVED','PENDING_APPROVAL','APPROVED','REJECTED');
CREATE TYPE "oms"."OrderHoldStatus" AS ENUM ('ACTIVE','RELEASED');

ALTER TABLE "oms"."business_order"
  ADD COLUMN "total_amount" DECIMAL(24,6),
  ADD COLUMN "currency" CHAR(3),
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "vip" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "expedited" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "business_order_money_pair" CHECK (("total_amount" IS NULL AND "currency" IS NULL) OR ("total_amount" IS NOT NULL AND "currency" IS NOT NULL)),
  ADD CONSTRAINT "business_order_amount_nonnegative" CHECK ("total_amount" IS NULL OR "total_amount" >= 0),
  ADD CONSTRAINT "business_order_currency_iso" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "business_order_priority_range" CHECK ("priority" BETWEEN 1 AND 100);

ALTER TABLE "oms"."business_order_line"
  ADD COLUMN "executed_quantity_base" DECIMAL(24,12) NOT NULL DEFAULT 0,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 50,
  ADD CONSTRAINT "business_order_line_executed_valid" CHECK ("executed_quantity_base" >= 0 AND ("quantity_base" IS NULL OR "executed_quantity_base" <= "quantity_base")),
  ADD CONSTRAINT "business_order_line_priority_range" CHECK ("priority" BETWEEN 1 AND 100);

CREATE TABLE "oms"."order_review" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OrderReviewStatus" NOT NULL,
  "business_order_id" UUID NOT NULL, "order_version" INTEGER NOT NULL, "findings" JSONB NOT NULL DEFAULT '[]', "input_snapshot" JSONB NOT NULL, "approval_instance_id" UUID, "decided_at" TIMESTAMPTZ(3), "decided_by" UUID,
  CONSTRAINT "order_review_values_valid" CHECK ("version" > 0 AND "order_version" > 0 AND jsonb_typeof("findings")='array' AND jsonb_typeof("input_snapshot")='object'),
  CONSTRAINT "order_review_decision_valid" CHECK (("status" IN ('AUTO_APPROVED','APPROVED','REJECTED')) = ("decided_at" IS NOT NULL AND "decided_by" IS NOT NULL))
);
CREATE INDEX "order_review_tenant_order_idx" ON "oms"."order_review"("tenant_id","business_order_id","created_at");
CREATE INDEX "order_review_tenant_status_idx" ON "oms"."order_review"("tenant_id","status","created_at");

CREATE TABLE "oms"."order_merge_group" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "code" VARCHAR(100) NOT NULL, "customer_id" UUID NOT NULL, "address_id" UUID NOT NULL, "currency" CHAR(3), "aggregate_amount" DECIMAL(24,6), "allocation_snapshot" JSONB NOT NULL,
  CONSTRAINT "order_merge_group_values_valid" CHECK ("version">0 AND (("aggregate_amount" IS NULL AND "currency" IS NULL) OR ("aggregate_amount" IS NOT NULL AND "currency" IS NOT NULL)) AND ("aggregate_amount" IS NULL OR "aggregate_amount">=0) AND jsonb_typeof("allocation_snapshot")='object')
);
CREATE UNIQUE INDEX "order_merge_group_tenant_code_key" ON "oms"."order_merge_group"("tenant_id","code");
CREATE INDEX "order_merge_group_tenant_customer_idx" ON "oms"."order_merge_group"("tenant_id","customer_id","status","created_at");

CREATE TABLE "oms"."order_merge_member" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "merge_group_id" UUID NOT NULL, "business_order_id" UUID NOT NULL, "order_version" INTEGER NOT NULL, "order_snapshot" JSONB NOT NULL, "amount_allocation" DECIMAL(24,6), "quantity_allocation" JSONB NOT NULL,
  CONSTRAINT "order_merge_member_values_valid" CHECK ("version">0 AND "order_version">0 AND ("amount_allocation" IS NULL OR "amount_allocation">=0) AND jsonb_typeof("order_snapshot")='object' AND jsonb_typeof("quantity_allocation")='object')
);
CREATE UNIQUE INDEX "order_merge_member_tenant_group_order_key" ON "oms"."order_merge_member"("tenant_id","merge_group_id","business_order_id");
CREATE INDEX "order_merge_member_tenant_order_idx" ON "oms"."order_merge_member"("tenant_id","business_order_id","status");

CREATE TABLE "oms"."order_split_relation" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "split_group_id" UUID NOT NULL, "source_order_id" UUID NOT NULL, "source_line_id" UUID NOT NULL, "source_order_version" INTEGER NOT NULL, "child_business_ref" VARCHAR(200) NOT NULL, "quantity_original" DECIMAL(24,12) NOT NULL, "original_uom" VARCHAR(20) NOT NULL, "quantity_base" DECIMAL(24,12) NOT NULL, "base_uom" VARCHAR(20) NOT NULL, "amount_allocation" DECIMAL(24,6), "currency" CHAR(3),
  CONSTRAINT "order_split_values_valid" CHECK ("version">0 AND "source_order_version">0 AND "quantity_original">0 AND "quantity_base">0 AND (("amount_allocation" IS NULL AND "currency" IS NULL) OR ("amount_allocation" IS NOT NULL AND "currency" IS NOT NULL)) AND ("amount_allocation" IS NULL OR "amount_allocation">=0))
);
CREATE UNIQUE INDEX "order_split_tenant_group_line_child_key" ON "oms"."order_split_relation"("tenant_id","split_group_id","source_line_id","child_business_ref");
CREATE INDEX "order_split_tenant_source_idx" ON "oms"."order_split_relation"("tenant_id","source_order_id","source_line_id");

CREATE TABLE "oms"."priority_decision" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "business_order_id" UUID NOT NULL, "order_line_id" UUID, "previous_priority" INTEGER NOT NULL, "priority" INTEGER NOT NULL, "factors" JSONB NOT NULL, "rule_version" VARCHAR(100) NOT NULL, "reallocation_eligible_quantity" DECIMAL(24,12), "base_uom" VARCHAR(20),
  CONSTRAINT "priority_decision_values_valid" CHECK ("version">0 AND "previous_priority" BETWEEN 1 AND 100 AND "priority" BETWEEN 1 AND 100 AND ("reallocation_eligible_quantity" IS NULL OR "reallocation_eligible_quantity">=0) AND jsonb_typeof("factors")='object')
);
CREATE INDEX "priority_decision_tenant_order_idx" ON "oms"."priority_decision"("tenant_id","business_order_id","created_at");

CREATE TABLE "oms"."order_hold" (
  "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OrderHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "business_order_id" UUID NOT NULL, "order_line_id" UUID, "hold_type" VARCHAR(100) NOT NULL, "reason" VARCHAR(1000) NOT NULL, "previous_order_status" "oms"."OrderStatus" NOT NULL, "released_at" TIMESTAMPTZ(3), "released_by" UUID, "release_reason" VARCHAR(1000),
  CONSTRAINT "order_hold_values_valid" CHECK ("version">0 AND length(btrim("hold_type"))>0 AND length(btrim("reason"))>0),
  CONSTRAINT "order_hold_release_valid" CHECK (("status"='RELEASED')=("released_at" IS NOT NULL AND "released_by" IS NOT NULL AND "release_reason" IS NOT NULL))
);
CREATE INDEX "order_hold_tenant_order_idx" ON "oms"."order_hold"("tenant_id","business_order_id","status","created_at");
CREATE INDEX "order_hold_tenant_line_idx" ON "oms"."order_hold"("tenant_id","order_line_id","status");

CREATE OR REPLACE FUNCTION "oms"."guard_split_overallocation"() RETURNS TRIGGER AS $$
DECLARE source_quantity DECIMAL(24,12); allocated DECIMAL(24,12);
BEGIN
  SELECT quantity_base INTO source_quantity FROM "oms"."business_order_line" WHERE id=NEW.source_line_id AND tenant_id=NEW.tenant_id;
  IF source_quantity IS NULL THEN RAISE EXCEPTION 'split source line is not available' USING ERRCODE='23000'; END IF;
  SELECT COALESCE(sum(quantity_base),0) INTO allocated FROM "oms"."order_split_relation" WHERE tenant_id=NEW.tenant_id AND split_group_id=NEW.split_group_id AND source_line_id=NEW.source_line_id AND id<>NEW.id;
  IF allocated+NEW.quantity_base>source_quantity THEN RAISE EXCEPTION 'split quantity exceeds source quantity' USING ERRCODE='23000'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "order_split_allocation_guard" BEFORE INSERT OR UPDATE ON "oms"."order_split_relation" FOR EACH ROW EXECUTE FUNCTION "oms"."guard_split_overallocation"();

CREATE TRIGGER "order_merge_member_immutable" BEFORE UPDATE OR DELETE ON "oms"."order_merge_member" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "order_split_relation_immutable" BEFORE UPDATE OR DELETE ON "oms"."order_split_relation" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "priority_decision_immutable" BEFORE UPDATE OR DELETE ON "oms"."priority_decision" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
