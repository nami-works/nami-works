import type { AdminApiClient } from "@shopify/admin-api-client";
import { listLocationConfigs, type LocationConfigEntry } from "../config.js";
import {
  formatAddressForGeocode,
  geocodeAddress,
} from "../vendored/geocode.js";

/**
 * Historical-batch enumeration for the simulator.
 *
 * Strategy (2026-05-01: redesigned after Phase B smoke):
 *  1. For each (date, route_number) combo in the window, query
 *     `tag:ld_rota-NN_YY.MM.DD` exactly. Shopify's `tag:` filter only does
 *     exact match, and the `location_id:` filter is unreliable for fulfillment
 *     location (matches POS location instead). Per-tag queries are precise
 *     and fast — 7 days × 15 route slots ≈ 105 queries, most return empty.
 *  2. Disambiguate location by `shippingAddress.province` because GE Beauty's
 *     three LD locations serve disjoint Brazilian states:
 *       - Shops Jardins → SP
 *       - Shopping Recife → PE
 *       - RioSul → RJ
 *     If a tenant ever runs LD in the same state from two stores, this needs
 *     to switch to fulfillment-order based location resolution.
 *  3. Resolve per-order coordinates: Shopify's `shippingAddress.latitude/
 *     longitude` first; fall back to Google Geocoding when absent.
 *  4. Emit one `Batch` per (locationId, date) pair.
 */

const ARCHIVED_ROUTE_TAG = /^ld_rota-(\d+)_(\d{2})\.(\d{2})\.(\d{2})$/;

type ShippingAddress = {
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  zip: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
};

// Post-filter shape: orders without shippingAddress are dropped at the
// pagination boundary, so downstream code can rely on it being non-null.
export type FetchOrder = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  shippingAddress: ShippingAddress;
  tags: string[];
};

// Raw Shopify shape — shippingAddress can be null for digital / pickup orders.
type RawOrder = Omit<FetchOrder, "shippingAddress"> & {
  shippingAddress: ShippingAddress | null;
};

export type FetchRoute = {
  routeNumber: number;
  routeTag: string; // e.g. "ld_rota-01_26.04.30"
  orderIds: string[]; // FetchOrder.id[]
};

export type FetchBatch = {
  date: string; // YYYY-MM-DD
  locationId: string;
  locationName: string;
  pickupLat: number | null;
  pickupLng: number | null;
  orders: FetchOrder[];
  routes: FetchRoute[];
};

export type FetchBatchesArgs = {
  client: AdminApiClient;
  days: number;
  /** Optional: restrict to one Shopify location GID. */
  locationId?: string;
  /** Google Maps Geocoding API key. If absent, orders without Shopify-side
   *  lat/lng will keep null coords (UI can show a warning). */
  googleMapsApiKey?: string | undefined;
  /** For tests / overrides. */
  now?: () => Date;
  /** For tests / overrides. */
  pageSize?: number;
};

const ORDERS_QUERY = /* GraphQL */ `
  query LdSimOrders($search: String!, $cursor: String, $first: Int!) {
    orders(first: $first, query: $search, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          id
          name
          email
          phone
          tags
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            country
            zip
            phone
            latitude
            longitude
          }
        }
      }
    }
  }
`;

type OrdersResp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ cursor: string; node: RawOrder }>;
  };
};

function isoDateNDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** "26.04.30" → "2026-04-30". Year is 20YY (covers 2000-2099 — fine for now). */
function archiveTagDateToIso(yy: string, mm: string, dd: string): string {
  return `20${yy}-${mm}-${dd}`;
}

/**
 * Yield archived `ld_rota-NN_YY.MM.DD` tags from an order, paired with the
 * route number and ISO date. Orders can carry tags from multiple routes
 * (rare — re-clustered) so we return all matches.
 */
function extractArchivedRouteTags(
  tags: string[],
): Array<{ routeNumber: number; routeTag: string; date: string }> {
  const out: Array<{ routeNumber: number; routeTag: string; date: string }> = [];
  for (const tag of tags) {
    const m = tag.match(ARCHIVED_ROUTE_TAG);
    if (!m) continue;
    const [, num, yy, mm, dd] = m;
    out.push({
      routeNumber: parseInt(num!, 10),
      routeTag: tag,
      date: archiveTagDateToIso(yy!, mm!, dd!),
    });
  }
  return out;
}

async function paginateOrders(
  client: AdminApiClient,
  search: string,
  pageSize: number,
): Promise<FetchOrder[]> {
  // Cap is intentionally generous: a 30-day window at a flagship location can
  // have several thousand non-LD orders mixed in with the LD ones. Shopify's
  // tag search doesn't support prefix matching so we can't pre-filter to LD
  // orders server-side — we have to fetch and regex-filter client-side.
  const MAX_PAGES = 200;
  const all: FetchOrder[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res: { data?: OrdersResp; errors?: { message?: string } } =
      await client.request<OrdersResp>(ORDERS_QUERY, {
        variables: { search, cursor, first: pageSize },
      });
    if (res.errors) {
      throw new Error(`Shopify GraphQL: ${res.errors.message ?? "error"}`);
    }
    const edges = res.data?.orders.edges ?? [];
    for (const e of edges) {
      // Drop orders with no shipping address — digital-only or in-store
      // pickup. They can't be LD candidates by definition.
      const node = e.node;
      if (node.shippingAddress) {
        all.push({ ...node, shippingAddress: node.shippingAddress });
      }
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }
  return all;
}

/**
 * Best-effort: top up missing per-order coords via Google Geocoding.
 * Mutates the order's shippingAddress in place.
 */
async function fillMissingCoords(
  orders: FetchOrder[],
  apiKey: string | undefined,
): Promise<void> {
  if (!apiKey) return;
  for (const o of orders) {
    const addr = o.shippingAddress;
    if (addr.latitude != null && addr.longitude != null) continue;
    const query = formatAddressForGeocode({
      address1: addr.address1,
      address2: addr.address2,
      city: addr.city,
      province: addr.province,
      country: addr.country,
      postalCode: addr.zip,
    });
    if (!query.trim()) continue;
    const r = await geocodeAddress(query, apiKey);
    if (r) {
      addr.latitude = r.lat;
      addr.longitude = r.lng;
    }
  }
}

/** Maximum route slot number to enumerate per day. cpg-labs uses 15 max
 *  slots; GE Beauty has never run more than ~10 routes from a single location
 *  on a single day. */
const MAX_ROUTE_SLOT = 15;

/** Province → location map for GE Beauty. Each LD location serves a disjoint
 *  Brazilian state, so this is reliable for v1. If a tenant ever runs LD in
 *  the same state from multiple stores, swap this for fulfillment-order based
 *  resolution. Province name is matched case-insensitively, accent-stripped. */
const PROVINCE_TO_LOCATION_ID: Record<string, string> = {
  "sao paulo": "gid://shopify/Location/97784398144",
  pernambuco: "gid://shopify/Location/97397014848",
  "rio de janeiro": "gid://shopify/Location/101298569536",
};

function normalizeProvince(s: string | null): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function inferLocationId(order: FetchOrder): string | null {
  const prov = normalizeProvince(order.shippingAddress.province);
  return PROVINCE_TO_LOCATION_ID[prov] ?? null;
}

/** "2026-04-30" → "26.04.30" (Shopify archived-tag suffix format). */
function isoDateToTagSuffix(iso: string): string {
  // iso is YYYY-MM-DD
  const [y, m, d] = iso.split("-");
  return `${y!.slice(2)}.${m}.${d}`;
}

function* eachDateInWindow(now: Date, days: number): Generator<string> {
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    yield d.toISOString().slice(0, 10);
  }
}

/**
 * Fetch historical batches for the last `days` days across all configured
 * locations (or just `args.locationId` if set).
 */
export async function fetchHistoricalBatches(
  args: FetchBatchesArgs,
): Promise<FetchBatch[]> {
  const now = args.now ? args.now() : new Date();
  // sinceIso retained for backwards-compat; current strategy enumerates dates.
  void isoDateNDaysAgo(now, args.days);
  const pageSize = args.pageSize ?? 50;

  const configs: LocationConfigEntry[] = listLocationConfigs().filter(
    (c) => !args.locationId || c.locationId === args.locationId,
  );
  const allowedLocationIds = new Set(configs.map((c) => c.locationId));

  // Map to accumulate per-(locationId, date) batches.
  type AggKey = string; // `${locationId}|${date}`
  type Agg = {
    locationId: string;
    date: string;
    orders: Map<string, FetchOrder>; // orderId → order
    routes: Map<number, { routeTag: string; orderIds: string[] }>;
  };
  const agg = new Map<AggKey, Agg>();

  // Enumerate (date, routeNum) pairs. Most queries return zero rows quickly.
  for (const dateIso of eachDateInWindow(now, args.days)) {
    const tagSuffix = isoDateToTagSuffix(dateIso);
    for (let slot = 1; slot <= MAX_ROUTE_SLOT; slot += 1) {
      const slotPad = String(slot).padStart(2, "0");
      const tag = `ld_rota-${slotPad}_${tagSuffix}`;
      const search = `tag:${tag}`;
      const orders = await paginateOrders(args.client, search, pageSize);
      if (orders.length === 0) continue;

      for (const order of orders) {
        const locId = inferLocationId(order);
        if (!locId || !allowedLocationIds.has(locId)) continue;
        const key: AggKey = `${locId}|${dateIso}`;
        let a = agg.get(key);
        if (!a) {
          a = {
            locationId: locId,
            date: dateIso,
            orders: new Map(),
            routes: new Map(),
          };
          agg.set(key, a);
        }
        a.orders.set(order.id, order);
        let r = a.routes.get(slot);
        if (!r) {
          r = { routeTag: tag, orderIds: [] };
          a.routes.set(slot, r);
        }
        if (!r.orderIds.includes(order.id)) r.orderIds.push(order.id);
      }
    }
  }

  // Geocoding fill — done once per batch to amortize cost.
  for (const a of agg.values()) {
    await fillMissingCoords(Array.from(a.orders.values()), args.googleMapsApiKey);
  }

  // Build batches.
  const batches: FetchBatch[] = [];
  for (const a of agg.values()) {
    const config = configs.find((c) => c.locationId === a.locationId);
    if (!config) continue;
    const routes: FetchRoute[] = Array.from(a.routes.entries())
      .sort(([na], [nb]) => na - nb)
      .map(([routeNumber, { routeTag, orderIds }]) => ({
        routeNumber,
        routeTag,
        orderIds,
      }));
    batches.push({
      date: a.date,
      locationId: config.locationId,
      locationName: config.locationName,
      pickupLat: config.data.pickupLat ?? null,
      pickupLng: config.data.pickupLng ?? null,
      orders: Array.from(a.orders.values()),
      routes,
    });
  }

  return batches;
}

// Exported for unit tests.
export const __testing = {
  ARCHIVED_ROUTE_TAG,
  extractArchivedRouteTags,
  archiveTagDateToIso,
  isoDateNDaysAgo,
};
