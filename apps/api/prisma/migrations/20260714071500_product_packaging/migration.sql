CREATE TYPE "mdm"."ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."ProductCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."ProductVersionStatus" AS ENUM ('PUBLISHED');
CREATE TYPE "mdm"."BarcodeStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."BarcodeType" AS ENUM ('GTIN', 'EAN', 'UPC', 'GS1', 'CUSTOMER', 'INTERNAL');
CREATE TYPE "mdm"."BatchControl" AS ENUM ('NONE', 'OPTIONAL', 'REQUIRED');
CREATE TYPE "mdm"."SerialControl" AS ENUM ('NONE', 'OPTIONAL', 'REQUIRED');
CREATE TYPE "mdm"."TemperatureZone" AS ENUM ('AMBIENT', 'CHILLED', 'FROZEN', 'CONTROLLED');
CREATE TYPE "mdm"."PackageSpecStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "mdm"."PackageLevel" AS ENUM ('EACH', 'INNER', 'CASE', 'PALLET', 'CUSTOM');

CREATE TABLE "mdm"."product_category" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "mdm"."ProductCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "code" VARCHAR(100) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "parent_id" UUID,
  "path" VARCHAR(1000) NOT NULL,
  CONSTRAINT "product_category_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_category_code_present" CHECK (length(btrim("code")) > 0),
  CONSTRAINT "product_category_name_present" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "product_category_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "mdm"."product" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "mdm"."ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "sku" VARCHAR(100) NOT NULL,
  "name" VARCHAR(300) NOT NULL,
  "category_id" UUID,
  "category_snapshot" JSONB NOT NULL DEFAULT '{}',
  "base_uom" VARCHAR(20) NOT NULL,
  "temperature_zone" "mdm"."TemperatureZone" NOT NULL DEFAULT 'AMBIENT',
  "hazardous" BOOLEAN NOT NULL DEFAULT false,
  "hazardous_attributes" JSONB NOT NULL DEFAULT '{}',
  "batch_control" "mdm"."BatchControl" NOT NULL DEFAULT 'NONE',
  "serial_control" "mdm"."SerialControl" NOT NULL DEFAULT 'NONE',
  "shelf_life_days" INTEGER,
  "minimum_remaining_days" INTEGER,
  "current_version_number" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_identity_present" CHECK (length(btrim("sku")) > 0 AND length(btrim("name")) > 0 AND length(btrim("base_uom")) > 0),
  CONSTRAINT "product_json_objects" CHECK (jsonb_typeof("category_snapshot") = 'object' AND jsonb_typeof("hazardous_attributes") = 'object'),
  CONSTRAINT "product_versions_nonnegative" CHECK ("version" > 0 AND "current_version_number" >= 0),
  CONSTRAINT "product_shelf_life_valid" CHECK (
    ("shelf_life_days" IS NULL OR "shelf_life_days" > 0)
    AND ("minimum_remaining_days" IS NULL OR "minimum_remaining_days" >= 0)
    AND ("minimum_remaining_days" IS NULL OR "shelf_life_days" IS NOT NULL)
    AND ("minimum_remaining_days" IS NULL OR "minimum_remaining_days" <= "shelf_life_days")
  )
);

CREATE TABLE "mdm"."product_version" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "mdm"."ProductVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
  "product_id" UUID NOT NULL,
  "sku" VARCHAR(100) NOT NULL,
  "version_number" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_version_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "product_version_numbers_positive" CHECK ("version" > 0 AND "version_number" > 0)
);

CREATE TABLE "mdm"."product_barcode" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "mdm"."BarcodeStatus" NOT NULL DEFAULT 'ACTIVE',
  "product_id" UUID NOT NULL,
  "package_spec_id" UUID,
  "customer_id" UUID,
  "barcode" VARCHAR(200) NOT NULL,
  "type" "mdm"."BarcodeType" NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "product_barcode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_barcode_present" CHECK (length(btrim("barcode")) > 0),
  CONSTRAINT "product_barcode_customer_scope" CHECK (("type" = 'CUSTOMER') = ("customer_id" IS NOT NULL)),
  CONSTRAINT "product_barcode_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "mdm"."package_spec" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "mdm"."PackageSpecStatus" NOT NULL DEFAULT 'DRAFT',
  "product_id" UUID NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "version_number" INTEGER NOT NULL,
  "level" "mdm"."PackageLevel" NOT NULL,
  "customer_id" UUID,
  "parent_spec_id" UUID,
  "original_uom" VARCHAR(20) NOT NULL,
  "base_uom" VARCHAR(20) NOT NULL,
  "quantity_in_base" DECIMAL(24,12) NOT NULL,
  "net_weight" DECIMAL(24,12),
  "gross_weight" DECIMAL(24,12),
  "weight_uom" VARCHAR(20),
  "length" DECIMAL(24,12),
  "width" DECIMAL(24,12),
  "height" DECIMAL(24,12),
  "dimension_uom" VARCHAR(20),
  "volume" DECIMAL(24,12),
  "volume_uom" VARCHAR(20),
  "published_at" TIMESTAMPTZ(3),
  CONSTRAINT "package_spec_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_spec_identity_present" CHECK (
    length(btrim("code")) > 0 AND length(btrim("name")) > 0
    AND length(btrim("original_uom")) > 0 AND length(btrim("base_uom")) > 0
  ),
  CONSTRAINT "package_spec_numbers_positive" CHECK (
    "version" > 0 AND "version_number" > 0 AND "quantity_in_base" > 0
    AND ("net_weight" IS NULL OR "net_weight" >= 0)
    AND ("gross_weight" IS NULL OR "gross_weight" >= 0)
    AND ("length" IS NULL OR "length" >= 0)
    AND ("width" IS NULL OR "width" >= 0)
    AND ("height" IS NULL OR "height" >= 0)
    AND ("volume" IS NULL OR "volume" >= 0)
  ),
  CONSTRAINT "package_spec_weight_uom_required" CHECK (("net_weight" IS NULL AND "gross_weight" IS NULL) OR "weight_uom" IS NOT NULL),
  CONSTRAINT "package_spec_dimension_uom_required" CHECK (("length" IS NULL AND "width" IS NULL AND "height" IS NULL) OR "dimension_uom" IS NOT NULL),
  CONSTRAINT "package_spec_volume_uom_required" CHECK ("volume" IS NULL OR "volume_uom" IS NOT NULL),
  CONSTRAINT "package_spec_publish_timestamp" CHECK (("status" = 'DRAFT' AND "published_at" IS NULL) OR ("status" <> 'DRAFT' AND "published_at" IS NOT NULL))
);

CREATE INDEX "product_category_tenant_parent_idx" ON "mdm"."product_category"("tenant_id", "parent_id", "status");
CREATE UNIQUE INDEX "product_category_tenant_code_key" ON "mdm"."product_category"("tenant_id", "code");
CREATE INDEX "product_tenant_status_category_sku_idx" ON "mdm"."product"("tenant_id", "status", "category_id", "sku");
CREATE UNIQUE INDEX "product_tenant_sku_key" ON "mdm"."product"("tenant_id", "sku");
CREATE INDEX "product_version_tenant_sku_version_idx" ON "mdm"."product_version"("tenant_id", "sku", "version_number");
CREATE UNIQUE INDEX "product_version_tenant_product_version_key" ON "mdm"."product_version"("tenant_id", "product_id", "version_number");
CREATE INDEX "product_barcode_tenant_product_idx" ON "mdm"."product_barcode"("tenant_id", "product_id", "status");
CREATE INDEX "product_barcode_tenant_resolution_idx" ON "mdm"."product_barcode"("tenant_id", "barcode", "customer_id", "status");
CREATE UNIQUE INDEX "product_barcode_tenant_scope_barcode_key" ON "mdm"."product_barcode"(
  "tenant_id", "barcode", COALESCE("customer_id", '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX "package_spec_tenant_product_status_level_idx" ON "mdm"."package_spec"("tenant_id", "product_id", "status", "level");
CREATE INDEX "package_spec_tenant_customer_status_idx" ON "mdm"."package_spec"("tenant_id", "customer_id", "status");
CREATE UNIQUE INDEX "package_spec_tenant_product_code_version_key" ON "mdm"."package_spec"("tenant_id", "product_id", "code", "version_number");

CREATE TRIGGER product_version_immutable
BEFORE UPDATE OR DELETE ON "mdm"."product_version"
FOR EACH ROW EXECUTE FUNCTION "platform"."reject_audit_mutation"();

CREATE OR REPLACE FUNCTION "mdm"."reject_published_package_spec_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status::text IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'published package specifications are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text IN ('PUBLISHED', 'RETIRED') AND
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'updated_by', 'version']) <>
     (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'updated_by', 'version']) THEN
    RAISE EXCEPTION 'published package specifications are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER package_spec_published_immutable
BEFORE UPDATE OR DELETE ON "mdm"."package_spec"
FOR EACH ROW EXECUTE FUNCTION "mdm"."reject_published_package_spec_mutation"();
