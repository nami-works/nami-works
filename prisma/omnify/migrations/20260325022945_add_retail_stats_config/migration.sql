-- CreateTable
CREATE TABLE "RetailStatsConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "setId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailStatsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetailStatsConfig_shop_idx" ON "RetailStatsConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "RetailStatsConfig_shop_setId_key" ON "RetailStatsConfig"("shop", "setId");
