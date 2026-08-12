-- CreateIndex: tenant lookup by shop domain (incoming Shopify webhooks carry X-Shopify-Shop-Domain)
CREATE INDEX "IntegrationTenant_shopifyShop_idx" ON "IntegrationTenant"("shopifyShop");

-- CreateTable
CREATE TABLE "JustBoughtCreditIssuance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "orderTotal" DOUBLE PRECISION NOT NULL,
    "creditAmount" DOUBLE PRECISION NOT NULL,
    "armDays" INTEGER NOT NULL,
    "armTag" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "JustBoughtCreditIssuance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JustBoughtCreditIssuance_tenantId_shopifyOrderId_key" ON "JustBoughtCreditIssuance"("tenantId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "JustBoughtCreditIssuance_tenantId_issuedAt_idx" ON "JustBoughtCreditIssuance"("tenantId", "issuedAt");

-- AddForeignKey
ALTER TABLE "JustBoughtCreditIssuance" ADD CONSTRAINT "JustBoughtCreditIssuance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
