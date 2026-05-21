// Find a native (non-Hexagon) pickup order at Shops Jardins for diff reference.
import { PrismaClient } from "@prisma/client";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const SHOPS_JARDINS = "gid://shopify/Location/97784398144";

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

// Search broadly — last 120 days, sort newest first.
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
            assignedLocation { location { id } }
            deliveryMethod { methodType }
          }
        }
      }
    }
  }`;

const SINCE = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
let after = null;
const matched = [];
const methodTypeCounts = {};
const sourceCounts = {};

for (let page = 0; page < 6 && matched.length < 6; page++) {
  const r = await gql(q, { q: `created_at:>=${SINCE}`, after });
  const orders = r?.data?.orders;
  if (!orders) break;
  for (const o of orders.nodes ?? []) {
    const fos = o.fulfillmentOrders?.nodes ?? [];
    const atLoc = fos.some((fo) => fo.assignedLocation?.location?.id === SHOPS_JARDINS);
    if (!atLoc) continue;
    const isHexagon = (o.tags ?? []).some((t) => t.toLowerCase().startsWith("hexagon"));
    const methodTypes = fos.map((fo) => fo.deliveryMethod?.methodType).filter(Boolean);
    methodTypes.forEach((m) => { methodTypeCounts[m] = (methodTypeCounts[m] ?? 0) + 1; });
    sourceCounts[o.sourceName ?? "(null)"] = (sourceCounts[o.sourceName ?? "(null)"] ?? 0) + 1;
    const shipCodes = (o.shippingLines?.nodes ?? []).map((s) => s.code).filter(Boolean);
    // Native pickup signals: deliveryMethod is PICK_UP / LOCAL_PICKUP, OR shippingLine code starts with pickup
    const looksPickup = methodTypes.some((m) => m && m.toUpperCase().includes("PICK")) ||
      shipCodes.some((c) => c.toLowerCase().includes("pickup"));
    if (looksPickup && !isHexagon) {
      matched.push({
        name: o.name, id: o.id, source: o.sourceName, createdAt: o.createdAt,
        tags: o.tags?.slice(0, 8),
        methodTypes, shipCodes,
      });
    }
  }
  if (!orders.pageInfo?.hasNextPage) break;
  after = orders.pageInfo.endCursor;
}

console.log(`\nMatched ${matched.length} candidate native pickup orders:`);
for (const m of matched) console.log(JSON.stringify(m));

console.log(`\nmethodType distribution among Shops Jardins orders:`);
for (const [k, v] of Object.entries(methodTypeCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k} = ${v}`);

console.log(`\nsourceName distribution:`);
for (const [k, v] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${k} = ${v}`);

await prisma[String.fromCharCode(36) + "disconnect"]();
