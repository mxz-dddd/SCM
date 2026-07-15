ALTER TABLE "ams"."appointment" DROP CONSTRAINT "appointment_state_check";
ALTER TABLE "ams"."appointment" ADD CONSTRAINT "appointment_state_check" CHECK (("status"='DRAFT' AND "submitted_at" IS NULL AND "decided_at" IS NULL) OR ("status" IN ('SUBMITTED','PENDING') AND "submitted_at" IS NOT NULL AND "decided_at" IS NULL) OR ("status" IN ('CONFIRMED','REJECTED','CANCELLED','CHECKED_IN','QUEUED','DOCKED') AND "submitted_at" IS NOT NULL AND "decided_at" IS NOT NULL));
CREATE TYPE "ams"."GateVerificationStatus" AS ENUM ('PASSED','MANUAL_REVIEW','REJECTED');
CREATE TYPE "ams"."GatePassStatus" AS ENUM ('ACTIVE','USED','EXPIRED','REVOKED');
CREATE TYPE "ams"."QueueTicketStatus" AS ENUM ('WAITING','CALLED','ACKNOWLEDGED','DEFERRED','CANCELLED');
CREATE TYPE "ams"."DockRuntimeStatus" AS ENUM ('AVAILABLE','OCCUPIED','FAULT');
CREATE TYPE "ams"."DockAssignmentStatus" AS ENUM ('ACTIVE','RELEASED','SWITCHED');

CREATE TABLE "ams"."gate_verification" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."GateVerificationStatus" NOT NULL,"appointment_id" UUID,"verification_no" VARCHAR(100) NOT NULL,"identity_type" VARCHAR(30) NOT NULL,"identity_hash" CHAR(64) NOT NULL,"arrival_class" VARCHAR(30) NOT NULL,"observed_at" TIMESTAMPTZ(3) NOT NULL,"policy_snapshot" JSONB NOT NULL,"evidence_snapshot" JSONB NOT NULL,"reasons" JSONB NOT NULL,"manually_released" BOOLEAN NOT NULL DEFAULT false,
 CONSTRAINT "gate_verification_values_check" CHECK ("identity_type" IN ('APPOINTMENT_NO','QR_CODE','PLATE') AND "identity_hash" ~ '^[0-9a-f]{64}$' AND "arrival_class" IN ('EARLY','ON_TIME','LATE','WALK_IN') AND jsonb_typeof("policy_snapshot")='object' AND jsonb_typeof("evidence_snapshot")='object' AND jsonb_typeof("reasons")='array' AND (("arrival_class"='WALK_IN' AND "appointment_id" IS NULL) OR "appointment_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "gate_verification_tenant_no_key" ON "ams"."gate_verification"("tenant_id","verification_no");
CREATE INDEX "gate_verification_appointment_idx" ON "ams"."gate_verification"("tenant_id","appointment_id","observed_at");

CREATE TABLE "ams"."gate_pass" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."GatePassStatus" NOT NULL DEFAULT 'ACTIVE',"appointment_id" UUID NOT NULL,"gate_verification_id" UUID NOT NULL,"token_hash" CHAR(64) NOT NULL,"plate_hash" CHAR(64) NOT NULL,"valid_from" TIMESTAMPTZ(3) NOT NULL,"valid_until" TIMESTAMPTZ(3) NOT NULL,"entry_count" INTEGER NOT NULL DEFAULT 0,"used_at" TIMESTAMPTZ(3),
 CONSTRAINT "gate_pass_values_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$' AND "plate_hash" ~ '^[0-9a-f]{64}$' AND "valid_until">"valid_from" AND "entry_count">=0),
 CONSTRAINT "gate_pass_state_check" CHECK (("status"='ACTIVE' AND "entry_count"=0 AND "used_at" IS NULL) OR ("status"='USED' AND "entry_count"=1 AND "used_at" IS NOT NULL) OR "status" IN ('EXPIRED','REVOKED'))
);
CREATE UNIQUE INDEX "gate_pass_token_hash_key" ON "ams"."gate_pass"("tenant_id","token_hash");
CREATE INDEX "gate_pass_appointment_idx" ON "ams"."gate_pass"("tenant_id","appointment_id","status","valid_until");
CREATE UNIQUE INDEX "gate_pass_one_active_appointment_key" ON "ams"."gate_pass"("tenant_id","appointment_id") WHERE "status"='ACTIVE';

CREATE TABLE "ams"."gate_access_event" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"gate_pass_id" UUID NOT NULL,"appointment_id" UUID NOT NULL,"event_type" VARCHAR(30) NOT NULL,"decision" VARCHAR(20) NOT NULL,"reason" VARCHAR(1000) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"evidence_snapshot" JSONB NOT NULL,
 CONSTRAINT "gate_access_event_values_check" CHECK ("event_type" IN ('ENTRY','EXIT') AND "decision" IN ('ALLOWED','DENIED') AND jsonb_typeof("evidence_snapshot")='object')
);
CREATE INDEX "gate_access_event_pass_idx" ON "ams"."gate_access_event"("tenant_id","gate_pass_id","occurred_at");

CREATE TABLE "ams"."queue_ticket" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."QueueTicketStatus" NOT NULL DEFAULT 'WAITING',"ticket_no" VARCHAR(100) NOT NULL,"appointment_id" UUID NOT NULL,"warehouse_ref" UUID NOT NULL,"priority_score" INTEGER NOT NULL,"priority_snapshot" JSONB NOT NULL,"queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"called_at" TIMESTAMPTZ(3),"call_deadline_at" TIMESTAMPTZ(3),"acknowledged_at" TIMESTAMPTZ(3),"retry_count" INTEGER NOT NULL DEFAULT 0,"escalation_level" INTEGER NOT NULL DEFAULT 0,"transition_reason" VARCHAR(1000),
 CONSTRAINT "queue_ticket_values_check" CHECK (jsonb_typeof("priority_snapshot")='object' AND "retry_count">=0 AND "escalation_level">=0)
);
CREATE UNIQUE INDEX "queue_ticket_tenant_no_key" ON "ams"."queue_ticket"("tenant_id","ticket_no");
CREATE INDEX "queue_ticket_dispatch_idx" ON "ams"."queue_ticket"("tenant_id","warehouse_ref","status","priority_score","queued_at");
CREATE UNIQUE INDEX "queue_ticket_one_active_appointment_key" ON "ams"."queue_ticket"("tenant_id","appointment_id") WHERE "status" IN ('WAITING','CALLED','ACKNOWLEDGED','DEFERRED');

CREATE TABLE "ams"."call_event" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"queue_ticket_id" UUID NOT NULL,"sequence" INTEGER NOT NULL,"event_type" VARCHAR(30) NOT NULL,"channels" JSONB NOT NULL,"reason" VARCHAR(1000) NOT NULL,"deadline_at" TIMESTAMPTZ(3),"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "call_event_values_check" CHECK ("sequence">0 AND "event_type" IN ('CALLED','ACKNOWLEDGED','TIMEOUT','RECALLED','ESCALATED','CANCELLED') AND jsonb_typeof("channels")='array')
);
CREATE UNIQUE INDEX "call_event_ticket_sequence_key" ON "ams"."call_event"("tenant_id","queue_ticket_id","sequence");
CREATE INDEX "call_event_ticket_time_idx" ON "ams"."call_event"("tenant_id","queue_ticket_id","occurred_at");

CREATE TABLE "ams"."dock_runtime" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."DockRuntimeStatus" NOT NULL DEFAULT 'AVAILABLE',"dock_ref" UUID NOT NULL,"warehouse_ref" UUID NOT NULL,"dock_snapshot" JSONB NOT NULL,"fault_reason" VARCHAR(1000),
 CONSTRAINT "dock_runtime_state_check" CHECK (jsonb_typeof("dock_snapshot")='object' AND (("status"='FAULT' AND length(btrim("fault_reason"))>0) OR ("status" IN ('AVAILABLE','OCCUPIED') AND "fault_reason" IS NULL)))
);
CREATE UNIQUE INDEX "dock_runtime_tenant_dock_key" ON "ams"."dock_runtime"("tenant_id","dock_ref");
CREATE INDEX "dock_runtime_availability_idx" ON "ams"."dock_runtime"("tenant_id","warehouse_ref","status","dock_ref");

CREATE TABLE "ams"."dock_assignment" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."DockAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',"assignment_no" VARCHAR(100) NOT NULL,"appointment_id" UUID NOT NULL,"queue_ticket_id" UUID NOT NULL,"dock_ref" UUID NOT NULL,"dock_snapshot" JSONB NOT NULL,"assignment_mode" VARCHAR(20) NOT NULL,"requirement_snapshot" JSONB NOT NULL,"assigned_from" TIMESTAMPTZ(3) NOT NULL,"assigned_until" TIMESTAMPTZ(3) NOT NULL,"released_at" TIMESTAMPTZ(3),"release_reason" VARCHAR(1000),
 CONSTRAINT "dock_assignment_values_check" CHECK ("assignment_mode" IN ('AUTO','MANUAL') AND "assigned_until">"assigned_from" AND jsonb_typeof("dock_snapshot")='object' AND jsonb_typeof("requirement_snapshot")='object')
);
CREATE UNIQUE INDEX "dock_assignment_tenant_no_key" ON "ams"."dock_assignment"("tenant_id","assignment_no");
CREATE INDEX "dock_assignment_appointment_idx" ON "ams"."dock_assignment"("tenant_id","appointment_id","status","assigned_from");
CREATE INDEX "dock_assignment_dock_window_idx" ON "ams"."dock_assignment"("tenant_id","dock_ref","status","assigned_from","assigned_until");
CREATE UNIQUE INDEX "dock_assignment_one_active_appointment_key" ON "ams"."dock_assignment"("tenant_id","appointment_id") WHERE "status"='ACTIVE';
CREATE UNIQUE INDEX "dock_assignment_one_active_dock_key" ON "ams"."dock_assignment"("tenant_id","dock_ref") WHERE "status"='ACTIVE';

CREATE TABLE "ams"."dock_assignment_event" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"dock_assignment_id" UUID NOT NULL,"appointment_id" UUID NOT NULL,"event_type" VARCHAR(30) NOT NULL,"from_dock_ref" UUID,"to_dock_ref" UUID,"reason" VARCHAR(1000) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "dock_assignment_event_values_check" CHECK ("event_type" IN ('ASSIGNED','SWITCHED','RELEASED','FAULTED') AND length(btrim("reason"))>0)
);
CREATE INDEX "dock_assignment_event_appointment_idx" ON "ams"."dock_assignment_event"("tenant_id","appointment_id","occurred_at");

CREATE TRIGGER gate_verification_immutable BEFORE UPDATE OR DELETE ON "ams"."gate_verification" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER gate_access_event_immutable BEFORE UPDATE OR DELETE ON "ams"."gate_access_event" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER call_event_immutable BEFORE UPDATE OR DELETE ON "ams"."call_event" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER dock_assignment_event_immutable BEFORE UPDATE OR DELETE ON "ams"."dock_assignment_event" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
