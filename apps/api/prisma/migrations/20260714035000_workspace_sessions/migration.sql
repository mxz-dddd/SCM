-- PLT-007 personal workspace layout, page sessions and favorites.
-- CreateTable
CREATE TABLE "platform"."workspace_layout" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "active_tab_id" VARCHAR(150),
    "context" JSONB NOT NULL DEFAULT '{}',
    "open_tabs" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "workspace_layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."page_session" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "page_key" VARCHAR(150) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "route" VARCHAR(500) NOT NULL,
    "query_state" JSONB NOT NULL DEFAULT '{}',
    "draft_state" JSONB NOT NULL DEFAULT '{}',
    "dirty" BOOLEAN NOT NULL DEFAULT false,
    "last_visited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."favorite" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "platform"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID NOT NULL,
    "page_key" VARCHAR(150) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "route" VARCHAR(500) NOT NULL,

    CONSTRAINT "favorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_layout_tenant_updated_idx" ON "platform"."workspace_layout"("tenant_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_layout_tenant_account_key" ON "platform"."workspace_layout"("tenant_id", "account_id");

ALTER TABLE "platform"."workspace_layout"
  ADD CONSTRAINT "workspace_layout_json_shape_check"
  CHECK (jsonb_typeof("context") = 'object' AND jsonb_typeof("open_tabs") = 'array');

-- CreateIndex
CREATE INDEX "page_session_tenant_account_visited_idx" ON "platform"."page_session"("tenant_id", "account_id", "last_visited_at");

-- CreateIndex
CREATE UNIQUE INDEX "page_session_tenant_account_page_key" ON "platform"."page_session"("tenant_id", "account_id", "page_key");

ALTER TABLE "platform"."page_session"
  ADD CONSTRAINT "page_session_json_shape_check"
  CHECK (jsonb_typeof("query_state") = 'object' AND jsonb_typeof("draft_state") = 'object');

-- CreateIndex
CREATE INDEX "favorite_tenant_account_created_idx" ON "platform"."favorite"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_tenant_account_page_key" ON "platform"."favorite"("tenant_id", "account_id", "page_key");
