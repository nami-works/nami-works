/*
  Warnings:

  - The primary key for the `RetailAnalyticsSyncStatus` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "RetailAnalyticsSyncStatus" DROP CONSTRAINT "RetailAnalyticsSyncStatus_pkey";

-- CreateTable
CREATE TABLE "RetailOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT,
    "city" TEXT,
    "cityNorm" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION,
    "currencyCode" TEXT,
    "orderDate" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailCustomer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "city" TEXT,
    "cityNorm" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "customerDate" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailCityMonthly" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "cityNorm" TEXT NOT NULL,
    "cityDisplay" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uniqueCustomers" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT,
    "latitudeSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "longitudeSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "geocodedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RetailCityMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailHeatmapBucket" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "lat3" DOUBLE PRECISION NOT NULL,
    "lng3" DOUBLE PRECISION NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "revenueSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "customerCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RetailHeatmapBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailSyncMeta" (
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "errorMessage" TEXT,
    "phase" TEXT,
    "progressCount" INTEGER,
    "startedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastOrderDate" TIMESTAMP(3),
    "lastCustomerDate" TIMESTAMP(3),
    "totalOrders" INTEGER,
    "totalCustomers" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "RetailOrder_shop_orderDate_idx" ON "RetailOrder"("shop", "orderDate");

-- CreateIndex
CREATE INDEX "RetailOrder_shop_cityNorm_idx" ON "RetailOrder"("shop", "cityNorm");

-- CreateIndex
CREATE INDEX "RetailOrder_shop_latitude_longitude_idx" ON "RetailOrder"("shop", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "RetailCustomer_shop_customerDate_idx" ON "RetailCustomer"("shop", "customerDate");

-- CreateIndex
CREATE INDEX "RetailCustomer_shop_cityNorm_idx" ON "RetailCustomer"("shop", "cityNorm");

-- CreateIndex
CREATE INDEX "RetailCityMonthly_shop_month_idx" ON "RetailCityMonthly"("shop", "month");

-- CreateIndex
CREATE UNIQUE INDEX "RetailCityMonthly_shop_cityNorm_month_key" ON "RetailCityMonthly"("shop", "cityNorm", "month");

-- CreateIndex
CREATE INDEX "RetailHeatmapBucket_shop_idx" ON "RetailHeatmapBucket"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "RetailHeatmapBucket_shop_lat3_lng3_key" ON "RetailHeatmapBucket"("shop", "lat3", "lng3");

-- CreateIndex
CREATE UNIQUE INDEX "RetailSyncMeta_shop_key" ON "RetailSyncMeta"("shop");
