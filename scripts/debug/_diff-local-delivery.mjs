// READ-ONLY: compare #80841 (Hexagon local-delivery) with a native online-store
// local-delivery order at the same location to surface any payload-shape
// differences Hexagon would need to fix.
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

const FULL = `#graphql
  query Full($id: ID!) {
    order(id: $id) {
      id name createdAt sourceName tags note
      displayFulfillmentStatus
      customAttributes { key value }
      customer { displayName email phone }
      shippingAddress {
        firstName lastName company phone address1 address2 city province
        countryCode zip latitude longitude
      }
      shippingLines(first: 5) {
        nodes {
          title code source carrierIdentifier deliveryCategory custom
          originalPriceSet { presentmentMoney { amount currencyCode } }
        }
      }
      fulfillmentOrders(first: 5) {
        nodes {
          id status requestStatus fulfillAt
          assignedLocation { name location { id name } }
          destination { firstName lastName phone address1 address2 city province countryCode zip }
          deliveryMethod {
            methodType
            additionalInformation { instructions phone }
            minDeliveryDateTime maxDeliveryDateTime
          }
        }
      }
    }
  }`;

// Step 1: load #80841.
const lookup = `#graphql
  query Lookup($q: String!) {
    orders(first: 5, query: $q) {
      nodes { id name }
    }
  }`;
const lkp = await gql(lookup, { q: "name:80841" });
const targetNode = (lkp?.data?.orders?.nodes ?? []).find((o) => o.name === "80841" || o.name === "#80841");
if (!targetNode) {
  console.error("Could not find order #80841");
  process.exit(2);
}

const a = await gql(FULL, { id: targetNode.id });
const target = a?.data?.order;

// Identify the target's fulfillment location + delivery method.
const tgtLoc = target.fulfillmentOrders?.nodes?.[0]?.assignedLocation?.location?.id;
const tgtMethod = target.fulfillmentOrders?.nodes?.[0]?.deliveryMethod?.methodType;
console.log(`Target #80841 → location=${tgtLoc} methodType=${tgtMethod} source=${target.sourceName}`);

// Step 2: find a native (non-Hexagon) local-delivery order at the SAME location.
const SEARCH = `#graphql
  query S($q: String!, $after: String) {
    orders(first: 50, query: $q, reverse: true, sortKey: CREATED_AT, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt sourceName tags
        fulfillmentOrders(first: 3) {
          nodes {
            assignedLocation { location { id } }
            deliveryMethod { methodType }
          }
        }
      }
    }
  }`;

const SINCE = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
let after = null;
let reference = null;

for (let page = 0; page < 8 && !reference; page++) {
  const r = await gql(SEARCH, { q: `created_at:>=${SINCE}`, after });
  const orders = r?.data?.orders;
  if (!orders) break;
  for (const o of orders.nodes ?? []) {
    if (o.id === target.id) continue;
    const isHexagon = (o.tags ?? []).some((t) => t.toLowerCase().startsWith("hexagon") || t.toLowerCase().startsWith("hxo-"));
    if (isHexagon) continue;
    if (o.sourceName !== "web") continue;
    const fos = o.fulfillmentOrders?.nodes ?? [];
    const matchLoc = fos.some((fo) => fo.assignedLocation?.location?.id === tgtLoc);
    // For local-delivery, methodType is LOCAL (Shopify's name for local delivery).
    const matchMethod = fos.some((fo) => fo.deliveryMethod?.methodType === "LOCAL");
    if (matchLoc && matchMethod) {
      reference = o;
      break;
    }
  }
  if (!orders.pageInfo?.hasNextPage) break;
  after = orders.pageInfo.endCursor;
}

if (!reference) {
  console.error(`Could not find a native web local-delivery order at location ${tgtLoc} in last 90 days`);
  process.exit(3);
}

const b = await gql(FULL, { id: reference.id });
const ref = b?.data?.order;

function brief(o) {
  return {
    name: o.name,
    sourceName: o.sourceName,
    tags: (o.tags ?? []).filter((t) => !/^hxo-|FullComm-/.test(t)),
    note: o.note,
    customAttributes: o.customAttributes,
    shippingLine: o.shippingLines?.nodes?.[0],
    fulfillmentOrder: o.fulfillmentOrders?.nodes?.[0],
    shippingAddress: o.shippingAddress,
  };
}

console.log("\n========= TARGET — #80841 (Hexagon, local-delivery) =========");
console.log(JSON.stringify(brief(target), null, 2));
console.log(`\n========= REFERENCE — ${ref.name} (native web, local-delivery) =========`);
console.log(JSON.stringify(brief(ref), null, 2));

console.log("\n========= DIFF (focus: payload shape) =========");
const t = brief(target), r = brief(ref);
const tL = t.shippingLine ?? {};
const rL = r.shippingLine ?? {};
const tFO = t.fulfillmentOrder ?? {};
const rFO = r.fulfillmentOrder ?? {};
const tDM = tFO.deliveryMethod ?? {};
const rDM = rFO.deliveryMethod ?? {};
console.log(`
sourceName
  target    = "${t.sourceName}"
  reference = "${r.sourceName}"

shippingLines[0].title / code / source
  target    = title="${tL.title}"  code="${tL.code}"  source="${tL.source}"  category=${tL.deliveryCategory}
  reference = title="${rL.title}"  code="${rL.code}"  source="${rL.source}"  category=${rL.deliveryCategory}

fulfillmentOrders[0].deliveryMethod.methodType
  target    = "${tDM.methodType}"
  reference = "${rDM.methodType}"

fulfillmentOrders[0].deliveryMethod.additionalInformation
  target    = ${JSON.stringify(tDM.additionalInformation)}
  reference = ${JSON.stringify(rDM.additionalInformation)}

fulfillmentOrders[0].deliveryMethod.min/max DeliveryDateTime
  target    = min=${tDM.minDeliveryDateTime} max=${tDM.maxDeliveryDateTime}
  reference = min=${rDM.minDeliveryDateTime} max=${rDM.maxDeliveryDateTime}

fulfillmentOrders[0].destination
  target    = ${tFO.destination ? `{${tFO.destination.address1} ${tFO.destination.address2 ?? ""}, ${tFO.destination.city}, ${tFO.destination.zip}}` : "null"}
  reference = ${rFO.destination ? `{${rFO.destination.address1} ${rFO.destination.address2 ?? ""}, ${rFO.destination.city}, ${rFO.destination.zip}}` : "null"}

shippingAddress
  target    = ${t.shippingAddress?.address1}, ${t.shippingAddress?.city}  (phone=${t.shippingAddress?.phone})
  reference = ${r.shippingAddress?.address1}, ${r.shippingAddress?.city}  (phone=${r.shippingAddress?.phone})

tags (filtered for ld_*/PICKUP/PICK_UP/LOCAL/etc)
  target    = ${(t.tags ?? []).filter((tag) => tag.startsWith("ld_") || /^(PICKUP|PICK_UP|LOCAL|Shops|Shopping|Quiosque)/i.test(tag) || /shipping|delivery/i.test(tag)).join(", ")}
  reference = ${(r.tags ?? []).filter((tag) => tag.startsWith("ld_") || /^(PICKUP|PICK_UP|LOCAL|Shops|Shopping|Quiosque)/i.test(tag) || /shipping|delivery/i.test(tag)).join(", ")}

customAttributes count
  target    = ${t.customAttributes?.length ?? 0}
  reference = ${r.customAttributes?.length ?? 0}
`);

await prisma[String.fromCharCode(36) + "disconnect"]();
