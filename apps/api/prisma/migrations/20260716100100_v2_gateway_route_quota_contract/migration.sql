-- phase: contract
-- contract-approved: true
-- reviewed: Prisma multiSchema migrations are transactional, so PostgreSQL
-- CREATE INDEX CONCURRENTLY is unavailable. Create the route-aware unique
-- index before dropping the old stricter index; existing rows use route '*'.

CREATE UNIQUE INDEX "integration_gateway_usage_route_bucket_key"
  ON "integration"."gateway_usage_bucket"(
    "tenant_id", "policy_id", "credential_id", "route", "bucket_kind", "bucket_start"
  );
DROP INDEX "integration"."integration_gateway_usage_bucket_key";
