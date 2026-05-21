-- Loyalty A/B Test (GE Beauty post-purchase retention) + cross-campaign IssuedIncentive
-- 4 tables for test-specific + cross-campaign incentive data Shopify does not model:
--   LoyaltyEnrollment   — arm assignment + test clock + abuse hash + cron schedule
--   LoyaltyRedemption   — redemption events for analytics
--   LoyaltyMessageLog   — message dispatch audit (Klaviyo + Zoko)
--   IssuedIncentive     — cross-campaign issuance + watchdog (revoke on cancel/refund)
-- Tranche amounts (Arm A) and discount-code state (Arms B+C) live in Shopify
-- natively — NOT duplicated here.
-- Brief: inputs/growth-gebeauty-loyalty-ab-test-2026-05-16.md

-- CreateTable
CREATE TABLE "LoyaltyEnrollment" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "originalOrderId" TEXT NOT NULL,
    "originalOrderAmount" DOUBLE PRECISION NOT NULL,
    "originalOrderCurrency" TEXT NOT NULL DEFAULT 'BRL',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "shippingAddressHash" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyRedemption" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderAmount" DOUBLE PRECISION NOT NULL,
    "amountRedeemed" DOUBLE PRECISION NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL,
    "windowAtRedemption" INTEGER NOT NULL,
    "shopifyDebitTransactionId" TEXT,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyMessageLog" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "recipientHandle" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "deliveryError" TEXT,
    "providerMessageId" TEXT,
    "providerWebhookReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedIncentive" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "campaignTag" TEXT NOT NULL,
    "originalOrderId" TEXT NOT NULL,
    "originalOrderAmount" DOUBLE PRECISION NOT NULL,
    "originalOrderCurrency" TEXT NOT NULL DEFAULT 'BRL',
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "shopifyRef" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuedIncentive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoyaltyEnrollment_customerId_idx" ON "LoyaltyEnrollment"("customerId");

-- CreateIndex
CREATE INDEX "LoyaltyEnrollment_shop_status_nextActionAt_idx" ON "LoyaltyEnrollment"("shop", "status", "nextActionAt");

-- CreateIndex
CREATE INDEX "LoyaltyEnrollment_shippingAddressHash_idx" ON "LoyaltyEnrollment"("shippingAddressHash");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_enrollmentId_idx" ON "LoyaltyRedemption"("enrollmentId");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_shopifyOrderId_idx" ON "LoyaltyRedemption"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_redeemedAt_idx" ON "LoyaltyRedemption"("redeemedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyMessageLog_enrollmentId_channel_messageType_key" ON "LoyaltyMessageLog"("enrollmentId", "channel", "messageType");

-- CreateIndex
CREATE INDEX "LoyaltyMessageLog_enrollmentId_idx" ON "LoyaltyMessageLog"("enrollmentId");

-- CreateIndex
CREATE INDEX "LoyaltyMessageLog_sentAt_idx" ON "LoyaltyMessageLog"("sentAt");

-- CreateIndex
CREATE INDEX "IssuedIncentive_shop_originalOrderId_status_idx" ON "IssuedIncentive"("shop", "originalOrderId", "status");

-- CreateIndex
CREATE INDEX "IssuedIncentive_shop_status_expiresAt_idx" ON "IssuedIncentive"("shop", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "IssuedIncentive_customerId_idx" ON "IssuedIncentive"("customerId");

-- CreateIndex
CREATE INDEX "IssuedIncentive_shop_campaignTag_idx" ON "IssuedIncentive"("shop", "campaignTag");

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "LoyaltyEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMessageLog" ADD CONSTRAINT "LoyaltyMessageLog_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "LoyaltyEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
