ALTER TABLE "tms"."capacity_pool" ADD COLUMN "vehicle_ref" UUID;
CREATE INDEX "capacity_pool_vehicle_availability_idx" ON "tms"."capacity_pool"("tenant_id","vehicle_ref","service_date","status");

CREATE TYPE "tms"."MaintenancePlanStatus" AS ENUM ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE "tms"."VehicleAvailabilityStatus" AS ENUM ('ACTIVE','RELEASED');
CREATE TYPE "tms"."ConditionAlertStatus" AS ENUM ('OPEN','ACKNOWLEDGED','RESOLVED');
CREATE TYPE "tms"."TelemetryMetricType" AS ENUM ('TEMPERATURE','HUMIDITY','DOOR','DEVICE_ALERT');
CREATE TYPE "tms"."TrackingTokenStatus" AS ENUM ('ACTIVE','REVOKED','EXPIRED');

CREATE TABLE "tms"."maintenance_plan" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."MaintenancePlanStatus" NOT NULL DEFAULT 'PLANNED',"plan_no" VARCHAR(100) NOT NULL,"vehicle_ref" UUID NOT NULL,"maintenance_type" VARCHAR(50) NOT NULL,"planned_from" TIMESTAMPTZ(3) NOT NULL,"planned_to" TIMESTAMPTZ(3) NOT NULL,"odometer" DECIMAL(18,3) NOT NULL,"detail_snapshot" JSONB NOT NULL,"started_at" TIMESTAMPTZ(3),"completed_at" TIMESTAMPTZ(3),"cancelled_at" TIMESTAMPTZ(3),
 CONSTRAINT "maintenance_plan_values_check" CHECK ("planned_to">"planned_from" AND "odometer">=0 AND jsonb_typeof("detail_snapshot")='object'),
 CONSTRAINT "maintenance_plan_state_check" CHECK (("status"='PLANNED' AND "started_at" IS NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL) OR ("status"='IN_PROGRESS' AND "started_at" IS NOT NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL) OR ("status"='COMPLETED' AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL) OR ("status"='CANCELLED' AND "completed_at" IS NULL AND "cancelled_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "maintenance_plan_tenant_no_key" ON "tms"."maintenance_plan"("tenant_id","plan_no");
CREATE INDEX "maintenance_plan_vehicle_idx" ON "tms"."maintenance_plan"("tenant_id","vehicle_ref","status","planned_from");

CREATE TABLE "tms"."maintenance_event" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"maintenance_plan_id" UUID NOT NULL,"from_status" "tms"."MaintenancePlanStatus" NOT NULL,"to_status" "tms"."MaintenancePlanStatus" NOT NULL,"reason" VARCHAR(1000) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "maintenance_event_plan_idx" ON "tms"."maintenance_event"("tenant_id","maintenance_plan_id","occurred_at");

CREATE TABLE "tms"."vehicle_availability" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."VehicleAvailabilityStatus" NOT NULL DEFAULT 'ACTIVE',"vehicle_ref" UUID NOT NULL,"maintenance_plan_id" UUID NOT NULL,"unavailable_from" TIMESTAMPTZ(3) NOT NULL,"unavailable_to" TIMESTAMPTZ(3) NOT NULL,"reason" VARCHAR(1000) NOT NULL,"affected_pool_ids" JSONB NOT NULL,"released_at" TIMESTAMPTZ(3),
 CONSTRAINT "vehicle_availability_values_check" CHECK ("unavailable_to">"unavailable_from" AND jsonb_typeof("affected_pool_ids")='array' AND (("status"='ACTIVE' AND "released_at" IS NULL) OR ("status"='RELEASED' AND "released_at" IS NOT NULL)))
);
CREATE UNIQUE INDEX "vehicle_availability_plan_key" ON "tms"."vehicle_availability"("tenant_id","maintenance_plan_id");
CREATE INDEX "vehicle_availability_window_idx" ON "tms"."vehicle_availability"("tenant_id","vehicle_ref","status","unavailable_from","unavailable_to");
CREATE UNIQUE INDEX "vehicle_availability_active_window_key" ON "tms"."vehicle_availability"("tenant_id","vehicle_ref","unavailable_from","unavailable_to") WHERE "status"='ACTIVE';

CREATE TABLE "tms"."vehicle_operating_fact" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"fact_no" VARCHAR(100) NOT NULL,"vehicle_ref" UUID NOT NULL,"fact_type" VARCHAR(50) NOT NULL,"value" DECIMAL(24,6) NOT NULL,"uom" VARCHAR(20) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL,"source_ref" VARCHAR(200) NOT NULL,"detail_snapshot" JSONB NOT NULL,
 CONSTRAINT "vehicle_operating_fact_values_check" CHECK ("value">=0 AND "fact_type" IN ('ODOMETER','FUEL','MAINTENANCE','REPAIR','INSPECTION') AND jsonb_typeof("detail_snapshot")='object')
);
CREATE UNIQUE INDEX "vehicle_operating_fact_tenant_no_key" ON "tms"."vehicle_operating_fact"("tenant_id","fact_no");
CREATE UNIQUE INDEX "vehicle_operating_fact_source_key" ON "tms"."vehicle_operating_fact"("tenant_id","vehicle_ref","fact_type","source_ref");
CREATE INDEX "vehicle_operating_fact_vehicle_idx" ON "tms"."vehicle_operating_fact"("tenant_id","vehicle_ref","occurred_at");

CREATE TABLE "tms"."telemetry" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"shipment_id" UUID NOT NULL,"device_ref" VARCHAR(200) NOT NULL,"external_message_id" VARCHAR(200) NOT NULL,"content_hash" CHAR(64) NOT NULL,"metric_type" "tms"."TelemetryMetricType" NOT NULL,"value" DECIMAL(24,6),"uom" VARCHAR(20),"observed_at" TIMESTAMPTZ(3) NOT NULL,"payload_snapshot" JSONB NOT NULL,"retention_until" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "telemetry_values_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$' AND "retention_until">"observed_at" AND jsonb_typeof("payload_snapshot")='object' AND (("metric_type" IN ('TEMPERATURE','HUMIDITY') AND "value" IS NOT NULL AND "uom" IS NOT NULL) OR "metric_type" IN ('DOOR','DEVICE_ALERT')))
);
CREATE UNIQUE INDEX "telemetry_device_message_key" ON "tms"."telemetry"("tenant_id","device_ref","external_message_id");
CREATE INDEX "telemetry_shipment_metric_idx" ON "tms"."telemetry"("tenant_id","shipment_id","metric_type","observed_at");
CREATE INDEX "telemetry_retention_idx" ON "tms"."telemetry"("tenant_id","retention_until");

CREATE TABLE "tms"."condition_alert" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."ConditionAlertStatus" NOT NULL DEFAULT 'OPEN',"alert_no" VARCHAR(100) NOT NULL,"telemetry_id" UUID NOT NULL,"shipment_id" UUID NOT NULL,"transport_exception_id" UUID,"alert_type" VARCHAR(50) NOT NULL,"severity" "tms"."TransportExceptionSeverity" NOT NULL,"threshold_snapshot" JSONB NOT NULL,"evidence_snapshot" JSONB NOT NULL,"acknowledged_at" TIMESTAMPTZ(3),"resolved_at" TIMESTAMPTZ(3),"resolution" VARCHAR(1000),
 CONSTRAINT "condition_alert_values_check" CHECK (jsonb_typeof("threshold_snapshot")='object' AND jsonb_typeof("evidence_snapshot")='object'),
 CONSTRAINT "condition_alert_state_check" CHECK (("status"='OPEN' AND "acknowledged_at" IS NULL AND "resolved_at" IS NULL) OR ("status"='ACKNOWLEDGED' AND "acknowledged_at" IS NOT NULL AND "resolved_at" IS NULL) OR ("status"='RESOLVED' AND "acknowledged_at" IS NOT NULL AND "resolved_at" IS NOT NULL AND length(btrim("resolution"))>0))
);
CREATE UNIQUE INDEX "condition_alert_tenant_no_key" ON "tms"."condition_alert"("tenant_id","alert_no");
CREATE UNIQUE INDEX "condition_alert_telemetry_key" ON "tms"."condition_alert"("tenant_id","telemetry_id");
CREATE INDEX "condition_alert_shipment_idx" ON "tms"."condition_alert"("tenant_id","shipment_id","status","created_at");

CREATE TABLE "tms"."transport_metric" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"run_id" UUID NOT NULL,"metric_code" VARCHAR(100) NOT NULL,"dimension_type" VARCHAR(50) NOT NULL,"dimension_value" VARCHAR(300) NOT NULL,"value" DECIMAL(24,6) NOT NULL,"uom" VARCHAR(20) NOT NULL,"period_from" TIMESTAMPTZ(3) NOT NULL,"period_to" TIMESTAMPTZ(3) NOT NULL,"dimension_snapshot" JSONB NOT NULL,"calculation_trace" JSONB NOT NULL,
 CONSTRAINT "transport_metric_values_check" CHECK ("period_to">="period_from" AND jsonb_typeof("dimension_snapshot")='object' AND jsonb_typeof("calculation_trace")='object')
);
CREATE UNIQUE INDEX "transport_metric_run_dimension_key" ON "tms"."transport_metric"("tenant_id","run_id","metric_code","dimension_type","dimension_value");
CREATE INDEX "transport_metric_drilldown_idx" ON "tms"."transport_metric"("tenant_id","metric_code","dimension_type","period_from");

CREATE TABLE "tms"."tracking_access_token" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."TrackingTokenStatus" NOT NULL DEFAULT 'ACTIVE',"shipment_id" UUID NOT NULL,"token_hash" CHAR(64) NOT NULL,"audience_snapshot" JSONB NOT NULL,"allow_pod" BOOLEAN NOT NULL DEFAULT false,"expires_at" TIMESTAMPTZ(3) NOT NULL,"max_views" INTEGER NOT NULL,"view_count" INTEGER NOT NULL DEFAULT 0,"last_viewed_at" TIMESTAMPTZ(3),"revoked_at" TIMESTAMPTZ(3),"revoke_reason" VARCHAR(1000),
 CONSTRAINT "tracking_access_token_values_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("audience_snapshot")='object' AND "max_views">0 AND "view_count">=0 AND "view_count"<="max_views"),
 CONSTRAINT "tracking_access_token_state_check" CHECK (("status"='ACTIVE' AND "revoked_at" IS NULL) OR ("status"='REVOKED' AND "revoked_at" IS NOT NULL AND length(btrim("revoke_reason"))>0) OR "status"='EXPIRED')
);
CREATE UNIQUE INDEX "tracking_access_token_hash_key" ON "tms"."tracking_access_token"("tenant_id","token_hash");
CREATE INDEX "tracking_access_token_shipment_idx" ON "tms"."tracking_access_token"("tenant_id","shipment_id","status","expires_at");

CREATE TABLE "tms"."public_tracking_access_log" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"tracking_access_token_id" UUID NOT NULL,"shipment_id" UUID NOT NULL,"access_sequence" INTEGER NOT NULL,"ip_hash" CHAR(64),"accessed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "public_tracking_access_values_check" CHECK ("access_sequence">0 AND ("ip_hash" IS NULL OR "ip_hash" ~ '^[0-9a-f]{64}$'))
);
CREATE UNIQUE INDEX "public_tracking_access_sequence_key" ON "tms"."public_tracking_access_log"("tenant_id","tracking_access_token_id","access_sequence");
CREATE INDEX "public_tracking_access_shipment_idx" ON "tms"."public_tracking_access_log"("tenant_id","shipment_id","accessed_at");

CREATE TRIGGER maintenance_event_immutable BEFORE UPDATE OR DELETE ON "tms"."maintenance_event" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER vehicle_operating_fact_immutable BEFORE UPDATE OR DELETE ON "tms"."vehicle_operating_fact" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER telemetry_immutable BEFORE UPDATE OR DELETE ON "tms"."telemetry" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER transport_metric_immutable BEFORE UPDATE OR DELETE ON "tms"."transport_metric" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER public_tracking_access_log_immutable BEFORE UPDATE OR DELETE ON "tms"."public_tracking_access_log" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
