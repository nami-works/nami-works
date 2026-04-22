-- CreateEnum
CREATE TYPE "Brand" AS ENUM ('cpg-labs');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'disabled');

-- CreateTable
CREATE TABLE "IntegrationTenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "shopifyShop" TEXT,
    "bearerTokenHash" TEXT NOT NULL,
    "ssmPrefix" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "contactEmail" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationTenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolInvocationLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolInvocationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationTenant_slug_key" ON "IntegrationTenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationTenant_bearerTokenHash_key" ON "IntegrationTenant"("bearerTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationTenant_ssmPrefix_key" ON "IntegrationTenant"("ssmPrefix");

-- CreateIndex
CREATE INDEX "IntegrationTenant_status_idx" ON "IntegrationTenant"("status");

-- CreateIndex
CREATE INDEX "ToolInvocationLog_tenantId_createdAt_idx" ON "ToolInvocationLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolInvocationLog_requestId_idx" ON "ToolInvocationLog"("requestId");

-- AddForeignKey
ALTER TABLE "ToolInvocationLog" ADD CONSTRAINT "ToolInvocationLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
