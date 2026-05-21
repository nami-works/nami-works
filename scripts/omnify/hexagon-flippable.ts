/**
 * Find hexagon-tagged unfulfilled orders at warehouses (CD Cajamar / CD Extrema)
 * and check Lalamove-deliverability from the 3 local stores.
 */

import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const MAX_RADIUS_KM = 100;

const WAREHOUSE_GIDS = new Set([
  "gid://shopify/Location/100984553792", // CD Cajamar
  "gid://shopify/Location/105538257216", // CD Extrema
]);
const WAREHOUSE_NAME: Record<string, string> = {
  "gid://shopify/Location/100984553792": "CD Cajamar",
  "gid://shopify/Location/105538257216": "CD Extrema",
};

const STATE_TO_STORE: Record<string, string> = { SP: "Shops Jardins", RJ: "RioSul", PE: "Shopping Recife" };
const CITY_OVERRIDES: Record<string, string> = { niteroi: "RJ", campinas: "SP" };

const normalize = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const STATE_NAMES: Record<string, string> = { SP: "São Paulo", RJ: "Rio de Janeiro", PE: "Pernambuco" };
function stateCode(p: string | null | undefined): string {
  if (!p) return "??";
  const t = p.trim();
  if (t.length === 2) return t.toUpperCase();
  const n = normalize(t);
  for (const [c, name] of Object.entries(STATE_NAMES)) if (normalize(name) === n) return c;
  return t;
}

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

(async () => {
  const client = await unauthenticated.admin(SHOP);

  // Store coords
  const locRows = await prisma.lalamoveLocationConfig.findMany({ where: { shop: SHOP } });
  const storeCoords = new Map<string, { lat: number; lng: number }>();
  for (const row of locRows) {
    const d = row.data as { locationName?: string; pickupLat?: number; pickupLng?: number };
    if (d?.pickupLat == null || d?.pickupLng == null) continue;
    if ((d.locationName ?? "").includes("RioSul")) storeCoords.set("RJ", { lat: d.pickupLat, lng: d.pickupLng });
    else if ((d.locationName ?? "").includes("Shops Jardins")) storeCoords.set("SP", { lat: d.pickupLat, lng: d.pickupLng });
    else if ((d.locationName ?? "").includes("Shopping Recife")) storeCoords.set("PE", { lat: d.pickupLat, lng: d.pickupLng });
  }

  // Page through hexagon-tagged unfulfilled orders.
  const query = `tag:hexagon-whatsapp OR tag:hexagon-store-credit OR tag:hexagon-test fulfillment_status:unshipped status:open`;
  type Row = {
    id: string; name: string; state: string; city: string;
    lat: number | null; lng: number | null;
    locId: string | null; locName: string | null;
    foAtWarehouse: Array<{ id: string; locGid: string }>;
    tags: string[];
  };
  const orders: Row[] = [];
  let cursor: string | null = null;
  for (let p = 0; p < 40; p++) {
    const r = await client.admin.graphql(
      `#graphql
        query Q($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT) {
            edges { cursor node {
              id name displayFulfillmentStatus tags
              shippingAddress { city province latitude longitude }
              fulfillmentOrders(first: 10) {
                nodes { id status assignedLocation { location { id name } } }
              }
            } }
            pageInfo { hasNextPage }
          }
        }`,
      { variables: { query, first: 100, after: cursor } },
    );
    const j = (await r.json()) as {
      data?: { orders?: { edges?: Array<{ cursor: string; node: {
        id: string; name: string; displayFulfillmentStatus: string; tags?: string[];
        shippingAddress?: { city?: string | null; province?: string | null; latitude?: number | null; longitude?: number | null } | null;
        fulfillmentOrders?: { nodes?: Array<{ id?: string; status?: string | null; assignedLocation?: { location?: { id?: string | null; name?: string | null } | null } | null }> };
      } }>; pageInfo?: { hasNextPage?: boolean } } };
    };
    const edges = j?.data?.orders?.edges ?? [];
    for (const e of edges) {
      if (e.node.displayFulfillmentStatus !== "UNFULFILLED") continue;
      const addr = e.node.shippingAddress;
      const foNodes = e.node.fulfillmentOrders?.nodes ?? [];
      const firstLoc = foNodes[0]?.assignedLocation?.location;
      const foAtWarehouse = foNodes
        .filter((n) => n?.assignedLocation?.location?.id && WAREHOUSE_GIDS.has(n.assignedLocation.location.id) && n?.status === "OPEN")
        .map((n) => ({ id: n.id ?? "", locGid: n.assignedLocation!.location!.id! }))
        .filter((n) => n.id);
      orders.push({
        id: e.node.id,
        name: e.node.name,
        state: stateCode(addr?.province),
        city: addr?.city ?? "",
        lat: addr?.latitude ? Number(addr.latitude) : null,
        lng: addr?.longitude ? Number(addr.longitude) : null,
        locId: firstLoc?.id ?? null,
        locName: firstLoc?.name ?? null,
        foAtWarehouse,
        tags: e.node.tags ?? [],
      });
    }
    if (!j?.data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  console.log(`Total hexagon-tagged UNFULFILLED orders: ${orders.length}`);
  console.log();

  // Bucket by current location.
  const byLoc = new Map<string, Row[]>();
  for (const o of orders) {
    const key = o.locName ?? "<no FO>";
    const arr = byLoc.get(key) ?? [];
    arr.push(o);
    byLoc.set(key, arr);
  }
  console.log("By current location:");
  for (const [name, list] of [...byLoc.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(3)}  ${name}`);
  }
  console.log();

  // Filter to those AT a warehouse.
  const atWarehouse = orders.filter((o) => o.foAtWarehouse.length > 0);
  console.log(`At a warehouse (CD Cajamar or CD Extrema): ${atWarehouse.length}`);

  // Of those, check flippability.
  let flippable = 0;
  const flippableRows: Array<{ row: Row; target: string; km: number }> = [];
  const notFlippable: Row[] = [];
  for (const o of atWarehouse) {
    const cityKey = normalize(o.city);
    const overrideState = CITY_OVERRIDES[cityKey];
    const effectiveState = overrideState ?? o.state;
    const targetStore = STATE_TO_STORE[effectiveState];
    if (!targetStore) {
      notFlippable.push(o);
      continue;
    }
    const coords = storeCoords.get(effectiveState);
    if (overrideState) {
      flippableRows.push({ row: o, target: targetStore, km: coords && o.lat != null && o.lng != null ? haversineKm(o.lat, o.lng, coords.lat, coords.lng) : -1 });
      flippable += 1;
      continue;
    }
    if (!coords || o.lat == null || o.lng == null) {
      notFlippable.push(o);
      continue;
    }
    const km = haversineKm(o.lat, o.lng, coords.lat, coords.lng);
    if (km <= MAX_RADIUS_KM) {
      flippableRows.push({ row: o, target: targetStore, km });
      flippable += 1;
    } else {
      notFlippable.push(o);
    }
  }

  console.log(`  flippable to a local store (within 100 km): ${flippable}`);
  console.log(`  not flippable (out of range or no local store in state): ${notFlippable.length}`);
  console.log();

  if (flippableRows.length > 0) {
    console.log("Flippable orders:");
    console.log(`  ${"Order".padEnd(7)} ${"State".padEnd(5)} ${"City".padEnd(20)} ${"From".padEnd(12)} → ${"To".padEnd(15)} ${"km".padStart(6)}`);
    for (const f of flippableRows) {
      const fromName = WAREHOUSE_NAME[f.row.foAtWarehouse[0]!.locGid] ?? f.row.locName ?? "?";
      console.log(`  ${f.row.name.padEnd(7)} ${f.row.state.padEnd(5)} ${f.row.city.padEnd(20)} ${fromName.padEnd(12)} → ${f.target.padEnd(15)} ${f.km.toFixed(1).padStart(6)}`);
    }
  }

  if (notFlippable.length > 0) {
    console.log();
    console.log(`Not flippable (top by state):`);
    const byState = new Map<string, number>();
    for (const o of notFlippable) byState.set(o.state, (byState.get(o.state) ?? 0) + 1);
    for (const [s, n] of [...byState.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${s}`);
    }
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
