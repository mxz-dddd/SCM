-- phase: expand
-- online-index-safe: new-table
CREATE TABLE "platform"."rate_limit_bucket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "scope" VARCHAR(40) NOT NULL,
  "subject_hash" CHAR(64) NOT NULL,
  "route" VARCHAR(300) NOT NULL,
  "bucket_start" TIMESTAMPTZ(3) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limit_bucket_key"
  ON "platform"."rate_limit_bucket"("tenant_id", "scope", "subject_hash", "route", "bucket_start");
CREATE INDEX "rate_limit_bucket_tenant_scope_idx"
  ON "platform"."rate_limit_bucket"("tenant_id", "scope", "bucket_start");

CREATE TABLE "integration"."gateway_replay" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "integration"."IntegrationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "credential_id" UUID NOT NULL,
  "signature_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "gateway_replay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gateway_replay_signature_key"
  ON "integration"."gateway_replay"("tenant_id", "credential_id", "signature_hash");
CREATE INDEX "gateway_replay_expiry_idx"
  ON "integration"."gateway_replay"("tenant_id", "expires_at");

ALTER TABLE "integration"."gateway_usage_bucket"
  ADD COLUMN "route" VARCHAR(300) NOT NULL DEFAULT '*';
