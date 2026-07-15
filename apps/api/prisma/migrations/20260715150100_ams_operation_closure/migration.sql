ALTER TABLE "ams"."appointment" DROP CONSTRAINT "appointment_state_check";
ALTER TABLE "ams"."appointment" ADD CONSTRAINT "appointment_state_check" CHECK (
  ("status"='DRAFT' AND "submitted_at" IS NULL AND "decided_at" IS NULL) OR
  ("status" IN ('SUBMITTED','PENDING') AND "submitted_at" IS NOT NULL AND "decided_at" IS NULL) OR
  ("status" IN ('CONFIRMED','REJECTED','CANCELLED','CHECKED_IN','QUEUED','DOCKED','OPERATING','CHECKED_OUT','COMPLETED','NO_SHOW') AND "submitted_at" IS NOT NULL AND "decided_at" IS NOT NULL)
);

CREATE TYPE "ams"."NoShowCaseStatus" AS ENUM ('OPEN','APPEALED','WAIVED','UPHELD');

CREATE TABLE "ams"."operation_event" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "appointment_id" UUID NOT NULL,
  "dock_assignment_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "event_type" VARCHAR(30) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "quantity" DECIMAL(24,6) NOT NULL,
  "quantity_uom" VARCHAR(20) NOT NULL,
  "business_links" JSONB NOT NULL,
  "evidence_snapshot" JSONB NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  CONSTRAINT "operation_event_values_check" CHECK (
    "sequence">0 AND "event_type" IN ('DOCKED','STARTED','PAUSED','RESUMED','COMPLETED','DEPARTED') AND
    "quantity">=0 AND length(btrim("quantity_uom"))>0 AND length(btrim("reason"))>0 AND
    jsonb_typeof("business_links")='object' AND jsonb_typeof("evidence_snapshot")='object'
  )
);
CREATE UNIQUE INDEX "operation_event_appointment_sequence_key" ON "ams"."operation_event"("tenant_id","appointment_id","sequence");
CREATE INDEX "operation_event_appointment_time_idx" ON "ams"."operation_event"("tenant_id","appointment_id","occurred_at");

CREATE TABLE "ams"."appointment_completion" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "appointment_id" UUID NOT NULL,
  "dock_assignment_id" UUID NOT NULL,
  "checked_in_at" TIMESTAMPTZ(3) NOT NULL,
  "docked_at" TIMESTAMPTZ(3) NOT NULL,
  "operation_started_at" TIMESTAMPTZ(3) NOT NULL,
  "operation_completed_at" TIMESTAMPTZ(3) NOT NULL,
  "departed_at" TIMESTAMPTZ(3) NOT NULL,
  "checked_out_at" TIMESTAMPTZ(3) NOT NULL,
  "waiting_minutes" INTEGER NOT NULL,
  "operating_minutes" INTEGER NOT NULL,
  "paused_minutes" INTEGER NOT NULL,
  "overrun_minutes" INTEGER NOT NULL,
  "actual_quantity" DECIMAL(24,6) NOT NULL,
  "actual_quantity_uom" VARCHAR(20) NOT NULL,
  "workload_snapshot" JSONB NOT NULL,
  "control_snapshot" JSONB NOT NULL,
  "performance_snapshot" JSONB NOT NULL,
  CONSTRAINT "appointment_completion_values_check" CHECK (
    "checked_in_at"<="docked_at" AND "docked_at"<="operation_started_at" AND
    "operation_started_at"<="operation_completed_at" AND "operation_completed_at"<="departed_at" AND
    "departed_at"<="checked_out_at" AND "waiting_minutes">=0 AND "operating_minutes">=0 AND
    "paused_minutes">=0 AND "overrun_minutes">=0 AND "actual_quantity">=0 AND
    length(btrim("actual_quantity_uom"))>0 AND jsonb_typeof("workload_snapshot")='object' AND
    jsonb_typeof("control_snapshot")='object' AND jsonb_typeof("performance_snapshot")='object'
  )
);
CREATE UNIQUE INDEX "appointment_completion_appointment_key" ON "ams"."appointment_completion"("tenant_id","appointment_id");
CREATE INDEX "appointment_completion_time_idx" ON "ams"."appointment_completion"("tenant_id","checked_out_at","appointment_id");

CREATE TABLE "ams"."no_show_case" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ams"."NoShowCaseStatus" NOT NULL DEFAULT 'OPEN',
  "appointment_id" UUID NOT NULL,
  "detected_at" TIMESTAMPTZ(3) NOT NULL,
  "grace_minutes" INTEGER NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "capacity_waste_snapshot" JSONB NOT NULL,
  "notification_snapshot" JSONB NOT NULL,
  "contract_snapshot" JSONB NOT NULL,
  CONSTRAINT "no_show_case_values_check" CHECK (
    "grace_minutes">=0 AND length(btrim("reason"))>0 AND
    jsonb_typeof("capacity_waste_snapshot")='object' AND jsonb_typeof("notification_snapshot")='object' AND
    jsonb_typeof("contract_snapshot")='object'
  )
);
CREATE UNIQUE INDEX "no_show_case_appointment_key" ON "ams"."no_show_case"("tenant_id","appointment_id");
CREATE INDEX "no_show_case_status_time_idx" ON "ams"."no_show_case"("tenant_id","status","detected_at");

CREATE TABLE "ams"."penalty_charge_fact" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "no_show_case_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "amount" DECIMAL(24,6) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "calculation_trace" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "penalty_charge_fact_values_check" CHECK ("amount">=0 AND "currency" ~ '^[A-Z]{3}$' AND length(btrim("reason"))>0 AND jsonb_typeof("calculation_trace")='object')
);
CREATE UNIQUE INDEX "penalty_charge_fact_case_key" ON "ams"."penalty_charge_fact"("tenant_id","no_show_case_id");
CREATE INDEX "penalty_charge_fact_appointment_idx" ON "ams"."penalty_charge_fact"("tenant_id","appointment_id","occurred_at");

CREATE TABLE "ams"."no_show_appeal" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "no_show_case_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "evidence_snapshot" JSONB NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "no_show_appeal_values_check" CHECK (length(btrim("reason"))>0 AND jsonb_typeof("evidence_snapshot")='object')
);
CREATE UNIQUE INDEX "no_show_appeal_case_key" ON "ams"."no_show_appeal"("tenant_id","no_show_case_id");

CREATE TABLE "ams"."penalty_waiver_decision" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "no_show_case_id" UUID NOT NULL,
  "appeal_id" UUID NOT NULL,
  "penalty_charge_fact_id" UUID,
  "decision" VARCHAR(20) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "original_amount" DECIMAL(24,6) NOT NULL,
  "effective_amount" DECIMAL(24,6) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "penalty_waiver_decision_values_check" CHECK (
    "decision" IN ('WAIVED','UPHELD') AND "original_amount">=0 AND "effective_amount">=0 AND
    (("decision"='WAIVED' AND "effective_amount"=0) OR ("decision"='UPHELD' AND "effective_amount"="original_amount")) AND
    "currency" ~ '^[A-Z]{3}$' AND length(btrim("reason"))>0
  )
);
CREATE UNIQUE INDEX "penalty_waiver_decision_appeal_key" ON "ams"."penalty_waiver_decision"("tenant_id","appeal_id");
CREATE INDEX "penalty_waiver_decision_case_idx" ON "ams"."penalty_waiver_decision"("tenant_id","no_show_case_id","decided_at");

CREATE UNIQUE INDEX "gate_access_one_allowed_exit_key" ON "ams"."gate_access_event"("tenant_id","appointment_id") WHERE "event_type"='EXIT' AND "decision"='ALLOWED';

CREATE TRIGGER operation_event_immutable BEFORE UPDATE OR DELETE ON "ams"."operation_event" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER appointment_completion_immutable BEFORE UPDATE OR DELETE ON "ams"."appointment_completion" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER penalty_charge_fact_immutable BEFORE UPDATE OR DELETE ON "ams"."penalty_charge_fact" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER no_show_appeal_immutable BEFORE UPDATE OR DELETE ON "ams"."no_show_appeal" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER penalty_waiver_decision_immutable BEFORE UPDATE OR DELETE ON "ams"."penalty_waiver_decision" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
