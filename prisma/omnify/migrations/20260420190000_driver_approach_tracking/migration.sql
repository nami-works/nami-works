-- Driver-approach tracking for /api/control/check-dispatches
-- 4-min cadence, 3-strike reorder rule
ALTER TABLE "LalamoveDispatchJob"
  ADD COLUMN "lastDriverLat" DOUBLE PRECISION,
  ADD COLUMN "lastDriverLng" DOUBLE PRECISION,
  ADD COLUMN "lastDriverSampledAt" TIMESTAMP(3),
  ADD COLUMN "lastDistanceToPickupM" DOUBLE PRECISION,
  ADD COLUMN "approachFailCount" INTEGER NOT NULL DEFAULT 0;
