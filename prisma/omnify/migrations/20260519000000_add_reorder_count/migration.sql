-- Add reorderCount column to LalamoveDispatchJob.
-- Independent of retryCount (which counts autoRetryDispatchJob).
-- reorderJob increments this; cap enforced in app code.
ALTER TABLE "LalamoveDispatchJob" ADD COLUMN "reorderCount" INTEGER NOT NULL DEFAULT 0;
