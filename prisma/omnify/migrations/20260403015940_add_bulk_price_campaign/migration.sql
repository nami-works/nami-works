-- CreateTable
CREATE TABLE "RoutePolylineCache" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderIdsKey" TEXT NOT NULL,
    "encodedPolyline" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutePolylineCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkPriceCampaign" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" DOUBLE PRECISION NOT NULL,
    "filterType" TEXT NOT NULL DEFAULT 'product_types',
    "filterValues" TEXT NOT NULL DEFAULT '[]',
    "excludeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "excludeType" TEXT NOT NULL DEFAULT 'tags',
    "excludeValues" TEXT NOT NULL DEFAULT '[]',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "variantCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkPriceCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkPriceCampaignItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "originalPrice" DOUBLE PRECISION NOT NULL,
    "originalCompareAtPrice" DOUBLE PRECISION,
    "appliedPrice" DOUBLE PRECISION NOT NULL,
    "appliedCompareAtPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkPriceCampaignItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutePolylineCache_shop_locationId_idx" ON "RoutePolylineCache"("shop", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutePolylineCache_shop_locationId_orderIdsKey_key" ON "RoutePolylineCache"("shop", "locationId", "orderIdsKey");

-- CreateIndex
CREATE INDEX "BulkPriceCampaign_shop_idx" ON "BulkPriceCampaign"("shop");

-- CreateIndex
CREATE INDEX "BulkPriceCampaign_shop_status_idx" ON "BulkPriceCampaign"("shop", "status");

-- CreateIndex
CREATE INDEX "BulkPriceCampaignItem_campaignId_idx" ON "BulkPriceCampaignItem"("campaignId");

-- CreateIndex
CREATE INDEX "BulkPriceCampaignItem_shop_variantGid_idx" ON "BulkPriceCampaignItem"("shop", "variantGid");

-- AddForeignKey
ALTER TABLE "BulkPriceCampaignItem" ADD CONSTRAINT "BulkPriceCampaignItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BulkPriceCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
