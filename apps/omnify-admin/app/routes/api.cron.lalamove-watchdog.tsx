import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  autoRetryDispatchJob,
  checkAndApplyEscalations,
} from "../services/lalamove-escalation.server";
import { cancelLalamoveOrder } from "../services/lalamove.server";
import { getRuntimeCredentialsForShop } from "../services/lalamove-credentials.server";
import { removeRouteTags } from "../services/lalamove-sync.server";
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
    const configRow = await (prisma as any).lalamoveLocationConfig.findUnique({
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
  const prismaAny = prisma as any;
  const cutoff = new Date(Date.now() - STALE_ON_GOING_MINUTES * 60_000);

  // ── 1. Stale ON_GOING orders ─────────────────────────────────────────────
  const staleJobs = await prismaAny.lalamoveDispatchJob.findMany({
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
          const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
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
        await prismaAny.lalamoveDispatchJob.update({
          where: { id: job.id },
          data: { status: "EXPIRED_CUTOFF" },
        });
        results.push({ jobId: job.id, shop: job.shop, success: true, error: "Past retry cutoff" });
        continue;
      }

      // Verify no PICKED_UP event exists (guard against out-of-order webhooks)
      const pickedUpEvent = await prismaAny.lalamoveDispatchEvent.findFirst({
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

      try {
        await cancelLalamoveOrder(
          job.market,
          job.lalamoveOrderId,
          credentials,
        );
        console.info(
          `[lalamove-watchdog] cancelled stale order=${job.lalamoveOrderId} job=${job.id}`,
        );
      } catch (cancelErr) {
        const msg =
          cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
        // If already cancelled/completed, proceed with reorder
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

      // Update status before retry
      await prismaAny.lalamoveDispatchJob.update({
        where: { id: job.id },
        data: { status: "CANCELED" },
      });

      const adminClient = await unauthenticated.admin(job.shop);
      const retryResult = await autoRetryDispatchJob(
        job,
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

  // ── 2. Retry failed jobs (CANCELED/REJECTED/EXPIRED) that webhook missed ──
  // Safety net: if the webhook auto-retry didn't fire (e.g. missing dispatchJobId
  // in metadata), pick up recently failed jobs that still have retries left.
  const FAILED_RETRY_WINDOW_MINUTES = 30;
  const failedCutoff = new Date(Date.now() - FAILED_RETRY_WINDOW_MINUTES * 60_000);
  let failedRetryCount = 0;
  try {
    const failedJobs = await prismaAny.lalamoveDispatchJob.findMany({
      where: {
        status: { in: ["CANCELED", "REJECTED", "EXPIRED"] },
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
            const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
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
          await prismaAny.lalamoveDispatchJob.update({
            where: { id: job.id },
            data: { status: "EXPIRED_CUTOFF" },
          });
          results.push({ jobId: job.id, shop: job.shop, success: true, error: "Past retry cutoff" });
          continue;
        }

        const adminClient = await unauthenticated.admin(job.shop);
        const retryResult = await autoRetryDispatchJob(
          job,
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
    const assigningShops = await prismaAny.lalamoveDispatchJob.findMany({
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

  console.info(
    `[lalamove-watchdog] cron completed staleProcessed=${staleJobs.length} failedRetries=${failedRetryCount} escalationActions=${escalationCount} totalResults=${results.length} successes=${results.filter((r) => r.success).length}`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      staleJobsFound: staleJobs.length,
      failedRetriesAttempted: failedRetryCount,
      processed: results.length,
      results,
      escalationActions: escalationCount,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
