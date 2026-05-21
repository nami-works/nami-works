/**
 * Flip CD Extrema FulfillmentOrders to the matching local store.
 *
 * For each unfulfilled-at-CD-Extrema order whose state has a local Lalamove
 * store AND whose haversine distance to that store is ≤100 km (or matches
 * an override city), move its OPEN FulfillmentOrders away from CD Extrema
 * to the target store location.
 *
 * Mapping:
 *   SP → Shops Jardins      (gid://shopify/Location/97784398144)
 *   RJ → RioSul             (gid://shopify/Location/101298569536)
 *   PE → Shopping Recife    (gid://shopify/Location/97397014848)
 *
 * Dry-run by default. Pass --execute to actually move. The Shopify mutation
 * `fulfillmentOrderMove` is technically reversible (re-move back) but moving
 * 46 orders in error is a real cleanup pain — always dry-run first.
 *
 * After flip, the orders' Shopify `deliveryMethod` stays non-LOCAL (SHIPPING).
 * They surface in the destination store's Local Delivery UI via the new
 * warehouse-method-override toggle (deploy `f9568c2`, 2026-05-14).
 */

import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const MAX_RADIUS_KM = 100;

const EXTREMA_GID = "gid://shopify/Location/105538257216";

const STATE_TO_STORE: Record<string, { gid: string; name: string }> = {
  SP: { gid: "gid://shopify/Location/97784398144",  name: "Shops Jardins" },
  RJ: { gid: "gid://shopify/Location/101298569536", name: "RioSul" },
  PE: { gid: "gid://shopify/Location/97397014848",  name: "Shopping Recife" },
};

const CITY_OVERRIDES: Record<string, string> = {
  niteroi: "RJ",
  campinas: "SP",
};

const normalize = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const STATE_FULL_NAMES: Record<string, string> = {
  SP: "São Paulo", RJ: "Rio de Janeiro", PE: "Pernambuco",
};

function normalizeStateCode(province: string | null | undefined): string {
  if (!province) return "??";
  const trimmed = province.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const normalized = normalize(trimmed);
  for (const [code, name] of Object.entries(STATE_FULL_NAMES)) {
    if (normalize(name) === normalized) return code;
  }
  return trimmed;
}

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Args = { execute: boolean };
function parseArgs(): Args {
  const args: Args = { execute: false };
  for (const raw of process.argv.slice(2)) {
    if (raw === "--execute") args.execute = true;
    else if (raw === "--dry-run") args.execute = false;
    else throw new Error(`Unknown argument: ${raw}`);
  }
  return args;
}

(async () => {
  const args = parseArgs();
  const mode = args.execute ? "EXECUTE" : "DRY-RUN";
  console.log(`mode=${mode}`);

  const client = await unauthenticated.admin(SHOP);

  // 1. Pull store pickup coords (for radius gate).
  const locRows = await prisma.lalamoveLocationConfig.findMany({ where: { shop: SHOP } });
  const storeCoords = new Map<string, { lat: number; lng: number }>();
  for (const row of locRows) {
    const d = row.data as { locationName?: string; pickupLat?: number; pickupLng?: number };
    if (d?.pickupLat == null || d?.pickupLng == null) continue;
    if ((d.locationName ?? "").includes("RioSul")) storeCoords.set("RJ", { lat: d.pickupLat, lng: d.pickupLng });
    else if ((d.locationName ?? "").includes("Shops Jardins")) storeCoords.set("SP", { lat: d.pickupLat, lng: d.pickupLng });
    else if ((d.locationName ?? "").includes("Shopping Recife")) storeCoords.set("PE", { lat: d.pickupLat, lng: d.pickupLng });
  }

  // 2. Fetch all unfulfilled CD Extrema orders with their FulfillmentOrders.
  const query = `fulfillment_location_id:105538257216 fulfillment_status:unshipped status:open`;
  type Row = {
    id: string;
    name: string;
    state: string;
    city: string;
    lat: number | null;
    lng: number | null;
    foAtExtrema: Array<{ id: string; status: string }>;
  };
  const orders: Row[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page += 1) {
    const res = await client.admin.graphql(
      `#graphql
        query O($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT) {
            edges { cursor node {
              id name displayFulfillmentStatus
              shippingAddress { city province latitude longitude }
              fulfillmentOrders(first: 20) {
                nodes {
                  id status
                  assignedLocation { location { id } }
                }
              }
            } }
            pageInfo { hasNextPage }
          }
        }`,
      { variables: { query, first: 100, after: cursor } },
    );
    const json = (await res.json()) as {
      data?: { orders?: { edges?: Array<{ cursor: string; node: {
        id: string; name: string; displayFulfillmentStatus: string;
        shippingAddress?: { city?: string | null; province?: string | null; latitude?: number | null; longitude?: number | null } | null;
        fulfillmentOrders?: { nodes?: Array<{ id?: string; status?: string | null; assignedLocation?: { location?: { id?: string | null } | null } | null }> };
      } }>; pageInfo?: { hasNextPage?: boolean } } };
    };
    const edges = json?.data?.orders?.edges ?? [];
    for (const e of edges) {
      if (e.node.displayFulfillmentStatus !== "UNFULFILLED") continue;
      const addr = e.node.shippingAddress;
      const state = normalizeStateCode(addr?.province);
      const cityKey = normalize(addr?.city);
      // override city → coerce state for routing
      const overrideState = CITY_OVERRIDES[cityKey];
      const effectiveState = overrideState ?? state;
      const foNodes = e.node.fulfillmentOrders?.nodes ?? [];
      const foAtExtrema = foNodes
        .filter((n) => n?.assignedLocation?.location?.id === EXTREMA_GID && n?.status === "OPEN")
        .map((n) => ({ id: n.id ?? "", status: n.status ?? "" }))
        .filter((n) => n.id);
      orders.push({
        id: e.node.id,
        name: e.node.name,
        state: effectiveState,
        city: addr?.city ?? "",
        lat: addr?.latitude ? Number(addr.latitude) : null,
        lng: addr?.longitude ? Number(addr.longitude) : null,
        foAtExtrema,
      });
    }
    if (!json?.data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }
  console.log(`unfulfilled at CD Extrema: ${orders.length}`);

  // 3. Filter to local-deliverable.
  type Target = Row & { target: { gid: string; name: string }; km: number };
  const targets: Target[] = [];
  const skipped: Array<{ row: Row; reason: string }> = [];
  for (const o of orders) {
    const cityKey = normalize(o.city);
    const overrideState = CITY_OVERRIDES[cityKey];
    const effectiveState = overrideState ?? o.state;
    const target = STATE_TO_STORE[effectiveState];
    if (!target) {
      continue; // not a local-store state
    }
    if (o.foAtExtrema.length === 0) {
      skipped.push({ row: o, reason: "no OPEN FulfillmentOrder at CD Extrema" });
      continue;
    }
    const coords = storeCoords.get(effectiveState);
    const overrideHit = !!overrideState;
    if (overrideHit) {
      targets.push({ ...o, target, km: coords && o.lat != null && o.lng != null ? haversineKm(o.lat, o.lng, coords.lat, coords.lng) : -1 });
      continue;
    }
    if (!coords || o.lat == null || o.lng == null) {
      continue;
    }
    const km = haversineKm(o.lat, o.lng, coords.lat, coords.lng);
    if (km <= MAX_RADIUS_KM) {
      targets.push({ ...o, target, km });
    }
  }
  console.log(`local-deliverable: ${targets.length}`);
  if (skipped.length > 0) {
    console.log(`skipped (no OPEN FO at Extrema): ${skipped.length}`);
    for (const s of skipped.slice(0, 5)) console.log(`  ${s.row.name} state=${s.row.state} reason=${s.reason}`);
  }

  // 4. Group by target store for display.
  const byStore = new Map<string, Target[]>();
  for (const t of targets) {
    const arr = byStore.get(t.target.name) ?? [];
    arr.push(t);
    byStore.set(t.target.name, arr);
  }
  for (const [storeName, list] of byStore.entries()) {
    console.log();
    console.log(`→ ${storeName} (${list.length})`);
    for (const t of list) {
      const fos = t.foAtExtrema.map((f) => f.id.replace(/^.+\//, "")).join(",");
      console.log(`  ${t.name.padEnd(7)} ${t.state}  ${t.city.padEnd(28)}  km=${t.km.toFixed(1).padStart(6)}  FO=${fos}`);
    }
  }
  console.log();

  if (!args.execute) {
    console.log("DRY-RUN — no mutations fired. Re-run with --execute to flip.");
    await prisma.$disconnect();
    return;
  }

  // 5. Execute fulfillmentOrderMove per FulfillmentOrder.
  console.log("EXECUTING fulfillmentOrderMove...");
  const results: Array<{ order: string; target: string; ok: boolean; reason?: string }> = [];
  let i = 0;
  for (const t of targets) {
    i += 1;
    for (const fo of t.foAtExtrema) {
      try {
        const res = await client.admin.graphql(
          `#graphql
            mutation Mv($id: ID!, $loc: ID!) {
              fulfillmentOrderMove(id: $id, newLocationId: $loc) {
                movedFulfillmentOrder { id assignedLocation { location { id } } }
                userErrors { field message }
              }
            }`,
          { variables: { id: fo.id, loc: t.target.gid } },
        );
        const json = (await res.json()) as {
          data?: { fulfillmentOrderMove?: {
            movedFulfillmentOrder?: { id?: string; assignedLocation?: { location?: { id?: string | null } | null } | null } | null;
            userErrors?: Array<{ field?: unknown; message?: string }>;
          } };
        };
        const errs = json?.data?.fulfillmentOrderMove?.userErrors ?? [];
        const moved = json?.data?.fulfillmentOrderMove?.movedFulfillmentOrder;
        const movedLocId = moved?.assignedLocation?.location?.id ?? null;
        if (errs.length > 0) {
          const msg = errs.map((e) => e.message ?? "unknown").join("; ");
          console.log(`  ✗ ${t.name} fo=${fo.id.slice(-12)} → ${t.target.name}  err=${msg.slice(0, 100)}`);
          results.push({ order: t.name, target: t.target.name, ok: false, reason: msg });
        } else if (movedLocId === t.target.gid) {
          console.log(`  ✓ ${t.name} fo=${fo.id.slice(-12)} → ${t.target.name}`);
          results.push({ order: t.name, target: t.target.name, ok: true });
        } else {
          const msg = `unexpected location after move: ${movedLocId ?? "null"}`;
          console.log(`  ⚠ ${t.name} fo=${fo.id.slice(-12)} → ${t.target.name}  ${msg}`);
          results.push({ order: t.name, target: t.target.name, ok: false, reason: msg });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ ${t.name} fo=${fo.id.slice(-12)} EXCEPTION  ${msg.slice(0, 100)}`);
        results.push({ order: t.name, target: t.target.name, ok: false, reason: msg });
      }
      await sleep(120); // gentle pacing
    }
    if (i % 10 === 0) console.log(`  ...${i}/${targets.length} done`);
  }

  console.log();
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`Summary: ${ok} moved OK · ${fail} failed`);
  if (fail > 0) {
    console.log("Failures:");
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  ${r.order} → ${r.target}  ${r.reason ?? ""}`);
    }
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
