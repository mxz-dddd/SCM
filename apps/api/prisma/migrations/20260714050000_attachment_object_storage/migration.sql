-- CreateEnum
CREATE TYPE "platform"."FileObjectStatus" AS ENUM ('PENDING_UPLOAD', 'SCANNING', 'AVAILABLE', 'QUARANTINED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "platform"."VirusScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "platform"."DownloadGrantStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "platform"."file_object" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."FileObjectStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "bucket" VARCHAR(100) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(150) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "etag" VARCHAR(200),
    "scan_status" "platform"."VirusScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_engine" VARCHAR(100),
    "scan_engine_version" VARCHAR(100),
    "scan_details" JSONB NOT NULL DEFAULT '{}',
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "upload_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "retention_until" TIMESTAMPTZ(3) NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3),
    "scanned_at" TIMESTAMPTZ(3),

    CONSTRAINT "file_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."attachment_link" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "file_object_id" UUID NOT NULL,
    "business_domain" VARCHAR(50) NOT NULL,
    "object_type" VARCHAR(100) NOT NULL,
    "object_id" UUID NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "relation_type" VARCHAR(50) NOT NULL DEFAULT 'ATTACHMENT',
    "organization_id" UUID,

    CONSTRAINT "attachment_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."attachment_download_grant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."DownloadGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "file_object_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "watermark_text" VARCHAR(300) NOT NULL,
    "correlation_id" VARCHAR(100) NOT NULL,

    CONSTRAINT "attachment_download_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_object_tenant_status_created_idx" ON "platform"."file_object"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "file_object_tenant_scan_created_idx" ON "platform"."file_object"("tenant_id", "scan_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_object_tenant_object_key" ON "platform"."file_object"("tenant_id", "object_key");

-- CreateIndex
CREATE INDEX "attachment_link_tenant_business_object_idx" ON "platform"."attachment_link"("tenant_id", "business_domain", "object_type", "object_id", "status");

-- CreateIndex
CREATE INDEX "attachment_link_tenant_file_status_idx" ON "platform"."attachment_link"("tenant_id", "file_object_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_link_tenant_file_object_relation_key" ON "platform"."attachment_link"("tenant_id", "file_object_id", "business_domain", "object_type", "object_id", "relation_type");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_download_grant_token_key" ON "platform"."attachment_download_grant"("token_hash");

-- CreateIndex
CREATE INDEX "attachment_download_tenant_file_status_idx" ON "platform"."attachment_download_grant"("tenant_id", "file_object_id", "status", "expires_at");
