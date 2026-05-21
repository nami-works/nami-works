-- Alt-text audit + suggestion queue. The drain cron (api.cron.alt-text-drain)
-- picks up 100 queued rows per shop per day to drip applications out to
-- Shopify gradually, avoiding Google SEO churn from bulk metadata changes.
CREATE TABLE "ProductImageAltSuggestion" (
  "id"            TEXT NOT NULL,
  "shop"          TEXT NOT NULL,
  "productId"     TEXT NOT NULL,
  "productTitle"  TEXT,
  "imageId"       TEXT NOT NULL,
  "imageUrl"      TEXT NOT NULL,
  "currentAlt"    TEXT,
  "detectedState" TEXT NOT NULL,
  "suggestion"    TEXT,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "generatedAt"   TIMESTAMP(3),
  "approvedAt"    TIMESTAMP(3),
  "queuedAt"      TIMESTAMP(3),
  "appliedAt"     TIMESTAMP(3),
  "errorMessage"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductImageAltSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductImageAltSuggestion_shop_imageId_key"
  ON "ProductImageAltSuggestion"("shop", "imageId");
CREATE INDEX "ProductImageAltSuggestion_shop_status_queuedAt_idx"
  ON "ProductImageAltSuggestion"("shop", "status", "queuedAt");
CREATE INDEX "ProductImageAltSuggestion_shop_productId_idx"
  ON "ProductImageAltSuggestion"("shop", "productId");
