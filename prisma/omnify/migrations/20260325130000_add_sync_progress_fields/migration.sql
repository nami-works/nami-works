-- AlterTable
ALTER TABLE "RetailAnalyticsSyncStatus"
  ADD COLUMN "phase"              TEXT,
  ADD COLUMN "progressCount"      INTEGER,
  ADD COLUMN "startedAt"          TIMESTAMP(3),
  ADD COLUMN "lastCustomersTotal" INTEGER,
  ADD COLUMN "lastOrdersTotal"    INTEGER;
