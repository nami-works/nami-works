/**
 * In-process scheduler for CPG Labs cron tasks.
 *
 * The app ships several `/api/cron/*` endpoints (bulk-price campaigns,
 * auto-delivery, lalamove-watchdog, retail-analytics, alt-text-drain,
 * sales-goals-sync). None of them has an external trigger wired in AWS
 * EventBridge or GitHub Actions — so without this, scheduled work never runs.
 *
 * This module starts a `setInterval` once per Node process and invokes the
 * job functions directly (in-process), skipping the HTTP round-trip and
 * CRON_SECRET check. With a single ECS task, this is the simplest reliable
 * schedule. The `updateMany` atomic status flips in each job protect against
 * double-execution if the task count scales up.
 *
 * Import once from `entry.server.tsx` so the scheduler starts with the server.
 */

import prisma from "./db.server";
import { unauthenticated } from "./shopify.server";
import {
  activateCampaign,
  deactivateCampaign,
} from "./services/bulk-price/campaign.server";

const GUARD = "__cpg_labs_scheduler_started__";
const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BOOT_DELAY_MS = 30 * 1000; // let the server finish booting before first tick

function startIfNotStarted() {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[GUARD]) return;
  g[GUARD] = true;

  console.info(
    `[scheduler] starting interval=${TICK_INTERVAL_MS}ms boot-delay=${BOOT_DELAY_MS}ms`,
  );

  setTimeout(() => {
    runCampaignTick().catch((err) =>
      console.error("[scheduler] first tick FAILED", err),
    );
    setInterval(() => {
      runCampaignTick().catch((err) =>
        console.error("[scheduler] tick FAILED", err),
      );
    }, TICK_INTERVAL_MS);
  }, BOOT_DELAY_MS);
}

async function runCampaignTick(): Promise<void> {
  const started = Date.now();
  const now = new Date();
  let activated = 0;
  let deactivated = 0;

  // --- Activate scheduled campaigns whose startAt has arrived ---
  const toActivate = await prisma.bulkPriceCampaign.findMany({
    where: { status: "scheduled", startAt: { lte: now } },
  });
  for (const campaign of toActivate) {
    // Atomic flip so concurrent schedulers can't double-activate.
    const flipped = await prisma.bulkPriceCampaign.updateMany({
      where: { id: campaign.id, status: "scheduled" },
      data: { status: "activating" },
    });
    if (flipped.count === 0) continue;
    try {
      const { admin } = await unauthenticated.admin(campaign.shop);
      const result = await activateCampaign(admin, prisma, campaign.id);
      if (result.ok) {
        activated++;
        console.info(
          `[scheduler] activated campaign=${campaign.id} shop=${campaign.shop} products=${result.productCount} variants=${result.variantCount}`,
        );
      } else {
        console.warn(
          `[scheduler] activate returned errors campaign=${campaign.id}`,
          result.errors,
        );
        await prisma.bulkPriceCampaign
          .update({ where: { id: campaign.id }, data: { status: "scheduled" } })
          .catch(() => {});
      }
    } catch (err) {
      console.error(
        `[scheduler] activate FAILED campaign=${campaign.id}`,
        err,
      );
      await prisma.bulkPriceCampaign
        .update({ where: { id: campaign.id }, data: { status: "scheduled" } })
        .catch(() => {});
    }
  }

  // --- Deactivate active campaigns whose endAt has passed ---
  const toDeactivate = await prisma.bulkPriceCampaign.findMany({
    where: { status: "active", endAt: { not: null, lte: now } },
  });
  for (const campaign of toDeactivate) {
    try {
      const { admin } = await unauthenticated.admin(campaign.shop);
      const result = await deactivateCampaign(admin, prisma, campaign.id);
      if (result.ok) {
        deactivated++;
        console.info(
          `[scheduler] deactivated campaign=${campaign.id} shop=${campaign.shop} reverted=${result.reverted}`,
        );
      } else {
        console.warn(
          `[scheduler] deactivate returned errors campaign=${campaign.id}`,
          result.errors,
        );
      }
    } catch (err) {
      console.error(
        `[scheduler] deactivate FAILED campaign=${campaign.id}`,
        err,
      );
    }
  }

  const elapsed = Date.now() - started;
  if (toActivate.length > 0 || toDeactivate.length > 0) {
    console.info(
      `[scheduler] tick done elapsed=${elapsed}ms activated=${activated}/${toActivate.length} deactivated=${deactivated}/${toDeactivate.length}`,
    );
  }
}

startIfNotStarted();
