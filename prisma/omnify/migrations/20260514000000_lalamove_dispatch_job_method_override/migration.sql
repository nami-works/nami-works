-- Adds methodOverride flag to LalamoveDispatchJob. Set true when the dispatch
-- was placed via the warehouse-method override flow (operator dispatched an
-- order whose Shopify deliveryMethod is not LOCAL). Filterable for audit.
-- Default false is correct for all existing rows.

ALTER TABLE "LalamoveDispatchJob"
ADD COLUMN "methodOverride" BOOLEAN NOT NULL DEFAULT false;
