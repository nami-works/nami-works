// Find native pickup orders at ANY location (Shops Jardins has none).
import { PrismaClient } from "@prisma/client";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";

const prisma = new PrismaClient();
const session = await prisma.session.findFirst({
  where: { shop: SHOP }, orderBy: { expires: "desc" }, select: { accessToken: true },
});
const TOKEN = session.accessToken;

async function gql(q, v) {
  const r = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query: q, variables: v }),
  });
  return r.json();
}

const q = `#graphql
  query S($q: String!, $after: String) {
    orders(first: 50, query: $q, reverse: true, sortKey: CREATED_AT, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt sourceName tags
        shippingLines(first: 3) {
          nodes { code title carrierIdentifier deliveryCategory }
        }
        fulfillmentOrders(first: 5) {
          nodes {
            assignedLocation { location { id name } }
            deliveryMethod { methodType }
          }
        }
      }
    }
  }`;

const SINCE = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
let after = null;
const matched = [];

for (let page = 0; page < 8 && matched.length < 5; page++) {
  const r = await gql(q, { q: `created_at:>=${SINCE}`, after });
  const orders = r?.data?.orders;
  if (!orders) break;
  for (const o of orders.nodes ?? []) {
    const fos = o.fulfillmentOrders?.nodes ?? [];
    const isHexagon = (o.tags ?? []).some((t) => t.toLowerCase().startsWith("hexagon"));
    if (isHexagon) continue;
    const shipCodes = (o.shippingLines?.nodes ?? []).map((s) => s.code ?? "").filter(Boolean);
    const shipTitles = (o.shippingLines?.nodes ?? []).map((s) => s.title ?? "").filter(Boolean);
    const looksPickup = shipCodes.some((c) => c.toLowerCase().includes("pickup") || c.toLowerCase().includes("retira")) ||
      shipTitles.some((t) => t.toLowerCase().includes("retira") || t.toLowerCase().includes("pickup")) ||
      fos.some((fo) => (fo.deliveryMethod?.methodType ?? "").toUpperCase().includes("PICK"));
    if (looksPickup) {
      matched.push({
        name: o.name, id: o.id, source: o.sourceName, createdAt: o.createdAt,
        locations: fos.map((fo) => fo.assignedLocation?.location?.name),
        methodTypes: fos.map((fo) => fo.deliveryMethod?.methodType),
        shipCodes, shipTitles,
        tags: o.tags?.slice(0, 6),
      });
    }
  }
  if (!orders.pageInfo?.hasNextPage) break;
  after = orders.pageInfo.endCursor;
}

console.log(`\n${matched.length} candidate native pickup orders found:`);
for (const m of matched) console.log(JSON.stringify(m));

await prisma[String.fromCharCode(36) + "disconnect"]();
