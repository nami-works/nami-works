/**
 * One-shot cleanup for the 2026-05-12 duplicate-dispatch incident.
 *
 * 6 LalamoveDispatchJob rows kept triggering the watchdog's stale-ON_GOING
 * auto-retry path, which placed duplicate Lalamove orders (real money). The
 * defensive guard in `autoRetryDispatchJob` (commit on branch
 * fix/lalamove-escalation-guard) prevents the duplicate dispatch from now on,
 * but these 6 jobs still sit in DB states where the watchdog would query
 * Lalamove on every tick. This script bumps their retryCount to MAX_AUTO_RETRIES
 * (=2) so the watchdog ignores them entirely.
 *
 * It does NOT touch the duplicate Lalamove orders themselves (Lucas already
 * cancelled those on Lalamove's side) — only the internal DB rows.
 *
 * Usage:
 *   docker exec -i cpg-labs-full node --import tsx scripts/cleanup-stuck-lalamove-jobs.ts
 *
 * Idempotent — running twice is fine.
 */

import prisma from "../app/db.server";

const STUCK_JOB_IDS = [
  "cmp02s98o00czn42y76847dvw", // pre-existing, ~22h old
  "cmp1iwte200x4ob2z8y09vdhe",
  "cmp1iwwtv00x9ob2ze8xpsndp",
  "cmp1iwzml00xdob2zji33edv5",
  "cmp1ix28q00xgob2zm37tdbp8",
  "cmp1iwods00x0ob2zq4y2aqgt",
];

const MAX_AUTO_RETRIES = 2;

async function main(): Promise<void> {
  console.info(
    `[cleanup-stuck-jobs] start jobs=${STUCK_JOB_IDS.length}`,
  );

  for (const jobId of STUCK_JOB_IDS) {
    const before = await prisma.lalamoveDispatchJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        retryCount: true,
        lalamoveOrderId: true,
        shop: true,
        updatedAt: true,
      },
    });
    if (!before) {
      console.warn(`[cleanup-stuck-jobs] job=${jobId} NOT FOUND — skipping`);
      continue;
    }

    if ((before.retryCount ?? 0) >= MAX_AUTO_RETRIES) {
      console.info(
        `[cleanup-stuck-jobs] job=${jobId} already retryCount=${before.retryCount} — skipping`,
      );
      continue;
    }

    await prisma.lalamoveDispatchJob.update({
      where: { id: jobId },
      data: { retryCount: MAX_AUTO_RETRIES },
    });

    console.info(
      `[cleanup-stuck-jobs] job=${jobId} shop=${before.shop} status=${before.status} retryCount ${before.retryCount ?? 0} → ${MAX_AUTO_RETRIES} lalamoveOrderId=${before.lalamoveOrderId ?? "?"}`,
    );
  }

  console.info(`[cleanup-stuck-jobs] done`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[cleanup-stuck-jobs] FAILED", err);
  process.exit(1);
});
