-- AlterTable: customer identity (display name + email) for the compiled
-- customer drill-down, and the pre-existing-customer classification flag
-- for the margin-leakage alert logic.
ALTER TABLE "AffiliateOrder"
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "wasPreExistingCustomer" BOOLEAN NOT NULL DEFAULT false,
  DROP COLUMN IF EXISTS "isFirstOrder";
