// READ-ONLY: cross-reference each of the 39 Shopify orders from yesterday's
// 10 dispatches against the Lalamove POD outcome.
//
// For each Shopify order, prints:
//   - Shopify display status + fulfillment count + tags
//   - Lalamove POD outcome for the matching stop (matched by phone last 8 digits)
//   - Whether they agree (✓) or diverge (✗)
//
// Loads Lalamove POD via API; reads Shopify via raw Admin GraphQL using the
// Session.accessToken row for the shop.
//
// No mutations. No DB writes.
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const LAL_KEY = process.env.LALAMOVE_API_KEY?.trim();
const LAL_SECRET = process.env.LALAMOVE_API_SECRET?.trim();
const LAL_BASE = "https://rest.lalamove.com";
const SHOP = "ge-beauty-cosmeticos.myshopify.com";

const LAL_ORDERS = [
  "3496880797028401487", "3496880797028401590", "3496888467470893374",
  "3496881288651162145", "3496890061373522427", "3496890061373522454",
  "3496905241507614901", "3496905241507614915", "3496905254946164994",
  "3496905241507614973",
];

const normalizePhone = (s) => (s ?? "").toString().replace(/\D+/g, "");
const podLabel = (raw) => {
  const r = (raw ?? "").toUpperCase();
  if (["DELIVERED", "COMPLETED", "SUCCESS", "SIGNED"].includes(r)) return "DELIVERED";
  if (["FAILED", "FAIL", "REJECTED"].includes(r)) return "FAILED";
  if (!r) return "MISSING";
  return r;
};

async function fetchLalamove(orderId) {
  const ts = Date.now().toString();
  const apiPath = `/v3/orders/${encodeURIComponent(orderId)}`;
  const sig = crypto
    .createHmac("sha256", LAL_SECRET)
    .update(`${ts}\r\nGET\r\n${apiPath}\r\n\r\n`)
    .digest("hex");
  const res = await fetch(`${LAL_BASE}${apiPath}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `hmac ${LAL_KEY}:${ts}:${sig}`,
      Market: "BR",
      "Request-ID": crypto.randomUUID(),
    },
  });
  if (res.status !== 200) return null;
  const body = await res.json().catch(() => ({}));
  return body.data ?? body;
}

const prisma = new PrismaClient();

// Pull access token for the shop.
const session = await prisma.session.findFirst({
  where: { shop: SHOP },
  orderBy: { expires: "desc" },
  select: { accessToken: true },
});
if (!session?.accessToken) {
  console.error("No Session row with accessToken for", SHOP);
  process.exit(2);
}
const SHOP_TOKEN = session.accessToken;

async function shopifyQuery(query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOP_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const jobs = await prisma.lalamoveDispatchJob.findMany({
  where: { lalamoveOrderId: { in: LAL_ORDERS } },
  select: { id: true, lalamoveOrderId: true, status: true, podBucket: true },
});
const orderMaps = await prisma.lalamoveDispatchOrderMap.findMany({
  where: { dispatchJobId: { in: jobs.map((j) => j.id) } },
  select: { dispatchJobId: true, shopifyOrderId: true, currentStatus: true, stopOutcome: true },
});
const mapsByJob = new Map();
for (const m of orderMaps) {
  const arr = mapsByJob.get(m.dispatchJobId) ?? [];
  arr.push(m);
  mapsByJob.set(m.dispatchJobId, arr);
}

const head = ["lalSuffix", "order#", "shopStatus", "tags(ld_*|delivery)", "lalPOD", "recipient", "stopOutcome(DB)", "verdict"];
console.log(head.map((s, i) => s.padEnd(i === 3 ? 32 : 16)).join(" | "));
console.log("-".repeat(170));

const FULFILLED = new Set(["FULFILLED", "PARTIALLY_FULFILLED"]);
const SUMMARY = { deliveredOk: 0, deliveredMissing: 0, failedTagOk: 0, failedTagMissing: 0, noPhoneMatch: 0, lalFetchFail: 0 };

for (const lalId of LAL_ORDERS) {
  const job = jobs.find((j) => j.lalamoveOrderId === lalId);
  if (!job) {
    console.log(`${lalId.slice(-7)}  (no LalamoveDispatchJob row found)`);
    continue;
  }
  const lal = await fetchLalamove(lalId);
  if (!lal) {
    SUMMARY.lalFetchFail++;
    console.log(`${lalId.slice(-7)}  (Lalamove fetch failed)`);
    continue;
  }
  const stops = lal.stops ?? [];
  const maps = mapsByJob.get(job.id) ?? [];
  const podByPhoneTail = new Map();
  for (let i = 1; i < stops.length; i++) {
    const tail = normalizePhone(stops[i].phone).slice(-8);
    if (tail) podByPhoneTail.set(tail, { label: podLabel(stops[i].POD?.status), name: stops[i].name ?? "?" });
  }
  for (const m of maps) {
    const q = `#graphql
      query VerifyOrder($id: ID!) {
        order(id: $id) {
          id name displayFulfillmentStatus tags
          shippingAddress { phone }
          customer { phone }
        }
      }`;
    const json = await shopifyQuery(q, { id: m.shopifyOrderId });
    const order = json?.data?.order;
    if (!order) {
      console.log(`${lalId.slice(-7)}  ${m.shopifyOrderId.slice(-12)}  (Shopify fetch failed: ${JSON.stringify(json?.errors ?? "?").slice(0,80)})`);
      continue;
    }
    const shopPhones = [order.shippingAddress?.phone, order.customer?.phone]
      .map(normalizePhone).filter((p) => p.length >= 8).map((p) => p.slice(-8));
    let match = null;
    for (const tail of shopPhones) {
      if (podByPhoneTail.has(tail)) { match = podByPhoneTail.get(tail); break; }
    }
    const shopStatus = order.displayFulfillmentStatus;
    const isFulfilled = FULFILLED.has(shopStatus);
    const hasFailedTag = (order.tags ?? []).some((t) =>
      ["ld_failed-delivery", "ld_failed-dispatch", "Failed delivery"].includes(t),
    );
    let verdict = "?";
    if (!match) { verdict = "? no phone match"; SUMMARY.noPhoneMatch++; }
    else if (match.label === "DELIVERED") {
      if (isFulfilled) { verdict = "✓ delivered"; SUMMARY.deliveredOk++; }
      else { verdict = "✗ NOT FULFILLED"; SUMMARY.deliveredMissing++; }
    } else if (match.label === "FAILED") {
      if (hasFailedTag) { verdict = "✓ failed-tag"; SUMMARY.failedTagOk++; }
      else { verdict = "✗ NO FAILED TAG"; SUMMARY.failedTagMissing++; }
    }
    const ldTags = (order.tags ?? []).filter((t) => t.startsWith("ld_") || t.toLowerCase().includes("delivery")).join(",") || "-";
    console.log(
      [
        lalId.slice(-7),
        order.name,
        shopStatus,
        ldTags,
        match?.label ?? "?",
        (match?.name ?? "?").slice(0, 16),
        m.stopOutcome ?? "-",
        verdict,
      ].map((s, i) => String(s).padEnd(i === 3 ? 32 : 16)).join(" | "),
    );
  }
}

console.log("\nSUMMARY:");
for (const [k, v] of Object.entries(SUMMARY)) console.log(`  ${k}=${v}`);

await prisma[String.fromCharCode(36) + "disconnect"]();
