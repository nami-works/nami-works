-- AlterTable: Google-login principals have no bearer; add Google identity + invite timestamp.
ALTER TABLE "TenantPrincipal" ALTER COLUMN "bearerTokenHash" DROP NOT NULL,
ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "invitedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "TenantPrincipal_googleSub_key" ON "TenantPrincipal"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPrincipal_tenantId_contactEmail_key" ON "TenantPrincipal"("tenantId", "contactEmail");
