-- Drop the old VoiceCard pipeline. Per docs/tov-migration-decisions.md (Q0),
-- the hypothesis-driven tone-sources pipeline replaces VoiceCard entirely; no
-- live consumers depend on the old table at the time of cutover, so the
-- existing row(s) are discarded.
DROP TABLE "VoiceCard";

-- AlterTable
ALTER TABLE "IntegrationTenant" ADD COLUMN "contentLanguage" TEXT;

-- Backfill the GE Beauty tenant (the only live tenant at the time of the
-- migration). Future tenants set contentLanguage at onboarding.
UPDATE "IntegrationTenant" SET "contentLanguage" = 'pt-BR' WHERE "slug" = 'gebeauty';

-- CreateTable
CREATE TABLE "TenantBrand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandName" TEXT,
    "about" TEXT,
    "toneOfVoice" TEXT,
    "editorialGuidelines" TEXT,
    "benchmarks" TEXT,
    "brandCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandToneSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
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
    "tenantId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "BrandIntegrationConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationType" TEXT NOT NULL,
    "configCipher" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandIntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantBrand_tenantId_key" ON "TenantBrand"("tenantId");

-- CreateIndex
CREATE INDEX "BrandToneSource_tenantId_sourceType_idx" ON "BrandToneSource"("tenantId", "sourceType");

-- CreateIndex
CREATE INDEX "BrandToneSource_tenantId_batchId_idx" ON "BrandToneSource"("tenantId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandToneSource_tenantId_sourceType_sourceId_key" ON "BrandToneSource"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BrandToneHypothesis_tenantId_status_idx" ON "BrandToneHypothesis"("tenantId", "status");

-- CreateIndex
CREATE INDEX "BrandToneHypothesis_tenantId_batchId_idx" ON "BrandToneHypothesis"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "BrandIntegrationConfig_tenantId_idx" ON "BrandIntegrationConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandIntegrationConfig_tenantId_integrationType_key" ON "BrandIntegrationConfig"("tenantId", "integrationType");

-- AddForeignKey
ALTER TABLE "TenantBrand" ADD CONSTRAINT "TenantBrand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandToneSource" ADD CONSTRAINT "BrandToneSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandToneHypothesis" ADD CONSTRAINT "BrandToneHypothesis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandIntegrationConfig" ADD CONSTRAINT "BrandIntegrationConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
