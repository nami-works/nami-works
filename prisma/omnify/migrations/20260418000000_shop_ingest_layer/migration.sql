-- Shopify Ingest Layer (Phase 1, shadow mode)
-- Canonical normalized tables that will become the source of truth for Shopify
-- store data. Webhooks write here alongside existing feature tables; features
-- will be flipped to read from here in Phase 3.

-- CreateTable
CREATE TABLE "ShopOrder" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "name" TEXT,
    "sourceName" TEXT,
    "status" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "customerId" TEXT,
    "currencyCode" TEXT,
    "currentTotalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentTotalDiscounts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentTotalRefunded" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locationId" TEXT,
    "shippingAddressJson" JSONB,
    "billingAddressJson" JSONB,
    "customerJson" JSONB,
    "tagsJson" JSONB NOT NULL DEFAULT '[]',
    "refundsJson" JSONB,
    "lineItemsJson" JSONB,
    "staffMemberId" TEXT,
    "staffMemberName" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestedVia" TEXT,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("shop","id")
);

-- CreateIndex
CREATE INDEX "ShopOrder_shop_shopifyUpdatedAt_idx" ON "ShopOrder"("shop","shopifyUpdatedAt");
CREATE INDEX "ShopOrder_shop_orderDate_idx" ON "ShopOrder"("shop","orderDate");
CREATE INDEX "ShopOrder_shop_customerId_idx" ON "ShopOrder"("shop","customerId");
CREATE INDEX "ShopOrder_shop_locationId_idx" ON "ShopOrder"("shop","locationId");
CREATE INDEX "ShopOrder_shop_status_idx" ON "ShopOrder"("shop","status");

-- CreateTable
CREATE TABLE "ShopCustomer" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "displayName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3),
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "ordersCount" INTEGER,
    "totalSpent" DOUBLE PRECISION,
    "defaultAddressJson" JSONB,
    "addressesJson" JSONB,
    "tagsJson" JSONB NOT NULL DEFAULT '[]',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestedVia" TEXT,

    CONSTRAINT "ShopCustomer_pkey" PRIMARY KEY ("shop","id")
);

-- CreateIndex
CREATE INDEX "ShopCustomer_shop_shopifyUpdatedAt_idx" ON "ShopCustomer"("shop","shopifyUpdatedAt");
CREATE INDEX "ShopCustomer_shop_email_idx" ON "ShopCustomer"("shop","email");

-- CreateTable
CREATE TABLE "ShopProduct" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "productType" TEXT,
    "vendor" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3),
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "tagsJson" JSONB NOT NULL DEFAULT '[]',
    "variantsJson" JSONB NOT NULL DEFAULT '[]',
    "imagesJson" JSONB,
    "metafieldsJson" JSONB,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestedVia" TEXT,

    CONSTRAINT "ShopProduct_pkey" PRIMARY KEY ("shop","id")
);

-- CreateIndex
CREATE INDEX "ShopProduct_shop_shopifyUpdatedAt_idx" ON "ShopProduct"("shop","shopifyUpdatedAt");
CREATE INDEX "ShopProduct_shop_handle_idx" ON "ShopProduct"("shop","handle");

-- CreateTable
CREATE TABLE "ShopLocation" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "name" TEXT NOT NULL,
    "addressJson" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fulfillsOnlineOrders" BOOLEAN NOT NULL DEFAULT false,
    "localPickupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isRetailStore" BOOLEAN NOT NULL DEFAULT false,
    "shopifyUpdatedAt" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestedVia" TEXT,

    CONSTRAINT "ShopLocation_pkey" PRIMARY KEY ("shop","id")
);

-- CreateTable
CREATE TABLE "ShopIngestMeta" (
    "shop" TEXT NOT NULL,
    "ordersLastSeenUpdatedAt" TIMESTAMP(3),
    "customersLastSeenUpdatedAt" TIMESTAMP(3),
    "productsLastSeenUpdatedAt" TIMESTAMP(3),
    "locationsLastRefreshedAt" TIMESTAMP(3),
    "ordersLastReconcileAt" TIMESTAMP(3),
    "customersLastReconcileAt" TIMESTAMP(3),
    "productsLastReconcileAt" TIMESTAMP(3),
    "ordersBackfillCompletedAt" TIMESTAMP(3),
    "customersBackfillCompletedAt" TIMESTAMP(3),
    "productsBackfillCompletedAt" TIMESTAMP(3),
    "ordersRowCount" INTEGER,
    "customersRowCount" INTEGER,
    "productsRowCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "errorMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopIngestMeta_shop_key" ON "ShopIngestMeta"("shop");
