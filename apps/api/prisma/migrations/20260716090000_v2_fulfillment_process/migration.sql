-- phase: expand
-- online-index-safe: new-table

CREATE TYPE "oms"."OrderFulfillmentProcessStatus" AS ENUM ('STARTED','WAITING_DOWNSTREAM','EXECUTING','COMPLETED','FAILED','COMPENSATING','MANUAL_INTERVENTION');
CREATE TYPE "oms"."OrderFulfillmentStepType" AS ENUM ('CREATE_WMS_OUTBOUND','CREATE_TMS_ORDER','WAIT_WMS_READY','WAIT_DISPATCH','WAIT_DELIVERY','FINALIZE_ORDER','COMPENSATE_WMS_OUTBOUND','COMPENSATE_TMS_ORDER');
CREATE TYPE "oms"."OrderFulfillmentStepStatus" AS ENUM ('PENDING','PROCESSING','SUCCEEDED','FAILED','COMPENSATING','COMPENSATED','MANUAL');

ALTER TABLE "wms"."outbound_order" ADD COLUMN "source_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "oms"."order_fulfillment_process" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OrderFulfillmentProcessStatus" NOT NULL DEFAULT 'STARTED',
  "order_id" UUID NOT NULL, "order_version" INTEGER NOT NULL, "order_no" VARCHAR(100) NOT NULL,
  "expected_step_count" INTEGER NOT NULL, "succeeded_step_count" INTEGER NOT NULL DEFAULT 0,
  "failure_code" VARCHAR(100), "failure_message" VARCHAR(2000),
  "manual_intervention_required" BOOLEAN NOT NULL DEFAULT false,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "order_fulfillment_process_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fulfillment_process_step_counts" CHECK ("expected_step_count" > 0 AND "succeeded_step_count" >= 0 AND "succeeded_step_count" <= "expected_step_count")
);
CREATE UNIQUE INDEX "fulfillment_process_tenant_order_version_key" ON "oms"."order_fulfillment_process"("tenant_id","order_id","order_version");
CREATE INDEX "fulfillment_process_tenant_status_idx" ON "oms"."order_fulfillment_process"("tenant_id","status","updated_at","id");

CREATE TABLE "oms"."order_fulfillment_step" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OrderFulfillmentStepStatus" NOT NULL DEFAULT 'PENDING',
  "process_id" UUID NOT NULL, "step_type" "oms"."OrderFulfillmentStepType" NOT NULL,
  "source_event_id" UUID NOT NULL, "idempotency_key" VARCHAR(300) NOT NULL,
  "target_type" VARCHAR(100), "target_id" UUID, "target_business_no" VARCHAR(200),
  "input_snapshot" JSONB NOT NULL, "result_snapshot" JSONB NOT NULL DEFAULT '{}',
  "compensation_snapshot" JSONB NOT NULL DEFAULT '{}', "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(2000), CONSTRAINT "order_fulfillment_step_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fulfillment_step_attempt_count" CHECK ("attempt_count" >= 0)
);
CREATE UNIQUE INDEX "fulfillment_step_tenant_idempotency_key" ON "oms"."order_fulfillment_step"("tenant_id","idempotency_key");
CREATE UNIQUE INDEX "fulfillment_step_tenant_event_type_key" ON "oms"."order_fulfillment_step"("tenant_id","source_event_id","step_type");
CREATE INDEX "fulfillment_step_tenant_process_idx" ON "oms"."order_fulfillment_step"("tenant_id","process_id","status","created_at");
CREATE INDEX "fulfillment_step_tenant_target_idx" ON "oms"."order_fulfillment_step"("tenant_id","target_type","target_id");

CREATE TABLE "oms"."cross_domain_object_link" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "process_id" UUID NOT NULL, "source_type" VARCHAR(100) NOT NULL, "source_id" UUID NOT NULL,
  "source_business_no" VARCHAR(200) NOT NULL, "target_type" VARCHAR(100) NOT NULL,
  "target_id" UUID NOT NULL, "target_business_no" VARCHAR(200) NOT NULL,
  CONSTRAINT "cross_domain_object_link_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cross_domain_link_tenant_source_target_key" ON "oms"."cross_domain_object_link"("tenant_id","source_type","source_id","target_type","target_id");
CREATE INDEX "cross_domain_link_tenant_process_idx" ON "oms"."cross_domain_object_link"("tenant_id","process_id","status","created_at");
CREATE INDEX "cross_domain_link_tenant_target_idx" ON "oms"."cross_domain_object_link"("tenant_id","target_type","target_id");

CREATE OR REPLACE FUNCTION "oms"."protect_fulfillment_process_records"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'fulfillment process records cannot be deleted' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fulfillment_process_no_delete BEFORE DELETE ON "oms"."order_fulfillment_process" FOR EACH ROW EXECUTE FUNCTION "oms"."protect_fulfillment_process_records"();
CREATE TRIGGER fulfillment_step_no_delete BEFORE DELETE ON "oms"."order_fulfillment_step" FOR EACH ROW EXECUTE FUNCTION "oms"."protect_fulfillment_process_records"();
CREATE TRIGGER cross_domain_link_no_delete BEFORE DELETE ON "oms"."cross_domain_object_link" FOR EACH ROW EXECUTE FUNCTION "oms"."protect_fulfillment_process_records"();
