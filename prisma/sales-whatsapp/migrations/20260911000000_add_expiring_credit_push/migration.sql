-- CreateTable
CREATE TABLE "ExpiringCreditPush" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "trancheCreatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "timingArm" TEXT NOT NULL,
    "pawSlot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpiringCreditPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpiringCreditPush_shop_status_expiresAt_idx" ON "ExpiringCreditPush"("shop", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpiringCreditPush_shop_customerGid_trancheCreatedAt_key" ON "ExpiringCreditPush"("shop", "customerGid", "trancheCreatedAt");
