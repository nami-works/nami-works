-- CreateTable
CREATE TABLE "ReturnPickupRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "locationId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerAddress" TEXT,
    "customerAddress2" TEXT,
    "customerLat" DOUBLE PRECISION,
    "customerLng" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "returnInstructions" TEXT,
    "quotationId" TEXT,
    "lalamoveOrderId" TEXT,
    "quotationTotal" TEXT,
    "quotationCurrency" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnPickupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnPickupRequest_shop_status_idx" ON "ReturnPickupRequest"("shop", "status");

-- CreateIndex
CREATE INDEX "ReturnPickupRequest_shop_locationId_status_idx" ON "ReturnPickupRequest"("shop", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPickupRequest_shop_shopifyOrderId_key" ON "ReturnPickupRequest"("shop", "shopifyOrderId");
