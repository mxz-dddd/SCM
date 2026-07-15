-- CreateEnum
CREATE TYPE "control"."ControlBiLifecycle" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "control"."ControlMetricGranularity" AS ENUM ('EVENT', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "control"."ControlReportVisibility" AS ENUM ('PRIVATE', 'TENANT');

-- CreateEnum
CREATE TYPE "control"."ControlQueryJobStatus" AS ENUM ('QUEUED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "control"."ControlLakeArrivalStatus" AS ENUM ('ON_TIME', 'LATE');

-- CreateEnum
CREATE TYPE "control"."ControlLakeRecomputeStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "control"."metric_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlBiLifecycle" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "active_version_number" INTEGER,

    CONSTRAINT "metric_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."metric_definition_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "metric_definition_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "formula_snapshot" JSONB NOT NULL,
    "granularity" "control"."ControlMetricGranularity" NOT NULL,
    "dimension_snapshot" JSONB NOT NULL,
    "time_zone" VARCHAR(100) NOT NULL,
    "data_source_snapshot" JSONB NOT NULL,
    "refresh_policy_snapshot" JSONB NOT NULL,
    "sensitive_dimension_snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_definition_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."metric_observation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "metric_version_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "dimension_hash" CHAR(64) NOT NULL,
    "dimension_snapshot" JSONB NOT NULL,
    "component_snapshot" JSONB NOT NULL,
    "value" DECIMAL(30,10) NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_snapshot" JSONB NOT NULL,

    CONSTRAINT "metric_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."dashboard" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlBiLifecycle" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "active_version_number" INTEGER,

    CONSTRAINT "dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."dashboard_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "dashboard_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "organization_ref" VARCHAR(200),
    "warehouse_ref" VARCHAR(200),
    "refresh_seconds" INTEGER NOT NULL,
    "layout_snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."dashboard_widget_config" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "dashboard_version_id" UUID NOT NULL,
    "widget_key" VARCHAR(100) NOT NULL,
    "widget_type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "metric_code" VARCHAR(100),
    "position_snapshot" JSONB NOT NULL,
    "config_snapshot" JSONB NOT NULL,

    CONSTRAINT "dashboard_widget_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."report_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlBiLifecycle" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "owner_ref" UUID NOT NULL,
    "visibility" "control"."ControlReportVisibility" NOT NULL DEFAULT 'PRIVATE',
    "active_version_number" INTEGER,

    CONSTRAINT "report_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."report_definition_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "report_definition_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "semantic_model" VARCHAR(100) NOT NULL,
    "metric_version_snapshot" JSONB NOT NULL,
    "dimension_snapshot" JSONB NOT NULL,
    "filter_snapshot" JSONB NOT NULL,
    "share_snapshot" JSONB NOT NULL,
    "quota_snapshot" JSONB NOT NULL,
    "masking_snapshot" JSONB NOT NULL,
    "export_policy_snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_definition_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."query_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlQueryJobStatus" NOT NULL DEFAULT 'QUEUED',
    "report_version_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "query_hash" CHAR(64) NOT NULL,
    "row_limit" INTEGER NOT NULL,
    "estimated_cost" INTEGER NOT NULL,
    "export_requested" BOOLEAN NOT NULL DEFAULT false,
    "sensitive_access" BOOLEAN NOT NULL DEFAULT false,
    "result_snapshot" JSONB NOT NULL,
    "masked_field_snapshot" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "rejection_code" VARCHAR(100),
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "query_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."analytics_quota_bucket" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "quota_date" DATE NOT NULL,
    "query_count" INTEGER NOT NULL DEFAULT 0,
    "export_count" INTEGER NOT NULL DEFAULT 0,
    "cost_used" INTEGER NOT NULL DEFAULT 0,
    "running_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "analytics_quota_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."lake_watermark" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "dataset" VARCHAR(100) NOT NULL,
    "last_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "last_ingested_at" TIMESTAMPTZ(3) NOT NULL,
    "late_record_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lake_watermark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."lake_fact_snapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "dataset" VARCHAR(100) NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "event_id" UUID NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "event_type" VARCHAR(200) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrival_status" "control"."ControlLakeArrivalStatus" NOT NULL,
    "record_snapshot" JSONB NOT NULL,
    "recompute_run_id" UUID,
    "isolation_key" VARCHAR(100) NOT NULL,

    CONSTRAINT "lake_fact_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."lake_dimension_snapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "dataset" VARCHAR(100) NOT NULL,
    "dimension_key" VARCHAR(200) NOT NULL,
    "event_id" UUID NOT NULL,
    "source_version" INTEGER NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrival_status" "control"."ControlLakeArrivalStatus" NOT NULL,
    "record_snapshot" JSONB NOT NULL,
    "recompute_run_id" UUID,
    "isolation_key" VARCHAR(100) NOT NULL,

    CONSTRAINT "lake_dimension_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."lake_recompute_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlLakeRecomputeStatus" NOT NULL DEFAULT 'RUNNING',
    "dataset" VARCHAR(100) NOT NULL,
    "isolation_key" VARCHAR(100) NOT NULL,
    "from_at" TIMESTAMPTZ(3) NOT NULL,
    "to_at" TIMESTAMPTZ(3) NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "output_count" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),
    "failure_reason" VARCHAR(1000),

    CONSTRAINT "lake_recompute_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "control_metric_definition_lookup_idx" ON "control"."metric_definition"("tenant_id", "status", "code");

-- CreateIndex
CREATE UNIQUE INDEX "control_metric_definition_code_key" ON "control"."metric_definition"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "control_metric_definition_version_idx" ON "control"."metric_definition_version"("tenant_id", "metric_definition_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_metric_definition_version_key" ON "control"."metric_definition_version"("tenant_id", "metric_definition_id", "version_number");

-- CreateIndex
CREATE INDEX "control_metric_observation_period_idx" ON "control"."metric_observation"("tenant_id", "metric_version_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "control_metric_observation_scope_key" ON "control"."metric_observation"("tenant_id", "metric_version_id", "period_start", "period_end", "dimension_hash");

-- CreateIndex
CREATE INDEX "control_dashboard_lookup_idx" ON "control"."dashboard"("tenant_id", "status", "code");

-- CreateIndex
CREATE UNIQUE INDEX "control_dashboard_code_key" ON "control"."dashboard"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "control_dashboard_context_idx" ON "control"."dashboard_version"("tenant_id", "organization_ref", "warehouse_ref", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_dashboard_version_key" ON "control"."dashboard_version"("tenant_id", "dashboard_id", "version_number");

-- CreateIndex
CREATE INDEX "control_dashboard_widget_version_idx" ON "control"."dashboard_widget_config"("tenant_id", "dashboard_version_id", "widget_type");

-- CreateIndex
CREATE UNIQUE INDEX "control_dashboard_widget_key" ON "control"."dashboard_widget_config"("tenant_id", "dashboard_version_id", "widget_key");

-- CreateIndex
CREATE INDEX "control_report_definition_lookup_idx" ON "control"."report_definition"("tenant_id", "status", "visibility", "owner_ref");

-- CreateIndex
CREATE UNIQUE INDEX "control_report_definition_code_key" ON "control"."report_definition"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "control_report_definition_version_idx" ON "control"."report_definition_version"("tenant_id", "report_definition_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_report_definition_version_key" ON "control"."report_definition_version"("tenant_id", "report_definition_id", "version_number");

-- CreateIndex
CREATE INDEX "control_query_job_requester_idx" ON "control"."query_job"("tenant_id", "requested_by", "created_at", "id");

-- CreateIndex
CREATE INDEX "control_query_job_status_idx" ON "control"."query_job"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_analytics_quota_bucket_key" ON "control"."analytics_quota_bucket"("tenant_id", "account_id", "quota_date");

-- CreateIndex
CREATE UNIQUE INDEX "control_lake_watermark_dataset_key" ON "control"."lake_watermark"("tenant_id", "dataset");

-- CreateIndex
CREATE INDEX "control_lake_fact_dataset_idx" ON "control"."lake_fact_snapshot"("tenant_id", "dataset", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "control_lake_fact_recompute_idx" ON "control"."lake_fact_snapshot"("tenant_id", "recompute_run_id", "occurred_at");

-- CreateIndex
CREATE INDEX "control_lake_dimension_history_idx" ON "control"."lake_dimension_snapshot"("tenant_id", "dataset", "dimension_key", "effective_at", "id");

-- CreateIndex
CREATE INDEX "control_lake_dimension_recompute_idx" ON "control"."lake_dimension_snapshot"("tenant_id", "recompute_run_id", "effective_at");

-- CreateIndex
CREATE INDEX "control_lake_recompute_dataset_idx" ON "control"."lake_recompute_run"("tenant_id", "dataset", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_lake_recompute_isolation_key" ON "control"."lake_recompute_run"("tenant_id", "isolation_key");

CREATE UNIQUE INDEX "control_lake_fact_event_isolation_key" ON "control"."lake_fact_snapshot"("tenant_id", "dataset", "event_id", "isolation_key");
CREATE UNIQUE INDEX "control_lake_dimension_event_isolation_key" ON "control"."lake_dimension_snapshot"("tenant_id", "dataset", "event_id", "isolation_key");

ALTER TABLE "control"."metric_definition_version" ADD CONSTRAINT "control_metric_definition_version_check" CHECK ("version_number" > 0);
ALTER TABLE "control"."metric_observation" ADD CONSTRAINT "control_metric_observation_period_check" CHECK ("period_end" > "period_start");
ALTER TABLE "control"."dashboard_version" ADD CONSTRAINT "control_dashboard_version_values_check" CHECK ("version_number" > 0 AND "refresh_seconds" >= 5);
ALTER TABLE "control"."report_definition_version" ADD CONSTRAINT "control_report_definition_version_check" CHECK ("version_number" > 0);
ALTER TABLE "control"."query_job" ADD CONSTRAINT "control_query_job_values_check" CHECK ("row_limit" > 0 AND "estimated_cost" >= 0 AND "row_count" >= 0 AND "expires_at" > "created_at");
ALTER TABLE "control"."analytics_quota_bucket" ADD CONSTRAINT "control_analytics_quota_values_check" CHECK ("query_count" >= 0 AND "export_count" >= 0 AND "cost_used" >= 0 AND "running_count" >= 0);
ALTER TABLE "control"."lake_watermark" ADD CONSTRAINT "control_lake_watermark_values_check" CHECK ("late_record_count" >= 0);
ALTER TABLE "control"."lake_fact_snapshot" ADD CONSTRAINT "control_lake_fact_version_check" CHECK ("aggregate_version" > 0);
ALTER TABLE "control"."lake_dimension_snapshot" ADD CONSTRAINT "control_lake_dimension_version_check" CHECK ("source_version" > 0);
ALTER TABLE "control"."lake_recompute_run" ADD CONSTRAINT "control_lake_recompute_values_check" CHECK ("to_at" > "from_at" AND "output_count" >= 0);

CREATE OR REPLACE FUNCTION "control"."reject_control_bi_fact_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'control BI and lake facts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "control"."reject_terminal_query_job_mutation"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status IN ('COMPLETED', 'REJECTED') THEN
    RAISE EXCEPTION 'terminal query jobs are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "control_metric_definition_version_immutable" BEFORE UPDATE OR DELETE ON "control"."metric_definition_version" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();
CREATE TRIGGER "control_metric_observation_immutable" BEFORE UPDATE OR DELETE ON "control"."metric_observation" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();
CREATE TRIGGER "control_dashboard_version_immutable" BEFORE UPDATE OR DELETE ON "control"."dashboard_version" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();
CREATE TRIGGER "control_dashboard_widget_immutable" BEFORE UPDATE OR DELETE ON "control"."dashboard_widget_config" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();
CREATE TRIGGER "control_report_definition_version_immutable" BEFORE UPDATE OR DELETE ON "control"."report_definition_version" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();
CREATE TRIGGER "control_query_job_terminal_immutable" BEFORE UPDATE OR DELETE ON "control"."query_job" FOR EACH ROW EXECUTE FUNCTION "control"."reject_terminal_query_job_mutation"();
CREATE TRIGGER "control_lake_fact_snapshot_immutable" BEFORE UPDATE OR DELETE ON "control"."lake_fact_snapshot" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();
CREATE TRIGGER "control_lake_dimension_snapshot_immutable" BEFORE UPDATE OR DELETE ON "control"."lake_dimension_snapshot" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_bi_fact_mutation"();
