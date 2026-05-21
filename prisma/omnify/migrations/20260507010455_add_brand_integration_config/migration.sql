-- CreateTable
CREATE TABLE "BrandIntegrationConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "integrationType" TEXT NOT NULL,
    "configCipher" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandIntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandIntegrationConfig_shop_idx" ON "BrandIntegrationConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "BrandIntegrationConfig_shop_integrationType_key" ON "BrandIntegrationConfig"("shop", "integrationType");
