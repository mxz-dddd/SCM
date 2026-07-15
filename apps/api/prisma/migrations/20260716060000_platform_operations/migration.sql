-- phase: expand
-- online-index-safe: new-table
CREATE TYPE "platform"."OpsDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED');
CREATE TYPE "platform"."OpsMonitorAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "platform"."OpsBackupStatus" AS ENUM ('PLANNED', 'RUNNING', 'VERIFIED', 'FAILED', 'EXPIRED');
CREATE TYPE "platform"."OpsDrDrillStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED');
CREATE TYPE "platform"."OpsReleaseStatus" AS ENUM ('DRAFT', 'VALIDATED', 'CANARY', 'ROLLED_OUT', 'ROLLED_BACK', 'FAILED');
CREATE TYPE "platform"."OpsMigrationPhase" AS ENUM ('EXPAND', 'MIGRATE', 'CONTRACT');
CREATE TYPE "platform"."OpsMigrationRunStatus" AS ENUM ('PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'ROLLED_BACK');
CREATE TYPE "platform"."OpsArchiveStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED');
CREATE TYPE "platform"."OpsPrivacyRequestType" AS ENUM ('ACCESS', 'CORRECT', 'DELETE');
CREATE TYPE "platform"."OpsPrivacyRequestStatus" AS ENUM ('RECEIVED', 'VERIFIED', 'QUEUED', 'RUNNING', 'FULFILLED', 'PARTIALLY_FULFILLED', 'REJECTED');
CREATE TYPE "platform"."OpsTenantMigrationStatus" AS ENUM ('DRAFT', 'VALIDATED', 'QUEUED', 'RUNNING', 'RECONCILING', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

CREATE TABLE "platform"."ops_monitor_rule" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "signal" VARCHAR(100) NOT NULL,
  "severity" VARCHAR(30) NOT NULL, "operator" VARCHAR(10) NOT NULL, "threshold" DECIMAL(30,6) NOT NULL,
  "duration_seconds" INTEGER NOT NULL, "dedup_seconds" INTEGER NOT NULL, "dimension_filter" JSONB NOT NULL,
  "owner_ref" VARCHAR(200) NOT NULL, CONSTRAINT "ops_monitor_rule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_monitor_rule_code_key" ON "platform"."ops_monitor_rule"("tenant_id", "code");
CREATE INDEX "ops_monitor_rule_signal_idx" ON "platform"."ops_monitor_rule"("tenant_id", "signal", "status", "created_at");

CREATE TABLE "platform"."ops_monitor_alert" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsMonitorAlertStatus" NOT NULL DEFAULT 'OPEN',
  "rule_id" UUID NOT NULL, "signal" VARCHAR(100) NOT NULL, "severity" VARCHAR(30) NOT NULL,
  "dedup_key" CHAR(64) NOT NULL, "observed_value" DECIMAL(30,6) NOT NULL, "threshold" DECIMAL(30,6) NOT NULL,
  "unit" VARCHAR(30) NOT NULL, "dimension_snapshot" JSONB NOT NULL,
  "first_triggered_at" TIMESTAMPTZ(3) NOT NULL, "last_triggered_at" TIMESTAMPTZ(3) NOT NULL,
  "trigger_count" INTEGER NOT NULL DEFAULT 1, "acknowledged_at" TIMESTAMPTZ(3), "acknowledged_by" UUID,
  "resolved_at" TIMESTAMPTZ(3), "resolved_by" UUID, "resolution" VARCHAR(1000),
  CONSTRAINT "ops_monitor_alert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ops_monitor_alert_status_idx" ON "platform"."ops_monitor_alert"("tenant_id", "status", "severity", "last_triggered_at");
CREATE INDEX "ops_monitor_alert_dedup_idx" ON "platform"."ops_monitor_alert"("tenant_id", "dedup_key", "last_triggered_at");

CREATE TABLE "platform"."ops_backup_set" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsBackupStatus" NOT NULL DEFAULT 'PLANNED',
  "backup_no" VARCHAR(100) NOT NULL, "environment" VARCHAR(100) NOT NULL,
  "target_rpo_minutes" INTEGER NOT NULL, "target_rto_minutes" INTEGER NOT NULL,
  "policy_snapshot" JSONB NOT NULL, "artifact_snapshot" JSONB, "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3), "failure_code" VARCHAR(100), CONSTRAINT "ops_backup_set_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_backup_set_no_key" ON "platform"."ops_backup_set"("tenant_id", "backup_no");
CREATE INDEX "ops_backup_set_status_idx" ON "platform"."ops_backup_set"("tenant_id", "environment", "status", "created_at");

CREATE TABLE "platform"."ops_dr_drill_report" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsDrDrillStatus" NOT NULL DEFAULT 'DRAFT',
  "drill_no" VARCHAR(100) NOT NULL, "backup_set_id" UUID NOT NULL, "job_run_id" UUID,
  "single_writer_fence" VARCHAR(200) NOT NULL, "exercise_snapshot" JSONB NOT NULL, "result_snapshot" JSONB,
  "achieved_rpo_minutes" INTEGER, "achieved_rto_minutes" INTEGER, "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3), CONSTRAINT "ops_dr_drill_report_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_dr_drill_no_key" ON "platform"."ops_dr_drill_report"("tenant_id", "drill_no");
CREATE UNIQUE INDEX "ops_dr_drill_job_key" ON "platform"."ops_dr_drill_report"("tenant_id", "job_run_id");
CREATE INDEX "ops_dr_drill_status_idx" ON "platform"."ops_dr_drill_report"("tenant_id", "status", "created_at");

CREATE TABLE "platform"."ops_release" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "release_no" VARCHAR(100) NOT NULL, "environment" VARCHAR(100) NOT NULL, "commit_sha" CHAR(40) NOT NULL,
  "image_digest" VARCHAR(100) NOT NULL, "artifact_snapshot" JSONB NOT NULL, "canary_snapshot" JSONB,
  "rollback_snapshot" JSONB, "validated_at" TIMESTAMPTZ(3), "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "ops_release_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_release_no_key" ON "platform"."ops_release"("tenant_id", "release_no");
CREATE INDEX "ops_release_status_idx" ON "platform"."ops_release"("tenant_id", "environment", "status", "created_at");

CREATE TABLE "platform"."ops_migration_run" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsMigrationRunStatus" NOT NULL DEFAULT 'PLANNED',
  "release_id" UUID NOT NULL, "migration_name" VARCHAR(200) NOT NULL, "phase" "platform"."OpsMigrationPhase" NOT NULL,
  "compatibility_snapshot" JSONB NOT NULL, "lock_risk_snapshot" JSONB NOT NULL, "execution_snapshot" JSONB,
  "started_at" TIMESTAMPTZ(3), "completed_at" TIMESTAMPTZ(3), CONSTRAINT "ops_migration_run_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_migration_run_phase_key" ON "platform"."ops_migration_run"("tenant_id", "release_id", "migration_name", "phase");
CREATE INDEX "ops_migration_run_status_idx" ON "platform"."ops_migration_run"("tenant_id", "status", "phase", "created_at");

CREATE TABLE "platform"."ops_retention_policy" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "category" VARCHAR(100) NOT NULL, "retain_days" INTEGER NOT NULL, "archive_after_days" INTEGER NOT NULL,
  "delete_allowed" BOOLEAN NOT NULL, "legal_hold" BOOLEAN NOT NULL DEFAULT false, "contract_snapshot" JSONB NOT NULL,
  "archive_tier" VARCHAR(30) NOT NULL, CONSTRAINT "ops_retention_policy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_retention_policy_category_key" ON "platform"."ops_retention_policy"("tenant_id", "category");
CREATE INDEX "ops_retention_policy_status_idx" ON "platform"."ops_retention_policy"("tenant_id", "status", "category");

CREATE TABLE "platform"."ops_archive_job" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsArchiveStatus" NOT NULL DEFAULT 'QUEUED',
  "policy_id" UUID NOT NULL, "job_run_id" UUID, "cutoff_at" TIMESTAMPTZ(3) NOT NULL, "candidate_snapshot" JSONB NOT NULL,
  "manifest_snapshot" JSONB, "archived_count" INTEGER NOT NULL DEFAULT 0, "deleted_count" INTEGER NOT NULL DEFAULT 0,
  "failure_code" VARCHAR(100), "started_at" TIMESTAMPTZ(3), "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "ops_archive_job_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_archive_job_run_key" ON "platform"."ops_archive_job"("tenant_id", "job_run_id");
CREATE INDEX "ops_archive_job_status_idx" ON "platform"."ops_archive_job"("tenant_id", "status", "cutoff_at");

CREATE TABLE "platform"."ops_privacy_request" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsPrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "request_no" VARCHAR(100) NOT NULL, "request_type" "platform"."OpsPrivacyRequestType" NOT NULL,
  "subject_ref_hash" CHAR(64) NOT NULL, "scope_snapshot" JSONB NOT NULL, "verification_snapshot" JSONB,
  "legal_basis_snapshot" JSONB NOT NULL, "job_run_id" UUID, "due_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3), "rejection_reason" VARCHAR(1000), CONSTRAINT "ops_privacy_request_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_privacy_request_no_key" ON "platform"."ops_privacy_request"("tenant_id", "request_no");
CREATE UNIQUE INDEX "ops_privacy_request_job_key" ON "platform"."ops_privacy_request"("tenant_id", "job_run_id");
CREATE INDEX "ops_privacy_request_status_idx" ON "platform"."ops_privacy_request"("tenant_id", "status", "due_at");

CREATE TABLE "platform"."ops_redaction_record" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "privacy_request_id" UUID NOT NULL, "domain" VARCHAR(50) NOT NULL, "record_ref_hash" CHAR(64) NOT NULL,
  "field_classification" VARCHAR(100) NOT NULL, "action" VARCHAR(50) NOT NULL, "outcome" VARCHAR(50) NOT NULL,
  "reason_code" VARCHAR(100) NOT NULL, "evidence_snapshot" JSONB NOT NULL,
  CONSTRAINT "ops_redaction_record_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ops_redaction_request_idx" ON "platform"."ops_redaction_record"("tenant_id", "privacy_request_id", "domain");

CREATE TABLE "platform"."ops_capacity_plan" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "code" VARCHAR(100) NOT NULL, "domain" VARCHAR(50) NOT NULL, "quota_snapshot" JSONB NOT NULL,
  "scaling_snapshot" JSONB NOT NULL, "tiering_snapshot" JSONB NOT NULL, "effective_from" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ops_capacity_plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_capacity_plan_code_key" ON "platform"."ops_capacity_plan"("tenant_id", "code");
CREATE INDEX "ops_capacity_plan_status_idx" ON "platform"."ops_capacity_plan"("tenant_id", "domain", "status", "effective_from");

CREATE TABLE "platform"."ops_usage_metric" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "metric_name" VARCHAR(100) NOT NULL, "domain" VARCHAR(50) NOT NULL, "value" DECIMAL(30,6) NOT NULL,
  "unit" VARCHAR(30) NOT NULL, "observed_at" TIMESTAMPTZ(3) NOT NULL, "dimension_snapshot" JSONB NOT NULL,
  "trace_id" VARCHAR(100) NOT NULL, CONSTRAINT "ops_usage_metric_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ops_usage_metric_lookup_idx" ON "platform"."ops_usage_metric"("tenant_id", "domain", "metric_name", "observed_at");

CREATE TABLE "platform"."ops_tenant_migration_plan" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."OpsTenantMigrationStatus" NOT NULL DEFAULT 'DRAFT',
  "plan_no" VARCHAR(100) NOT NULL, "source_environment" VARCHAR(100) NOT NULL, "target_environment" VARCHAR(100) NOT NULL,
  "scope_snapshot" JSONB NOT NULL, "dependency_snapshot" JSONB NOT NULL, "source_total_snapshot" JSONB NOT NULL,
  "target_total_snapshot" JSONB NOT NULL, "rollback_snapshot" JSONB NOT NULL, "job_run_id" UUID,
  "started_at" TIMESTAMPTZ(3), "completed_at" TIMESTAMPTZ(3), "failure_code" VARCHAR(100),
  CONSTRAINT "ops_tenant_migration_plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_tenant_migration_plan_no_key" ON "platform"."ops_tenant_migration_plan"("tenant_id", "plan_no");
CREATE UNIQUE INDEX "ops_tenant_migration_job_key" ON "platform"."ops_tenant_migration_plan"("tenant_id", "job_run_id");
CREATE INDEX "ops_tenant_migration_status_idx" ON "platform"."ops_tenant_migration_plan"("tenant_id", "status", "created_at");

CREATE TABLE "platform"."ops_migration_reconciliation_report" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "migration_plan_id" UUID NOT NULL, "count_comparison" JSONB NOT NULL, "money_comparison" JSONB NOT NULL,
  "status_comparison" JSONB NOT NULL, "difference_count" INTEGER NOT NULL, "report_hash" CHAR(64) NOT NULL,
  CONSTRAINT "ops_migration_reconciliation_report_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ops_migration_reconciliation_plan_key" ON "platform"."ops_migration_reconciliation_report"("tenant_id", "migration_plan_id");
CREATE INDEX "ops_migration_reconciliation_created_idx" ON "platform"."ops_migration_reconciliation_report"("tenant_id", "created_at");

CREATE FUNCTION "platform"."reject_ops_immutable_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'OPS_IMMUTABLE_RECORD'; END $$;
CREATE TRIGGER "ops_redaction_immutable" BEFORE UPDATE OR DELETE ON "platform"."ops_redaction_record"
  FOR EACH ROW EXECUTE FUNCTION "platform"."reject_ops_immutable_change"();
CREATE TRIGGER "ops_usage_immutable" BEFORE UPDATE OR DELETE ON "platform"."ops_usage_metric"
  FOR EACH ROW EXECUTE FUNCTION "platform"."reject_ops_immutable_change"();
CREATE TRIGGER "ops_reconciliation_immutable" BEFORE UPDATE OR DELETE ON "platform"."ops_migration_reconciliation_report"
  FOR EACH ROW EXECUTE FUNCTION "platform"."reject_ops_immutable_change"();

CREATE FUNCTION "platform"."protect_ops_input_snapshots"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'ops_archive_job' AND ROW(to_jsonb(OLD)->'policy_id', to_jsonb(OLD)->'cutoff_at', to_jsonb(OLD)->'candidate_snapshot') IS DISTINCT FROM ROW(to_jsonb(NEW)->'policy_id', to_jsonb(NEW)->'cutoff_at', to_jsonb(NEW)->'candidate_snapshot') THEN
    RAISE EXCEPTION 'OPS_ARCHIVE_INPUT_IMMUTABLE';
  ELSIF TG_TABLE_NAME = 'ops_privacy_request' AND ROW(to_jsonb(OLD)->'request_type', to_jsonb(OLD)->'subject_ref_hash', to_jsonb(OLD)->'scope_snapshot', to_jsonb(OLD)->'legal_basis_snapshot') IS DISTINCT FROM ROW(to_jsonb(NEW)->'request_type', to_jsonb(NEW)->'subject_ref_hash', to_jsonb(NEW)->'scope_snapshot', to_jsonb(NEW)->'legal_basis_snapshot') THEN
    RAISE EXCEPTION 'OPS_PRIVACY_INPUT_IMMUTABLE';
  ELSIF TG_TABLE_NAME = 'ops_tenant_migration_plan' AND ROW(to_jsonb(OLD)->'source_environment', to_jsonb(OLD)->'target_environment', to_jsonb(OLD)->'scope_snapshot', to_jsonb(OLD)->'source_total_snapshot') IS DISTINCT FROM ROW(to_jsonb(NEW)->'source_environment', to_jsonb(NEW)->'target_environment', to_jsonb(NEW)->'scope_snapshot', to_jsonb(NEW)->'source_total_snapshot') THEN
    RAISE EXCEPTION 'OPS_MIGRATION_INPUT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ops_archive_input_immutable" BEFORE UPDATE ON "platform"."ops_archive_job"
  FOR EACH ROW EXECUTE FUNCTION "platform"."protect_ops_input_snapshots"();
CREATE TRIGGER "ops_privacy_input_immutable" BEFORE UPDATE ON "platform"."ops_privacy_request"
  FOR EACH ROW EXECUTE FUNCTION "platform"."protect_ops_input_snapshots"();
CREATE TRIGGER "ops_migration_input_immutable" BEFORE UPDATE ON "platform"."ops_tenant_migration_plan"
  FOR EACH ROW EXECUTE FUNCTION "platform"."protect_ops_input_snapshots"();
