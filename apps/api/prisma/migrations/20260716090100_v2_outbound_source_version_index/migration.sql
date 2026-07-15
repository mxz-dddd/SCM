-- phase: contract
-- contract-approved: true
-- reviewed: Prisma multiSchema migrations are transactional, so PostgreSQL
-- CREATE INDEX CONCURRENTLY is unavailable. Create the replacement unique
-- index before dropping the old stricter index to preserve source uniqueness.

CREATE UNIQUE INDEX "outbound_order_source_version_key"
  ON "wms"."outbound_order"("tenant_id", "source_ref", "source_version");

DROP INDEX "wms"."outbound_order_source_key";
