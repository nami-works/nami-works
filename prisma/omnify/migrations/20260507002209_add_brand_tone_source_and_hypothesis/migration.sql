-- CreateTable
CREATE TABLE "BrandToneSource" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawText" TEXT NOT NULL,
    "contentLanguage" TEXT,
    "metaJson" JSONB,
    "batchId" TEXT NOT NULL,

    CONSTRAINT "BrandToneSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandToneHypothesis" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "BrandToneHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandToneSource_shop_sourceType_idx" ON "BrandToneSource"("shop", "sourceType");

-- CreateIndex
CREATE INDEX "BrandToneSource_shop_batchId_idx" ON "BrandToneSource"("shop", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandToneSource_shop_sourceType_sourceId_key" ON "BrandToneSource"("shop", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BrandToneHypothesis_shop_status_idx" ON "BrandToneHypothesis"("shop", "status");

-- CreateIndex
CREATE INDEX "BrandToneHypothesis_shop_batchId_idx" ON "BrandToneHypothesis"("shop", "batchId");
