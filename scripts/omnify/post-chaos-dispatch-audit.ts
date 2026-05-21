import prisma from "../app/db.server";
import { getLalamoveOrderDetails } from "../app/services/lalamove.server";
import { getRuntimeCredentialsForShop } from "../app/services/lalamove-credentials.server";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
// Just after the 2026-05-13 mass-cancel was contained (~19:00 UTC / 16:00 BRT).
const SINCE = new Date("2026-05-13T19:00:00Z");

type OrderStop = {
  shopifyOrderId: string;
  lat?: number;
  lng?: number;
  address?: string;
  name?: string;
  phone?: string;
};

const LOC_NAMES: Record<string, string> = {
  "gid://shopify/Location/97784398144": "Shops Jardins",
  "gid://shopify/Location/101298569536": "RioSul",
  "gid://shopify/Location/97397014848": "Shopping Recife",
  "gid://shopify/Location/97397047616": "RioMar Recife",
  "gid://shopify/Location/105538257216": "CD Extrema",
  "gid://shopify/Location/100984553792": "CD Cajamar",
};
const locShort = (gid: string | null | undefined): string =>
  gid ? (LOC_NAMES[gid] ?? gid.replace("gid://shopify/Location/", "Loc-")) : "?";

const PAD = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

(async () => {
  const credentials = await getRuntimeCredentialsForShop(SHOP);
  if (!credentials) {
    console.error("No Lalamove credentials");
    await prisma.$disconnect();
    process.exit(1);
  }

  // 1. Pull all dispatch jobs in the window that are NOT from auto-delivery-cron
  //    (= UI dispatches OR claude-control). createdAt is the start-of-route clock.
  const jobs = await prisma.lalamoveDispatchJob.findMany({
    where: {
      shop: SHOP,
      createdAt: { gte: SINCE },
      OR: [{ requestedBy: null }, { requestedBy: "claude-control" }],
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${jobs.length} post-chaos dispatch job(s) since ${SINCE.toISOString()}`);
  console.log();

  // 2. Pull the LalamoveDispatchOrderMap rows for those jobs (per-stop DB state).
  const jobIds = jobs.map((j) => j.id);
  const allMaps = jobIds.length === 0
    ? []
    : await prisma.lalamoveDispatchOrderMap.findMany({
        where: { shop: SHOP, dispatchJobId: { in: jobIds } },
        select: {
          dispatchJobId: true,
          shopifyOrderId: true,
          currentStatus: true,
          stopOutcome: true,
          stopFailureReason: true,
        },
      });
  const mapByJob = new Map<string, typeof allMaps>();
  for (const m of allMaps) {
    const arr = mapByJob.get(m.dispatchJobId) ?? [];
    arr.push(m);
    mapByJob.set(m.dispatchJobId, arr);
  }

  // 3. For each job, fetch live Lalamove order details. Partition by status.
  type LiveStop = { stopId?: string; address?: string; POD?: { status?: string; deliveredAt?: string } };
  type LiveDetails = { status?: string; stops?: LiveStop[]; priceBreakdown?: { total?: string; currency?: string } };

  type Enriched = {
    job: (typeof jobs)[number];
    live: LiveDetails | null;
    liveError: string | null;
  };
  const enriched: Enriched[] = [];
  for (const job of jobs) {
    if (!job.lalamoveOrderId || !job.market) {
      enriched.push({ job, live: null, liveError: "missing lalamoveOrderId or market" });
      continue;
    }
    try {
      const d = (await getLalamoveOrderDetails(job.market, job.lalamoveOrderId, credentials)) as LiveDetails;
      enriched.push({ job, live: d, liveError: null });
    } catch (err) {
      enriched.push({ job, live: null, liveError: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    }
  }

  // 4. Summary first.
  const liveCounts: Record<string, number> = {};
  const dbCounts: Record<string, number> = {};
  for (const e of enriched) {
    const lv = e.live?.status ?? (e.liveError ? `LIVE_ERR:${e.liveError.slice(0, 40)}` : "?");
    liveCounts[lv] = (liveCounts[lv] ?? 0) + 1;
    dbCounts[e.job.status] = (dbCounts[e.job.status] ?? 0) + 1;
  }
  console.log("Status distribution:");
  console.log(`  DB:   ${JSON.stringify(dbCounts)}`);
  console.log(`  Live: ${JSON.stringify(liveCounts)}`);
  console.log();

  // 5. Detail per dispatch — only those whose LIVE status reached COMPLETED.
  const completed = enriched.filter((e) => (e.live?.status ?? "").toUpperCase() === "COMPLETED");
  console.log(`Successfully completed dispatches (live status = COMPLETED): ${completed.length}`);
  console.log();

  for (const e of completed) {
    const { job, live } = e;
    const stops = Array.isArray(job.ordersData) ? (job.ordersData as OrderStop[]) : [];
    const maps = mapByJob.get(job.id) ?? [];
    const mapByOrderId = new Map(maps.map((m) => [m.shopifyOrderId, m]));
    const liveStops = Array.isArray(live?.stops) ? live!.stops! : [];

    console.log("──────────────────────────────────────────────────────────────────────────");
    console.log(
      `Dispatch ${job.id}  store=${locShort(job.locationId)}  route=${job.routeId.slice(-12)}  createdAt=${job.createdAt.toISOString()}`,
    );
    console.log(
      `  lalamoveOrderId=${job.lalamoveOrderId}  DB.status=${job.status}  live.status=COMPLETED  cost=${job.quotationTotal ?? "?"} ${job.quotationCurrency ?? ""}`,
    );
    console.log(`  ${stops.length} stop(s):`);
    if (stops.length === 0) {
      console.log("    (no ordersData snapshot on job — older dispatch?)");
    }
    // Lalamove .stops[0] is the pickup. Delivery stops start at index 1.
    console.log(
      `    | ${PAD("Order", 16)} | ${PAD("Customer", 26)} | ${PAD("DB status", 12)} | ${PAD("DB outcome", 12)} | ${PAD("POD status", 12)} | POD.deliveredAt           |`,
    );
    console.log(
      `    | ${"-".repeat(16)} | ${"-".repeat(26)} | ${"-".repeat(12)} | ${"-".repeat(12)} | ${"-".repeat(12)} | ${"-".repeat(25)} |`,
    );
    for (let i = 0; i < stops.length; i += 1) {
      const s = stops[i]!;
      const dbMap = mapByOrderId.get(s.shopifyOrderId);
      const live = liveStops[i + 1];
      const pod = live?.POD;
      const orderShort = s.shopifyOrderId.replace("gid://shopify/Order/", "").slice(-10);
      console.log(
        `    | ${PAD(orderShort, 16)} | ${PAD((s.name ?? "-").slice(0, 26), 26)} | ${PAD(dbMap?.currentStatus ?? "-", 12)} | ${PAD(dbMap?.stopOutcome ?? "-", 12)} | ${PAD(pod?.status ?? "-", 12)} | ${PAD(pod?.deliveredAt ?? "-", 25)} |`,
      );
    }
    console.log();
  }

  // 6. Also show non-completed dispatches (live status != COMPLETED) so user has the whole picture.
  const nonCompleted = enriched.filter((e) => (e.live?.status ?? "").toUpperCase() !== "COMPLETED");
  if (nonCompleted.length > 0) {
    console.log("──────────────────────────────────────────────────────────────────────────");
    console.log(`Non-completed dispatches in same window: ${nonCompleted.length}`);
    console.log(
      `| ${PAD("Dispatch", 26)} | ${PAD("Store", 18)} | createdAt                | ${PAD("DB", 16)} | ${PAD("Live", 18)} | stops |`,
    );
    console.log(
      `| ${"-".repeat(26)} | ${"-".repeat(18)} | ${"-".repeat(24)} | ${"-".repeat(16)} | ${"-".repeat(18)} | ----- |`,
    );
    for (const e of nonCompleted) {
      const stopsCount = Array.isArray(e.job.ordersData) ? (e.job.ordersData as OrderStop[]).length : 0;
      const live = e.live?.status ?? (e.liveError ? `ERR:${e.liveError.slice(0,12)}` : "?");
      console.log(
        `| ${PAD(e.job.id, 26)} | ${PAD(locShort(e.job.locationId), 18)} | ${e.job.createdAt.toISOString()} | ${PAD(e.job.status, 16)} | ${PAD(live, 18)} | ${String(stopsCount).padStart(5)} |`,
      );
    }
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
