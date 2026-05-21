import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  activateCampaign,
  deactivateCampaign,
} from "../services/bulk-price/campaign.server";

/**
 * Cron endpoint for bulk price campaign auto-activation/deactivation.
 * Schedule every 5 minutes:
 *   GET /api/cron/bulk-price-campaigns
 *   Header: X-Cron-Secret: <CRON_SECRET>
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

  console.info("[bulk-price:cron] triggered");
  const now = new Date();
  const results = {
    activated: 0,
    deactivated: 0,
    errors: [] as string[],
  };

  // --- Activate scheduled campaigns ---
  const toActivate = await prisma.bulkPriceCampaign.findMany({
    where: { status: "scheduled", startAt: { lte: now } },
  });

  console.info(`[bulk-price:cron] toActivate=${toActivate.length}`);

  for (const campaign of toActivate) {
    try {
      // Atomic status check to prevent double-activation
      const updated = await prisma.bulkPriceCampaign.updateMany({
        where: { id: campaign.id, status: "scheduled" },
        data: { status: "activating" },
      });
      if (updated.count === 0) {
        console.warn(`[bulk-price:cron] SKIP activate campaign=${campaign.id} already changed`);
        continue;
      }

      const { admin } = await unauthenticated.admin(campaign.shop);
      const result = await activateCampaign(admin, prisma, campaign.id);

      if (result.ok) {
        results.activated++;
        console.info(
          `[bulk-price:cron] activated campaign=${campaign.name} shop=${campaign.shop} products=${result.productCount} variants=${result.variantCount}`,
        );
      } else {
        results.errors.push(`activate ${campaign.id}: ${result.errors.join(", ")}`);
        // Revert status on failure
        await prisma.bulkPriceCampaign.update({
          where: { id: campaign.id },
          data: { status: "scheduled" },
        });
      }
    } catch (err) {
      results.errors.push(`activate ${campaign.id}: ${String(err)}`);
      console.error(`[bulk-price:cron] activate FAILED campaign=${campaign.id}`, err);
      await prisma.bulkPriceCampaign.update({
        where: { id: campaign.id },
        data: { status: "scheduled" },
      }).catch(() => {});
    }
  }

  // --- Deactivate expired campaigns ---
  const toDeactivate = await prisma.bulkPriceCampaign.findMany({
    where: {
      status: "active",
      endAt: { not: null, lte: now },
    },
  });

  console.info(`[bulk-price:cron] toDeactivate=${toDeactivate.length}`);

  for (const campaign of toDeactivate) {
    try {
      const { admin } = await unauthenticated.admin(campaign.shop);
      const result = await deactivateCampaign(admin, prisma, campaign.id);

      if (result.ok) {
        results.deactivated++;
        console.info(
          `[bulk-price:cron] deactivated campaign=${campaign.name} shop=${campaign.shop} reverted=${result.reverted}`,
        );
      } else {
        results.errors.push(`deactivate ${campaign.id}: ${result.errors.join(", ")}`);
      }
    } catch (err) {
      results.errors.push(`deactivate ${campaign.id}: ${String(err)}`);
      console.error(`[bulk-price:cron] deactivate FAILED campaign=${campaign.id}`, err);
    }
  }

  console.info(
    `[bulk-price:cron] done activated=${results.activated} deactivated=${results.deactivated} errors=${results.errors.length}`,
  );

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { "Content-Type": "application/json" },
  });
};
