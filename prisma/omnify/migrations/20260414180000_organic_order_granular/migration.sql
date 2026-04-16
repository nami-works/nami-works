-- Per-customer organic order history. Enables cohort LTV + future per-customer analytics.
CREATE TABLE "OrganicOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderName" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currencyCode" TEXT,
    "wasPreExistingCustomer" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "orderDate" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganicOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganicOrder_shop_orderDate_idx" ON "OrganicOrder"("shop", "orderDate");
CREATE INDEX "OrganicOrder_shop_customerId_idx" ON "OrganicOrder"("shop", "customerId");
CREATE INDEX "OrganicOrder_shop_customerId_orderDate_idx" ON "OrganicOrder"("shop", "customerId", "orderDate");
