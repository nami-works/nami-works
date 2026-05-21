// READ-ONLY: compare order #80669 (mis-placed by Hexagon as a delivery
// but should have been a native pickup) against a real native online-store
// pickup order from the same location (Shops Jardins, gid=97784398144).
//
// Prints the relevant fulfillment/delivery metadata side-by-side so the
// Hexagon team can see what their payload looks like vs a clean reference.

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

// Load .env (local-script convention; in container env already populated).
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const TARGET_ORDER_GID = "gid://shopify/Order/7266071085376";  // #80669
const SHOPS_JARDINS_LOCATION_GID = "gid://shopify/Location/97784398144";

const prisma = new PrismaClient();
const session = await prisma.session.findFirst({
  where: { shop: SHOP }, orderBy: { expires: "desc" }, select: { accessToken: true },
});
const TOKEN = session?.accessToken;
if (!TOKEN) { console.error("No Session token for", SHOP); process.exit(2); }

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-01";

async function gql(query, variables) {
  const r = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

const FULL_ORDER = `#graphql
  query FullOrder($id: ID!) {
    order(id: $id) {
      id name createdAt processedAt sourceName sourceIdentifier
      displayFinancialStatus displayFulfillmentStatus
      note customAttributes { key value }
      tags
      totalPriceSet { presentmentMoney { amount currencyCode } }
      customer { id displayName email phone tags }
      shippingAddress {
        firstName lastName company phone address1 address2 city province
        country countryCode zip latitude longitude
      }
      billingAddress { firstName lastName city province countryCode }
      shippingLines(first: 10) {
        nodes {
          title code source carrierIdentifier deliveryCategory custom
          originalPriceSet { presentmentMoney { amount currencyCode } }
        }
      }
      lineItems(first: 25) {
        nodes {
          id title quantity sku
          variant { id title sku }
        }
      }
      fulfillmentOrders(first: 10) {
        nodes {
          id status fulfillAt requestStatus
          assignedLocation { name location { id name } }
          destination { firstName lastName phone address1 city province countryCode zip }
          deliveryMethod {
            methodType
            additionalInformation { instructions phone }
            minDeliveryDateTime maxDeliveryDateTime
          }
          fulfillBy
          lineItems(first: 25) {
            nodes { id totalQuantity remainingQuantity }
          }
        }
      }
      fulfillments(first: 5) {
        id status displayStatus
        location { name id }
        trackingInfo { number company url }
      }
    }
  }`;

// Print only the diff-relevant slices.
function summarise(o) {
  return {
    name: o.name,
    sourceName: o.sourceName,
    sourceIdentifier: o.sourceIdentifier,
    createdAt: o.createdAt,
    displayFulfillmentStatus: o.displayFulfillmentStatus,
    tags: o.tags,
    note: o.note,
    customAttributes: o.customAttributes,
    customer: o.customer
      ? { displayName: o.customer.displayName, email: o.customer.email, phone: o.customer.phone, tags: o.customer.tags }
      : null,
    shippingAddress: o.shippingAddress,
    shippingLines: (o.shippingLines?.nodes ?? []).map((s) => ({
      title: s.title, code: s.code, source: s.source, carrierIdentifier: s.carrierIdentifier,
      deliveryCategory: s.deliveryCategory, custom: s.custom,
      price: s.originalPriceSet?.presentmentMoney,
    })),
    fulfillmentOrders: (o.fulfillmentOrders?.nodes ?? []).map((fo) => ({
      id: fo.id,
      status: fo.status,
      requestStatus: fo.requestStatus,
      fulfillAt: fo.fulfillAt,
      assignedLocation: fo.assignedLocation,
      destination: fo.destination,
      deliveryMethod: fo.deliveryMethod,
    })),
    fulfillments: o.fulfillments ?? [],
  };
}

console.log("=== Loading TARGET order #80669 (Hexagon-posted) ===\n");
const targetRes = await gql(FULL_ORDER, { id: TARGET_ORDER_GID });
const target = targetRes?.data?.order;
if (!target) {
  console.error("Failed to load target order:", JSON.stringify(targetRes, null, 2));
  process.exit(3);
}

// Find a comparison order: native online-store pickup at the same location,
// non-Hexagon (sourceName likely 'shopify' or 'web'), recent.
console.log("=== Searching native online-store pickup order at Shops Jardins ===\n");
const SEARCH_LIST = `#graphql
  query Search($q: String!) {
    orders(first: 30, query: $q, reverse: true, sortKey: CREATED_AT) {
      nodes {
        id name createdAt sourceName tags
        shippingAddress { city }
        fulfillmentOrders(first: 5) {
          nodes {
            assignedLocation { location { id name } }
            deliveryMethod { methodType }
          }
        }
      }
    }
  }`;

// Pull recent (last 60 days) and filter client-side for: location matches,
// deliveryMethod methodType is PICK_UP / PICKUP / LOCAL with pickup destination,
// and sourceName != Hexagon.
const SINCE_ISO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const searchRes = await gql(SEARCH_LIST, { q: `created_at:>=${SINCE_ISO} fulfillment_status:fulfilled` });
const candidates = (searchRes?.data?.orders?.nodes ?? []).filter((o) => {
  const fos = o.fulfillmentOrders?.nodes ?? [];
  const matchesLoc = fos.some((fo) => fo.assignedLocation?.location?.id === SHOPS_JARDINS_LOCATION_GID);
  const isPickup = fos.some((fo) => {
    const t = (fo.deliveryMethod?.methodType ?? "").toUpperCase();
    return t === "PICK_UP" || t === "PICKUP" || t === "LOCAL_PICKUP";
  });
  return matchesLoc && isPickup;
});

console.log(`  ${candidates.length} candidates found among last ${searchRes?.data?.orders?.nodes?.length ?? 0} fulfilled orders.`);
const reference = candidates[0];
if (!reference) {
  console.log("  ❗ No native pickup order found. Falling back to ANY fulfilled order at Shops Jardins for diff.");
}

let referenceFull = null;
if (reference) {
  const r = await gql(FULL_ORDER, { id: reference.id });
  referenceFull = r?.data?.order;
  console.log(`  Selected reference: ${referenceFull?.name} (id=${referenceFull?.id}, source=${referenceFull?.sourceName})`);
}

console.log("\n=========================================================");
console.log("== TARGET (Hexagon-posted #80669) — should be in-store pickup ==");
console.log("=========================================================\n");
console.log(JSON.stringify(summarise(target), null, 2));

if (referenceFull) {
  console.log("\n=========================================================");
  console.log(`== REFERENCE (native ${referenceFull.name}) — actual pickup at Shops Jardins ==`);
  console.log("=========================================================\n");
  console.log(JSON.stringify(summarise(referenceFull), null, 2));

  console.log("\n=========================================================");
  console.log("== KEY DELTAS (most likely to be wrong on Hexagon side) ==");
  console.log("=========================================================\n");
  const tFO = target.fulfillmentOrders?.nodes?.[0];
  const rFO = referenceFull.fulfillmentOrders?.nodes?.[0];
  const tShip = (target.shippingLines?.nodes ?? [])[0];
  const rShip = (referenceFull.shippingLines?.nodes ?? [])[0];
  console.log(`fulfillmentOrders[0].deliveryMethod.methodType:`);
  console.log(`  target    = ${tFO?.deliveryMethod?.methodType}`);
  console.log(`  reference = ${rFO?.deliveryMethod?.methodType}`);
  console.log(`\nshippingLines[0].code / deliveryCategory:`);
  console.log(`  target    = code=${tShip?.code} deliveryCategory=${tShip?.deliveryCategory} title=${tShip?.title}`);
  console.log(`  reference = code=${rShip?.code} deliveryCategory=${rShip?.deliveryCategory} title=${rShip?.title}`);
  console.log(`\nfulfillmentOrders[0].destination (should be NULL for pickup):`);
  console.log(`  target    = ${tFO?.destination ? "present (" + tFO.destination.city + ")" : "null"}`);
  console.log(`  reference = ${rFO?.destination ? "present (" + rFO.destination.city + ")" : "null"}`);
  console.log(`\nshippingAddress (pickup orders typically have shippingAddress = store address, NOT customer address):`);
  console.log(`  target    = ${target.shippingAddress?.address1}, ${target.shippingAddress?.city}`);
  console.log(`  reference = ${referenceFull.shippingAddress?.address1}, ${referenceFull.shippingAddress?.city}`);
}

await prisma[String.fromCharCode(36) + "disconnect"]();
