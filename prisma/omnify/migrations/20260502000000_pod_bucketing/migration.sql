-- Per-stop POD bucketing for handleMarkDelivered (issue #1, blueprint §13.8)
-- Bucket persisted on the dispatch job; per-stop outcome persisted on the order map.

ALTER TABLE "LalamoveDispatchJob"
  ADD COLUMN "podBucket" TEXT,
  ADD COLUMN "partialDelivery" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastBucketingAt" TIMESTAMP(3);

ALTER TABLE "LalamoveDispatchOrderMap"
  ADD COLUMN "stopOutcome" TEXT,
  ADD COLUMN "stopFailureReason" TEXT;
