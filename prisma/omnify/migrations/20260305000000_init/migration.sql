-- PostgreSQL baseline migration — replaces all prior SQLite migrations.
-- Generated via: npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalsConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalsRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "rangeKey" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalsRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesGoalsConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesGoalsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesGoalsLocationConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesGoalsLocationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkLaunch" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "firstSoldAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkLaunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LalamoveLocationConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LalamoveLocationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LalamoveShopCredential" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT NOT NULL,
    "apiSecretCiphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LalamoveShopCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierServiceRegistration" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "carrierServiceId" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierServiceRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierServiceConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierServiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierRateSample" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "quadrantNorthIndex" INTEGER NOT NULL,
    "quadrantEastIndex" INTEGER NOT NULL,
    "priceSubunits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierRateSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LalamoveDispatchJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quotationId" TEXT,
    "lalamoveOrderId" TEXT,
    "market" TEXT,
    "serviceType" TEXT,
    "requestedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priorityFeeLevel" INTEGER NOT NULL DEFAULT 0,
    "quotationTotal" TEXT,
    "quotationCurrency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LalamoveDispatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LalamoveDispatchOrderMap" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "dispatchJobId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "lalamoveOrderId" TEXT,
    "currentStatus" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LalamoveDispatchOrderMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingDeliveryRoute" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ordersData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingDeliveryRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoAssignLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "locationId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoAssignLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LalamoveDispatchEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "dispatchJobId" TEXT,
    "shopifyOrderId" TEXT,
    "lalamoveOrderId" TEXT,
    "eventType" TEXT NOT NULL,
    "externalStatus" TEXT,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LalamoveDispatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailCurrentLocations" (
    "shop" TEXT NOT NULL,
    "locations" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "RetailLocationSet" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locations" JSONB NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailLocationSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailAnalyticsCache" (
    "shop" TEXT NOT NULL,
    "customers" JSONB NOT NULL DEFAULT '[]',
    "orders" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "BrandSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "about" TEXT,
    "toneOfVoice" TEXT,
    "brandName" TEXT,
    "blogUrl" TEXT,
    "preferredLanguage" TEXT,
    "contentLanguage" TEXT,
    "benchmarks" TEXT,
    "brandCategory" TEXT,
    "editorialGuidelines" TEXT,
    "formatRecommendations" TEXT,
    "contentStrategyJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPostJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogPostJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPostPreferences" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "blogHandle" TEXT,
    "blogTitle" TEXT,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPostPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoalsConfig_shop_key" ON "GoalsConfig"("shop");

-- CreateIndex
CREATE INDEX "GoalsRun_shop_createdAt_idx" ON "GoalsRun"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "GoalsRun_shop_rangeKey_configHash_idx" ON "GoalsRun"("shop", "rangeKey", "configHash");

-- CreateIndex
CREATE UNIQUE INDEX "SalesGoalsConfig_shop_key" ON "SalesGoalsConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SalesGoalsLocationConfig_shop_locationId_key" ON "SalesGoalsLocationConfig"("shop", "locationId");

-- CreateIndex
CREATE INDEX "BenchmarkLaunch_shop_computedAt_idx" ON "BenchmarkLaunch"("shop", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkLaunch_shop_productId_key" ON "BenchmarkLaunch"("shop", "productId");

-- CreateIndex
CREATE INDEX "LalamoveLocationConfig_shop_idx" ON "LalamoveLocationConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "LalamoveLocationConfig_shop_locationId_key" ON "LalamoveLocationConfig"("shop", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "LalamoveShopCredential_shop_key" ON "LalamoveShopCredential"("shop");

-- CreateIndex
CREATE INDEX "LalamoveShopCredential_shop_idx" ON "LalamoveShopCredential"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierServiceRegistration_shop_key" ON "CarrierServiceRegistration"("shop");

-- CreateIndex
CREATE INDEX "CarrierServiceRegistration_shop_idx" ON "CarrierServiceRegistration"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierServiceConfig_shop_key" ON "CarrierServiceConfig"("shop");

-- CreateIndex
CREATE INDEX "CarrierServiceConfig_shop_idx" ON "CarrierServiceConfig"("shop");

-- CreateIndex
CREATE INDEX "CarrierRateSample_shop_locationId_idx" ON "CarrierRateSample"("shop", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierRateSample_shop_locationId_provider_quadrantNorthInd_key" ON "CarrierRateSample"("shop", "locationId", "provider", "quadrantNorthIndex", "quadrantEastIndex");

-- CreateIndex
CREATE INDEX "LalamoveDispatchJob_shop_routeId_idx" ON "LalamoveDispatchJob"("shop", "routeId");

-- CreateIndex
CREATE INDEX "LalamoveDispatchJob_shop_status_idx" ON "LalamoveDispatchJob"("shop", "status");

-- CreateIndex
CREATE INDEX "LalamoveDispatchOrderMap_shop_shopifyOrderId_idx" ON "LalamoveDispatchOrderMap"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "LalamoveDispatchOrderMap_shop_lalamoveOrderId_idx" ON "LalamoveDispatchOrderMap"("shop", "lalamoveOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "LalamoveDispatchOrderMap_shop_dispatchJobId_shopifyOrderId_key" ON "LalamoveDispatchOrderMap"("shop", "dispatchJobId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingDeliveryRoute_routeId_key" ON "PendingDeliveryRoute"("routeId");

-- CreateIndex
CREATE INDEX "PendingDeliveryRoute_shop_status_idx" ON "PendingDeliveryRoute"("shop", "status");

-- CreateIndex
CREATE INDEX "PendingDeliveryRoute_shop_locationId_status_idx" ON "PendingDeliveryRoute"("shop", "locationId", "status");

-- CreateIndex
CREATE INDEX "AutoAssignLog_shop_createdAt_idx" ON "AutoAssignLog"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "AutoAssignLog_shop_locationId_createdAt_idx" ON "AutoAssignLog"("shop", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "LalamoveDispatchEvent_shop_lalamoveOrderId_idx" ON "LalamoveDispatchEvent"("shop", "lalamoveOrderId");

-- CreateIndex
CREATE INDEX "LalamoveDispatchEvent_shop_shopifyOrderId_idx" ON "LalamoveDispatchEvent"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "LalamoveDispatchEvent_shop_eventType_idx" ON "LalamoveDispatchEvent"("shop", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "RetailCurrentLocations_shop_key" ON "RetailCurrentLocations"("shop");

-- CreateIndex
CREATE INDEX "RetailLocationSet_shop_idx" ON "RetailLocationSet"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "RetailAnalyticsCache_shop_key" ON "RetailAnalyticsCache"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSettings_shop_key" ON "BrandSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPostPreferences_shop_key" ON "BlogPostPreferences"("shop");
