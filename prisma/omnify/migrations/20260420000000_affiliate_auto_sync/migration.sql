-- Phase 3: Bring Affiliates under auto-sync.
-- Adds two thin tables that pair with the new webhook + hourly cron:
--   AttributionCandidate:     flagged at webhook time for IGLU/WhatsApp orders
--                             carrying a UGC coupon code. Lets the Attribution
--                             tab surface fresh candidates without paginating
--                             Shopify on every tab load.
--   AttributionQueueSnapshot: one row per shop; cached output of the hourly
--                             affiliates-sync cron. Attribution tab loader
--                             paints from here first and falls back to live
--                             build when the snapshot is missing.

-- CreateTable
CREATE TABLE "AttributionCandidate" (
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT,
    "sourceName" TEXT,
    "primaryCoupon" TEXT,
    "orderDate" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discoveredVia" TEXT,

    CONSTRAINT "AttributionCandidate_pkey" PRIMARY KEY ("shop","orderGid")
);

-- CreateIndex
CREATE INDEX "AttributionCandidate_shop_orderDate_idx" ON "AttributionCandidate"("shop","orderDate");
CREATE INDEX "AttributionCandidate_shop_primaryCoupon_idx" ON "AttributionCandidate"("shop","primaryCoupon");

-- CreateTable
CREATE TABLE "AttributionQueueSnapshot" (
    "shop" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedVia" TEXT,
    "lookbackDays" INTEGER NOT NULL DEFAULT 90,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "claimedCount" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "rowsJson" JSONB NOT NULL DEFAULT '[]',
    "statsJson" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributionQueueSnapshot_pkey" PRIMARY KEY ("shop")
);
