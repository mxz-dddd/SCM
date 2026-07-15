-- phase: expand
CREATE UNIQUE INDEX CONCURRENTLY "inventory_expiry_alert_tenant_no_key"
  ON "wms"."inventory_expiry_alert" ("tenant_id", "alert_no");
