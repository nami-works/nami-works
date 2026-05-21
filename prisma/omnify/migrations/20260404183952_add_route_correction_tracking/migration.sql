-- CreateTable
CREATE TABLE "RouteOptimizationSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedRoutes" JSONB NOT NULL,
    "orderCoordinates" JSONB NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "routeCount" INTEGER NOT NULL,

    CONSTRAINT "RouteOptimizationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteCorrection" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedRouteIndex" INTEGER,
    "corrections" JSONB NOT NULL,
    "wasModified" BOOLEAN NOT NULL,
    "ordersReassigned" INTEGER NOT NULL,
    "ordersDispatched" INTEGER NOT NULL,

    CONSTRAINT "RouteCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteOptimizationSnapshot_shop_locationId_proposedAt_idx" ON "RouteOptimizationSnapshot"("shop", "locationId", "proposedAt");

-- CreateIndex
CREATE INDEX "RouteCorrection_shop_dispatchedAt_idx" ON "RouteCorrection"("shop", "dispatchedAt");

-- CreateIndex
CREATE INDEX "RouteCorrection_snapshotId_idx" ON "RouteCorrection"("snapshotId");
