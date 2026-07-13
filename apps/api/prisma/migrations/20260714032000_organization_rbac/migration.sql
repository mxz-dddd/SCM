-- PLT-002/PLT-005 organization hierarchy and role-based access control.
-- CreateEnum
CREATE TYPE "platform"."OrganizationType" AS ENUM ('GROUP', 'LEGAL_ENTITY', 'BUSINESS_UNIT', 'WAREHOUSE', 'TRANSPORT');

-- CreateEnum
CREATE TYPE "platform"."PathRebuildStatus" AS ENUM ('CURRENT', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "platform"."PermissionResourceType" AS ENUM ('MENU', 'PAGE', 'API', 'BUTTON', 'FIELD', 'EXPORT');

-- CreateEnum
CREATE TYPE "platform"."PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "platform"."PermissionDecision" AS ENUM ('ALLOW', 'DENY');

-- AlterTable: preserve existing organization rows and map the P1-03 ROOT value.
ALTER TABLE "platform"."organization"
  ADD COLUMN "path_rebuild_status" "platform"."PathRebuildStatus" NOT NULL DEFAULT 'CURRENT';
ALTER TABLE "platform"."organization"
  ALTER COLUMN "type" TYPE "platform"."OrganizationType"
  USING (
    CASE
      WHEN "type" = 'ROOT' THEN 'GROUP'::"platform"."OrganizationType"
      ELSE "type"::text::"platform"."OrganizationType"
    END
  );

-- CreateTable
CREATE TABLE "platform"."role" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "template_role_id" UUID,
    "is_template" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."permission" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "code" VARCHAR(150) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "resource_type" "platform"."PermissionResourceType" NOT NULL,
    "resource_ref" VARCHAR(300) NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."role_permission" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "effect" "platform"."PermissionEffect" NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."account_role" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "organization_id" UUID,

    CONSTRAINT "account_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."permission_decision_audit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "permission_code" VARCHAR(150) NOT NULL,
    "organization_id" UUID,
    "decision" "platform"."PermissionDecision" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "correlation_id" VARCHAR(100) NOT NULL,
    "resource_ref" VARCHAR(300),

    CONSTRAINT "permission_decision_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_tenant_template_idx" ON "platform"."role"("tenant_id", "template_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_code_key" ON "platform"."role"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "permission_tenant_resource_type_idx" ON "platform"."permission"("tenant_id", "resource_type");

-- CreateIndex
CREATE UNIQUE INDEX "permission_tenant_code_key" ON "platform"."permission"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "role_permission_tenant_permission_effect_idx" ON "platform"."role_permission"("tenant_id", "permission_id", "effect");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_tenant_role_permission_key" ON "platform"."role_permission"("tenant_id", "role_id", "permission_id");

-- CreateIndex
CREATE INDEX "account_role_tenant_account_status_idx" ON "platform"."account_role"("tenant_id", "account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "account_role_tenant_account_role_org_key" ON "platform"."account_role"("tenant_id", "account_id", "role_id", "organization_id");

-- PostgreSQL treats NULL values as distinct in a regular unique index. This
-- partial index prevents duplicate tenant-wide role assignments.
CREATE UNIQUE INDEX "account_role_tenant_account_role_global_key" ON "platform"."account_role"("tenant_id", "account_id", "role_id") WHERE "organization_id" IS NULL;

-- CreateIndex
CREATE INDEX "permission_decision_tenant_account_created_idx" ON "platform"."permission_decision_audit"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "permission_decision_tenant_permission_decision_idx" ON "platform"."permission_decision_audit"("tenant_id", "permission_code", "decision");
