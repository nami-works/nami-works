-- CreateTable
CREATE TABLE "RetailAnalyticsSyncStatus" (
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "errorMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailAnalyticsSyncStatus_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetailAnalyticsSyncStatus_shop_key" ON "RetailAnalyticsSyncStatus"("shop");
