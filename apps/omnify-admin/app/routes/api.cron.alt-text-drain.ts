import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  DAILY_DRAIN_LIMIT,
  drainDailyApplyQueue,
} from "../services/storytelling/alt-text.server";

/**
 * Daily drip cron: applies up to 100 queued alt-text suggestions per shop
 * to Shopify, avoiding Google SEO churn from bulk metadata changes.
 *
 *   GET /api/cron/alt-text-drain
 *   Header: X-Cron-Secret: <CRON_SECRET>
 * or: /api/cron/alt-text-drain?secret=<CRON_SECRET>
 *
 * Schedule once per day per shop (e.g. EventBridge at 09:00 UTC).
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

  console.info("[alt-text:cron] triggered");

  const shopsWithQueue = await prisma.productImageAltSuggestion.groupBy({
    by: ["shop"],
    where: { status: "queued" },
    _count: { _all: true },
  });

  const results: Array<{
    shop: string;
    applied: number;
    failed: number;
    error?: string;
  }> = [];

  for (const group of shopsWithQueue) {
    const shop = group.shop;
    try {
      const { admin } = await unauthenticated.admin(shop);
      const out = await drainDailyApplyQueue({
        admin,
        shop,
        limit: DAILY_DRAIN_LIMIT,
      });
      results.push({ shop, applied: out.applied, failed: out.failed });
    } catch (err) {
      console.error(`[alt-text:cron] shop FAILED shop=${shop}`, err);
      results.push({
        shop,
        applied: 0,
        failed: 0,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const totalApplied = results.reduce((n, r) => n + r.applied, 0);
  const totalFailed = results.reduce((n, r) => n + r.failed, 0);
  console.info(
    `[alt-text:cron] OK shops=${results.length} applied=${totalApplied} failed=${totalFailed}`,
  );

  return Response.json({
    ok: true,
    shops: results.length,
    totalApplied,
    totalFailed,
    results,
  });
};
