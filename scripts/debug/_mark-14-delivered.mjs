// ONE-OFF: mark 14 specific Shopify orders as fulfilled+DELIVERED + archive ld_rota tags.
// Lucas approved. Runs inside cpg-labs-full container.
// See task in conversation: PICKED_UP gap (issue #3 in docs/open-issues-local-delivery-2026-05.md).

import { PrismaClient } from "@prisma/client";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const TARGET_NAMES = [
  "80274", "80326", "80369", "80396", "80492", "80493", "80571",
  "80578", "80664", "80691", "80722", "80728", "80746", "80749",
];

const prisma = new PrismaClient();

const session = await prisma.session.findFirst({
  where: { shop: SHOP },
  orderBy: { expires: "desc" },
  select: { accessToken: true },
});
const TOKEN = session?.accessToken;
if (!TOKEN) {
  console.error("No accessToken for", SHOP);
  process.exit(3);
}

async function gql(query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const FULFILLED_SET = new Set(["FULFILLED", "PARTIALLY_FULFILLED"]);

const results = [];

async function resolveOrderGid(name) {
  const q = `#graphql
    query R($q: String!) {
      orders(first: 5, query: $q) {
        nodes { id name displayFulfillmentStatus tags }
      }
    }`;
  const j = await gql(q, { q: `name:${name}` });
  const nodes = j?.data?.orders?.nodes ?? [];
  // Exact match by name (Shopify name like "#80274" — strip leading #)
  return nodes.find((n) => (n.name ?? "").replace(/^#/, "") === name) ?? null;
}

async function inspectOrder(gid) {
  const q = `#graphql
    query I($id: ID!) {
      order(id: $id) {
        id name displayFulfillmentStatus tags
        fulfillments(first: 20) { id status displayStatus }
        fulfillmentOrders(first: 20) {
          nodes { id status assignedLocation { location { id } } }
        }
      }
    }`;
  const j = await gql(q, { id: gid });
  const o = j?.data?.order;
  if (!o) return null;
  // Flatten fulfillmentOrders.nodes → array for easier .filter()
  return {
    ...o,
    fulfillmentOrders: o.fulfillmentOrders?.nodes ?? [],
  };
}

async function readFulfillmentDisplayStatus(fid) {
  const j = await gql(
    `#graphql
      query R($id: ID!) { fulfillment(id: $id) { id displayStatus } }`,
    { id: fid },
  );
  return j?.data?.fulfillment?.displayStatus ?? null;
}

async function fireEvent(fid, status) {
  const j = await gql(
    `#graphql
      mutation E($f: ID!, $s: FulfillmentEventStatus!) {
        fulfillmentEventCreate(fulfillmentEvent: { fulfillmentId: $f, status: $s }) {
          fulfillmentEvent { id status }
          userErrors { field message }
        }
      }`,
    { f: fid, s: status },
  );
  const errs = j?.data?.fulfillmentEventCreate?.userErrors ?? [];
  if (errs.length) return { ok: false, reason: errs.map((e) => e.message).join("; ") };
  return { ok: true, reason: null };
}

async function deliverWithVerification(fid) {
  const first = await fireEvent(fid, "DELIVERED");
  if (!first.ok) return { ok: false, finalDisplayStatus: null, reason: first.reason };
  const s1 = await readFulfillmentDisplayStatus(fid);
  if (s1 === "DELIVERED") return { ok: true, finalDisplayStatus: s1, reason: null };
  // chain
  await fireEvent(fid, "IN_TRANSIT");
  await fireEvent(fid, "OUT_FOR_DELIVERY");
  await fireEvent(fid, "DELIVERED");
  const s2 = await readFulfillmentDisplayStatus(fid);
  return {
    ok: s2 === "DELIVERED",
    finalDisplayStatus: s2,
    reason: s2 === "DELIVERED" ? null : `displayStatus=${s2 ?? "null"} after chain`,
  };
}

async function fulfillNew(openFOs, trackingNumber) {
  const m = `#graphql
    mutation F($fulfillment: FulfillmentV2Input!) {
      fulfillmentCreateV2(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`;
  const j = await gql(m, {
    fulfillment: {
      lineItemsByFulfillmentOrder: openFOs.map((n) => ({ fulfillmentOrderId: n.id })),
      notifyCustomer: false,
      trackingInfo: trackingNumber ? { company: "Lalamove", number: trackingNumber } : undefined,
    },
  });
  const errs = j?.data?.fulfillmentCreateV2?.userErrors ?? [];
  const fid = j?.data?.fulfillmentCreateV2?.fulfillment?.id ?? null;
  if (errs.length) return { ok: false, fid: null, reason: errs.map((e) => e.message).join("; ") };
  if (!fid) return { ok: false, fid: null, reason: "no fulfillment returned" };
  return { ok: true, fid, reason: null };
}

async function archiveRouteTags(gid, requestedAt) {
  // 1. Get current tags
  const j = await gql(
    `#graphql
      query T($id: ID!) { order(id: $id) { tags } }`,
    { id: gid },
  );
  const tags = j?.data?.order?.tags ?? [];
  const routeTags = tags.filter((t) => /^ld_rota-\d+$/i.test(t));
  if (routeTags.length === 0) {
    // Already archived or never had one — non-fatal
    const archived = tags.filter((t) => /^ld_rota-\d+_\d{2}\.\d{2}\.\d{2}$/i.test(t));
    if (archived.length > 0) return { ok: true, archivedTo: archived.join(","), note: "already-archived" };
    return { ok: true, archivedTo: null, note: "no-rota-tag" };
  }
  // 2. Compute YY.MM.DD from requestedAt in BRT (UTC-3)
  const brt = new Date(requestedAt.getTime() - 3 * 60 * 60 * 1000);
  const yy = String(brt.getUTCFullYear()).slice(-2);
  const mm = String(brt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(brt.getUTCDate()).padStart(2, "0");
  const dateStr = `${yy}.${mm}.${dd}`;
  const archivedTags = routeTags.map((t) => `${t}_${dateStr}`);

  // 3. tagsRemove old
  const r1 = await gql(
    `#graphql
      mutation R($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) { userErrors { message } }
      }`,
    { id: gid, tags: routeTags },
  );
  const e1 = r1?.data?.tagsRemove?.userErrors ?? [];
  if (e1.length) return { ok: false, archivedTo: null, note: `tagsRemove: ${e1.map((e) => e.message).join("; ")}` };

  // 4. tagsAdd archived
  const r2 = await gql(
    `#graphql
      mutation A($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { message } }
      }`,
    { id: gid, tags: archivedTags },
  );
  const e2 = r2?.data?.tagsAdd?.userErrors ?? [];
  if (e2.length) return { ok: false, archivedTo: null, note: `tagsAdd: ${e2.map((e) => e.message).join("; ")}` };

  return { ok: true, archivedTo: archivedTags.join(","), note: null };
}

const jobsToFinalize = new Map(); // jobId → { allFulfilled: bool, anyFailed: bool }

for (const name of TARGET_NAMES) {
  const out = { name, before: "?", after: "?", archivedTo: "-", notes: "" };
  try {
    const found = await resolveOrderGid(name);
    if (!found) {
      out.notes = "FAILED — order not found in Shopify";
      results.push(out);
      continue;
    }
    const gid = found.id;
    out.before = found.displayFulfillmentStatus ?? "?";

    // Find the dispatch order map row (most recent)
    const map = await prisma.lalamoveDispatchOrderMap.findFirst({
      where: { shop: SHOP, shopifyOrderId: gid },
      orderBy: { createdAt: "desc" },
      select: { dispatchJobId: true, id: true },
    });
    if (!map) {
      out.notes = "FAILED — no LalamoveDispatchOrderMap row";
      results.push(out);
      continue;
    }
    const job = await prisma.lalamoveDispatchJob.findUnique({
      where: { id: map.dispatchJobId },
      select: { id: true, lalamoveOrderId: true, locationId: true, requestedAt: true, status: true, podBucket: true },
    });
    if (!job) {
      out.notes = "FAILED — DispatchJob missing";
      results.push(out);
      continue;
    }

    // Inspect
    const inspect = await inspectOrder(gid);
    if (!inspect) {
      out.notes = "FAILED — order inspect returned null";
      results.push(out);
      continue;
    }
    const currentStatus = inspect.displayFulfillmentStatus;
    let fulfillReason = null;
    let didFulfill = false;
    let didEvent = false;

    if (FULFILLED_SET.has(currentStatus)) {
      // Idempotent: already fulfilled. Try to promote any existing fulfillment to DELIVERED if not already.
      const alreadyDelivered = inspect.fulfillments.some((f) => f.displayStatus === "DELIVERED");
      if (!alreadyDelivered) {
        const usable = inspect.fulfillments.filter((f) => f.status && f.status !== "CANCELLED");
        for (const f of usable) {
          const v = await deliverWithVerification(f.id);
          if (v.ok) didEvent = true;
        }
      }
      out.after = "FULFILLED (idempotent)";
    } else {
      // Create fulfillment at the dispatch job's location
      const openFOs = inspect.fulfillmentOrders.filter(
        (n) => (n.status === "OPEN" || n.status === "IN_PROGRESS") && n.assignedLocation?.location?.id === job.locationId,
      );
      if (openFOs.length === 0) {
        // try ANY open FO if location mismatch (data drift fallback)
        const anyOpen = inspect.fulfillmentOrders.filter(
          (n) => n.status === "OPEN" || n.status === "IN_PROGRESS",
        );
        if (anyOpen.length === 0) {
          out.notes = "FAILED — no open fulfillment orders";
          results.push(out);
          continue;
        }
        out.notes = `(loc-mismatch: used ${anyOpen[0].assignedLocation?.location?.id ?? "?"} vs job ${job.locationId}) `;
        openFOs.push(...anyOpen);
      }
      const create = await fulfillNew(openFOs.map((n) => ({ id: n.id })), job.lalamoveOrderId);
      if (!create.ok) {
        out.notes += `FAILED — fulfillmentCreate: ${create.reason}`;
        results.push(out);
        continue;
      }
      didFulfill = true;
      const verify = await deliverWithVerification(create.fid);
      didEvent = verify.ok;
      fulfillReason = verify.reason;
      out.after = verify.finalDisplayStatus
        ? `FULFILLED (${verify.finalDisplayStatus})`
        : "FULFILLED (event unverified)";
    }

    // Archive ld_rota tag
    const archive = await archiveRouteTags(gid, job.requestedAt);
    if (archive.ok) {
      out.archivedTo = archive.archivedTo ?? (archive.note ?? "-");
    } else {
      out.notes += `tag-archive FAILED: ${archive.note}; `;
    }

    // Persist DB: stopOutcome=DELIVERED, currentStatus=delivered
    await prisma.lalamoveDispatchOrderMap.updateMany({
      where: { shop: SHOP, dispatchJobId: job.id, shopifyOrderId: gid },
      data: { stopOutcome: "DELIVERED", currentStatus: "delivered" },
    });

    // Track parent job for finalization
    const tally = jobsToFinalize.get(job.id) ?? { allOk: true, mapId: map.id };
    jobsToFinalize.set(job.id, tally);

    if (didFulfill && !didEvent) out.notes += `(event unverified: ${fulfillReason ?? "?"}) `;
    if (out.notes === "") out.notes = "ok";

    results.push(out);
  } catch (err) {
    out.notes = `FAILED — ${err instanceof Error ? err.message : String(err)}`;
    results.push(out);
  }
}

// Finalize parent jobs: for each touched job, check if ALL its order maps are now stopOutcome=DELIVERED
// If yes → set podBucket=clean, status=FULFILLED
const finalizeReport = [];
for (const jobId of jobsToFinalize.keys()) {
  const maps = await prisma.lalamoveDispatchOrderMap.findMany({
    where: { shop: SHOP, dispatchJobId: jobId },
    select: { stopOutcome: true },
  });
  const allDelivered = maps.length > 0 && maps.every((m) => m.stopOutcome === "DELIVERED");
  if (allDelivered) {
    await prisma.lalamoveDispatchJob.update({
      where: { id: jobId },
      data: { podBucket: "clean", status: "FULFILLED" },
    });
    finalizeReport.push(`job ${jobId.slice(-10)}: ALL ${maps.length} delivered → clean/FULFILLED`);
  } else {
    const outcomes = maps.map((m) => m.stopOutcome ?? "null").join(",");
    finalizeReport.push(`job ${jobId.slice(-10)}: mixed outcomes [${outcomes}] — left as-is`);
  }
}

// Print report
console.log("\n## Per-order results\n");
console.log("| Order# | Before | After | Tag archived to | Notes |");
console.log("|---|---|---|---|---|");
for (const r of results) {
  console.log(`| ${r.name} | ${r.before} | ${r.after} | ${r.archivedTo} | ${r.notes} |`);
}

const fulfilled = results.filter((r) => !r.notes.startsWith("FAILED") && !r.after.includes("idempotent")).length;
const idempotent = results.filter((r) => r.after.includes("idempotent")).length;
const failed = results.filter((r) => r.notes.startsWith("FAILED")).length;
console.log(`\nFulfilled: ${fulfilled} | Already fulfilled (idempotent): ${idempotent} | Failed: ${failed}`);

console.log("\n## Parent-job finalization\n");
for (const line of finalizeReport) console.log(`- ${line}`);

await prisma[String.fromCharCode(36) + "disconnect"]();
