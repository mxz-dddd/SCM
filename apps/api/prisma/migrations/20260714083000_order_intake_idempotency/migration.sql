CREATE TYPE "oms"."OrderStatus" AS ENUM ('DRAFT', 'INVALID', 'OPEN');
CREATE TYPE "oms"."OrderType" AS ENUM ('SALES', 'PURCHASE', 'TRANSFER', 'RETURN');
CREATE TYPE "oms"."OrderChannel" AS ENUM ('API', 'EDI', 'FILE', 'PORTAL', 'MANUAL');
CREATE TYPE "oms"."OmsRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "oms"."DuplicateCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "oms"."raw_message_ref" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "channel" "oms"."OrderChannel" NOT NULL,
  "external_order_no" VARCHAR(200),
  "external_version" VARCHAR(100) NOT NULL,
  "mapping_version" VARCHAR(100) NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "file_object_id" UUID,
  CONSTRAINT "raw_message_ref_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "raw_message_version_positive" CHECK ("version" > 0),
  CONSTRAINT "raw_message_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "raw_message_payload_object" CHECK (jsonb_typeof("raw_payload") = 'object')
);

CREATE TABLE "oms"."business_order" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OrderStatus" NOT NULL DEFAULT 'DRAFT',
  "order_no" VARCHAR(100) NOT NULL,
  "type" "oms"."OrderType" NOT NULL,
  "channel" "oms"."OrderChannel" NOT NULL,
  "external_order_no" VARCHAR(200),
  "external_version" VARCHAR(100) NOT NULL DEFAULT '1',
  "mapping_version" VARCHAR(100) NOT NULL,
  "raw_message_ref_id" UUID NOT NULL,
  "source_payload_hash" CHAR(64) NOT NULL,
  "customer_id" UUID,
  "customer_snapshot" JSONB NOT NULL DEFAULT '{}',
  "delivery_address_id" UUID,
  "delivery_address_snapshot" JSONB NOT NULL DEFAULT '{}',
  "requested_from" TIMESTAMPTZ(3),
  "requested_until" TIMESTAMPTZ(3),
  "extensions" JSONB NOT NULL DEFAULT '{}',
  "required_extension_fields" JSONB NOT NULL DEFAULT '[]',
  "validation_errors" JSONB NOT NULL DEFAULT '[]',
  "warning_overrides" JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "business_order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_order_version_positive" CHECK ("version" > 0),
  CONSTRAINT "business_order_hash_format" CHECK ("source_payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "business_order_requested_range" CHECK ("requested_from" IS NULL OR "requested_until" IS NULL OR "requested_until" > "requested_from"),
  CONSTRAINT "business_order_customer_snapshot_object" CHECK (jsonb_typeof("customer_snapshot") = 'object'),
  CONSTRAINT "business_order_address_snapshot_object" CHECK (jsonb_typeof("delivery_address_snapshot") = 'object'),
  CONSTRAINT "business_order_extensions_object" CHECK (jsonb_typeof("extensions") = 'object'),
  CONSTRAINT "business_order_required_fields_array" CHECK (jsonb_typeof("required_extension_fields") = 'array'),
  CONSTRAINT "business_order_validation_errors_array" CHECK (jsonb_typeof("validation_errors") = 'array'),
  CONSTRAINT "business_order_warning_overrides_array" CHECK (jsonb_typeof("warning_overrides") = 'array')
);

CREATE TABLE "oms"."business_order_line" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "order_id" UUID NOT NULL,
  "line_no" INTEGER NOT NULL,
  "line_version" INTEGER NOT NULL,
  "product_id" UUID,
  "product_snapshot" JSONB NOT NULL DEFAULT '{}',
  "quantity_original" DECIMAL(24,12),
  "original_uom" VARCHAR(20),
  "quantity_base" DECIMAL(24,12),
  "base_uom" VARCHAR(20),
  "package_spec_id" UUID,
  "package_spec_version" INTEGER,
  "package_spec_snapshot" JSONB NOT NULL DEFAULT '{}',
  "requested_from" TIMESTAMPTZ(3),
  "requested_until" TIMESTAMPTZ(3),
  "raw_data" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "business_order_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_order_line_version_positive" CHECK ("version" > 0 AND "line_version" > 0),
  CONSTRAINT "business_order_line_number_positive" CHECK ("line_no" > 0),
  CONSTRAINT "business_order_line_quantity_positive" CHECK ("quantity_original" IS NULL OR "quantity_original" > 0),
  CONSTRAINT "business_order_line_base_quantity_positive" CHECK ("quantity_base" IS NULL OR "quantity_base" > 0),
  CONSTRAINT "business_order_line_requested_range" CHECK ("requested_from" IS NULL OR "requested_until" IS NULL OR "requested_until" > "requested_from"),
  CONSTRAINT "business_order_line_product_snapshot_object" CHECK (jsonb_typeof("product_snapshot") = 'object'),
  CONSTRAINT "business_order_line_package_snapshot_object" CHECK (jsonb_typeof("package_spec_snapshot") = 'object'),
  CONSTRAINT "business_order_line_raw_data_object" CHECK (jsonb_typeof("raw_data") = 'object')
);

CREATE TABLE "oms"."duplicate_case" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."DuplicateCaseStatus" NOT NULL DEFAULT 'OPEN',
  "business_order_id" UUID NOT NULL,
  "channel" "oms"."OrderChannel" NOT NULL,
  "external_order_no" VARCHAR(200) NOT NULL,
  "external_version" VARCHAR(100) NOT NULL,
  "existing_content_hash" CHAR(64) NOT NULL,
  "incoming_content_hash" CHAR(64) NOT NULL,
  "incoming_payload" JSONB NOT NULL,
  "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolution" VARCHAR(1000),
  CONSTRAINT "duplicate_case_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "duplicate_case_version_positive" CHECK ("version" > 0),
  CONSTRAINT "duplicate_case_hash_format" CHECK ("existing_content_hash" ~ '^[0-9a-f]{64}$' AND "incoming_content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "duplicate_case_payload_object" CHECK (jsonb_typeof("incoming_payload") = 'object')
);

CREATE TABLE "oms"."order_version" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "business_order_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "change_reason" VARCHAR(300) NOT NULL,
  CONSTRAINT "order_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_version_positive" CHECK ("version" > 0 AND "version_number" > 0),
  CONSTRAINT "order_version_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object')
);

CREATE TABLE "oms"."change_set" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "business_order_id" UUID NOT NULL,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "source" "oms"."OrderChannel" NOT NULL,
  "changes" JSONB NOT NULL,
  "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "change_set_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_set_version_positive" CHECK ("version" > 0 AND "from_version" > 0 AND "to_version" > "from_version"),
  CONSTRAINT "change_set_changes_object" CHECK (jsonb_typeof("changes") = 'object')
);

CREATE UNIQUE INDEX "business_order_tenant_type_no_key" ON "oms"."business_order"("tenant_id", "type", "order_no");
CREATE UNIQUE INDEX "business_order_tenant_external_key" ON "oms"."business_order"("tenant_id", "channel", "external_order_no", "external_version");
CREATE INDEX "business_order_tenant_status_created_idx" ON "oms"."business_order"("tenant_id", "status", "created_at", "id");
CREATE INDEX "business_order_tenant_customer_idx" ON "oms"."business_order"("tenant_id", "customer_id", "created_at");
CREATE UNIQUE INDEX "business_order_line_tenant_order_line_version_key" ON "oms"."business_order_line"("tenant_id", "order_id", "line_no", "line_version");
CREATE UNIQUE INDEX "business_order_line_one_active_key" ON "oms"."business_order_line"("tenant_id", "order_id", "line_no") WHERE "status" = 'ACTIVE';
CREATE INDEX "business_order_line_tenant_order_idx" ON "oms"."business_order_line"("tenant_id", "order_id", "status", "line_no");
CREATE INDEX "business_order_line_tenant_product_idx" ON "oms"."business_order_line"("tenant_id", "product_id", "status");
CREATE INDEX "raw_message_tenant_external_idx" ON "oms"."raw_message_ref"("tenant_id", "channel", "external_order_no", "created_at");
CREATE INDEX "raw_message_tenant_hash_idx" ON "oms"."raw_message_ref"("tenant_id", "content_hash");
CREATE INDEX "duplicate_case_tenant_status_created_idx" ON "oms"."duplicate_case"("tenant_id", "status", "created_at");
CREATE INDEX "duplicate_case_tenant_order_idx" ON "oms"."duplicate_case"("tenant_id", "business_order_id", "created_at");
CREATE UNIQUE INDEX "order_version_tenant_order_version_key" ON "oms"."order_version"("tenant_id", "business_order_id", "version_number");
CREATE INDEX "order_version_tenant_order_idx" ON "oms"."order_version"("tenant_id", "business_order_id", "created_at");
CREATE UNIQUE INDEX "change_set_tenant_order_version_key" ON "oms"."change_set"("tenant_id", "business_order_id", "to_version");
CREATE INDEX "change_set_tenant_order_idx" ON "oms"."change_set"("tenant_id", "business_order_id", "applied_at");

CREATE OR REPLACE FUNCTION "oms"."reject_order_fact_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OMS order fact rows are immutable' USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "raw_message_immutable" BEFORE UPDATE OR DELETE ON "oms"."raw_message_ref" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "order_version_immutable" BEFORE UPDATE OR DELETE ON "oms"."order_version" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "change_set_immutable" BEFORE UPDATE OR DELETE ON "oms"."change_set" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
