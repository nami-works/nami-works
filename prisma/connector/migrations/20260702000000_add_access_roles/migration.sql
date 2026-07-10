-- CreateEnum
CREATE TYPE "ConnectorSystem" AS ENUM ('shopify_orders', 'shopify_products', 'shopify_discounts', 'shopify_customers', 'shopify_reports', 'omie', 'instagram', 'brand', 'affiliates');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('none', 'read', 'readwrite');

-- CreateTable
CREATE TABLE "AccessRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "grants" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrincipalRoleAssignment" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrincipalRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessRole_tenantId_idx" ON "AccessRole"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_tenantId_key_key" ON "AccessRole"("tenantId", "key");

-- CreateIndex
CREATE INDEX "PrincipalRoleAssignment_principalId_idx" ON "PrincipalRoleAssignment"("principalId");

-- CreateIndex
CREATE INDEX "PrincipalRoleAssignment_roleId_idx" ON "PrincipalRoleAssignment"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "PrincipalRoleAssignment_principalId_roleId_key" ON "PrincipalRoleAssignment"("principalId", "roleId");

-- AddForeignKey
ALTER TABLE "AccessRole" ADD CONSTRAINT "AccessRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrincipalRoleAssignment" ADD CONSTRAINT "PrincipalRoleAssignment_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "TenantPrincipal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrincipalRoleAssignment" ADD CONSTRAINT "PrincipalRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
