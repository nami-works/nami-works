// Side-by-side diff: #80669 (Hexagon, wrong) vs #80702 (native, correct).
import { PrismaClient } from "@prisma/client";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const TARGET = "gid://shopify/Order/7266071085376"; // #80669 (Hexagon)
const REFERENCE = "gid://shopify/Order/7266956968256"; // #80702 (native PICK_UP)

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

const Q = `#graphql
  query Full($id: ID!) {
    order(id: $id) {
      id name createdAt sourceName tags note
      displayFulfillmentStatus
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

const [a, b] = await Promise.all([gql(Q, { id: TARGET }), gql(Q, { id: REFERENCE })]);
const tgt = a.data.order;
const ref = b.data.order;

function brief(o) {
  return {
    name: o.name,
    sourceName: o.sourceName,
    tags: (o.tags ?? []).filter((t) => !/^hxo-|FullComm/.test(t)), // strip noisy Hexagon UUIDs
    shippingLine: o.shippingLines?.nodes?.[0],
    fulfillmentOrder: o.fulfillmentOrders?.nodes?.[0],
    shippingAddress: o.shippingAddress,
  };
}

console.log("\n========= TARGET — #80669 (Hexagon, wrong) =========");
console.log(JSON.stringify(brief(tgt), null, 2));
console.log("\n========= REFERENCE — #80702 (native, correct) =========");
console.log(JSON.stringify(brief(ref), null, 2));

console.log("\n========= DIFF: the fields Hexagon needs to fix =========");
const t = brief(tgt), r = brief(ref);
const tL = t.shippingLine ?? {};
const rL = r.shippingLine ?? {};
const tFO = t.fulfillmentOrder ?? {};
const rFO = r.fulfillmentOrder ?? {};
const tDM = tFO.deliveryMethod ?? {};
const rDM = rFO.deliveryMethod ?? {};
console.log(`
shippingLines[0].code
  target    = "${tL.code}"   ← Hexagon writes pickup-flavoured code
  reference = "${rL.code}"   ← native writes just the location name

shippingLines[0].title
  target    = "${tL.title}"
  reference = "${rL.title}"

shippingLines[0].source / carrierIdentifier / deliveryCategory
  target    = source=${tL.source}  carrier=${tL.carrierIdentifier}  category=${tL.deliveryCategory}
  reference = source=${rL.source}  carrier=${rL.carrierIdentifier}  category=${rL.deliveryCategory}

fulfillmentOrders[0].deliveryMethod.methodType        ← *** THE CORE BUG ***
  target    = "${tDM.methodType}"   ← Shopify treats this as a delivery order
  reference = "${rDM.methodType}"   ← native pickup uses PICK_UP

fulfillmentOrders[0].destination     ← pickup orders should NOT carry a customer-address destination
  target    = ${tFO.destination ? `{address1=${tFO.destination.address1}, city=${tFO.destination.city}}` : "null"}
  reference = ${rFO.destination ? `{address1=${rFO.destination.address1}, city=${rFO.destination.city}}` : "null"}

shippingAddress (whose address is on the shipping line?)
  target    = ${t.shippingAddress?.address1}, ${t.shippingAddress?.city} ← customer's HOME address
  reference = ${r.shippingAddress?.address1}, ${r.shippingAddress?.city} ← typically location/empty
`);

await prisma[String.fromCharCode(36) + "disconnect"]();
