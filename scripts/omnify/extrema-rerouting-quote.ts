import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import { createLalamoveQuotation } from "../app/services/lalamove.server";
import { getRuntimeCredentialsForShop } from "../app/services/lalamove-credentials.server";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const MAX_RADIUS_KM = 100;
const QUOTE_DELAY_MS = 250;

// Explicit city → store overrides. These force an assignment regardless of the
// 100 km gate so they survive geographic-edge cases (e.g. far Niterói at ~12
// km or far Campinas at ~95 km from origin).
const CITY_OVERRIDES: Array<{ cityNormalized: string; storeName: string }> = [
  { cityNormalized: "niteroi", storeName: "RioSul" },
  { cityNormalized: "campinas", storeName: "Shops Jardins" },
];

type LocationCandidate = {
  locationId: string;
  name: string;
  pickupLat: number;
  pickupLng: number;
  market: string;
  language: string;
  serviceType: string;
  pickupAddress: string;
};

type OrderRow = {
  id: string;
  name: string;
  customerName: string;
  city: string | null;
  lat: number;
  lng: number;
  address1: string;
  address2: string;
  province: string | null;
  country: string | null;
  phone: string;
};

const normalize = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

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

(async () => {
  const client = await unauthenticated.admin(SHOP);
  const credentials = await getRuntimeCredentialsForShop(SHOP);
  if (!credentials) {
    console.error("No Lalamove credentials");
    await prisma.$disconnect();
    process.exit(1);
  }

  const targetNames = ["RioSul", "Shopping Recife", "Shops Jardins"];
  const locRows = await prisma.lalamoveLocationConfig.findMany({ where: { shop: SHOP } });
  const candidates: LocationCandidate[] = [];
  for (const row of locRows) {
    const d = row.data as {
      locationName?: string;
      pickupLat?: number;
      pickupLng?: number;
      market?: string;
      language?: string;
      preferredServiceType?: string;
      locationAddress?: string;
    };
    if (d?.pickupLat == null || d?.pickupLng == null) continue;
    const matched = targetNames.find((n) => (d.locationName ?? "").includes(n));
    if (!matched) continue;
    candidates.push({
      locationId: row.locationId,
      name: matched,
      pickupLat: d.pickupLat,
      pickupLng: d.pickupLng,
      market: d.market || "BR",
      language: d.language || "pt_BR",
      serviceType: d.preferredServiceType || "LALAGO",
      pickupAddress: d.locationAddress || matched,
    });
  }
  const candidateByName = new Map(candidates.map((c) => [c.name, c]));

  // Find CD Extrema, pull unfulfilled orders.
  const locRes = await client.admin.graphql(
    `#graphql
      query L { locations(first: 50) { nodes { id name } } }`,
  );
  const locJson = (await locRes.json()) as {
    data?: { locations?: { nodes?: Array<{ id: string; name: string }> } };
  };
  const extrema = (locJson?.data?.locations?.nodes ?? []).find((n) => /extrema/i.test(n.name));
  if (!extrema) {
    console.error("No CD Extrema location");
    await prisma.$disconnect();
    process.exit(1);
  }
  const extremaLegacy = extrema.id.replace("gid://shopify/Location/", "");
  const query = `fulfillment_location_id:${extremaLegacy} fulfillment_status:unshipped status:open`;

  const orders: OrderRow[] = [];
  let cursor: string | null = null;
  let noCoords = 0;
  for (let page = 0; page < 40; page += 1) {
    const res = await client.admin.graphql(
      `#graphql
        query O($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT) {
            edges { cursor node {
              id name displayFulfillmentStatus
              shippingAddress { address1 address2 city province country latitude longitude phone }
              customer { displayName phone defaultPhoneNumber { phoneNumber } }
            } }
            pageInfo { hasNextPage }
          }
        }`,
      { variables: { query, first: 100, after: cursor } },
    );
    const json = (await res.json()) as {
      data?: {
        orders?: {
          edges?: Array<{
            cursor: string;
            node: {
              id: string;
              name: string;
              displayFulfillmentStatus: string;
              shippingAddress?: {
                address1?: string | null;
                address2?: string | null;
                city?: string | null;
                province?: string | null;
                country?: string | null;
                latitude?: number | null;
                longitude?: number | null;
                phone?: string | null;
              } | null;
              customer?: {
                displayName?: string | null;
                phone?: string | null;
                defaultPhoneNumber?: { phoneNumber?: string | null } | null;
              } | null;
            };
          }>;
          pageInfo?: { hasNextPage?: boolean };
        };
      };
    };
    const edges = json?.data?.orders?.edges ?? [];
    for (const e of edges) {
      if (e.node.displayFulfillmentStatus !== "UNFULFILLED") continue;
      const addr = e.node.shippingAddress;
      if (!addr?.latitude || !addr?.longitude) {
        noCoords += 1;
        continue;
      }
      orders.push({
        id: e.node.id,
        name: e.node.name,
        customerName: e.node.customer?.displayName ?? e.node.name,
        city: addr.city ?? null,
        lat: Number(addr.latitude),
        lng: Number(addr.longitude),
        address1: addr.address1 ?? "",
        address2: addr.address2 ?? "",
        province: addr.province ?? null,
        country: addr.country ?? null,
        phone:
          e.node.customer?.defaultPhoneNumber?.phoneNumber ??
          addr.phone ??
          e.node.customer?.phone ??
          "",
      });
    }
    if (!json?.data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  console.log(`Unfulfilled orders pulled (with lat/lng): ${orders.length}`);
  console.log(`Excluded (no lat/lng): ${noCoords}`);

  // Per-order: resolve origin candidate.
  type Candidate = { order: OrderRow; loc: LocationCandidate; distanceKm: number; reason: "override" | "radius" };
  const inRadius: Candidate[] = [];
  const outOfRadius: OrderRow[] = [];

  for (const o of orders) {
    const cityKey = normalize(o.city);
    const override = CITY_OVERRIDES.find((c) => c.cityNormalized === cityKey);
    if (override) {
      const loc = candidateByName.get(override.storeName);
      if (loc) {
        const km = haversineKm(o.lat, o.lng, loc.pickupLat, loc.pickupLng);
        inRadius.push({ order: o, loc, distanceKm: km, reason: "override" });
        continue;
      }
    }
    let bestLoc: LocationCandidate | null = null;
    let bestKm = Infinity;
    for (const c of candidates) {
      const km = haversineKm(o.lat, o.lng, c.pickupLat, c.pickupLng);
      if (km < bestKm) {
        bestKm = km;
        bestLoc = c;
      }
    }
    if (bestLoc && bestKm <= MAX_RADIUS_KM) {
      inRadius.push({ order: o, loc: bestLoc, distanceKm: bestKm, reason: "radius" });
    } else {
      outOfRadius.push(o);
    }
  }

  console.log(`In scope (overrides + 100 km radius): ${inRadius.length}`);
  console.log(`Out of scope: ${outOfRadius.length}`);
  console.log();

  // Quote each in-scope order.
  type Quoted = Candidate & { totalBRL: number; quotationId: string };
  type Failed = Candidate & { error: string };
  const quotable: Quoted[] = [];
  const notQuotable: Failed[] = [];

  let i = 0;
  for (const c of inRadius) {
    i += 1;
    try {
      const result = await createLalamoveQuotation(
        {
          market: c.loc.market,
          language: c.loc.language,
          serviceType: c.loc.serviceType,
          stops: [
            {
              coordinates: { lat: String(c.loc.pickupLat), lng: String(c.loc.pickupLng) },
              address: c.loc.pickupAddress,
            },
            {
              coordinates: { lat: String(c.order.lat), lng: String(c.order.lng) },
              address:
                [c.order.address1, c.order.city, c.order.province, c.order.country]
                  .filter(Boolean)
                  .join(", ") || c.order.address1,
              sourceAddress2: c.order.address2 || undefined,
            },
          ],
          isRouteOptimized: false,
        },
        credentials,
      );
      const total = parseFloat(result?.priceBreakdown?.total ?? "0") || 0;
      quotable.push({ ...c, totalBRL: total, quotationId: result.quotationId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notQuotable.push({ ...c, error: msg.slice(0, 160) });
    }
    if (i % 10 === 0) {
      console.log(`  ...${i}/${inRadius.length} (ok=${quotable.length} fail=${notQuotable.length})`);
    }
    await sleep(QUOTE_DELAY_MS);
  }
  console.log();

  // Canonical city display names (handles Shopify capitalisation/accent
  // inconsistencies — "São Paulo" / "SÃo Paulo" / "Sao paulo" all collapse).
  const CANONICAL_CITY: Record<string, string> = {
    "sao paulo": "São Paulo",
    "rio de janeiro": "Rio de Janeiro",
    "recife": "Recife",
    "niteroi": "Niterói",
    "campinas": "Campinas",
    "osasco": "Osasco",
    "taboao da serra": "Taboão da Serra",
    "embu das artes": "Embu das Artes",
    "olinda": "Olinda",
    "jaboatao dos guararapes": "Jaboatão dos Guararapes",
    "sao bernardo do campo": "São Bernardo do Campo",
    "santo andre": "Santo André",
    "guarulhos": "Guarulhos",
    "amparo": "Amparo",
  };
  const titleCase = (s: string): string =>
    s.split(" ").map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
  const canonicalCity = (raw: string | null): string => {
    if (!raw) return "<unknown>";
    const key = normalize(raw);
    return CANONICAL_CITY[key] ?? titleCase(key);
  };

  // Group quotable by (canonical destination city, origin store).
  type Bucket = { city: string; origin: string; count: number; sumBRL: number };
  const buckets = new Map<string, Bucket>();
  for (const q of quotable) {
    const city = canonicalCity(q.order.city);
    const origin = q.loc.name;
    const key = `${city}||${origin}`;
    let b = buckets.get(key);
    if (!b) {
      b = { city, origin, count: 0, sumBRL: 0 };
      buckets.set(key, b);
    }
    b.count += 1;
    b.sumBRL += q.totalBRL;
  }

  // Sort: by origin first, then city descending count.
  const ORIGIN_ORDER = ["RioSul", "Shopping Recife", "Shops Jardins"];
  const rows = [...buckets.values()].sort((a, b) => {
    const oa = ORIGIN_ORDER.indexOf(a.origin);
    const ob = ORIGIN_ORDER.indexOf(b.origin);
    if (oa !== ob) return oa - ob;
    return b.count - a.count;
  });

  // Print the table.
  const cityW = Math.max(16, ...rows.map((r) => r.city.length));
  const originW = Math.max(15, ...rows.map((r) => r.origin.length));
  const head =
    `| ${"City".padEnd(cityW)} | ${"Shipping from".padEnd(originW)} | Orders | Total Lalamove cost |`;
  const sep =
    `| ${"-".repeat(cityW)} | ${"-".repeat(originW)} | ------ | ------------------- |`;
  console.log(head);
  console.log(sep);
  for (const r of rows) {
    const ordersCell = String(r.count).padStart(6);
    const costCell = `R$ ${r.sumBRL.toFixed(2)}`.padStart(19);
    console.log(`| ${r.city.padEnd(cityW)} | ${r.origin.padEnd(originW)} | ${ordersCell} | ${costCell} |`);
  }

  // Totals row.
  const totalOrders = quotable.length;
  const totalCost = quotable.reduce((acc, q) => acc + q.totalBRL, 0);
  console.log(sep);
  console.log(
    `| ${"TOTAL".padEnd(cityW)} | ${"".padEnd(originW)} | ${String(totalOrders).padStart(6)} | ${`R$ ${totalCost.toFixed(2)}`.padStart(19)} |`,
  );

  if (notQuotable.length > 0) {
    console.log();
    console.log(`Lalamove refused (${notQuotable.length}):`);
    for (const f of notQuotable.slice(0, 12)) {
      console.log(`  ${f.order.name} city=${f.order.city} loc=${f.loc.name} distKm=${f.distanceKm.toFixed(1)} err=${f.error.slice(0, 90)}`);
    }
  }

  console.log();
  console.log(
    `Summary: ${orders.length} unfulfilled · ${inRadius.length} in scope (overrides + 100 km) · ${quotable.length} Lalamove-quotable · ${notQuotable.length} refused · ${outOfRadius.length} out of scope`,
  );

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
