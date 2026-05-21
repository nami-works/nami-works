-- CreateTable
CREATE TABLE "AffiliateProfile" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "affiliateName" TEXT NOT NULL,
    "instagram" TEXT,
    "tiktok" TEXT,
    "city" TEXT,
    "state" TEXT,
    "program" TEXT,
    "referralCode" TEXT,
    "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "tier" TEXT NOT NULL DEFAULT 'baseline',
    "status" TEXT NOT NULL DEFAULT 'active',
    "paymentMethod" TEXT,
    "paymentInfo" TEXT,
    "bixgrowCreatedAt" TIMESTAMP(3),
    "lastLogin" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderName" TEXT,
    "customerId" TEXT,
    "affiliateCode" TEXT NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "affiliateDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "siteDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currencyCode" TEXT,
    "isFirstOrder" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "lineItemsJson" TEXT,
    "orderDate" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateOrganicAgg" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "siteDiscountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uniqueCustomers" INTEGER NOT NULL DEFAULT 0,
    "newCustomers" INTEGER NOT NULL DEFAULT 0,
    "repeatCustomers" INTEGER NOT NULL DEFAULT 0,
    "avgOrderValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currencyCode" TEXT,

    CONSTRAINT "AffiliateOrganicAgg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateMonthly" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "affiliateCode" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "affiliateDiscountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "siteDiscountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uniqueCustomers" INTEGER NOT NULL DEFAULT 0,
    "newCustomers" INTEGER NOT NULL DEFAULT 0,
    "repeatCustomers" INTEGER NOT NULL DEFAULT 0,
    "avgOrderValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currencyCode" TEXT,

    CONSTRAINT "AffiliateMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateSyncMeta" (
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "errorMessage" TEXT,
    "phase" TEXT,
    "progressCount" INTEGER,
    "startedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastOrderCursor" TEXT,
    "totalOrders" INTEGER,
    "totalAffiliateOrders" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "AffiliateProfile_shop_status_idx" ON "AffiliateProfile"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProfile_shop_code_key" ON "AffiliateProfile"("shop", "code");

-- CreateIndex
CREATE INDEX "AffiliateOrder_shop_orderDate_idx" ON "AffiliateOrder"("shop", "orderDate");

-- CreateIndex
CREATE INDEX "AffiliateOrder_shop_affiliateCode_idx" ON "AffiliateOrder"("shop", "affiliateCode");

-- CreateIndex
CREATE INDEX "AffiliateOrder_shop_customerId_idx" ON "AffiliateOrder"("shop", "customerId");

-- CreateIndex
CREATE INDEX "AffiliateOrder_shop_affiliateCode_orderDate_idx" ON "AffiliateOrder"("shop", "affiliateCode", "orderDate");

-- CreateIndex
CREATE INDEX "AffiliateOrganicAgg_shop_idx" ON "AffiliateOrganicAgg"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateOrganicAgg_shop_month_key" ON "AffiliateOrganicAgg"("shop", "month");

-- CreateIndex
CREATE INDEX "AffiliateMonthly_shop_month_idx" ON "AffiliateMonthly"("shop", "month");

-- CreateIndex
CREATE INDEX "AffiliateMonthly_shop_affiliateCode_idx" ON "AffiliateMonthly"("shop", "affiliateCode");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateMonthly_shop_affiliateCode_month_key" ON "AffiliateMonthly"("shop", "affiliateCode", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateSyncMeta_shop_key" ON "AffiliateSyncMeta"("shop");
