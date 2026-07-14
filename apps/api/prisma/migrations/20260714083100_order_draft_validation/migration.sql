-- Drafts intentionally retain incomplete or invalid windows for field-level validation on submit.
ALTER TABLE "oms"."business_order" DROP CONSTRAINT "business_order_requested_range";
ALTER TABLE "oms"."business_order_line" DROP CONSTRAINT "business_order_line_requested_range";
