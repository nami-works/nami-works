import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { runSalesGoalsSync } from "../sales-goals/sync.server";
import {
  reconcileCampaignMatches,
  sweepCampaignStatuses,
} from "../campaign-goals/storage.server";

/**
 * Hourly reconciliation cron for Retail Goals (formerly Sales Goals).
 *
 * Auth: `X-Cron-Secret` header (preferred) or `?secret=` query must match CRON_SECRET.
 *
 * Modes:
 * - default (hourly) — iterate shops in SalesGoalsSyncMeta, run an incremental
 *   2-month sync to catch any webhook drops and refresh monthly aggregates.
 * - ?admin-backfill-discounts=1 — one-shot mode that runs a full 13-month sync
 *   per shop. Used once after the discount-field schema migration to populate
 *   `SalesOrder.discountAmount` + `SalesOrderMonthly.totalDiscounts`.
 *
 * Webhooks remain the real-time path; this cron exists to bullet-proof the
 * dashboard against delivery gaps and to recompute aggregates.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret =
    request.headers.get("X-Cron-Secret") ?? url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const isBackfill = url.searchParams.get("admin-backfill-discounts") === "1";
  const monthsBack = isBackfill ? 13 : 2;
  const mode = isBackfill ? "discount-backfill" : "hourly";

  const shops = await prisma.salesGoalsSyncMeta.findMany({
    where: { status: { not: "syncing" } },
    select: { shop: true },
  });

  console.info(
    `[retail-goals-cron] START mode=${mode} shops=${shops.length} monthsBack=${monthsBack}`,
  );

  let processed = 0;
  let skipped = 0;
  const errors: Array<{ shop: string; error: string }> = [];
  const phaseStart = Date.now();

  let campaignsReconciled = 0;

  for (const { shop } of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      await runSalesGoalsSync(admin, shop, monthsBack);
      processed += 1;
      console.info(
        `[retail-goals-cron] OK shop=${shop} mode=${mode} monthsBack=${monthsBack}`,
      );

      // Secondary phase: campaign-goals reconciliation.
      // Promote drafts / end expired campaigns, then reconcile every active campaign.
      try {
        await sweepCampaignStatuses(shop);
        const active = await prisma.campaignGoal.findMany({
          where: { shop, status: "active" },
          select: { id: true },
        });
        for (const c of active) {
          await reconcileCampaignMatches(admin, shop, c.id);
          campaignsReconciled += 1;
        }
      } catch (err) {
        console.warn(
          `[retail-goals-cron] campaign reconcile SKIP shop=${shop}`,
          err,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        /no.*session|session.*not.*found|offline.*session/i.test(message) ||
        /Unauthorized/i.test(message)
      ) {
        skipped += 1;
        console.warn(
          `[retail-goals-cron] SKIP shop=${shop} reason=no-session`,
        );
      } else {
        errors.push({ shop, error: message });
        console.error(
          `[retail-goals-cron] FAILED shop=${shop} mode=${mode}`,
          err,
        );
      }
    }
  }

  const elapsed = ((Date.now() - phaseStart) / 1000).toFixed(1);
  console.info(
    `[retail-goals-cron] DONE mode=${mode} processed=${processed} skipped=${skipped} errors=${errors.length} campaignsReconciled=${campaignsReconciled} elapsed=${elapsed}s`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      mode,
      processed,
      skipped,
      errors,
      campaignsReconciled,
      totalShops: shops.length,
      elapsedSeconds: Number(elapsed),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
