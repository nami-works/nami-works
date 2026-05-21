-- CreateTable
CREATE TABLE "AttributionClaim" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderGid" TEXT,
    "couponCode" TEXT NOT NULL,
    "affiliateCode" TEXT,
    "affiliateEmail" TEXT,
    "subtotal" DOUBLE PRECISION,
    "currencyCode" TEXT,
    "sourceName" TEXT,
    "orderDate" TIMESTAMP(3),
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedVia" TEXT,

    CONSTRAINT "AttributionClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidosImport" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "maxOrderDate" TIMESTAMP(3),
    "claimsConfirmed" INTEGER NOT NULL DEFAULT 0,
    "fileName" TEXT,

    CONSTRAINT "PedidosImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BixgrowAttributedOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3),
    "importId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BixgrowAttributedOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttributionClaim_shop_confirmedAt_idx" ON "AttributionClaim"("shop", "confirmedAt");

-- CreateIndex
CREATE INDEX "AttributionClaim_shop_claimedAt_idx" ON "AttributionClaim"("shop", "claimedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionClaim_shop_orderName_key" ON "AttributionClaim"("shop", "orderName");

-- CreateIndex
CREATE INDEX "PedidosImport_shop_importedAt_idx" ON "PedidosImport"("shop", "importedAt");

-- CreateIndex
CREATE INDEX "BixgrowAttributedOrder_shop_importId_idx" ON "BixgrowAttributedOrder"("shop", "importId");

-- CreateIndex
CREATE UNIQUE INDEX "BixgrowAttributedOrder_shop_orderName_key" ON "BixgrowAttributedOrder"("shop", "orderName");
