-- CreateTable
CREATE TABLE "PriceTagConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "discountMode" TEXT NOT NULL DEFAULT 'highest',
    "dollarThreshold" DOUBLE PRECISION,
    "metaobjectType" TEXT NOT NULL DEFAULT '',
    "metafieldNamespace" TEXT NOT NULL DEFAULT 'custom',
    "metafieldKey" TEXT NOT NULL DEFAULT 'price_label',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceTagConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTagTierRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "discountType" TEXT NOT NULL DEFAULT 'percent',
    "startingAt" DOUBLE PRECISION NOT NULL,
    "metaobjectHandles" TEXT NOT NULL DEFAULT '[]',
    "metaobjectGids" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceTagTierRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTagProductLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "metafieldSet" BOOLEAN NOT NULL DEFAULT false,
    "lastTierHandle" TEXT,
    "lastProcessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceTagProductLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceTagConfig_shop_key" ON "PriceTagConfig"("shop");

-- CreateIndex
CREATE INDEX "PriceTagTierRule_shop_idx" ON "PriceTagTierRule"("shop");

-- CreateIndex
CREATE INDEX "PriceTagProductLog_shop_idx" ON "PriceTagProductLog"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "PriceTagProductLog_shop_productGid_key" ON "PriceTagProductLog"("shop", "productGid");
