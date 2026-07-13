DROP INDEX "platform"."attachment_download_grant_token_key";

CREATE UNIQUE INDEX "attachment_download_grant_tenant_token_key"
ON "platform"."attachment_download_grant"("tenant_id", "token_hash");
