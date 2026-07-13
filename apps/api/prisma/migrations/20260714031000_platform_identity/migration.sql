-- Depends on 20260714024500_data_baseline, which creates the domain schemas.
-- CreateEnum
CREATE TYPE "platform"."TenantStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "platform"."RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "platform"."OrganizationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "platform"."AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LOCKED');

-- CreateEnum
CREATE TYPE "platform"."AccountKind" AS ENUM ('PLATFORM_ADMIN', 'TENANT_ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "platform"."IdentitySource" AS ENUM ('LOCAL', 'OIDC', 'SAML', 'DIRECTORY');

-- CreateEnum
CREATE TYPE "platform"."IsolationMode" AS ENUM ('SHARED_SCHEMA', 'DEDICATED_SCHEMA', 'DEDICATED_DATABASE');

-- CreateEnum
CREATE TYPE "platform"."CredentialStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "platform"."LoginOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "platform"."OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- AlterTable
ALTER TABLE "platform"."data_baseline" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "platform"."tenant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."TenantStatus" NOT NULL DEFAULT 'PROVISIONING',
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "default_locale" VARCHAR(16) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "isolation_mode" "platform"."IsolationMode" NOT NULL,
    "plan_capabilities" JSONB NOT NULL DEFAULT '{}',
    "permission_version" INTEGER NOT NULL DEFAULT 1,
    "suspended_reason" VARCHAR(500),
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."organization" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "parent_id" UUID,
    "path" VARCHAR(1000) NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."person" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "employee_no" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320),
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3),

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "username" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(500),
    "identity_source" "platform"."IdentitySource" NOT NULL DEFAULT 'LOCAL',
    "kind" "platform"."AccountKind" NOT NULL DEFAULT 'USER',
    "permission_version" INTEGER NOT NULL DEFAULT 1,
    "locked_until" TIMESTAMPTZ(3),
    "valid_until" TIMESTAMPTZ(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."identity_binding" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "identity_source" "platform"."IdentitySource" NOT NULL DEFAULT 'LOCAL',
    "external_subject" VARCHAR(300),

    CONSTRAINT "identity_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."service_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "code" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "permission_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."api_credential" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "service_account_id" UUID NOT NULL,
    "key_id" VARCHAR(100) NOT NULL,
    "secret_hash" VARCHAR(128) NOT NULL,
    "last_four" CHAR(4) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "api_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."login_audit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID,
    "username" VARCHAR(100) NOT NULL,
    "outcome" "platform"."LoginOutcome" NOT NULL,
    "failure_code" VARCHAR(100),
    "factors" JSONB NOT NULL DEFAULT '[]',
    "ip_address" VARCHAR(64),
    "device_id" VARCHAR(200),
    "correlation_id" VARCHAR(100) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(100) NOT NULL,
    "resource_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "correlation_id" VARCHAR(100) NOT NULL,
    "ip_address" VARCHAR(64),
    "device_id" VARCHAR(200),

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."outbox" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "event_name" VARCHAR(150) NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" VARCHAR(100) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."idempotency_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "scope" VARCHAR(150) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_body" JSONB NOT NULL,
    "response_code" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_tenant_id_key" ON "platform"."tenant"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_code_key" ON "platform"."tenant"("code");

-- CreateIndex
CREATE INDEX "tenant_tenant_status_idx" ON "platform"."tenant"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "organization_tenant_parent_idx" ON "platform"."organization"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_tenant_code_key" ON "platform"."organization"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "person_tenant_status_idx" ON "platform"."person"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "person_tenant_employee_key" ON "platform"."person"("tenant_id", "employee_no");

-- CreateIndex
CREATE INDEX "account_tenant_status_idx" ON "platform"."account"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "account_tenant_username_key" ON "platform"."account"("tenant_id", "username");

-- CreateIndex
CREATE INDEX "identity_binding_tenant_person_idx" ON "platform"."identity_binding"("tenant_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_binding_account_person_key" ON "platform"."identity_binding"("tenant_id", "account_id", "person_id");

-- CreateIndex
CREATE INDEX "service_account_tenant_status_idx" ON "platform"."service_account"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_account_tenant_code_key" ON "platform"."service_account"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "api_credential_tenant_service_status_idx" ON "platform"."api_credential"("tenant_id", "service_account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "api_credential_tenant_key_id_key" ON "platform"."api_credential"("tenant_id", "key_id");

-- CreateIndex
CREATE INDEX "login_audit_tenant_occurred_idx" ON "platform"."login_audit"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "login_audit_tenant_account_idx" ON "platform"."login_audit"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "platform_audit_tenant_resource_idx" ON "platform"."audit_log"("tenant_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "platform_audit_tenant_created_idx" ON "platform"."audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_outbox_tenant_status_created_idx" ON "platform"."outbox"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "platform_outbox_tenant_aggregate_idx" ON "platform"."outbox"("tenant_id", "aggregate_type", "aggregate_id", "aggregate_version");

-- CreateIndex
CREATE INDEX "idempotency_tenant_expires_idx" ON "platform"."idempotency_record"("tenant_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_tenant_scope_key" ON "platform"."idempotency_record"("tenant_id", "scope", "key");

-- Domain baseline checks not expressible in Prisma schema syntax.
ALTER TABLE "platform"."tenant"
  ADD CONSTRAINT "tenant_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "tenant_permission_version_positive" CHECK ("permission_version" > 0),
  ADD CONSTRAINT "tenant_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "tenant_plan_capabilities_object" CHECK (jsonb_typeof("plan_capabilities") = 'object');

ALTER TABLE "platform"."organization"
  ADD CONSTRAINT "organization_version_positive" CHECK ("version" > 0);

ALTER TABLE "platform"."person"
  ADD CONSTRAINT "person_version_positive" CHECK ("version" > 0);

ALTER TABLE "platform"."account"
  ADD CONSTRAINT "account_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "account_permission_version_positive" CHECK ("permission_version" > 0),
  ADD CONSTRAINT "account_failed_login_nonnegative" CHECK ("failed_login_count" >= 0);

ALTER TABLE "platform"."identity_binding"
  ADD CONSTRAINT "identity_binding_version_positive" CHECK ("version" > 0);

ALTER TABLE "platform"."service_account"
  ADD CONSTRAINT "service_account_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "service_account_permission_version_positive" CHECK ("permission_version" > 0);

ALTER TABLE "platform"."api_credential"
  ADD CONSTRAINT "api_credential_version_positive" CHECK ("version" > 0);

ALTER TABLE "platform"."login_audit"
  ADD CONSTRAINT "login_audit_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "login_audit_factors_array" CHECK (jsonb_typeof("factors") = 'array');

ALTER TABLE "platform"."audit_log"
  ADD CONSTRAINT "audit_log_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "audit_log_before_object" CHECK ("before" IS NULL OR jsonb_typeof("before") = 'object'),
  ADD CONSTRAINT "audit_log_after_object" CHECK ("after" IS NULL OR jsonb_typeof("after") = 'object');

ALTER TABLE "platform"."outbox"
  ADD CONSTRAINT "outbox_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "outbox_aggregate_version_positive" CHECK ("aggregate_version" > 0),
  ADD CONSTRAINT "outbox_schema_version_positive" CHECK ("schema_version" > 0),
  ADD CONSTRAINT "outbox_payload_object" CHECK (jsonb_typeof("payload") = 'object');

ALTER TABLE "platform"."idempotency_record"
  ADD CONSTRAINT "idempotency_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "idempotency_response_code_valid" CHECK ("response_code" BETWEEN 100 AND 599),
  ADD CONSTRAINT "idempotency_response_object" CHECK (jsonb_typeof("response_body") = 'object');
