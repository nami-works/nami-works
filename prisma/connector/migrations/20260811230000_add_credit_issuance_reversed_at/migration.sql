-- AlterTable: reversedAt doubles as the refund-clawback idempotency guard
ALTER TABLE "JustBoughtCreditIssuance" ADD COLUMN "reversedAt" TIMESTAMP(3);
