// READ-ONLY: rolling 24h dispatch audit. Pulls last 24h of LalamoveDispatchJob,
// fetches live Lalamove state + Shopify fulfillment state, classifies sync status.
//
// Buckets (per dispatch):
//   IN_FLIGHT          — Lalamove ON_GOING/PICKED_UP/ASSIGNING; not yet COMPLETED
//   COMPLETED_SYNCED   — Lalamove COMPLETED AND every linked Shopify order FULFILLED
//   COMPLETED_DRIFT    — Lalamove COMPLETED but ≥1 Shopify order still UNFULFILLED
//   CANCELED           — Lalamove CANCELED/REJECTED/EXPIRED
//   FAILED_DELIVERY    — at least one stop with POD FAILED
//   FETCH_FAIL         — couldn't fetch Lalamove state

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const LAL_BASE = "https://rest.lalamove.com";
const SHOP = "ge-beauty-cosmeticos.myshopify.com";

function decryptSecret(ciphertext) {
  const parsed = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8"));
  const keyRaw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!keyRaw) throw new Error("APP_ENCRYPTION_KEY missing");
  const key = Buffer.from(keyRaw, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const clear = Buffer.concat([decipher.update(Buffer.from(parsed.ct, "base64")), decipher.final()]);
  return clear.toString("utf8");
}

let LAL_KEY = process.env.LALAMOVE_API_KEY?.trim();
let LAL_SECRET = process.env.LALAMOVE_API_SECRET?.trim();

const since = new Date(Date.now() - 24 * 3600 * 1000);

const LOCATION_NAMES = {
  "97784398144": "Shops Jardins",
  "101298569536": "Quiosque RioSul",
  "97397014848": "Quiosque Recife",
};

function fmtBrt(d) {
  if (!d) return "?";
  const t = new Date(d.getTime() - 3 * 3600 * 1000);
  return `${String(t.getUTCMonth()+1).padStart(2,"0")}-${String(t.getUTCDate()).padStart(2,"0")} ${String(t.getUTCHours()).padStart(2,"0")}:${String(t.getUTCMinutes()).padStart(2,"0")}`;
}

async function fetchLalamove(orderId) {
  const ts = Date.now().toString();
  const apiPath = `/v3/orders/${encodeURIComponent(orderId)}`;
  const sig = crypto.createHmac("sha256", LAL_SECRET).update(`${ts}\r\nGET\r\n${apiPath}\r\n\r\n`).digest("hex");
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

if (!LAL_KEY || !LAL_SECRET) {
  const cred = await prisma.lalamoveShopCredential.findUnique({ where: { shop: SHOP } });
  if (!cred) { console.error("No Lalamove creds for shop"); process.exit(2); }
  LAL_KEY = decryptSecret(cred.apiKeyCiphertext);
  LAL_SECRET = decryptSecret(cred.apiSecretCiphertext);
}

const session = await prisma.session.findFirst({
  where: { shop: SHOP }, orderBy: { expires: "desc" }, select: { accessToken: true },
});
const SHOP_TOKEN = session?.accessToken;

async function shopifyGql(query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOP_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const jobs = await prisma.lalamoveDispatchJob.findMany({
  where: { shop: SHOP, requestedAt: { gte: since } },
  orderBy: { requestedAt: "asc" },
  select: {
    id: true, lalamoveOrderId: true, status: true, retryCount: true, reorderCount: true,
    requestedAt: true, locationId: true, routeId: true, podBucket: true, needsReviewReason: true,
  },
});

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

console.log(`\n=== Rolling 24h dispatch audit (since ${fmtBrt(since)} BRT) ===`);
console.log(`Total dispatch jobs: ${jobs.length}\n`);

const rows = [];

for (const job of jobs) {
  const maps = mapsByJob.get(job.id) ?? [];
  let lalStatus = "?";
  let driverId = null;
  let stops = [];
  if (job.lalamoveOrderId) {
    const r = await fetchLalamove(job.lalamoveOrderId);
    if (r.status === 200) {
      lalStatus = (r.order.status ?? "?").toUpperCase();
      driverId = r.order.driverId ?? null;
      stops = r.order.stops ?? [];
    } else {
      lalStatus = `FETCH_${r.status}`;
    }
  } else {
    lalStatus = "NO_LAL_ID";
  }

  const shopOrders = [];
  for (const m of maps) {
    const json = await shopifyGql(`#graphql
      query AuditOrder($id: ID!) {
        order(id: $id) {
          name displayFulfillmentStatus tags
          fulfillments(first: 5) { id createdAt status }
        }
      }`, { id: m.shopifyOrderId });
    const o = json?.data?.order;
    if (!o) {
      shopOrders.push({ id: m.shopifyOrderId, name: "?", status: "FETCH_FAIL", tags: [] });
      continue;
    }
    shopOrders.push({
      id: m.shopifyOrderId,
      name: o.name,
      status: o.displayFulfillmentStatus,
      tags: o.tags ?? [],
      fulfillments: o.fulfillments ?? [],
    });
  }

  // Classify
  let bucket = "?";
  if (["FETCH_FAIL", "NO_LAL_ID"].includes(lalStatus) || lalStatus.startsWith("FETCH_")) bucket = "FETCH_FAIL";
  else if (["CANCELED", "CANCELLED", "REJECTED", "EXPIRED"].includes(lalStatus)) bucket = "CANCELED";
  else if (["ASSIGNING_DRIVER", "ON_GOING", "PICKED_UP"].includes(lalStatus)) bucket = "IN_FLIGHT";
  else if (lalStatus === "COMPLETED") {
    const podFailures = stops.filter((s) => (s.POD?.status ?? "").toUpperCase() === "FAILED").length;
    const allFulfilled = shopOrders.length > 0 && shopOrders.every((o) => o.status === "FULFILLED");
    if (podFailures > 0 && !allFulfilled) bucket = "FAILED_DELIVERY";
    else if (allFulfilled) bucket = "COMPLETED_SYNCED";
    else bucket = "COMPLETED_DRIFT";
  } else {
    bucket = "OTHER";
  }

  rows.push({ job, lalStatus, driverId, stops, shopOrders, bucket });
}

// Summary
const byBucket = {};
for (const r of rows) byBucket[r.bucket] = (byBucket[r.bucket] ?? 0) + 1;
console.log("=== Summary ===");
for (const [k, v] of Object.entries(byBucket)) console.log(`  ${k}: ${v}`);

// Per-store summary
const byStore = {};
for (const r of rows) {
  const loc = LOCATION_NAMES[r.job.locationId ?? ""] ?? `loc=${r.job.locationId}`;
  byStore[loc] ??= { total: 0 };
  byStore[loc].total++;
  byStore[loc][r.bucket] = (byStore[loc][r.bucket] ?? 0) + 1;
}
console.log("\n=== Per-store ===");
for (const [k, v] of Object.entries(byStore)) {
  const breakdown = Object.entries(v).filter(([kk]) => kk !== "total").map(([kk, vv]) => `${kk}=${vv}`).join(" ");
  console.log(`  ${k}: ${v.total} dispatches | ${breakdown}`);
}

// Drift / failed / in-flight details
console.log("\n=== Detail rows (excluding COMPLETED_SYNCED) ===");
for (const r of rows) {
  if (r.bucket === "COMPLETED_SYNCED") continue;
  const loc = LOCATION_NAMES[r.job.locationId ?? ""] ?? `loc=${r.job.locationId}`;
  const orderNames = r.shopOrders.map((o) => `${o.name}(${o.status})`).join(",");
  console.log(`  [${fmtBrt(r.job.requestedAt)}] ${loc} job=${r.job.id.slice(-10)} lal=${r.lalStatus} bucket=${r.bucket} orders=${orderNames}${r.job.needsReviewReason ? ` review=${r.job.needsReviewReason}` : ""}`);
}

// Full COMPLETED_SYNCED count for completeness
const synced = rows.filter((r) => r.bucket === "COMPLETED_SYNCED");
if (synced.length > 0) {
  console.log(`\n=== ${synced.length} COMPLETED_SYNCED dispatches (no drift) ===`);
  for (const r of synced) {
    const loc = LOCATION_NAMES[r.job.locationId ?? ""] ?? `loc=${r.job.locationId}`;
    const orderNames = r.shopOrders.map((o) => o.name).join(",");
    console.log(`  [${fmtBrt(r.job.requestedAt)}] ${loc} orders=${orderNames}`);
  }
}

await prisma[String.fromCharCode(36) + "disconnect"]();
