-- CreateEnum
CREATE TYPE "platform"."ConfigScopeType" AS ENUM ('TENANT', 'ORGANIZATION', 'WAREHOUSE', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "platform"."ConfigVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "platform"."ConfigPublishAction" AS ENUM ('PUBLISH', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "platform"."PublishRecordStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "platform"."SequenceResetPeriod" AS ENUM ('NEVER', 'DAILY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "platform"."config_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."ConfigVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "config_key" VARCHAR(150) NOT NULL,
    "scope_type" "platform"."ConfigScopeType" NOT NULL,
    "scope_ref" VARCHAR(100) NOT NULL,
    "version_number" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "dependency_keys" JSONB NOT NULL DEFAULT '[]',
    "rollout_percentage" INTEGER NOT NULL DEFAULT 100,
    "effective_from" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "supersedes_version_id" UUID,

    CONSTRAINT "config_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."config_publish_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."PublishRecordStatus" NOT NULL DEFAULT 'COMPLETED',
    "config_version_id" UUID NOT NULL,
    "previous_version_id" UUID,
    "action" "platform"."ConfigPublishAction" NOT NULL,
    "rollout_percentage" INTEGER NOT NULL,
    "difference" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_publish_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."business_dictionary" (
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
    "category" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "business_dictionary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."dictionary_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "dictionary_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "requires_remark" BOOLEAN NOT NULL DEFAULT false,
    "requires_attachment" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "dictionary_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."number_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "business_type" VARCHAR(100) NOT NULL,
    "organization_ref" VARCHAR(100) NOT NULL DEFAULT '*',
    "prefix_template" VARCHAR(150) NOT NULL,
    "sequence_width" INTEGER NOT NULL DEFAULT 6,
    "block_size" INTEGER NOT NULL DEFAULT 100,
    "reset_period" "platform"."SequenceResetPeriod" NOT NULL DEFAULT 'DAILY',
    "current_period_key" VARCHAR(20) NOT NULL DEFAULT '',
    "current_sequence" BIGINT NOT NULL DEFAULT 0,
    "last_allocated_at" TIMESTAMPTZ(3),

    CONSTRAINT "number_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."sequence_reservation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "number_rule_id" UUID NOT NULL,
    "period_key" VARCHAR(20) NOT NULL,
    "start_value" BIGINT NOT NULL,
    "end_value" BIGINT NOT NULL,
    "reserved_by" VARCHAR(200) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sequence_reservation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "platform"."config_version"
  ADD CONSTRAINT "config_version_values_object_check" CHECK (jsonb_typeof("values") = 'object'),
  ADD CONSTRAINT "config_version_dependencies_array_check" CHECK (jsonb_typeof("dependency_keys") = 'array'),
  ADD CONSTRAINT "config_version_rollout_check" CHECK ("rollout_percentage" BETWEEN 1 AND 100),
  ADD CONSTRAINT "config_version_number_check" CHECK ("version_number" > 0);

ALTER TABLE "platform"."config_publish_record"
  ADD CONSTRAINT "config_publish_rollout_check" CHECK ("rollout_percentage" BETWEEN 1 AND 100),
  ADD CONSTRAINT "config_publish_difference_object_check" CHECK (jsonb_typeof("difference") = 'object');

ALTER TABLE "platform"."dictionary_item"
  ADD CONSTRAINT "dictionary_item_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object');

ALTER TABLE "platform"."number_rule"
  ADD CONSTRAINT "number_rule_sequence_width_check" CHECK ("sequence_width" BETWEEN 1 AND 18),
  ADD CONSTRAINT "number_rule_block_size_check" CHECK ("block_size" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "number_rule_current_sequence_check" CHECK ("current_sequence" >= 0);

ALTER TABLE "platform"."sequence_reservation"
  ADD CONSTRAINT "sequence_reservation_range_check" CHECK ("start_value" > 0 AND "end_value" >= "start_value");

-- CreateIndex
CREATE INDEX "config_version_tenant_key_scope_status_idx" ON "platform"."config_version"("tenant_id", "config_key", "scope_type", "scope_ref", "status");

-- CreateIndex
CREATE UNIQUE INDEX "config_version_tenant_key_scope_version_key" ON "platform"."config_version"("tenant_id", "config_key", "scope_type", "scope_ref", "version_number");

-- CreateIndex
CREATE INDEX "config_publish_tenant_version_published_idx" ON "platform"."config_publish_record"("tenant_id", "config_version_id", "published_at");

-- CreateIndex
CREATE INDEX "business_dictionary_tenant_category_status_idx" ON "platform"."business_dictionary"("tenant_id", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_dictionary_tenant_code_key" ON "platform"."business_dictionary"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "dictionary_item_tenant_dictionary_status_sort_idx" ON "platform"."dictionary_item"("tenant_id", "dictionary_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_item_tenant_dictionary_code_key" ON "platform"."dictionary_item"("tenant_id", "dictionary_id", "code");

-- CreateIndex
CREATE INDEX "number_rule_tenant_status_business_idx" ON "platform"."number_rule"("tenant_id", "status", "business_type");

-- CreateIndex
CREATE UNIQUE INDEX "number_rule_tenant_business_org_key" ON "platform"."number_rule"("tenant_id", "business_type", "organization_ref");

-- CreateIndex
CREATE INDEX "sequence_reservation_tenant_rule_period_end_idx" ON "platform"."sequence_reservation"("tenant_id", "number_rule_id", "period_key", "end_value");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_reservation_tenant_rule_period_start_key" ON "platform"."sequence_reservation"("tenant_id", "number_rule_id", "period_key", "start_value");
