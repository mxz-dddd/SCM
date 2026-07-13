-- CreateEnum
CREATE TYPE "platform"."ImportJobStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "platform"."ImportFileFormat" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "platform"."ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "platform"."ExportFileFormat" AS ENUM ('CSV');

-- CreateEnum
CREATE TYPE "platform"."DownloadTokenStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "platform"."SavedViewVisibility" AS ENUM ('PERSONAL', 'SHARED');

-- CreateTable
CREATE TABLE "platform"."import_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
    "file_object_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "format" "platform"."ImportFileFormat" NOT NULL,
    "import_type" VARCHAR(100) NOT NULL,
    "configuration" JSONB NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "receipt" JSONB NOT NULL DEFAULT '{}',
    "failure_code" VARCHAR(100),
    "validation_started_at" TIMESTAMPTZ(3),
    "validated_at" TIMESTAMPTZ(3),
    "import_started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."import_row_error" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "import_job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "column_name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "value_snapshot" VARCHAR(500),

    CONSTRAINT "import_row_error_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."export_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "requester_id" UUID NOT NULL,
    "resource_type" VARCHAR(100) NOT NULL,
    "format" "platform"."ExportFileFormat" NOT NULL DEFAULT 'CSV',
    "query_spec" JSONB NOT NULL,
    "columns" JSONB NOT NULL,
    "sort" JSONB NOT NULL DEFAULT '[]',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "result_content" TEXT,
    "content_type" VARCHAR(100),
    "expires_at" TIMESTAMPTZ(3),
    "failure_code" VARCHAR(100),
    "processing_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."export_download_token" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."DownloadTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "export_job_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "correlation_id" VARCHAR(100) NOT NULL,

    CONSTRAINT "export_download_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."search_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "business_domain" VARCHAR(50) NOT NULL,
    "object_type" VARCHAR(100) NOT NULL,
    "object_id" UUID NOT NULL,
    "business_ref" VARCHAR(200) NOT NULL,
    "external_ref" VARCHAR(200),
    "partner_name" VARCHAR(300),
    "product_name" VARCHAR(300),
    "business_status" VARCHAR(100) NOT NULL,
    "organization_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "route" VARCHAR(500) NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "search_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."search_query" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "query_text" VARCHAR(300),
    "criteria" JSONB NOT NULL,
    "result_count" INTEGER NOT NULL,
    "executed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."saved_view" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_account_id" UUID NOT NULL,
    "resource_type" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "visibility" "platform"."SavedViewVisibility" NOT NULL DEFAULT 'PERSONAL',
    "filters" JSONB NOT NULL,
    "columns" JSONB NOT NULL,
    "sort" JSONB NOT NULL DEFAULT '[]',
    "aggregation" JSONB NOT NULL DEFAULT '{}',
    "quick_filters" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_job_tenant_status_created_idx" ON "platform"."import_job"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "import_job_tenant_type_created_idx" ON "platform"."import_job"("tenant_id", "import_type", "created_at");

-- CreateIndex
CREATE INDEX "import_row_error_tenant_job_row_idx" ON "platform"."import_row_error"("tenant_id", "import_job_id", "row_number");

-- CreateIndex
CREATE INDEX "export_job_tenant_requester_status_created_idx" ON "platform"."export_job"("tenant_id", "requester_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "export_job_tenant_resource_created_idx" ON "platform"."export_job"("tenant_id", "resource_type", "created_at");

-- CreateIndex
CREATE INDEX "export_download_tenant_job_status_idx" ON "platform"."export_download_token"("tenant_id", "export_job_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "export_download_token_tenant_token_key" ON "platform"."export_download_token"("tenant_id", "token_hash");

-- CreateIndex
CREATE INDEX "search_document_tenant_business_occurred_idx" ON "platform"."search_document"("tenant_id", "business_ref", "occurred_at");

-- CreateIndex
CREATE INDEX "search_document_tenant_external_occurred_idx" ON "platform"."search_document"("tenant_id", "external_ref", "occurred_at");

-- CreateIndex
CREATE INDEX "search_document_tenant_status_occurred_idx" ON "platform"."search_document"("tenant_id", "business_status", "occurred_at");

-- CreateIndex
CREATE INDEX "search_document_tenant_org_occurred_idx" ON "platform"."search_document"("tenant_id", "organization_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "search_document_tenant_domain_type_object_key" ON "platform"."search_document"("tenant_id", "business_domain", "object_type", "object_id");

-- CreateIndex
CREATE INDEX "search_query_tenant_account_executed_idx" ON "platform"."search_query"("tenant_id", "account_id", "executed_at");

-- CreateIndex
CREATE INDEX "saved_view_tenant_resource_visibility_status_idx" ON "platform"."saved_view"("tenant_id", "resource_type", "visibility", "status");

-- CreateIndex
CREATE UNIQUE INDEX "saved_view_tenant_owner_resource_name_key" ON "platform"."saved_view"("tenant_id", "owner_account_id", "resource_type", "name");
