-- Expand BlogPostJob with persistence fields needed by the storytelling pipeline
ALTER TABLE "BlogPostJob"
  ADD COLUMN "briefJson" TEXT,
  ADD COLUMN "errorMessage" TEXT,
  ADD COLUMN "resultJson" JSONB,
  ADD COLUMN "lastPolledAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- jobId must be unique so updates can target by (shop, jobId)
CREATE UNIQUE INDEX "BlogPostJob_jobId_key" ON "BlogPostJob"("jobId");

CREATE INDEX "BlogPostJob_shop_status_idx" ON "BlogPostJob"("shop", "status");
CREATE INDEX "BlogPostJob_shop_createdAt_idx" ON "BlogPostJob"("shop", "createdAt");

-- Local snapshot of each AI-generated draft. Compared later against the
-- published Shopify article to feed the learning loop.
CREATE TABLE "BlogPostDraft" (
  "id"               TEXT NOT NULL,
  "shop"             TEXT NOT NULL,
  "jobId"            TEXT NOT NULL,
  "themeKey"         TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "bodyHtml"         TEXT NOT NULL,
  "metaTitle"        TEXT,
  "metaDescription"  TEXT,
  "shopifyArticleId" TEXT,
  "publishedAt"      TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogPostDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlogPostDraft_shop_jobId_themeKey_key"
  ON "BlogPostDraft"("shop", "jobId", "themeKey");
CREATE INDEX "BlogPostDraft_shop_shopifyArticleId_idx"
  ON "BlogPostDraft"("shop", "shopifyArticleId");
