import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";

const normalize = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const TARGET_CITIES = new Set([
  normalize("Rio de Janeiro"),
  normalize("Recife"),
  normalize("São Paulo"),
]);

(async () => {
  const client = await unauthenticated.admin(SHOP);

  // 1. List ALL fulfillment locations so we can identify CD Extrema by name.
  console.log("=== Step 1: locations ===");
  const locRes = await client.admin.graphql(`#graphql
    query Locations { locations(first: 50) { nodes { id name address { city province country } } } }
  `);
  const locJson = (await locRes.json()) as {
    data?: { locations?: { nodes?: Array<{ id: string; name: string; address?: { city?: string | null; province?: string | null; country?: string | null } | null }> } };
  };
  const locations = locJson?.data?.locations?.nodes ?? [];
  for (const l of locations) {
    console.log(`  ${l.id}  ${l.name.padEnd(40)} city=${l.address?.city ?? "-"}`);
  }

  const extrema = locations.find((l) => /extrema/i.test(l.name));
  if (!extrema) {
    console.error("Could not find CD Extrema among locations — aborting.");
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`\nCD Extrema id=${extrema.id}`);
  const extremaLegacyId = extrema.id.replace("gid://shopify/Location/", "");

  // 2. Page through unfulfilled orders at CD Extrema.
  console.log("\n=== Step 2: unfulfilled orders at CD Extrema ===");
  const query = `fulfillment_location_id:${extremaLegacyId} fulfillment_status:unshipped status:open`;
  let cursor: string | null = null;
  type OrderRow = {
    id: string;
    name: string;
    displayFulfillmentStatus: string;
    createdAt: string;
    city: string | null;
    province: string | null;
    country: string | null;
  };
  const all: OrderRow[] = [];
  for (let page = 0; page < 40; page += 1) {
    const res = await client.admin.graphql(
      `#graphql
        query Orders($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT) {
            edges {
              cursor
              node {
                id
                name
                displayFulfillmentStatus
                createdAt
                shippingAddress { city province country }
              }
            }
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
              createdAt: string;
              shippingAddress?: { city?: string | null; province?: string | null; country?: string | null } | null;
            };
          }>;
          pageInfo?: { hasNextPage?: boolean };
        };
      };
    };
    const edges = json?.data?.orders?.edges ?? [];
    for (const e of edges) {
      all.push({
        id: e.node.id,
        name: e.node.name,
        displayFulfillmentStatus: e.node.displayFulfillmentStatus,
        createdAt: e.node.createdAt,
        city: e.node.shippingAddress?.city ?? null,
        province: e.node.shippingAddress?.province ?? null,
        country: e.node.shippingAddress?.country ?? null,
      });
    }
    if (!json?.data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  console.log(`Total orders returned by search query: ${all.length}`);

  // The query filter is leaky. Apply the authoritative displayFulfillmentStatus
  // gate on top — UNFULFILLED only.
  const truly = all.filter((o) => o.displayFulfillmentStatus === "UNFULFILLED");
  console.log(`Of those, displayFulfillmentStatus === UNFULFILLED: ${truly.length}`);
  const skipped = all.length - truly.length;
  if (skipped > 0) {
    const skippedByStatus: Record<string, number> = {};
    for (const o of all) {
      if (o.displayFulfillmentStatus !== "UNFULFILLED") {
        skippedByStatus[o.displayFulfillmentStatus] = (skippedByStatus[o.displayFulfillmentStatus] || 0) + 1;
      }
    }
    console.log(`  (excluded: ${JSON.stringify(skippedByStatus)})`);
  }

  // 3. Bucket by destination city.
  console.log("\n=== Step 3: city distribution (unfulfilled only) ===");
  const cityBuckets: Record<string, number> = {};
  const matchedToTargets: OrderRow[] = [];
  for (const o of truly) {
    const city = normalize(o.city);
    const key = city || "<unknown>";
    cityBuckets[key] = (cityBuckets[key] || 0) + 1;
    if (TARGET_CITIES.has(city)) {
      matchedToTargets.push(o);
    }
  }
  const sortedCities = Object.entries(cityBuckets).sort((a, b) => b[1] - a[1]);
  console.log("Top destination cities:");
  for (const [city, count] of sortedCities.slice(0, 15)) {
    const flag = TARGET_CITIES.has(city) ? " ← TARGET" : "";
    console.log(`  ${count.toString().padStart(4)}  ${city}${flag}`);
  }
  if (sortedCities.length > 15) {
    const tail = sortedCities.slice(15).reduce((acc, [, n]) => acc + n, 0);
    console.log(`  ... ${sortedCities.length - 15} more cities, ${tail} orders`);
  }

  // 4. Final answers.
  console.log("\n=== ANSWERS ===");
  console.log(`Q1: Unfulfilled orders routed to CD Extrema: ${truly.length}`);
  console.log(`Q2: Of those, destined for {Rio de Janeiro | Recife | São Paulo}: ${matchedToTargets.length}`);
  const perCity: Record<string, number> = {};
  for (const o of matchedToTargets) {
    const c = normalize(o.city);
    perCity[c] = (perCity[c] || 0) + 1;
  }
  for (const [c, n] of Object.entries(perCity)) {
    console.log(`     ${c}: ${n}`);
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
