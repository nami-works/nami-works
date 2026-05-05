/**
 * Hourly Affiliates reconciliation cron.
 *
 * For each shop in `AffiliateSyncMeta`:
 *   1. Incremental pagination of orders with `updated_at:>=T-2mo` — catches
 *      any webhook drops or manual Shopify admin edits since the last run.
 *   2. Full `AffiliateMonthly` rebuild (cheap raw-SQL INSERT … SELECT).
 *   3. Refresh the `AttributionQueueSnapshot` row so the Attribution tab
 *      renders instantly on page load.
 *   4. Log-only notifier for forgotten claims (>7 days, unconfirmed).
 *
 * Auth: `X-Cron-Secret` header or `?secret=` query, matched against
 * CRON_SECRET env. Same pattern as api.cron.retail-goals-sync.tsx.
 *
 * Schedule: EventBridge `cron(30 * * * ? *)` (runs at :30 of every hour,
 * offset from retail-goals at :00 and shop-ingest at :15 to spread Shopify
 * load and DB write pressure).
 */

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { reconcileAffiliatesIncremental } from "../affiliates/sync.server";
import { rebuildAffiliateMonthly } from "../affiliates/analytics-queries.server";
import {
  buildAttributionQueueSnapshot,
  listForgottenClaims,
} from "../affiliates/attribution.server";
import {
  listAffiliatePrograms,
  syncProgramCodes,
} from "../affiliates/programs.server";
import { invalidateAffiliateCodesCache } from "../affiliates/webhook-ingest.server";

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

  const phaseStart = Date.now();

  // Seed the shop list from AffiliateSyncMeta (skip shops mid-backfill).
  // Also accept shops that have profiles but no sync meta yet — covers
  // first-run shops that haven't clicked the manual sync button.
  const metaShops = await prisma.affiliateSyncMeta.findMany({
    where: { status: { not: "running" } },
    select: { shop: true },
  });
  const profileShops = await prisma.affiliateProfile.findMany({
    select: { shop: true },
    distinct: ["shop"],
  });
  const shopSet = new Set<string>([
    ...metaShops.map((r) => r.shop),
    ...profileShops.map((r) => r.shop),
  ]);
  const shops = Array.from(shopSet);

  console.info(
    `[affiliates-cron] START shops=${shops.length}`,
  );

  let processed = 0;
  let skipped = 0;
  const errors: Array<{ shop: string; phase: string; error: string }> = [];
  const summary: Array<{
    shop: string;
    totalOrders?: number;
    affiliateOrders?: number;
    organicOrders?: number;
    touchedMonths?: number;
    snapshotPending?: number;
    snapshotClaimed?: number;
    snapshotUnknown?: number;
    forgottenClaims?: number;
    programsTotal?: number;
    programsOk?: number;
    programsFailed?: number;
    programsCodesSynced?: number;
  }> = [];

  for (const shop of shops) {
    let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
    try {
      ({ admin } = await unauthenticated.admin(shop));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        /no.*session|session.*not.*found|offline.*session|Unauthorized/i.test(
          message,
        )
      ) {
        skipped += 1;
        console.warn(
          `[affiliates-cron] SKIP shop=${shop} reason=no-session`,
        );
      } else {
        errors.push({ shop, phase: "auth", error: message });
        console.error(`[affiliates-cron] auth FAILED shop=${shop}`, err);
      }
      continue;
    }

    const shopRow: (typeof summary)[number] = { shop };

    // 1. Incremental reconcile
    try {
      const result = await reconcileAffiliatesIncremental(admin, shop, {
        monthsBack: 2,
      });
      shopRow.totalOrders = result.totalOrders;
      shopRow.affiliateOrders = result.affiliateOrders;
      shopRow.organicOrders = result.organicOrders;
      shopRow.touchedMonths = result.touchedMonths.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ shop, phase: "reconcile", error: message });
      console.error(`[affiliates-cron] reconcile FAILED shop=${shop}`, err);
    }

    // 1b. Sync registered AffiliatePrograms (Shopify discount → AffiliateCode).
    // Per-program errors don't fail the whole shop — codes from a single
    // misconfigured program shouldn't block the rest of the pipeline.
    try {
      const programs = await listAffiliatePrograms(shop);
      let pOk = 0;
      let pFailed = 0;
      let pTotalCodes = 0;
      for (const p of programs) {
        try {
          const result = await syncProgramCodes(admin, shop, p.id);
          if (result.ok) {
            pOk += 1;
            pTotalCodes += result.codesCount;
          } else {
            pFailed += 1;
          }
        } catch (err) {
          pFailed += 1;
          console.error(
            `[affiliates-cron] program-sync FAILED shop=${shop} programId=${p.id}`,
            err,
          );
        }
      }
      shopRow.programsTotal = programs.length;
      shopRow.programsOk = pOk;
      shopRow.programsFailed = pFailed;
      shopRow.programsCodesSynced = pTotalCodes;
      if (programs.length > 0) {
        // Refresh the codes cache so any new codes from this run are matched
        // by webhooks immediately.
        invalidateAffiliateCodesCache(shop);
      }
      console.info(
        `[affiliates-cron] programs OK shop=${shop} total=${programs.length} ok=${pOk} failed=${pFailed} codes=${pTotalCodes}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ shop, phase: "programs", error: message });
      console.error(
        `[affiliates-cron] programs FAILED shop=${shop}`,
        err,
      );
    }

    // 2. Rebuild AffiliateMonthly (cheap even if reconcile failed)
    try {
      await rebuildAffiliateMonthly(shop);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ shop, phase: "rebuildMonthly", error: message });
      console.error(
        `[affiliates-cron] rebuildMonthly FAILED shop=${shop}`,
        err,
      );
    }

    // 3. Refresh AttributionQueueSnapshot (reads live Shopify once per run)
    try {
      const snap = await buildAttributionQueueSnapshot(admin, shop);
      await prisma.attributionQueueSnapshot.upsert({
        where: { shop },
        create: {
          shop,
          fetchedAt: new Date(snap.fetchedAt),
          fetchedVia: "cron",
          lookbackDays: snap.lookbackDays,
          scannedCount: snap.scannedCount,
          pendingCount: snap.stats.pending,
          claimedCount: snap.stats.claimed,
          unknownCount: snap.stats.unknown,
          rowsJson: snap.rows as unknown as object,
          statsJson: {
            sinceDate: snap.sinceDate,
            matchedCount: snap.matchedCount,
            stats: snap.stats,
          } as unknown as object,
        },
        update: {
          fetchedAt: new Date(snap.fetchedAt),
          fetchedVia: "cron",
          lookbackDays: snap.lookbackDays,
          scannedCount: snap.scannedCount,
          pendingCount: snap.stats.pending,
          claimedCount: snap.stats.claimed,
          unknownCount: snap.stats.unknown,
          rowsJson: snap.rows as unknown as object,
          statsJson: {
            sinceDate: snap.sinceDate,
            matchedCount: snap.matchedCount,
            stats: snap.stats,
          } as unknown as object,
        },
      });
      shopRow.snapshotPending = snap.stats.pending;
      shopRow.snapshotClaimed = snap.stats.claimed;
      shopRow.snapshotUnknown = snap.stats.unknown;
      console.info(
        `[affiliates-cron] snapshot OK shop=${shop} pending=${snap.stats.pending} claimed=${snap.stats.claimed} unknown=${snap.stats.unknown}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ shop, phase: "snapshot", error: message });
      console.warn(
        `[affiliates-cron] snapshot SKIP shop=${shop} reason=${message}`,
      );
    }

    // 4. Forgotten-claims notifier (log only)
    try {
      const forgotten = await listForgottenClaims(shop, 7);
      shopRow.forgottenClaims = forgotten.length;
      if (forgotten.length > 0) {
        console.warn(
          `[affiliates:forgotten] shop=${shop} count=${forgotten.length} oldest=${forgotten[0]?.orderName ?? "?"} daysSince=${forgotten[0]?.daysSince ?? "?"}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[affiliates-cron] forgotten SKIP shop=${shop} reason=${message}`,
      );
    }

    // 5. Clear stale "failed" sync meta when this run had no errors for the
    // shop. This kills the lingering "Previous sync had issues: Unknown sync
    // error" banner that used to persist across days even after the cron
    // recovered. Only clears when no per-phase errors were recorded for THIS
    // shop in THIS run.
    const shopErrors = errors.filter((e) => e.shop === shop);
    if (shopErrors.length === 0) {
      try {
        await prisma.affiliateSyncMeta.updateMany({
          where: { shop, status: "failed" },
          data: { status: "idle", errorMessage: null },
        });
      } catch (err) {
        console.warn(
          `[affiliates-cron] clear-stale-error SKIP shop=${shop}`,
          err,
        );
      }
    }

    summary.push(shopRow);
    processed += 1;
  }

  const elapsed = ((Date.now() - phaseStart) / 1000).toFixed(1);
  console.info(
    `[affiliates-cron] DONE processed=${processed} skipped=${skipped} errors=${errors.length} elapsed=${elapsed}s`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      processed,
      skipped,
      totalShops: shops.length,
      errors,
      summary,
      elapsedSeconds: Number(elapsed),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
