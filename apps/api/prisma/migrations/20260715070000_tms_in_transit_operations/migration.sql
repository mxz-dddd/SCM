CREATE TYPE "tms"."ShipmentMapProjectionStatus" AS ENUM ('ACTIVE', 'STALE', 'ARCHIVED');
CREATE TYPE "tms"."TransportExceptionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "tms"."TransportExceptionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "tms"."ExceptionActionStatus" AS ENUM ('RECORDED');
CREATE TYPE "tms"."EscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED');
CREATE TYPE "tms"."ShipmentAppointmentLinkStatus" AS ENUM ('REQUESTED', 'LINKED', 'RESCHEDULE_REQUESTED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'FAILED');

CREATE TABLE "tms"."shipment_map_projection" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."ShipmentMapProjectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "shipment_id" UUID NOT NULL,
  "shipment_status" "tms"."ShipmentStatus" NOT NULL,
  "route_snapshot" JSONB NOT NULL,
  "milestone_snapshot" JSONB NOT NULL,
  "position_snapshot" JSONB NOT NULL,
  "eta_snapshot" JSONB NOT NULL,
  "exception_snapshot" JSONB NOT NULL,
  "vehicle_snapshot" JSONB NOT NULL,
  "driver_restricted_snapshot" JSONB NOT NULL,
  "source_versions" JSONB NOT NULL,
  "projected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_map_projection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipment_map_projection_json_check" CHECK (
    jsonb_typeof("route_snapshot") = 'object' AND
    jsonb_typeof("milestone_snapshot") = 'array' AND
    jsonb_typeof("position_snapshot") = 'object' AND
    jsonb_typeof("eta_snapshot") = 'object' AND
    jsonb_typeof("exception_snapshot") = 'array' AND
    jsonb_typeof("vehicle_snapshot") = 'object' AND
    jsonb_typeof("driver_restricted_snapshot") = 'object' AND
    jsonb_typeof("source_versions") = 'object'
  )
);

CREATE TABLE "tms"."transport_exception" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."TransportExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "tms"."TransportExceptionSeverity" NOT NULL,
  "exception_no" VARCHAR(100) NOT NULL,
  "shipment_id" UUID NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "dedupe_key" VARCHAR(300) NOT NULL,
  "detected_by" VARCHAR(50) NOT NULL,
  "detected_at" TIMESTAMPTZ(3) NOT NULL,
  "evidence_snapshot" JSONB NOT NULL,
  "financial_hold" BOOLEAN NOT NULL DEFAULT false,
  "reassign_requested" BOOLEAN NOT NULL DEFAULT false,
  "owner_id" UUID,
  "sla_due_at" TIMESTAMPTZ(3) NOT NULL,
  "acknowledged_at" TIMESTAMPTZ(3),
  "resolved_at" TIMESTAMPTZ(3),
  "closed_at" TIMESTAMPTZ(3),
  "resolution_summary" VARCHAR(1000),
  "root_cause" VARCHAR(1000),
  "customer_communicated_at" TIMESTAMPTZ(3),
  "business_verified" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "transport_exception_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transport_exception_type_check" CHECK ("type" IN ('DELAY','ROUTE_DEVIATION','LONG_STOP','TEMPERATURE','DAMAGE','REFUSAL','COMPLIANCE','COMMUNICATION_LOSS')),
  CONSTRAINT "transport_exception_detector_check" CHECK ("detected_by" IN ('SYSTEM','DRIVER','SERVICE')),
  CONSTRAINT "transport_exception_sla_check" CHECK ("sla_due_at" >= "detected_at"),
  CONSTRAINT "transport_exception_json_check" CHECK (jsonb_typeof("evidence_snapshot") = 'object'),
  CONSTRAINT "transport_exception_state_check" CHECK (
    ("status" = 'OPEN' AND "acknowledged_at" IS NULL AND "resolved_at" IS NULL AND "closed_at" IS NULL) OR
    ("status" IN ('ACKNOWLEDGED','IN_PROGRESS') AND "acknowledged_at" IS NOT NULL AND "resolved_at" IS NULL AND "closed_at" IS NULL) OR
    ("status" = 'RESOLVED' AND "acknowledged_at" IS NOT NULL AND "resolved_at" IS NOT NULL AND "closed_at" IS NULL) OR
    ("status" = 'CLOSED' AND "acknowledged_at" IS NOT NULL AND "resolved_at" IS NOT NULL AND "closed_at" IS NOT NULL AND "business_verified" AND "root_cause" IS NOT NULL AND "customer_communicated_at" IS NOT NULL)
  )
);

CREATE TABLE "tms"."exception_action" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."ExceptionActionStatus" NOT NULL DEFAULT 'RECORDED',
  "transport_exception_id" UUID NOT NULL,
  "action_type" VARCHAR(50) NOT NULL,
  "from_status" "tms"."TransportExceptionStatus" NOT NULL,
  "to_status" "tms"."TransportExceptionStatus" NOT NULL,
  "owner_id" UUID,
  "handling_plan" VARCHAR(2000) NOT NULL,
  "expected_recovery_at" TIMESTAMPTZ(3),
  "root_cause" VARCHAR(1000),
  "evidence_snapshot" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_action_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exception_action_type_check" CHECK ("action_type" IN ('ACKNOWLEDGE','PLAN','UPDATE','RESOLVE','CLOSE')),
  CONSTRAINT "exception_action_json_check" CHECK (jsonb_typeof("evidence_snapshot") = 'object')
);

CREATE TABLE "tms"."escalation" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."EscalationStatus" NOT NULL DEFAULT 'OPEN',
  "transport_exception_id" UUID NOT NULL,
  "level" INTEGER NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "from_owner_id" UUID,
  "to_owner_id" UUID,
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "escalated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "escalation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "escalation_level_check" CHECK ("level" > 0 AND "due_at" >= "escalated_at")
);

CREATE TABLE "tms"."shipment_appointment_link" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."ShipmentAppointmentLinkStatus" NOT NULL DEFAULT 'REQUESTED',
  "shipment_id" UUID NOT NULL,
  "milestone_id" UUID NOT NULL,
  "request_ref" VARCHAR(200) NOT NULL,
  "appointment_ref" VARCHAR(200),
  "planned_at" TIMESTAMPTZ(3) NOT NULL,
  "site_requirement_snapshot" JSONB NOT NULL,
  "appointment_snapshot" JSONB NOT NULL DEFAULT '{}',
  "source_version" INTEGER,
  "linked_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  CONSTRAINT "shipment_appointment_link_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipment_appointment_link_json_check" CHECK (jsonb_typeof("site_requirement_snapshot") = 'object' AND jsonb_typeof("appointment_snapshot") = 'object'),
  CONSTRAINT "shipment_appointment_link_state_check" CHECK (
    ("status" IN ('REQUESTED','RESCHEDULE_REQUESTED','CANCELLATION_REQUESTED','FAILED') AND "cancelled_at" IS NULL) OR
    ("status" = 'LINKED' AND "appointment_ref" IS NOT NULL AND "linked_at" IS NOT NULL AND "cancelled_at" IS NULL) OR
    ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)
  )
);

CREATE INDEX "shipment_map_projection_workbench_idx" ON "tms"."shipment_map_projection"("tenant_id", "shipment_status", "projected_at");
CREATE UNIQUE INDEX "shipment_map_projection_tenant_shipment_key" ON "tms"."shipment_map_projection"("tenant_id", "shipment_id");
CREATE INDEX "transport_exception_shipment_idx" ON "tms"."transport_exception"("tenant_id", "shipment_id", "status", "severity");
CREATE INDEX "transport_exception_sla_idx" ON "tms"."transport_exception"("tenant_id", "status", "sla_due_at");
CREATE UNIQUE INDEX "transport_exception_tenant_no_key" ON "tms"."transport_exception"("tenant_id", "exception_no");
CREATE UNIQUE INDEX "transport_exception_active_dedupe_key" ON "tms"."transport_exception"("tenant_id", "dedupe_key") WHERE "status" IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS');
CREATE INDEX "exception_action_timeline_idx" ON "tms"."exception_action"("tenant_id", "transport_exception_id", "occurred_at", "id");
CREATE INDEX "escalation_due_idx" ON "tms"."escalation"("tenant_id", "status", "due_at");
CREATE UNIQUE INDEX "escalation_exception_level_key" ON "tms"."escalation"("tenant_id", "transport_exception_id", "level");
CREATE INDEX "shipment_appointment_link_shipment_idx" ON "tms"."shipment_appointment_link"("tenant_id", "shipment_id", "milestone_id", "status");
CREATE UNIQUE INDEX "shipment_appointment_link_request_key" ON "tms"."shipment_appointment_link"("tenant_id", "request_ref");
CREATE UNIQUE INDEX "shipment_appointment_link_active_milestone_key" ON "tms"."shipment_appointment_link"("tenant_id", "shipment_id", "milestone_id") WHERE "status" IN ('REQUESTED','LINKED','RESCHEDULE_REQUESTED','CANCELLATION_REQUESTED');

CREATE TRIGGER exception_action_immutable BEFORE UPDATE OR DELETE ON "tms"."exception_action" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER escalation_immutable BEFORE UPDATE OR DELETE ON "tms"."escalation" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
