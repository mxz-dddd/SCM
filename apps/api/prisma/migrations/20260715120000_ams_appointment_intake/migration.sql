CREATE TYPE "ams"."AppointmentStatus" AS ENUM ('DRAFT','SUBMITTED','PENDING','CONFIRMED','REJECTED');
CREATE TYPE "ams"."AppointmentType" AS ENUM ('ORDER_LINKED','UNLINKED','RECURRING');
CREATE TYPE "ams"."AppointmentReservationStatus" AS ENUM ('ACTIVE','RELEASED');
CREATE TYPE "ams"."RecurringAppointmentStatus" AS ENUM ('ACTIVE','COMPLETED');
CREATE TYPE "ams"."AppointmentOccurrenceStatus" AS ENUM ('RESERVED','PENDING');

CREATE TABLE "ams"."appointment" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AppointmentStatus" NOT NULL DEFAULT 'DRAFT',"appointment_no" VARCHAR(100) NOT NULL,"type" "ams"."AppointmentType" NOT NULL,"warehouse_ref" UUID NOT NULL,"requester_party_ref" VARCHAR(200) NOT NULL,"requester_snapshot" JSONB NOT NULL,"service_type" VARCHAR(50) NOT NULL,"time_slot_id" UUID NOT NULL,"workload_estimate_id" UUID,"workload_quantity" DECIMAL(24,6) NOT NULL,"workload_quantity_uom" VARCHAR(20) NOT NULL,"workload_pallets" DECIMAL(24,6) NOT NULL,"workload_vehicles" DECIMAL(24,6) NOT NULL,"workload_labor_hours" DECIMAL(24,6) NOT NULL,"vehicle_snapshot" JSONB NOT NULL,"requested_window_from" TIMESTAMPTZ(3) NOT NULL,"requested_window_to" TIMESTAMPTZ(3) NOT NULL,"urgent" BOOLEAN NOT NULL DEFAULT false,"approval_policy_snapshot" JSONB NOT NULL,"recurring_appointment_id" UUID,"submitted_at" TIMESTAMPTZ(3),"decided_at" TIMESTAMPTZ(3),
 CONSTRAINT "appointment_values_check" CHECK ("requested_window_to">"requested_window_from" AND "workload_quantity">=0 AND "workload_pallets">=0 AND "workload_vehicles">=0 AND "workload_labor_hours">=0 AND jsonb_typeof("requester_snapshot")='object' AND jsonb_typeof("vehicle_snapshot")='object' AND jsonb_typeof("approval_policy_snapshot")='object'),
 CONSTRAINT "appointment_state_check" CHECK (("status"='DRAFT' AND "submitted_at" IS NULL AND "decided_at" IS NULL) OR ("status" IN ('SUBMITTED','PENDING') AND "submitted_at" IS NOT NULL AND "decided_at" IS NULL) OR ("status" IN ('CONFIRMED','REJECTED') AND "submitted_at" IS NOT NULL AND "decided_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "appointment_tenant_no_key" ON "ams"."appointment"("tenant_id","appointment_no");
CREATE INDEX "appointment_search_idx" ON "ams"."appointment"("tenant_id","warehouse_ref","service_type","status","requested_window_from");
CREATE INDEX "appointment_requester_idx" ON "ams"."appointment"("tenant_id","requester_party_ref","status","created_at");

CREATE TABLE "ams"."appointment_order_link" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"appointment_id" UUID NOT NULL,"source_type" VARCHAR(50) NOT NULL,"source_ref" VARCHAR(200) NOT NULL,"source_line_ref" VARCHAR(200) NOT NULL,"source_snapshot" JSONB NOT NULL,"quantity" DECIMAL(24,6) NOT NULL,"quantity_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,6) NOT NULL,"quantity_base_uom" VARCHAR(20) NOT NULL,"bookable_quantity_base" DECIMAL(24,6) NOT NULL,"package_spec_snapshot" JSONB NOT NULL,
 CONSTRAINT "appointment_order_link_values_check" CHECK ("quantity">0 AND "quantity_base">0 AND "bookable_quantity_base">=0 AND "quantity_base"<="bookable_quantity_base" AND jsonb_typeof("source_snapshot")='object' AND jsonb_typeof("package_spec_snapshot")='object')
);
CREATE UNIQUE INDEX "appointment_order_link_appointment_line_key" ON "ams"."appointment_order_link"("tenant_id","appointment_id","source_type","source_ref","source_line_ref");
CREATE INDEX "appointment_order_link_source_idx" ON "ams"."appointment_order_link"("tenant_id","source_type","source_ref","source_line_ref");

CREATE TABLE "ams"."capacity_reservation" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AppointmentReservationStatus" NOT NULL DEFAULT 'ACTIVE',"appointment_id" UUID NOT NULL,"time_slot_id" UUID NOT NULL,"slot_version_at_reserve" INTEGER NOT NULL,"allocation_type" VARCHAR(20) NOT NULL,"quantity" DECIMAL(24,6) NOT NULL,"pallets" DECIMAL(24,6) NOT NULL,"vehicles" DECIMAL(24,6) NOT NULL,"labor_hours" DECIMAL(24,6) NOT NULL,"released_at" TIMESTAMPTZ(3),"release_reason" VARCHAR(1000),
 CONSTRAINT "appointment_capacity_reservation_values_check" CHECK ("slot_version_at_reserve">0 AND "allocation_type" IN ('USED','RESERVED') AND "quantity">=0 AND "pallets">=0 AND "vehicles">=0 AND "labor_hours">=0),
 CONSTRAINT "appointment_capacity_reservation_state_check" CHECK (("status"='ACTIVE' AND "released_at" IS NULL AND "release_reason" IS NULL) OR ("status"='RELEASED' AND "released_at" IS NOT NULL AND length(btrim("release_reason"))>0))
);
CREATE INDEX "capacity_reservation_appointment_status_idx" ON "ams"."capacity_reservation"("tenant_id","appointment_id","status");
CREATE INDEX "capacity_reservation_slot_idx" ON "ams"."capacity_reservation"("tenant_id","time_slot_id","status","created_at");
CREATE UNIQUE INDEX "capacity_reservation_one_active_key" ON "ams"."capacity_reservation"("tenant_id","appointment_id") WHERE "status"='ACTIVE';

CREATE TABLE "ams"."appointment_decision" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"appointment_id" UUID NOT NULL,"sequence" INTEGER NOT NULL,"from_status" "ams"."AppointmentStatus" NOT NULL,"to_status" "ams"."AppointmentStatus" NOT NULL,"decision" VARCHAR(50) NOT NULL,"reason" VARCHAR(1000) NOT NULL,"suggested_time_slot_id" UUID,"policy_snapshot" JSONB NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "appointment_decision_values_check" CHECK ("sequence">0 AND length(btrim("reason"))>0 AND jsonb_typeof("policy_snapshot")='object')
);
CREATE UNIQUE INDEX "appointment_decision_sequence_key" ON "ams"."appointment_decision"("tenant_id","appointment_id","sequence");
CREATE INDEX "appointment_decision_time_idx" ON "ams"."appointment_decision"("tenant_id","appointment_id","occurred_at");

CREATE TABLE "ams"."recurring_appointment" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."RecurringAppointmentStatus" NOT NULL DEFAULT 'ACTIVE',"recurring_no" VARCHAR(100) NOT NULL,"warehouse_ref" UUID NOT NULL,"requester_party_ref" VARCHAR(200) NOT NULL,"requester_snapshot" JSONB NOT NULL,"service_type" VARCHAR(50) NOT NULL,"weekdays" JSONB NOT NULL,"interval_weeks" INTEGER NOT NULL,"effective_from" DATE NOT NULL,"effective_until" DATE NOT NULL,"slot_start_time" VARCHAR(5) NOT NULL,"workload_snapshot" JSONB NOT NULL,"vehicle_snapshot" JSONB NOT NULL,
 CONSTRAINT "recurring_appointment_values_check" CHECK ("effective_until">="effective_from" AND "effective_until"-"effective_from"<=366 AND "interval_weeks" BETWEEN 1 AND 52 AND "slot_start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND jsonb_typeof("weekdays")='array' AND jsonb_array_length("weekdays")>0 AND jsonb_typeof("requester_snapshot")='object' AND jsonb_typeof("workload_snapshot")='object' AND jsonb_typeof("vehicle_snapshot")='object')
);
CREATE UNIQUE INDEX "recurring_appointment_tenant_no_key" ON "ams"."recurring_appointment"("tenant_id","recurring_no");
CREATE INDEX "recurring_appointment_search_idx" ON "ams"."recurring_appointment"("tenant_id","warehouse_ref","service_type","status","effective_from");

CREATE TABLE "ams"."appointment_occurrence" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AppointmentOccurrenceStatus" NOT NULL DEFAULT 'PENDING',"recurring_appointment_id" UUID NOT NULL,"occurrence_date" DATE NOT NULL,"appointment_id" UUID,"time_slot_id" UUID,"conflict_reason" VARCHAR(1000),
 CONSTRAINT "appointment_occurrence_state_check" CHECK (("status"='RESERVED' AND "appointment_id" IS NOT NULL AND "time_slot_id" IS NOT NULL AND "conflict_reason" IS NULL) OR ("status"='PENDING' AND "appointment_id" IS NULL AND length(btrim("conflict_reason"))>0))
);
CREATE UNIQUE INDEX "appointment_occurrence_date_key" ON "ams"."appointment_occurrence"("tenant_id","recurring_appointment_id","occurrence_date");
CREATE INDEX "appointment_occurrence_search_idx" ON "ams"."appointment_occurrence"("tenant_id","occurrence_date","status","recurring_appointment_id");

CREATE TRIGGER appointment_order_link_immutable BEFORE UPDATE OR DELETE ON "ams"."appointment_order_link" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER appointment_decision_immutable BEFORE UPDATE OR DELETE ON "ams"."appointment_decision" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER appointment_occurrence_immutable BEFORE UPDATE OR DELETE ON "ams"."appointment_occurrence" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
