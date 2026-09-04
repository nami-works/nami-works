-- AlterTable: armForcedReason audits the 100km-physical-store/pickup override
-- (null = random 3-arm draw, non-null = which condition forced 60 days).
ALTER TABLE "JustBoughtCreditIssuance" ADD COLUMN "armForcedReason" TEXT;
