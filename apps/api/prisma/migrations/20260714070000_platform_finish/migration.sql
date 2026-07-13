CREATE TYPE "platform"."FeatureFlagStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'RETIRED');
CREATE TYPE "platform"."CommentVisibility" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "platform"."CommentStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "platform"."PrintTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "platform"."PrinterStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "platform"."PrintJobStatus" AS ENUM ('QUEUED', 'PRINTING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "platform"."locale_preference" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "account_id" UUID NOT NULL, "language" VARCHAR(20) NOT NULL DEFAULT 'zh-CN',
  "time_zone" VARCHAR(100) NOT NULL DEFAULT 'Asia/Shanghai', "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
  "unit_system" VARCHAR(20) NOT NULL DEFAULT 'METRIC',
  CONSTRAINT "locale_preference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform"."unit_conversion" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "code" VARCHAR(100) NOT NULL, "dimension" VARCHAR(50) NOT NULL,
  "from_uom" VARCHAR(20) NOT NULL, "to_uom" VARCHAR(20) NOT NULL,
  "factor" DECIMAL(24,12) NOT NULL, "offset" DECIMAL(24,12) NOT NULL DEFAULT 0,
  "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "effective_until" TIMESTAMPTZ(3),
  CONSTRAINT "unit_conversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_conversion_factor_positive" CHECK ("factor" > 0),
  CONSTRAINT "unit_conversion_effective_range" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from")
);

CREATE TABLE "platform"."feature_flag" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."FeatureFlagStatus" NOT NULL DEFAULT 'DRAFT',
  "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "version_number" INTEGER NOT NULL,
  "default_enabled" BOOLEAN NOT NULL DEFAULT false, "rules" JSONB NOT NULL DEFAULT '[]',
  "published_at" TIMESTAMPTZ(3),
  CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "feature_flag_rules_array" CHECK (jsonb_typeof("rules") = 'array'),
  CONSTRAINT "feature_flag_versions_positive" CHECK ("version" > 0 AND "version_number" > 0)
);

CREATE TABLE "platform"."feature_flag_decision" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "feature_flag_id" UUID NOT NULL, "flag_code" VARCHAR(100) NOT NULL, "flag_version_number" INTEGER NOT NULL,
  "subject_key" VARCHAR(200) NOT NULL, "organization_id" UUID, "role_codes" JSONB NOT NULL DEFAULT '[]',
  "bucket" INTEGER NOT NULL, "enabled" BOOLEAN NOT NULL, "matched_rule" VARCHAR(100),
  CONSTRAINT "feature_flag_decision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "feature_flag_decision_bucket" CHECK ("bucket" BETWEEN 0 AND 99),
  CONSTRAINT "feature_flag_decision_roles_array" CHECK (jsonb_typeof("role_codes") = 'array')
);

CREATE TABLE "platform"."business_comment" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."CommentStatus" NOT NULL DEFAULT 'OPEN',
  "business_type" VARCHAR(100) NOT NULL, "business_id" UUID NOT NULL,
  "visibility" "platform"."CommentVisibility" NOT NULL DEFAULT 'INTERNAL', "body" VARCHAR(4000) NOT NULL,
  "attachment_ids" JSONB NOT NULL DEFAULT '[]', "resolved_at" TIMESTAMPTZ(3), "resolved_by" UUID,
  CONSTRAINT "business_comment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_comment_body_present" CHECK (length(btrim("body")) > 0),
  CONSTRAINT "business_comment_attachments_array" CHECK (jsonb_typeof("attachment_ids") = 'array')
);

CREATE TABLE "platform"."comment_mention" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "comment_id" UUID NOT NULL, "mentioned_account_id" UUID NOT NULL,
  CONSTRAINT "comment_mention_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform"."print_template" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."PrintTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "document_type" VARCHAR(100) NOT NULL,
  "language" VARCHAR(20) NOT NULL, "version_number" INTEGER NOT NULL, "customer_id" UUID, "warehouse_id" UUID,
  "route_tags" JSONB NOT NULL DEFAULT '[]', "content" JSONB NOT NULL, "variables" JSONB NOT NULL DEFAULT '[]',
  "published_at" TIMESTAMPTZ(3),
  CONSTRAINT "print_template_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_template_arrays" CHECK (jsonb_typeof("route_tags") = 'array' AND jsonb_typeof("variables") = 'array'),
  CONSTRAINT "print_template_content_object" CHECK (jsonb_typeof("content") = 'object'),
  CONSTRAINT "print_template_versions_positive" CHECK ("version" > 0 AND "version_number" > 0)
);

CREATE TABLE "platform"."printer" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."PrinterStatus" NOT NULL DEFAULT 'ACTIVE',
  "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "warehouse_id" UUID,
  "route_tags" JSONB NOT NULL DEFAULT '[]', "endpoint_ref" VARCHAR(300) NOT NULL,
  CONSTRAINT "printer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "printer_route_tags_array" CHECK (jsonb_typeof("route_tags") = 'array')
);

CREATE TABLE "platform"."print_job" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."PrintJobStatus" NOT NULL DEFAULT 'QUEUED',
  "print_template_id" UUID NOT NULL, "template_version_number" INTEGER NOT NULL, "template_snapshot" JSONB NOT NULL,
  "document_type" VARCHAR(100) NOT NULL, "business_id" UUID NOT NULL, "copies" INTEGER NOT NULL DEFAULT 1,
  "label_data" JSONB NOT NULL, "printer_id" UUID, "route_snapshot" JSONB NOT NULL DEFAULT '{}',
  "attempt" INTEGER NOT NULL DEFAULT 0, "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "lease_owner" VARCHAR(200), "lease_expires_at" TIMESTAMPTZ(3), "failure_code" VARCHAR(100),
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "print_job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_job_counts_positive" CHECK ("copies" > 0 AND "max_attempts" > 0 AND "attempt" >= 0),
  CONSTRAINT "print_job_json_objects" CHECK (jsonb_typeof("template_snapshot") = 'object' AND jsonb_typeof("label_data") = 'object' AND jsonb_typeof("route_snapshot") = 'object')
);

CREATE INDEX "locale_preference_tenant_status_idx" ON "platform"."locale_preference"("tenant_id", "status");
CREATE UNIQUE INDEX "locale_preference_tenant_account_key" ON "platform"."locale_preference"("tenant_id", "account_id");
CREATE INDEX "unit_conversion_lookup_idx" ON "platform"."unit_conversion"("tenant_id", "dimension", "from_uom", "to_uom", "status");
CREATE UNIQUE INDEX "unit_conversion_tenant_code_version_key" ON "platform"."unit_conversion"("tenant_id", "code", "version");
CREATE INDEX "feature_flag_lookup_idx" ON "platform"."feature_flag"("tenant_id", "code", "status", "version_number");
CREATE UNIQUE INDEX "feature_flag_tenant_code_version_key" ON "platform"."feature_flag"("tenant_id", "code", "version_number");
CREATE INDEX "feature_flag_decision_tenant_flag_idx" ON "platform"."feature_flag_decision"("tenant_id", "flag_code", "created_at");
CREATE INDEX "business_comment_thread_idx" ON "platform"."business_comment"("tenant_id", "business_type", "business_id", "created_at");
CREATE INDEX "comment_mention_account_idx" ON "platform"."comment_mention"("tenant_id", "mentioned_account_id", "created_at");
CREATE UNIQUE INDEX "comment_mention_tenant_comment_account_key" ON "platform"."comment_mention"("tenant_id", "comment_id", "mentioned_account_id");
CREATE INDEX "print_template_lookup_idx" ON "platform"."print_template"("tenant_id", "document_type", "language", "status");
CREATE UNIQUE INDEX "print_template_tenant_code_version_key" ON "platform"."print_template"("tenant_id", "code", "version_number");
CREATE INDEX "printer_route_idx" ON "platform"."printer"("tenant_id", "status", "warehouse_id");
CREATE UNIQUE INDEX "printer_tenant_code_key" ON "platform"."printer"("tenant_id", "code");
CREATE INDEX "print_job_tenant_status_created_idx" ON "platform"."print_job"("tenant_id", "status", "created_at");
CREATE INDEX "print_job_printer_status_idx" ON "platform"."print_job"("tenant_id", "printer_id", "status");

CREATE TRIGGER feature_flag_decision_immutable BEFORE UPDATE OR DELETE ON "platform"."feature_flag_decision"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();
CREATE TRIGGER comment_mention_immutable BEFORE UPDATE OR DELETE ON "platform"."comment_mention"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();

CREATE OR REPLACE FUNCTION "platform"."reject_published_platform_definition_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status::text IN ('PUBLISHED', 'RETIRED') AND
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'updated_by', 'version', 'published_at']) <>
     (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'updated_by', 'version', 'published_at']) THEN
    RAISE EXCEPTION 'published platform definitions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER feature_flag_published_immutable BEFORE UPDATE OR DELETE ON "platform"."feature_flag"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_published_platform_definition_mutation"();
CREATE TRIGGER print_template_published_immutable BEFORE UPDATE OR DELETE ON "platform"."print_template"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_published_platform_definition_mutation"();
