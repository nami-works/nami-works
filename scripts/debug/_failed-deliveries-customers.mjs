// READ-ONLY: pull customer name + contact for orders with failed-delivery
// state in the last N hours. Two signals:
//   1. orders carrying ld_redelivery_pending (canonical system-applied tag
//      from pod-bucketing for FAILED stops on mixed/skip routes)
//   2. orders whose LalamoveDispatchOrderMap.stopOutcome === "FAILED"
//
// Union of the two sets so we don't miss either path.
import { PrismaClient } from "@prisma/client";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const HOURS = parseInt(process.env.HOURS ?? "28", 10);

const prisma = new PrismaClient();
const sessions = await prisma.session.findMany({
  where: { shop: SHOP },
  orderBy: [{ isOnline: "asc" }, { expires: "desc" }],
  select: { accessToken: true, isOnline: true },
});
const TOKEN = (sessions.find((s) => !s.isOnline) ?? sessions[0]).accessToken;

async function gql(q, v) {
  const r = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query: q, variables: v ?? {} }),
  });
  return r.json();
}

const since = new Date(Date.now() - HOURS * 60 * 60 * 1000);

// Path A — DB-side: any LalamoveDispatchOrderMap with stopOutcome=FAILED in window.
const failedMaps = await prisma.lalamoveDispatchOrderMap.findMany({
  where: {
    shop: SHOP,
    stopOutcome: "FAILED",
    updatedAt: { gte: since },
  },
  select: { shopifyOrderId: true, stopFailureReason: true, dispatchJobId: true, updatedAt: true },
});
const dbOrderIds = new Set(failedMaps.map((m) => m.shopifyOrderId));

// Path B — Shopify-side: ld_redelivery_pending tagged orders, regardless of
// DB state (catches paths that may have tagged but didn't update stopOutcome).
const tagQ = `#graphql
  query F($q: String!, $after: String) {
    orders(first: 50, query: $q, reverse: true, sortKey: UPDATED_AT, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name displayFulfillmentStatus updatedAt tags
        shippingAddress { firstName lastName phone city province address1 address2 }
        customer { displayName email phone }
      }
    }
  }`;

// "updated_at:>=YYYY-MM-DD" — coarse but fine for a 28h window.
const sinceDay = new Date(Date.now() - (HOURS + 24) * 60 * 60 * 1000).toISOString().slice(0, 10);
let after = null;
const tagged = [];
for (let page = 0; page < 6; page++) {
  const r = await gql(tagQ, {
    q: `tag:ld_redelivery_pending updated_at:>=${sinceDay}`,
    after,
  });
  const orders = r?.data?.orders;
  if (!orders) break;
  for (const o of orders.nodes ?? []) {
    if (new Date(o.updatedAt) < since) continue;
    tagged.push(o);
  }
  if (!orders.pageInfo?.hasNextPage) break;
  after = orders.pageInfo.endCursor;
}

// Union DB + Shopify findings, dedup by GID.
const seen = new Set();
const final = [];
for (const o of tagged) {
  if (seen.has(o.id)) continue;
  seen.add(o.id);
  const map = failedMaps.find((m) => m.shopifyOrderId === o.id);
  final.push({ o, reason: map?.stopFailureReason ?? null, source: dbOrderIds.has(o.id) ? "db+tag" : "tag" });
}
// Pull any DB-only entries (FAILED stopOutcome but no current ld_redelivery_pending tag).
for (const m of failedMaps) {
  if (seen.has(m.shopifyOrderId)) continue;
  seen.add(m.shopifyOrderId);
  const r = await gql(
    `#graphql
      query One($id: ID!) {
        order(id: $id) {
          id name displayFulfillmentStatus updatedAt tags
          shippingAddress { firstName lastName phone city province address1 address2 }
          customer { displayName email phone }
        }
      }`,
    { id: m.shopifyOrderId },
  );
  const o = r?.data?.order;
  if (o) final.push({ o, reason: m.stopFailureReason, source: "db-only" });
}

console.log(`\nFailed deliveries in last ${HOURS}h: ${final.length} order(s)\n`);
console.log(
  ["order#", "shopify status", "customer", "phone (delivery)", "city", "reason", "src"]
    .map((h, i) => h.padEnd(i === 2 ? 28 : 18))
    .join(" | "),
);
console.log("-".repeat(150));
for (const { o, reason, source } of final) {
  const ship = o.shippingAddress;
  const fullName = ship
    ? [ship.firstName, ship.lastName].filter(Boolean).join(" ").trim()
    : (o.customer?.displayName ?? "?");
  const phone = ship?.phone ?? o.customer?.phone ?? "?";
  console.log(
    [
      o.name,
      o.displayFulfillmentStatus ?? "?",
      (fullName || o.customer?.displayName || "?").slice(0, 28),
      (phone || "?").toString().slice(0, 18),
      (ship?.city ?? "?").slice(0, 18),
      (reason ?? "—").slice(0, 18),
      source,
    ].map((s, i) => String(s).padEnd(i === 2 ? 28 : 18)).join(" | "),
  );
  const ldTags = (o.tags ?? []).filter((t) => t.startsWith("ld_") || /delivery/i.test(t)).join(", ");
  console.log(`    tags: ${ldTags || "—"}`);
}

await prisma[String.fromCharCode(36) + "disconnect"]();
