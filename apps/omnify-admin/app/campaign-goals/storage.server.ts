// Campaign goals — CRUD + progress aggregation.
//
// Route-agnostic: the Campaigns tab inside Retail goals and any future
// standalone /app/campaigns route both import from this module.

import prisma from "../db.server";
import type {
  CampaignGoalView,
  CampaignLocationProgress,
  CampaignMatchRule,
  CampaignMetric,
  CampaignProgressView,
  CampaignStatus,
  CampaignTargetView,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toDateOnlyString = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const toDashboardView = (row: {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  metric: string;
  matchRule: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  targets: Array<{
    locationId: string;
    locationName: string;
    targetOrders: number;
    baselineOrders: number | null;
  }>;
}): CampaignGoalView => ({
  id: row.id,
  name: row.name,
  startDate: toDateOnlyString(row.startDate),
  endDate: toDateOnlyString(row.endDate),
  metric: row.metric as CampaignMetric,
  matchRule: row.matchRule as CampaignMatchRule,
  status: row.status as CampaignStatus,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  targets: row.targets.map(
    (t): CampaignTargetView => ({
      locationId: t.locationId,
      locationName: t.locationName,
      targetOrders: t.targetOrders,
      baselineOrders: t.baselineOrders,
      targetValue: t.targetOrders,
      baselineValue: t.baselineOrders,
    }),
  ),
});

// ─── List / read ─────────────────────────────────────────────────────────────

export async function listCampaigns(
  shop: string,
  filter?: { status?: CampaignStatus },
): Promise<CampaignGoalView[]> {
  const rows = await prisma.campaignGoal.findMany({
    where: {
      shop,
      ...(filter?.status ? { status: filter.status } : {}),
    },
    orderBy: [{ startDate: "desc" }],
    include: {
      targets: {
        orderBy: { locationName: "asc" },
      },
    },
  });
  return rows.map(toDashboardView);
}

export async function getCampaign(
  shop: string,
  id: string,
): Promise<CampaignGoalView | null> {
  const row = await prisma.campaignGoal.findFirst({
    where: { shop, id },
    include: { targets: { orderBy: { locationName: "asc" } } },
  });
  return row ? toDashboardView(row) : null;
}

// ─── Create / update / archive ───────────────────────────────────────────────

export type CampaignUpsertInput = {
  name: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  metric: CampaignMetric;
  matchRule: CampaignMatchRule;
  targets: Array<{
    locationId: string;
    locationName: string;
    targetOrders: number;
    baselineOrders?: number | null;
  }>;
};

const parseDate = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export async function createCampaign(
  shop: string,
  input: CampaignUpsertInput,
): Promise<CampaignGoalView> {
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  const now = new Date();
  // If the campaign window already includes today, it's active immediately.
  // Otherwise it's a draft that the cron/webhook will skip until startDate.
  const initialStatus: CampaignStatus =
    start <= now && end >= now ? "active" : "draft";

  const row = await prisma.campaignGoal.create({
    data: {
      shop,
      name: input.name,
      startDate: start,
      endDate: end,
      metric: input.metric,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      matchRule: input.matchRule as any,
      status: initialStatus,
      targets: {
        create: input.targets.map((t) => ({
          locationId: t.locationId,
          locationName: t.locationName,
          targetOrders: t.targetOrders,
          baselineOrders: t.baselineOrders ?? null,
        })),
      },
    },
    include: { targets: { orderBy: { locationName: "asc" } } },
  });

  console.info(
    `[campaign-goals] created shop=${shop} id=${row.id} name=${row.name} status=${row.status} targets=${input.targets.length}`,
  );
  return toDashboardView(row);
}

export async function updateCampaign(
  shop: string,
  id: string,
  input: Partial<CampaignUpsertInput>,
): Promise<CampaignGoalView | null> {
  const existing = await prisma.campaignGoal.findFirst({
    where: { shop, id },
  });
  if (!existing) return null;

  // Match rule is locked once the campaign is active.
  const canEditMatchRule =
    existing.status === "draft" || existing.status === "archived";

  const updateData: {
    name?: string;
    startDate?: Date;
    endDate?: Date;
    metric?: CampaignMetric;
    matchRule?: unknown;
  } = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.startDate) updateData.startDate = parseDate(input.startDate);
  if (input.endDate) updateData.endDate = parseDate(input.endDate);
  if (input.metric) updateData.metric = input.metric;
  if (input.matchRule && canEditMatchRule) {
    updateData.matchRule = input.matchRule;
  }

  await prisma.campaignGoal.update({
    where: { id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: updateData as any,
  });

  // Replace targets if supplied.
  if (input.targets) {
    await prisma.campaignGoalTarget.deleteMany({
      where: { campaignGoalId: id },
    });
    await prisma.campaignGoalTarget.createMany({
      data: input.targets.map((t) => ({
        campaignGoalId: id,
        locationId: t.locationId,
        locationName: t.locationName,
        targetOrders: t.targetOrders,
        baselineOrders: t.baselineOrders ?? null,
      })),
    });
  }

  const reloaded = await prisma.campaignGoal.findUnique({
    where: { id },
    include: { targets: { orderBy: { locationName: "asc" } } },
  });
  console.info(
    `[campaign-goals] updated shop=${shop} id=${id} matchRuleChanged=${Boolean(input.matchRule && canEditMatchRule)}`,
  );
  return reloaded ? toDashboardView(reloaded) : null;
}

export async function archiveCampaign(
  shop: string,
  id: string,
): Promise<boolean> {
  const result = await prisma.campaignGoal.updateMany({
    where: { shop, id },
    data: { status: "archived" },
  });
  console.info(`[campaign-goals] archived shop=${shop} id=${id}`);
  return result.count > 0;
}

export async function deleteCampaign(
  shop: string,
  id: string,
): Promise<boolean> {
  const existing = await prisma.campaignGoal.findFirst({
    where: { shop, id },
  });
  if (!existing) return false;
  // Only drafts can be hard-deleted; everything else must be archived.
  if (existing.status !== "draft") return false;
  await prisma.campaignGoal.delete({ where: { id } });
  console.info(`[campaign-goals] deleted shop=${shop} id=${id}`);
  return true;
}

// ─── Status sweep ────────────────────────────────────────────────────────────

/**
 * Promotes drafts to active when their startDate arrives, and ends active
 * campaigns whose endDate has passed. Called at the top of the hourly cron
 * and also at loader time for best-effort freshness.
 */
export async function sweepCampaignStatuses(shop: string): Promise<void> {
  const now = new Date();

  await prisma.campaignGoal.updateMany({
    where: {
      shop,
      status: "draft",
      startDate: { lte: now },
      endDate: { gte: now },
    },
    data: { status: "active" },
  });

  await prisma.campaignGoal.updateMany({
    where: {
      shop,
      status: "active",
      endDate: { lt: now },
    },
    data: { status: "ended" },
  });
}

// ─── Progress ────────────────────────────────────────────────────────────────

/**
 * Computes the progress view for a campaign: totals, per-location numbers,
 * attach rate, achievement %, and elapsed fraction. Uses raw SQL for
 * efficient bucketing.
 */
export async function getCampaignProgress(
  shop: string,
  campaignId: string,
): Promise<CampaignProgressView | null> {
  const campaign = await prisma.campaignGoal.findFirst({
    where: { shop, id: campaignId },
    include: { targets: { orderBy: { locationName: "asc" } } },
  });
  if (!campaign) return null;

  const metric = campaign.metric as CampaignMetric;
  const startDate = campaign.startDate;
  const endDateExclusive = new Date(campaign.endDate);
  endDateExclusive.setDate(endDateExclusive.getDate() + 1);

  const matchRows = await prisma.campaignOrderMatch.groupBy({
    by: ["locationId"],
    where: { campaignGoalId: campaignId },
    _count: { _all: true },
  });
  const matchByLoc = new Map<string, number>(
    matchRows.map((r) => [r.locationId, r._count._all]),
  );

  const totalRows = await prisma.salesOrder.groupBy({
    by: ["locationId"],
    where: {
      shop,
      orderDate: { gte: startDate, lt: endDateExclusive },
    },
    _count: { _all: true },
  });
  const totalByLoc = new Map<string, number>(
    totalRows.map((r) => [r.locationId, r._count._all]),
  );

  // For revenue/AOV metrics, compute matched revenue per location
  const revenueByLoc = new Map<string, number>();
  if (metric === "revenue" || metric === "aov") {
    const revenueRows = await prisma.$queryRawUnsafe<
      Array<{ locationId: string; totalRevenue: number }>
    >(
      `SELECT m."locationId", COALESCE(SUM(s."totalAmount"), 0) as "totalRevenue"
       FROM "CampaignOrderMatch" m
       JOIN "SalesOrder" s ON s.id = m."orderId"
       WHERE m."campaignGoalId" = $1
       GROUP BY m."locationId"`,
      campaignId,
    );
    for (const r of revenueRows) {
      revenueByLoc.set(r.locationId, Number(r.totalRevenue));
    }
  }

  const isCountMetric =
    metric === "bundle_orders" ||
    metric === "specific_products" ||
    metric === "specific_combination";

  const perLocation: CampaignLocationProgress[] = campaign.targets.map(
    (t) => {
      const matched = matchByLoc.get(t.locationId) ?? 0;
      const total = totalByLoc.get(t.locationId) ?? 0;
      const attachRate = total > 0 ? matched / total : null;
      const achievementPercent =
        t.targetOrders > 0 ? (matched / t.targetOrders) * 100 : null;

      let matchedValue: number;
      let targetValue: number;
      if (isCountMetric) {
        matchedValue = matched;
        targetValue = t.targetOrders;
      } else if (metric === "revenue") {
        matchedValue = revenueByLoc.get(t.locationId) ?? 0;
        targetValue = t.targetOrders; // target column stores the target in the same unit
      } else {
        // aov
        const rev = revenueByLoc.get(t.locationId) ?? 0;
        matchedValue = matched > 0 ? rev / matched : 0;
        targetValue = t.targetOrders;
      }

      const achievementPercentValue =
        targetValue > 0 ? (matchedValue / targetValue) * 100 : null;

      return {
        locationId: t.locationId,
        locationName: t.locationName,
        targetOrders: t.targetOrders,
        baselineOrders: t.baselineOrders,
        matchedOrders: matched,
        totalOrders: total,
        attachRate,
        achievementPercent,
        targetValue,
        matchedValue,
        achievementPercentValue,
      };
    },
  );

  const totalMatched = perLocation.reduce((s, p) => s + p.matchedOrders, 0);
  const totalOrders = perLocation.reduce((s, p) => s + p.totalOrders, 0);
  const overallAttachRate =
    totalOrders > 0 ? totalMatched / totalOrders : null;
  const totalTarget = campaign.targets.reduce(
    (s, t) => s + t.targetOrders,
    0,
  );
  const overallAchievementPercent =
    totalTarget > 0 ? (totalMatched / totalTarget) * 100 : null;

  const totalMatchedValue = perLocation.reduce(
    (s, p) => s + p.matchedValue,
    0,
  );
  const totalTargetValue = perLocation.reduce(
    (s, p) => s + p.targetValue,
    0,
  );
  const overallAchievementPercentValue =
    totalTargetValue > 0
      ? (totalMatchedValue / totalTargetValue) * 100
      : null;

  const now = Date.now();
  const startMs = startDate.getTime();
  const endMs = endDateExclusive.getTime();
  const elapsedFraction =
    endMs > startMs
      ? Math.max(0, Math.min(1, (now - startMs) / (endMs - startMs)))
      : 0;

  return {
    campaign: toDashboardView(campaign),
    totalMatched,
    totalOrders,
    overallAttachRate,
    overallAchievementPercent,
    perLocation,
    elapsedFraction,
    totalMatchedValue,
    totalTargetValue,
    overallAchievementPercentValue,
  };
}

// ─── Reconciliation (called by cron) ────────────────────────────────────────

/**
 * For an active campaign, iterate SalesOrder rows in its window that DON'T
 * have a CampaignOrderMatch row yet. Fetches line items per order and evaluates
 * the rule. Catches webhook drops and retroactively indexes a campaign added
 * mid-flight.
 *
 * Hourly cron calls this for every active campaign.
 */
export async function reconcileCampaignMatches(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  campaignId: string,
): Promise<{ scanned: number; matched: number }> {
  const campaign = await prisma.campaignGoal.findFirst({
    where: { shop, id: campaignId },
    select: { startDate: true, endDate: true, matchRule: true },
  });
  if (!campaign) return { scanned: 0, matched: 0 };

  const endExclusive = new Date(campaign.endDate);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const alreadyMatched = await prisma.campaignOrderMatch.findMany({
    where: { campaignGoalId: campaignId },
    select: { orderId: true },
  });
  const alreadySet = new Set(alreadyMatched.map((m) => m.orderId));

  const candidates = await prisma.salesOrder.findMany({
    where: {
      shop,
      orderDate: { gte: campaign.startDate, lt: endExclusive },
    },
    select: { id: true, orderDate: true, locationId: true },
  });

  const { fetchOrderLineItems, matchRuleApplies } = await import(
    "./match.server"
  );
  const rule = campaign.matchRule as CampaignMatchRule;

  let scanned = 0;
  let matched = 0;
  for (const order of candidates) {
    if (alreadySet.has(order.id)) continue;
    scanned += 1;
    const snap = await fetchOrderLineItems(admin, order.id);
    if (!snap) continue;
    if (!matchRuleApplies(rule, snap)) continue;
    matched += 1;
    await prisma.campaignOrderMatch.upsert({
      where: {
        campaignGoalId_orderId: { campaignGoalId: campaignId, orderId: order.id },
      },
      create: {
        id: `${campaignId}__${order.id}`,
        campaignGoalId: campaignId,
        orderId: order.id,
        shop,
        locationId: order.locationId,
        orderDate: order.orderDate,
      },
      update: {},
    });
  }

  console.info(
    `[campaign-goals] reconcile shop=${shop} campaignId=${campaignId} scanned=${scanned} matched=${matched}`,
  );
  return { scanned, matched };
}

// ─── Baseline data ──────────────────────────────────────────────────────────

export async function getBaselineData(
  shop: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<Record<string, { orderCount: number; revenue: number }>> {
  const rows = await prisma.salesOrder.groupBy({
    by: ["locationId"],
    where: {
      shop,
      orderDate: { gte: periodStart, lt: periodEnd },
    },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });

  const result: Record<string, { orderCount: number; revenue: number }> = {};
  for (const row of rows) {
    result[row.locationId] = {
      orderCount: row._count._all,
      revenue: row._sum.totalAmount ?? 0,
    };
  }
  return result;
}
