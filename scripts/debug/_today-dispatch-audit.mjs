// READ-ONLY: today's dispatch audit for unexpected drivers.
// Pulls today's LalamoveDispatchJob rows (BRT calendar day), cross-references
// Lalamove order state + Shopify fulfillment state, classifies "unexpected".

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

// BRT = UTC-3. Today 00:00 BRT = today 03:00 UTC.
// "Today" relative to BRT: take now, shift to BRT, take midnight, shift back to UTC.
const nowUtc = new Date();
const nowBrtMs = nowUtc.getTime() - 3 * 3600 * 1000;
const brtMidnight = new Date(nowBrtMs);
brtMidnight.setUTCHours(0, 0, 0, 0);
const since = new Date(brtMidnight.getTime() + 3 * 3600 * 1000); // back to UTC

const LOCATION_NAMES = {
  "97784398144": "Shops Jardins",
  "101298569536": "Quiosque RioSul",
  "97397014848": "Quiosque Recife",
};

function fmtBrt(d) {
  if (!d) return "?";
  const t = new Date(d.getTime() - 3 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,"0")}-${String(t.getUTCDate()).padStart(2,"0")} ${String(t.getUTCHours()).padStart(2,"0")}:${String(t.getUTCMinutes()).padStart(2,"0")} BRT`;
}

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

if (!LAL_KEY || !LAL_SECRET) {
  const cred = await prisma.lalamoveShopCredential.findUnique({ where: { shop: SHOP } });
  if (!cred) { console.error("No Lalamove creds for shop"); process.exit(2); }
  LAL_KEY = decryptSecret(cred.apiKeyCiphertext);
  LAL_SECRET = decryptSecret(cred.apiSecretCiphertext);
  console.log("[creds] loaded from DB, keyLen=", LAL_KEY.length);
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
    id: true, lalamoveOrderId: true, status: true, retryCount: true,
    requestedAt: true, locationId: true, routeId: true, createdAt: true, updatedAt: true,
    podBucket: true, needsReviewReason: true,
  },
});
console.log(`\n=== Today's dispatches (since ${since.toISOString()} = 00:00 BRT) ===`);
console.log(`Total jobs: ${jobs.length}`);

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

const CUTOFF_BRT_MINUTES = 17 * 60 + 30;

const report = [];

for (const job of jobs) {
  const maps = mapsByJob.get(job.id) ?? [];
  let lalStatus = "?";
  let driverId = null;
  let lalOrder = null;
  if (job.lalamoveOrderId) {
    const r = await fetchLalamove(job.lalamoveOrderId);
    if (r.status === 200) {
      lalOrder = r.order;
      lalStatus = (lalOrder.status ?? "?").toUpperCase();
      driverId = lalOrder.driverId ?? null;
    } else {
      lalStatus = `FETCH_${r.status}`;
    }
  }

  // BRT minute of day
  const brtMin = (() => {
    const t = new Date(job.requestedAt.getTime() - 3 * 3600 * 1000);
    return t.getUTCHours() * 60 + t.getUTCMinutes();
  })();
  const postCutoff = brtMin > CUTOFF_BRT_MINUTES;

  // Shopify state per linked order
  const shopOrders = [];
  for (const m of maps) {
    const q = `#graphql
      query Verify($id: ID!) {
        order(id: $id) {
          name displayFulfillmentStatus tags
          fulfillments(first: 5) { id createdAt }
        }
      }`;
    const json = await shopifyGql(q, { id: m.shopifyOrderId });
    const o = json?.data?.order;
    if (!o) {
      shopOrders.push({ id: m.shopifyOrderId, name: "?", status: "FETCH_FAIL", tags: [], fulfillments: [] });
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

  // Was any linked order ALREADY fulfilled when dispatch was created?
  const preFulfilled = shopOrders.some((o) => {
    if (!["FULFILLED", "PARTIALLY_FULFILLED"].includes(o.status)) return false;
    // If a fulfillment exists with createdAt < job.requestedAt, it was pre-fulfilled.
    return (o.fulfillments ?? []).some((f) => new Date(f.createdAt).getTime() < job.requestedAt.getTime());
  });

  const reasons = [];
  if (postCutoff) reasons.push(`POST_CUTOFF (${Math.floor(brtMin/60)}:${String(brtMin%60).padStart(2,"0")} BRT > 17:30)`);
  if (job.retryCount > 0) reasons.push(`AUTO_RETRY (retryCount=${job.retryCount})`);
  if (preFulfilled) reasons.push(`PRE_FULFILLED_ORDER`);
  if (job.status === "CANCELED_BY_OPERATOR" && driverId) reasons.push(`KILL_LOCK_LEAK (driverId=${driverId} despite CANCELED_BY_OPERATOR)`);
  if (job.status === "CANCELED_BY_OPERATOR" && job.retryCount === 99 && ["ASSIGNING_DRIVER","ON_GOING","PICKED_UP"].includes(lalStatus)) {
    reasons.push(`KILL_LOCK_LIVE_ON_LALAMOVE (lal=${lalStatus})`);
  }

  const unexpected = reasons.length > 0;

  report.push({
    job, lalStatus, driverId, shopOrders, postCutoff, preFulfilled, unexpected, reasons,
    brtMin,
  });
}

// Output
console.log("\n=== Full timeline ===");
for (const r of report) {
  const loc = LOCATION_NAMES[r.job.locationId ?? ""] ?? `loc=${r.job.locationId ?? "?"}`;
  console.log(
    `\n[${fmtBrt(r.job.requestedAt)}] job=${r.job.id.slice(-12)} lal=${r.job.lalamoveOrderId ?? "-"}`
    + `\n  store=${loc} dbStatus=${r.job.status} retryCount=${r.job.retryCount} lalStatus=${r.lalStatus} driverId=${r.driverId ?? "-"}`
  );
  for (const o of r.shopOrders) {
    const ldTags = (o.tags ?? []).filter((t) => t.startsWith("ld_")).join(",") || "-";
    const fulCount = (o.fulfillments ?? []).length;
    const earliestFul = (o.fulfillments ?? [])
      .map((f) => f.createdAt)
      .sort()[0] ?? null;
    console.log(`    order=${o.name} shopStatus=${o.status} fulfillments=${fulCount}${earliestFul ? ` earliest=${earliestFul}` : ""} tags=${ldTags}`);
  }
  if (r.unexpected) {
    console.log(`  *** UNEXPECTED *** reasons: ${r.reasons.join("; ")}`);
  }
}

const unexpected = report.filter((r) => r.unexpected);
console.log(`\n=== UNEXPECTED COUNT: ${unexpected.length} / ${report.length} ===`);

// Per-store breakdown
const byStore = {};
for (const r of report) {
  const loc = LOCATION_NAMES[r.job.locationId ?? ""] ?? "unknown";
  byStore[loc] ??= { total: 0, unexpected: 0 };
  byStore[loc].total++;
  if (r.unexpected) byStore[loc].unexpected++;
}
console.log("\n=== Per-store ===");
for (const [k, v] of Object.entries(byStore)) {
  console.log(`  ${k}: ${v.total} total, ${v.unexpected} unexpected`);
}

console.log("\n=== UNEXPECTED ROWS (for kill list) ===");
for (const r of unexpected) {
  const loc = LOCATION_NAMES[r.job.locationId ?? ""] ?? "?";
  const orderNames = r.shopOrders.map((o) => o.name).join(",");
  console.log(`  ${fmtBrt(r.job.requestedAt)} | lal=${r.job.lalamoveOrderId ?? "-"} | job=${r.job.id} | ${loc} | dbStatus=${r.job.status} | driver=${r.driverId ?? "-"} | orders=${orderNames} | lalStatus=${r.lalStatus} | reasons=${r.reasons.join("|")}`);
}

await prisma[String.fromCharCode(36) + "disconnect"]();
