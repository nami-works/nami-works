/**
 * lalamove-reconcile.server.ts
 *
 * Canonical "translate a completed Lalamove dispatch into Shopify fulfillment
 * events" pipeline. Used by:
 *   - POST /api/control/mark-delivered (operator-triggered)
 *   - /webhooks/lalamove on terminal-state webhooks (COMPLETED / CANCELED /
 *     REJECTED / EXPIRED — wired 2026-05-14 to close the gap where Lalamove
 *     deliveries weren't auto-reflected in Shopify without operator action)
 *
 * Per-stop POD outcome mapping (delegated to pod-bucketing.server.ts):
 *   DELIVERED / COMPLETED / SUCCESS / SIGNED → Shopify Fulfillment + DELIVERED event
 *   FAILED / FAIL / REJECTED                 → `ld_redelivery_pending` tag
 *   PENDING / IN_PROGRESS / ON_GOING         → route bucketed `held`, no writes
 *   no POD + no fallback                     → MISSING, route bucketed `held`
 *
 * Idempotent: fulfillOrderWithVerification short-circuits when Shopify already
 * shows displayStatus === DELIVERED, so concurrent webhook + operator flows
 * are safe.
 *
 * Lives in a .server.ts file (not in the route module) so Vite's react-router
 * code-splitter doesn't pull it into the client bundle — the route file would
 * otherwise leak `db.server` into the browser.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  cancelLalamoveOrder,
  getLalamoveOrderDetails,
} from "./lalamove.server";
import { getRuntimeCredentialsForShop } from "./lalamove-credentials.server";
import { renameRouteTagsToArchive } from "./lalamove-sync.server";
import {
  summarizeRoutePOD,
  bucketRouteForFulfillment,
  REDELIVERY_TAG,
  type LalamoveStop,
  type DispatchOrderSnapshot,
  type DispatchOrderMapRow,
  type RouteBucket,
  type NeedsReviewReason,
  type StopSummary,
} from "./pod-bucketing.server";

// ──────────────────────────────────────────────────────────────────────
// Internal types — Shopify GraphQL shapes for inspect/fulfill/event flows.
// ──────────────────────────────────────────────────────────────────────

/** Minimal shape we need from the Shopify admin client. */
type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

type InspectResult = {
  existingFulfillments: Array<{ id: string; status: string | null; displayStatus: string | null }>;
  openFulfillmentOrders: Array<{ id: string; status: string | null; locationId: string | null }>;
};

type UserError = { field?: unknown; message?: string };
type FulfillmentNode = { id?: string; status?: string | null; displayStatus?: string | null };
type FulfillmentOrderNode = {
  id?: string;
  status?: string | null;
  assignedLocation?: { location?: { id?: string | null } | null } | null;
};

export type FulfillResult = {
  ok: boolean;
  fulfillmentCreated: boolean;
  fulfillmentId: string | null;
  deliveredEventCreated: boolean;
  finalDisplayStatus: string | null;
  alreadyDelivered: boolean;
  reason: string | null;
};

// ──────────────────────────────────────────────────────────────────────
// Shopify helper primitives (inspect, fulfill, event chain, tag, persist)
// ──────────────────────────────────────────────────────────────────────

export async function inspectOrderForFulfillment(
  admin: ShopifyAdminClient,
  shopifyOrderId: string,
): Promise<InspectResult> {
  const inspect = await admin.graphql(
    `#graphql
      query ControlInspectOrder($id: ID!) {
        order(id: $id) {
          fulfillments(first: 20) { id status displayStatus }
          fulfillmentOrders(first: 20) {
            nodes {
              id status
              assignedLocation { location { id } }
            }
          }
        }
      }`,
    { variables: { id: shopifyOrderId } },
  );
  const json = (await inspect.json()) as {
    data?: {
      order?: {
        fulfillments?: FulfillmentNode[];
        fulfillmentOrders?: { nodes?: FulfillmentOrderNode[] };
      };
    };
  };
  const existingFulfillments = (json?.data?.order?.fulfillments ?? []).map((f) => ({
    id: f.id ?? "",
    status: f?.status ?? null,
    displayStatus: f?.displayStatus ?? null,
  }));
  const openFulfillmentOrders = (json?.data?.order?.fulfillmentOrders?.nodes ?? []).map((n) => ({
    id: n.id ?? "",
    status: n?.status ?? null,
    locationId: n?.assignedLocation?.location?.id ?? null,
  }));
  return { existingFulfillments, openFulfillmentOrders };
}

async function fireFulfillmentEvent(
  admin: ShopifyAdminClient,
  fulfillmentId: string,
  status: "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED",
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const resp = await admin.graphql(
      `#graphql
        mutation ControlFulfillmentEvent($fulfillmentId: ID!, $status: FulfillmentEventStatus!) {
          fulfillmentEventCreate(fulfillmentEvent: { fulfillmentId: $fulfillmentId, status: $status }) {
            fulfillmentEvent { id status }
            userErrors { field message }
          }
        }`,
      { variables: { fulfillmentId, status } },
    );
    const json = (await resp.json()) as {
      data?: { fulfillmentEventCreate?: { userErrors?: UserError[] } };
    };
    const errs = json?.data?.fulfillmentEventCreate?.userErrors ?? [];
    if (errs.length > 0) {
      return {
        ok: false,
        reason: errs.map((e) => e.message ?? "unknown").join("; "),
      };
    }
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function readFulfillmentDisplayStatus(
  admin: ShopifyAdminClient,
  fulfillmentId: string,
): Promise<string | null> {
  try {
    const resp = await admin.graphql(
      `#graphql
        query ControlReadFulfillment($id: ID!) {
          fulfillment(id: $id) { id status displayStatus }
        }`,
      { variables: { id: fulfillmentId } },
    );
    const json = (await resp.json()) as {
      data?: { fulfillment?: { displayStatus?: string | null } };
    };
    return json?.data?.fulfillment?.displayStatus ?? null;
  } catch {
    return null;
  }
}

/**
 * Fire a DELIVERED event, then re-query displayStatus. If Shopify hasn't
 * promoted the fulfillment to DELIVERED, run the explicit chain
 *   IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
 * once. Synchronous in the same request — only kicks in on the rare
 * degenerate path where the initial event didn't promote.
 */
async function deliverWithVerification(
  admin: ShopifyAdminClient,
  fulfillmentId: string,
): Promise<{ deliveredEvent: boolean; finalDisplayStatus: string | null; reason: string | null }> {
  const first = await fireFulfillmentEvent(admin, fulfillmentId, "DELIVERED");
  if (!first.ok) {
    return { deliveredEvent: false, finalDisplayStatus: null, reason: first.reason };
  }
  const status1 = await readFulfillmentDisplayStatus(admin, fulfillmentId);
  if (status1 === "DELIVERED") {
    return { deliveredEvent: true, finalDisplayStatus: status1, reason: null };
  }

  const inTransit = await fireFulfillmentEvent(admin, fulfillmentId, "IN_TRANSIT");
  const outForDelivery = await fireFulfillmentEvent(admin, fulfillmentId, "OUT_FOR_DELIVERY");
  const deliveredAgain = await fireFulfillmentEvent(admin, fulfillmentId, "DELIVERED");
  const status2 = await readFulfillmentDisplayStatus(admin, fulfillmentId);

  const chainOk = inTransit.ok && outForDelivery.ok && deliveredAgain.ok;
  return {
    deliveredEvent: chainOk,
    finalDisplayStatus: status2,
    reason:
      status2 === "DELIVERED"
        ? null
        : `displayStatus=${status2 ?? "null"} after retry chain`,
  };
}

export async function fulfillOrderWithVerification(args: {
  admin: ShopifyAdminClient;
  shopifyOrderId: string;
  locationGid: string;
  trackingNumber: string | null;
  notifyCustomer: boolean;
}): Promise<FulfillResult> {
  const { admin, shopifyOrderId, locationGid, trackingNumber, notifyCustomer } = args;
  const inspect = await inspectOrderForFulfillment(admin, shopifyOrderId);

  const alreadyDelivered = inspect.existingFulfillments.some(
    (f) => f.displayStatus === "DELIVERED",
  );
  if (alreadyDelivered) {
    return {
      ok: true,
      fulfillmentCreated: false,
      fulfillmentId: inspect.existingFulfillments.find((f) => f.displayStatus === "DELIVERED")?.id ?? null,
      deliveredEventCreated: false,
      finalDisplayStatus: "DELIVERED",
      alreadyDelivered: true,
      reason: null,
    };
  }

  const reusableFulfillments = inspect.existingFulfillments.filter(
    (f) => f.status && f.status !== "CANCELLED",
  );
  if (reusableFulfillments.length > 0) {
    let lastVerify: { deliveredEvent: boolean; finalDisplayStatus: string | null; reason: string | null } = {
      deliveredEvent: false,
      finalDisplayStatus: null,
      reason: "no fulfillments processed",
    };
    for (const f of reusableFulfillments) {
      lastVerify = await deliverWithVerification(admin, f.id);
    }
    const lastFulfillmentId = reusableFulfillments[reusableFulfillments.length - 1]!.id;
    return {
      ok: lastVerify.finalDisplayStatus === "DELIVERED",
      fulfillmentCreated: false,
      fulfillmentId: lastFulfillmentId,
      deliveredEventCreated: lastVerify.deliveredEvent,
      finalDisplayStatus: lastVerify.finalDisplayStatus,
      alreadyDelivered: false,
      reason: lastVerify.reason,
    };
  }

  const openFOs = inspect.openFulfillmentOrders.filter(
    (n) => (n.status === "OPEN" || n.status === "IN_PROGRESS") && n.locationId === locationGid,
  );
  if (openFOs.length === 0) {
    return {
      ok: false,
      fulfillmentCreated: false,
      fulfillmentId: null,
      deliveredEventCreated: false,
      finalDisplayStatus: null,
      alreadyDelivered: false,
      reason: "no fulfillments and no open fulfillment orders at this location",
    };
  }

  const createResp = await admin.graphql(
    `#graphql
      mutation ControlFulfillCreate($fulfillment: FulfillmentV2Input!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          fulfillment { id status }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        fulfillment: {
          lineItemsByFulfillmentOrder: openFOs.map((n) => ({ fulfillmentOrderId: n.id })),
          notifyCustomer,
          trackingInfo: trackingNumber ? { company: "Lalamove", number: trackingNumber } : undefined,
        },
      },
    },
  );
  const createJson = (await createResp.json()) as {
    data?: {
      fulfillmentCreateV2?: {
        fulfillment?: { id?: string | null };
        userErrors?: UserError[];
      };
    };
  };
  const userErrors = createJson?.data?.fulfillmentCreateV2?.userErrors ?? [];
  const fulfillmentId = createJson?.data?.fulfillmentCreateV2?.fulfillment?.id ?? null;
  if (userErrors.length > 0) {
    return {
      ok: false,
      fulfillmentCreated: false,
      fulfillmentId: null,
      deliveredEventCreated: false,
      finalDisplayStatus: null,
      alreadyDelivered: false,
      reason: userErrors.map((e) => e.message ?? "unknown").join("; "),
    };
  }
  if (!fulfillmentId) {
    return {
      ok: false,
      fulfillmentCreated: false,
      fulfillmentId: null,
      deliveredEventCreated: false,
      finalDisplayStatus: null,
      alreadyDelivered: false,
      reason: "no fulfillment returned",
    };
  }

  const verify = await deliverWithVerification(admin, fulfillmentId);
  return {
    ok: verify.finalDisplayStatus === "DELIVERED",
    fulfillmentCreated: true,
    fulfillmentId,
    deliveredEventCreated: verify.deliveredEvent,
    finalDisplayStatus: verify.finalDisplayStatus,
    alreadyDelivered: false,
    reason: verify.reason,
  };
}

export async function tagOrderForRedelivery(
  admin: ShopifyAdminClient,
  shopifyOrderId: string,
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const resp = await admin.graphql(
      `#graphql
        mutation ControlTagRedelivery($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            userErrors { field message }
          }
        }`,
      { variables: { id: shopifyOrderId, tags: [REDELIVERY_TAG] } },
    );
    const json = (await resp.json()) as {
      data?: { tagsAdd?: { userErrors?: UserError[] } };
    };
    const errs = json?.data?.tagsAdd?.userErrors ?? [];
    if (errs.length > 0) {
      return { ok: false, reason: errs.map((e) => e.message ?? "unknown").join("; ") };
    }
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function persistBucketingResults(args: {
  shop: string;
  jobId: string;
  bucket: RouteBucket;
  partialDelivery: boolean;
  summary: StopSummary[];
  needsReviewReason?: NeedsReviewReason | null;
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma untyped models
  const prismaAny = prisma as any;
  try {
    await prismaAny.lalamoveDispatchJob.update({
      where: { id: args.jobId },
      data: {
        podBucket: args.bucket,
        partialDelivery: args.partialDelivery,
        lastBucketingAt: new Date(),
        // Set on needs-review buckets; cleared otherwise so re-bucketed routes
        // don't carry stale reason text after operator resolution.
        needsReviewReason:
          args.bucket === "needs-review" ? (args.needsReviewReason ?? null) : null,
      },
    });
    for (const stop of args.summary) {
      if (!stop.orderId) continue;
      await prismaAny.lalamoveDispatchOrderMap.updateMany({
        where: { shop: args.shop, dispatchJobId: args.jobId, shopifyOrderId: stop.orderId },
        data: {
          stopOutcome: stop.outcome,
          stopFailureReason: stop.failureReason,
        },
      });
    }
  } catch (err) {
    console.warn(`[reconcile] persist bucketing FAILED job=${args.jobId}`, err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// reconcileRouteFulfillment — the shared post-dispatch reconciliation flow.
// ──────────────────────────────────────────────────────────────────────

export type ReconcileRouteOptions = {
  /** Default false. Skip the cancel step when the caller already knows the
   *  Lalamove order is in a terminal state (webhook calls on COMPLETED etc.). */
  cancelPendingLalamove?: boolean;
  /** Default true. The Phase B flows pass false. */
  createShopifyFulfillment?: boolean;
  /** Default true. */
  archiveTags?: boolean;
  /** Default false. Customers don't get Shopify-generated "delivered" email. */
  notifyCustomer?: boolean;
};

export type ReconcileRouteResult = {
  ok: boolean;
  status?: "held" | "manual-review" | "needs-review";
  bucket: RouteBucket;
  partialDelivery: boolean;
  routeId: string;
  jobId: string;
  lalamoveOrderId: string | null;
  ordersDelivered: number;
  ordersFlaggedForRedelivery: string[];
  tagsArchivedOn: string | null;
  archiveFailures: number;
  lalamove: string;
  shopifyFulfilled: number;
  deliveredEventsCreated: number;
  redeliveryTagged: number;
  redeliveryTagFailures: Array<{ orderId: string; reason: string }>;
  fulfillmentFailures: Array<{ orderId: string; reason: string }>;
  summary: StopSummary[];
  unmatchedStopIndexes: number[];
  retryAfter?: string;
  /** Present when bucket === "needs-review". */
  needsReviewReason?: NeedsReviewReason;
  needsReviewStopIndexes?: number[];
};

export type DispatchJobForReconcile = {
  id: string;
  market: string;
  lalamoveOrderId: string | null;
  locationId: string;
  routeId: string;
  requestedAt: Date;
  status: string;
  ordersData: unknown;
  /** Optional. When present (passed by the watchdog cron sweep), drives the
   *  empty-pod-after-retries detection rule. */
  lastBucketingAt?: Date | null;
};

export async function reconcileRouteFulfillment(args: {
  shop: string;
  job: DispatchJobForReconcile;
  admin: AdminApiContext;
  options?: ReconcileRouteOptions;
}): Promise<ReconcileRouteResult> {
  const { shop, job, admin } = args;
  const opts = args.options ?? {};
  const cancelPendingLalamove = opts.cancelPendingLalamove === true;
  const createShopifyFulfillment = opts.createShopifyFulfillment !== false;
  const archiveTags = opts.archiveTags !== false;
  const notifyCustomer = opts.notifyCustomer === true;
  const routeId = job.routeId;
  const locationGid = job.locationId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma untyped models
  const prismaAny = prisma as any;

  const terminalStatuses = new Set([
    "COMPLETED", "completed",
    "CANCELED", "CANCELLED", "cancelled",
    "REJECTED", "rejected",
    "EXPIRED", "expired",
    "FULFILLED", "delivered", "DELIVERED",
  ]);
  let lalamoveCancelNote = "skipped";
  if (cancelPendingLalamove && !terminalStatuses.has(String(job.status))) {
    try {
      const credentials = await getRuntimeCredentialsForShop(shop);
      if (credentials && job.lalamoveOrderId) {
        await cancelLalamoveOrder(job.market, job.lalamoveOrderId, credentials);
        lalamoveCancelNote = "cancelled-at-lalamove";
      } else {
        lalamoveCancelNote = "no-credentials-skipped";
      }
    } catch (cancelErr) {
      const msg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
      if (msg.includes("422") || msg.startsWith("404:")) {
        lalamoveCancelNote = "already-terminal-at-lalamove";
      } else {
        lalamoveCancelNote = `cancel-error: ${msg.slice(0, 120)}`;
        console.warn(`[reconcile] cancel non-fatal`, msg);
      }
    }
  }

  const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
    where: { shop, dispatchJobId: job.id },
    select: { shopifyOrderId: true, currentStatus: true, failureReason: true },
  });
  const orderIds = (orderMaps as Array<{ shopifyOrderId: string }>).map((m) => m.shopifyOrderId);
  const ordersData: DispatchOrderSnapshot[] = Array.isArray(job.ordersData)
    ? (job.ordersData as DispatchOrderSnapshot[])
    : [];

  let lalamoveStops: LalamoveStop[] = [];
  let lalamoveOrderStatus: string | null = null;
  try {
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (credentials && job.lalamoveOrderId) {
      const details = await getLalamoveOrderDetails(job.market, job.lalamoveOrderId, credentials);
      lalamoveStops = (details.stops ?? []) as LalamoveStop[];
      lalamoveOrderStatus = (details.status ?? null) as string | null;
    }
  } catch (err) {
    console.warn(
      `[reconcile] stop fetch failed lalamove=${job.lalamoveOrderId ?? "?"}`,
      err instanceof Error ? err.message : String(err),
    );
  }

  const summary = summarizeRoutePOD(
    lalamoveStops,
    ordersData,
    orderMaps as DispatchOrderMapRow[],
  );
  const decision = bucketRouteForFulfillment(summary, lalamoveStops, {
    orderLevelStatus: lalamoveOrderStatus ?? job.status,
    lastBucketingAt: job.lastBucketingAt ?? null,
    expectedDeliveryStops: orderMaps.length,
  });

  console.info(
    `[reconcile] bucket=${decision.bucket} shop=${shop} route=${routeId} stops=${lalamoveStops.length} fulfill=${decision.ordersToFulfill.length} redeliver=${decision.ordersToRedeliver.length} unmatched=${decision.unmatchedStopIndexes.length}${decision.needsReviewReason ? ` reason=${decision.needsReviewReason}` : ""}`,
  );

  const isoBrt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(job.requestedAt));
  const [yy, mm, dd] = isoBrt.split("-");
  const dateStr = `${yy!.slice(-2)}.${mm}.${dd}`;

  if (decision.bucket === "held") {
    await persistBucketingResults({
      shop,
      jobId: job.id,
      bucket: decision.bucket,
      partialDelivery: false,
      summary,
    });
    console.info(
      `[reconcile] HOLD shop=${shop} route=${routeId} pending=${
        summary.filter((s) => !s.isPickup && s.outcome === "PENDING").length
      } unmatched=${decision.unmatchedStopIndexes.length}`,
    );
    return {
      ok: false,
      status: "held",
      bucket: decision.bucket,
      partialDelivery: false,
      routeId,
      jobId: job.id,
      lalamoveOrderId: job.lalamoveOrderId,
      ordersDelivered: 0,
      ordersFlaggedForRedelivery: [],
      tagsArchivedOn: null,
      archiveFailures: 0,
      lalamove: lalamoveCancelNote,
      shopifyFulfilled: 0,
      deliveredEventsCreated: 0,
      redeliveryTagged: 0,
      redeliveryTagFailures: [],
      fulfillmentFailures: [],
      summary,
      unmatchedStopIndexes: decision.unmatchedStopIndexes,
      retryAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  if (decision.bucket === "needs-review") {
    await persistBucketingResults({
      shop,
      jobId: job.id,
      bucket: decision.bucket,
      partialDelivery: false,
      summary,
      needsReviewReason: decision.needsReviewReason ?? null,
    });
    console.info(
      `[reconcile] NEEDS-REVIEW shop=${shop} route=${routeId} reason=${decision.needsReviewReason ?? "?"} suspect=${(decision.needsReviewStopIndexes ?? []).join(",")}`,
    );
    return {
      ok: false,
      status: "needs-review",
      bucket: decision.bucket,
      partialDelivery: false,
      routeId,
      jobId: job.id,
      lalamoveOrderId: job.lalamoveOrderId,
      ordersDelivered: 0,
      ordersFlaggedForRedelivery: [],
      tagsArchivedOn: null,
      archiveFailures: 0,
      lalamove: lalamoveCancelNote,
      shopifyFulfilled: 0,
      deliveredEventsCreated: 0,
      redeliveryTagged: 0,
      redeliveryTagFailures: [],
      fulfillmentFailures: [],
      summary,
      unmatchedStopIndexes: decision.unmatchedStopIndexes,
      needsReviewReason: decision.needsReviewReason,
      needsReviewStopIndexes: decision.needsReviewStopIndexes,
    };
  }

  if (decision.bucket === "skip") {
    await persistBucketingResults({
      shop,
      jobId: job.id,
      bucket: decision.bucket,
      partialDelivery: false,
      summary,
    });
    console.info(`[reconcile] SKIP shop=${shop} route=${routeId} reason=no-delivered-stops`);
    return {
      ok: false,
      status: "manual-review",
      bucket: decision.bucket,
      partialDelivery: false,
      routeId,
      jobId: job.id,
      lalamoveOrderId: job.lalamoveOrderId,
      ordersDelivered: 0,
      ordersFlaggedForRedelivery: decision.ordersToRedeliver,
      tagsArchivedOn: null,
      archiveFailures: 0,
      lalamove: lalamoveCancelNote,
      shopifyFulfilled: 0,
      deliveredEventsCreated: 0,
      redeliveryTagged: 0,
      redeliveryTagFailures: [],
      fulfillmentFailures: [],
      summary,
      unmatchedStopIndexes: decision.unmatchedStopIndexes,
    };
  }

  let archived = 0;
  let archiveFailures = 0;
  if (archiveTags) {
    const archiveResults = await Promise.allSettled(
      orderIds.map((id) => renameRouteTagsToArchive(admin, id, dateStr)),
    );
    archived = archiveResults.filter((r) => r.status === "fulfilled").length;
    archiveFailures = archiveResults.length - archived;
    if (archiveFailures > 0) {
      console.warn(`[reconcile] ${archiveFailures} tag-archive failures (non-fatal)`);
    }
  }

  await prismaAny.lalamoveDispatchJob.update({
    where: { id: job.id },
    data: { status: "FULFILLED" },
  });
  await prismaAny.lalamoveDispatchOrderMap.updateMany({
    where: { shop, dispatchJobId: job.id },
    data: { currentStatus: "delivered" },
  });

  let shopifyFulfilled = 0;
  let deliveredEventsCreated = 0;
  const fulfillmentFailures: Array<{ orderId: string; reason: string }> = [];
  const trackingNumber = (job.lalamoveOrderId ?? null) as string | null;

  if (createShopifyFulfillment) {
    for (const shopifyOrderId of decision.ordersToFulfill) {
      try {
        const result = await fulfillOrderWithVerification({
          admin,
          shopifyOrderId,
          locationGid,
          trackingNumber,
          notifyCustomer,
        });
        if (result.deliveredEventCreated) deliveredEventsCreated += 1;
        if (result.ok) {
          shopifyFulfilled += 1;
        } else {
          fulfillmentFailures.push({
            orderId: shopifyOrderId,
            reason: result.reason ?? `displayStatus=${result.finalDisplayStatus ?? "null"}`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fulfillmentFailures.push({ orderId: shopifyOrderId, reason: msg.slice(0, 150) });
        console.warn(`[reconcile] order-loop exception order=${shopifyOrderId}`, msg);
      }
    }
  }

  let redeliveryTagged = 0;
  const redeliveryTagFailures: Array<{ orderId: string; reason: string }> = [];
  for (const shopifyOrderId of decision.ordersToRedeliver) {
    const tagResult = await tagOrderForRedelivery(admin, shopifyOrderId);
    if (tagResult.ok) {
      redeliveryTagged += 1;
    } else {
      redeliveryTagFailures.push({
        orderId: shopifyOrderId,
        reason: tagResult.reason ?? "tag failed",
      });
    }
  }

  const partialDelivery = shopifyFulfilled !== deliveredEventsCreated;
  await persistBucketingResults({
    shop,
    jobId: job.id,
    bucket: decision.bucket,
    partialDelivery,
    summary,
  });

  console.info(
    `[reconcile] OK shop=${shop} route=${routeId} job=${job.id} bucket=${decision.bucket} orders=${orderIds.length} archived=${archived} lalamove=${lalamoveCancelNote} shopifyFulfilled=${shopifyFulfilled}/${decision.ordersToFulfill.length} delivered=${deliveredEventsCreated} redeliveryTagged=${redeliveryTagged} partial=${partialDelivery}`,
  );

  return {
    ok: true,
    bucket: decision.bucket,
    partialDelivery,
    routeId,
    jobId: job.id,
    lalamoveOrderId: job.lalamoveOrderId,
    ordersDelivered: decision.ordersToFulfill.length,
    ordersFlaggedForRedelivery: decision.ordersToRedeliver,
    tagsArchivedOn: `${dateStr} (YY.MM.DD)`,
    archiveFailures,
    lalamove: lalamoveCancelNote,
    shopifyFulfilled,
    deliveredEventsCreated,
    redeliveryTagged,
    redeliveryTagFailures,
    fulfillmentFailures,
    summary,
    unmatchedStopIndexes: decision.unmatchedStopIndexes,
  };
}
