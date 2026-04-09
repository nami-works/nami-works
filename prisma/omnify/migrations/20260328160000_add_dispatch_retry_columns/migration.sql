-- AlterTable
ALTER TABLE "LalamoveDispatchJob" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LalamoveDispatchJob" ADD COLUMN "lastRetryAt" TIMESTAMP(3);
