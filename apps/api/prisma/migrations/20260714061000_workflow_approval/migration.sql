-- CreateEnum
CREATE TYPE "platform"."WorkflowDefinitionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "platform"."WorkflowInstanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "platform"."ApprovalTaskStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "platform"."ApprovalActionType" AS ENUM ('APPROVE', 'REJECT', 'RETURN', 'ADD_SIGN', 'TRANSFER', 'WITHDRAW');

-- CreateTable
CREATE TABLE "platform"."workflow_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."WorkflowDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "version_number" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "supersedes_version_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "workflow_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."workflow_instance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."WorkflowInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "workflow_definition_id" UUID NOT NULL,
    "definition_code" VARCHAR(100) NOT NULL,
    "definition_version_number" INTEGER NOT NULL,
    "definition_snapshot" JSONB NOT NULL,
    "business_domain" VARCHAR(50) NOT NULL,
    "object_type" VARCHAR(100) NOT NULL,
    "object_id" UUID NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "requester_id" UUID NOT NULL,
    "organization_id" UUID,
    "current_node_key" VARCHAR(100) NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "workflow_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."approval_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."ApprovalTaskStatus" NOT NULL DEFAULT 'PENDING',
    "workflow_instance_id" UUID NOT NULL,
    "node_key" VARCHAR(100) NOT NULL,
    "assignee_account_id" UUID NOT NULL,
    "candidate_snapshot" JSONB NOT NULL,
    "delegated_from_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "approval_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."approval_action" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "workflow_instance_id" UUID NOT NULL,
    "approval_task_id" UUID,
    "action" "platform"."ApprovalActionType" NOT NULL,
    "actor_account_id" UUID NOT NULL,
    "target_account_id" UUID,
    "from_status" VARCHAR(50) NOT NULL,
    "to_status" VARCHAR(50) NOT NULL,
    "comment" VARCHAR(1000),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "approval_action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_definition_tenant_code_status_version_idx" ON "platform"."workflow_definition"("tenant_id", "code", "status", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definition_tenant_code_version_key" ON "platform"."workflow_definition"("tenant_id", "code", "version_number");

-- CreateIndex
CREATE INDEX "workflow_instance_tenant_status_started_idx" ON "platform"."workflow_instance"("tenant_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "workflow_instance_tenant_object_idx" ON "platform"."workflow_instance"("tenant_id", "business_domain", "object_type", "object_id");

-- CreateIndex
CREATE INDEX "workflow_instance_tenant_requester_status_idx" ON "platform"."workflow_instance"("tenant_id", "requester_id", "status");

-- CreateIndex
CREATE INDEX "approval_task_tenant_assignee_status_due_idx" ON "platform"."approval_task"("tenant_id", "assignee_account_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "approval_task_tenant_instance_node_status_idx" ON "platform"."approval_task"("tenant_id", "workflow_instance_id", "node_key", "status");

-- CreateIndex
CREATE INDEX "approval_action_tenant_instance_created_idx" ON "platform"."approval_action"("tenant_id", "workflow_instance_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_action_tenant_actor_created_idx" ON "platform"."approval_action"("tenant_id", "actor_account_id", "created_at");

CREATE OR REPLACE FUNCTION "platform"."reject_published_workflow_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'published workflow definitions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_definition_published_immutable
BEFORE UPDATE OR DELETE ON "platform"."workflow_definition"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_published_workflow_mutation"();

CREATE TRIGGER approval_action_immutable
BEFORE UPDATE OR DELETE ON "platform"."approval_action"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();
