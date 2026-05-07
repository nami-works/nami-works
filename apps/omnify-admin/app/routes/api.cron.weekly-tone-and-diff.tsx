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

/**
 * Weekly tone refresh + diff scan cron.
 *
 * Schedule: Monday 03:00 UTC (= midnight Sunday→Monday BRT) via EventBridge.
 * One fire per week, per app deployment. No hourly polling, no per-shop
 * timezone gating — refresh timing isn't user-visible, merchants see the
 * resulting banner whenever they next open the admin.
 *
 *   GET /api/cron/weekly-tone-and-diff
 *   Header: X-Cron-Secret: <CRON_SECRET>
 *
 * For each installed shop:
 *  1. Refresh Shopify blog samples
 *  2. Refresh Monday.com samples (if configured)
 *  3. Refresh Meta IG/FB samples (if configured)
 *  4. Run Claude inference on the new BrandToneSource batch
 *  5. Run diff detection for published BlogPostDrafts
 *
 * Failures on individual shops are logged with their real error message and
 * the loop continues with the next shop — one stale session must not block
 * the rest of the fleet.
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
    sampled?: number;
    inferred?: number;
    diffsDetected?: number;
    sourcesUsed?: ToneSourceType[];
    error?: string;
  }> = [];

  for (const { shop } of sessions) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const batchId = makeBatchId();

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
          `[cron:weekly-tone-and-diff] shopify ingest SKIP shop=${shop} reason=${describeError(err)}`,
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
          `[cron:weekly-tone-and-diff] diff SKIP shop=${shop} reason=${describeError(err)}`,
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
        sourcesUsed,
      });
    } catch (err) {
      const reason = describeError(err);
      console.error(
        `[cron:weekly-tone-and-diff] FAILED shop=${shop} reason=${reason}`,
      );
      results.push({ shop, fired: false, error: reason });
    }
  }

  const fired = results.filter((r) => r.fired).length;
  console.info(
    `[cron:weekly-tone-and-diff] DONE shops=${sessions.length} fired=${fired}`,
  );

  return new Response(
    JSON.stringify({ ok: true, shops: sessions.length, fired, results }),
    { headers: { "Content-Type": "application/json" } },
  );
};

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
