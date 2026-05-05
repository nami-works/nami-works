-- AffiliateProgram: per-shop registration of a Shopify code-discount node
-- as an "affiliate program". Codes belonging to the discount auto-sync
-- hourly into AffiliateCode.
CREATE TABLE "AffiliateProgram" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "discountNodeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "discountTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "codesCount" INTEGER NOT NULL DEFAULT 0,
    "mappedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProgram_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AffiliateProgram_shop_discountNodeId_key"
    ON "AffiliateProgram"("shop", "discountNodeId");

CREATE UNIQUE INDEX "AffiliateProgram_shop_label_key"
    ON "AffiliateProgram"("shop", "label");

CREATE INDEX "AffiliateProgram_shop_status_idx"
    ON "AffiliateProgram"("shop", "status");

-- AffiliateCode: coupon codes synced from Shopify discount registrations
-- (or imported via BixGrow CSV with programId=null). One row per (shop, code).
CREATE TABLE "AffiliateCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "programId" TEXT,
    "profileId" TEXT,
    "asyncUsageCount" INTEGER NOT NULL DEFAULT 0,
    "shopifyCodeId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AffiliateCode_shop_code_key"
    ON "AffiliateCode"("shop", "code");

CREATE INDEX "AffiliateCode_shop_programId_idx"
    ON "AffiliateCode"("shop", "programId");

CREATE INDEX "AffiliateCode_shop_profileId_idx"
    ON "AffiliateCode"("shop", "profileId");
