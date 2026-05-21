// Source-aware order classification + retail location filter.
// Used by the sales-goals loader, sync, and webhook handlers.

export type SalesOrderSource = "shopify-pos" | "iglu-pos";

export const IGLU_APP_SOURCE = "206755758081";

export type ShopifyLocationRaw = {
  id: string;
  name: string;
  isActive?: boolean;
  isFulfillmentService?: boolean;
  fulfillmentService?: { id: string } | null;
};

export type RetailLocation = {
  id: string;
  name: string;
};

/**
 * Candidate locations for Sales Goals: every active, non-fulfillment-service
 * location in the shop. Shopify GraphQL doesn't expose a direct "Physical
 * storefront" boolean, so we take the broad set here and let the merchant
 * opt out warehouses via the `LocationConfig.enabled` toggle in Settings.
 */
export const filterCandidateLocations = (
  locations: ShopifyLocationRaw[],
): RetailLocation[] =>
  locations
    .filter(
      (loc) =>
        loc.isActive !== false &&
        loc.isFulfillmentService !== true &&
        !loc.fulfillmentService,
    )
    .map(({ id, name }) => ({ id, name }));

/**
 * Classifies an order source as Shopify POS or IGLU POS.
 * Returns null for web orders and any other source — those are not
 * attributed to retail locations.
 */
export const classifySource = (
  sourceName: string | null | undefined,
): SalesOrderSource | null => {
  if (sourceName === "pos") return "shopify-pos";
  if (sourceName === IGLU_APP_SOURCE) return "iglu-pos";
  return null;
};

/** Human-readable label for filter suggestions. */
export const sourceLabel = (source: SalesOrderSource): string => {
  if (source === "shopify-pos") return "Point of Sale";
  return "IGLU POS";
};

export type OrderForResolution = {
  name: string;
  sourceName: string | null;
  tags: string[];
  physicalLocation: { id: string; name: string } | null;
};

export type ResolvedOrderLocation = {
  locationId: string;
  locationName: string;
  source: SalesOrderSource;
};

/**
 * Determines which retail location an order should be attributed to.
 *
 * - Shopify POS: `physicalLocation` is authoritative (the actual store).
 * - IGLU POS: `physicalLocation` is always "CD Cajamar" (wrong);
 *   we match by finding a retail location whose name appears in the
 *   order tags.
 * - Anything else (web, unknown): returns null.
 *
 * Returns null when no match is found (e.g. IGLU order tagged with a
 * closed store like "Iguatemi Fortaleza"); those orders are dropped,
 * per product decision.
 */
export const resolveOrderLocation = (
  order: OrderForResolution,
  retailLocations: RetailLocation[],
): ResolvedOrderLocation | null => {
  const source = classifySource(order.sourceName);
  if (!source) return null;

  if (source === "shopify-pos") {
    const match = retailLocations.find(
      (loc) => loc.id === order.physicalLocation?.id,
    );
    if (!match) return null;
    return {
      locationId: match.id,
      locationName: match.name,
      source,
    };
  }

  // IGLU POS — match by tag
  const tags = (order.tags ?? []).map((t) => t.toLowerCase());
  const match = retailLocations.find((loc) =>
    tags.includes(loc.name.toLowerCase()),
  );
  if (!match) return null;
  return {
    locationId: match.id,
    locationName: match.name,
    source,
  };
};

/** "YYYY-MM" key for a Date (local time). */
export const monthKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
