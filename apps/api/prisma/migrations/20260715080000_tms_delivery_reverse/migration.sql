CREATE TYPE "tms"."DeliveryConfirmationStatus" AS ENUM ('RECORDED');
CREATE TYPE "tms"."DeliveryVarianceStatus" AS ENUM ('PENDING', 'RESOLVED');
CREATE TYPE "tms"."ProofOfDeliveryStatus" AS ENUM ('UPLOADED', 'REVIEWING', 'CONFIRMED', 'RETURNED', 'DISPUTED');
CREATE TYPE "tms"."PodReviewStatus" AS ENUM ('RECORDED');
CREATE TYPE "tms"."ClaimCaseStatus" AS ENUM ('OPEN', 'NEGOTIATING', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SETTLED', 'CLOSED');
CREATE TYPE "tms"."DeductionFactStatus" AS ENUM ('ACTIVE', 'REVERSED');
CREATE TYPE "tms"."ReturnTransportOrderStatus" AS ENUM ('REQUESTED', 'PLANNED', 'CANCELLED');

CREATE TABLE "tms"."delivery_confirmation" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."DeliveryConfirmationStatus" NOT NULL DEFAULT 'RECORDED',
  "confirmation_no" VARCHAR(100) NOT NULL,
  "shipment_id" UUID NOT NULL,
  "arrived_at" TIMESTAMPTZ(3) NOT NULL,
  "unloading_started_at" TIMESTAMPTZ(3) NOT NULL,
  "unloading_completed_at" TIMESTAMPTZ(3) NOT NULL,
  "signed_at" TIMESTAMPTZ(3) NOT NULL,
  "recipient_name" VARCHAR(200) NOT NULL,
  "recipient_snapshot" JSONB NOT NULL,
  "signature_snapshot" JSONB NOT NULL,
  "item_summary" JSONB NOT NULL,
  "delivery_location_snapshot" JSONB NOT NULL,
  "has_variance" BOOLEAN NOT NULL,
  CONSTRAINT "delivery_confirmation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_confirmation_time_check" CHECK ("arrived_at" <= "unloading_started_at" AND "unloading_started_at" <= "unloading_completed_at" AND "unloading_completed_at" <= "signed_at"),
  CONSTRAINT "delivery_confirmation_json_check" CHECK (jsonb_typeof("recipient_snapshot")='object' AND jsonb_typeof("signature_snapshot")='object' AND jsonb_typeof("item_summary")='array' AND jsonb_typeof("delivery_location_snapshot")='object')
);

CREATE TABLE "tms"."delivery_variance" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."DeliveryVarianceStatus" NOT NULL DEFAULT 'PENDING',
  "delivery_confirmation_id" UUID NOT NULL,
  "shipment_id" UUID NOT NULL,
  "shipment_item_id" UUID NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "expected_quantity_base" DECIMAL(24,12) NOT NULL,
  "delivered_quantity_base" DECIMAL(24,12) NOT NULL,
  "refused_quantity_base" DECIMAL(24,12) NOT NULL,
  "damaged_quantity_base" DECIMAL(24,12) NOT NULL,
  "difference_quantity_base" DECIMAL(24,12) NOT NULL,
  "base_uom" VARCHAR(20) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "evidence_snapshot" JSONB NOT NULL,
  "resolution_snapshot" JSONB NOT NULL DEFAULT '{}',
  "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "delivery_variance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_variance_type_check" CHECK ("type" IN ('SHORTAGE','OVERAGE','DAMAGE','REFUSAL')),
  CONSTRAINT "delivery_variance_quantity_check" CHECK ("expected_quantity_base">=0 AND "delivered_quantity_base">=0 AND "refused_quantity_base">=0 AND "damaged_quantity_base">=0 AND "damaged_quantity_base"<="delivered_quantity_base"),
  CONSTRAINT "delivery_variance_state_check" CHECK (("status"='PENDING' AND "resolved_at" IS NULL) OR ("status"='RESOLVED' AND "resolved_at" IS NOT NULL)),
  CONSTRAINT "delivery_variance_json_check" CHECK (jsonb_typeof("evidence_snapshot")='object' AND jsonb_typeof("resolution_snapshot")='object')
);

CREATE TABLE "tms"."proof_of_delivery" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."ProofOfDeliveryStatus" NOT NULL DEFAULT 'UPLOADED',
  "pod_no" VARCHAR(100) NOT NULL,
  "shipment_id" UUID NOT NULL,
  "delivery_confirmation_id" UUID NOT NULL,
  "signature_snapshot" JSONB NOT NULL,
  "file_references" JSONB NOT NULL,
  "page_count" INTEGER NOT NULL,
  "notes" VARCHAR(2000),
  "submitted_by" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewing_at" TIMESTAMPTZ(3),
  "confirmed_at" TIMESTAMPTZ(3),
  "returned_at" TIMESTAMPTZ(3),
  "disputed_at" TIMESTAMPTZ(3),
  CONSTRAINT "proof_of_delivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proof_of_delivery_values_check" CHECK ("page_count">0 AND jsonb_typeof("signature_snapshot")='object' AND jsonb_typeof("file_references")='array' AND jsonb_array_length("file_references")>0),
  CONSTRAINT "proof_of_delivery_state_check" CHECK (
    ("status"='UPLOADED' AND "reviewing_at" IS NULL AND "confirmed_at" IS NULL AND "disputed_at" IS NULL) OR
    ("status"='REVIEWING' AND "reviewing_at" IS NOT NULL AND "confirmed_at" IS NULL AND "disputed_at" IS NULL) OR
    ("status"='CONFIRMED' AND "reviewing_at" IS NOT NULL AND "confirmed_at" IS NOT NULL) OR
    ("status"='RETURNED' AND "reviewing_at" IS NOT NULL AND "returned_at" IS NOT NULL AND "confirmed_at" IS NULL) OR
    ("status"='DISPUTED' AND "reviewing_at" IS NOT NULL AND "disputed_at" IS NOT NULL AND "confirmed_at" IS NULL)
  )
);

CREATE TABLE "tms"."pod_review" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."PodReviewStatus" NOT NULL DEFAULT 'RECORDED',
  "proof_of_delivery_id" UUID NOT NULL,
  "decision" VARCHAR(50) NOT NULL,
  "from_status" "tms"."ProofOfDeliveryStatus" NOT NULL,
  "to_status" "tms"."ProofOfDeliveryStatus" NOT NULL,
  "check_snapshot" JSONB NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "reviewed_by" UUID NOT NULL,
  "reviewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pod_review_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pod_review_decision_check" CHECK ("decision" IN ('SUBMIT','START','CONFIRM','RETURN','DISPUTE','SUPPLEMENT')),
  CONSTRAINT "pod_review_json_check" CHECK (jsonb_typeof("check_snapshot")='object')
);

CREATE TABLE "tms"."claim_case" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."ClaimCaseStatus" NOT NULL DEFAULT 'OPEN',
  "claim_no" VARCHAR(100) NOT NULL,
  "shipment_id" UUID NOT NULL,
  "delivery_variance_id" UUID NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "claimant_ref" VARCHAR(200) NOT NULL,
  "responsible_party_ref" VARCHAR(200),
  "liability_snapshot" JSONB NOT NULL,
  "evidence_references" JSONB NOT NULL,
  "claimed_amount" DECIMAL(24,6) NOT NULL,
  "approved_amount" DECIMAL(24,6),
  "currency" CHAR(3) NOT NULL,
  "negotiation_snapshot" JSONB NOT NULL DEFAULT '{}',
  "approval_reference" VARCHAR(200),
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMPTZ(3),
  "settled_at" TIMESTAMPTZ(3),
  "closed_at" TIMESTAMPTZ(3),
  CONSTRAINT "claim_case_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_case_type_check" CHECK ("type" IN ('DAMAGE','SHORTAGE','REFUSAL')),
  CONSTRAINT "claim_case_amount_check" CHECK ("claimed_amount">0 AND ("approved_amount" IS NULL OR ("approved_amount">=0 AND "approved_amount"<="claimed_amount"))),
  CONSTRAINT "claim_case_json_check" CHECK (jsonb_typeof("liability_snapshot")='object' AND jsonb_typeof("evidence_references")='array' AND jsonb_typeof("negotiation_snapshot")='object'),
  CONSTRAINT "claim_case_state_check" CHECK (("status" NOT IN ('APPROVED','SETTLED','CLOSED') OR ("approved_at" IS NOT NULL AND "approved_amount" IS NOT NULL AND "responsible_party_ref" IS NOT NULL)) AND ("status" NOT IN ('SETTLED','CLOSED') OR "settled_at" IS NOT NULL) AND ("status"<>'CLOSED' OR "closed_at" IS NOT NULL))
);

CREATE TABLE "tms"."deduction_fact" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."DeductionFactStatus" NOT NULL DEFAULT 'ACTIVE',
  "claim_case_id" UUID NOT NULL,
  "shipment_id" UUID NOT NULL,
  "amount" DECIMAL(24,6) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "responsible_party_ref" VARCHAR(200) NOT NULL,
  "basis_snapshot" JSONB NOT NULL,
  "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deduction_fact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deduction_fact_amount_check" CHECK ("amount">=0 AND jsonb_typeof("basis_snapshot")='object')
);

CREATE TABLE "tms"."return_transport_order" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "tms"."ReturnTransportOrderStatus" NOT NULL DEFAULT 'REQUESTED',
  "return_no" VARCHAR(100) NOT NULL,
  "original_shipment_id" UUID NOT NULL,
  "transport_order_id" UUID NOT NULL,
  "delivery_variance_id" UUID,
  "type" VARCHAR(50) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "item_snapshot" JSONB NOT NULL,
  "relationship_snapshot" JSONB NOT NULL,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "return_transport_order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_transport_order_type_check" CHECK ("type" IN ('REFUSAL','RETURNABLE_CONTAINER','RETURN_GOODS','POD_ORIGINAL')),
  CONSTRAINT "return_transport_order_json_check" CHECK (jsonb_typeof("item_snapshot")='array' AND jsonb_typeof("relationship_snapshot")='object')
);

CREATE INDEX "delivery_confirmation_signed_idx" ON "tms"."delivery_confirmation"("tenant_id","signed_at");
CREATE UNIQUE INDEX "delivery_confirmation_tenant_no_key" ON "tms"."delivery_confirmation"("tenant_id","confirmation_no");
CREATE UNIQUE INDEX "delivery_confirmation_tenant_shipment_key" ON "tms"."delivery_confirmation"("tenant_id","shipment_id");
CREATE INDEX "delivery_variance_shipment_idx" ON "tms"."delivery_variance"("tenant_id","shipment_id","status","type");
CREATE INDEX "delivery_variance_item_idx" ON "tms"."delivery_variance"("tenant_id","shipment_item_id","status");
CREATE INDEX "proof_of_delivery_review_idx" ON "tms"."proof_of_delivery"("tenant_id","status","submitted_at");
CREATE UNIQUE INDEX "proof_of_delivery_tenant_no_key" ON "tms"."proof_of_delivery"("tenant_id","pod_no");
CREATE UNIQUE INDEX "proof_of_delivery_tenant_shipment_key" ON "tms"."proof_of_delivery"("tenant_id","shipment_id");
CREATE INDEX "pod_review_timeline_idx" ON "tms"."pod_review"("tenant_id","proof_of_delivery_id","reviewed_at","id");
CREATE INDEX "claim_case_shipment_idx" ON "tms"."claim_case"("tenant_id","shipment_id","status");
CREATE INDEX "claim_case_variance_idx" ON "tms"."claim_case"("tenant_id","delivery_variance_id","status");
CREATE UNIQUE INDEX "claim_case_tenant_no_key" ON "tms"."claim_case"("tenant_id","claim_no");
CREATE INDEX "deduction_fact_shipment_idx" ON "tms"."deduction_fact"("tenant_id","shipment_id","issued_at");
CREATE UNIQUE INDEX "deduction_fact_claim_key" ON "tms"."deduction_fact"("tenant_id","claim_case_id");
CREATE INDEX "return_transport_order_shipment_idx" ON "tms"."return_transport_order"("tenant_id","original_shipment_id","status");
CREATE UNIQUE INDEX "return_transport_order_tenant_no_key" ON "tms"."return_transport_order"("tenant_id","return_no");
CREATE UNIQUE INDEX "return_transport_order_transport_key" ON "tms"."return_transport_order"("tenant_id","transport_order_id");

CREATE TRIGGER delivery_confirmation_immutable BEFORE UPDATE OR DELETE ON "tms"."delivery_confirmation" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER pod_review_immutable BEFORE UPDATE OR DELETE ON "tms"."pod_review" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
CREATE TRIGGER deduction_fact_immutable BEFORE UPDATE OR DELETE ON "tms"."deduction_fact" FOR EACH ROW EXECUTE FUNCTION "tms".reject_transport_fact_mutation();
