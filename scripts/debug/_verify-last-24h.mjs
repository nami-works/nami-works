// READ-ONLY: verify last 24h of LalamoveDispatchJobs match the intended
// automation policy. For each dispatch:
//   1. Pull Lalamove state (order status + per-stop POD)
//   2. Pull Shopify state (per order: fulfillment status + tags)
//   3. Compare actual vs expected per the policy:
//
// Policy (per CLAUDE.md + reconcile design):
//   Lalamove order COMPLETED + stop POD = DELIVERED/SIGNED/etc → Shopify FULFILLED, ld_rota archived
//   Lalamove order COMPLETED + stop POD = FAILED              → Shopify UNFULFILLED + ld_failed-delivery
//   Lalamove order CANCELED/REJECTED/EXPIRED + partial PODs   → mixed bucket: delivered → FULFILLED,
//                                                              failed → ld_failed-delivery
//   Lalamove order EXPIRED + no PODs (no driver assigned)     → ld_failed-dispatch + no ld_rota
//   Lalamove order ON_GOING/PICKED_UP                         → in-flight, ld_rota present, no fulfillment
//
// No mutations. No DB writes.

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const LAL_KEY = process.env.LALAMOVE_API_KEY?.trim();
const LAL_SECRET = process.env.LALAMOVE_API_SECRET?.trim();
const LAL_BASE = "https://rest.lalamove.com";
const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const HOURS = parseInt(process.env.HOURS ?? "24", 10);

if (!LAL_KEY || !LAL_SECRET) {
  console.error("Missing LALAMOVE_API_KEY / LALAMOVE_API_SECRET");
  process.exit(2);
}

const normalizePhone = (s) => (s ?? "").toString().replace(/\D+/g, "");
const podLabel = (raw) => {
  const r = (raw ?? "").toUpperCase();
  if (["DELIVERED", "COMPLETED", "SUCCESS", "SIGNED"].includes(r)) return "DELIVERED";
  if (["FAILED", "FAIL", "REJECTED"].includes(r)) return "FAILED";
  if (["PENDING", "IN_PROGRESS", "ON_GOING"].includes(r)) return "PENDING";
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
  if (res.status !== 200) return { status: res.status, error: await res.json().catch(() => ({})) };
  const body = await res.json().catch(() => ({}));
  return { status: 200, order: body.data ?? body };
}

const prisma = new PrismaClient();
const session = await prisma.session.findFirst({
  where: { shop: SHOP }, orderBy: { expires: "desc" }, select: { accessToken: true },
});
const SHOP_TOKEN = session?.accessToken;
if (!SHOP_TOKEN) { console.error("No Session row with accessToken for", SHOP); process.exit(3); }

async function shopifyGql(query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOP_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const since = new Date(Date.now() - HOURS * 60 * 60 * 1000);
const jobs = await prisma.lalamoveDispatchJob.findMany({
  where: { requestedAt: { gte: since } },
  orderBy: { requestedAt: "asc" },
  select: {
    id: true, lalamoveOrderId: true, status: true, podBucket: true, needsReviewReason: true,
    partialDelivery: true, requestedAt: true, locationId: true, routeId: true,
  },
});
console.log(`\nFound ${jobs.length} dispatches in last ${HOURS}h.\n`);

const jobIds = jobs.map((j) => j.id);
const orderMaps = await prisma.lalamoveDispatchOrderMap.findMany({
  where: { dispatchJobId: { in: jobIds } },
  select: { dispatchJobId: true, shopifyOrderId: true, currentStatus: true, stopOutcome: true },
});
const mapsByJob = new Map();
for (const m of orderMaps) {
  const arr = mapsByJob.get(m.dispatchJobId) ?? [];
  arr.push(m);
  mapsByJob.set(m.dispatchJobId, arr);
}

const FULFILLED = new Set(["FULFILLED", "PARTIALLY_FULFILLED"]);

const SUMMARY = {
  dispatches: jobs.length,
  inFlight: 0,
  completedClean: 0,
  completedMixed: 0,
  cancelledOrExpired: 0,
  needsReview: 0,
  unknown: 0,
  stopsDeliveredOk: 0,
  stopsDeliveredMissing: 0,
  stopsFailedTagOk: 0,
  stopsFailedTagMissing: 0,
  stopsExpiredWithFailedDispatch: 0,
  stopsExpiredMissingFailedDispatch: 0,
  stopsInFlightWithRota: 0,
  stopsInFlightMissingRota: 0,
  stopsUnknown: 0,
  shopifyFetchFail: 0,
  lalFetchFail: 0,
};

for (const job of jobs) {
  const maps = mapsByJob.get(job.id) ?? [];
  const orderCount = maps.length;
  let lalStatus = "?";
  let lalOrder = null;

  if (job.lalamoveOrderId) {
    const r = await fetchLalamove(job.lalamoveOrderId);
    if (r.status !== 200) {
      SUMMARY.lalFetchFail++;
      console.log(`✗ ${job.requestedAt.toISOString()} job=${job.id.slice(-8)} lalamove=${job.lalamoveOrderId} fetch failed (${r.status})`);
      continue;
    }
    lalOrder = r.order;
    lalStatus = (lalOrder.status ?? "?").toUpperCase();
  }

  const stops = lalOrder?.stops ?? [];
  // Build phone-tail → POD map (skip pickup index 0).
  const podByPhoneTail = new Map();
  const podByName = new Map();
  for (let i = 1; i < stops.length; i++) {
    const tail = normalizePhone(stops[i].phone).slice(-8);
    const info = { label: podLabel(stops[i].POD?.status), name: stops[i].name ?? "?", phone: stops[i].phone };
    if (tail) podByPhoneTail.set(tail, info);
    if (stops[i].name) podByName.set(stops[i].name.trim().toLowerCase(), info);
  }

  // Bucket the dispatch
  const podsAll = [...podByPhoneTail.values()];
  const deliveredCount = podsAll.filter((p) => p.label === "DELIVERED").length;
  const failedCount = podsAll.filter((p) => p.label === "FAILED").length;
  const pendingCount = podsAll.filter((p) => p.label === "PENDING" || p.label === "MISSING").length;

  let bucket = "unknown";
  if (["ASSIGNING_DRIVER", "ON_GOING", "PICKED_UP"].includes(lalStatus)) bucket = "in-flight";
  else if (lalStatus === "COMPLETED" && failedCount === 0) bucket = "completed-clean";
  else if (lalStatus === "COMPLETED" && failedCount > 0) bucket = "completed-mixed";
  else if (["CANCELED", "REJECTED", "EXPIRED"].includes(lalStatus)) {
    if (deliveredCount > 0 || failedCount > 0) bucket = "completed-mixed";
    else bucket = "expired-no-driver";
  }

  if (bucket === "in-flight") SUMMARY.inFlight++;
  else if (bucket === "completed-clean") SUMMARY.completedClean++;
  else if (bucket === "completed-mixed") SUMMARY.completedMixed++;
  else if (bucket === "expired-no-driver") SUMMARY.cancelledOrExpired++;
  else SUMMARY.unknown++;

  if (job.podBucket === "needs-review") SUMMARY.needsReview++;

  console.log(
    `\n[${job.requestedAt.toISOString().slice(0,16)}Z] job=${job.id.slice(-10)}  route=${(job.routeId ?? "?").slice(-26)}\n` +
    `  lalamove=${job.lalamoveOrderId}  status=${lalStatus}  stops=${stops.length}  pods: D=${deliveredCount} F=${failedCount} P=${pendingCount}\n` +
    `  dbStatus=${job.status}  podBucket=${job.podBucket ?? "-"}  needsReviewReason=${job.needsReviewReason ?? "-"}  classification=${bucket}`,
  );

  for (const m of maps) {
    const q = `#graphql
      query VerifyOrder($id: ID!) {
        order(id: $id) {
          name displayFulfillmentStatus tags
          shippingAddress { phone }
          customer { phone displayName }
        }
      }`;
    const json = await shopifyGql(q, { id: m.shopifyOrderId });
    const order = json?.data?.order;
    if (!order) {
      SUMMARY.shopifyFetchFail++;
      console.log(`    order=${m.shopifyOrderId.slice(-8)}  SHOPIFY-FETCH-FAILED`);
      continue;
    }

    // Match by phone tail OR customer display name.
    const phones = [order.shippingAddress?.phone, order.customer?.phone]
      .map(normalizePhone).filter((p) => p.length >= 8).map((p) => p.slice(-8));
    let pod = null;
    for (const t of phones) {
      if (podByPhoneTail.has(t)) { pod = podByPhoneTail.get(t); break; }
    }
    if (!pod && order.customer?.displayName) {
      const key = order.customer.displayName.trim().toLowerCase();
      if (podByName.has(key)) pod = podByName.get(key);
    }

    const shopStatus = order.displayFulfillmentStatus;
    const isFulfilled = FULFILLED.has(shopStatus);
    const tags = order.tags ?? [];
    const hasFailedDelivery = tags.includes("ld_failed-delivery") || tags.includes("Failed delivery");
    const hasFailedDispatch = tags.includes("ld_failed-dispatch");
    const hasLdRota = tags.some((t) => /^ld_rota-\d+$/i.test(t));
    const hasArchivedRota = tags.some((t) => /^ld_rota-\d+_\d{2}\.\d{2}\.\d{2}$/i.test(t));

    let verdict = "?";
    const expected = pod?.label;
    if (bucket === "in-flight") {
      if (hasLdRota) { verdict = "✓ in-flight (ld_rota present)"; SUMMARY.stopsInFlightWithRota++; }
      else { verdict = "✗ in-flight but no ld_rota tag"; SUMMARY.stopsInFlightMissingRota++; }
    } else if (bucket === "expired-no-driver") {
      if (hasFailedDispatch && !hasLdRota) { verdict = "✓ expired-no-driver (ld_failed-dispatch set)"; SUMMARY.stopsExpiredWithFailedDispatch++; }
      else { verdict = "✗ expired-no-driver MISSING ld_failed-dispatch"; SUMMARY.stopsExpiredMissingFailedDispatch++; }
    } else if (expected === "DELIVERED") {
      if (isFulfilled) { verdict = "✓ delivered+fulfilled"; SUMMARY.stopsDeliveredOk++; }
      else { verdict = "✗ DELIVERED on Lalamove but UNFULFILLED on Shopify"; SUMMARY.stopsDeliveredMissing++; }
    } else if (expected === "FAILED") {
      if (hasFailedDelivery) { verdict = "✓ failed+tag"; SUMMARY.stopsFailedTagOk++; }
      else { verdict = "✗ FAILED on Lalamove but no ld_failed-delivery tag"; SUMMARY.stopsFailedTagMissing++; }
    } else {
      verdict = `? unmatched expected=${expected ?? "no-pod"} ldRota=${hasLdRota} archivedRota=${hasArchivedRota}`;
      SUMMARY.stopsUnknown++;
    }

    const ldTags = tags.filter((t) => t.startsWith("ld_") || t.toLowerCase().includes("delivery")).join(",") || "-";
    console.log(
      `    order=${order.name.padEnd(7)}  shopStatus=${shopStatus.padEnd(20)}  tags=${ldTags.padEnd(40)}  pod=${(expected ?? "?").padEnd(9)}  verdict=${verdict}`,
    );
  }
}

console.log("\n=== SUMMARY ===");
console.log(`Dispatches in last ${HOURS}h: ${SUMMARY.dispatches}`);
console.log(`  in-flight                = ${SUMMARY.inFlight}`);
console.log(`  completed clean          = ${SUMMARY.completedClean}`);
console.log(`  completed mixed          = ${SUMMARY.completedMixed}`);
console.log(`  expired (no driver)      = ${SUMMARY.cancelledOrExpired}`);
console.log(`  needs-review             = ${SUMMARY.needsReview}`);
console.log(`  unknown classification   = ${SUMMARY.unknown}`);
console.log(`\nStops:`);
console.log(`  ✓ delivered+fulfilled            = ${SUMMARY.stopsDeliveredOk}`);
console.log(`  ✗ delivered+UNFULFILLED          = ${SUMMARY.stopsDeliveredMissing}`);
console.log(`  ✓ failed+ld_failed-delivery      = ${SUMMARY.stopsFailedTagOk}`);
console.log(`  ✗ failed without tag             = ${SUMMARY.stopsFailedTagMissing}`);
console.log(`  ✓ expired-no-driver+failed-dispatch = ${SUMMARY.stopsExpiredWithFailedDispatch}`);
console.log(`  ✗ expired-no-driver missing failed-dispatch = ${SUMMARY.stopsExpiredMissingFailedDispatch}`);
console.log(`  ✓ in-flight w/ ld_rota           = ${SUMMARY.stopsInFlightWithRota}`);
console.log(`  ✗ in-flight w/o ld_rota          = ${SUMMARY.stopsInFlightMissingRota}`);
console.log(`  ? unmatched                      = ${SUMMARY.stopsUnknown}`);
console.log(`  Shopify fetch failures           = ${SUMMARY.shopifyFetchFail}`);
console.log(`  Lalamove fetch failures          = ${SUMMARY.lalFetchFail}`);

await prisma[String.fromCharCode(36) + "disconnect"]();
