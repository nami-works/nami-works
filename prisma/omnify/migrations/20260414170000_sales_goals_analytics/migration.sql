-- Sales Goals analytics: source-aware per-order facts and pre-computed
-- monthly aggregates so the dashboard can query Postgres instead of the
-- Shopify Admin API on every page load.

-- Per-order facts, POS-only (web orders are filtered out at ingest time).
CREATE TABLE "SalesOrder" (
    "id"           TEXT        NOT NULL,
    "shop"         TEXT        NOT NULL,
    "source"       TEXT        NOT NULL,
    "locationId"   TEXT        NOT NULL,
    "locationName" TEXT        NOT NULL,
    "orderDate"    TIMESTAMP(3) NOT NULL,
    "totalAmount"  DOUBLE PRECISION NOT NULL,
    "currencyCode" TEXT,
    "syncedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesOrder_shop_locationId_orderDate_idx"
  ON "SalesOrder" ("shop", "locationId", "orderDate");

CREATE INDEX "SalesOrder_shop_orderDate_idx"
  ON "SalesOrder" ("shop", "orderDate");

-- Pre-computed monthly aggregate; unique per (shop, location, month).
CREATE TABLE "SalesOrderMonthly" (
    "id"           TEXT        NOT NULL,
    "shop"         TEXT        NOT NULL,
    "locationId"   TEXT        NOT NULL,
    "locationName" TEXT        NOT NULL,
    "month"        TEXT        NOT NULL,
    "orderCount"   INTEGER     NOT NULL DEFAULT 0,
    "revenue"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currencyCode" TEXT,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesOrderMonthly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOrderMonthly_shop_locationId_month_key"
  ON "SalesOrderMonthly" ("shop", "locationId", "month");

CREATE INDEX "SalesOrderMonthly_shop_month_idx"
  ON "SalesOrderMonthly" ("shop", "month");

-- Sync status (backfill progress, last-synced timestamp) per shop.
CREATE TABLE "SalesGoalsSyncMeta" (
    "shop"          TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'idle',
    "phase"         TEXT,
    "progressCount" INTEGER,
    "totalOrders"   INTEGER,
    "lastSyncedAt"  TIMESTAMP(3),
    "lastOrderDate" TIMESTAMP(3),
    "errorMessage"  TEXT,
    "startedAt"     TIMESTAMP(3),
    "updatedAt"     TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "SalesGoalsSyncMeta_shop_key"
  ON "SalesGoalsSyncMeta" ("shop");
