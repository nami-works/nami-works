-- LD Analytics aside block — track first render per shop to drive the 14-day "new" pill.
-- See docs/plans/local-delivery-analytics-aside.md §3.
-- Additive nullable column; existing shops backfill on first sidebar render.

ALTER TABLE "LdAnalyticsConfig"
  ADD COLUMN "asideFirstSeenAt" TIMESTAMP(3);
