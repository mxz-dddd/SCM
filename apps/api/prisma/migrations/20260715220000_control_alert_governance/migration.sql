-- CreateEnum
CREATE TYPE "control"."ControlSlaClockStatus" AS ENUM ('ACTIVE', 'PAUSED', 'WARNING', 'BREACHED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "control"."ControlSlaMilestone" AS ENUM ('CONFIRMATION', 'RELEASE', 'RECEIVING', 'PUTAWAY', 'SHIPPING', 'DELIVERY', 'POD', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "control"."AlertRuleLifecycle" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "control"."ControlAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "control"."ControlAlertCaseStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "control"."ControlNotificationStatus" AS ENUM ('REQUESTED');

-- CreateEnum
CREATE TYPE "control"."ControlRemediationStatus" AS ENUM ('REQUESTED');

-- CreateTable
CREATE TABLE "control"."sla_clock" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlSlaClockStatus" NOT NULL DEFAULT 'ACTIVE',
    "business_ref" VARCHAR(200) NOT NULL,
    "milestone" "control"."ControlSlaMilestone" NOT NULL,
    "source_version" INTEGER NOT NULL,
    "responsible_domain" VARCHAR(50) NOT NULL,
    "organization_ref" VARCHAR(200),
    "customer_ref" VARCHAR(200),
    "calendar_code" VARCHAR(100) NOT NULL,
    "calendar_snapshot" JSONB NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "warning_lead_minutes" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "warning_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "paused_at" TIMESTAMPTZ(3),
    "paused_seconds" INTEGER NOT NULL DEFAULT 0,
    "pause_reason" VARCHAR(500),
    "breached_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "reopened_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sla_clock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."sla_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "sla_clock_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "from_status" "control"."ControlSlaClockStatus",
    "to_status" "control"."ControlSlaClockStatus" NOT NULL,
    "source_version" INTEGER NOT NULL,
    "reason" VARCHAR(500),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "sla_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."alert_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."AlertRuleLifecycle" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "customer_ref" VARCHAR(200),
    "active_version_number" INTEGER,

    CONSTRAINT "alert_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."alert_rule_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "rule_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "condition_snapshot" JSONB NOT NULL,
    "debounce_seconds" INTEGER NOT NULL,
    "suppression_seconds" INTEGER NOT NULL,
    "merge_window_seconds" INTEGER NOT NULL,
    "severity" "control"."ControlAlertSeverity" NOT NULL,
    "responsible_domain" VARCHAR(50) NOT NULL,
    "organization_ref" VARCHAR(200),
    "shift_code" VARCHAR(100),
    "owner_ref" UUID,
    "supervisor_ref" UUID,
    "due_minutes" INTEGER NOT NULL,
    "escalation_minutes" INTEGER NOT NULL,
    "channel_snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rule_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."alert_signal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "rule_version_id" UUID NOT NULL,
    "dedupe_key" VARCHAR(300) NOT NULL,
    "first_observed_at" TIMESTAMPTZ(3) NOT NULL,
    "last_observed_at" TIMESTAMPTZ(3) NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "last_alert_at" TIMESTAMPTZ(3),
    "last_case_id" UUID,

    CONSTRAINT "alert_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."alert_case" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlAlertCaseStatus" NOT NULL DEFAULT 'OPEN',
    "case_no" VARCHAR(100) NOT NULL,
    "rule_version_id" UUID,
    "sla_clock_id" UUID,
    "dedupe_key" VARCHAR(300) NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "source_domain" VARCHAR(50) NOT NULL,
    "responsible_domain" VARCHAR(50) NOT NULL,
    "organization_ref" VARCHAR(200),
    "customer_ref" VARCHAR(200),
    "severity" "control"."ControlAlertSeverity" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "owner_ref" UUID,
    "supervisor_ref" UUID,
    "shift_code" VARCHAR(100),
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "trigger_count" INTEGER NOT NULL DEFAULT 1,
    "last_triggered_at" TIMESTAMPTZ(3) NOT NULL,
    "resolution" VARCHAR(1000),
    "resolution_verified" BOOLEAN NOT NULL DEFAULT false,
    "source_snapshot" JSONB NOT NULL,

    CONSTRAINT "alert_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."alert_assignment_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "alert_case_id" UUID NOT NULL,
    "from_owner_ref" UUID,
    "to_owner_ref" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "route_snapshot" JSONB NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."alert_notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlNotificationStatus" NOT NULL DEFAULT 'REQUESTED',
    "alert_case_id" UUID NOT NULL,
    "escalation_level" INTEGER NOT NULL,
    "recipient_ref" UUID,
    "channel_snapshot" JSONB NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."escalation_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "alert_case_id" UUID NOT NULL,
    "from_level" INTEGER NOT NULL,
    "to_level" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "escalated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."remediation_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlRemediationStatus" NOT NULL DEFAULT 'REQUESTED',
    "alert_case_id" UUID NOT NULL,
    "target_domain" VARCHAR(50) NOT NULL,
    "command_type" VARCHAR(150) NOT NULL,
    "target_ref" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "command_snapshot" JSONB NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remediation_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."root_cause_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "alert_case_id" UUID NOT NULL,
    "closure_version" INTEGER NOT NULL,
    "root_cause_code" VARCHAR(100) NOT NULL,
    "responsible_party" VARCHAR(200) NOT NULL,
    "solution" VARCHAR(1000) NOT NULL,
    "verification_snapshot" JSONB NOT NULL,
    "improvement_snapshot" JSONB NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "root_cause_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."knowledge_article" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "control"."ControlProjectionRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "article_code" VARCHAR(100) NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "root_cause_code" VARCHAR(100) NOT NULL,
    "content_snapshot" JSONB NOT NULL,
    "recommendation_snapshot" JSONB NOT NULL,
    "source_case_refs" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "control_sla_monitor_idx" ON "control"."sla_clock"("tenant_id", "status", "warning_at", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_sla_business_milestone_key" ON "control"."sla_clock"("tenant_id", "business_ref", "milestone");

-- CreateIndex
CREATE INDEX "control_sla_event_clock_idx" ON "control"."sla_event"("tenant_id", "sla_clock_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "control_alert_rule_lookup_idx" ON "control"."alert_rule"("tenant_id", "status", "code");

-- CreateIndex
CREATE UNIQUE INDEX "control_alert_rule_scope_key" ON "control"."alert_rule"("tenant_id", "code", "customer_ref");

-- CreateIndex
CREATE INDEX "control_alert_rule_version_idx" ON "control"."alert_rule_version"("tenant_id", "rule_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_alert_rule_version_key" ON "control"."alert_rule_version"("tenant_id", "rule_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "control_alert_signal_key" ON "control"."alert_signal"("tenant_id", "rule_version_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "control_alert_case_workbench_idx" ON "control"."alert_case"("tenant_id", "status", "severity", "due_at", "id");

-- CreateIndex
CREATE INDEX "control_alert_case_merge_idx" ON "control"."alert_case"("tenant_id", "dedupe_key", "last_triggered_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_alert_case_no_key" ON "control"."alert_case"("tenant_id", "case_no");

-- CreateIndex
CREATE INDEX "control_alert_assignment_case_idx" ON "control"."alert_assignment_history"("tenant_id", "alert_case_id", "assigned_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "control_alert_notification_level_key" ON "control"."alert_notification"("tenant_id", "alert_case_id", "escalation_level");

-- CreateIndex
CREATE INDEX "control_escalation_case_idx" ON "control"."escalation_event"("tenant_id", "alert_case_id", "escalated_at", "id");

-- CreateIndex
CREATE INDEX "control_remediation_case_idx" ON "control"."remediation_request"("tenant_id", "alert_case_id", "requested_at", "id");

-- CreateIndex
CREATE INDEX "control_root_cause_search_idx" ON "control"."root_cause_record"("tenant_id", "root_cause_code", "responsible_party", "closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_root_cause_closure_key" ON "control"."root_cause_record"("tenant_id", "alert_case_id", "closure_version");

-- CreateIndex
CREATE INDEX "control_knowledge_search_idx" ON "control"."knowledge_article"("tenant_id", "root_cause_code", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_knowledge_article_version_key" ON "control"."knowledge_article"("tenant_id", "article_code", "version_number");

DROP INDEX "control"."control_alert_rule_scope_key";
CREATE UNIQUE INDEX "control_alert_rule_scope_key" ON "control"."alert_rule"("tenant_id", "code", "customer_ref") NULLS NOT DISTINCT;

ALTER TABLE "control"."sla_clock" ADD CONSTRAINT "control_sla_clock_values_check" CHECK ("source_version" > 0 AND "duration_minutes" > 0 AND "warning_lead_minutes" >= 0 AND "warning_lead_minutes" <= "duration_minutes" AND "paused_seconds" >= 0 AND "reopened_count" >= 0);
ALTER TABLE "control"."alert_rule_version" ADD CONSTRAINT "control_alert_rule_timing_check" CHECK ("version_number" > 0 AND "debounce_seconds" >= 0 AND "suppression_seconds" >= 0 AND "merge_window_seconds" >= 0 AND "due_minutes" > 0 AND "escalation_minutes" > 0);
ALTER TABLE "control"."alert_signal" ADD CONSTRAINT "control_alert_signal_count_check" CHECK ("occurrence_count" > 0);
ALTER TABLE "control"."alert_case" ADD CONSTRAINT "control_alert_case_count_check" CHECK ("escalation_level" >= 0 AND "trigger_count" > 0);
ALTER TABLE "control"."alert_notification" ADD CONSTRAINT "control_alert_notification_level_check" CHECK ("escalation_level" >= 0);
ALTER TABLE "control"."escalation_event" ADD CONSTRAINT "control_escalation_level_check" CHECK ("from_level" >= 0 AND "to_level" > "from_level");
ALTER TABLE "control"."root_cause_record" ADD CONSTRAINT "control_root_cause_closure_check" CHECK ("closure_version" > 0);
ALTER TABLE "control"."knowledge_article" ADD CONSTRAINT "control_knowledge_version_check" CHECK ("version_number" > 0);

CREATE OR REPLACE FUNCTION "control"."reject_control_governance_fact_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'control governance facts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "control_sla_event_immutable" BEFORE UPDATE OR DELETE ON "control"."sla_event" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_governance_fact_mutation"();
CREATE TRIGGER "control_alert_rule_version_immutable" BEFORE UPDATE OR DELETE ON "control"."alert_rule_version" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_governance_fact_mutation"();
CREATE TRIGGER "control_alert_assignment_immutable" BEFORE UPDATE OR DELETE ON "control"."alert_assignment_history" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_governance_fact_mutation"();
CREATE TRIGGER "control_alert_notification_immutable" BEFORE UPDATE OR DELETE ON "control"."alert_notification" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_governance_fact_mutation"();
CREATE TRIGGER "control_escalation_event_immutable" BEFORE UPDATE OR DELETE ON "control"."escalation_event" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_governance_fact_mutation"();
CREATE TRIGGER "control_remediation_request_immutable" BEFORE UPDATE OR DELETE ON "control"."remediation_request" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_governance_fact_mutation"();
CREATE TRIGGER "control_root_cause_record_immutable" BEFORE UPDATE OR DELETE ON "control"."root_cause_record" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_governance_fact_mutation"();
CREATE TRIGGER "control_knowledge_article_immutable" BEFORE UPDATE OR DELETE ON "control"."knowledge_article" FOR EACH ROW EXECUTE FUNCTION "control"."reject_control_governance_fact_mutation"();
