import "dotenv/config";
import { parseArgs } from "node:util";
import { getShopifyClient } from "../../clients/shopify.js";
import { prisma } from "../../db/prisma.js";
import { listLocationConfigs } from "../config.js";

/**
 * Seed today's *unfulfilled* orders into LdSimBatch as the input pool for
 * route optimization.
 *
 * Query and filter logic mirrors cpg-labs's `fetchUnassignedOrdersForLocation`
 * verbatim (cpg-labs/app/routes/api.control.$intent.tsx:789), so this picks
 * up the same set of orders the cpg-labs optimizer would.
 *
 *   server: `fulfillment_location_id:${legacyId} fulfillment_status:unshipped status:open`
 *   client filters (skip if ANY of):
 *     - has active `ld_rota-NN` tag (already routed)
 *     - has `ld_address_review` tag (queued for address repair)
 *     - no fulfillmentOrder with deliveryMethod.methodType === "LOCAL" at this location
 *     - no shippingAddress.latitude/longitude
 *
 * Output payload shape:
 *   { orders: [...], routes: [...reconstructed-from-ld_rota-NN], unassigned: [...rest] }
 *
 * Usage:
 *   npx tsx src/local-delivery/scripts/seed-live-batch.ts --tenant gebeauty
 *   npx tsx src/local-delivery/scripts/seed-live-batch.ts --tenant gebeauty --location gid://shopify/Location/97784398144
 */

function die(msg: string): never {
  console.error(`[seed-live-batch] ${msg}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    location: { type: "string" },
  },
  strict: true,
});

const slug = values.tenant;
if (!slug) die("--tenant required");

const tenant = await prisma.integrationTenant.findUnique({
  where: { slug: slug! },
});
if (!tenant?.shopifyShop) die(`tenant "${slug}" not found or missing shopifyShop`);

const client = await getShopifyClient({
  ssmPrefix: tenant!.ssmPrefix,
  shopifyShop: tenant!.shopifyShop!,
});

const todayIso = new Date().toISOString().slice(0, 10);

const targetLocations = values.location
  ? listLocationConfigs().filter((c) => c.locationId === values.location)
  : listLocationConfigs();

if (targetLocations.length === 0) die("no matching configured location");

type Order = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  shippingAddress: {
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
  } | null;
  fulfillmentOrders: {
    nodes: Array<{
      deliveryMethod: { methodType: string | null } | null;
      assignedLocation: { location: { id: string } | null } | null;
    }>;
  };
};

const ORDERS_QUERY = /* GraphQL */ `
  query SeedLive($q: String!, $first: Int!, $cursor: String) {
    orders(first: $first, query: $q, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          id name email phone tags
          shippingAddress {
            firstName lastName address1 address2
            city province country zip phone
            latitude longitude
          }
          fulfillmentOrders(first: 10) {
            nodes {
              deliveryMethod { methodType }
              assignedLocation { location { id } }
            }
          }
        }
      }
    }
  }
`;

const ACTIVE_ROUTE = /^ld_rota-(\d+)$/;

console.log(
  `[seed-live-batch] tenant=${slug} date=${todayIso} locations=${targetLocations.map((l) => l.locationName).join(", ")}`,
);

let persisted = 0;
const summary: Array<{
  loc: string;
  total: number;
  unassigned: number;
  routes: number;
  flagged: number;
}> = [];

for (const config of targetLocations) {
  const legacyId = config.locationId.replace("gid://shopify/Location/", "");
  const query = `fulfillment_location_id:${legacyId} fulfillment_status:unshipped status:open`;

  type Resp = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ cursor: string; node: Order }>;
    };
  };
  const all: Order[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(ORDERS_QUERY, {
        variables: { q: query, first: 50, cursor },
      });
    if (res.errors) die(`Shopify GraphQL: ${res.errors.message ?? "error"}`);
    for (const e of res.data?.orders.edges ?? []) all.push(e.node);
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }

  // Track orders flagged for address review separately so we can report them.
  const flagged: Order[] = [];
  // Eligible = passes cpg-labs's optimize-side filters.
  const eligible: Order[] = [];
  for (const o of all) {
    if (o.tags.includes("ld_address_review")) {
      flagged.push(o);
      continue;
    }
    const fo = o.fulfillmentOrders?.nodes ?? [];
    const isLocal = fo.some(
      (f) =>
        f?.deliveryMethod?.methodType === "LOCAL" &&
        f?.assignedLocation?.location?.id === config.locationId,
    );
    if (!isLocal) continue;
    if (!o.shippingAddress?.latitude || !o.shippingAddress.longitude) continue;
    eligible.push(o);
  }

  // Reconstruct any existing ld_rota-NN clustering (in case Lucas already
  // ran optimize since the last seed). Stragglers go into `unassigned`.
  const routesBySlot = new Map<number, string[]>();
  const unassigned: string[] = [];
  for (const o of eligible) {
    const m = o.tags
      .map((t) => t.match(ACTIVE_ROUTE))
      .find((mm): mm is RegExpMatchArray => mm !== null);
    if (m) {
      const slot = parseInt(m[1]!, 10);
      let arr = routesBySlot.get(slot);
      if (!arr) {
        arr = [];
        routesBySlot.set(slot, arr);
      }
      arr.push(o.id);
    } else {
      unassigned.push(o.id);
    }
  }

  const routes = Array.from(routesBySlot.entries())
    .sort(([a], [bb]) => a - bb)
    .map(([slot, orderIds]) => ({
      routeNumber: slot,
      routeTag: `ld_rota-${String(slot).padStart(2, "0")}`,
      orderIds,
    }));

  const ordersOut = eligible.map((o) => ({
    id: o.id,
    name: o.name,
    email: o.email,
    phone: o.phone,
    tags: o.tags,
    shippingAddress: o.shippingAddress!,
  }));

  if (eligible.length === 0 && flagged.length === 0) {
    console.log(`  ${config.locationName}: 0 eligible orders — skipped`);
    summary.push({ loc: config.locationName, total: 0, unassigned: 0, routes: 0, flagged: 0 });
    continue;
  }

  const payload = { orders: ordersOut, routes, unassigned };

  const existing = await prisma.ldSimBatch.findUnique({
    where: {
      tenantId_date_locationId: {
        tenantId: tenant!.id,
        date: todayIso,
        locationId: config.locationId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.ldSimBatch.update({
      where: { id: existing.id },
      data: {
        locationName: config.locationName,
        pickupLat: config.data.pickupLat ?? null,
        pickupLng: config.data.pickupLng ?? null,
        payload: payload as unknown as import("@prisma/client-connector").Prisma.InputJsonValue,
      },
    });
    console.log(
      `  ${config.locationName}: updated batch id=${existing.id} (orders=${eligible.length}, routes=${routes.length}, unassigned=${unassigned.length}, flagged=${flagged.length})`,
    );
  } else {
    const row = await prisma.ldSimBatch.create({
      data: {
        tenantId: tenant!.id,
        date: todayIso,
        locationId: config.locationId,
        locationName: config.locationName,
        pickupLat: config.data.pickupLat ?? null,
        pickupLng: config.data.pickupLng ?? null,
        payload: payload as unknown as import("@prisma/client-connector").Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    console.log(
      `  ${config.locationName}: created batch id=${row.id} (orders=${eligible.length}, routes=${routes.length}, unassigned=${unassigned.length}, flagged=${flagged.length})`,
    );
  }
  persisted += 1;
  summary.push({
    loc: config.locationName,
    total: eligible.length,
    unassigned: unassigned.length,
    routes: routes.length,
    flagged: flagged.length,
  });
}

console.log(`[seed-live-batch] done — ${persisted} batches persisted for ${todayIso}`);
if (summary.some((s) => s.flagged > 0)) {
  console.log(
    `[seed-live-batch] note: ${summary.reduce((a, s) => a + s.flagged, 0)} orders are tagged ld_address_review and were excluded — run propose-address-repairs to surface fixes`,
  );
}

await prisma.$disconnect();
