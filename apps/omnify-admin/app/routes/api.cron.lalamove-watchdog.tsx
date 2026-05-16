import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  autoRetryDispatchJob,
  checkAndApplyEscalations,
} from "../services/lalamove-escalation.server";
import {
  cancelLalamoveOrder,
  getLalamoveOrderDetails,
} from "../services/lalamove.server";
import { getRuntimeCredentialsForShop } from "../services/lalamove-credentials.server";
import { removeRouteTags } from "../services/lalamove-sync.server";
import {
  reconcileRouteFulfillment,
  type DispatchJobForReconcile,
} from "../services/lalamove-reconcile.server";
import type { LalamoveConfig } from "../services/carrier/lalamove-adapter.server";

/**
 * Get current hour and minute in a given IANA timezone.
 */
function getLocalTime(tz: string): { hour: number; minute: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

/**
 * Check if current local time is past the retry cutoff for a location.
 */
async function isPastRetryCutoff(shop: string, locationId: string): Promise<boolean> {
  try {
    const configRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId } },
    });
    if (!configRow) return false;
    const config = configRow.data as LalamoveConfig;
    const cutoff = config.retryCutoffTime?.trim();
    if (!cutoff) return false; // no cutoff configured
    const tz = config.timezone?.trim() || "America/Sao_Paulo";
    const [cutoffH, cutoffM] = cutoff.split(":").map(Number);
    if (isNaN(cutoffH) || isNaN(cutoffM)) return false;
    const { hour, minute } = getLocalTime(tz);
    return hour > cutoffH || (hour === cutoffH && minute >= cutoffM);
  } catch {
    return false;
  }
}

const STALE_ON_GOING_MINUTES = 30;
const MAX_AUTO_RETRIES = 2;

/**
 * Cron endpoint for Lalamove delivery watchdog.
 * Schedule every 5 minutes:
 *   GET /api/cron/lalamove-watchdog
 *   Header: X-Cron-Secret: <CRON_SECRET>
 *
 * Two responsibilities:
 * 1. Detect ON_GOING orders stuck for 30+ min without PICKED_UP → cancel & reorder
 * 2. Run escalation checks for ASSIGNING_DRIVER jobs (priority fees + reorder at 60 min)
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret =
    request.headers.get("X-Cron-Secret") ??
    new URL(request.url).searchParams.get("secret");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.info("[lalamove-watchdog] cron triggered");
  // Narrowing cast for `cancelLalamoveOrder` / `autoRetryDispatchJob` calls:
  // typed Prisma returns nullable `market`/`routeId`/`lalamoveOrderId`, but
  // those helpers' signatures require non-null strings. The original
  // `prismaAny = prisma as any` was passing whatever Prisma returned,
  // including null fields. Preserve that runtime behavior with this inline
  // type — the function tolerates the same shape it was getting before.
  type DispatchJobForRetry = {
    id: string;
    routeId: string;
    locationId: string;
    market: string;
    lalamoveOrderId: string;
    retryCount?: number;
    shop: string;
  };
  const cutoff = new Date(Date.now() - STALE_ON_GOING_MINUTES * 60_000);

  // ── 1. Stale ON_GOING orders ─────────────────────────────────────────────
  const staleJobs = await prisma.lalamoveDispatchJob.findMany({
    where: {
      status: "ON_GOING",
      updatedAt: { lte: cutoff },
      retryCount: { lt: MAX_AUTO_RETRIES },
    },
  });

  console.info(`[lalamove-watchdog] found staleOnGoing=${staleJobs.length}`);

  const results: Array<{
    jobId: string;
    shop: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const job of staleJobs) {
    try {
      // ── Retry cutoff check ──────────────────────────────────────────────
      if (await isPastRetryCutoff(job.shop, job.locationId)) {
        console.info(`[lalamove-watchdog] CUTOFF job=${job.id} past retry cutoff — removing route tags`);
        try {
          const adminClient = await unauthenticated.admin(job.shop);
          const orderMaps = await prisma.lalamoveDispatchOrderMap.findMany({
            where: { shop: job.shop, dispatchJobId: job.id },
            select: { shopifyOrderId: true },
          });
          await Promise.all(
            orderMaps.map((m: { shopifyOrderId: string }) =>
              removeRouteTags(adminClient.admin, m.shopifyOrderId),
            ),
          );
        } catch (tagErr) {
          console.error(`[lalamove-watchdog] CUTOFF tag removal failed job=${job.id}`, tagErr);
        }
        await prisma.lalamoveDispatchJob.update({
          where: { id: job.id },
          data: { status: "EXPIRED_CUTOFF" },
        });
        results.push({ jobId: job.id, shop: job.shop, success: true, error: "Past retry cutoff" });
        continue;
      }

      // Verify no PICKED_UP event exists (guard against out-of-order webhooks)
      const pickedUpEvent = await prisma.lalamoveDispatchEvent.findFirst({
        where: {
          shop: job.shop,
          lalamoveOrderId: job.lalamoveOrderId,
          externalStatus: "PICKED_UP",
        },
      });
      if (pickedUpEvent) {
        console.info(
          `[lalamove-watchdog] SKIP job=${job.id} has PICKED_UP event`,
        );
        continue;
      }

      // Cancel the stale order
      const credentials = await getRuntimeCredentialsForShop(job.shop);
      if (!credentials) {
        console.warn(
          `[lalamove-watchdog] SKIP job=${job.id} no credentials shop=${job.shop}`,
        );
        results.push({
          jobId: job.id,
          shop: job.shop,
          success: false,
          error: "No credentials",
        });
        continue;
      }

      // Check live Lalamove status BEFORE attempting cancel. The previous
      // version treated `422 Cannot cancel order` as "fine, proceed with
      // reorder" — but 422 actually means the order is mid-delivery
      // (ON_GOING/PICKED_UP). That misinterpretation caused the duplicate-
      // dispatch incident on 2026-05-12. Now: fetch live status first and
      // branch correctly.
      let liveStatus: string | null = null;
      try {
        const details = await getLalamoveOrderDetails(
          job.market ?? "",
          job.lalamoveOrderId ?? "",
          credentials,
        );
        liveStatus = details?.status?.trim().toUpperCase() ?? null;
      } catch (fetchErr) {
        const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        if (fetchMsg.startsWith("404:")) {
          // Order is genuinely gone on Lalamove's side. Treat as CANCELED
          // and let the retry path place a fresh order.
          console.info(
            `[lalamove-watchdog] live-status 404 job=${job.id} — original gone, proceeding with retry`,
          );
          liveStatus = "GONE_404";
        } else {
          console.error(
            `[lalamove-watchdog] live-status fetch FAILED job=${job.id} error=${fetchMsg} — leaving job untouched for next tick`,
          );
          results.push({
            jobId: job.id,
            shop: job.shop,
            success: false,
            error: `Live status fetch failed: ${fetchMsg}`,
          });
          continue;
        }
      }

      const happyPath = ["ON_GOING", "PICKED_UP", "COMPLETED"];
      if (liveStatus && happyPath.includes(liveStatus)) {
        // Lalamove says the delivery is in progress / done. Sync DB to
        // match and skip the retry — placing a new order would duplicate.
        console.info(
          `[lalamove-watchdog] job=${job.id} liveStatus=${liveStatus} → sync DB and SKIP retry (delivery in progress)`,
        );
        await prisma.lalamoveDispatchJob
          .update({ where: { id: job.id }, data: { status: liveStatus } })
          .catch((err) =>
            console.error(
              `[lalamove-watchdog] DB sync FAILED job=${job.id}`,
              err,
            ),
          );
        results.push({
          jobId: job.id,
          shop: job.shop,
          success: true,
          error: `Synced to liveStatus=${liveStatus}, no retry needed`,
        });
        continue;
      }

      // Live status indicates failure path (CANCELED/REJECTED/EXPIRED)
      // OR 404 (order gone). Attempt cancel — best-effort — then retry.
      if (liveStatus !== "GONE_404") {
        try {
          await cancelLalamoveOrder(
            job.market ?? "",
            job.lalamoveOrderId ?? "",
            credentials,
          );
          console.info(
            `[lalamove-watchdog] cancelled stale order=${job.lalamoveOrderId} job=${job.id}`,
          );
        } catch (cancelErr) {
          const msg =
            cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
          // Already in a non-cancelable state (terminal) — proceed with retry.
          if (!msg.includes("422") && !msg.includes("404")) {
            console.error(
              `[lalamove-watchdog] cancel FAILED job=${job.id} error=${msg}`,
            );
            results.push({
              jobId: job.id,
              shop: job.shop,
              success: false,
              error: `Cancel failed: ${msg}`,
            });
            continue;
          }
        }
      }

      // Update status before retry. Safe now — we've confirmed via live-status
      // that the order is NOT in a happy-path state.
      await prisma.lalamoveDispatchJob.update({
        where: { id: job.id },
        data: { status: "CANCELED" },
      });

      const adminClient = await unauthenticated.admin(job.shop);
      const retryResult = await autoRetryDispatchJob(
        job as unknown as DispatchJobForRetry,
        job.shop,
        adminClient.admin,
      );
      results.push({
        jobId: job.id,
        shop: job.shop,
        success: retryResult.success,
        error: retryResult.error,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[lalamove-watchdog] job=${job.id} ERROR`, msg);
      results.push({ jobId: job.id, shop: job.shop, success: false, error: msg });
    }
  }

  // ── 2. Retry failed jobs (REJECTED/EXPIRED) that webhook missed ──────────
  // Safety net: if the webhook auto-retry didn't fire (e.g. missing dispatchJobId
  // in metadata), pick up recently failed jobs that still have retries left.
  //
  // CANCELED is intentionally EXCLUDED — per Lalamove's status semantics,
  // CANCELED means "user has canceled the order" (us via DELETE, or Lalamove
  // ops). Retrying an operator-initiated cancel was the loop driver in the
  // 2026-05-13 mass-cancel incident, where my force-DB CANCELED writes
  // exactly matched this query and the watchdog kept placing replacement
  // orders. REJECTED (drivers bailed) and EXPIRED (no supply) still warrant
  // a fresh attempt.
  const FAILED_RETRY_WINDOW_MINUTES = 30;
  const failedCutoff = new Date(Date.now() - FAILED_RETRY_WINDOW_MINUTES * 60_000);
  let failedRetryCount = 0;
  try {
    const failedJobs = await prisma.lalamoveDispatchJob.findMany({
      where: {
        status: { in: ["REJECTED", "EXPIRED"] },
        retryCount: { lt: MAX_AUTO_RETRIES },
        updatedAt: { gte: failedCutoff },
      },
    });

    console.info(`[lalamove-watchdog] found failedJobs=${failedJobs.length} for retry`);

    for (const job of failedJobs) {
      try {
        // ── Retry cutoff check ──────────────────────────────────────────
        if (await isPastRetryCutoff(job.shop, job.locationId)) {
          console.info(`[lalamove-watchdog] CUTOFF failed-retry job=${job.id} past retry cutoff — removing route tags`);
          try {
            const cutoffAdmin = await unauthenticated.admin(job.shop);
            const orderMaps = await prisma.lalamoveDispatchOrderMap.findMany({
              where: { shop: job.shop, dispatchJobId: job.id },
              select: { shopifyOrderId: true },
            });
            await Promise.all(
              orderMaps.map((m: { shopifyOrderId: string }) =>
                removeRouteTags(cutoffAdmin.admin, m.shopifyOrderId),
              ),
            );
          } catch (tagErr) {
            console.error(`[lalamove-watchdog] CUTOFF tag removal failed job=${job.id}`, tagErr);
          }
          await prisma.lalamoveDispatchJob.update({
            where: { id: job.id },
            data: { status: "EXPIRED_CUTOFF" },
          });
          results.push({ jobId: job.id, shop: job.shop, success: true, error: "Past retry cutoff" });
          continue;
        }

        const adminClient = await unauthenticated.admin(job.shop);
        const retryResult = await autoRetryDispatchJob(
          job as unknown as DispatchJobForRetry,
          job.shop,
          adminClient.admin,
        );
        failedRetryCount++;
        results.push({
          jobId: job.id,
          shop: job.shop,
          success: retryResult.success,
          error: retryResult.error,
        });
        console.info(
          `[lalamove-watchdog] failed-retry ${retryResult.success ? "OK" : "FAILED"} job=${job.id} shop=${job.shop} status=${job.status} error=${retryResult.error ?? "none"}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[lalamove-watchdog] failed-retry ERROR job=${job.id}`, msg);
        results.push({ jobId: job.id, shop: job.shop, success: false, error: msg });
      }
    }
  } catch (err) {
    console.error("[lalamove-watchdog] failed-retry query FAILED", err);
  }

  // ── 3. Escalation checks for ASSIGNING_DRIVER jobs ────────────────────────
  let escalationCount = 0;
  try {
    const assigningShops = await prisma.lalamoveDispatchJob.findMany({
      where: { status: "ASSIGNING_DRIVER" },
      select: { shop: true },
      distinct: ["shop"],
    });

    for (const { shop: assigningShop } of assigningShops) {
      try {
        const adminClient = await unauthenticated.admin(assigningShop);
        const escalationResults = await checkAndApplyEscalations(
          assigningShop,
          adminClient.admin,
        );
        escalationCount += escalationResults.length;
        console.info(
          `[lalamove-watchdog] escalation shop=${assigningShop} actions=${escalationResults.length}`,
        );
      } catch (err) {
        console.error(
          `[lalamove-watchdog] escalation FAILED shop=${assigningShop}`,
          err,
        );
      }
    }
  } catch (err) {
    console.error("[lalamove-watchdog] escalation query FAILED", err);
  }

  // ── 4. Mark-as-delivered reconcile sweep ─────────────────────────────────
  // Terminal-status dispatches that nobody has reconciled yet get processed
  // through pod-bucketing here. Covers the gap when:
  //   - the COMPLETED / CANCELED / REJECTED / EXPIRED webhook never fired
  //   - the webhook arrived before the dispatch row finished persisting
  //   - the operator never ran the CLI mark-delivered command
  //
  // Per-stop POD is the source of truth, not the Lalamove order-level status.
  // Routes flagged needs-review wait for human input — the cron does NOT
  // retry them automatically (would loop forever). Operators clear them via
  // the /api/control/clear-needs-review CLI intent after resolution.
  const RECONCILE_BATCH_LIMIT = 50;
  const RECONCILE_TERMINAL_STATUSES = [
    "COMPLETED", "completed",
    "CANCELED", "CANCELLED", "cancelled",
    "REJECTED", "rejected",
    "EXPIRED", "expired",
    "DELIVERED", "delivered",
    "FULFILLED",
  ];
  // Held jobs are retried on a 1h cadence so they can transition into either
  // a real bucket (POD finally arrived) or `needs-review` via the empty-
  // pod-after-retries rule (>24h with no POD). Without this, a job bucketed
  // `held` on its first sweep was orphaned forever — the query excluded it
  // from re-sweep but no other code path retries it.
  const HELD_RETRY_MIN_AGE_MS = 60 * 60 * 1000;
  const heldRetryCutoff = new Date(Date.now() - HELD_RETRY_MIN_AGE_MS);
  let reconcileAttempts = 0;
  let reconcileSucceeded = 0;
  let reconcileNeedsReview = 0;
  let reconcileHeld = 0;
  try {
    const reconcileCandidates = await prisma.lalamoveDispatchJob.findMany({
      where: {
        status: { in: RECONCILE_TERMINAL_STATUSES },
        OR: [
          { podBucket: null },
          {
            podBucket: "held",
            lastBucketingAt: { lt: heldRetryCutoff },
          },
        ],
      },
      take: RECONCILE_BATCH_LIMIT,
      // Newest first — operationally critical recent dispatches get
      // reconciled before the watchdog grinds through historical backlog.
      // The held-retry path keeps the long tail moving in the background.
      orderBy: { updatedAt: "desc" },
    });

    console.info(
      `[lalamove-watchdog:reconcile] candidates=${reconcileCandidates.length} batch=${RECONCILE_BATCH_LIMIT}`,
    );

    for (const job of reconcileCandidates) {
      reconcileAttempts += 1;
      try {
        const adminClient = await unauthenticated.admin(job.shop);
        const result = await reconcileRouteFulfillment({
          shop: job.shop,
          admin: adminClient.admin,
          job: {
            id: job.id,
            market: job.market ?? "",
            lalamoveOrderId: job.lalamoveOrderId,
            locationId: job.locationId,
            routeId: job.routeId,
            requestedAt: job.requestedAt,
            status: job.status,
            ordersData: job.ordersData,
            lastBucketingAt: job.lastBucketingAt ?? null,
          } as DispatchJobForReconcile,
          options: {
            cancelPendingLalamove: false,
            createShopifyFulfillment: true,
            archiveTags: true,
            notifyCustomer: false,
          },
        });
        if (result.bucket === "needs-review") reconcileNeedsReview += 1;
        else if (result.bucket === "held") reconcileHeld += 1;
        else if (result.ok) reconcileSucceeded += 1;
        console.info(
          `[lalamove-watchdog:reconcile] job=${job.id} shop=${job.shop} bucket=${result.bucket} fulfilled=${result.shopifyFulfilled} redelivered=${result.redeliveryTagged}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[lalamove-watchdog:reconcile] job=${job.id} shop=${job.shop} FAILED ${msg.slice(0, 200)}`,
        );
      }
    }
  } catch (err) {
    console.error("[lalamove-watchdog:reconcile] sweep query FAILED", err);
  }

  console.info(
    `[lalamove-watchdog] cron completed staleProcessed=${staleJobs.length} failedRetries=${failedRetryCount} escalationActions=${escalationCount} reconcileAttempts=${reconcileAttempts} reconcileOk=${reconcileSucceeded} reconcileNeedsReview=${reconcileNeedsReview} reconcileHeld=${reconcileHeld} totalResults=${results.length} successes=${results.filter((r) => r.success).length}`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      staleJobsFound: staleJobs.length,
      failedRetriesAttempted: failedRetryCount,
      processed: results.length,
      results,
      escalationActions: escalationCount,
      reconcileAttempts,
      reconcileSucceeded,
      reconcileNeedsReview,
      reconcileHeld,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
