CREATE TYPE "integration"."IntegrationPortalPrincipalType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'CARRIER');
CREATE TYPE "integration"."IntegrationPortalProjectionType" AS ENUM ('ORDER', 'INVENTORY', 'APPOINTMENT', 'SHIPMENT', 'DELIVERY', 'RECONCILIATION', 'MESSAGE', 'ATTACHMENT', 'TENDER', 'VEHICLE', 'DRIVER', 'TRACKING', 'POD', 'ASN');
CREATE TYPE "integration"."IntegrationPortalCommandStatus" AS ENUM ('ACCEPTED', 'DISPATCHED', 'ACKNOWLEDGED', 'FAILED');

CREATE TABLE "integration"."portal_access_grant" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "account_id" UUID NOT NULL,
  "principal_type" "integration"."IntegrationPortalPrincipalType" NOT NULL,
  "principal_ref" VARCHAR(200) NOT NULL,
  "display_name" VARCHAR(200) NOT NULL,
  "permissions" JSONB NOT NULL,
  CONSTRAINT "portal_access_grant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration"."portal_projection" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "principal_type" "integration"."IntegrationPortalPrincipalType" NOT NULL,
  "principal_ref" VARCHAR(200) NOT NULL,
  "projection_type" "integration"."IntegrationPortalProjectionType" NOT NULL,
  "projection_key" VARCHAR(200) NOT NULL,
  "business_ref" VARCHAR(200) NOT NULL,
  "source_event_id" UUID NOT NULL,
  "source_domain" VARCHAR(30) NOT NULL,
  "source_aggregate_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "portal_projection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration"."portal_command" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."IntegrationPortalCommandStatus" NOT NULL DEFAULT 'ACCEPTED',
  "account_id" UUID NOT NULL,
  "principal_type" "integration"."IntegrationPortalPrincipalType" NOT NULL,
  "principal_ref" VARCHAR(200) NOT NULL,
  "command_type" VARCHAR(100) NOT NULL,
  "target_domain" VARCHAR(30) NOT NULL,
  "business_ref" VARCHAR(200) NOT NULL,
  "payload_snapshot" JSONB NOT NULL,
  "dispatched_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "error_code" VARCHAR(100),
  "error_message" VARCHAR(1000),
  CONSTRAINT "portal_command_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_portal_access_grant_key" ON "integration"."portal_access_grant"("tenant_id", "account_id", "principal_type", "principal_ref");
CREATE INDEX "integration_portal_access_account_idx" ON "integration"."portal_access_grant"("tenant_id", "account_id", "status");
CREATE UNIQUE INDEX "integration_portal_projection_event_key" ON "integration"."portal_projection"("tenant_id", "source_event_id");
CREATE INDEX "integration_portal_projection_scope_idx" ON "integration"."portal_projection"("tenant_id", "principal_type", "principal_ref", "projection_type", "occurred_at");
CREATE INDEX "integration_portal_projection_version_idx" ON "integration"."portal_projection"("tenant_id", "principal_type", "principal_ref", "projection_key", "source_version");
CREATE INDEX "integration_portal_command_account_idx" ON "integration"."portal_command"("tenant_id", "account_id", "status", "created_at");
CREATE INDEX "integration_portal_command_scope_idx" ON "integration"."portal_command"("tenant_id", "principal_type", "principal_ref", "business_ref");

ALTER TABLE "integration"."portal_projection" ADD CONSTRAINT "integration_portal_projection_version_check" CHECK ("source_version" > 0);

CREATE TRIGGER "integration_portal_projection_immutable" BEFORE UPDATE OR DELETE ON "integration"."portal_projection" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_exchange_fact_mutation"();
