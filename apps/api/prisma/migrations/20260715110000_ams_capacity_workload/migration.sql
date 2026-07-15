CREATE TYPE "ams"."CapacityProfileStatus" AS ENUM ('DRAFT','PUBLISHED');
CREATE TYPE "ams"."CapacityCalendarStatus" AS ENUM ('GENERATED','CLOSED');
CREATE TYPE "ams"."TimeSlotStatus" AS ENUM ('OPEN','CLOSED');
CREATE TYPE "ams"."CapacityChangeType" AS ENUM ('GENERATED','CLOSED','REOPENED','EXPANDED','RESERVED_INTERNAL');
CREATE TYPE "ams"."WorkloadRuleStatus" AS ENUM ('DRAFT','PUBLISHED');
CREATE TYPE "ams"."WorkloadEstimateStatus" AS ENUM ('CALCULATED','ADJUSTED');
CREATE TYPE "ams"."AmsRecordStatus" AS ENUM ('ACTIVE');

CREATE TABLE "ams"."capacity_profile" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."CapacityProfileStatus" NOT NULL DEFAULT 'DRAFT',
 "profile_code" VARCHAR(100) NOT NULL,"revision" INTEGER NOT NULL,"warehouse_ref" UUID NOT NULL,"resource_type" VARCHAR(30) NOT NULL,"resource_ref" UUID NOT NULL,"resource_snapshot" JSONB NOT NULL,"service_type" VARCHAR(50) NOT NULL,"calendar_code" VARCHAR(100) NOT NULL,"shift_code" VARCHAR(50) NOT NULL,"shift_start_time" VARCHAR(5) NOT NULL,"shift_end_time" VARCHAR(5) NOT NULL,"slot_minutes" INTEGER NOT NULL,"lead_time_minutes" INTEGER NOT NULL,
 "capacity_quantity" DECIMAL(24,6) NOT NULL,"capacity_quantity_uom" VARCHAR(20) NOT NULL,"capacity_pallets" DECIMAL(24,6) NOT NULL,"capacity_vehicles" DECIMAL(24,6) NOT NULL,"capacity_labor_hours" DECIMAL(24,6) NOT NULL,"internal_quantity" DECIMAL(24,6) NOT NULL DEFAULT 0,"internal_pallets" DECIMAL(24,6) NOT NULL DEFAULT 0,"internal_vehicles" DECIMAL(24,6) NOT NULL DEFAULT 0,"internal_labor_hours" DECIMAL(24,6) NOT NULL DEFAULT 0,
 "effective_from" DATE NOT NULL,"effective_until" DATE,"blacklist_dates" JSONB NOT NULL DEFAULT '[]',"published_at" TIMESTAMPTZ(3),
 CONSTRAINT "capacity_profile_values_check" CHECK ("revision">0 AND "resource_type" IN ('WAREHOUSE','DOCK','ZONE','TEAM','SERVICE') AND "shift_start_time" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "shift_end_time" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "shift_start_time"<>"shift_end_time" AND "slot_minutes">0 AND "slot_minutes"<=1440 AND "lead_time_minutes">=0 AND "capacity_quantity">=0 AND "capacity_pallets">=0 AND "capacity_vehicles">=0 AND "capacity_labor_hours">=0 AND "internal_quantity">=0 AND "internal_quantity"<="capacity_quantity" AND "internal_pallets">=0 AND "internal_pallets"<="capacity_pallets" AND "internal_vehicles">=0 AND "internal_vehicles"<="capacity_vehicles" AND "internal_labor_hours">=0 AND "internal_labor_hours"<="capacity_labor_hours" AND jsonb_typeof("resource_snapshot")='object' AND jsonb_typeof("blacklist_dates")='array' AND ("effective_until" IS NULL OR "effective_until">="effective_from")),
 CONSTRAINT "capacity_profile_state_check" CHECK (("status"='DRAFT' AND "published_at" IS NULL) OR ("status"='PUBLISHED' AND "published_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "capacity_profile_tenant_code_revision_key" ON "ams"."capacity_profile"("tenant_id","profile_code","revision");
CREATE INDEX "capacity_profile_resource_status_idx" ON "ams"."capacity_profile"("tenant_id","warehouse_ref","resource_ref","service_type","status");
CREATE UNIQUE INDEX "capacity_profile_one_published_key" ON "ams"."capacity_profile"("tenant_id","profile_code") WHERE "status"='PUBLISHED';

CREATE TABLE "ams"."capacity_calendar" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."CapacityCalendarStatus" NOT NULL DEFAULT 'GENERATED',"capacity_profile_id" UUID NOT NULL,"calendar_date" DATE NOT NULL,"shift_code" VARCHAR(50) NOT NULL,"calendar_snapshot" JSONB NOT NULL,
 CONSTRAINT "capacity_calendar_values_check" CHECK (jsonb_typeof("calendar_snapshot")='object')
);
CREATE UNIQUE INDEX "capacity_calendar_profile_date_shift_key" ON "ams"."capacity_calendar"("tenant_id","capacity_profile_id","calendar_date","shift_code");
CREATE INDEX "capacity_calendar_date_status_idx" ON "ams"."capacity_calendar"("tenant_id","calendar_date","status","capacity_profile_id");

CREATE TABLE "ams"."time_slot" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."TimeSlotStatus" NOT NULL DEFAULT 'OPEN',
 "capacity_calendar_id" UUID NOT NULL,"capacity_profile_id" UUID NOT NULL,"warehouse_ref" UUID NOT NULL,"resource_type" VARCHAR(30) NOT NULL,"resource_ref" UUID NOT NULL,"service_type" VARCHAR(50) NOT NULL,"starts_at" TIMESTAMPTZ(3) NOT NULL,"ends_at" TIMESTAMPTZ(3) NOT NULL,
 "capacity_quantity" DECIMAL(24,6) NOT NULL,"capacity_quantity_uom" VARCHAR(20) NOT NULL,"capacity_pallets" DECIMAL(24,6) NOT NULL,"capacity_vehicles" DECIMAL(24,6) NOT NULL,"capacity_labor_hours" DECIMAL(24,6) NOT NULL,"internal_quantity" DECIMAL(24,6) NOT NULL DEFAULT 0,"internal_pallets" DECIMAL(24,6) NOT NULL DEFAULT 0,"internal_vehicles" DECIMAL(24,6) NOT NULL DEFAULT 0,"internal_labor_hours" DECIMAL(24,6) NOT NULL DEFAULT 0,
 "used_quantity" DECIMAL(24,6) NOT NULL DEFAULT 0,"used_pallets" DECIMAL(24,6) NOT NULL DEFAULT 0,"used_vehicles" DECIMAL(24,6) NOT NULL DEFAULT 0,"used_labor_hours" DECIMAL(24,6) NOT NULL DEFAULT 0,"reserved_quantity" DECIMAL(24,6) NOT NULL DEFAULT 0,"reserved_pallets" DECIMAL(24,6) NOT NULL DEFAULT 0,"reserved_vehicles" DECIMAL(24,6) NOT NULL DEFAULT 0,"reserved_labor_hours" DECIMAL(24,6) NOT NULL DEFAULT 0,"calendar_snapshot" JSONB NOT NULL,"closed_at" TIMESTAMPTZ(3),"close_reason" VARCHAR(1000),
 CONSTRAINT "time_slot_values_check" CHECK ("ends_at">"starts_at" AND jsonb_typeof("calendar_snapshot")='object' AND "capacity_quantity">=0 AND "capacity_pallets">=0 AND "capacity_vehicles">=0 AND "capacity_labor_hours">=0 AND "internal_quantity">=0 AND "used_quantity">=0 AND "reserved_quantity">=0 AND "internal_quantity"+"used_quantity"+"reserved_quantity"<="capacity_quantity" AND "internal_pallets">=0 AND "used_pallets">=0 AND "reserved_pallets">=0 AND "internal_pallets"+"used_pallets"+"reserved_pallets"<="capacity_pallets" AND "internal_vehicles">=0 AND "used_vehicles">=0 AND "reserved_vehicles">=0 AND "internal_vehicles"+"used_vehicles"+"reserved_vehicles"<="capacity_vehicles" AND "internal_labor_hours">=0 AND "used_labor_hours">=0 AND "reserved_labor_hours">=0 AND "internal_labor_hours"+"used_labor_hours"+"reserved_labor_hours"<="capacity_labor_hours"),
 CONSTRAINT "time_slot_state_check" CHECK (("status"='OPEN' AND "closed_at" IS NULL AND "close_reason" IS NULL) OR ("status"='CLOSED' AND "closed_at" IS NOT NULL AND length(btrim("close_reason"))>0))
);
CREATE UNIQUE INDEX "time_slot_profile_start_key" ON "ams"."time_slot"("tenant_id","capacity_profile_id","starts_at");
CREATE INDEX "time_slot_search_idx" ON "ams"."time_slot"("tenant_id","warehouse_ref","service_type","starts_at","status");
CREATE INDEX "time_slot_resource_idx" ON "ams"."time_slot"("tenant_id","resource_ref","starts_at","status");

CREATE TABLE "ams"."capacity_change" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."AmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"time_slot_id" UUID NOT NULL,"sequence" INTEGER NOT NULL,"change_type" "ams"."CapacityChangeType" NOT NULL,"before_snapshot" JSONB NOT NULL,"after_snapshot" JSONB NOT NULL,"reason" VARCHAR(1000) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "capacity_change_values_check" CHECK ("sequence">0 AND length(btrim("reason"))>0 AND jsonb_typeof("before_snapshot")='object' AND jsonb_typeof("after_snapshot")='object')
);
CREATE UNIQUE INDEX "capacity_change_slot_sequence_key" ON "ams"."capacity_change"("tenant_id","time_slot_id","sequence");
CREATE INDEX "capacity_change_slot_time_idx" ON "ams"."capacity_change"("tenant_id","time_slot_id","occurred_at");

CREATE TABLE "ams"."workload_rule" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."WorkloadRuleStatus" NOT NULL DEFAULT 'DRAFT',"rule_code" VARCHAR(100) NOT NULL,"revision" INTEGER NOT NULL,"service_type" VARCHAR(50) NOT NULL,"base_minutes" DECIMAL(18,6) NOT NULL,"per_order_line_minutes" DECIMAL(18,6) NOT NULL,"per_quantity_minutes" DECIMAL(18,6) NOT NULL,"per_pallet_minutes" DECIMAL(18,6) NOT NULL,"per_vehicle_minutes" DECIMAL(18,6) NOT NULL,"packaging_factors" JSONB NOT NULL,"loading_method_factors" JSONB NOT NULL,"historical_efficiency" DECIMAL(12,6) NOT NULL,"effective_from" TIMESTAMPTZ(3) NOT NULL,"effective_until" TIMESTAMPTZ(3),"published_at" TIMESTAMPTZ(3),
 CONSTRAINT "workload_rule_values_check" CHECK ("revision">0 AND "base_minutes">=0 AND "per_order_line_minutes">=0 AND "per_quantity_minutes">=0 AND "per_pallet_minutes">=0 AND "per_vehicle_minutes">=0 AND "historical_efficiency">0 AND jsonb_typeof("packaging_factors")='object' AND jsonb_typeof("loading_method_factors")='object' AND ("effective_until" IS NULL OR "effective_until">="effective_from")),
 CONSTRAINT "workload_rule_state_check" CHECK (("status"='DRAFT' AND "published_at" IS NULL) OR ("status"='PUBLISHED' AND "published_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "workload_rule_tenant_code_revision_key" ON "ams"."workload_rule"("tenant_id","rule_code","revision");
CREATE INDEX "workload_rule_service_status_idx" ON "ams"."workload_rule"("tenant_id","service_type","status","effective_from");
CREATE UNIQUE INDEX "workload_rule_one_published_key" ON "ams"."workload_rule"("tenant_id","rule_code") WHERE "status"='PUBLISHED';

CREATE TABLE "ams"."workload_estimate" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "ams"."WorkloadEstimateStatus" NOT NULL DEFAULT 'CALCULATED',"estimate_no" VARCHAR(100) NOT NULL,"source_ref" VARCHAR(200) NOT NULL,"workload_rule_id" UUID NOT NULL,"rule_code" VARCHAR(100) NOT NULL,"rule_revision" INTEGER NOT NULL,"original_estimate_id" UUID,"input_snapshot" JSONB NOT NULL,"quantity" DECIMAL(24,6) NOT NULL,"quantity_uom" VARCHAR(20) NOT NULL,"pallets" DECIMAL(24,6) NOT NULL,"vehicles" DECIMAL(24,6) NOT NULL,"labor_hours" DECIMAL(24,6) NOT NULL,"calculation_trace" JSONB NOT NULL,"adjustment_reason" VARCHAR(1000),
 CONSTRAINT "workload_estimate_values_check" CHECK ("quantity">=0 AND "pallets">=0 AND "vehicles">=0 AND "labor_hours">=0 AND jsonb_typeof("input_snapshot")='object' AND jsonb_typeof("calculation_trace")='object'),
 CONSTRAINT "workload_estimate_state_check" CHECK (("status"='CALCULATED' AND "original_estimate_id" IS NULL AND "adjustment_reason" IS NULL) OR ("status"='ADJUSTED' AND "original_estimate_id" IS NOT NULL AND length(btrim("adjustment_reason"))>0))
);
CREATE UNIQUE INDEX "workload_estimate_tenant_no_key" ON "ams"."workload_estimate"("tenant_id","estimate_no");
CREATE INDEX "workload_estimate_source_idx" ON "ams"."workload_estimate"("tenant_id","source_ref","created_at");
CREATE INDEX "workload_estimate_original_idx" ON "ams"."workload_estimate"("tenant_id","original_estimate_id","created_at");

CREATE OR REPLACE FUNCTION "ams".reject_capacity_fact_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'AMS facts and published rules are immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER capacity_change_immutable BEFORE UPDATE OR DELETE ON "ams"."capacity_change" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE TRIGGER workload_estimate_immutable BEFORE UPDATE OR DELETE ON "ams"."workload_estimate" FOR EACH ROW EXECUTE FUNCTION "ams".reject_capacity_fact_mutation();
CREATE OR REPLACE FUNCTION "ams".reject_published_rule_mutation() RETURNS trigger AS $$ BEGIN IF OLD.status::text='PUBLISHED' THEN RAISE EXCEPTION 'Published AMS rules are immutable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER capacity_profile_published_immutable BEFORE UPDATE OR DELETE ON "ams"."capacity_profile" FOR EACH ROW EXECUTE FUNCTION "ams".reject_published_rule_mutation();
CREATE TRIGGER workload_rule_published_immutable BEFORE UPDATE OR DELETE ON "ams"."workload_rule" FOR EACH ROW EXECUTE FUNCTION "ams".reject_published_rule_mutation();
