// Recurring "who's due right now" poller for the scheduled "credit expiring
// soon" WhatsApp push (docs/handoff-beautyback-credit-automation.md §7).
// Deliberately ONE recurring interval, not per-customer one-shot timers —
// the handoff calls out H-SALEDAY-PUSH-01's control arm silently never
// firing as the exact failure mode this architecture avoids: every tick
// recomputes due-status live from the day's cached cohort, so a missed or
// crashed tick just catches up on the next one instead of losing a send
// forever.
//
// Compiled separately from the rest of the app (see tsconfig.worker.json)
// because server.mjs is plain ESM JS with no build step of its own — this
// is the one place in this app that needs real Node-module-resolution TS
// output rather than Vite's SSR bundle. See app/lib/*.ts for the actual
// business logic; this file is orchestration + the timer only.
import { PrismaClient } from "@prisma/client-sales-whatsapp";
import { unauthenticated } from "../app/shopify.server.js";
import { fetchExpiringCreditCandidates, filterExpiringTranches, type ExpiringTranche } from "../app/lib/expiring-credit-cohort.js";
import { computeArmsForCohort, sendDueExpiringCreditPushes } from "../app/lib/expiring-credit-push.js";
import type { ArmAssignment } from "../app/lib/paw.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // catches the PAW arm's narrowest window (T-15min +-6min = 12min wide)
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function nowBrt(): Date {
  return new Date(Date.now() - BRT_OFFSET_MS);
}

function brtDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type SchedulerLog = { info: (msg: string) => void; error: (err: unknown, msg: string) => void };

// Cached once per BRT calendar day — the cohort/tranches/arms don't need
// re-fetching from Shopify every 5-minute tick, only the due-status check
// does. This is still "one recurring poller," not a daily one-shot: the
// daily refresh is itself driven by the same interval noticing the day
// rolled over, not a separate cron.
let cachedDay: string | null = null;
let cachedTranches: ExpiringTranche[] = [];
let cachedArms: Map<string, ArmAssignment> = new Map();

async function refreshCohortIfNewDay(shop: string, log: SchedulerLog): Promise<void> {
  const today = brtDateKey(nowBrt());
  if (today === cachedDay) return;

  const { admin } = await unauthenticated.admin(shop);
  const candidates = await fetchExpiringCreditCandidates(admin);
  cachedTranches = filterExpiringTranches(candidates, today);
  cachedArms = computeArmsForCohort(cachedTranches);
  cachedDay = today;
  log.info(`expiring-credit-push: refreshed cohort for ${today}, ${cachedTranches.length} tranche(s) due today`);
}

export function startExpiringCreditScheduler(params: { shop: string; zokoApiKey: string; db: PrismaClient; log: SchedulerLog }): void {
  const { shop, zokoApiKey, db, log } = params;

  setInterval(() => {
    (async () => {
      await refreshCohortIfNewDay(shop, log);
      if (cachedTranches.length === 0) return;

      const outcomes = await sendDueExpiringCreditPushes({
        db,
        shop,
        zokoApiKey,
        tranches: cachedTranches,
        arms: cachedArms,
        nowBrt: nowBrt(),
      });
      const sent = outcomes.filter((o) => o.outcome === "sent").length;
      if (sent > 0) log.info(`expiring-credit-push: sent ${sent} message(s) this tick`);
    })().catch((err) => {
      log.error(err, "expiring-credit-push: tick failed");
    });
  }, POLL_INTERVAL_MS);
}
