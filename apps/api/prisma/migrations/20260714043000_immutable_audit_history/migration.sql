-- CreateEnum
CREATE TYPE "platform"."AuditCategory" AS ENUM ('LOGIN', 'SENSITIVE_QUERY', 'EXPORT', 'APPROVAL', 'API_CALL', 'BUSINESS_CHANGE', 'SECURITY');

-- CreateEnum
CREATE TYPE "platform"."AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- AlterTable
ALTER TABLE "platform"."audit_log" ADD COLUMN     "business_ref" VARCHAR(200),
ADD COLUMN     "category" "platform"."AuditCategory" NOT NULL DEFAULT 'BUSINESS_CHANGE',
ADD COLUMN     "exported_fields" JSONB,
ADD COLUMN     "outcome" "platform"."AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "query_criteria" JSONB,
ADD COLUMN     "request_method" VARCHAR(16),
ADD COLUMN     "request_path" VARCHAR(500),
ADD COLUMN     "result_count" INTEGER;

-- CreateTable
CREATE TABLE "platform"."change_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "audit_log_id" UUID NOT NULL,
    "resource_type" VARCHAR(100) NOT NULL,
    "resource_id" UUID NOT NULL,
    "business_ref" VARCHAR(200),
    "action" VARCHAR(100) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "changed_fields" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "correlation_id" VARCHAR(100) NOT NULL,
    "ip_address" VARCHAR(64),
    "device_id" VARCHAR(200),
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "platform"."audit_log"
  ADD CONSTRAINT "platform_audit_query_criteria_object_check"
    CHECK ("query_criteria" IS NULL OR jsonb_typeof("query_criteria") = 'object'),
  ADD CONSTRAINT "platform_audit_exported_fields_array_check"
    CHECK ("exported_fields" IS NULL OR jsonb_typeof("exported_fields") = 'array'),
  ADD CONSTRAINT "platform_audit_result_count_check"
    CHECK ("result_count" IS NULL OR "result_count" >= 0);

ALTER TABLE "platform"."change_history"
  ADD CONSTRAINT "change_history_changed_fields_array_check"
    CHECK (jsonb_typeof("changed_fields") = 'array');

INSERT INTO "platform"."change_history" (
  "id", "tenant_id", "created_at", "created_by", "updated_at", "updated_by",
  "version", "status", "audit_log_id", "resource_type", "resource_id",
  "business_ref", "action", "before", "after", "changed_fields", "actor_id",
  "correlation_id", "ip_address", "device_id", "changed_at"
)
SELECT
  gen_random_uuid(), audit."tenant_id", audit."created_at", audit."created_by",
  audit."created_at", audit."updated_by", 1, 'ACTIVE'::"platform"."RecordStatus",
  audit."id", audit."resource_type", audit."resource_id", audit."business_ref",
  audit."action", audit."before", audit."after",
  COALESCE((
    SELECT jsonb_agg(keys.key ORDER BY keys.key)
    FROM jsonb_object_keys(
      COALESCE(audit."before", '{}'::jsonb) || COALESCE(audit."after", '{}'::jsonb)
    ) AS keys(key)
    WHERE (audit."before" -> keys.key) IS DISTINCT FROM (audit."after" -> keys.key)
  ), '[]'::jsonb),
  audit."created_by", audit."correlation_id", audit."ip_address", audit."device_id",
  audit."created_at"
FROM "platform"."audit_log" AS audit
WHERE audit."before" IS NOT NULL OR audit."after" IS NOT NULL;

CREATE FUNCTION "platform"."capture_change_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_fields jsonb;
BEGIN
  IF NEW."before" IS NULL AND NEW."after" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_agg(keys.key ORDER BY keys.key), '[]'::jsonb)
  INTO changed_fields
  FROM jsonb_object_keys(
    COALESCE(NEW."before", '{}'::jsonb) || COALESCE(NEW."after", '{}'::jsonb)
  ) AS keys(key)
  WHERE (NEW."before" -> keys.key) IS DISTINCT FROM (NEW."after" -> keys.key);

  INSERT INTO "platform"."change_history" (
    "id", "tenant_id", "created_at", "created_by", "updated_at", "updated_by",
    "version", "status", "audit_log_id", "resource_type", "resource_id",
    "business_ref", "action", "before", "after", "changed_fields", "actor_id",
    "correlation_id", "ip_address", "device_id", "changed_at"
  ) VALUES (
    gen_random_uuid(), NEW."tenant_id", NEW."created_at", NEW."created_by",
    NEW."created_at", NEW."updated_by", 1, 'ACTIVE'::"platform"."RecordStatus",
    NEW."id", NEW."resource_type", NEW."resource_id", NEW."business_ref",
    NEW."action", NEW."before", NEW."after", changed_fields, NEW."created_by",
    NEW."correlation_id", NEW."ip_address", NEW."device_id", NEW."created_at"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "audit_log_capture_change_history"
AFTER INSERT ON "platform"."audit_log"
FOR EACH ROW EXECUTE FUNCTION "platform"."capture_change_history"();

CREATE FUNCTION "platform"."reject_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit records are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_log_immutable"
BEFORE UPDATE OR DELETE ON "platform"."audit_log"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();

CREATE TRIGGER "change_history_immutable"
BEFORE UPDATE OR DELETE ON "platform"."change_history"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();

-- CreateIndex
CREATE UNIQUE INDEX "change_history_audit_log_key" ON "platform"."change_history"("audit_log_id");

-- CreateIndex
CREATE INDEX "change_history_tenant_resource_changed_idx" ON "platform"."change_history"("tenant_id", "resource_type", "resource_id", "changed_at");

-- CreateIndex
CREATE INDEX "change_history_tenant_business_changed_idx" ON "platform"."change_history"("tenant_id", "business_ref", "changed_at");

-- CreateIndex
CREATE INDEX "change_history_tenant_actor_changed_idx" ON "platform"."change_history"("tenant_id", "actor_id", "changed_at");

-- CreateIndex
CREATE INDEX "platform_audit_tenant_category_created_idx" ON "platform"."audit_log"("tenant_id", "category", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_tenant_business_created_idx" ON "platform"."audit_log"("tenant_id", "business_ref", "created_at");
