-- CreateEnum
CREATE TYPE "platform"."RuleSetStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "platform"."RuleEvaluationMode" AS ENUM ('SIMULATION', 'EXECUTION');

-- CreateEnum
CREATE TYPE "platform"."RuleEvaluationOutcome" AS ENUM ('MATCHED', 'NO_MATCH');

-- CreateTable
CREATE TABLE "platform"."rule_set" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RuleSetStatus" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "scenario" VARCHAR(50) NOT NULL,
    "version_number" INTEGER NOT NULL,
    "description" VARCHAR(500),
    "effective_from" TIMESTAMPTZ(3),
    "effective_to" TIMESTAMPTZ(3),
    "supersedes_version_id" UUID,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "rule_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."rule_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "rule_set_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "priority" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "stop_on_match" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rule_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."evaluation_trace" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "rule_set_id" UUID NOT NULL,
    "rule_set_code" VARCHAR(100) NOT NULL,
    "rule_set_version_number" INTEGER NOT NULL,
    "scenario" VARCHAR(50) NOT NULL,
    "mode" "platform"."RuleEvaluationMode" NOT NULL,
    "outcome" "platform"."RuleEvaluationOutcome" NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "candidate_snapshot" JSONB NOT NULL,
    "evaluated_rules" JSONB NOT NULL,
    "matched_rule_ids" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL,
    "decision" JSONB NOT NULL,
    "correlation_id" VARCHAR(100) NOT NULL,

    CONSTRAINT "evaluation_trace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rule_set_tenant_scenario_status_version_idx" ON "platform"."rule_set"("tenant_id", "scenario", "status", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "rule_set_tenant_code_version_key" ON "platform"."rule_set"("tenant_id", "code", "version_number");

-- CreateIndex
CREATE INDEX "rule_definition_tenant_set_enabled_priority_idx" ON "platform"."rule_definition"("tenant_id", "rule_set_id", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "rule_definition_tenant_set_code_key" ON "platform"."rule_definition"("tenant_id", "rule_set_id", "code");

-- CreateIndex
CREATE INDEX "evaluation_trace_tenant_scenario_created_idx" ON "platform"."evaluation_trace"("tenant_id", "scenario", "created_at");

-- CreateIndex
CREATE INDEX "evaluation_trace_tenant_set_created_idx" ON "platform"."evaluation_trace"("tenant_id", "rule_set_id", "created_at");

CREATE OR REPLACE FUNCTION "platform"."reject_published_rule_set_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'published rule sets are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "platform"."reject_published_rule_definition_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "platform"."rule_set"
    WHERE id = OLD.rule_set_id AND status IN ('PUBLISHED', 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'published rule definitions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rule_set_published_immutable
BEFORE UPDATE OR DELETE ON "platform"."rule_set"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_published_rule_set_mutation"();

CREATE TRIGGER rule_definition_published_immutable
BEFORE UPDATE OR DELETE ON "platform"."rule_definition"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_published_rule_definition_mutation"();

CREATE TRIGGER evaluation_trace_immutable
BEFORE UPDATE OR DELETE ON "platform"."evaluation_trace"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();
