-- CreateTable
CREATE TABLE "RetailLocationProposal" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationSetId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "leasingValue" DOUBLE PRECISION,
    "currency" TEXT,
    "notes" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "fileData" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailLocationProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetailLocationProposal_shop_locationSetId_idx" ON "RetailLocationProposal"("shop", "locationSetId");

-- CreateIndex
CREATE INDEX "RetailLocationProposal_shop_locationId_idx" ON "RetailLocationProposal"("shop", "locationId");
