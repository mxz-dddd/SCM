CREATE TYPE "mdm"."WarehouseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."MdmResourceStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "mdm"."LocationType" AS ENUM ('ZONE', 'AISLE', 'LOCATION', 'STAGING');
CREATE TYPE "mdm"."FleetStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'UNAVAILABLE', 'INACTIVE');
CREATE TYPE "mdm"."DriverCertificateStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

CREATE TABLE "mdm"."warehouse" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."WarehouseStatus" NOT NULL DEFAULT 'DRAFT',
 "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "address_id" UUID, "time_zone" VARCHAR(100) NOT NULL, "temperature_capabilities" JSONB NOT NULL DEFAULT '[]', "service_capabilities" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "warehouse_fields_valid" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND length(btrim("time_zone")) > 0 AND "version" > 0),
 CONSTRAINT "warehouse_json_valid" CHECK (jsonb_typeof("temperature_capabilities") = 'array' AND jsonb_typeof("service_capabilities") = 'object')
);
CREATE TABLE "mdm"."warehouse_usage_projection" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE',
 "warehouse_id" UUID NOT NULL, "inventory_quantity" DECIMAL(24,12) NOT NULL DEFAULT 0, "open_task_count" INTEGER NOT NULL DEFAULT 0, "future_appointment_count" INTEGER NOT NULL DEFAULT 0, "source_versions" JSONB NOT NULL DEFAULT '{}', "projected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "warehouse_usage_nonnegative" CHECK ("inventory_quantity" >= 0 AND "open_task_count" >= 0 AND "future_appointment_count" >= 0 AND "version" > 0), CONSTRAINT "warehouse_usage_versions_object" CHECK (jsonb_typeof("source_versions") = 'object')
);
CREATE TABLE "mdm"."warehouse_location" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE',
 "warehouse_id" UUID NOT NULL, "parent_id" UUID, "type" "mdm"."LocationType" NOT NULL, "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "sequence" INTEGER NOT NULL DEFAULT 0, "max_weight" DECIMAL(24,12), "weight_uom" VARCHAR(20), "max_volume" DECIMAL(24,12), "volume_uom" VARCHAR(20), "pallet_capacity" DECIMAL(24,12), "temperature_zone" "mdm"."TemperatureZone", "hazardous_allowed" BOOLEAN NOT NULL DEFAULT false, "mixing_rules" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "warehouse_location_values" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND "sequence" >= 0 AND "version" > 0 AND ("max_weight" IS NULL OR "max_weight" >= 0) AND ("max_volume" IS NULL OR "max_volume" >= 0) AND ("pallet_capacity" IS NULL OR "pallet_capacity" >= 0)),
 CONSTRAINT "warehouse_location_uoms" CHECK (("max_weight" IS NULL OR "weight_uom" IS NOT NULL) AND ("max_volume" IS NULL OR "volume_uom" IS NOT NULL) AND jsonb_typeof("mixing_rules") = 'object')
);
CREATE TABLE "mdm"."warehouse_dock" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE',
 "warehouse_id" UUID NOT NULL, "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "max_vehicle_weight" DECIMAL(24,12), "max_vehicle_length" DECIMAL(24,12), "temperature_capabilities" JSONB NOT NULL DEFAULT '[]', "service_capabilities" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "warehouse_dock_valid" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND "version" > 0 AND ("max_vehicle_weight" IS NULL OR "max_vehicle_weight" >= 0) AND ("max_vehicle_length" IS NULL OR "max_vehicle_length" >= 0) AND jsonb_typeof("temperature_capabilities") = 'array' AND jsonb_typeof("service_capabilities") = 'object')
);
CREATE TABLE "mdm"."warehouse_gate" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE',
 "warehouse_id" UUID NOT NULL, "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "direction" VARCHAR(20) NOT NULL, "access_instructions" VARCHAR(1000), "service_capabilities" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "warehouse_gate_valid" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND "direction" IN ('IN','OUT','BOTH') AND "version" > 0 AND jsonb_typeof("service_capabilities") = 'object')
);
CREATE TABLE "mdm"."equipment_type" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."MdmResourceStatus" NOT NULL DEFAULT 'ACTIVE',
 "code" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "max_payload" DECIMAL(24,12) NOT NULL, "payload_uom" VARCHAR(20) NOT NULL, "max_volume" DECIMAL(24,12) NOT NULL, "volume_uom" VARCHAR(20) NOT NULL, "temperature_controlled" BOOLEAN NOT NULL DEFAULT false, "service_capabilities" JSONB NOT NULL DEFAULT '{}',
 CONSTRAINT "equipment_type_valid" CHECK (length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND "max_payload" > 0 AND "max_volume" > 0 AND "version" > 0 AND jsonb_typeof("service_capabilities") = 'object')
);
CREATE TABLE "mdm"."vehicle" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."FleetStatus" NOT NULL DEFAULT 'DRAFT',
 "plate_number" VARCHAR(50) NOT NULL, "equipment_type_id" UUID NOT NULL, "carrier_partner_id" UUID, "max_payload" DECIMAL(24,12) NOT NULL, "payload_uom" VARCHAR(20) NOT NULL, "max_volume" DECIMAL(24,12) NOT NULL, "volume_uom" VARCHAR(20) NOT NULL, "temperature_controlled" BOOLEAN NOT NULL DEFAULT false, "temperature_min" DECIMAL(8,3), "temperature_max" DECIMAL(8,3), "unavailable_reason" VARCHAR(500),
 CONSTRAINT "vehicle_valid" CHECK (length(btrim("plate_number")) > 0 AND "max_payload" > 0 AND "max_volume" > 0 AND "version" > 0 AND ("temperature_min" IS NULL) = ("temperature_max" IS NULL) AND ("temperature_min" IS NULL OR "temperature_min" <= "temperature_max") AND (NOT "temperature_controlled" OR "temperature_min" IS NOT NULL)),
 CONSTRAINT "vehicle_unavailable_reason" CHECK ("status" <> 'UNAVAILABLE' OR "unavailable_reason" IS NOT NULL)
);
CREATE TABLE "mdm"."driver" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."FleetStatus" NOT NULL DEFAULT 'DRAFT',
 "driver_no" VARCHAR(100) NOT NULL, "name" VARCHAR(200) NOT NULL, "carrier_partner_id" UUID, "phone" VARCHAR(50) NOT NULL, "identity_ref" VARCHAR(200), "unavailable_reason" VARCHAR(500),
 CONSTRAINT "driver_valid" CHECK (length(btrim("driver_no")) > 0 AND length(btrim("name")) > 0 AND length(btrim("phone")) > 0 AND "version" > 0), CONSTRAINT "driver_unavailable_reason" CHECK ("status" <> 'UNAVAILABLE' OR "unavailable_reason" IS NOT NULL)
);
CREATE TABLE "mdm"."driver_certificate" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL, "updated_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" "mdm"."DriverCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
 "driver_id" UUID NOT NULL, "certificate_type" VARCHAR(100) NOT NULL, "certificate_no" VARCHAR(150) NOT NULL, "valid_from" DATE NOT NULL, "valid_until" DATE NOT NULL, "required_for_assignment" BOOLEAN NOT NULL DEFAULT true, "attachment_id" UUID,
 CONSTRAINT "driver_certificate_valid" CHECK (length(btrim("certificate_type")) > 0 AND length(btrim("certificate_no")) > 0 AND "valid_until" >= "valid_from" AND "version" > 0)
);

CREATE UNIQUE INDEX "warehouse_tenant_code_key" ON "mdm"."warehouse"("tenant_id","code"); CREATE INDEX "warehouse_tenant_status_name_idx" ON "mdm"."warehouse"("tenant_id","status","name");
CREATE UNIQUE INDEX "warehouse_usage_tenant_warehouse_key" ON "mdm"."warehouse_usage_projection"("tenant_id","warehouse_id"); CREATE INDEX "warehouse_usage_tenant_projected_idx" ON "mdm"."warehouse_usage_projection"("tenant_id","projected_at");
CREATE UNIQUE INDEX "warehouse_location_tenant_warehouse_code_key" ON "mdm"."warehouse_location"("tenant_id","warehouse_id","code"); CREATE INDEX "warehouse_location_tenant_parent_idx" ON "mdm"."warehouse_location"("tenant_id","warehouse_id","parent_id","status");
CREATE UNIQUE INDEX "warehouse_dock_tenant_warehouse_code_key" ON "mdm"."warehouse_dock"("tenant_id","warehouse_id","code"); CREATE INDEX "warehouse_dock_tenant_status_idx" ON "mdm"."warehouse_dock"("tenant_id","warehouse_id","status");
CREATE UNIQUE INDEX "warehouse_gate_tenant_warehouse_code_key" ON "mdm"."warehouse_gate"("tenant_id","warehouse_id","code"); CREATE INDEX "warehouse_gate_tenant_status_idx" ON "mdm"."warehouse_gate"("tenant_id","warehouse_id","status");
CREATE UNIQUE INDEX "equipment_type_tenant_code_key" ON "mdm"."equipment_type"("tenant_id","code"); CREATE INDEX "equipment_type_tenant_status_idx" ON "mdm"."equipment_type"("tenant_id","status");
CREATE UNIQUE INDEX "vehicle_tenant_plate_key" ON "mdm"."vehicle"("tenant_id","plate_number"); CREATE INDEX "vehicle_tenant_status_type_idx" ON "mdm"."vehicle"("tenant_id","status","equipment_type_id");
CREATE UNIQUE INDEX "driver_tenant_no_key" ON "mdm"."driver"("tenant_id","driver_no"); CREATE INDEX "driver_tenant_status_carrier_idx" ON "mdm"."driver"("tenant_id","status","carrier_partner_id");
CREATE UNIQUE INDEX "driver_certificate_tenant_driver_type_no_key" ON "mdm"."driver_certificate"("tenant_id","driver_id","certificate_type","certificate_no"); CREATE INDEX "driver_certificate_tenant_driver_expiry_idx" ON "mdm"."driver_certificate"("tenant_id","driver_id","status","valid_until");
