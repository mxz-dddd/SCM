ALTER TABLE "platform"."file_object"
ADD COLUMN "content_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "supersedes_file_object_id" UUID;

CREATE INDEX "file_object_tenant_supersedes_idx"
ON "platform"."file_object"("tenant_id", "supersedes_file_object_id");
