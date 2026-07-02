-- CreateEnum
CREATE TYPE "PrincipalRole" AS ENUM ('owner', 'operator');

-- AlterTable
ALTER TABLE "ToolInvocationLog" ADD COLUMN     "actorLabel" TEXT,
ADD COLUMN     "principalId" TEXT;

-- CreateTable
CREATE TABLE "TenantPrincipal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "bearerTokenHash" TEXT NOT NULL,
    "role" "PrincipalRole" NOT NULL DEFAULT 'operator',
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPrincipal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantPrincipal_bearerTokenHash_key" ON "TenantPrincipal"("bearerTokenHash");

-- CreateIndex
CREATE INDEX "TenantPrincipal_tenantId_idx" ON "TenantPrincipal"("tenantId");

-- CreateIndex
CREATE INDEX "TenantPrincipal_status_idx" ON "TenantPrincipal"("status");

-- AddForeignKey
ALTER TABLE "TenantPrincipal" ADD CONSTRAINT "TenantPrincipal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
