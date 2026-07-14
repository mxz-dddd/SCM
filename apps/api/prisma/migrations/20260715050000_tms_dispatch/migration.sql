-- CreateEnum
CREATE TYPE "tms"."VehicleAssignmentStatus" AS ENUM ('ASSIGNED', 'DISPATCHED', 'REVOKED');

-- CreateEnum
CREATE TYPE "tms"."ComplianceCheckStatus" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "tms"."TransportComplianceExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "tms"."ShipmentDispatchStatus" AS ENUM ('CONFIRMED');

-- CreateTable
CREATE TABLE "tms"."vehicle_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."VehicleAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignment_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "carrier_tender_id" UUID NOT NULL,
    "vehicle_ref" UUID NOT NULL,
    "driver_ref" UUID NOT NULL,
    "vehicle_snapshot" JSONB NOT NULL,
    "driver_snapshot" JSONB NOT NULL,
    "backup_contact_snapshot" JSONB NOT NULL,
    "requirement_snapshot" JSONB NOT NULL,
    "eligibility_snapshot" JSONB NOT NULL,
    "schedule_from" TIMESTAMPTZ(3) NOT NULL,
    "schedule_to" TIMESTAMPTZ(3) NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(500),

    CONSTRAINT "vehicle_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."compliance_check" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."ComplianceCheckStatus" NOT NULL,
    "check_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "vehicle_assignment_id" UUID NOT NULL,
    "assignment_version" INTEGER NOT NULL,
    "checklist_snapshot" JSONB NOT NULL,
    "failure_reasons" JSONB NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_by" UUID NOT NULL,

    CONSTRAINT "compliance_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."transport_compliance_exception" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."TransportComplianceExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "shipment_id" UUID NOT NULL,
    "vehicle_assignment_id" UUID NOT NULL,
    "compliance_check_id" UUID NOT NULL,
    "exception_code" VARCHAR(100) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "evidence_snapshot" JSONB NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "resolution" VARCHAR(500),

    CONSTRAINT "transport_compliance_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tms"."shipment_dispatch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "tms"."ShipmentDispatchStatus" NOT NULL DEFAULT 'CONFIRMED',
    "dispatch_no" VARCHAR(100) NOT NULL,
    "shipment_id" UUID NOT NULL,
    "vehicle_assignment_id" UUID NOT NULL,
    "compliance_check_id" UUID NOT NULL,
    "assignment_snapshot" JSONB NOT NULL,
    "load_snapshot" JSONB NOT NULL,
    "seal_snapshot" JSONB NOT NULL,
    "document_snapshot" JSONB NOT NULL,
    "actual_departure_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by" UUID NOT NULL,

    CONSTRAINT "shipment_dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_assignment_tenant_shipment_status_idx" ON "tms"."vehicle_assignment"("tenant_id", "shipment_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "vehicle_assignment_tenant_vehicle_schedule_idx" ON "tms"."vehicle_assignment"("tenant_id", "vehicle_ref", "status", "schedule_from", "schedule_to");

-- CreateIndex
CREATE INDEX "vehicle_assignment_tenant_driver_schedule_idx" ON "tms"."vehicle_assignment"("tenant_id", "driver_ref", "status", "schedule_from", "schedule_to");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_assignment_tenant_no_key" ON "tms"."vehicle_assignment"("tenant_id", "assignment_no");

-- CreateIndex
CREATE INDEX "compliance_check_tenant_assignment_status_idx" ON "tms"."compliance_check"("tenant_id", "vehicle_assignment_id", "status", "checked_at");

-- CreateIndex
CREATE INDEX "compliance_check_tenant_shipment_status_idx" ON "tms"."compliance_check"("tenant_id", "shipment_id", "status", "checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_check_tenant_no_key" ON "tms"."compliance_check"("tenant_id", "check_no");

-- CreateIndex
CREATE INDEX "transport_compliance_exception_tenant_shipment_idx" ON "tms"."transport_compliance_exception"("tenant_id", "shipment_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "transport_compliance_exception_tenant_assignment_idx" ON "tms"."transport_compliance_exception"("tenant_id", "vehicle_assignment_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "shipment_dispatch_tenant_departure_idx" ON "tms"."shipment_dispatch"("tenant_id", "actual_departure_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_dispatch_tenant_no_key" ON "tms"."shipment_dispatch"("tenant_id", "dispatch_no");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_dispatch_tenant_shipment_key" ON "tms"."shipment_dispatch"("tenant_id", "shipment_id");

CREATE UNIQUE INDEX "vehicle_assignment_active_shipment_key" ON "tms"."vehicle_assignment"("tenant_id","shipment_id") WHERE "status" IN ('ASSIGNED','DISPATCHED');

ALTER TABLE "tms"."vehicle_assignment" ADD CONSTRAINT "vehicle_assignment_values_valid" CHECK ("version">0 AND "schedule_to">"schedule_from" AND jsonb_typeof("vehicle_snapshot")='object' AND jsonb_typeof("driver_snapshot")='object' AND jsonb_typeof("backup_contact_snapshot")='object' AND jsonb_typeof("requirement_snapshot")='object' AND jsonb_typeof("eligibility_snapshot")='object' AND ("status"<>'REVOKED' OR ("revoked_at" IS NOT NULL AND length(btrim("revoke_reason"))>0)));
ALTER TABLE "tms"."compliance_check" ADD CONSTRAINT "compliance_check_values_valid" CHECK ("version">0 AND "assignment_version">0 AND jsonb_typeof("checklist_snapshot")='object' AND jsonb_typeof("failure_reasons")='array' AND (("status"='PASSED' AND jsonb_array_length("failure_reasons")=0) OR ("status"='FAILED' AND jsonb_array_length("failure_reasons")>0)));
ALTER TABLE "tms"."transport_compliance_exception" ADD CONSTRAINT "transport_compliance_exception_values_valid" CHECK ("version">0 AND length(btrim("exception_code"))>0 AND length(btrim("message"))>0 AND jsonb_typeof("evidence_snapshot")='object' AND ("status"<>'RESOLVED' OR ("resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL AND length(btrim("resolution"))>0)));
ALTER TABLE "tms"."shipment_dispatch" ADD CONSTRAINT "shipment_dispatch_values_valid" CHECK ("version">0 AND "actual_departure_at"<="confirmed_at" AND jsonb_typeof("assignment_snapshot")='object' AND jsonb_typeof("load_snapshot")='object' AND jsonb_typeof("seal_snapshot")='object' AND jsonb_typeof("document_snapshot")='object');

CREATE TRIGGER "compliance_check_immutable" BEFORE UPDATE OR DELETE ON "tms"."compliance_check" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
CREATE TRIGGER "shipment_dispatch_immutable" BEFORE UPDATE OR DELETE ON "tms"."shipment_dispatch" FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
