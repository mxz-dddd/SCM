CREATE SCHEMA IF NOT EXISTS "platform";
CREATE SCHEMA IF NOT EXISTS "mdm";
CREATE SCHEMA IF NOT EXISTS "oms";
CREATE SCHEMA IF NOT EXISTS "wms";
CREATE SCHEMA IF NOT EXISTS "tms";
CREATE SCHEMA IF NOT EXISTS "ams";
CREATE SCHEMA IF NOT EXISTS "billing";
CREATE SCHEMA IF NOT EXISTS "control";
CREATE SCHEMA IF NOT EXISTS "integration";

CREATE TYPE "platform"."BaselineStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "platform"."data_baseline" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "platform"."BaselineStatus" NOT NULL DEFAULT 'ACTIVE',
  "amount" DECIMAL(20,6) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "quantity_original" DECIMAL(20,6) NOT NULL,
  "original_uom" VARCHAR(16) NOT NULL,
  "quantity_base" DECIMAL(20,6) NOT NULL,
  "base_uom" VARCHAR(16) NOT NULL,
  "package_spec_version_id" UUID NOT NULL,
  "extension_schema_id" VARCHAR(100) NOT NULL,
  "extension_schema_version" INTEGER NOT NULL,
  "extension_fields" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "data_baseline_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_baseline_version_positive" CHECK ("version" > 0),
  CONSTRAINT "data_baseline_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "data_baseline_quantity_original_nonnegative" CHECK ("quantity_original" >= 0),
  CONSTRAINT "data_baseline_quantity_base_nonnegative" CHECK ("quantity_base" >= 0),
  CONSTRAINT "data_baseline_extension_version_positive" CHECK ("extension_schema_version" > 0),
  CONSTRAINT "data_baseline_extension_object" CHECK (jsonb_typeof("extension_fields") = 'object')
);

CREATE INDEX "data_baseline_tenant_status_idx"
  ON "platform"."data_baseline" ("tenant_id", "status");
