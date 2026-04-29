-- Extend RoutePolylineCache so a cache hit can satisfy the full update-routes
-- response without re-calling Google Routes.
-- Nullable: legacy rows fall through to recompute on the next update-routes hit.
ALTER TABLE "RoutePolylineCache"
  ADD COLUMN "distanceMeters" INTEGER,
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "orderedIdsKey" TEXT;
