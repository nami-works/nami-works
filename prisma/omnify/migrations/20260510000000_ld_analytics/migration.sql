-- Local Delivery Analytics v1
-- See docs/plans/local-delivery-analytics.md §3.
-- All four tables are additive; no existing read paths reference them.

-- CreateTable
CREATE TABLE "WarehouseCarrierCredential" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT NOT NULL,
    "apiSecretCiphertext" TEXT,
    "apiEndpoint" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseCarrierCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseCarrierCredential_shop_idx" ON "WarehouseCarrierCredential"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseCarrierCredential_shop_provider_key" ON "WarehouseCarrierCredential"("shop", "provider");

-- CreateTable
CREATE TABLE "WarehouseCarrierQuoteCache" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "priceSubunits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "minDeliveryDate" TEXT,
    "maxDeliveryDate" TEXT,
    "rawResponseJson" JSONB,
    "quotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseCarrierQuoteCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseCarrierQuoteCache_shop_expiresAt_idx" ON "WarehouseCarrierQuoteCache"("shop", "expiresAt");

-- CreateIndex
CREATE INDEX "WarehouseCarrierQuoteCache_shop_orderId_idx" ON "WarehouseCarrierQuoteCache"("shop", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseCarrierQuoteCache_shop_orderId_provider_key" ON "WarehouseCarrierQuoteCache"("shop", "orderId", "provider");

-- CreateTable
CREATE TABLE "LdAnalyticsDaily" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "cityNorm" TEXT NOT NULL,
    "cityDisplay" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "ldOrderCount" INTEGER NOT NULL DEFAULT 0,
    "ldRevenueSubunits" INTEGER NOT NULL DEFAULT 0,
    "ldCarrierCostSubunits" INTEGER NOT NULL DEFAULT 0,
    "warehouseCounterfactualSubunits" INTEGER NOT NULL DEFAULT 0,
    "warehouseCustomerRateSubunits" INTEGER NOT NULL DEFAULT 0,
    "taxSavingsSubunits" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "coveragePercent" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LdAnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LdAnalyticsDaily_shop_date_idx" ON "LdAnalyticsDaily"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LdAnalyticsDaily_shop_cityNorm_date_key" ON "LdAnalyticsDaily"("shop", "cityNorm", "date");

-- CreateTable
CREATE TABLE "LdAnalyticsConfig" (
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "headlineFraming" TEXT NOT NULL DEFAULT 'pl_impact',
    "perCityTaxSavingsJson" JSONB NOT NULL DEFAULT '{}',
    "perLocationWarehouseCostJson" JSONB NOT NULL DEFAULT '{}',
    "partialDataThresholdPercent" INTEGER NOT NULL DEFAULT 80,
    "quoteCacheTtlDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LdAnalyticsConfig_pkey" PRIMARY KEY ("shop")
);
