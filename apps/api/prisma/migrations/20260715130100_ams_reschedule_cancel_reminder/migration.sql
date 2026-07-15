ALTER TABLE "ams"."appointment" DROP CONSTRAINT "appointment_state_check";
ALTER TABLE "ams"."appointment" ADD CONSTRAINT "appointment_state_check" CHECK (("status"='DRAFT' AND "submitted_at" IS NULL AND "decided_at" IS NULL) OR ("status" IN ('SUBMITTED','PENDING') AND "submitted_at" IS NOT NULL AND "decided_at" IS NULL) OR ("status" IN ('CONFIRMED','REJECTED','CANCELLED') AND "submitted_at" IS NOT NULL AND "decided_at" IS NOT NULL));
CREATE TYPE "ams"."ReminderScheduleStatus" AS ENUM ('SCHEDULED','SENT','CANCELLED');

CREATE TABLE "ams"."reschedule_record" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"appointment_id" UUID NOT NULL,"sequence" INTEGER NOT NULL,"old_time_slot_id" UUID NOT NULL,"new_time_slot_id" UUID NOT NULL,"old_reservation_id" UUID NOT NULL,"new_reservation_id" UUID NOT NULL,"old_slot_version" INTEGER NOT NULL,"new_slot_version" INTEGER NOT NULL,"workload_snapshot" JSONB NOT NULL,"reason" VARCHAR(1000) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "reschedule_record_values_check" CHECK ("sequence">0 AND "old_time_slot_id"<>"new_time_slot_id" AND "old_reservation_id"<>"new_reservation_id" AND "old_slot_version">0 AND "new_slot_version">0 AND length(btrim("reason"))>0 AND jsonb_typeof("workload_snapshot")='object')
);
CREATE UNIQUE INDEX "reschedule_record_sequence_key" ON "ams"."reschedule_record"("tenant_id","appointment_id","sequence");
CREATE INDEX "reschedule_record_time_idx" ON "ams"."reschedule_record"("tenant_id","appointment_id","occurred_at");

CREATE TABLE "ams"."appointment_cancellation" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"appointment_id" UUID NOT NULL,"reservation_id" UUID NOT NULL,"reason" VARCHAR(1000) NOT NULL,"requested_at" TIMESTAMPTZ(3) NOT NULL,"lead_minutes" INTEGER NOT NULL,"policy_snapshot" JSONB NOT NULL,"fee_amount" DECIMAL(24,6) NOT NULL,"fee_currency" CHAR(3) NOT NULL,"notification_snapshot" JSONB NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "appointment_cancellation_values_check" CHECK (length(btrim("reason"))>0 AND "lead_minutes">=0 AND "fee_amount">=0 AND "fee_currency" ~ '^[A-Z]{3}$' AND jsonb_typeof("policy_snapshot")='object' AND jsonb_typeof("notification_snapshot")='object')
);
CREATE UNIQUE INDEX "appointment_cancellation_appointment_key" ON "ams"."appointment_cancellation"("tenant_id","appointment_id");
CREATE INDEX "appointment_cancellation_time_idx" ON "ams"."appointment_cancellation"("tenant_id","occurred_at","appointment_id");

CREATE TABLE "ams"."reminder_schedule" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."ReminderScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',"appointment_id" UUID NOT NULL,"reminder_type" VARCHAR(50) NOT NULL,"channel" VARCHAR(30) NOT NULL,"scheduled_at" TIMESTAMPTZ(3) NOT NULL,"payload_snapshot" JSONB NOT NULL,"dispatch_key" VARCHAR(200) NOT NULL,"sent_at" TIMESTAMPTZ(3),"cancelled_at" TIMESTAMPTZ(3),"cancel_reason" VARCHAR(1000),
 CONSTRAINT "reminder_schedule_values_check" CHECK (jsonb_typeof("payload_snapshot")='object'),
 CONSTRAINT "reminder_schedule_state_check" CHECK (("status"='SCHEDULED' AND "sent_at" IS NULL AND "cancelled_at" IS NULL) OR ("status"='SENT' AND "sent_at" IS NOT NULL AND "cancelled_at" IS NULL) OR ("status"='CANCELLED' AND "sent_at" IS NULL AND "cancelled_at" IS NOT NULL AND length(btrim("cancel_reason"))>0))
);
CREATE UNIQUE INDEX "reminder_schedule_dispatch_key" ON "ams"."reminder_schedule"("tenant_id","dispatch_key");
CREATE INDEX "reminder_schedule_due_idx" ON "ams"."reminder_schedule"("tenant_id","status","scheduled_at","appointment_id");

CREATE TRIGGER reschedule_record_immutable BEFORE UPDATE OR DELETE ON "ams"."reschedule_record" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER appointment_cancellation_immutable BEFORE UPDATE OR DELETE ON "ams"."appointment_cancellation" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
