/**
 * Affiliates — shared types used by both server modules and route components.
 *
 * Keeping these in a dedicated module (rather than re-exporting from a server
 * module) prevents accidental client-bundle inclusion of Prisma when a route
 * imports a single type.
 */

export type AffiliateProgramSummary = {
  id: string;
  label: string;
  discountNodeId: string;
  discountTitle: string;
  status: "active" | "removed";
  lastSyncedAt: string | null;
  lastSyncStatus: "ok" | "failed" | null;
  lastSyncError: string | null;
  codesCount: number;
  mappedCount: number;
};

export type DiscountSearchResult = {
  nodeId: string;
  title: string;
  status: "ACTIVE" | "EXPIRED" | "SCHEDULED";
  codesCount: number;
};

export type AffiliateCronHealth = {
  status: "fresh" | "stale" | "unknown";
  lastSuccessAt: string | null;
  lastFailureMessage: string | null;
  ageMinutes: number | null;
};

export type UnmappedCodeRow = {
  code: string;
  firstSeenAt: string;
  ordersCount: number;
  revenue: number;
  currencyCode: string | null;
  programLabel: string | null;
};
