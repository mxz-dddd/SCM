CREATE TYPE "oms"."CollaborationType" AS ENUM ('CUSTOMER_CONFIRMATION','SUPPLIER_ACCEPTANCE','PROMISE_DATE','SHORTAGE_FEEDBACK','CHANGE_REQUEST','CANCEL_REQUEST');
CREATE TYPE "oms"."AsnStatus" AS ENUM ('SUBMITTED','ACCEPTED','REJECTED','CANCELLED');
CREATE TYPE "oms"."AsnPackageType" AS ENUM ('CARTON','PALLET');
CREATE TABLE "oms"."partner_collaboration" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"business_order_id" UUID NOT NULL,"order_line_id" UUID,"partner_id" UUID NOT NULL,"type" "oms"."CollaborationType" NOT NULL,"confirmed" BOOLEAN,"promise_date" TIMESTAMPTZ(3),"shortage_original" DECIMAL(24,12),"original_uom" VARCHAR(20),"shortage_base" DECIMAL(24,12),"base_uom" VARCHAR(20),"comment" VARCHAR(2000),"payload" JSONB NOT NULL,
 CONSTRAINT "partner_collaboration_values_valid" CHECK ("version">0 AND (("shortage_original" IS NULL AND "original_uom" IS NULL AND "shortage_base" IS NULL AND "base_uom" IS NULL) OR ("shortage_original">=0 AND "original_uom" IS NOT NULL AND "shortage_base">=0 AND "base_uom" IS NOT NULL)) AND jsonb_typeof("payload")='object')
);
CREATE INDEX "partner_collaboration_order_idx" ON "oms"."partner_collaboration"("tenant_id","business_order_id","created_at");
CREATE INDEX "partner_collaboration_partner_idx" ON "oms"."partner_collaboration"("tenant_id","partner_id","type","created_at");
CREATE TABLE "oms"."partner_asn" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "oms"."AsnStatus" NOT NULL DEFAULT 'SUBMITTED',"business_order_id" UUID NOT NULL,"partner_id" UUID NOT NULL,"external_asn_no" VARCHAR(200) NOT NULL,"expected_arrival" TIMESTAMPTZ(3) NOT NULL,"expires_at" TIMESTAMPTZ(3) NOT NULL,"warehouse_id" UUID NOT NULL,"shipment_reference" VARCHAR(200),CONSTRAINT "partner_asn_dates_valid" CHECK ("version">0 AND "expected_arrival"<="expires_at")
);
CREATE UNIQUE INDEX "partner_asn_external_key" ON "oms"."partner_asn"("tenant_id","partner_id","external_asn_no");
CREATE INDEX "partner_asn_order_idx" ON "oms"."partner_asn"("tenant_id","business_order_id","status","created_at");
CREATE TABLE "oms"."partner_asn_line" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"asn_id" UUID NOT NULL,"source_order_line_id" UUID NOT NULL,"line_no" INTEGER NOT NULL,"product_id" UUID NOT NULL,"package_no" VARCHAR(200),"batch_no" VARCHAR(100),"quantity_original" DECIMAL(24,12) NOT NULL,"original_uom" VARCHAR(20) NOT NULL,"quantity_base" DECIMAL(24,12) NOT NULL,"base_uom" VARCHAR(20) NOT NULL,CONSTRAINT "partner_asn_line_values_valid" CHECK ("version">0 AND "line_no">0 AND "quantity_original">0 AND "quantity_base">0)
);
CREATE UNIQUE INDEX "partner_asn_line_no_key" ON "oms"."partner_asn_line"("tenant_id","asn_id","line_no");
CREATE INDEX "partner_asn_line_source_idx" ON "oms"."partner_asn_line"("tenant_id","source_order_line_id","status");
CREATE TABLE "oms"."partner_asn_package" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"asn_id" UUID NOT NULL,"package_no" VARCHAR(200) NOT NULL,"parent_package_no" VARCHAR(200),"type" "oms"."AsnPackageType" NOT NULL,"package_snapshot" JSONB NOT NULL,CONSTRAINT "partner_asn_package_values_valid" CHECK ("version">0 AND "package_no"<>COALESCE("parent_package_no",'') AND jsonb_typeof("package_snapshot")='object')
);
CREATE UNIQUE INDEX "partner_asn_package_no_key" ON "oms"."partner_asn_package"("tenant_id","asn_id","package_no");
CREATE INDEX "partner_asn_package_parent_idx" ON "oms"."partner_asn_package"("tenant_id","asn_id","parent_package_no");
CREATE TABLE "oms"."order_timeline_projection" (
 "id" UUID PRIMARY KEY,"tenant_id" UUID NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"created_by" UUID NOT NULL,"updated_at" TIMESTAMPTZ(3) NOT NULL,"updated_by" UUID NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"status" "oms"."OmsRecordStatus" NOT NULL DEFAULT 'ACTIVE',"business_order_id" UUID NOT NULL,"event_id" UUID NOT NULL,"event_type" VARCHAR(150) NOT NULL,"aggregate_type" VARCHAR(150) NOT NULL,"aggregate_id" UUID NOT NULL,"aggregate_version" INTEGER NOT NULL,"source_domain" VARCHAR(50) NOT NULL,"occurred_at" TIMESTAMPTZ(3) NOT NULL,"actor_id" UUID,"from_status" VARCHAR(50),"to_status" VARCHAR(50),"summary" VARCHAR(500) NOT NULL,"attachments" JSONB NOT NULL DEFAULT '[]',"trace_id" VARCHAR(100) NOT NULL,"payload" JSONB NOT NULL,CONSTRAINT "order_timeline_values_valid" CHECK ("version">0 AND "aggregate_version">0 AND jsonb_typeof("attachments")='array' AND jsonb_typeof("payload")='object')
);
CREATE UNIQUE INDEX "order_timeline_event_key" ON "oms"."order_timeline_projection"("tenant_id","event_id");
CREATE INDEX "order_timeline_order_time_idx" ON "oms"."order_timeline_projection"("tenant_id","business_order_id","occurred_at","id");
CREATE TRIGGER "partner_collaboration_immutable" BEFORE UPDATE OR DELETE ON "oms"."partner_collaboration" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "partner_asn_line_immutable" BEFORE UPDATE OR DELETE ON "oms"."partner_asn_line" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "partner_asn_package_immutable" BEFORE UPDATE OR DELETE ON "oms"."partner_asn_package" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
CREATE TRIGGER "order_timeline_immutable" BEFORE UPDATE OR DELETE ON "oms"."order_timeline_projection" FOR EACH ROW EXECUTE FUNCTION "oms"."reject_order_fact_mutation"();
