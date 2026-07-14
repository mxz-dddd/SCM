CREATE TYPE "tms"."TmsRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "tms"."TransportOrderType" AS ENUM ('SALES', 'PURCHASE', 'TRANSFER', 'STANDALONE', 'RETURN');
CREATE TYPE "tms"."TransportOrderStatus" AS ENUM ('OPEN', 'PLANNED', 'APPROVED', 'TENDERED', 'ACCEPTED', 'DISPATCHED', 'TRACKING', 'DELIVERED', 'POD', 'SETTLED', 'CLOSED', 'FROZEN', 'RETURNED', 'CANCELLED');
CREATE TYPE "tms"."TransportReviewDecision" AS ENUM ('APPROVE', 'FREEZE', 'RETURN');

CREATE TABLE "tms"."transport_order" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."TransportOrderStatus" NOT NULL DEFAULT 'OPEN',
  "order_no" VARCHAR(100) NOT NULL,
  "type" "tms"."TransportOrderType" NOT NULL,
  "source_type" VARCHAR(100) NOT NULL,
  "source_ref" VARCHAR(200) NOT NULL,
  "source_version" VARCHAR(100) NOT NULL DEFAULT '1',
  "external_order_no" VARCHAR(200),
  "source_snapshot" JSONB NOT NULL,
  "customer_ref" VARCHAR(200),
  "customer_snapshot" JSONB NOT NULL DEFAULT '{}',
  "origin_address_ref" VARCHAR(200),
  "origin_address_snapshot" JSONB NOT NULL,
  "destination_address_ref" VARCHAR(200),
  "destination_address_snapshot" JSONB NOT NULL,
  "pickup_window_from" TIMESTAMPTZ(3) NOT NULL,
  "pickup_window_to" TIMESTAMPTZ(3) NOT NULL,
  "delivery_window_from" TIMESTAMPTZ(3) NOT NULL,
  "delivery_window_to" TIMESTAMPTZ(3) NOT NULL,
  "packaging_snapshot" JSONB NOT NULL,
  "weight" DECIMAL(24,12) NOT NULL,
  "weight_uom" VARCHAR(20) NOT NULL,
  "weight_base" DECIMAL(24,12) NOT NULL,
  "weight_base_uom" VARCHAR(20) NOT NULL DEFAULT 'KG',
  "volume" DECIMAL(24,12) NOT NULL,
  "volume_uom" VARCHAR(20) NOT NULL,
  "volume_base" DECIMAL(24,12) NOT NULL,
  "volume_base_uom" VARCHAR(20) NOT NULL DEFAULT 'M3',
  "temperature_min" DECIMAL(8,3),
  "temperature_max" DECIMAL(8,3),
  "temperature_uom" VARCHAR(20),
  "service_level" VARCHAR(100) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "prohibited_goods_snapshot" JSONB NOT NULL DEFAULT '{}',
  "vehicle_requirement_snapshot" JSONB NOT NULL DEFAULT '{}',
  "carrier_requirement_snapshot" JSONB NOT NULL DEFAULT '{}',
  "charge_responsibility_snapshot" JSONB NOT NULL,
  "reviewed_at" TIMESTAMPTZ(3),
  "reviewed_by" UUID,
  CONSTRAINT "transport_order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transport_order_values_valid" CHECK (
    "version" > 0 AND "priority" > 0 AND
    length(btrim("source_type")) > 0 AND length(btrim("source_ref")) > 0 AND
    length(btrim("source_version")) > 0 AND length(btrim("service_level")) > 0 AND
    "pickup_window_from" < "pickup_window_to" AND
    "delivery_window_from" < "delivery_window_to" AND
    "pickup_window_from" <= "delivery_window_to" AND
    "weight" > 0 AND "weight_base" > 0 AND "volume" > 0 AND "volume_base" > 0 AND
    length(btrim("weight_uom")) > 0 AND length(btrim("weight_base_uom")) > 0 AND
    length(btrim("volume_uom")) > 0 AND length(btrim("volume_base_uom")) > 0 AND
    (("temperature_min" IS NULL AND "temperature_max" IS NULL AND "temperature_uom" IS NULL) OR
     ("temperature_min" IS NOT NULL AND "temperature_max" IS NOT NULL AND "temperature_uom" IS NOT NULL AND "temperature_min" <= "temperature_max")) AND
    jsonb_typeof("source_snapshot") = 'object' AND jsonb_typeof("customer_snapshot") = 'object' AND
    jsonb_typeof("origin_address_snapshot") = 'object' AND jsonb_typeof("destination_address_snapshot") = 'object' AND
    jsonb_typeof("packaging_snapshot") = 'object' AND jsonb_typeof("prohibited_goods_snapshot") = 'object' AND
    jsonb_typeof("vehicle_requirement_snapshot") = 'object' AND jsonb_typeof("carrier_requirement_snapshot") = 'object' AND
    jsonb_typeof("charge_responsibility_snapshot") = 'object'
  )
);

CREATE TABLE "tms"."transport_order_approval" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."TmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "transport_order_id" UUID NOT NULL,
  "order_version" INTEGER NOT NULL,
  "decision" "tms"."TransportReviewDecision" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "findings" JSONB NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by" UUID NOT NULL,
  CONSTRAINT "transport_order_approval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transport_approval_values_valid" CHECK (
    "version" > 0 AND "order_version" > 0 AND length(btrim("reason")) > 0 AND
    jsonb_typeof("findings") = 'array' AND jsonb_typeof("input_snapshot") = 'object'
  )
);

CREATE UNIQUE INDEX "transport_order_tenant_no_key" ON "tms"."transport_order"("tenant_id", "order_no");
CREATE UNIQUE INDEX "transport_order_tenant_source_version_key" ON "tms"."transport_order"("tenant_id", "source_type", "source_ref", "source_version");
CREATE INDEX "transport_order_tenant_status_pickup_priority_idx" ON "tms"."transport_order"("tenant_id", "status", "pickup_window_from", "priority");
CREATE INDEX "transport_order_tenant_external_idx" ON "tms"."transport_order"("tenant_id", "external_order_no");
CREATE INDEX "transport_approval_tenant_order_decided_idx" ON "tms"."transport_order_approval"("tenant_id", "transport_order_id", "decided_at");

CREATE OR REPLACE FUNCTION "tms"."reject_transport_fact_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TMS transport approval is immutable';
END;
$$;

CREATE TRIGGER "transport_order_approval_immutable"
BEFORE UPDATE OR DELETE ON "tms"."transport_order_approval"
FOR EACH ROW EXECUTE FUNCTION "tms"."reject_transport_fact_mutation"();
