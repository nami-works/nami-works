-- CreateTable
CREATE TABLE "AffiliateProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "affiliateCode" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT,
    "commissionPercent" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateMonthly" (
    "id" TEXT NOT NULL,
    "affiliateProfileId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "grossRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "commissionOwedCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliateProfile_tenantId_idx" ON "AffiliateProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProfile_tenantId_affiliateCode_key" ON "AffiliateProfile"("tenantId", "affiliateCode");

-- CreateIndex
CREATE INDEX "AffiliateMonthly_affiliateProfileId_idx" ON "AffiliateMonthly"("affiliateProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateMonthly_affiliateProfileId_yearMonth_key" ON "AffiliateMonthly"("affiliateProfileId", "yearMonth");

-- AddForeignKey
ALTER TABLE "AffiliateProfile" ADD CONSTRAINT "AffiliateProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateMonthly" ADD CONSTRAINT "AffiliateMonthly_affiliateProfileId_fkey" FOREIGN KEY ("affiliateProfileId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
