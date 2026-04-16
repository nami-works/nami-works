// Route-agnostic types for the Campaign goals module.
// Imported by both server (storage/match) and client (components).

export type CampaignStatus = "draft" | "active" | "ended" | "archived";

export type CampaignMetric = "bundle_orders"; // V1; extensible to "units" etc.

// Flexible match-rule shape. Refined from a sample injected order once available.
// The schema accepts any of these variants without migration.
export type CampaignMatchRule =
  | { type: "lineItemTag"; values: string[] }
  | { type: "lineItemSku"; values: string[] }
  | { type: "lineItemProductId"; values: string[] }
  | { type: "lineItemProperty"; key: string; value?: string }
  | { type: "orderTag"; values: string[] }
  | { type: "any"; rules: CampaignMatchRule[] }
  | { type: "all"; rules: CampaignMatchRule[] };

export type CampaignGoalView = {
  id: string;
  name: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  metric: CampaignMetric;
  matchRule: CampaignMatchRule;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  targets: CampaignTargetView[];
};

export type CampaignTargetView = {
  locationId: string;
  locationName: string;
  targetOrders: number;
  baselineOrders: number | null;
};

export type CampaignLocationProgress = {
  locationId: string;
  locationName: string;
  targetOrders: number;
  baselineOrders: number | null;
  matchedOrders: number; // orders containing the matching item
  totalOrders: number; // denominator for attach rate
  attachRate: number | null; // matchedOrders / totalOrders, 0..1
  achievementPercent: number | null; // matchedOrders / targetOrders, %
};

export type CampaignProgressView = {
  campaign: CampaignGoalView;
  totalMatched: number;
  totalOrders: number;
  overallAttachRate: number | null;
  overallAchievementPercent: number | null;
  perLocation: CampaignLocationProgress[];
  // Elapsed fraction of campaign duration. 0..1. For "pace" math.
  elapsedFraction: number;
};

// Webhook/backfill uses this shape; lightweight subset of Shopify Order.
export type OrderSnapshotForMatching = {
  orderId: string;
  orderTags: string[];
  lineItems: Array<{
    productId: string | null;
    sku: string | null;
    productTags: string[];
    properties: Array<{ name: string; value: string }>;
  }>;
};
