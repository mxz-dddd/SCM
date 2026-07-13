-- PLT-006 explicit, tenant-scoped ABAC policies and decision audit.
-- CreateTable
CREATE TABLE "platform"."data_scope_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "role_id" UUID NOT NULL,
    "resource" VARCHAR(150) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "expression" JSONB NOT NULL,

    CONSTRAINT "data_scope_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."data_policy_decision_audit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "resource" VARCHAR(150) NOT NULL,
    "decision" "platform"."PermissionDecision" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "matched_policy_ids" JSONB NOT NULL DEFAULT '[]',
    "attributes_hash" CHAR(64) NOT NULL,
    "correlation_id" VARCHAR(100) NOT NULL,
    "permission_version" INTEGER NOT NULL,

    CONSTRAINT "data_policy_decision_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_scope_policy_tenant_role_resource_status_idx" ON "platform"."data_scope_policy"("tenant_id", "role_id", "resource", "status");

-- CreateIndex
CREATE UNIQUE INDEX "data_scope_policy_tenant_code_key" ON "platform"."data_scope_policy"("tenant_id", "code");

ALTER TABLE "platform"."data_scope_policy"
  ADD CONSTRAINT "data_scope_policy_expression_shape_check"
  CHECK (
    jsonb_typeof("expression") = 'object'
    AND "expression" ? 'match'
    AND "expression" ? 'conditions'
    AND jsonb_typeof("expression" -> 'conditions') = 'array'
  );

-- CreateIndex
CREATE INDEX "data_policy_decision_tenant_account_created_idx" ON "platform"."data_policy_decision_audit"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "data_policy_decision_tenant_resource_decision_idx" ON "platform"."data_policy_decision_audit"("tenant_id", "resource", "decision");
