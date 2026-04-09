-- AlterTable
ALTER TABLE "RetailOrder" ADD COLUMN     "fulfillmentLocationId" TEXT;

-- CreateIndex
CREATE INDEX "RetailOrder_shop_fulfillmentLocationId_idx" ON "RetailOrder"("shop", "fulfillmentLocationId");
