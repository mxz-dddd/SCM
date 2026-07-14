ALTER TABLE "oms"."business_order" DROP CONSTRAINT IF EXISTS "business_order_raw_message_fk";
ALTER TABLE "oms"."business_order_line" DROP CONSTRAINT IF EXISTS "business_order_line_order_fk";
ALTER TABLE "oms"."duplicate_case" DROP CONSTRAINT IF EXISTS "duplicate_case_order_fk";
ALTER TABLE "oms"."order_version" DROP CONSTRAINT IF EXISTS "order_version_order_fk";
ALTER TABLE "oms"."change_set" DROP CONSTRAINT IF EXISTS "change_set_order_fk";
