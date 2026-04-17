import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  formatCurrency as fmtCurrencyBase,
  formatCurrencyCompact,
  formatMonthLabel as fmtMonthBase,
} from "../i18n/format";
import styles from "./app.retail-sales/styles.module.css";
import {
  filterCandidateLocations,
  monthKey,
  sourceLabel,
  type RetailLocation,
} from "../sales-goals/classification";
import {
  buildMonthRange,
  computeCurrentMonthProjection,
  computeMonthProjections,
  countZeroRevenueDaysInRange,
  queryMonthlyAggregates,
  queryRangeAggregates,
  readSyncMeta,
  type MonthlyAggregateRow,
  type MonthProjection,
  type RangeAggregateRow,
  type SyncMetaRecord,
} from "../sales-goals/analytics-queries.server";
import {
  aggregateSnapshots,
  bestVsWorst,
  buildSnapshotsFromRange,
  discountRate,
  sameStoreYoY,
  scaleZeroDayThreshold,
  type AggregateKpi,
  type LocationSnapshot,
} from "../sales-goals/analytics-pure";
import {
  resolvePeriod,
  parseLocalYmd,
  type ComparisonMode,
  type PeriodPreset,
  type ResolvedPeriod,
} from "../sales-goals/period-resolution";
import { runSalesGoalsSync } from "../sales-goals/sync.server";
import {
  archiveCampaign as archiveCampaignStore,
  createCampaign,
  getCampaignProgress,
  listCampaigns,
  sweepCampaignStatuses,
  updateCampaign,
} from "../campaign-goals/storage.server";
import type {
  CampaignGoalView,
  CampaignMatchRule,
  CampaignMetric,
  CampaignProgressView,
} from "../campaign-goals/types";
import { CampaignsTab } from "./app.retail-sales/campaigns-tab";

// ─── Types ────────────────────────────────────────────────────────────────────

type SalesGoal = {
  id: string;
  locationId: string;
  locationName: string;
  month: string;
  target: number;
  basePeriod?: string;
  baseValue?: number;
  growthType?: "percentage" | "absolute";
  growthValue?: number;
};

type LocationConfig = {
  enabled: boolean;
  orderSources: { enabled: boolean; sources: string[] };
  tags: { enabled: boolean; tags: string[] };
};

type MonthlyBucket = {
  orderCount: number;
  revenue: number;
  totalDiscounts: number;
};

type MonthlyByLocation = Record<string, Record<string, MonthlyBucket>>;

type DashboardKpis = {
  revenue: AggregateKpi;
  aov: AggregateKpi;
  orders: AggregateKpi;
  sameStoreYoY: ReturnType<typeof sameStoreYoY>;
  bestVsWorst: ReturnType<typeof bestVsWorst>;
  discountRate: ReturnType<typeof discountRate>;
};

type LoaderData = {
  locations: RetailLocation[]; // all active non-fulfillment-service locations
  goals: SalesGoal[];
  monthlyByLocation: MonthlyByLocation;
  projectionsByLocation: Record<string, Record<string, MonthProjection>>;
  months: string[]; // YYYY-MM keys, oldest → newest
  currentMonth: string;
  pyMonth: string;
  currencyCode: string;
  orderSources: string[];
  orderTags: string[];
  locationConfigs: { locationId: string; data: LocationConfig }[];
  syncMeta: SyncMetaRecord;
  dashboardSnapshots: LocationSnapshot[];
  dashboardKpis: DashboardKpis;
  storesWithGoalsCount: number;
  locationsCount: number;
  defaultPeriod: ResolvedPeriod;
  campaigns: CampaignGoalView[];
  campaignProgress: Record<string, CampaignProgressView>;
};

type DashboardPeriodStats = {
  period: ResolvedPeriod;
  snapshots: LocationSnapshot[];
  kpis: DashboardKpis;
  currencyCode: string;
  storesWithGoalsCount: number;
  locationsCount: number;
  prevYearAggregates: RangeAggregateRow[];
  proratedMtdGoal: number | null;
};

type TabId = "dashboard" | "goals" | "campaigns";

// ─── Constants ────────────────────────────────────────────────────────────────

const TAB_IDS: TabId[] = ["dashboard", "goals", "campaigns"];

const MONTHS_BACK = 13; // current + 12 prior (gives full YoY)

const DEFAULT_ORDER_SOURCES = ["Point of Sale", "IGLU POS"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currentMonthKey = () => {
  const d = new Date();
  return monthKey(d);
};

const addMonths = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
};

const deltaPercent = (current: number, previous: number): number | null => {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
};

// ─── Friendly date-range label (for the overview strip) ──────────────────────

/** "Mar 1 – Apr 10, 2026" (same year) / "Dec 20, 2025 – Jan 10, 2026" (cross-year). */
function formatDateRangeFriendly(
  start: string,
  end: string,
  locale: string,
): string {
  if (!start || !end) return "";
  const s = parseLocalYmd(start);
  const e = parseLocalYmd(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
  const fmtMonthDay = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  if (s.getFullYear() === e.getFullYear()) {
    return `${fmtMonthDay.format(s)} – ${fmtMonthDay.format(e)}, ${e.getFullYear()}`;
  }
  const fmtFull = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${fmtFull.format(s)} – ${fmtFull.format(e)}`;
}

/** "4/16, 2PM" — shorter than locale.toLocaleString for the strip subtitle. */
function formatLastSyncShort(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "numeric",
  }).format(d);
  let hour = d.getHours();
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${date}, ${hour}${ampm}`;
}

// Backward-compat: older SalesGoalsLocationConfig rows may have a `salesChannels`
// or `shippingMethods` field from the previous schema. Normalize to the new
// shape on read; writes only emit the new shape.
const normalizeLocationConfig = (raw: unknown): LocationConfig => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const orderSources = (r.orderSources ?? r.salesChannels ?? {}) as {
    enabled?: boolean;
    sources?: string[];
    channels?: string[];
  };
  const tags = (r.tags ?? {}) as { enabled?: boolean; tags?: string[] };
  return {
    enabled: r.enabled !== false,
    orderSources: {
      enabled: orderSources.enabled === true,
      sources: Array.isArray(orderSources.sources)
        ? orderSources.sources
        : Array.isArray(orderSources.channels)
          ? orderSources.channels
          : [],
    },
    tags: {
      enabled: tags.enabled === true,
      tags: Array.isArray(tags.tags) ? tags.tags : [],
    },
  };
};

// ─── Loader ───────────────────────────────────────────────────────────────────

const LOCATIONS_QUERY = `#graphql
  query LocationsForSalesGoals {
    locations(first: 50) {
      nodes {
        id
        name
        isActive
        isFulfillmentService
        fulfillmentService { id }
      }
    }
  }`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[sales-goals] loader START shop=${shop}`);

  const locationsResponse = await admin.graphql(LOCATIONS_QUERY);
  const locationsJson = await locationsResponse.json();
  const rawLocations = (locationsJson.data?.locations?.nodes ?? []) as Array<{
    id: string;
    name: string;
    isActive?: boolean;
    isFulfillmentService?: boolean;
    fulfillmentService?: { id: string } | null;
  }>;
  const candidateLocations = filterCandidateLocations(rawLocations);
  const candidateIds = candidateLocations.map((l) => l.id);

  const months = buildMonthRange(MONTHS_BACK);
  const currentMonth = currentMonthKey();

  const pyMonth = addMonthsHelper(currentMonth, -12);

  const [aggregates, projectionsByLocation, locationConfigRows, configRecord, syncMeta] =
    await Promise.all([
      queryMonthlyAggregates(shop, months, candidateIds),
      computeMonthProjections(shop, candidateIds, months),
      prisma.salesGoalsLocationConfig.findMany({ where: { shop } }),
      prisma.salesGoalsConfig.findUnique({ where: { shop } }),
      readSyncMeta(shop),
    ]);

  // Kick off background sync on first visit (fire-and-forget).
  if (
    syncMeta.status === "idle" &&
    !syncMeta.lastSyncedAt &&
    aggregates.length === 0
  ) {
    console.info(`[sales-goals] first-visit auto-sync START shop=${shop}`);
    runSalesGoalsSync(admin, shop, MONTHS_BACK + 1).catch((err) =>
      console.error(`[sales-goals] auto-sync error shop=${shop}`, err),
    );
  }

  const monthlyByLocation: MonthlyByLocation = {};
  let currencyCode = "BRL";
  const allTags = new Set<string>();

  for (const row of aggregates) {
    if (!monthlyByLocation[row.locationId]) {
      monthlyByLocation[row.locationId] = {};
    }
    monthlyByLocation[row.locationId][row.month] = {
      orderCount: row.orderCount,
      revenue: row.revenue,
      totalDiscounts: row.totalDiscounts,
    };
    if (row.currencyCode) currencyCode = row.currencyCode;
  }

  // Collect tag suggestions from saved configs (sync-based, not live from Shopify).
  for (const row of locationConfigRows) {
    const cfg = normalizeLocationConfig(row.data);
    cfg.tags.tags.forEach((t) => allTags.add(t));
  }

  const goals = (configRecord?.data as SalesGoal[] | null) ?? [];

  // ── Server-side dashboard aggregates ────────────────────────────────
  const goalsForCurrentMonth: Record<string, number> = {};
  for (const g of goals) {
    if (g.month === currentMonth) goalsForCurrentMonth[g.locationId] = g.target;
  }

  // Compute enabled-locations via the same config path the client uses.
  const disabledIds = new Set<string>();
  for (const row of locationConfigRows) {
    const cfg = normalizeLocationConfig(row.data);
    if (cfg.enabled === false) disabledIds.add(row.locationId);
  }
  const enabledLocationsLoader = candidateLocations.filter(
    (l) => !disabledIds.has(l.id),
  );
  const enabledIds = enabledLocationsLoader.map((l) => l.id);

  // Default period = this_month + prev_year. Matches the client's first-paint
  // state and keeps server/client in lockstep.
  const defaultPeriod = resolvePeriod("this_month", "prev_year");
  if (!defaultPeriod) throw new Error("Unable to resolve default period");

  const [
    defaultCurrentRows,
    defaultCompareRows,
    defaultZeroCurrent,
    defaultZeroCompare,
    defaultProjection,
  ] = await Promise.all([
    queryRangeAggregates(
      shop,
      enabledIds,
      defaultPeriod.start,
      defaultPeriod.end,
    ),
    defaultPeriod.compareStart && defaultPeriod.compareEnd
      ? queryRangeAggregates(
          shop,
          enabledIds,
          defaultPeriod.compareStart,
          defaultPeriod.compareEnd,
        )
      : Promise.resolve([] as RangeAggregateRow[]),
    countZeroRevenueDaysInRange(
      shop,
      enabledIds,
      defaultPeriod.start,
      defaultPeriod.end,
    ),
    defaultPeriod.compareStart && defaultPeriod.compareEnd
      ? countZeroRevenueDaysInRange(
          shop,
          enabledIds,
          defaultPeriod.compareStart,
          defaultPeriod.compareEnd,
        )
      : Promise.resolve({} as Record<string, number>),
    defaultPeriod.includesToday && defaultPeriod.isSingleMonth
      ? computeCurrentMonthProjection(shop, enabledIds)
      : Promise.resolve(null as Record<string, MonthProjection> | null),
  ]);

  const dashboardSnapshots = buildSnapshotsFromRange({
    locations: enabledLocationsLoader.map((l) => ({ id: l.id, name: l.name })),
    currentRows: defaultCurrentRows,
    compareRows: defaultCompareRows,
    zeroDaysCurrent: defaultZeroCurrent,
    zeroDaysCompare: defaultZeroCompare,
    projectionByLocation: defaultProjection,
    goalsByLocation: goalsForCurrentMonth,
    isSingleMonth: defaultPeriod.isSingleMonth,
  });

  const defaultThreshold = scaleZeroDayThreshold(defaultPeriod.periodDays);
  const dashboardKpis: DashboardKpis = {
    revenue: aggregateSnapshots(dashboardSnapshots, "revenue"),
    aov: aggregateSnapshots(dashboardSnapshots, "aov"),
    orders: aggregateSnapshots(dashboardSnapshots, "orders"),
    sameStoreYoY: sameStoreYoY(dashboardSnapshots, defaultThreshold),
    bestVsWorst: bestVsWorst(dashboardSnapshots),
    discountRate: discountRate(dashboardSnapshots, aggregates),
  };

  const storesWithGoalsCount = Object.keys(goalsForCurrentMonth).length;
  const locationsCount = enabledLocationsLoader.length;

  // ── Campaign goals load ─────────────────────────────────────────────
  // Sweep statuses so drafts promote + expired campaigns end before we read.
  await sweepCampaignStatuses(shop).catch((err) =>
    console.warn(`[retail-sales] campaign sweep SKIP shop=${shop}`, err),
  );
  const campaigns = await listCampaigns(shop);
  const campaignProgress: Record<string, CampaignProgressView> = {};
  for (const c of campaigns) {
    // Progress is computed on-demand from CampaignOrderMatch + SalesOrder.
    // Cost is minimal: 2 groupBy queries per campaign.
    const progress = await getCampaignProgress(shop, c.id);
    if (progress) campaignProgress[c.id] = progress;
  }

  const result: LoaderData = {
    locations: candidateLocations,
    goals,
    monthlyByLocation,
    projectionsByLocation,
    months,
    currentMonth,
    pyMonth,
    currencyCode,
    orderSources: DEFAULT_ORDER_SOURCES,
    orderTags: Array.from(allTags).sort(),
    locationConfigs: locationConfigRows
      .filter((row) => candidateIds.includes(row.locationId))
      .map((row) => ({
        locationId: row.locationId,
        data: normalizeLocationConfig(row.data),
      })),
    syncMeta,
    dashboardSnapshots,
    dashboardKpis,
    storesWithGoalsCount,
    locationsCount,
    defaultPeriod,
    campaigns,
    campaignProgress,
  };

  console.info(
    `[sales-goals] loader OK shop=${shop} candidates=${candidateLocations.length} monthlyRows=${aggregates.length} goals=${goals.length} syncStatus=${syncMeta.status}`,
  );
  return result;
};

/** Shift a YYYY-MM-DD date string back by one year (local calendar). */
function shiftDateByOneYear(ymd: string): string {
  const d = parseLocalYmd(ymd);
  d.setFullYear(d.getFullYear() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Helper mirrored from addMonths (client-side version) for the loader.
function addMonthsHelper(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  console.info(`[sales-goals] action intent=${intent ?? "?"} shop=${shop}`);

  if (intent === "save-goal") {
    const goalJson = formData.get("goal");
    if (typeof goalJson !== "string") {
      return { ok: false, error: "Goal payload missing." };
    }
    const goal = JSON.parse(goalJson) as SalesGoal;
    const current = await prisma.salesGoalsConfig.findUnique({
      where: { shop },
    });
    const goals = (current?.data as SalesGoal[] | null) ?? [];
    // Replace any existing goal for the same (locationId, month); id is ignored
    // on duplicate so the form can post new ids each time without creating
    // orphan entries.
    const updated = goals
      .filter(
        (item) =>
          !(item.locationId === goal.locationId && item.month === goal.month),
      )
      .concat(goal);
    await prisma.salesGoalsConfig.upsert({
      where: { shop },
      update: { data: updated },
      create: { shop, data: updated },
    });
    console.info(
      `[sales-goals] save-goal OK shop=${shop} location=${goal.locationId} month=${goal.month}`,
    );
    return { ok: true };
  }

  if (intent === "bulk-save-goals") {
    const goalsJson = formData.get("goals");
    if (typeof goalsJson !== "string") {
      return { ok: false, error: "Bulk goals payload missing." };
    }
    const incoming = JSON.parse(goalsJson) as SalesGoal[];
    const current = await prisma.salesGoalsConfig.findUnique({
      where: { shop },
    });
    const existing = (current?.data as SalesGoal[] | null) ?? [];
    // Replace per (location, month)
    const keyOf = (g: SalesGoal) => `${g.locationId}__${g.month}`;
    const map = new Map<string, SalesGoal>();
    for (const g of existing) map.set(keyOf(g), g);
    for (const g of incoming) map.set(keyOf(g), g);
    const merged = Array.from(map.values());
    await prisma.salesGoalsConfig.upsert({
      where: { shop },
      update: { data: merged },
      create: { shop, data: merged },
    });
    console.info(
      `[sales-goals] bulk-save-goals OK shop=${shop} count=${incoming.length}`,
    );
    return { ok: true };
  }

  if (intent === "delete-goal") {
    const goalId = formData.get("goalId");
    if (typeof goalId !== "string") {
      return { ok: false, error: "Goal id missing." };
    }
    const current = await prisma.salesGoalsConfig.findUnique({
      where: { shop },
    });
    const goals = (current?.data as SalesGoal[] | null) ?? [];
    const updated = goals.filter((item) => item.id !== goalId);
    await prisma.salesGoalsConfig.upsert({
      where: { shop },
      update: { data: updated },
      create: { shop, data: updated },
    });
    console.info(`[sales-goals] delete-goal OK shop=${shop}`);
    return { ok: true };
  }

  if (intent === "save-location-config") {
    const locationId = formData.get("locationId");
    const configJson = formData.get("config");
    if (typeof locationId !== "string" || typeof configJson !== "string") {
      return { ok: false, error: "Location config payload missing." };
    }
    const config = JSON.parse(configJson) as LocationConfig;
    await prisma.salesGoalsLocationConfig.upsert({
      where: { shop_locationId: { shop, locationId } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { data: config as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { shop, locationId, data: config as any },
    });
    console.info(
      `[sales-goals] save-location-config OK shop=${shop} locationId=${locationId}`,
    );
    return { ok: true };
  }

  if (intent === "sync-now") {
    // Fire-and-forget. The loader will show sync meta progress.
    runSalesGoalsSync(admin, shop, MONTHS_BACK + 1).catch((err) =>
      console.error(`[sales-goals] sync-now error shop=${shop}`, err),
    );
    console.info(`[sales-goals] sync-now kicked off shop=${shop}`);
    return { ok: true };
  }

  if (intent === "create-campaign" || intent === "update-campaign") {
    const name = String(formData.get("name") ?? "").trim();
    const startDate = String(formData.get("startDate") ?? "").trim();
    const endDate = String(formData.get("endDate") ?? "").trim();
    const metric = (String(formData.get("metric") ?? "bundle_orders") ||
      "bundle_orders") as CampaignMetric;
    const matchRuleJson = String(formData.get("matchRule") ?? "null");
    const targetsJson = String(formData.get("targets") ?? "[]");
    if (!name || !startDate || !endDate) {
      return { ok: false, error: "Missing required campaign fields." };
    }
    let matchRule: CampaignMatchRule;
    let targets: Array<{
      locationId: string;
      locationName: string;
      targetOrders: number;
      baselineOrders: number | null;
    }>;
    try {
      matchRule = JSON.parse(matchRuleJson) as CampaignMatchRule;
      targets = JSON.parse(targetsJson);
    } catch {
      return { ok: false, error: "Malformed campaign payload." };
    }
    if (intent === "create-campaign") {
      await createCampaign(shop, {
        name,
        startDate,
        endDate,
        metric,
        matchRule,
        targets,
      });
    } else {
      const id = String(formData.get("id") ?? "");
      if (!id) return { ok: false, error: "Campaign id missing." };
      await updateCampaign(shop, id, {
        name,
        startDate,
        endDate,
        metric,
        matchRule,
        targets,
      });
    }
    return { ok: true };
  }

  if (intent === "archive-campaign") {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, error: "Campaign id missing." };
    const ok = await archiveCampaignStore(shop, id);
    return { ok };
  }

  if (intent === "fetch-match-options") {
    const ruleType = String(formData.get("ruleType") ?? "");
    const query = String(formData.get("query") ?? "");
    let options: Array<{ value: string; label: string }> = [];

    switch (ruleType) {
      case "lineItemTag": {
        const res = await admin.graphql(
          `#graphql
          query ProductsByTag($query: String!) {
            products(first: 50, query: $query) {
              edges { node { tags } }
            }
          }`,
          { variables: { query: query ? `tag:${query}*` : "" } },
        );
        const json = await res.json();
        const allTags = new Set<string>();
        for (const edge of json.data?.products?.edges ?? []) {
          for (const tag of edge.node.tags ?? []) allTags.add(tag);
        }
        options = Array.from(allTags)
          .sort()
          .map((t) => ({ value: t, label: t }));
        break;
      }
      case "lineItemProductType": {
        const { fetchProductTypes } = await import(
          "../services/bulk-price/campaign.server"
        );
        const types = await fetchProductTypes(admin);
        options = types.map((t) => ({ value: t, label: t }));
        break;
      }
      case "lineItemProductId": {
        const res = await admin.graphql(
          `#graphql
          query SearchProducts($query: String!) {
            products(first: 20, query: $query, sortKey: UPDATED_AT, reverse: true) {
              edges { node { id title } }
            }
          }`,
          { variables: { query: query || "" } },
        );
        const json = await res.json();
        options = (json.data?.products?.edges ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => ({ value: e.node.id, label: e.node.title }),
        );
        break;
      }
      case "orderTag": {
        const res = await admin.graphql(
          `#graphql
          query OrdersByTag($query: String!) {
            orders(first: 50, query: $query) {
              edges { node { tags } }
            }
          }`,
          { variables: { query: query ? `tag:${query}*` : "" } },
        );
        const json = await res.json();
        const allTags = new Set<string>();
        for (const edge of json.data?.orders?.edges ?? []) {
          for (const tag of edge.node.tags ?? []) allTags.add(tag);
        }
        options = Array.from(allTags)
          .sort()
          .map((t) => ({ value: t, label: t }));
        break;
      }
    }
    return { ok: true, intent: "fetch-match-options", options };
  }

  if (intent === "fetch-campaign-baseline") {
    const { getBaselineData } = await import(
      "../campaign-goals/storage.server"
    );
    const period = String(formData.get("period") ?? "");
    const campaignStart = String(formData.get("campaignStart") ?? "");
    const campaignEnd = String(formData.get("campaignEnd") ?? "");
    if (!campaignStart || !campaignEnd) {
      return { ok: false, error: "Campaign dates required for baseline." };
    }
    const start = parseLocalYmd(campaignStart);
    const end = parseLocalYmd(campaignEnd);

    let periodStart: Date;
    let periodEnd: Date;
    switch (period) {
      case "last_month": {
        periodEnd = new Date(start);
        periodStart = new Date(start);
        periodStart.setMonth(periodStart.getMonth() - 1);
        break;
      }
      case "last_quarter": {
        periodEnd = new Date(start);
        periodStart = new Date(start);
        periodStart.setMonth(periodStart.getMonth() - 3);
        break;
      }
      default: {
        periodStart = new Date(start);
        periodStart.setFullYear(periodStart.getFullYear() - 1);
        periodEnd = new Date(end);
        periodEnd.setFullYear(periodEnd.getFullYear() - 1);
        break;
      }
    }

    const baseline = await getBaselineData(shop, periodStart, periodEnd);
    return { ok: true, intent: "fetch-campaign-baseline", baseline };
  }

  if (intent === "fetch-dashboard-period") {
    const preset = String(formData.get("preset") ?? "this_month") as PeriodPreset;
    const mode = String(formData.get("compareMode") ?? "prev_year") as ComparisonMode;
    const customStart = formData.get("customStart")
      ? String(formData.get("customStart"))
      : undefined;
    const customEnd = formData.get("customEnd")
      ? String(formData.get("customEnd"))
      : undefined;

    const resolved = resolvePeriod(preset, mode, customStart, customEnd);
    if (!resolved) {
      return { ok: false, error: "Invalid period selection." };
    }

    const started = Date.now();

    // Re-fetch the active locations the same way the loader does, so the action
    // stays source-of-truth-free (nothing baked into formData).
    const locationsResponse = await admin.graphql(LOCATIONS_QUERY);
    const locationsJson = await locationsResponse.json();
    const rawLocations = (locationsJson.data?.locations?.nodes ?? []) as Array<{
      id: string;
      name: string;
      isActive?: boolean;
      isFulfillmentService?: boolean;
      fulfillmentService?: { id: string } | null;
    }>;
    const candidateLocations = filterCandidateLocations(rawLocations);

    // Pull per-location active flags from config, same as loader.
    const locationConfigRows = await prisma.salesGoalsLocationConfig.findMany({
      where: { shop },
    });
    const disabledIds = new Set<string>();
    for (const row of locationConfigRows) {
      const cfg = normalizeLocationConfig(row.data);
      if (cfg.enabled === false) disabledIds.add(row.locationId);
    }
    const activeLocations = candidateLocations.filter(
      (l) => !disabledIds.has(l.id),
    );
    const activeIds = activeLocations.map((l) => l.id);

    // Period + compare aggregates.
    const [currentRows, compareRows, zeroDaysCurrent, zeroDaysCompare] =
      await Promise.all([
        queryRangeAggregates(shop, activeIds, resolved.start, resolved.end),
        resolved.compareStart && resolved.compareEnd
          ? queryRangeAggregates(
              shop,
              activeIds,
              resolved.compareStart,
              resolved.compareEnd,
            )
          : Promise.resolve([] as RangeAggregateRow[]),
        countZeroRevenueDaysInRange(
          shop,
          activeIds,
          resolved.start,
          resolved.end,
        ),
        resolved.compareStart && resolved.compareEnd
          ? countZeroRevenueDaysInRange(
              shop,
              activeIds,
              resolved.compareStart,
              resolved.compareEnd,
            )
          : Promise.resolve({} as Record<string, number>),
      ]);

    // Current-month projection only when the period *is* the current month in progress.
    let projectionByLocation: Record<string, MonthProjection> | null = null;
    if (resolved.isSingleMonth && resolved.includesToday) {
      projectionByLocation = await computeCurrentMonthProjection(
        shop,
        activeIds,
      );
    }

    // Goals for the period — only loaded when the period covers a single
    // calendar month (otherwise goals don't translate cleanly).
    const goalsByLocation: Record<string, number> = {};
    let storesWithGoalsCount = 0;
    if (resolved.isSingleMonth && resolved.monthKey) {
      const configRecord = await prisma.salesGoalsConfig.findUnique({
        where: { shop },
      });
      const goals = (configRecord?.data as SalesGoal[] | null) ?? [];
      for (const g of goals) {
        if (g.month === resolved.monthKey) {
          goalsByLocation[g.locationId] = g.target;
          storesWithGoalsCount += 1;
        }
      }
    }

    const snapshots = buildSnapshotsFromRange({
      locations: activeLocations.map((l) => ({ id: l.id, name: l.name })),
      currentRows,
      compareRows,
      zeroDaysCurrent,
      zeroDaysCompare,
      projectionByLocation,
      goalsByLocation,
      isSingleMonth: resolved.isSingleMonth,
    });

    // 13-mo discount aggregate for the trailing-discount stat on the discount card.
    const thirteenMonths = buildMonthRange(12);
    const thirteenMonthAggregates = await queryMonthlyAggregates(
      shop,
      thirteenMonths,
      activeIds,
    );

    const threshold = scaleZeroDayThreshold(resolved.periodDays);
    const kpis = {
      revenue: aggregateSnapshots(snapshots, "revenue"),
      aov: aggregateSnapshots(snapshots, "aov"),
      orders: aggregateSnapshots(snapshots, "orders"),
      sameStoreYoY: sameStoreYoY(snapshots, threshold),
      bestVsWorst: bestVsWorst(snapshots),
      discountRate: discountRate(snapshots, thirteenMonthAggregates),
    };

    // ── Prior-year-equivalent window for literal YoY on AOV/Orders cards ───
    // Shift the primary period back by one year. If comparison is already
    // prev_year, reuse compareRows to avoid a duplicate query.
    let prevYearAggregates: RangeAggregateRow[];
    if (mode === "prev_year" && compareRows.length > 0) {
      prevYearAggregates = compareRows;
    } else {
      const pyStart = shiftDateByOneYear(resolved.start);
      const pyEnd = shiftDateByOneYear(resolved.end);
      prevYearAggregates = await queryRangeAggregates(
        shop,
        activeIds,
        pyStart,
        pyEnd,
      );
    }

    // ── Prorated MTD goal (single-month only) ────────────────────────────
    let proratedMtdGoal: number | null = null;
    if (resolved.isSingleMonth && resolved.monthKey) {
      const totalGoal = Object.values(goalsByLocation).reduce(
        (sum, g) => sum + g,
        0,
      );
      if (totalGoal > 0) {
        const elapsedDays = resolved.periodDays; // start to end inclusive
        const [y, m] = resolved.monthKey.split("-").map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        proratedMtdGoal = totalGoal * (elapsedDays / daysInMonth);
      }
    }

    // Pick a currency code off any row (stores share currency per shop).
    const currencyCode =
      currentRows.find((r) => r.currencyCode)?.currencyCode ??
      compareRows.find((r) => r.currencyCode)?.currencyCode ??
      "BRL";

    const elapsed = Date.now() - started;
    console.info(
      `[retail-sales] fetch-dashboard-period OK shop=${shop} preset=${preset} compare=${mode} locations=${activeIds.length} isSingleMonth=${resolved.isSingleMonth} durationMs=${elapsed}`,
    );

    return {
      ok: true,
      intent: "fetch-dashboard-period" as const,
      stats: {
        period: resolved,
        snapshots,
        kpis,
        currencyCode,
        storesWithGoalsCount,
        locationsCount: activeLocations.length,
        prevYearAggregates,
        proratedMtdGoal,
      },
    };
  }

  return { ok: false, error: "Unsupported request." };
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

// ─── Inline sub-components ────────────────────────────────────────────────────

const Delta = ({ delta }: { delta: number | null | undefined }) => {
  if (delta == null || !Number.isFinite(delta)) return null;
  const cls = delta >= 0 ? styles.deltaUp : styles.deltaDown;
  const sign = delta >= 0 ? "+" : "";
  return (
    <span className={`${styles.delta} ${cls}`}>
      {sign}
      {delta.toFixed(1)}%
    </span>
  );
};

const Sparkline = ({
  values,
  width = 100,
  height = 24,
}: {
  values: number[];
  width?: number;
  height?: number;
}) => {
  if (values.length === 0) {
    return <span className={styles.sparklineEmpty}>—</span>;
  }
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={styles.sparklineSvg}
      aria-hidden="true"
    >
      <polyline points={points} fill="none" stroke="#008060" strokeWidth="1.5" />
    </svg>
  );
};

// ─── Rich KPI card (Dashboard redesign) ──────────────────────────────────────

type KpiRichLine = {
  label: string;
  value: string;
  delta?: number | null;
};

type KpiRichCardProps = {
  title: string;
  primary: string;
  primaryColor?: string;
  primaryDelta?: number | null;
  primaryDeltaSuffix?: string;
  projected?: { value: string; early?: boolean } | null;
  lines?: KpiRichLine[];
  tooltip?: string;
  active?: boolean;
  onClick?: () => void;
};

const KpiRichCard = ({
  title,
  primary,
  primaryColor,
  primaryDelta,
  primaryDeltaSuffix,
  projected,
  lines,
  tooltip,
  active,
  onClick,
}: KpiRichCardProps) => {
  const clickableClass = `${styles.kpiCardClickable}${active ? ` ${styles.kpiCardActive}` : ""}`;
  return (
    <div
      className={clickableClass}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <div className={styles.kpiRichCard}>
          <div className={styles.kpiRichTitle} title={tooltip}>
            {title}
            {tooltip ? <span className={styles.kpiInfoIcon}><s-icon type="info" /></span> : null}
          </div>
          <div className={styles.kpiRichPrimary}>
            <span className={styles.kpiValue} style={primaryColor ? { color: primaryColor } : undefined}>{primary}</span>
            {primaryDelta != null ? (
              <span className={styles.kpiDeltaInline}>
                {primaryDeltaSuffix ? `${primaryDeltaSuffix} ` : null}
                <Delta delta={primaryDelta} />
              </span>
            ) : null}
          </div>
          {projected ? (
            <div
              className={
                projected.early ? styles.kpiProjEarly : styles.kpiProj
              }
            >
              {projected.value}
            </div>
          ) : null}
          {lines?.map((line) => (
            <div key={line.label} className={styles.kpiRichLine}>
              <span>
                {line.label}
                {line.label && line.value ? " " : null}
                {line.value}
              </span>
              {line.delta != null ? <Delta delta={line.delta} /> : null}
            </div>
          ))}
        </div>
      </s-box>
    </div>
  );
};

// ─── KPI drilldown bar chart ─────────────────────────────────────────────────

type KpiMetric =
  | "revenue"
  | "aov"
  | "orders"
  | "sameStore"
  | "bestWorst"
  | "discount";

type KpiDrilldownBarsProps = {
  metric: KpiMetric;
  snapshots: LocationSnapshot[];
  currencyCode: string;
  locale: string;
  isCurrentMonthEarly: boolean;
  isViewingCurrentMonth: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

type BarRow = {
  locationId: string;
  name: string;
  pyValue: number;
  currentValue: number;
  mtdValue: number;
  goalValue: number | null;
  achievement: number | null;
  yoyPercent: number | null;
  deltaPercent: number | null; // for sameStore (signed)
  ratePercent: number | null;   // for discount/bestWorst (0..N)
  pyRatePercent: number | null;
};

/** Build per-location bar rows shaped for the metric under drilldown. */
function buildBarRows(
  metric: KpiMetric,
  snapshots: LocationSnapshot[],
): BarRow[] {
  return snapshots.map((s) => {
    if (metric === "aov") {
      const mtdAov = s.mtdOrders > 0 ? s.mtdRevenue / s.mtdOrders : 0;
      const pyAov = s.pyOrders > 0 ? s.pyRevenue / s.pyOrders : 0;
      const projOrders = s.projectedOrders;
      const projAov =
        s.projectedRevenue != null && projOrders != null && projOrders > 0
          ? s.projectedRevenue / projOrders
          : mtdAov;
      return {
        locationId: s.locationId,
        name: s.locationName,
        pyValue: pyAov,
        currentValue: projAov,
        mtdValue: mtdAov,
        goalValue: null,
        achievement: null,
        yoyPercent: pyAov > 0 ? ((projAov - pyAov) / pyAov) * 100 : null,
        deltaPercent: null,
        ratePercent: null,
        pyRatePercent: null,
      };
    }
    if (metric === "orders") {
      return {
        locationId: s.locationId,
        name: s.locationName,
        pyValue: s.pyOrders,
        currentValue: s.projectedOrders ?? s.mtdOrders,
        mtdValue: s.mtdOrders,
        goalValue: null,
        achievement: null,
        yoyPercent:
          s.pyOrders > 0 && s.projectedOrders != null
            ? ((s.projectedOrders - s.pyOrders) / s.pyOrders) * 100
            : null,
        deltaPercent: null,
        ratePercent: null,
        pyRatePercent: null,
      };
    }
    if (metric === "sameStore") {
      const cur = s.projectedRevenue ?? s.mtdRevenue;
      const delta =
        s.pyRevenue > 0 ? ((cur - s.pyRevenue) / s.pyRevenue) * 100 : null;
      return {
        locationId: s.locationId,
        name: s.locationName,
        pyValue: s.pyRevenue,
        currentValue: cur,
        mtdValue: s.mtdRevenue,
        goalValue: null,
        achievement: null,
        yoyPercent: null,
        deltaPercent: delta,
        ratePercent: null,
        pyRatePercent: null,
      };
    }
    if (metric === "bestWorst") {
      const proj = s.projectedRevenue;
      const ach =
        s.goal != null && s.goal > 0 && proj != null
          ? (proj / s.goal) * 100
          : null;
      return {
        locationId: s.locationId,
        name: s.locationName,
        pyValue: 0,
        currentValue: ach ?? 0,
        mtdValue: 0,
        goalValue: null,
        achievement: ach,
        yoyPercent: null,
        deltaPercent: null,
        ratePercent: ach,
        pyRatePercent: null,
      };
    }
    if (metric === "discount") {
      const mtdGross = s.mtdRevenue + s.mtdDiscounts;
      const pyGross = s.pyRevenue + s.pyDiscounts;
      const curRate = mtdGross > 0 ? (s.mtdDiscounts / mtdGross) * 100 : 0;
      const pyRate = pyGross > 0 ? (s.pyDiscounts / pyGross) * 100 : 0;
      return {
        locationId: s.locationId,
        name: s.locationName,
        pyValue: pyRate,
        currentValue: curRate,
        mtdValue: curRate,
        goalValue: null,
        achievement: null,
        yoyPercent: null,
        deltaPercent: null,
        ratePercent: curRate,
        pyRatePercent: pyRate,
      };
    }
    // revenue (default)
    const cur = s.projectedRevenue ?? s.mtdRevenue;
    const ach =
      s.goal != null && s.goal > 0 ? (cur / s.goal) * 100 : null;
    return {
      locationId: s.locationId,
      name: s.locationName,
      pyValue: s.pyRevenue,
      currentValue: cur,
      mtdValue: s.mtdRevenue,
      goalValue: s.goal,
      achievement: ach,
      yoyPercent:
        s.pyRevenue > 0 ? ((cur - s.pyRevenue) / s.pyRevenue) * 100 : null,
      deltaPercent: null,
      ratePercent: null,
      pyRatePercent: null,
    };
  });
}

/** Sort bar rows descending by the metric's natural ranking direction. */
function sortBarRows(metric: KpiMetric, rows: BarRow[]): BarRow[] {
  const sorted = [...rows];
  if (metric === "sameStore") {
    // Only keep qualifying locations (PY revenue > 0 AND deltaPercent computable)
    return sorted
      .filter((r) => r.deltaPercent != null)
      .sort((a, b) => (b.deltaPercent ?? 0) - (a.deltaPercent ?? 0));
  }
  if (metric === "bestWorst") {
    return sorted
      .filter((r) => r.achievement != null)
      .sort((a, b) => (b.achievement ?? 0) - (a.achievement ?? 0));
  }
  if (metric === "discount") {
    return sorted.sort((a, b) => b.currentValue - a.currentValue);
  }
  return sorted.sort((a, b) => b.currentValue - a.currentValue);
}

// Round up to a visually pleasant scale ceiling (1, 1.25, 1.5, 2, 2.5, 5, 10).
function niceCeil(max: number): number {
  if (!(max > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const candidates = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const c of candidates) {
    const nice = c * magnitude;
    if (nice >= max) return nice;
  }
  return 10 * magnitude;
}

type PeriodLabels = {
  current: string;
  priorYear: string;
  goalPeriod?: string;
};

const KpiDrilldownBars = ({
  metric,
  snapshots,
  currencyCode,
  locale,
  t,
}: KpiDrilldownBarsProps) => {
  const rows = buildBarRows(metric, snapshots);
  const sorted = sortBarRows(metric, rows);

  const fmtAbs = (value: number) =>
    fmtCurrencyBase(Math.round(value), currencyCode, locale);
  const fmtCompact = (value: number) =>
    formatCurrencyCompact(value, currencyCode, locale, 0);
  const fmtOrders = (value: number) => Math.round(value).toLocaleString(locale);
  const fmtPct0 = (v: number) => `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(0)}%`;
  const fmtPctSigned = (v: number) =>
    `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%`;
  const fmtRate1 = (v: number) => `${v.toFixed(1)}%`;

  if (sorted.length === 0) {
    return (
      <div className={styles.revenueDrilldown}>
        <div className={styles.breakdownHeader}>
          <h3 className={styles.subSectionTitle}>
            {t(`dashboard.drilldown.${metric}`)}
          </h3>
        </div>
        <div className={styles.tableEmpty}>{t("dashboard.noLocations")}</div>
      </div>
    );
  }

  // ── Achievement ranking (formerly bestWorst) ────────────────────────────
  if (metric === "bestWorst") {
    return (
      <div className={styles.revenueDrilldown}>
        <div className={styles.breakdownHeader}>
          <h3 className={styles.subSectionTitle}>
            {t("dashboard.drilldown.bestWorst")}
          </h3>
          <div className={styles.breakdownSubtitle}>
            {t("dashboard.rankingSubtitle")}
          </div>
        </div>
        <div className={styles.rankList}>
          {sorted.map((row, idx) => {
            const ach = row.achievement ?? 0;
            const tierClass =
              ach >= 80
                ? styles.rankFillGreen
                : ach >= 60
                  ? styles.rankFillYellow
                  : styles.rankFillRed;
            const tierPctClass =
              ach >= 80
                ? styles.rankPctGreen
                : ach >= 60
                  ? styles.rankPctYellow
                  : styles.rankPctRed;
            return (
              <div key={row.locationId} className={styles.rankRow} tabIndex={0}>
                <div className={styles.rankPos}>{idx + 1}</div>
                <div className={styles.rankName}>{row.name}</div>
                <div className={styles.rankTrack}>
                  <div
                    className={`${styles.rankFill} ${tierClass}`}
                    style={{ width: `${Math.min(ach, 100)}%` }}
                  />
                </div>
                <div className={`${styles.rankPct} ${tierPctClass}`}>
                  {fmtPct0(ach)}
                </div>
                <div className={styles.barTooltip}>
                  <strong>{row.name}</strong>
                  <div className={styles.barTooltipRow}>
                    <span>{t("dashboard.tooltip.projected")}</span>
                    <span className="val">{fmtAbs(row.currentValue)}</span>
                  </div>
                  {row.goalValue != null ? (
                    <div className={styles.barTooltipRow}>
                      <span>{t("dashboard.tooltip.goal")}</span>
                      <span className="val">{fmtAbs(row.goalValue)}</span>
                    </div>
                  ) : null}
                  <div className={styles.barTooltipRow}>
                    <span>{t("dashboard.tooltip.vsGoal")}</span>
                    <span
                      className={`val ${ach >= 100 ? styles.valPos : styles.valNeg}`}
                    >
                      {fmtPct0(ach)}
                    </span>
                  </div>
                  <div className={styles.barTooltipRow}>
                    <span>{t("dashboard.tooltip.rank")}</span>
                    <span className="val">
                      {t("dashboard.tooltip.rankValue", {
                        pos: idx + 1,
                        total: sorted.length,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.chartLegend}>
          <span>
            <i className={`${styles.rankSwatch} ${styles.rankSwatchGreen}`} />{" "}
            {t("dashboard.rankingTierGreen")}
          </span>
          <span>
            <i className={`${styles.rankSwatch} ${styles.rankSwatchYellow}`} />{" "}
            {t("dashboard.rankingTierYellow")}
          </span>
          <span>
            <i className={`${styles.rankSwatch} ${styles.rankSwatchRed}`} />{" "}
            {t("dashboard.rankingTierRed")}
          </span>
        </div>
      </div>
    );
  }

  // ── Same-store YoY (dynamic baseline) ────────────────────────────────────
  if (metric === "sameStore") {
    const deltas = sorted.map((r) => r.deltaPercent ?? 0);
    const hasPos = deltas.some((d) => d > 0);
    const hasNeg = deltas.some((d) => d < 0);
    const maxPos = hasPos ? Math.max(...deltas.filter((d) => d > 0)) : 0;
    const maxNeg = hasNeg ? Math.max(...deltas.filter((d) => d < 0).map((d) => -d)) : 0;
    const niceMax = hasPos ? niceCeil(maxPos) : 0;
    const niceMin = hasNeg ? niceCeil(maxNeg) : 0; // absolute
    const totalRange = niceMax + niceMin;
    const baselinePct = totalRange > 0 ? (niceMax / totalRange) * 100 : 100; // from top

    // 5 ticks evenly distributed, rounded to a clean step.
    const ticks: Array<{ label: string; topPct: number }> = [];
    if (hasPos && hasNeg) {
      ticks.push({ label: `+${niceMax.toFixed(0)}%`, topPct: 0 });
      ticks.push({
        label: `+${(niceMax / 2).toFixed(0)}%`,
        topPct: baselinePct / 2,
      });
      ticks.push({ label: "0%", topPct: baselinePct });
      ticks.push({
        label: `−${(niceMin / 2).toFixed(0)}%`,
        topPct: baselinePct + (100 - baselinePct) / 2,
      });
      ticks.push({ label: `−${niceMin.toFixed(0)}%`, topPct: 100 });
    } else if (hasPos) {
      for (let i = 0; i < 5; i += 1) {
        const frac = 1 - i / 4;
        ticks.push({
          label: `+${(niceMax * frac).toFixed(0)}%`,
          topPct: (i / 4) * 100,
        });
      }
      ticks[4] = { label: "0%", topPct: 100 };
    } else {
      for (let i = 0; i < 5; i += 1) {
        const frac = i / 4;
        ticks.push({
          label: frac === 0 ? "0%" : `−${(niceMin * frac).toFixed(0)}%`,
          topPct: (i / 4) * 100,
        });
      }
    }

    return (
      <div className={styles.revenueDrilldown}>
        <div className={styles.breakdownHeader}>
          <h3 className={styles.subSectionTitle}>
            {t("dashboard.drilldown.sameStore")}
          </h3>
          <div className={styles.breakdownSubtitle}>
            {t("dashboard.sameStoreSubtitle")}
          </div>
        </div>
        <div className={styles.chartFrame}>
          <div className={styles.chartYAxis}>
            {ticks.map((tk, i) => (
              <div key={i} className={styles.yTick} style={{ top: `${tk.topPct}%` }}>
                {tk.label}
              </div>
            ))}
          </div>
          <div className={styles.chartPlot}>
            {ticks.map((tk, i) => (
              <div
                key={i}
                className={`${styles.gridline}${tk.label === "0%" ? ` ${styles.gridlineZero}` : ""}`}
                style={{ top: `${tk.topPct}%` }}
              />
            ))}
            <div className={styles.chartBars}>
              {sorted.map((row) => {
                const delta = row.deltaPercent ?? 0;
                const positive = delta > 0;
                const barHeightPct = positive
                  ? niceMax > 0
                    ? (delta / niceMax) * baselinePct
                    : 0
                  : niceMin > 0
                    ? (-delta / niceMin) * (100 - baselinePct)
                    : 0;
                return (
                  <div key={row.locationId} className={styles.barGroup} tabIndex={0}>
                    {positive ? (
                      <>
                        <div
                          className={`${styles.yoyBar} ${styles.yoyBarPos}`}
                          style={{
                            bottom: `${100 - baselinePct}%`,
                            height: `${barHeightPct}%`,
                          }}
                        />
                        <div
                          className={`${styles.yoyBarLabel} ${styles.yoyBarLabelPos}`}
                          style={{
                            bottom: `calc(${100 - baselinePct}% + ${barHeightPct}% + 4px)`,
                          }}
                        >
                          {fmtPctSigned(delta)}
                        </div>
                      </>
                    ) : delta < 0 ? (
                      <>
                        <div
                          className={`${styles.yoyBar} ${styles.yoyBarNeg}`}
                          style={{
                            top: `${baselinePct}%`,
                            height: `${barHeightPct}%`,
                          }}
                        />
                        <div
                          className={`${styles.yoyBarLabel} ${styles.yoyBarLabelNeg}`}
                          style={{
                            top: `calc(${baselinePct}% + ${barHeightPct}% + 4px)`,
                          }}
                        >
                          {fmtPctSigned(delta)}
                        </div>
                      </>
                    ) : (
                      <div
                        className={`${styles.yoyBarLabel} ${styles.yoyBarLabelFlat}`}
                        style={{ top: `calc(${baselinePct}% + 4px)` }}
                      >
                        0%
                      </div>
                    )}
                    <div className={styles.barTooltip} style={{ top: -95 }}>
                      <strong>{row.name}</strong>
                      <div className={styles.barTooltipRow}>
                        <span>{t("dashboard.tooltip.currentPeriod")}</span>
                        <span className="val">{fmtAbs(row.currentValue)}</span>
                      </div>
                      <div className={styles.barTooltipRow}>
                        <span>{t("dashboard.tooltip.priorPeriod")}</span>
                        <span className="val">{fmtAbs(row.pyValue)}</span>
                      </div>
                      <div className={styles.barTooltipRow}>
                        <span>{t("dashboard.tooltip.yoy")}</span>
                        <span
                          className={`val ${delta > 0 ? styles.valPos : delta < 0 ? styles.valNeg : ""}`}
                        >
                          {fmtPctSigned(delta)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className={styles.chartXAxis}>
          {sorted.map((row) => (
            <div key={row.locationId} className={styles.chartXLabel}>
              {row.name}
            </div>
          ))}
        </div>
        <div className={styles.chartLegend}>
          <span>
            <i className={`${styles.legendDot} ${styles.legendDotPos}`} />{" "}
            {t("dashboard.legendGrowth")}
          </span>
          <span>
            <i className={`${styles.legendDot} ${styles.legendDotNeg}`} />{" "}
            {t("dashboard.legendDecline")}
          </span>
        </div>
      </div>
    );
  }

  // ── Bar chart: revenue / orders / aov / discount ─────────────────────────
  const hasProjectionSplit = metric === "revenue" || metric === "orders";
  const hasGoalMark = metric === "revenue";
  const isRate = metric === "discount";
  const useOrdersFmt = metric === "orders";

  const formatBarValue = (v: number) =>
    isRate ? fmtRate1(v) : useOrdersFmt ? fmtOrders(v) : fmtAbs(v);
  const formatCompactLabel = (v: number) =>
    isRate ? fmtRate1(v) : useOrdersFmt ? fmtOrders(v) : fmtCompact(v);

  const scaleMax = sorted.reduce((m, r) => {
    const goal = hasGoalMark && r.goalValue != null ? r.goalValue : 0;
    return Math.max(m, r.currentValue, r.pyValue, goal);
  }, 0);
  const niceScale = niceCeil(scaleMax);

  const ticks = Array.from({ length: 5 }, (_, i) => {
    const frac = 1 - i / 4;
    const value = niceScale * frac;
    return {
      label: formatCompactLabel(value),
      topPct: (i / 4) * 100,
    };
  });

  return (
    <div className={styles.revenueDrilldown}>
      <div className={styles.breakdownHeader}>
        <h3 className={styles.subSectionTitle}>
          {t(`dashboard.drilldown.${metric}`)}
        </h3>
        <div className={styles.breakdownSubtitle}>
          {hasGoalMark
            ? t("dashboard.revenueSubtitle")
            : t("dashboard.comparisonSubtitle")}
        </div>
      </div>
      <div className={styles.chartFrame}>
        <div className={styles.chartYAxis}>
          {ticks.map((tk, i) => (
            <div key={i} className={styles.yTick} style={{ top: `${tk.topPct}%` }}>
              {tk.label}
            </div>
          ))}
        </div>
        <div className={styles.chartPlot}>
          {ticks.map((tk, i) => (
            <div
              key={i}
              className={`${styles.gridline}${i === ticks.length - 1 ? ` ${styles.gridlineZero}` : ""}`}
              style={{ top: `${tk.topPct}%` }}
            />
          ))}
          <div className={styles.chartBars}>
            {sorted.map((row) => {
              const curPct = niceScale > 0 ? (row.currentValue / niceScale) * 100 : 0;
              const pyPct = niceScale > 0 ? (row.pyValue / niceScale) * 100 : 0;
              const goalPct =
                hasGoalMark && row.goalValue != null && niceScale > 0
                  ? (row.goalValue / niceScale) * 100
                  : null;
              const projRatio =
                hasProjectionSplit && row.currentValue > 0
                  ? Math.max(0, row.currentValue - row.mtdValue) / row.currentValue
                  : 0;
              return (
                <div key={row.locationId} className={styles.barGroup} tabIndex={0}>
                  {hasProjectionSplit ? (
                    <div
                      className={styles.barCurrent}
                      style={{ height: `${curPct}%` }}
                    >
                      <div
                        className={styles.barProjection}
                        style={{ height: `${projRatio * 100}%` }}
                      />
                    </div>
                  ) : (
                    <div
                      className={styles.barCurrentSolid}
                      style={{ height: `${curPct}%` }}
                    />
                  )}
                  <div className={styles.barPy} style={{ height: `${pyPct}%` }} />
                  {goalPct != null ? (
                    <div
                      className={styles.goalMark}
                      style={{ bottom: `${Math.min(goalPct, 100)}%` }}
                      data-label={formatCompactLabel(row.goalValue!)}
                    />
                  ) : null}
                  <div className={styles.barTooltip} style={{ top: -130 }}>
                    <strong>{row.name}</strong>
                    {hasProjectionSplit ? (
                      <div className={styles.barTooltipRow}>
                        <span>{t("dashboard.tooltip.mtd")}</span>
                        <span className="val">{formatBarValue(row.mtdValue)}</span>
                      </div>
                    ) : null}
                    <div className={styles.barTooltipRow}>
                      <span>
                        {hasProjectionSplit
                          ? t("dashboard.tooltip.projected")
                          : t("dashboard.tooltip.current")}
                      </span>
                      <span className="val">{formatBarValue(row.currentValue)}</span>
                    </div>
                    {row.goalValue != null ? (
                      <div className={styles.barTooltipRow}>
                        <span>{t("dashboard.tooltip.goal")}</span>
                        <span className="val">{formatBarValue(row.goalValue)}</span>
                      </div>
                    ) : null}
                    {row.goalValue != null && row.achievement != null ? (
                      <div className={styles.barTooltipRow}>
                        <span>{t("dashboard.tooltip.vsGoal")}</span>
                        <span
                          className={`val ${row.achievement >= 100 ? styles.valPos : styles.valNeg}`}
                        >
                          {fmtPct0(row.achievement)}
                        </span>
                      </div>
                    ) : null}
                    <div className={styles.barTooltipRow}>
                      <span>{t("dashboard.tooltip.priorYear")}</span>
                      <span className="val">
                        {isRate && row.pyRatePercent != null
                          ? fmtRate1(row.pyRatePercent)
                          : formatBarValue(row.pyValue)}
                      </span>
                    </div>
                    {row.yoyPercent != null ? (
                      <div className={styles.barTooltipRow}>
                        <span>{t("dashboard.tooltip.yoy")}</span>
                        <span
                          className={`val ${row.yoyPercent > 0 ? styles.valPos : row.yoyPercent < 0 ? styles.valNeg : ""}`}
                        >
                          {fmtPctSigned(row.yoyPercent)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className={styles.chartXAxis}>
        {sorted.map((row) => (
          <div key={row.locationId} className={styles.chartXLabel}>
            {row.name}
          </div>
        ))}
      </div>
      {/* Mini stats table (only for revenue): Goal% + YoY. Orders / AOV / Discount: YoY only. */}
      {metric === "revenue" ? (
        <div className={styles.statsTable}>
          <div className={styles.statsRow}>
            <div className={styles.statsLabel}>{t("dashboard.statsGoal")}</div>
            <div className={styles.statsCells}>
              {sorted.map((row) => {
                const ach = row.achievement;
                const cls =
                  ach == null
                    ? styles.statsCellFlat
                    : ach >= 100
                      ? styles.statsCellPos
                      : styles.statsCellNeg;
                return (
                  <div key={row.locationId} className={`${styles.statsCell} ${cls}`}>
                    {ach != null ? fmtPct0(ach) : "—"}
                  </div>
                );
              })}
            </div>
          </div>
          <div className={styles.statsRow}>
            <div className={styles.statsLabel}>{t("dashboard.statsYoY")}</div>
            <div className={styles.statsCells}>
              {sorted.map((row) => {
                const y = row.yoyPercent;
                const cls =
                  y == null
                    ? styles.statsCellFlat
                    : y > 0
                      ? styles.statsCellPos
                      : y < 0
                        ? styles.statsCellNeg
                        : styles.statsCellFlat;
                return (
                  <div key={row.locationId} className={`${styles.statsCell} ${cls}`}>
                    {y != null ? fmtPctSigned(y) : "—"}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : !isRate ? (
        <div className={styles.statsTable}>
          <div className={styles.statsRow}>
            <div className={styles.statsLabel}>{t("dashboard.statsYoY")}</div>
            <div className={styles.statsCells}>
              {sorted.map((row) => {
                const y = row.yoyPercent;
                const cls =
                  y == null
                    ? styles.statsCellFlat
                    : y > 0
                      ? styles.statsCellPos
                      : y < 0
                        ? styles.statsCellNeg
                        : styles.statsCellFlat;
                return (
                  <div key={row.locationId} className={`${styles.statsCell} ${cls}`}>
                    {y != null ? fmtPctSigned(y) : "—"}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {/* Legend */}
      <div className={styles.chartLegend}>
        <span>
          <i
            className={`${styles.legendDot} ${hasProjectionSplit ? styles.legendDotCurrent : styles.legendDotCurrentSolid}`}
          />{" "}
          {hasProjectionSplit
            ? t("dashboard.legendCurrentProjection")
            : t("dashboard.legendCurrent")}
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles.legendDotPy}`} />{" "}
          {t("dashboard.legendPy")}
        </span>
        {hasGoalMark ? (
          <span>
            <i className={styles.legendDash} /> {t("dashboard.legendGoal")}
          </span>
        ) : null}
      </div>
    </div>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SalesGoalsPage() {
  const {
    locations,
    goals,
    monthlyByLocation,
    projectionsByLocation,
    months,
    currentMonth,
    currencyCode: initialCurrencyCode,
    locationConfigs,
    syncMeta,
    dashboardSnapshots,
    dashboardKpis,
    storesWithGoalsCount: initialStoresWithGoalsCount,
    defaultPeriod,
    campaigns,
    campaignProgress,
  } = useLoaderData<LoaderData>();


  const { t, i18n } = useTranslation("sales-goals");
  const locale = i18n.language;

  const saveGoalFetcher = useFetcher<{ ok: boolean }>();
  const deleteGoalFetcher = useFetcher<{ ok: boolean }>();
  const syncFetcher = useFetcher<{ ok: boolean }>();
  const bulkFetcher = useFetcher<{ ok: boolean }>();
  const campaignFetcher = useFetcher<{ ok: boolean }>();
  const matchOptionsFetcher = useFetcher<{
    ok: boolean;
    intent?: string;
    options?: Array<{ value: string; label: string }>;
  }>();
  const baselineFetcher = useFetcher<{
    ok: boolean;
    intent?: string;
    baseline?: Record<string, { orderCount: number; revenue: number }>;
  }>();
  const periodFetcher = useFetcher<
    | { ok: true; intent: "fetch-dashboard-period"; stats: DashboardPeriodStats }
    | { ok: false; error: string }
  >();

  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [goalsMonth, setGoalsMonth] = useState<string>(currentMonth);

  // ── Period state (Dashboard tab) ───────────────────────────────────────────
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("this_month");
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("prev_year");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [customCalendarOpen, setCustomCalendarOpen] = useState(false);
  const prevPresetRef = useRef<PeriodPreset>("this_month");

  // Snapshot / KPI state — seeded from loader for first paint, replaced by
  // the fetch-dashboard-period action response on period changes.
  // Compute initial prevYearAggregates + proratedMtdGoal for the loader's
  // default period (this_month + prev_year). compareRows *are* the prior year.
  const initialPrevYearAggregates: RangeAggregateRow[] = (() => {
    // The loader default uses prev_year comparison, so defaultCompareRows ARE
    // the prior-year aggregates. They are embedded in dashboardSnapshots as
    // pyRevenue/pyOrders — but we need the raw rows for AOV/Orders cards.
    // Reconstruct from snapshots (the loader doesn't serialize raw compare rows).
    return dashboardSnapshots.map((s) => ({
      locationId: s.locationId,
      locationName: s.locationName,
      revenue: s.pyRevenue,
      orderCount: s.pyOrders,
      totalDiscounts: s.pyDiscounts,
      currencyCode: initialCurrencyCode as string | null,
    }));
  })();
  const initialProratedMtdGoal: number | null = (() => {
    if (!defaultPeriod.isSingleMonth || !defaultPeriod.monthKey) return null;
    const totalGoal = dashboardSnapshots.reduce(
      (sum, s) => sum + (s.goal ?? 0),
      0,
    );
    if (totalGoal <= 0) return null;
    const elapsedDays = defaultPeriod.periodDays;
    const [y, m] = defaultPeriod.monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return totalGoal * (elapsedDays / daysInMonth);
  })();

  const [periodStats, setPeriodStats] = useState<DashboardPeriodStats>({
    period: defaultPeriod,
    snapshots: dashboardSnapshots,
    kpis: dashboardKpis,
    currencyCode: initialCurrencyCode,
    storesWithGoalsCount: initialStoresWithGoalsCount,
    locationsCount: dashboardSnapshots.length,
    prevYearAggregates: initialPrevYearAggregates,
    proratedMtdGoal: initialProratedMtdGoal,
  });
  const initialFetchSkippedRef = useRef(false);

  const currencyCode = periodStats.currencyCode;
  const formatCurrency = (value: number, code: string) =>
    fmtCurrencyBase(value, code, locale);
  const formatMonthLabel = (monthStr: string) =>
    fmtMonthBase(monthStr, locale);

  type KpiKey =
    | "revenue"
    | "aov"
    | "orders"
    | "sameStore"
    | "bestWorst"
    | "discount";
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null);
  const toggleKpi = (key: KpiKey) =>
    setActiveKpi((prev) => (prev === key ? null : key));

  // ── Adaptive rendering based on resolved period ────────────────────────────
  // `isSingleMonth` gates goal/projection/Best-vs-Worst visibility.
  // `includesToday` gates the projection (YoY-pace extrapolation for the
  // current month in progress). `isCurrentMonthEarly` italicizes projection
  // labels in the first 5 days of the current month — noise window.
  const isSingleMonth = periodStats.period.isSingleMonth;
  const isViewingCurrentMonth =
    isSingleMonth && periodStats.period.includesToday;
  const isCurrentMonthEarly =
    isViewingCurrentMonth && new Date().getDate() <= 5;

  // Per-location inline edit state for the Goals tab
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  type EditForm = {
    basePeriod: "previous-month" | "previous-year" | "custom";
    customBase: string;
    growthType: "percentage" | "absolute";
    growthValue: string;
  };
  const defaultEditForm: EditForm = {
    basePeriod: "previous-year",
    customBase: "",
    growthType: "percentage",
    growthValue: "5",
  };
  const [editForm, setEditForm] = useState<EditForm>(defaultEditForm);

  // Bulk apply modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState<EditForm>(defaultEditForm);

  // Settings local configs
  const [localConfigs, setLocalConfigs] = useState<
    Record<string, LocationConfig>
  >(() =>
    Object.fromEntries(locationConfigs.map((c) => [c.locationId, c.data])),
  );

  // Refresh local configs if server sends new ones (after a save)
  useEffect(() => {
    setLocalConfigs(
      Object.fromEntries(locationConfigs.map((c) => [c.locationId, c.data])),
    );
  }, [locationConfigs]);

  // Derive enabled locations from LOCAL state so toggles in Settings
  // immediately affect Dashboard and Goals without waiting for revalidation.
  const enabledLocations = useMemo(
    () =>
      locations.filter(
        (loc) => localConfigs[loc.id]?.enabled !== false,
      ),
    [locations, localConfigs],
  );

  // Close inline edit form when goals data changes (save succeeded)
  useEffect(() => {
    if (saveGoalFetcher.data?.ok) setEditingLocationId(null);
  }, [saveGoalFetcher.data]);

  useEffect(() => {
    if (bulkFetcher.data?.ok) setBulkModalOpen(false);
  }, [bulkFetcher.data]);

  // ── Period fetcher (Dashboard tab) ─────────────────────────────────────────

  // Fire a fresh server aggregation whenever the period/compare changes.
  // Skip the very first mount — the loader seeded state for the default view.
  useEffect(() => {
    if (!initialFetchSkippedRef.current) {
      initialFetchSkippedRef.current = true;
      return;
    }
    // Don't re-fetch mid-custom-pick: wait until both drafts applied.
    if (periodPreset === "custom" && (!customStart || !customEnd)) return;
    const fd = new FormData();
    fd.append("intent", "fetch-dashboard-period");
    fd.append("preset", periodPreset);
    fd.append("compareMode", comparisonMode);
    if (periodPreset === "custom") {
      fd.append("customStart", customStart);
      fd.append("customEnd", customEnd);
    }
    periodFetcher.submit(fd, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodPreset, comparisonMode, customStart, customEnd]);

  useEffect(() => {
    if (
      periodFetcher.data?.ok &&
      periodFetcher.data.intent === "fetch-dashboard-period"
    ) {
      setPeriodStats(periodFetcher.data.stats);
    }
  }, [periodFetcher.data]);

  // Track previous preset so Cancel reverts; reset drafts when entering custom.
  useEffect(() => {
    if (periodPreset === "custom") {
      setDraftStart(customStart);
      setDraftEnd(customEnd);
      setCustomCalendarOpen(true);
    } else {
      prevPresetRef.current = periodPreset;
      setCustomCalendarOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodPreset]);

  const canApplyCustom =
    Boolean(draftStart) && Boolean(draftEnd) && draftStart <= draftEnd;

  const handleApplyCustom = () => {
    if (!canApplyCustom) return;
    setCustomStart(draftStart);
    setCustomEnd(draftEnd);
    setCustomCalendarOpen(false);
  };

  const handleCancelCustom = () => {
    setDraftStart("");
    setDraftEnd("");
    setCustomCalendarOpen(false);
    const target = prevPresetRef.current || "this_month";
    setPeriodPreset(target === "custom" ? "this_month" : target);
  };

  const handleEditCustomDates = () => {
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    setCustomCalendarOpen(true);
  };

  // Friendly range label for the overview strip.
  const activeRangeFriendly = useMemo(() => {
    return formatDateRangeFriendly(
      periodStats.period.start,
      periodStats.period.end,
      locale,
    );
  }, [periodStats.period.start, periodStats.period.end, locale]);

  // ── Derived: current + comparison month values per location ────────────────

  const bucketFor = (
    locationId: string,
    month: string | null,
  ): MonthlyBucket => {
    if (!month) return { orderCount: 0, revenue: 0, totalDiscounts: 0 };
    return (
      monthlyByLocation[locationId]?.[month] ?? {
        orderCount: 0,
        revenue: 0,
        totalDiscounts: 0,
      }
    );
  };

  type LocationRow = {
    id: string;
    name: string;
    orders: number;
    revenue: number;
    projectedRevenue: number | null;
    goal: number | null;
    achievement: number | null;
    yoyDelta: number | null;
    sparklineValues: number[];
    pyRevenue: number;
  };

  // Breakdown-table rows come straight from the active period's snapshots.
  // The 13-month sparkline is independent — always last 13 calendar months.
  const locationRows: LocationRow[] = useMemo(() => {
    return periodStats.snapshots.map((s) => {
      const achievement =
        s.goal != null && s.goal > 0 && s.projectedRevenue != null
          ? (s.projectedRevenue / s.goal) * 100
          : null;
      const currentForYoY = s.projectedRevenue ?? s.mtdRevenue;
      const yoyDelta = deltaPercent(currentForYoY, s.pyRevenue);
      const sparklineValues = months.map(
        (m) => monthlyByLocation[s.locationId]?.[m]?.revenue ?? 0,
      );
      return {
        id: s.locationId,
        name: s.locationName,
        orders: s.mtdOrders,
        revenue: s.mtdRevenue,
        projectedRevenue: s.projectedRevenue,
        goal: s.goal,
        achievement,
        yoyDelta,
        sparklineValues,
        pyRevenue: s.pyRevenue,
      };
    });
  }, [periodStats.snapshots, monthlyByLocation, months]);

  // Sorted rows driven by the active KPI drilldown
  const sortedLocationRows = useMemo(() => {
    const rows = [...locationRows];
    const nullLast = (v: number | null) =>
      v == null || !Number.isFinite(v) ? -Infinity : v;
    switch (activeKpi) {
      case "revenue":
        return rows.sort(
          (a, b) =>
            (b.projectedRevenue ?? b.revenue) -
            (a.projectedRevenue ?? a.revenue),
        );
      case "bestWorst":
        return rows.sort(
          (a, b) => nullLast(b.achievement) - nullLast(a.achievement),
        );
      case "orders":
        return rows.sort((a, b) => b.orders - a.orders);
      case "aov": {
        const aov = (r: (typeof rows)[number]) =>
          r.orders > 0 ? r.revenue / r.orders : 0;
        return rows.sort((a, b) => aov(b) - aov(a));
      }
      case "sameStore":
      case "discount":
      default:
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [locationRows, activeKpi]);

  const triggerSyncNow = () => {
    const fd = new FormData();
    fd.append("intent", "sync-now");
    syncFetcher.submit(fd, { method: "post" });
  };

  // ── Goals tab helpers ──

  const openEditForm = (locationId: string) => {
    const existing = goals.find(
      (g) => g.locationId === locationId && g.month === goalsMonth,
    );
    if (existing) {
      setEditForm({
        basePeriod:
          (existing.basePeriod as EditForm["basePeriod"]) ?? "previous-year",
        customBase: existing.basePeriod === "custom"
          ? String(existing.baseValue ?? "")
          : "",
        growthType: (existing.growthType as "percentage" | "absolute") ?? "percentage",
        growthValue: String(existing.growthValue ?? ""),
      });
    } else {
      setEditForm(defaultEditForm);
    }
    setEditingLocationId(locationId);
  };

  const projectedGoalFromForm = (
    locationId: string,
    form: EditForm,
  ): { base: number; target: number; basePeriodKey: string } => {
    let basePeriodKey = goalsMonth;
    let base = 0;
    if (form.basePeriod === "previous-month") {
      basePeriodKey = addMonths(goalsMonth, -1);
      base = bucketFor(locationId, basePeriodKey).revenue;
    } else if (form.basePeriod === "previous-year") {
      basePeriodKey = addMonths(goalsMonth, -12);
      base = bucketFor(locationId, basePeriodKey).revenue;
    } else {
      basePeriodKey = "custom";
      base = Number(form.customBase) || 0;
    }
    const growth = Number(form.growthValue) || 0;
    const target =
      form.growthType === "percentage" ? base * (1 + growth / 100) : base + growth;
    return { base, target: Math.round(target), basePeriodKey };
  };

  const submitEditForm = (locationId: string) => {
    const locationName =
      locations.find((l) => l.id === locationId)?.name ?? "";
    const { base, target } = projectedGoalFromForm(locationId, editForm);
    const existing = goals.find(
      (g) => g.locationId === locationId && g.month === goalsMonth,
    );
    const payload: SalesGoal = {
      id: existing?.id ?? `goal-${Date.now()}-${locationId.slice(-6)}`,
      locationId,
      locationName,
      month: goalsMonth,
      target,
      basePeriod: editForm.basePeriod,
      baseValue: base,
      growthType: editForm.growthType,
      growthValue: Number(editForm.growthValue) || 0,
    };
    const fd = new FormData();
    fd.append("intent", "save-goal");
    fd.append("goal", JSON.stringify(payload));
    saveGoalFetcher.submit(fd, { method: "post" });
  };

  const submitBulk = () => {
    const built: SalesGoal[] = enabledLocations.map((loc) => {
      const { base, target } = projectedGoalFromForm(loc.id, bulkForm);
      return {
        id: `goal-${Date.now()}-${loc.id.slice(-6)}`,
        locationId: loc.id,
        locationName: loc.name,
        month: goalsMonth,
        target,
        basePeriod: bulkForm.basePeriod,
        baseValue: base,
        growthType: bulkForm.growthType,
        growthValue: Number(bulkForm.growthValue) || 0,
      };
    });
    const fd = new FormData();
    fd.append("intent", "bulk-save-goals");
    fd.append("goals", JSON.stringify(built));
    bulkFetcher.submit(fd, { method: "post" });
  };

  const deleteGoal = (goalId: string) => {
    const fd = new FormData();
    fd.append("intent", "delete-goal");
    fd.append("goalId", goalId);
    deleteGoalFetcher.submit(fd, { method: "post" });
  };

  // ── Sync status display ──
  const isSyncing =
    syncMeta.status === "syncing" || syncFetcher.state !== "idle";
  const hoursSinceSync = syncMeta.lastSyncedAt
    ? (Date.now() - new Date(syncMeta.lastSyncedAt).getTime()) / 3_600_000
    : null;
  const syncStaleClass =
    hoursSinceSync == null
      ? ""
      : hoursSinceSync > 25
        ? styles.staleRed
        : hoursSinceSync > 2
          ? styles.staleAmber
          : "";

  // ── Admin-only manual sync trigger (hidden unless URL has ?admin-sync=1) ──
  const adminSyncEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("admin-sync") === "1";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <s-page heading={t("pageHeading")}>
      <s-section>
        <div className={styles.tabsRow}>
          {TAB_IDS.map((tabId) => (
            <button
              key={tabId}
              type="button"
              className={`${styles.tab}${activeTab === tabId ? ` ${styles.tabActive}` : ""}`}
              onClick={() => setActiveTab(tabId)}
            >
              {t(`tabs.${tabId}`)}
            </button>
          ))}
        </div>

        <s-stack direction="block" gap="base">
          {/* ── Dashboard ──────────────────────────────────────────────── */}
          {activeTab === "dashboard" ? (
            <>
              {/* Overview strip: heading + friendly range + subtitle stats. */}
              <div className={styles.overviewStrip}>
                <div className={styles.overviewStripHeader}>
                  <h2 className={styles.overviewStripHeading}>
                    {t("dashboard.stripHeading", "Retail goals dashboard")}
                  </h2>
                  {activeRangeFriendly ? (
                    periodPreset === "custom" && !customCalendarOpen ? (
                      <button
                        type="button"
                        className={`${styles.periodFriendly} ${styles.periodFriendlyEditable}`}
                        onClick={handleEditCustomDates}
                        title={t("dashboard.period.edit", "Change dates")}
                      >
                        {activeRangeFriendly}
                      </button>
                    ) : (
                      <span className={styles.periodFriendly}>
                        {activeRangeFriendly}
                      </span>
                    )
                  ) : null}
                </div>
                <div
                  className={`${styles.overviewStripSubtitle} ${syncStaleClass}`}
                >
                  {t("dashboard.stripSubtitle", {
                    locations: periodStats.locationsCount,
                    set: periodStats.storesWithGoalsCount,
                    total: periodStats.locationsCount,
                    lastSynced: syncMeta.lastSyncedAt
                      ? formatLastSyncShort(syncMeta.lastSyncedAt, locale)
                      : t("sync.never"),
                    defaultValue:
                      "{{locations}} locations · {{set}}/{{total}} goals set · Last synced {{lastSynced}}",
                  })}
                </div>
              </div>

              {/* Single-row period bar: Period | Compare with | (admin sync) */}
              <div className={styles.periodBar}>
                <div className={styles.filterControl}>
                  <span className={styles.filterLabel}>
                    {t("dashboard.period.label", "Period")}
                  </span>
                  <s-select
                    label={t("dashboard.period.label", "Period")}
                    labelAccessibilityVisibility="exclusive"
                    value={periodPreset}
                    onChange={(e: Event) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      setPeriodPreset(v as PeriodPreset);
                    }}
                  >
                    <s-option value="this_month">
                      {t("dashboard.period.thisMonth", "This month")}
                    </s-option>
                    <s-option value="last_month">
                      {t("dashboard.period.lastMonth", "Last month")}
                    </s-option>
                    <s-option value="last_7d">
                      {t("dashboard.period.last7d", "Last 7 days")}
                    </s-option>
                    <s-option value="last_30d">
                      {t("dashboard.period.last30d", "Last 30 days")}
                    </s-option>
                    <s-option value="last_3_months">
                      {t("dashboard.period.last3Months", "Last 3 months")}
                    </s-option>
                    <s-option value="custom">
                      {t("dashboard.period.custom", "Custom")}
                    </s-option>
                  </s-select>
                </div>
                <div className={styles.filterControl}>
                  <span className={styles.filterLabel}>
                    {t("dashboard.compareWith")}
                  </span>
                  <s-select
                    label={t("dashboard.compareWith")}
                    labelAccessibilityVisibility="exclusive"
                    value={comparisonMode}
                    onChange={(e: Event) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      setComparisonMode(v as ComparisonMode);
                    }}
                  >
                    <s-option value="none">
                      {t("dashboard.comparison.none")}
                    </s-option>
                    <s-option value="prev_period">
                      {t("dashboard.comparison.prevPeriod", "Previous period")}
                    </s-option>
                    <s-option value="prev_year">
                      {t("dashboard.comparison.prevYear")}
                    </s-option>
                  </s-select>
                </div>
                <div className={styles.filterControl} aria-hidden>
                  {adminSyncEnabled ? (
                    <s-button
                      variant="secondary"
                      onClick={triggerSyncNow}
                      disabled={isSyncing}
                    >
                      {isSyncing ? t("sync.syncing") : t("sync.syncNow")}
                    </s-button>
                  ) : null}
                </div>
              </div>

              {/* Custom date calendar — draft → apply flow. */}
              {periodPreset === "custom" && customCalendarOpen ? (
                <div className={styles.customDateGrid}>
                  <div className={styles.customDateCol}>
                    <span className={styles.customDateLabel}>
                      {t("dashboard.period.startDate", "Start date")}
                    </span>
                    <s-date-picker
                      type="single"
                      value={draftStart}
                      onChange={(e: Event) =>
                        setDraftStart(
                          (e.currentTarget as HTMLInputElement).value,
                        )
                      }
                    />
                  </div>
                  <div className={styles.customDateCol}>
                    <span className={styles.customDateLabel}>
                      {t("dashboard.period.endDate", "End date")}
                    </span>
                    <s-date-picker
                      type="single"
                      value={draftEnd}
                      onChange={(e: Event) =>
                        setDraftEnd(
                          (e.currentTarget as HTMLInputElement).value,
                        )
                      }
                    />
                  </div>
                  <div className={styles.customDateActions}>
                    <s-button variant="secondary" onClick={handleCancelCustom}>
                      {t("dashboard.period.cancel", "Cancel")}
                    </s-button>
                    {canApplyCustom ? (
                      <s-button variant="primary" onClick={handleApplyCustom}>
                        {t("dashboard.period.apply", "Apply")}
                      </s-button>
                    ) : (
                      <s-button variant="primary" disabled>
                        {t("dashboard.period.apply", "Apply")}
                      </s-button>
                    )}
                  </div>
                </div>
              ) : null}

              {/* ─── Row 1: Scoreboard (Revenue = Orders × AOV) ─── */}
              <div className={styles.kpiGroupLabel}>
                {t("dashboard.kpiGroupScoreboard")}
              </div>
              <div className={styles.kpiGrid}>
                {/* Total revenue — clicking this opens the bar drilldown */}
                {(() => {
                  const k = periodStats.kpis.revenue;
                  const mtdVsGoal =
                    isSingleMonth &&
                    periodStats.proratedMtdGoal != null &&
                    periodStats.proratedMtdGoal > 0
                      ? ((k.mtd / periodStats.proratedMtdGoal) - 1) * 100
                      : null;
                  const goalVsProj =
                    k.goal != null && k.projected != null && k.projected > 0
                      ? ((k.goal - k.projected) / k.projected) * 100
                      : null;
                  const pyVsProj =
                    k.py > 0 && k.projected != null
                      ? ((k.py - k.projected) / k.projected) * 100
                      : null;
                  const periodVsPy =
                    k.py > 0 ? ((k.mtd - k.py) / k.py) * 100 : null;
                  return (
                    <KpiRichCard
                      title={t("dashboard.totalRevenue")}
                      primary={formatCurrency(k.mtd, currencyCode)}
                      primaryDelta={isSingleMonth ? mtdVsGoal : periodVsPy}
                      primaryDeltaSuffix={
                        isSingleMonth
                          ? t("dashboard.vsMtdGoal")
                          : t("dashboard.vsPy")
                      }
                      projected={
                        k.projected != null
                          ? {
                              value: `${t("dashboard.projectionLabel")} ${formatCurrency(k.projected, currencyCode)}`,
                              early: isCurrentMonthEarly,
                            }
                          : null
                      }
                      lines={[
                        ...(k.goal != null
                          ? [
                              {
                                label: t("dashboard.goalLabel"),
                                value: formatCurrency(k.goal, currencyCode),
                                delta: goalVsProj,
                              },
                            ]
                          : []),
                        {
                          label: t("dashboard.pyLabel"),
                          value: formatCurrency(k.py, currencyCode),
                          delta: pyVsProj,
                        },
                      ]}
                      active={activeKpi === "revenue"}
                      onClick={() => toggleKpi("revenue")}
                    />
                  );
                })()}
                {/* Orders */}
                {(() => {
                  const k = periodStats.kpis.orders;
                  const prevYearOrders = periodStats.prevYearAggregates.reduce(
                    (sum, r) => sum + r.orderCount,
                    0,
                  );
                  const ordersYoY =
                    prevYearOrders > 0
                      ? ((k.mtd - prevYearOrders) / prevYearOrders) * 100
                      : null;
                  const pyVsProj =
                    k.py > 0 && k.projected != null
                      ? ((k.py - k.projected) / k.projected) * 100
                      : null;
                  return (
                    <KpiRichCard
                      title={t("dashboard.orders")}
                      primary={k.mtd.toLocaleString(locale)}
                      primaryDelta={ordersYoY}
                      primaryDeltaSuffix={t("dashboard.vsPreviousYear")}
                      projected={
                        k.projected != null
                          ? {
                              value: `${t("dashboard.projectionLabel")} ${k.projected.toLocaleString(locale)}`,
                              early: isCurrentMonthEarly,
                            }
                          : null
                      }
                      tooltip={t("dashboard.ordersGoalTooltip")}
                      lines={[
                        {
                          label: t("dashboard.pyLabel"),
                          value: k.py.toLocaleString(locale),
                          delta: pyVsProj,
                        },
                      ]}
                      active={activeKpi === "orders"}
                      onClick={() => toggleKpi("orders")}
                    />
                  );
                })()}
                {/* AOV */}
                {(() => {
                  const k = periodStats.kpis.aov;
                  const pyAggRev = periodStats.prevYearAggregates.reduce(
                    (sum, r) => sum + r.revenue,
                    0,
                  );
                  const pyAggOrd = periodStats.prevYearAggregates.reduce(
                    (sum, r) => sum + r.orderCount,
                    0,
                  );
                  const prevYearAov = pyAggOrd > 0 ? pyAggRev / pyAggOrd : 0;
                  const aovYoY =
                    prevYearAov > 0
                      ? ((k.mtd - prevYearAov) / prevYearAov) * 100
                      : null;
                  const pyVsProj =
                    k.py > 0 && k.projected != null
                      ? ((k.py - k.projected) / k.projected) * 100
                      : null;
                  return (
                    <KpiRichCard
                      title={t("dashboard.aov")}
                      primary={formatCurrency(k.mtd, currencyCode)}
                      primaryDelta={aovYoY}
                      primaryDeltaSuffix={t("dashboard.vsPreviousYear")}
                      projected={null}
                      tooltip={t("dashboard.aovGoalTooltip")}
                      lines={[
                        {
                          label: t("dashboard.pyLabel"),
                          value: formatCurrency(k.py, currencyCode),
                          delta: pyVsProj,
                        },
                      ]}
                      active={activeKpi === "aov"}
                      onClick={() => toggleKpi("aov")}
                    />
                  );
                })()}
              </div>

              {/* ─── Row-1 drilldown: renders below Row 1 when Revenue/AOV/Orders is active ─── */}
              {activeKpi === "revenue" ||
              activeKpi === "aov" ||
              activeKpi === "orders" ? (
                <KpiDrilldownBars
                  metric={activeKpi}
                  snapshots={periodStats.snapshots}
                  currencyCode={currencyCode}
                  locale={locale}
                  isCurrentMonthEarly={isCurrentMonthEarly}
                  isViewingCurrentMonth={isViewingCurrentMonth}
                  t={t}
                />
              ) : null}

              {/* ─── Row 2: Volume / quality ─── */}
              <div className={styles.kpiGroupLabel}>
                {t("dashboard.kpiGroupVolume")}
              </div>
              <div className={styles.kpiGrid}>
                {/* Same-Store YoY */}
                {(() => {
                  const k = periodStats.kpis.sameStoreYoY;
                  const sameStoreLines: KpiRichLine[] = [];
                  if (k.qualifyingCount > 0) {
                    sameStoreLines.push({
                      label: "",
                      value: t("dashboard.declining", {
                        declining: k.decliningCount,
                        total: k.qualifyingCount,
                      }),
                    });
                  }
                  if (k.topGrower) {
                    sameStoreLines.push({
                      label: t("dashboard.sameStoreTopGrower", {
                        store: k.topGrower.name,
                        percent: k.topGrower.deltaPercent.toFixed(1),
                      }),
                      value: "",
                    });
                  }
                  return (
                    <KpiRichCard
                      title={t("dashboard.sameStoreYoY")}
                      primary={
                        k.deltaPercent != null
                          ? `${k.deltaPercent >= 0 ? "+" : ""}${k.deltaPercent.toFixed(1)}%`
                          : "—"
                      }
                      primaryColor={
                        k.deltaPercent != null
                          ? k.deltaPercent >= 0
                            ? "#008060"
                            : "#d72c0d"
                          : undefined
                      }
                      tooltip={t("dashboard.sameStoreYoyTooltip")}
                      lines={sameStoreLines}
                      active={activeKpi === "sameStore"}
                      onClick={() => toggleKpi("sameStore")}
                    />
                  );
                })()}
                {/* Best vs worst — hidden for non-single-month periods (no goals). */}
                {!isSingleMonth ? null : (() => {
                  const k = periodStats.kpis.bestVsWorst;
                  if (!k.best) {
                    return (
                      <KpiRichCard
                        title={t("dashboard.bestVsWorst")}
                        primary="—"
                        active={activeKpi === "bestWorst"}
                        onClick={() => toggleKpi("bestWorst")}
                      />
                    );
                  }
                  const bestAchPct = k.best.achievement;
                  const worstAchPct = k.worst?.achievement;
                  const bestWorstLines: KpiRichLine[] = [
                    {
                      label: t("dashboard.bestVsWorstLeaderBy", {
                        gap: k.gapPp?.toFixed(0) ?? "0",
                      }),
                      value: "",
                    },
                  ];
                  if (k.worst) {
                    bestWorstLines.push({
                      label: t("dashboard.bestVsWorstTrailing", {
                        store: k.worst.name,
                        percent: worstAchPct?.toFixed(0) ?? "0",
                      }),
                      value: "",
                    });
                  }
                  return (
                    <KpiRichCard
                      title={t("dashboard.bestVsWorst")}
                      primary={`${k.best.name} \u00B7 ${bestAchPct.toFixed(0)}%`}
                      lines={bestWorstLines}
                      active={activeKpi === "bestWorst"}
                      onClick={() => toggleKpi("bestWorst")}
                    />
                  );
                })()}
                {/* Discount rate */}
                {(() => {
                  const k = periodStats.kpis.discountRate;
                  const currentRatePct =
                    k.currentRate != null
                      ? (k.currentRate * 100).toFixed(1)
                      : null;
                  const pyRatePct =
                    k.pyRate != null ? (k.pyRate * 100).toFixed(1) : null;
                  return (
                    <KpiRichCard
                      title={t("dashboard.discountRate")}
                      primary={currentRatePct != null ? `${currentRatePct}%` : "—"}
                      primaryDelta={k.deltaPp}
                      primaryDeltaSuffix={t("dashboard.vsPyPp")}
                      lines={[
                        pyRatePct != null
                          ? {
                              label: t("dashboard.pyLabel"),
                              value: `${pyRatePct}%`,
                            }
                          : { label: t("dashboard.pyLabel"), value: "—" },
                        {
                          label: t("dashboard.thirteenMoDiscountLabel"),
                          value: formatCurrencyCompact(
                            k.thirteenMonthDiscountTotal,
                            currencyCode,
                            locale,
                          ),
                        },
                      ]}
                      active={activeKpi === "discount"}
                      onClick={() => toggleKpi("discount")}
                    />
                  );
                })()}
              </div>

              {/* ─── Row-2 drilldown: renders below Row 2 when Same-Store / Best vs Worst / Discount is active ─── */}
              {activeKpi === "sameStore" ||
              activeKpi === "bestWorst" ||
              activeKpi === "discount" ? (
                <KpiDrilldownBars
                  metric={activeKpi}
                  snapshots={periodStats.snapshots}
                  currencyCode={currencyCode}
                  locale={locale}
                  isCurrentMonthEarly={isCurrentMonthEarly}
                  isViewingCurrentMonth={isViewingCurrentMonth}
                  t={t}
                />
              ) : null}

              {/* ─── Breakdown table (always visible below the scoreboard) ─── */}
              <div className={styles.blockCard}>
                <s-box padding="base" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    <h2 className={styles.sectionTitle}>
                      {t("dashboard.breakdownTitle")}
                    </h2>
                    <div className={`${styles.table} ${styles.tableLocations}`}>
                      <div className={styles.tableHeader}>
                        <span>{t("common:label.location")}</span>
                        <span>
                          {isSingleMonth
                            ? t("dashboard.mtdRevenue")
                            : t("dashboard.periodRevenue", "Period revenue")}
                        </span>
                        <span>{t("dashboard.projectedRev")}</span>
                        <span>{t("dashboard.goal")}</span>
                        <span>{t("dashboard.achievement")}</span>
                        <span>{t("dashboard.yoyDelta")}</span>
                        <span>{t("dashboard.trend13mo")}</span>
                      </div>
                      {sortedLocationRows.length === 0 ? (
                        <div className={styles.tableEmpty}>
                          {t("dashboard.noLocations")}
                        </div>
                      ) : (
                        sortedLocationRows.map((row) => {
                          const isBestHighlight =
                            activeKpi === "bestWorst" &&
                            periodStats.kpis.bestVsWorst.best?.locationId ===
                              row.id;
                          return (
                            <div
                              key={row.id}
                              className={`${styles.tableRow}${isBestHighlight ? ` ${styles.tableRowHighlight}` : ""}`}
                            >
                              <span>{row.name}</span>
                              <span>
                                {formatCurrency(row.revenue, currencyCode)}
                              </span>
                              <span>
                                {row.projectedRevenue != null
                                  ? formatCurrency(
                                      row.projectedRevenue,
                                      currencyCode,
                                    )
                                  : "—"}
                              </span>
                              <span>
                                {row.goal != null
                                  ? formatCurrency(row.goal, currencyCode)
                                  : "—"}
                              </span>
                              <span>
                                {row.achievement != null ? (
                                  <span className={styles.progressCell}>
                                    <span className={styles.progressLabel}>
                                      {row.achievement.toFixed(1)}%
                                    </span>
                                    <span className={styles.progressBar}>
                                      <span
                                        className={styles.progressFill}
                                        style={{
                                          width: `${Math.min(100, row.achievement)}%`,
                                        }}
                                      />
                                    </span>
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </span>
                              <span>
                                <Delta delta={row.yoyDelta} />
                              </span>
                              <span>
                                <Sparkline values={row.sparklineValues} />
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </s-stack>
                </s-box>
              </div>
            </>
          ) : null}

          {/* ── Goals ──────────────────────────────────────────────────── */}
          {activeTab === "goals" ? (
            <>
              {/* Header */}
              <div className={styles.controlsRow}>
                <div className={styles.controlsLeft}>
                  <s-select
                    label={t("goals.referenceMonth")}
                    value={goalsMonth}
                    onChange={(e: Event) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      if (v) setGoalsMonth(v);
                    }}
                  >
                    {months
                      .slice()
                      .reverse()
                      .map((m) => (
                        <s-option key={m} value={m}>
                          {formatMonthLabel(m)}
                        </s-option>
                      ))}
                  </s-select>
                </div>
                <div className={styles.controlsRight}>
                  <s-button
                    variant="secondary"
                    onClick={() => setBulkModalOpen(true)}
                  >
                    {t("goals.applyToAll")}
                  </s-button>
                </div>
              </div>

              {/* Per-location goal cards */}
              <div className={styles.goalCardsGrid}>
                {enabledLocations.map((loc) => {
                  const bucketCurrent = bucketFor(loc.id, goalsMonth);
                  const bucketPrevMonth = bucketFor(
                    loc.id,
                    addMonths(goalsMonth, -1),
                  );
                  const bucketPrevYear = bucketFor(
                    loc.id,
                    addMonths(goalsMonth, -12),
                  );
                  const existingGoal = goals.find(
                    (g) => g.locationId === loc.id && g.month === goalsMonth,
                  );
                  const progress =
                    existingGoal?.target != null && existingGoal.target > 0
                      ? (bucketCurrent.revenue / existingGoal.target) * 100
                      : null;
                  const isEditing = editingLocationId === loc.id;
                  const projected = isEditing
                    ? projectedGoalFromForm(loc.id, editForm)
                    : null;
                  const monthProjection =
                    projectionsByLocation[loc.id]?.[goalsMonth] ?? null;

                  return (
                    <div key={loc.id} className={styles.goalCard}>
                      <div className={styles.goalCardHeader}>
                        <h3 className={styles.goalCardTitle}>{loc.name}</h3>
                        {!isEditing ? (
                          <s-button
                            variant="secondary"
                            onClick={() => openEditForm(loc.id)}
                          >
                            {existingGoal
                              ? t("goals.edit")
                              : t("goals.setGoal")}
                          </s-button>
                        ) : null}
                      </div>

                      <div className={styles.goalCardBody}>
                        <div className={styles.goalCardSection}>
                          {existingGoal ? (
                            <>
                              <div className={styles.goalCardRow}>
                                <span>{t("goals.goalLabel")}</span>
                                <strong>
                                  {formatCurrency(
                                    existingGoal.target,
                                    currencyCode,
                                  )}
                                </strong>
                              </div>
                              <div className={styles.goalCardRow}>
                                <span>{t("goals.salesSoFar")}</span>
                                <span>
                                  {formatCurrency(
                                    bucketCurrent.revenue,
                                    currencyCode,
                                  )}
                                  {progress != null
                                    ? ` (${progress.toFixed(1)}%)`
                                    : ""}
                                </span>
                              </div>
                              {monthProjection?.isProjection ? (
                                <div className={styles.goalCardRow}>
                                  <span>{t("goals.monthProjected")}</span>
                                  <span className={styles.projectionPair}>
                                    <span className={styles.projectionItem}>
                                      <span className={styles.projectionLabel}>
                                        {t("goals.linear")}:
                                      </span>{" "}
                                      <strong>
                                        {monthProjection.linear != null
                                          ? formatCurrency(
                                              monthProjection.linear,
                                              currencyCode,
                                            )
                                          : "—"}
                                      </strong>
                                    </span>
                                    <span className={styles.projectionDivider}>
                                      |
                                    </span>
                                    <span className={styles.projectionItem}>
                                      <span className={styles.projectionLabel}>
                                        {t("goals.yoyPace")}:
                                      </span>{" "}
                                      <strong>
                                        {monthProjection.yoy != null
                                          ? formatCurrency(
                                              monthProjection.yoy,
                                              currencyCode,
                                            )
                                          : t("goals.linearOnly")}
                                      </strong>
                                    </span>
                                  </span>
                                </div>
                              ) : null}
                              {progress != null ? (
                                <span className={styles.progressBar}>
                                  <span
                                    className={styles.progressFill}
                                    style={{
                                      width: `${Math.min(100, progress)}%`,
                                    }}
                                  />
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className={styles.goalCardEmpty}>
                              {t("goals.noGoalYet")}
                            </span>
                          )}
                        </div>

                        <div className={styles.goalCardSection}>
                          <span className={styles.goalCardSectionLabel}>
                            {t("goals.baselines")}
                          </span>
                          <div className={styles.goalCardRow}>
                            <span>
                              {t("goals.previousMonth")} (
                              {formatMonthLabel(addMonths(goalsMonth, -1))})
                            </span>
                            <span>
                              {formatCurrency(
                                bucketPrevMonth.revenue,
                                currencyCode,
                              )}
                            </span>
                          </div>
                          <div className={styles.goalCardRow}>
                            <span>
                              {t("goals.sameMonthLastYear")} (
                              {formatMonthLabel(addMonths(goalsMonth, -12))})
                            </span>
                            <span>
                              {formatCurrency(
                                bucketPrevYear.revenue,
                                currencyCode,
                              )}
                            </span>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className={styles.editForm}>
                            <div className={styles.editFormRow}>
                              <span className={styles.editFormLabel}>
                                {t("goals.basePeriod")}
                              </span>
                              <select
                                className={styles.select}
                                value={editForm.basePeriod}
                                onChange={(e) =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    basePeriod: e.target
                                      .value as EditForm["basePeriod"],
                                  }))
                                }
                              >
                                <option value="previous-month">
                                  {t("goals.previousMonth")}:{" "}
                                  {formatCurrency(
                                    bucketPrevMonth.revenue,
                                    currencyCode,
                                  )}
                                </option>
                                <option value="previous-year">
                                  {t("goals.sameMonthLastYear")}:{" "}
                                  {formatCurrency(
                                    bucketPrevYear.revenue,
                                    currencyCode,
                                  )}
                                </option>
                                <option value="custom">
                                  {t("goals.customBase")}
                                </option>
                              </select>
                            </div>
                            {editForm.basePeriod === "custom" ? (
                              <div className={styles.editFormRow}>
                                <span className={styles.editFormLabel}>
                                  {t("goals.customBase")}
                                </span>
                                <input
                                  type="number"
                                  className={styles.numberInput}
                                  value={editForm.customBase}
                                  onChange={(e) =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      customBase: e.target.value,
                                    }))
                                  }
                                />
                              </div>
                            ) : null}
                            <div className={styles.editFormRow}>
                              <span className={styles.editFormLabel}>
                                {t("goals.growth")}
                              </span>
                              <div className={styles.growthInputs}>
                                <input
                                  type="number"
                                  className={styles.numberInput}
                                  value={editForm.growthValue}
                                  onChange={(e) =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      growthValue: e.target.value,
                                    }))
                                  }
                                />
                                <select
                                  className={styles.select}
                                  value={editForm.growthType}
                                  onChange={(e) =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      growthType: e.target.value as
                                        | "percentage"
                                        | "absolute",
                                    }))
                                  }
                                >
                                  <option value="percentage">%</option>
                                  <option value="absolute">{currencyCode}</option>
                                </select>
                              </div>
                            </div>
                            <div className={styles.editPreviewRow}>
                              <span>{t("goals.projectedGoal")}</span>
                              <strong>
                                {projected
                                  ? formatCurrency(projected.target, currencyCode)
                                  : "—"}
                              </strong>
                            </div>
                            <div className={styles.editFormActions}>
                              {existingGoal ? (
                                <s-button
                                  variant="secondary"
                                  tone="critical"
                                  onClick={() => deleteGoal(existingGoal.id)}
                                  disabled={
                                    deleteGoalFetcher.state !== "idle"
                                  }
                                >
                                  {t("common:button.delete")}
                                </s-button>
                              ) : (
                                <span />
                              )}
                              <div className={styles.editFormActionsRight}>
                                <s-button
                                  variant="tertiary"
                                  onClick={() => setEditingLocationId(null)}
                                >
                                  {t("common:button.cancel")}
                                </s-button>
                                <s-button
                                  variant="primary"
                                  onClick={() => submitEditForm(loc.id)}
                                  disabled={
                                    saveGoalFetcher.state !== "idle"
                                  }
                                >
                                  {t("goals.saveGoal")}
                                </s-button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {/* ── Campaigns ─────────────────────────────────────────────── */}
          {activeTab === "campaigns" ? (
            <CampaignsTab
              locations={enabledLocations}
              campaigns={campaigns}
              progressByCampaignId={campaignProgress}
              currencyCode={currencyCode}
              onSubmit={(fd) => campaignFetcher.submit(fd, { method: "post" })}
              isSubmitting={campaignFetcher.state !== "idle"}
              matchOptionsFetcher={matchOptionsFetcher}
              baselineFetcher={baselineFetcher}
            />
          ) : null}

        </s-stack>
      </s-section>

      {/* ── Bulk apply modal ──────────────────────────────────────────────── */}
      {bulkModalOpen ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h2 className={styles.sectionTitle}>{t("goals.bulkTitle")}</h2>
            <p className={styles.paramHint}>
              {t("goals.bulkSubtitle", {
                month: formatMonthLabel(goalsMonth),
                count: locations.length,
              })}
            </p>
            <div className={styles.editFormRow}>
              <span className={styles.editFormLabel}>
                {t("goals.basePeriod")}
              </span>
              <select
                className={styles.select}
                value={bulkForm.basePeriod}
                onChange={(e) =>
                  setBulkForm((prev) => ({
                    ...prev,
                    basePeriod: e.target.value as EditForm["basePeriod"],
                  }))
                }
              >
                <option value="previous-month">{t("goals.previousMonth")}</option>
                <option value="previous-year">
                  {t("goals.sameMonthLastYear")}
                </option>
              </select>
            </div>
            <div className={styles.editFormRow}>
              <span className={styles.editFormLabel}>{t("goals.growth")}</span>
              <div className={styles.growthInputs}>
                <input
                  type="number"
                  className={styles.numberInput}
                  value={bulkForm.growthValue}
                  onChange={(e) =>
                    setBulkForm((prev) => ({
                      ...prev,
                      growthValue: e.target.value,
                    }))
                  }
                />
                <select
                  className={styles.select}
                  value={bulkForm.growthType}
                  onChange={(e) =>
                    setBulkForm((prev) => ({
                      ...prev,
                      growthType: e.target.value as "percentage" | "absolute",
                    }))
                  }
                >
                  <option value="percentage">%</option>
                  <option value="absolute">{currencyCode}</option>
                </select>
              </div>
            </div>
            <div className={styles.editFormActions}>
              <span />
              <div className={styles.editFormActionsRight}>
                <s-button
                  variant="tertiary"
                  onClick={() => setBulkModalOpen(false)}
                >
                  {t("common:button.cancel")}
                </s-button>
                <s-button
                  variant="primary"
                  onClick={submitBulk}
                  disabled={bulkFetcher.state !== "idle"}
                >
                  {t("goals.applyToAll")}
                </s-button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </s-page>
  );
}

// Suppress unused-import warning for type-only use.
export type { MonthlyAggregateRow };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _sourceLabelUnused = sourceLabel;
