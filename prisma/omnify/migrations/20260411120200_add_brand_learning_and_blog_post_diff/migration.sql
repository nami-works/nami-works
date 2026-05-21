-- Validated insights from the learning loop. Each row is a merchant-accepted
-- observation ("avoid superlatives", "lead with the story") that feeds back
-- into future generations via brand-assets/service.server.ts.
CREATE TABLE "BrandLearning" (
  "id"              TEXT NOT NULL,
  "shop"            TEXT NOT NULL,
  "brandAssetsId"   TEXT NOT NULL,
  "sourceArticleId" TEXT,
  "sourceDiffId"    TEXT,
  "category"        TEXT NOT NULL,
  "beforeSnippet"   TEXT NOT NULL,
  "afterSnippet"    TEXT NOT NULL,
  "interpretation"  TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'accepted',
  "acceptedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandLearning_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BrandLearning_brandAssetsId_fkey"
    FOREIGN KEY ("brandAssetsId") REFERENCES "BrandSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BrandLearning_shop_status_idx" ON "BrandLearning"("shop", "status");
CREATE INDEX "BrandLearning_brandAssetsId_idx" ON "BrandLearning"("brandAssetsId");

-- Detected diffs between AI draft and live Shopify article. Interpretation
-- is stored inline as a JSON array of hypotheses for per-row review.
CREATE TABLE "BlogPostDiff" (
  "id"               TEXT NOT NULL,
  "shop"             TEXT NOT NULL,
  "draftId"          TEXT NOT NULL,
  "shopifyArticleId" TEXT NOT NULL,
  "detectedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "beforeHtml"       TEXT NOT NULL,
  "afterHtml"        TEXT NOT NULL,
  "hypotheses"       JSONB NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'pending_review',
  "reviewedAt"       TIMESTAMP(3),
  CONSTRAINT "BlogPostDiff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BlogPostDiff_shop_status_idx" ON "BlogPostDiff"("shop", "status");
CREATE INDEX "BlogPostDiff_shopifyArticleId_idx" ON "BlogPostDiff"("shopifyArticleId");
