// Route-agnostic types for the Campaign goals module.
// Imported by both server (storage/match) and client (components).

export type CampaignStatus = "draft" | "active" | "ended" | "archived";

export type CampaignMetric =
  | "bundle_orders"
  | "specific_products"
  | "specific_combination"
  | "aov"
  | "revenue";

export type CampaignMatchRule =
  | { type: "lineItemTag"; values: string[] }
  | { type: "lineItemSku"; values: string[] }
  | { type: "lineItemProductType"; values: string[] }
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
  targetValue: number;
  baselineValue: number | null;
};

export type CampaignLocationProgress = {
  locationId: string;
  locationName: string;
  targetOrders: number;
  baselineOrders: number | null;
  matchedOrders: number;
  totalOrders: number;
  attachRate: number | null; // matchedOrders / totalOrders, 0..1
  achievementPercent: number | null; // matchedOrders / targetOrders, %
  targetValue: number;
  matchedValue: number;
  achievementPercentValue: number | null;
};

export type CampaignProgressView = {
  campaign: CampaignGoalView;
  totalMatched: number;
  totalOrders: number;
  overallAttachRate: number | null;
  overallAchievementPercent: number | null;
  perLocation: CampaignLocationProgress[];
  elapsedFraction: number; // 0..1
  totalMatchedValue: number;
  totalTargetValue: number;
  overallAchievementPercentValue: number | null;
};

export type OrderSnapshotForMatching = {
  orderId: string;
  orderTags: string[];
  lineItems: Array<{
    productId: string | null;
    sku: string | null;
    productType: string | null;
    productTags: string[];
    properties: Array<{ name: string; value: string }>;
  }>;
};
