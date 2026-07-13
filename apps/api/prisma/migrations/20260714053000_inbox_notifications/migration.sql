-- CreateEnum
CREATE TYPE "platform"."InboxItemStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "platform"."InboxItemType" AS ENUM ('APPROVAL', 'EXCEPTION', 'EXPIRY', 'INTEGRATION_FAILURE', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "platform"."NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "platform"."NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WECHAT', 'PUSH');

-- CreateEnum
CREATE TYPE "platform"."NotificationTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "platform"."NotificationStatus" AS ENUM ('PENDING', 'DELIVERED', 'PARTIAL_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "platform"."DeliveryAttemptStatus" AS ENUM ('DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "platform"."inbox_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."InboxItemStatus" NOT NULL DEFAULT 'UNREAD',
    "type" "platform"."InboxItemType" NOT NULL,
    "severity" "platform"."NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "recipient_account_id" UUID NOT NULL,
    "responsibility_group" VARCHAR(100) NOT NULL,
    "business_domain" VARCHAR(50) NOT NULL,
    "business_object_type" VARCHAR(100) NOT NULL,
    "business_object_id" UUID NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "organization_id" UUID,
    "title" VARCHAR(300) NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "route" VARCHAR(500) NOT NULL,
    "source_notification_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "inbox_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."notification_read" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "inbox_item_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" VARCHAR(100) NOT NULL,

    CONSTRAINT "notification_read_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."notification_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."NotificationTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "version_number" INTEGER NOT NULL,
    "locale" VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    "subject_template" VARCHAR(500) NOT NULL,
    "body_template" TEXT NOT NULL,
    "variable_whitelist" JSONB NOT NULL,
    "channels" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."subscription_preference" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "channel" "platform"."NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minimum_severity" "platform"."NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "quiet_start_minutes" INTEGER,
    "quiet_end_minutes" INTEGER,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "fallback_channel" "platform"."NotificationChannel",

    CONSTRAINT "subscription_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "recipient_account_id" UUID NOT NULL,
    "severity" "platform"."NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "responsibility_group" VARCHAR(100) NOT NULL,
    "business_domain" VARCHAR(50) NOT NULL,
    "business_object_type" VARCHAR(100) NOT NULL,
    "business_object_id" UUID NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "organization_id" UUID,
    "route" VARCHAR(500) NOT NULL,
    "variables" JSONB NOT NULL,
    "rendered_subject" VARCHAR(500) NOT NULL,
    "rendered_body" TEXT NOT NULL,
    "requested_channels" JSONB NOT NULL,
    "delivered_channels" JSONB NOT NULL DEFAULT '[]',
    "escalation_at" TIMESTAMPTZ(3),
    "escalated_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."delivery_attempt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."DeliveryAttemptStatus" NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "platform"."NotificationChannel" NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider_message_id" VARCHAR(200),
    "error_code" VARCHAR(100),
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "next_retry_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),

    CONSTRAINT "delivery_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbox_item_tenant_recipient_status_created_idx" ON "platform"."inbox_item"("tenant_id", "recipient_account_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "inbox_item_tenant_group_severity_status_idx" ON "platform"."inbox_item"("tenant_id", "responsibility_group", "severity", "status");

-- CreateIndex
CREATE INDEX "inbox_item_tenant_domain_business_idx" ON "platform"."inbox_item"("tenant_id", "business_domain", "business_ref");

-- CreateIndex
CREATE INDEX "notification_read_tenant_account_read_idx" ON "platform"."notification_read"("tenant_id", "account_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_read_tenant_item_account_key" ON "platform"."notification_read"("tenant_id", "inbox_item_id", "account_id");

-- CreateIndex
CREATE INDEX "notification_template_tenant_code_status_version_idx" ON "platform"."notification_template"("tenant_id", "code", "status", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_tenant_code_version_key" ON "platform"."notification_template"("tenant_id", "code", "version_number");

-- CreateIndex
CREATE INDEX "subscription_preference_tenant_account_status_idx" ON "platform"."subscription_preference"("tenant_id", "account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_preference_tenant_account_channel_key" ON "platform"."subscription_preference"("tenant_id", "account_id", "channel");

-- CreateIndex
CREATE INDEX "notification_tenant_recipient_status_created_idx" ON "platform"."notification"("tenant_id", "recipient_account_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "notification_tenant_status_escalation_idx" ON "platform"."notification"("tenant_id", "status", "escalation_at");

-- CreateIndex
CREATE INDEX "notification_tenant_domain_business_idx" ON "platform"."notification"("tenant_id", "business_domain", "business_ref");

-- CreateIndex
CREATE INDEX "delivery_attempt_tenant_status_retry_idx" ON "platform"."delivery_attempt"("tenant_id", "status", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempt_tenant_notification_channel_attempt_key" ON "platform"."delivery_attempt"("tenant_id", "notification_id", "channel", "attempt_number");
