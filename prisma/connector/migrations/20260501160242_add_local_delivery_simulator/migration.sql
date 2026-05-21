-- CreateTable
CREATE TABLE "LdSimBatch" (
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION,
    "pickupLng" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LdSimBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LdSimTweak" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "proposedRoutes" JSONB NOT NULL,
    "proposedQuote" JSONB,
    "baselineQuote" JSONB,
    "annotation" TEXT,
    "tags" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LdSimTweak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LdSimGeocache" (
    "id" SERIAL NOT NULL,
    "addressKey" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LdSimGeocache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LdSimBatch_tenantId_idx" ON "LdSimBatch"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LdSimBatch_tenantId_date_locationId_key" ON "LdSimBatch"("tenantId", "date", "locationId");

-- CreateIndex
CREATE INDEX "LdSimTweak_batchId_idx" ON "LdSimTweak"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "LdSimGeocache_addressKey_key" ON "LdSimGeocache"("addressKey");

-- AddForeignKey
ALTER TABLE "LdSimTweak" ADD CONSTRAINT "LdSimTweak_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LdSimBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
