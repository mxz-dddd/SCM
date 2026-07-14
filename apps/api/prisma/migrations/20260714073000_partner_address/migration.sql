CREATE TYPE "mdm"."PartnerStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE');
CREATE TYPE "mdm"."PartnerRoleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."PartnerRoleType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'CARRIER');
CREATE TYPE "mdm"."PartnerContactStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."PartnerCertificateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');
CREATE TYPE "mdm"."AddressStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."GeocodeStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'MANUAL_CORRECTION');
CREATE TYPE "mdm"."ServiceZoneStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."ServiceZoneType" AS ENUM ('POSTAL_PREFIX', 'POLYGON', 'RADIUS');
CREATE TYPE "mdm"."ExternalCodeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "mdm"."partner" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."PartnerStatus" NOT NULL DEFAULT 'DRAFT',
  "code" VARCHAR(100) NOT NULL, "legal_name" VARCHAR(300) NOT NULL, "short_name" VARCHAR(200),
  "registration_no" VARCHAR(100), "tax_id" VARCHAR(100),
  "credit_limit" DECIMAL(24,6), "credit_currency" CHAR(3), "payment_terms" VARCHAR(200),
  "service_capabilities" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "partner_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_identity_present" CHECK (length(btrim("code")) > 0 AND length(btrim("legal_name")) > 0),
  CONSTRAINT "partner_credit_valid" CHECK (("credit_limit" IS NULL) = ("credit_currency" IS NULL) AND ("credit_limit" IS NULL OR "credit_limit" >= 0)),
  CONSTRAINT "partner_capabilities_object" CHECK (jsonb_typeof("service_capabilities") = 'object'),
  CONSTRAINT "partner_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "mdm"."partner_role" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."PartnerRoleStatus" NOT NULL DEFAULT 'ACTIVE',
  "partner_id" UUID NOT NULL, "role_type" "mdm"."PartnerRoleType" NOT NULL,
  "capabilities" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "partner_role_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_role_capabilities_object" CHECK (jsonb_typeof("capabilities") = 'object'),
  CONSTRAINT "partner_role_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "mdm"."partner_contact" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."PartnerContactStatus" NOT NULL DEFAULT 'ACTIVE',
  "partner_id" UUID NOT NULL, "name" VARCHAR(200) NOT NULL, "title" VARCHAR(100),
  "email" VARCHAR(320), "phone" VARCHAR(50), "is_primary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "partner_contact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_contact_present" CHECK (length(btrim("name")) > 0 AND ("email" IS NOT NULL OR "phone" IS NOT NULL)),
  CONSTRAINT "partner_contact_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "mdm"."partner_certificate" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."PartnerCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
  "partner_id" UUID NOT NULL, "certificate_type" VARCHAR(100) NOT NULL, "certificate_no" VARCHAR(150) NOT NULL,
  "issued_by" VARCHAR(200), "valid_from" DATE, "valid_until" DATE, "attachment_id" UUID,
  CONSTRAINT "partner_certificate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_certificate_present" CHECK (length(btrim("certificate_type")) > 0 AND length(btrim("certificate_no")) > 0),
  CONSTRAINT "partner_certificate_dates" CHECK ("valid_until" IS NULL OR "valid_from" IS NULL OR "valid_until" >= "valid_from"),
  CONSTRAINT "partner_certificate_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "mdm"."partner_address" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."AddressStatus" NOT NULL DEFAULT 'ACTIVE',
  "partner_id" UUID NOT NULL, "code" VARCHAR(100) NOT NULL, "address_type" VARCHAR(50) NOT NULL,
  "raw_text" VARCHAR(2000) NOT NULL, "line1" VARCHAR(500), "line2" VARCHAR(500),
  "city" VARCHAR(100), "district" VARCHAR(100), "province" VARCHAR(100), "postal_code" VARCHAR(30),
  "country_code" CHAR(2) NOT NULL, "administrative_code" VARCHAR(50),
  "time_window_from" VARCHAR(5), "time_window_until" VARCHAR(5), "access_instructions" VARCHAR(2000),
  "geocode_status" "mdm"."GeocodeStatus" NOT NULL DEFAULT 'PENDING',
  "longitude" DECIMAL(12,8), "latitude" DECIMAL(12,8), "geocode_provider" VARCHAR(100),
  "geocode_reference" VARCHAR(200), "geocode_failure_reason" VARCHAR(500), "geocoded_at" TIMESTAMPTZ(3),
  "corrected_at" TIMESTAMPTZ(3), "corrected_by" UUID, "geo_fence" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "partner_address_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_address_identity_present" CHECK (length(btrim("code")) > 0 AND length(btrim("address_type")) > 0 AND length(btrim("raw_text")) > 0),
  CONSTRAINT "partner_address_country" CHECK ("country_code" ~ '^[A-Z]{2}$'),
  CONSTRAINT "partner_address_time_window" CHECK (
    ("time_window_from" IS NULL) = ("time_window_until" IS NULL)
    AND ("time_window_from" IS NULL OR ("time_window_from" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "time_window_until" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
  ),
  CONSTRAINT "partner_address_coordinates" CHECK (
    ("longitude" IS NULL) = ("latitude" IS NULL)
    AND ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180 AND "latitude" BETWEEN -90 AND 90))
  ),
  CONSTRAINT "partner_address_geocode_state" CHECK (
    ("geocode_status" IN ('PENDING', 'FAILED') OR ("longitude" IS NOT NULL AND "geocoded_at" IS NOT NULL))
    AND ("geocode_status" <> 'FAILED' OR "geocode_failure_reason" IS NOT NULL)
    AND ("geocode_status" <> 'MANUAL_CORRECTION' OR ("corrected_at" IS NOT NULL AND "corrected_by" IS NOT NULL))
  ),
  CONSTRAINT "partner_address_fence_object" CHECK (jsonb_typeof("geo_fence") = 'object'),
  CONSTRAINT "partner_address_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "mdm"."service_zone" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."ServiceZoneStatus" NOT NULL DEFAULT 'DRAFT',
  "partner_id" UUID, "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL,
  "zone_type" "mdm"."ServiceZoneType" NOT NULL, "geometry" JSONB NOT NULL DEFAULT '{}',
  "postal_prefixes" JSONB NOT NULL DEFAULT '[]', "center_longitude" DECIMAL(12,8), "center_latitude" DECIMAL(12,8),
  "radius_km" DECIMAL(18,6), "service_capabilities" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "service_zone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_zone_identity_present" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0),
  CONSTRAINT "service_zone_json" CHECK (jsonb_typeof("geometry") = 'object' AND jsonb_typeof("postal_prefixes") = 'array' AND jsonb_typeof("service_capabilities") = 'object'),
  CONSTRAINT "service_zone_coordinates" CHECK (
    ("center_longitude" IS NULL) = ("center_latitude" IS NULL)
    AND ("center_longitude" IS NULL OR ("center_longitude" BETWEEN -180 AND 180 AND "center_latitude" BETWEEN -90 AND 90))
  ),
  CONSTRAINT "service_zone_definition" CHECK (
    ("zone_type" = 'POSTAL_PREFIX' AND jsonb_array_length("postal_prefixes") > 0)
    OR ("zone_type" = 'POLYGON' AND "geometry" <> '{}'::jsonb)
    OR ("zone_type" = 'RADIUS' AND "center_longitude" IS NOT NULL AND "radius_km" > 0)
  ),
  CONSTRAINT "service_zone_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "mdm"."external_code_map" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."ExternalCodeStatus" NOT NULL DEFAULT 'ACTIVE',
  "source_system" VARCHAR(100) NOT NULL, "object_type" VARCHAR(100) NOT NULL, "object_id" UUID NOT NULL,
  "external_code" VARCHAR(200) NOT NULL, "version_number" INTEGER NOT NULL,
  "mapping_snapshot" JSONB NOT NULL DEFAULT '{}', "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effective_until" TIMESTAMPTZ(3),
  CONSTRAINT "external_code_map_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_code_identity_present" CHECK (length(btrim("source_system")) > 0 AND length(btrim("object_type")) > 0 AND length(btrim("external_code")) > 0),
  CONSTRAINT "external_code_snapshot_object" CHECK (jsonb_typeof("mapping_snapshot") = 'object'),
  CONSTRAINT "external_code_versions_positive" CHECK ("version" > 0 AND "version_number" > 0),
  CONSTRAINT "external_code_effective_range" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from")
);

CREATE INDEX "partner_tenant_status_name_idx" ON "mdm"."partner"("tenant_id", "status", "legal_name");
CREATE UNIQUE INDEX "partner_tenant_code_key" ON "mdm"."partner"("tenant_id", "code");
CREATE INDEX "partner_role_tenant_type_status_idx" ON "mdm"."partner_role"("tenant_id", "role_type", "status");
CREATE UNIQUE INDEX "partner_role_tenant_partner_type_key" ON "mdm"."partner_role"("tenant_id", "partner_id", "role_type");
CREATE INDEX "partner_contact_tenant_partner_idx" ON "mdm"."partner_contact"("tenant_id", "partner_id", "status");
CREATE INDEX "partner_certificate_tenant_partner_expiry_idx" ON "mdm"."partner_certificate"("tenant_id", "partner_id", "status", "valid_until");
CREATE UNIQUE INDEX "partner_certificate_tenant_partner_type_no_key" ON "mdm"."partner_certificate"("tenant_id", "partner_id", "certificate_type", "certificate_no");
CREATE INDEX "partner_address_tenant_partner_idx" ON "mdm"."partner_address"("tenant_id", "partner_id", "status");
CREATE INDEX "partner_address_tenant_geocode_idx" ON "mdm"."partner_address"("tenant_id", "geocode_status", "updated_at");
CREATE UNIQUE INDEX "partner_address_tenant_partner_code_key" ON "mdm"."partner_address"("tenant_id", "partner_id", "code");
CREATE INDEX "service_zone_tenant_status_type_idx" ON "mdm"."service_zone"("tenant_id", "status", "zone_type");
CREATE INDEX "service_zone_tenant_partner_idx" ON "mdm"."service_zone"("tenant_id", "partner_id", "status");
CREATE UNIQUE INDEX "service_zone_tenant_code_key" ON "mdm"."service_zone"("tenant_id", "code");
CREATE INDEX "external_code_tenant_object_idx" ON "mdm"."external_code_map"("tenant_id", "object_type", "object_id", "status");
CREATE INDEX "external_code_tenant_lookup_idx" ON "mdm"."external_code_map"("tenant_id", "source_system", "object_type", "external_code", "status");
CREATE UNIQUE INDEX "external_code_tenant_source_type_code_version_key" ON "mdm"."external_code_map"("tenant_id", "source_system", "object_type", "external_code", "version_number");
CREATE UNIQUE INDEX "external_code_active_lookup_key" ON "mdm"."external_code_map"("tenant_id", "source_system", "object_type", "external_code") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "external_code_active_object_key" ON "mdm"."external_code_map"("tenant_id", "source_system", "object_type", "object_id") WHERE "status" = 'ACTIVE';

CREATE OR REPLACE FUNCTION "mdm"."preserve_partner_address_raw_text"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.raw_text <> NEW.raw_text THEN
    RAISE EXCEPTION 'partner address raw text is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_address_raw_text_immutable
BEFORE UPDATE ON "mdm"."partner_address"
FOR EACH ROW EXECUTE FUNCTION "mdm"."preserve_partner_address_raw_text"();

CREATE OR REPLACE FUNCTION "mdm"."preserve_external_code_history"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'external code mapping history is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'INACTIVE' THEN
    RAISE EXCEPTION 'inactive external code mapping history is immutable' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'updated_by', 'version', 'effective_until']) <>
     (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'updated_by', 'version', 'effective_until']) THEN
    RAISE EXCEPTION 'external code mapping versions cannot be overwritten' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER external_code_history_immutable
BEFORE UPDATE OR DELETE ON "mdm"."external_code_map"
FOR EACH ROW EXECUTE FUNCTION "mdm"."preserve_external_code_history"();
