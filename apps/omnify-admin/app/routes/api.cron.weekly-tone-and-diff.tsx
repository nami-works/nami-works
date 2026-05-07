import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { detectAndPersistDiffs } from "../services/storytelling/diff.server";
import { ingestShopifyBlogs } from "../services/tone-sources/shopify.server";
import { ingestMonday } from "../services/tone-sources/monday.server";
import { ingestMeta } from "../services/tone-sources/meta.server";
import { makeBatchId } from "../services/tone-sources/service.server";
import type { ToneSourceType } from "../services/tone-sources/types";
import { runInferenceForBatch } from "../services/tone-sources/inference.server";

const SHOP_TZ_QUERY = `#graphql
  query ShopTimezone {
    shop {
      ianaTimezone
    }
  }
`;

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

function getLocalDayHour(tz: string): { weekday: number; hour: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { weekday: map[weekdayStr] ?? -1, hour };
}

async function getShopTimezone(
  admin: { graphql: (q: string) => Promise<Response> },
): Promise<string> {
  try {
    const response = await admin.graphql(SHOP_TZ_QUERY);
    const json = (await response.json()) as {
      data?: { shop?: { ianaTimezone?: string } };
    };
    return json.data?.shop?.ianaTimezone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

async function hasRecentToneBatch(shop: string): Promise<boolean> {
  const since = new Date(Date.now() - SIX_DAYS_MS);
  const recent = await prisma.brandToneSource.findFirst({
    where: { shop, capturedAt: { gte: since } },
    select: { id: true },
  });
  return recent !== null;
}

/**
 * Weekly tone refresh + diff scan cron.
 *
 * Schedule HOURLY (every cron hit). Per-shop gate: fires only when current
 * local time is Monday between 09:00 and 09:59 in the shop's IANA timezone,
 * AND no tone batch has been created in the last 6 days.
 *
 *   GET /api/cron/weekly-tone-and-diff
 *   Header: X-Cron-Secret: <CRON_SECRET>
 *
 * For each gated shop:
 *  1. Refresh Shopify blog samples
 *  2. Refresh Monday.com samples (if configured)
 *  3. Run Claude inference on the new batch
 *  4. Run diff detection for published BlogPostDrafts
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret =
    request.headers.get("X-Cron-Secret") ??
    new URL(request.url).searchParams.get("secret");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || secret !== expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  console.info("[cron:weekly-tone-and-diff] START");

  const sessions = await prisma.session.findMany({
    select: { shop: true },
    distinct: ["shop"],
  });

  const results: Array<{
    shop: string;
    fired: boolean;
    reason?: string;
    sampled?: number;
    inferred?: number;
    diffsDetected?: number;
    error?: string;
  }> = [];

  for (const { shop } of sessions) {
    try {
      const { admin } = await unauthenticated.admin(shop);

      const tz = await getShopTimezone(admin);
      const { weekday, hour } = getLocalDayHour(tz);
      const isMondayMorning = weekday === 1 && hour === 9;

      if (!isMondayMorning) {
        results.push({ shop, fired: false, reason: `local_time=${tz}_w${weekday}h${hour}` });
        continue;
      }

      const recent = await hasRecentToneBatch(shop);
      if (recent) {
        results.push({ shop, fired: false, reason: "recent_batch_exists" });
        continue;
      }

      const batchId = makeBatchId();
      console.info(
        `[cron:weekly-tone-and-diff] firing shop=${shop} tz=${tz} batchId=${batchId}`,
      );

      const sourcesUsed: ToneSourceType[] = [];
      let totalSampled = 0;

      try {
        const shopifyResult = await ingestShopifyBlogs({ admin, shop, batchId });
        if (shopifyResult.sampled > 0) {
          totalSampled += shopifyResult.sampled;
          sourcesUsed.push("shopify_blog");
        }
      } catch (err) {
        console.warn(
          `[cron:weekly-tone-and-diff] shopify ingest SKIP shop=${shop}`,
          err,
        );
      }

      const mondayResult = await ingestMonday({ shop, batchId });
      if ("error" in mondayResult) {
        if (!mondayResult.error.includes("not configured")) {
          console.warn(
            `[cron:weekly-tone-and-diff] monday ingest SKIP shop=${shop} reason=${mondayResult.error}`,
          );
        }
      } else if (mondayResult.sampled > 0) {
        totalSampled += mondayResult.sampled;
        sourcesUsed.push("monday");
      }

      const metaResult = await ingestMeta({ shop, batchId });
      if ("error" in metaResult) {
        if (!metaResult.error.includes("not configured")) {
          console.warn(
            `[cron:weekly-tone-and-diff] meta ingest SKIP shop=${shop} reason=${metaResult.error}`,
          );
        }
      } else if (metaResult.sampled > 0) {
        totalSampled += metaResult.sampled;
        sourcesUsed.push("meta_ig");
      }

      let inferred = 0;
      if (totalSampled > 0) {
        const infResult = await runInferenceForBatch({ shop, batchId });
        if ("error" in infResult) {
          console.warn(
            `[cron:weekly-tone-and-diff] inference SKIP shop=${shop} reason=${infResult.error}`,
          );
        } else {
          inferred = infResult.created;
        }
      }

      let diffsDetected = 0;
      try {
        const diffResult = await detectAndPersistDiffs({ admin, shop });
        diffsDetected = diffResult.detected;
      } catch (err) {
        console.warn(
          `[cron:weekly-tone-and-diff] diff SKIP shop=${shop}`,
          err,
        );
      }

      console.info(
        `[cron:weekly-tone-and-diff] OK shop=${shop} sampled=${totalSampled} inferred=${inferred} diffs=${diffsDetected} sources=${sourcesUsed.join(",")}`,
      );
      results.push({
        shop,
        fired: true,
        sampled: totalSampled,
        inferred,
        diffsDetected,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error(
        `[cron:weekly-tone-and-diff] FAILED shop=${shop} reason=${message}`,
      );
      results.push({ shop, fired: false, error: message });
    }
  }

  const fired = results.filter((r) => r.fired).length;
  console.info(`[cron:weekly-tone-and-diff] DONE shops=${sessions.length} fired=${fired}`);

  return new Response(
    JSON.stringify({ ok: true, shops: sessions.length, fired, results }),
    { headers: { "Content-Type": "application/json" } },
  );
};
