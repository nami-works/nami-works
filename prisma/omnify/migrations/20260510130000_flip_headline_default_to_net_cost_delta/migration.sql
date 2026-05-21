-- Flip the LdAnalyticsConfig.headlineFraming default from "pl_impact" to "net_cost_delta".
--
-- Rationale: v1 cannot compute pl_impact accurately because ShopOrder does not capture
-- shippingLines (the customer-charged LD shipping amount). The pl_impact formula depends
-- on LD revenue as an input; without it the headline number is artificially low. Flipping
-- the default to net_cost_delta (LD carrier cost vs warehouse counterfactual cost) avoids
-- showing a misleading headline. Merchants can still switch to pl_impact via the picker
-- once they configure manual overrides; we will flip the default back when shippingLines
-- capture lands in v2.
--
-- Existing rows are not updated — only new shops onboarded after this migration get the
-- new default. As of this migration there should be zero LdAnalyticsConfig rows in
-- production (feature is gated behind opt-in toggle, default false, never shipped).

ALTER TABLE "LdAnalyticsConfig"
  ALTER COLUMN "headlineFraming" SET DEFAULT 'net_cost_delta';
