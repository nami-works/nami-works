import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const SINCE = new Date("2025-11-01T00:00:00Z");

// Names → Shopify GIDs (resolved from the audit ran earlier today).
const TRACKED_LOCATIONS: Array<{ name: string; locationId: string }> = [
  { name: "Shops Jardins", locationId: "gid://shopify/Location/97784398144" },
  { name: "RioSul",        locationId: "gid://shopify/Location/101298569536" },
];

const normalize = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const CANONICAL_CITY: Record<string, string> = {
  "sao paulo": "São Paulo",
  "rio de janeiro": "Rio de Janeiro",
  "niteroi": "Niterói",
  "campinas": "Campinas",
  "osasco": "Osasco",
  "taboao da serra": "Taboão da Serra",
  "embu das artes": "Embu das Artes",
  "sao bernardo do campo": "São Bernardo do Campo",
  "santo andre": "Santo André",
  "guarulhos": "Guarulhos",
  "diadema": "Diadema",
  "maua": "Mauá",
  "cotia": "Cotia",
  "barueri": "Barueri",
  "jundiai": "Jundiaí",
  "sao caetano do sul": "São Caetano do Sul",
  "carapicuiba": "Carapicuíba",
  "itapecerica da serra": "Itapecerica da Serra",
  "ribeirao preto": "Ribeirão Preto",
  "sorocaba": "Sorocaba",
  "duque de caxias": "Duque de Caxias",
  "nova iguacu": "Nova Iguaçu",
  "sao goncalo": "São Gonçalo",
  "petropolis": "Petrópolis",
  "santos": "Santos",
};
const titleCase = (s: string): string =>
  s.split(" ").map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
const canonicalCity = (raw: string | null | undefined): string => {
  if (!raw) return "<unknown>";
  const key = normalize(raw);
  return CANONICAL_CITY[key] ?? titleCase(key);
};

(async () => {
  const client = await unauthenticated.admin(SHOP);

  // 1. Pull every delivery-completed order-map row for the two locations since 2025-11-01.
  console.log(`=== Historical deliveries since ${SINCE.toISOString().slice(0, 10)} ===\n`);

  type Row = {
    locationName: string;
    shopifyOrderId: string;
    dispatchJobId: string;
    deliveredAt: Date;
  };
  const rows: Row[] = [];

  for (const loc of TRACKED_LOCATIONS) {
    // Find dispatch jobs at this location in the window.
    const jobs = await prisma.lalamoveDispatchJob.findMany({
      where: {
        shop: SHOP,
        locationId: loc.locationId,
        createdAt: { gte: SINCE },
      },
      select: { id: true, createdAt: true, status: true },
    });
    const jobIds = jobs.map((j) => j.id);
    if (jobIds.length === 0) {
      console.log(`${loc.name}: 0 dispatch jobs in window`);
      continue;
    }

    // Pull only the maps that show an actual delivery.
    const maps = await prisma.lalamoveDispatchOrderMap.findMany({
      where: {
        shop: SHOP,
        dispatchJobId: { in: jobIds },
        OR: [
          { stopOutcome: "DELIVERED" },
          { currentStatus: { in: ["delivered", "DELIVERED", "COMPLETED"] } },
        ],
      },
      select: { shopifyOrderId: true, dispatchJobId: true, updatedAt: true },
    });

    console.log(
      `${loc.name}: ${jobs.length} dispatch job(s) in window · ${maps.length} delivered order map row(s)`,
    );
    for (const m of maps) {
      rows.push({
        locationName: loc.name,
        shopifyOrderId: m.shopifyOrderId,
        dispatchJobId: m.dispatchJobId,
        deliveredAt: m.updatedAt,
      });
    }
  }
  console.log();

  // 2. Dedupe shopifyOrderIds across the dataset (an order could appear in multiple maps).
  const uniqueOrderIds = [...new Set(rows.map((r) => r.shopifyOrderId))];
  console.log(`Unique shopifyOrderIds to fetch from Shopify: ${uniqueOrderIds.length}`);

  // 3. Batch-fetch shipping cities from Shopify (Admin GraphQL `nodes`).
  const cityByOrderId = new Map<string, string | null>();
  const BATCH = 200;
  for (let i = 0; i < uniqueOrderIds.length; i += BATCH) {
    const batch = uniqueOrderIds.slice(i, i + BATCH);
    const res = await client.admin.graphql(
      `#graphql
        query Cities($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order {
              id
              shippingAddress { city }
            }
          }
        }`,
      { variables: { ids: batch } },
    );
    const json = (await res.json()) as {
      data?: {
        nodes?: Array<{ id?: string; shippingAddress?: { city?: string | null } | null } | null>;
      };
    };
    const nodes = json?.data?.nodes ?? [];
    for (const n of nodes) {
      if (!n?.id) continue;
      cityByOrderId.set(n.id, n.shippingAddress?.city ?? null);
    }
    if ((i + BATCH) % 1000 === 0 || i + BATCH >= uniqueOrderIds.length) {
      console.log(`  fetched ${Math.min(i + BATCH, uniqueOrderIds.length)}/${uniqueOrderIds.length}`);
    }
  }

  // 4. Aggregate per location → canonical city → count.
  type CityStat = { city: string; count: number };
  const byLocation = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const city = canonicalCity(cityByOrderId.get(r.shopifyOrderId) ?? null);
    const mp = byLocation.get(r.locationName) ?? new Map<string, number>();
    mp.set(city, (mp.get(city) ?? 0) + 1);
    byLocation.set(r.locationName, mp);
  }

  // 5. Print per-location city tables.
  for (const loc of TRACKED_LOCATIONS) {
    const mp = byLocation.get(loc.name) ?? new Map();
    const stats: CityStat[] = [...mp.entries()]
      .map(([city, count]) => ({ city, count: count as number }))
      .sort((a, b) => b.count - a.count);
    const total = stats.reduce((a, s) => a + s.count, 0);
    console.log();
    console.log(`=== ${loc.name} — ${stats.length} distinct cities, ${total} delivered orders since ${SINCE.toISOString().slice(0,10)} ===`);
    const cityW = Math.max(28, ...stats.map((s) => s.city.length));
    console.log(`| ${"City".padEnd(cityW)} | Deliveries |`);
    console.log(`| ${"-".repeat(cityW)} | ---------- |`);
    for (const s of stats) {
      console.log(`| ${s.city.padEnd(cityW)} | ${String(s.count).padStart(10)} |`);
    }
  }

  // 6. Cross-reference: today's unfulfilled orders at CD Extrema vs. historically-served cities.
  console.log();
  console.log(`=== Cross-reference with today's unfulfilled orders at CD Extrema ===`);

  const locsRes = await client.admin.graphql(
    `#graphql
      query L { locations(first: 50) { nodes { id name } } }`,
  );
  const locsJson = (await locsRes.json()) as {
    data?: { locations?: { nodes?: Array<{ id: string; name: string }> } };
  };
  const extrema = (locsJson?.data?.locations?.nodes ?? []).find((n) => /extrema/i.test(n.name));
  if (!extrema) {
    console.log("Could not find CD Extrema — skipping cross-reference.");
    await prisma.$disconnect();
    return;
  }
  const extremaLegacy = extrema.id.replace("gid://shopify/Location/", "");
  const todayQuery = `fulfillment_location_id:${extremaLegacy} fulfillment_status:unshipped status:open`;

  type TodayOrder = { id: string; name: string; city: string };
  const todayOrders: TodayOrder[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page += 1) {
    const r = await client.admin.graphql(
      `#graphql
        query O($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT) {
            edges {
              cursor
              node {
                id name displayFulfillmentStatus
                shippingAddress { city }
              }
            }
            pageInfo { hasNextPage }
          }
        }`,
      { variables: { query: todayQuery, first: 100, after: cursor } },
    );
    const j = (await r.json()) as {
      data?: {
        orders?: {
          edges?: Array<{
            cursor: string;
            node: {
              id: string;
              name: string;
              displayFulfillmentStatus: string;
              shippingAddress?: { city?: string | null } | null;
            };
          }>;
          pageInfo?: { hasNextPage?: boolean };
        };
      };
    };
    const edges = j?.data?.orders?.edges ?? [];
    for (const e of edges) {
      if (e.node.displayFulfillmentStatus !== "UNFULFILLED") continue;
      todayOrders.push({
        id: e.node.id,
        name: e.node.name,
        city: canonicalCity(e.node.shippingAddress?.city ?? null),
      });
    }
    if (!j?.data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  // Build "historically served by location X" sets.
  const historicByLocation = new Map<string, Set<string>>();
  for (const [locName, cityMap] of byLocation.entries()) {
    historicByLocation.set(locName, new Set([...cityMap.keys()]));
  }

  // For each today-order, is its city in the historic set of either location?
  type Hit = { city: string; orderName: string; locationName: string };
  const newlyEligible: Hit[] = [];
  const todayByCity = new Map<string, number>();
  for (const o of todayOrders) {
    todayByCity.set(o.city, (todayByCity.get(o.city) ?? 0) + 1);
    for (const [locName, set] of historicByLocation.entries()) {
      if (set.has(o.city)) {
        newlyEligible.push({ city: o.city, orderName: o.name, locationName: locName });
        break;
      }
    }
  }

  // Aggregate hits by city + location.
  const hitsByPair = new Map<string, { city: string; locationName: string; count: number }>();
  for (const h of newlyEligible) {
    const k = `${h.city}||${h.locationName}`;
    let v = hitsByPair.get(k);
    if (!v) {
      v = { city: h.city, locationName: h.locationName, count: 0 };
      hitsByPair.set(k, v);
    }
    v.count += 1;
  }
  const sortedHits = [...hitsByPair.values()].sort((a, b) => b.count - a.count);

  if (sortedHits.length === 0) {
    console.log("No today-unfulfilled orders are in a city that's been historically served by Shops Jardins or RioSul beyond the cities already in today's 100 km scope.");
  } else {
    console.log("Historically-served cities WITH unfulfilled orders today (potential adds):");
    const cityW = Math.max(28, ...sortedHits.map((h) => h.city.length));
    console.log(`| ${"City".padEnd(cityW)} | Shipping from   | Today orders |`);
    console.log(`| ${"-".repeat(cityW)} | --------------- | ------------ |`);
    for (const h of sortedHits) {
      console.log(`| ${h.city.padEnd(cityW)} | ${h.locationName.padEnd(15)} | ${String(h.count).padStart(12)} |`);
    }
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
