CREATE TYPE "mdm"."ContractStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','ACTIVE','SUSPENDED','EXPIRED','INACTIVE','REJECTED');
CREATE TYPE "mdm"."RateVersionStatus" AS ENUM ('DRAFT','PUBLISHED','RETIRED');
CREATE TYPE "mdm"."CalendarStatus" AS ENUM ('DRAFT','ACTIVE','INACTIVE');
CREATE TYPE "mdm"."QualityAssessmentStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED');
CREATE TYPE "mdm"."QualityIssueStatus" AS ENUM ('OPEN','RESOLVED','WAIVED');

CREATE TABLE "mdm"."contract" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."ContractStatus" NOT NULL DEFAULT 'DRAFT',
 "code" VARCHAR(100) NOT NULL, "name" VARCHAR(300) NOT NULL, "partner_id" UUID NOT NULL, "partner_snapshot" JSONB NOT NULL, "contract_type" VARCHAR(100) NOT NULL, "effective_from" TIMESTAMPTZ(3) NOT NULL, "effective_until" TIMESTAMPTZ(3) NOT NULL, "currency" CHAR(3) NOT NULL, "terms" JSONB NOT NULL DEFAULT '{}', "approval_instance_id" UUID, "approved_at" TIMESTAMPTZ(3), "approved_by" UUID,
 CONSTRAINT "contract_values_valid" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND "effective_until" > "effective_from" AND "currency" ~ '^[A-Z]{3}$' AND "version" > 0),
 CONSTRAINT "contract_json_valid" CHECK (jsonb_typeof("partner_snapshot") = 'object' AND jsonb_typeof("terms") = 'object'),
 CONSTRAINT "contract_approval_valid" CHECK (("status" IN ('ACTIVE','SUSPENDED','EXPIRED','INACTIVE')) = ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL AND "approval_instance_id" IS NOT NULL) OR "status" IN ('DRAFT','PENDING_APPROVAL','REJECTED'))
);
CREATE TABLE "mdm"."rate_card" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE',
 "contract_id" UUID NOT NULL, "code" VARCHAR(100) NOT NULL, "name" VARCHAR(300) NOT NULL, "service_type" VARCHAR(100) NOT NULL,
 CONSTRAINT "rate_card_values_valid" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND length(btrim("service_type")) > 0 AND "version" > 0)
);
CREATE TABLE "mdm"."rate_version" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."RateVersionStatus" NOT NULL DEFAULT 'DRAFT',
 "rate_card_id" UUID NOT NULL, "version_number" INTEGER NOT NULL, "dimension_hash" CHAR(64) NOT NULL, "dimensions" JSONB NOT NULL, "base_rate" DECIMAL(24,6) NOT NULL, "currency" CHAR(3) NOT NULL, "pricing" JSONB NOT NULL DEFAULT '{}', "effective_from" TIMESTAMPTZ(3) NOT NULL, "effective_until" TIMESTAMPTZ(3) NOT NULL, "published_at" TIMESTAMPTZ(3),
 CONSTRAINT "rate_version_values_valid" CHECK ("version" > 0 AND "version_number" > 0 AND "base_rate" >= 0 AND "effective_until" > "effective_from" AND "dimension_hash" ~ '^[0-9a-f]{64}$' AND "currency" ~ '^[A-Z]{3}$'),
 CONSTRAINT "rate_version_json_valid" CHECK (jsonb_typeof("dimensions") = 'object' AND jsonb_typeof("pricing") = 'object'), CONSTRAINT "rate_version_publish_valid" CHECK (("status" = 'DRAFT' AND "published_at" IS NULL) OR ("status" <> 'DRAFT' AND "published_at" IS NOT NULL))
);
CREATE TABLE "mdm"."business_calendar" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."CalendarStatus" NOT NULL DEFAULT 'DRAFT',
 "code" VARCHAR(100) NOT NULL, "name" VARCHAR(300) NOT NULL, "time_zone" VARCHAR(100) NOT NULL, "version_number" INTEGER NOT NULL, "working_days" JSONB NOT NULL, "effective_from" DATE NOT NULL, "effective_until" DATE, "published_at" TIMESTAMPTZ(3),
 CONSTRAINT "business_calendar_values_valid" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND length(btrim("time_zone")) > 0 AND "version" > 0 AND "version_number" > 0 AND ("effective_until" IS NULL OR "effective_until" >= "effective_from")),
 CONSTRAINT "business_calendar_days_valid" CHECK (jsonb_typeof("working_days") = 'array' AND jsonb_array_length("working_days") > 0), CONSTRAINT "business_calendar_publish_valid" CHECK (("status" = 'DRAFT' AND "published_at" IS NULL) OR ("status" <> 'DRAFT' AND "published_at" IS NOT NULL))
);
CREATE TABLE "mdm"."calendar_date" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE', "calendar_id" UUID NOT NULL, "date" DATE NOT NULL, "working" BOOLEAN NOT NULL, "reason" VARCHAR(300), CONSTRAINT "calendar_date_version_positive" CHECK ("version" > 0)
);
CREATE TABLE "mdm"."shift" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE', "calendar_id" UUID NOT NULL, "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "start_time" VARCHAR(5) NOT NULL, "end_time" VARCHAR(5) NOT NULL, "crosses_midnight" BOOLEAN NOT NULL DEFAULT false,
 CONSTRAINT "shift_values_valid" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "start_time" <> "end_time" AND "version" > 0), CONSTRAINT "shift_midnight_valid" CHECK ("crosses_midnight" = ("end_time" < "start_time"))
);
CREATE TABLE "mdm"."working_window" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE', "calendar_id" UUID NOT NULL, "shift_id" UUID, "resource_type" VARCHAR(100) NOT NULL, "resource_id" UUID NOT NULL, "service_type" VARCHAR(100), "cutoff_time" VARCHAR(5), "lead_time_minutes" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "working_window_values_valid" CHECK (length(btrim("resource_type")) > 0 AND ("cutoff_time" IS NULL OR "cutoff_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND "lead_time_minutes" >= 0 AND "version" > 0)
);
CREATE TABLE "mdm"."data_quality_assessment" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."QualityAssessmentStatus" NOT NULL DEFAULT 'DRAFT', "object_type" VARCHAR(100) NOT NULL, "object_id" UUID NOT NULL, "score" DECIMAL(5,2) NOT NULL, "threshold" DECIMAL(5,2) NOT NULL, "dimensions" JSONB NOT NULL, "fulfillment_eligible" BOOLEAN NOT NULL DEFAULT false, "approval_instance_id" UUID, "assessed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "quality_assessment_values_valid" CHECK ("score" BETWEEN 0 AND 100 AND "threshold" BETWEEN 0 AND 100 AND "version" > 0 AND jsonb_typeof("dimensions") = 'object'), CONSTRAINT "quality_assessment_eligibility_valid" CHECK (NOT "fulfillment_eligible" OR ("status" = 'APPROVED' AND "score" >= "threshold"))
);
CREATE TABLE "mdm"."data_quality_issue" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."QualityIssueStatus" NOT NULL DEFAULT 'OPEN', "assessment_id" UUID NOT NULL, "dimension" VARCHAR(100) NOT NULL, "code" VARCHAR(100) NOT NULL, "message" VARCHAR(1000) NOT NULL, "severity" VARCHAR(20) NOT NULL, "resolution" VARCHAR(1000),
 CONSTRAINT "quality_issue_values_valid" CHECK (length(btrim("dimension")) > 0 AND length(btrim("code")) > 0 AND length(btrim("message")) > 0 AND "severity" IN ('INFO','WARNING','ERROR') AND "version" > 0), CONSTRAINT "quality_issue_resolution_valid" CHECK ("status" = 'OPEN' OR "resolution" IS NOT NULL)
);

CREATE UNIQUE INDEX "contract_tenant_code_key" ON "mdm"."contract"("tenant_id","code"); CREATE INDEX "contract_tenant_partner_status_idx" ON "mdm"."contract"("tenant_id","partner_id","status","effective_from");
CREATE UNIQUE INDEX "rate_card_tenant_contract_code_key" ON "mdm"."rate_card"("tenant_id","contract_id","code"); CREATE INDEX "rate_card_tenant_contract_status_idx" ON "mdm"."rate_card"("tenant_id","contract_id","status");
CREATE UNIQUE INDEX "rate_version_tenant_card_version_key" ON "mdm"."rate_version"("tenant_id","rate_card_id","version_number"); CREATE INDEX "rate_version_tenant_match_idx" ON "mdm"."rate_version"("tenant_id","rate_card_id","dimension_hash","status","effective_from");
CREATE UNIQUE INDEX "business_calendar_tenant_code_version_key" ON "mdm"."business_calendar"("tenant_id","code","version_number"); CREATE INDEX "business_calendar_tenant_lookup_idx" ON "mdm"."business_calendar"("tenant_id","code","status","effective_from");
CREATE UNIQUE INDEX "calendar_date_tenant_calendar_date_key" ON "mdm"."calendar_date"("tenant_id","calendar_id","date"); CREATE INDEX "calendar_date_tenant_date_idx" ON "mdm"."calendar_date"("tenant_id","date","working");
CREATE UNIQUE INDEX "shift_tenant_calendar_code_key" ON "mdm"."shift"("tenant_id","calendar_id","code"); CREATE INDEX "shift_tenant_calendar_status_idx" ON "mdm"."shift"("tenant_id","calendar_id","status");
CREATE INDEX "working_window_tenant_resource_idx" ON "mdm"."working_window"("tenant_id","resource_type","resource_id","status"); CREATE UNIQUE INDEX "working_window_tenant_resource_service_scope_key" ON "mdm"."working_window"("tenant_id","calendar_id","resource_type","resource_id",COALESCE("service_type",''));
CREATE INDEX "quality_assessment_tenant_object_idx" ON "mdm"."data_quality_assessment"("tenant_id","object_type","object_id","created_at"); CREATE INDEX "quality_issue_tenant_assessment_idx" ON "mdm"."data_quality_issue"("tenant_id","assessment_id","status");

CREATE OR REPLACE FUNCTION "mdm"."guard_rate_version"() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.status = 'PUBLISHED' THEN
  IF EXISTS (SELECT 1 FROM "mdm"."rate_version" r WHERE r.tenant_id=NEW.tenant_id AND r.rate_card_id=NEW.rate_card_id AND r.dimension_hash=NEW.dimension_hash AND r.status='PUBLISHED' AND r.id<>NEW.id AND tstzrange(r.effective_from,r.effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN RAISE EXCEPTION 'published rate effective range overlaps existing version' USING ERRCODE='23P01'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('PUBLISHED','RETIRED') AND (to_jsonb(OLD)-ARRAY['status','updated_at','updated_by','version'])<>(to_jsonb(NEW)-ARRAY['status','updated_at','updated_by','version']) THEN RAISE EXCEPTION 'published rate versions are immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER rate_version_guard BEFORE INSERT OR UPDATE ON "mdm"."rate_version" FOR EACH ROW EXECUTE FUNCTION "mdm"."guard_rate_version"();

CREATE OR REPLACE FUNCTION "mdm"."guard_active_calendar"() RETURNS TRIGGER AS $$ BEGIN IF OLD.status IN ('ACTIVE','INACTIVE') AND (to_jsonb(OLD)-ARRAY['status','updated_at','updated_by','version'])<>(to_jsonb(NEW)-ARRAY['status','updated_at','updated_by','version']) THEN RAISE EXCEPTION 'published calendars are immutable' USING ERRCODE='55000'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER active_calendar_guard BEFORE UPDATE ON "mdm"."business_calendar" FOR EACH ROW EXECUTE FUNCTION "mdm"."guard_active_calendar"();
