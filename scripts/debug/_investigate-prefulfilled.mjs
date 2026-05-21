// READ-ONLY: investigate
//   (a) why #80669 and #80741 are in active dispatches despite already FULFILLED
//   (b) why dispatches are being created after the configured retry cutoff

import { PrismaClient } from "@prisma/client";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";

const prisma = new PrismaClient();
const session = await prisma.session.findFirst({
  where: { shop: SHOP }, orderBy: { expires: "desc" }, select: { accessToken: true },
});
const TOKEN = session.accessToken;

async function gql(query, variables) {
  const r = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

// Try multiple query variants to find the orders.
const ORDER_NAMES = ["#80669", "#80741"];
const lookupQ = `#graphql
  query LookupOrders($q: String!) {
    orders(first: 5, query: $q) {
      nodes {
        id name displayFulfillmentStatus tags createdAt
        shippingAddress { phone }
        customer { phone displayName }
        fulfillments(first: 10) { id status displayStatus createdAt }
      }
    }
  }`;

const found = [];
for (const name of ORDER_NAMES) {
  const stripped = name.replace(/^#/, "");
  const r = await gql(lookupQ, { q: `name:${stripped}` });
  const ords = r?.data?.orders?.nodes ?? [];
  if (r?.errors) console.log(`  errors for ${name}: ${JSON.stringify(r.errors).slice(0, 200)}`);
  for (const o of ords) {
    if (o.name === name || o.name === stripped || o.name === `#${stripped}`) found.push(o);
  }
}

console.log("== Orders ==");
for (const o of found) {
  console.log(`\n${o.name}  id=${o.id}  displayFulfillmentStatus=${o.displayFulfillmentStatus}  createdAt=${o.createdAt}`);
  console.log(`  shipping.phone=${o.shippingAddress?.phone}  customer.phone=${o.customer?.phone}  customer=${o.customer?.displayName}`);
  console.log(`  tags=${(o.tags ?? []).join(",")}`);
  console.log(`  fulfillments:`);
  for (const f of o.fulfillments ?? []) {
    console.log(`    id=${f.id.slice(-12)}  status=${f.status}  displayStatus=${f.displayStatus}  at=${f.createdAt}`);
  }
}

console.log("\n== Dispatch history per order ==");
for (const o of found) {
  const maps = await prisma.lalamoveDispatchOrderMap.findMany({
    where: { shop: SHOP, shopifyOrderId: o.id },
    select: {
      dispatchJobId: true, currentStatus: true, stopOutcome: true,
      stopFailureReason: true, createdAt: true,
    },
  });
  console.log(`\n${o.name} — ${maps.length} dispatch map row(s):`);
  for (const m of maps.sort((a, b) => a.createdAt - b.createdAt)) {
    const job = await prisma.lalamoveDispatchJob.findUnique({
      where: { id: m.dispatchJobId },
      select: {
        id: true, lalamoveOrderId: true, status: true, podBucket: true, partialDelivery: true,
        requestedAt: true, locationId: true, routeId: true, requestedBy: true,
      },
    });
    console.log(
      `  job=${job.id.slice(-10)}  requestedAt=${job.requestedAt.toISOString()}  by=${job.requestedBy ?? "?"}\n` +
      `    lalamove=${job.lalamoveOrderId}  status=${job.status}  podBucket=${job.podBucket}  partial=${job.partialDelivery}\n` +
      `    route=${(job.routeId ?? "").slice(-30)}\n` +
      `    map: stopOutcome=${m.stopOutcome ?? "-"}  currentStatus=${m.currentStatus ?? "-"}  reason=${m.stopFailureReason ?? "-"}  createdAt=${m.createdAt.toISOString()}`,
    );
  }
}

console.log("\n== Location retry-cutoff configs ==");
const configs = await prisma.lalamoveLocationConfig.findMany({
  where: { shop: SHOP },
  select: { locationId: true, data: true },
});
for (const c of configs) {
  const d = c.data ?? {};
  console.log(`  locationId=${c.locationId}  retryCutoffTime=${d.retryCutoffTime ?? "-"}  timezone=${d.timezone ?? "-"}  name=${d.locationName ?? "-"}`);
}

console.log("\n== All last-24h LalamoveDispatchJob requestedAt times (sorted) ==");
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
const recentJobs = await prisma.lalamoveDispatchJob.findMany({
  where: { shop: SHOP, requestedAt: { gte: since } },
  orderBy: { requestedAt: "asc" },
  select: {
    id: true, requestedAt: true, lalamoveOrderId: true, status: true,
    podBucket: true, locationId: true, requestedBy: true, retryCount: true,
  },
});
// Convert each requestedAt to BRT (UTC-3) for easy reading vs 17:30 cutoff.
for (const j of recentJobs) {
  const utc = j.requestedAt;
  const brt = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const brtStr = brt.toISOString().replace("Z", " BRT").slice(0, 19);
  const utcStr = utc.toISOString().slice(0, 19) + "Z";
  console.log(
    `  ${utcStr} (${brtStr})  job=${j.id.slice(-10)}  loc=${j.locationId.slice(-15)}  status=${j.status.padEnd(20)}  retry=${j.retryCount}  by=${j.requestedBy ?? "?"}`,
  );
}

await prisma[String.fromCharCode(36) + "disconnect"]();
