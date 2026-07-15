CREATE TYPE "integration"."IntegrationRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "integration"."GatewayPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "integration"."IntegrationCredentialType" AS ENUM ('OAUTH2_CLIENT', 'API_KEY', 'HMAC', 'MTLS');
CREATE TYPE "integration"."IntegrationCredentialStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED');
CREATE TYPE "integration"."ApiDefinitionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED', 'RETIRED');
CREATE TYPE "integration"."GatewayDecisionOutcome" AS ENUM ('ALLOWED', 'REJECTED');

CREATE TABLE "integration"."gateway_policy" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."GatewayPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "route_pattern" VARCHAR(300) NOT NULL,
  "required_scopes" JSONB NOT NULL DEFAULT '[]', "allowed_ips" JSONB NOT NULL DEFAULT '[]',
  "max_request_bytes" INTEGER NOT NULL DEFAULT 1048576, "per_minute_limit" INTEGER NOT NULL DEFAULT 60,
  "daily_limit" INTEGER NOT NULL DEFAULT 10000, "sensitive_daily_limit" INTEGER NOT NULL DEFAULT 1000,
  "activated_at" TIMESTAMPTZ(3), "retired_at" TIMESTAMPTZ(3),
  CONSTRAINT "gateway_policy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gateway_policy_limits_check" CHECK ("max_request_bytes" > 0 AND "per_minute_limit" > 0 AND "daily_limit" > 0 AND "sensitive_daily_limit" > 0 AND "sensitive_daily_limit" <= "daily_limit")
);
CREATE UNIQUE INDEX "integration_gateway_policy_code_key" ON "integration"."gateway_policy"("tenant_id", "code");
CREATE INDEX "integration_gateway_policy_route_idx" ON "integration"."gateway_policy"("tenant_id", "status", "route_pattern");

CREATE TABLE "integration"."api_credential" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."IntegrationCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "credential_type" "integration"."IntegrationCredentialType" NOT NULL, "name" VARCHAR(200) NOT NULL,
  "key_id" VARCHAR(100) NOT NULL, "secret_hash" CHAR(64), "certificate_fingerprint" VARCHAR(128),
  "scopes" JSONB NOT NULL DEFAULT '[]', "allowed_ips" JSONB NOT NULL DEFAULT '[]',
  "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "valid_until" TIMESTAMPTZ(3),
  "rotated_to_credential_id" UUID, "last_used_at" TIMESTAMPTZ(3),
  CONSTRAINT "api_credential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_api_credential_material_check" CHECK (("credential_type" = 'MTLS' AND "certificate_fingerprint" IS NOT NULL AND "secret_hash" IS NULL) OR ("credential_type" <> 'MTLS' AND "secret_hash" IS NOT NULL)),
  CONSTRAINT "integration_api_credential_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from")
);
CREATE UNIQUE INDEX "integration_api_credential_key_id_key" ON "integration"."api_credential"("tenant_id", "key_id");
CREATE INDEX "integration_api_credential_type_status_idx" ON "integration"."api_credential"("tenant_id", "credential_type", "status");

CREATE TABLE "integration"."access_token" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."IntegrationCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "credential_id" UUID NOT NULL, "token_hash" CHAR(64) NOT NULL, "scopes" JSONB NOT NULL DEFAULT '[]',
  "expires_at" TIMESTAMPTZ(3) NOT NULL, "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "access_token_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_access_token_hash_key" ON "integration"."access_token"("tenant_id", "token_hash");
CREATE INDEX "integration_access_token_credential_idx" ON "integration"."access_token"("tenant_id", "credential_id", "status");

CREATE TABLE "integration"."gateway_usage_bucket" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "policy_id" UUID NOT NULL, "credential_id" UUID NOT NULL, "bucket_kind" VARCHAR(20) NOT NULL,
  "bucket_start" TIMESTAMPTZ(3) NOT NULL, "request_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "gateway_usage_bucket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gateway_usage_bucket_values_check" CHECK ("bucket_kind" IN ('MINUTE', 'DAY') AND "request_count" >= 0)
);
CREATE UNIQUE INDEX "integration_gateway_usage_bucket_key" ON "integration"."gateway_usage_bucket"("tenant_id", "policy_id", "credential_id", "bucket_kind", "bucket_start");
CREATE INDEX "integration_gateway_usage_credential_idx" ON "integration"."gateway_usage_bucket"("tenant_id", "credential_id", "bucket_start");

CREATE TABLE "integration"."rate_limit_decision" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "policy_id" UUID NOT NULL, "credential_id" UUID NOT NULL, "correlation_id" VARCHAR(100) NOT NULL,
  "route" VARCHAR(300) NOT NULL, "outcome" "integration"."GatewayDecisionOutcome" NOT NULL,
  "reason_code" VARCHAR(100) NOT NULL, "minute_count" INTEGER NOT NULL, "daily_count" INTEGER NOT NULL,
  "applied_limit" INTEGER NOT NULL, "sensitive" BOOLEAN NOT NULL DEFAULT false,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_limit_decision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "integration_rate_limit_decision_credential_idx" ON "integration"."rate_limit_decision"("tenant_id", "credential_id", "decided_at");
CREATE INDEX "integration_rate_limit_decision_outcome_idx" ON "integration"."rate_limit_decision"("tenant_id", "outcome", "decided_at");

CREATE TABLE "integration"."gateway_log" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "credential_id" UUID NOT NULL, "policy_id" UUID NOT NULL, "correlation_id" VARCHAR(100) NOT NULL,
  "route" VARCHAR(300) NOT NULL, "method" VARCHAR(10) NOT NULL,
  "auth_type" "integration"."IntegrationCredentialType" NOT NULL, "ip_address" VARCHAR(64) NOT NULL,
  "request_bytes" INTEGER NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "outcome" "integration"."GatewayDecisionOutcome" NOT NULL, "reason_code" VARCHAR(100) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gateway_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "integration_gateway_log_correlation_idx" ON "integration"."gateway_log"("tenant_id", "correlation_id", "occurred_at");
CREATE INDEX "integration_gateway_log_credential_idx" ON "integration"."gateway_log"("tenant_id", "credential_id", "occurred_at");

CREATE TABLE "integration"."api_definition" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."ApiDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "name" VARCHAR(100) NOT NULL, "title" VARCHAR(200) NOT NULL, "route_base" VARCHAR(200) NOT NULL,
  CONSTRAINT "api_definition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_api_definition_name_key" ON "integration"."api_definition"("tenant_id", "name");
CREATE INDEX "integration_api_definition_status_idx" ON "integration"."api_definition"("tenant_id", "status", "updated_at");

CREATE TABLE "integration"."api_definition_version" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "integration"."ApiDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "definition_id" UUID NOT NULL, "semantic_version" VARCHAR(30) NOT NULL, "major_version" INTEGER NOT NULL,
  "breaking_change" BOOLEAN NOT NULL DEFAULT false, "specification" JSONB NOT NULL,
  "examples" JSONB NOT NULL, "error_codes" JSONB NOT NULL, "spec_hash" CHAR(64) NOT NULL,
  "published_at" TIMESTAMPTZ(3), "deprecated_at" TIMESTAMPTZ(3),
  CONSTRAINT "api_definition_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_definition_major_check" CHECK ("major_version" > 0)
);
CREATE UNIQUE INDEX "integration_api_definition_version_key" ON "integration"."api_definition_version"("tenant_id", "definition_id", "semantic_version");
CREATE INDEX "integration_api_definition_version_status_idx" ON "integration"."api_definition_version"("tenant_id", "definition_id", "status", "major_version");

CREATE TABLE "integration"."deprecation_notice" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "definition_version_id" UUID NOT NULL, "summary" VARCHAR(1000) NOT NULL,
  "deprecation_date" TIMESTAMPTZ(3) NOT NULL, "sunset_date" TIMESTAMPTZ(3) NOT NULL,
  "replacement_version" VARCHAR(30), CONSTRAINT "deprecation_notice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deprecation_notice_dates_check" CHECK ("sunset_date" > "deprecation_date")
);
CREATE UNIQUE INDEX "integration_deprecation_notice_version_key" ON "integration"."deprecation_notice"("tenant_id", "definition_version_id");
CREATE INDEX "integration_deprecation_notice_dates_idx" ON "integration"."deprecation_notice"("tenant_id", "deprecation_date", "sunset_date");

CREATE OR REPLACE FUNCTION "integration"."reject_gateway_fact_mutation"()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'integration gateway facts are immutable' USING ERRCODE = '55000'; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "integration"."guard_api_definition_version"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status IN ('PUBLISHED', 'DEPRECATED', 'RETIRED') AND (to_jsonb(OLD) - ARRAY['status','deprecated_at','updated_at','updated_by','version']) <> (to_jsonb(NEW) - ARRAY['status','deprecated_at','updated_at','updated_by','version'])) THEN
    RAISE EXCEPTION 'published API definition versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "integration_rate_limit_decision_immutable" BEFORE UPDATE OR DELETE ON "integration"."rate_limit_decision" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_gateway_fact_mutation"();
CREATE TRIGGER "integration_gateway_log_immutable" BEFORE UPDATE OR DELETE ON "integration"."gateway_log" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_gateway_fact_mutation"();
CREATE TRIGGER "integration_deprecation_notice_immutable" BEFORE UPDATE OR DELETE ON "integration"."deprecation_notice" FOR EACH ROW EXECUTE FUNCTION "integration"."reject_gateway_fact_mutation"();
CREATE TRIGGER "integration_api_definition_version_guard" BEFORE UPDATE OR DELETE ON "integration"."api_definition_version" FOR EACH ROW EXECUTE FUNCTION "integration"."guard_api_definition_version"();
