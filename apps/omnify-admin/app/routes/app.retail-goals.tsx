import { useEffect, useMemo, useState } from "react";
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
import styles from "./app.retail-goals/styles.module.css";
import {
  filterCandidateLocations,
  monthKey,
  sourceLabel,
  type RetailLocation,
} from "../sales-goals/classification";
import {
  buildMonthRange,
  computeMonthProjections,
  countZeroRevenueDays,
  queryMonthlyAggregates,
  readSyncMeta,
  type MonthlyAggregateRow,
  type MonthProjection,
  type SyncMetaRecord,
} from "../sales-goals/analytics-queries.server";
import {
  aggregateSnapshots,
  bestVsWorst,
  buildLocationSnapshots,
  discountRate,
  sameStoreYoY,
  type AggregateKpi,
  type LocationSnapshot,
} from "../sales-goals/analytics-pure";
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
import { CampaignsTab } from "./app.retail-goals/campaigns-tab";

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
  campaigns: CampaignGoalView[];
  campaignProgress: Record<string, CampaignProgressView>;
};

type TabId = "dashboard" | "goals" | "campaigns";
type ComparisonMode = "none" | "prev_month" | "prev_year";

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

const comparisonMonthFor = (
  month: string,
  mode: ComparisonMode,
): string | null => {
  if (mode === "prev_month") return addMonths(month, -1);
  if (mode === "prev_year") return addMonths(month, -12);
  return null;
};

const deltaPercent = (current: number, previous: number): number | null => {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
};

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

  const [aggregates, projectionsByLocation, zeroDaysByLocMonth, locationConfigRows, configRecord, syncMeta] =
    await Promise.all([
      queryMonthlyAggregates(shop, months, candidateIds),
      computeMonthProjections(shop, candidateIds, months),
      // Zero-day counts for Same-Store YoY exclusion. Only current + PY months are needed.
      countZeroRevenueDays(shop, candidateIds, [currentMonth, pyMonth]),
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

  const dashboardSnapshots = buildLocationSnapshots({
    locations: candidateLocations.map((l) => ({ id: l.id, name: l.name })),
    aggregates,
    projections: projectionsByLocation,
    goals: goalsForCurrentMonth,
    zeroDaysByLocMonth,
    dashboardMonth: currentMonth,
    pyMonth,
  });

  const dashboardKpis: DashboardKpis = {
    revenue: aggregateSnapshots(dashboardSnapshots, "revenue"),
    aov: aggregateSnapshots(dashboardSnapshots, "aov"),
    orders: aggregateSnapshots(dashboardSnapshots, "orders"),
    sameStoreYoY: sameStoreYoY(dashboardSnapshots),
    bestVsWorst: bestVsWorst(dashboardSnapshots),
    discountRate: discountRate(dashboardSnapshots, aggregates),
  };

  const storesWithGoalsCount = Object.keys(goalsForCurrentMonth).length;

  // ── Campaign goals load ─────────────────────────────────────────────
  // Sweep statuses so drafts promote + expired campaigns end before we read.
  await sweepCampaignStatuses(shop).catch((err) =>
    console.warn(`[retail-goals] campaign sweep SKIP shop=${shop}`, err),
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
    campaigns,
    campaignProgress,
  };

  console.info(
    `[sales-goals] loader OK shop=${shop} candidates=${candidateLocations.length} monthlyRows=${aggregates.length} goals=${goals.length} syncStatus=${syncMeta.status}`,
  );
  return result;
};

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

  return { ok: false, error: "Unsupported request." };
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

// ─── Inline sub-components ────────────────────────────────────────────────────

type KpiCardProps = {
  label: string;
  primary: string;
  secondary?: string;
  delta?: number | null;
  active?: boolean;
  onClick?: () => void;
};

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

const KpiCard = ({
  label,
  primary,
  secondary,
  delta,
  active,
  onClick,
}: KpiCardProps) => {
  const className = `${styles.kpiCardClickable}${active ? ` ${styles.kpiCardActive}` : ""}`;
  return (
    <div
      className={className}
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
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>{label}</span>
          <div className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{primary}</span>
            <Delta delta={delta} />
          </div>
          {secondary ? (
            <span className={styles.kpiSecondary}>{secondary}</span>
          ) : null}
        </div>
      </s-box>
    </div>
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
            {tooltip ? <span className={styles.kpiInfoIcon}>ⓘ</span> : null}
          </div>
          <div className={styles.kpiRichPrimary}>
            <span className={styles.kpiValue}>{primary}</span>
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
  formatCurrency: (value: number, code: string) => string;
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

const KpiDrilldownBars = ({
  metric,
  snapshots,
  currencyCode,
  locale,
  isCurrentMonthEarly,
  isViewingCurrentMonth,
  t,
  formatCurrency,
}: KpiDrilldownBarsProps) => {
  const rows = buildBarRows(metric, snapshots);
  const sorted = sortBarRows(metric, rows);

  const maxScale = sorted.reduce((max, r) => {
    const py = Math.abs(r.pyValue);
    const cur = Math.abs(r.currentValue);
    const goal = r.goalValue ?? 0;
    return Math.max(max, py, cur, goal);
  }, 0);

  const formatValue = (value: number) => {
    if (metric === "orders") {
      return Math.round(value).toLocaleString(locale);
    }
    if (metric === "aov" || metric === "revenue" || metric === "sameStore") {
      return formatCurrencyCompact(value, currencyCode, locale);
    }
    if (metric === "bestWorst" || metric === "discount") {
      return `${value.toFixed(1)}%`;
    }
    return String(value);
  };

  const isSingleBar =
    metric === "sameStore" || metric === "bestWorst";
  const isDualNavy =
    metric === "revenue" || metric === "aov" || metric === "orders";

  const legend = (() => {
    if (isSingleBar) {
      if (metric === "sameStore") {
        return (
          <div className={styles.drilldownLegend}>
            <span>
              <span className={styles.legendSwatchSinglePositive} />{" "}
              {t("dashboard.legendGrowth")}
            </span>
            <span>
              <span className={styles.legendSwatchSingleNegative} />{" "}
              {t("dashboard.legendDecline")}
            </span>
          </div>
        );
      }
      return (
        <div className={styles.drilldownLegend}>
          <span>
            <span className={styles.legendSwatchRanking} />{" "}
            {t("dashboard.legendAchievement")}
          </span>
        </div>
      );
    }
    if (metric === "discount") {
      return (
        <div className={styles.drilldownLegend}>
          <span>
            <span className={styles.legendSwatchPy} />{" "}
            {t("dashboard.legendPyRate")}
          </span>
          <span>
            <span className={styles.legendSwatchProj} />{" "}
            {t("dashboard.legendCurrentRate")}
          </span>
        </div>
      );
    }
    return (
      <div className={styles.drilldownLegend}>
        <span>
          <span className={styles.legendSwatchPy} />{" "}
          {t("dashboard.legendPy")}
        </span>
        <span>
          <span className={styles.legendSwatchProj} />{" "}
          {t("dashboard.legendProjected")}
        </span>
        {metric === "revenue" ? (
          <span>
            <span className={styles.legendSwatchGoal} />{" "}
            {t("dashboard.legendGoal")}
          </span>
        ) : null}
      </div>
    );
  })();

  return (
    <div className={styles.revenueDrilldown}>
      <div className={styles.breakdownHeader}>
        <h3 className={styles.subSectionTitle}>
          {t(`dashboard.drilldown.${metric}`)}
        </h3>
      </div>
      {legend}
      <div className={styles.drilldownBars}>
        {sorted.length === 0 ? (
          <div className={styles.tableEmpty}>
            {t("dashboard.noLocations")}
          </div>
        ) : (
          sorted.map((row, idx) => {
            const pyPct = maxScale > 0 ? (row.pyValue / maxScale) * 100 : 0;
            const curPct =
              maxScale > 0
                ? (Math.abs(row.currentValue) / maxScale) * 100
                : 0;
            const mtdPct =
              maxScale > 0 ? (row.mtdValue / maxScale) * 100 : 0;
            const goalPct =
              maxScale > 0 && row.goalValue != null
                ? (row.goalValue / maxScale) * 100
                : null;

            return (
              <div
                key={row.locationId}
                className={styles.drilldownColumn}
                style={{ order: idx }}
              >
                <div className={styles.drilldownPair}>
                  {isSingleBar ? (
                    (() => {
                      // sameStore: colored by sign of deltaPercent
                      // bestWorst: color-graded by achievement %
                      if (metric === "sameStore") {
                        const signPositive = (row.deltaPercent ?? 0) >= 0;
                        return (
                          <div className={styles.drilldownBarArea}>
                            <span className={styles.drilldownBarValue}>
                              {row.deltaPercent != null
                                ? `${row.deltaPercent >= 0 ? "+" : ""}${row.deltaPercent.toFixed(1)}%`
                                : "—"}
                            </span>
                            <div
                              className={`${styles.drilldownBarSingle} ${signPositive ? styles.drilldownBarSinglePositive : styles.drilldownBarSingleNegative}`}
                              style={{ height: `${curPct}%` }}
                            />
                          </div>
                        );
                      }
                      // bestWorst: HSL interpolation red (0°) → green (145°)
                      const ach = row.achievement ?? 0;
                      const hue = Math.max(0, Math.min(145, (ach / 100) * 145));
                      const gradient = `linear-gradient(180deg, hsl(${hue}, 65%, 52%) 0%, hsl(${hue}, 65%, 36%) 100%)`;
                      return (
                        <div className={styles.drilldownBarArea}>
                          <span className={styles.drilldownBarValue}>
                            {row.achievement != null
                              ? `${row.achievement.toFixed(0)}%`
                              : "—"}
                          </span>
                          <div
                            className={styles.drilldownBarSingle}
                            style={{
                              height: `${curPct}%`,
                              background: gradient,
                              boxShadow:
                                "inset 0 2px 4px rgba(255, 255, 255, 0.2)",
                            }}
                          />
                        </div>
                      );
                    })()
                  ) : (
                    <>
                      {/* PY — outlined navy */}
                      <div className={styles.drilldownBarArea}>
                        <span className={styles.drilldownBarValue}>
                          {formatValue(row.pyValue)}
                        </span>
                        <div
                          className={styles.drilldownBarPy}
                          style={{ height: `${pyPct}%` }}
                        />
                      </div>
                      {/* Current / projected — solid navy gradient */}
                      <div className={styles.drilldownBarArea}>
                        <span
                          className={`${styles.drilldownBarValue}${isCurrentMonthEarly && isDualNavy ? ` ${styles.drilldownBarValueEarly}` : ""}`}
                        >
                          {formatValue(row.currentValue)}
                        </span>
                        <div
                          className={styles.drilldownBarProjected}
                          style={{ height: `${curPct}%` }}
                        >
                          {isViewingCurrentMonth && isDualNavy && curPct > 0 ? (
                            <div
                              className={styles.drilldownBarMtd}
                              style={{
                                height: `${(mtdPct / curPct) * 100}%`,
                              }}
                            />
                          ) : null}
                        </div>
                        {goalPct != null ? (
                          <div
                            className={styles.drilldownGoalTick}
                            style={{ bottom: `${goalPct}%` }}
                          />
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
                <span className={styles.drilldownLabel}>{row.name}</span>
                <div className={styles.drilldownChips}>
                  {metric === "revenue" ||
                  metric === "aov" ||
                  metric === "orders" ? (
                    <>
                      {row.achievement != null ? (
                        <span
                          className={
                            row.achievement >= 100
                              ? styles.chipUp
                              : styles.chipDown
                          }
                        >
                          {t("dashboard.achChip")} {row.achievement.toFixed(0)}%
                        </span>
                      ) : null}
                      {row.yoyPercent != null ? (
                        <span
                          className={
                            row.yoyPercent >= 0
                              ? styles.chipUp
                              : styles.chipDown
                          }
                        >
                          {t("dashboard.yoyChip")}{" "}
                          {row.yoyPercent >= 0 ? "+" : ""}
                          {row.yoyPercent.toFixed(0)}%
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {metric === "bestWorst" ? (
                    <span className={styles.drilldownRankChip}>
                      #{idx + 1}
                    </span>
                  ) : null}
                  {metric === "discount" && row.pyRatePercent != null ? (
                    <span className={styles.chipNeutral}>
                      {t("dashboard.pyLabel")} {row.pyRatePercent.toFixed(1)}%
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
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
    pyMonth,
    currencyCode,
    locationConfigs,
    syncMeta,
    dashboardSnapshots,
    dashboardKpis,
    storesWithGoalsCount,
    campaigns,
    campaignProgress,
  } = useLoaderData<LoaderData>();


  const { t, i18n } = useTranslation("sales-goals");
  const locale = i18n.language;
  const formatCurrency = (value: number, code: string) =>
    fmtCurrencyBase(value, code, locale);
  const formatMonthLabel = (monthStr: string) =>
    fmtMonthBase(monthStr, locale);

  const saveGoalFetcher = useFetcher<{ ok: boolean }>();
  const deleteGoalFetcher = useFetcher<{ ok: boolean }>();
  const syncFetcher = useFetcher<{ ok: boolean }>();
  const bulkFetcher = useFetcher<{ ok: boolean }>();
  const campaignFetcher = useFetcher<{ ok: boolean }>();

  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [dashboardMonth, setDashboardMonth] = useState<string>(currentMonth);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("prev_year");
  const [goalsMonth, setGoalsMonth] = useState<string>(currentMonth);

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

  // Day 1–5 of the current month: projection is noisy, italicize "proj" labels.
  const isCurrentMonthEarly =
    dashboardMonth === currentMonth && new Date().getDate() <= 5;
  const isViewingCurrentMonth = dashboardMonth === currentMonth;

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

  const comparisonMonth = useMemo(
    () => comparisonMonthFor(dashboardMonth, comparisonMode),
    [dashboardMonth, comparisonMode],
  );

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

  const locationRows: LocationRow[] = useMemo(() => {
    return enabledLocations.map((loc) => {
      const current = bucketFor(loc.id, dashboardMonth);
      const prevYear = bucketFor(loc.id, addMonths(dashboardMonth, -12));
      const goal =
        goals.find(
          (g) => g.locationId === loc.id && g.month === dashboardMonth,
        )?.target ?? null;
      const proj = projectionsByLocation[loc.id]?.[dashboardMonth];
      // For past months, projected = actual; for current month, use YoY projection.
      const projectedRevenue = proj
        ? proj.isProjection
          ? (proj.yoy ?? null)
          : (proj.yoy ?? current.revenue)
        : null;
      // Achievement = projected / goal (not MTD / goal)
      const achievement =
        goal != null && goal > 0 && projectedRevenue != null
          ? (projectedRevenue / goal) * 100
          : null;
      // YoY = (projected - PY) / PY
      const yoyDelta =
        projectedRevenue != null
          ? deltaPercent(projectedRevenue, prevYear.revenue)
          : deltaPercent(current.revenue, prevYear.revenue);
      const sparklineValues = months.map(
        (m) => monthlyByLocation[loc.id]?.[m]?.revenue ?? 0,
      );
      return {
        id: loc.id,
        name: loc.name,
        orders: current.orderCount,
        revenue: current.revenue,
        projectedRevenue,
        goal,
        achievement,
        yoyDelta,
        sparklineValues,
        pyRevenue: prevYear.revenue,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabledLocations,
    goals,
    dashboardMonth,
    monthlyByLocation,
    months,
    projectionsByLocation,
  ]);

  // Drilldown sort + max-scale now live inside KpiDrilldownBars, since each
  // metric has a canonical ranking direction.

  const totals = useMemo(() => {
    const revenue = locationRows.reduce((s, r) => s + r.revenue, 0);
    const orders = locationRows.reduce((s, r) => s + r.orders, 0);
    const goal = locationRows.reduce((s, r) => s + (r.goal ?? 0), 0);
    const aov = orders > 0 ? revenue / orders : 0;
    const achievement = goal > 0 ? (revenue / goal) * 100 : null;
    return { revenue, orders, goal, aov, achievement };
  }, [locationRows]);

  const comparisonTotals = useMemo(() => {
    if (!comparisonMonth) return null;
    let revenue = 0;
    let orders = 0;
    for (const loc of enabledLocations) {
      const b = bucketFor(loc.id, comparisonMonth);
      revenue += b.revenue;
      orders += b.orderCount;
    }
    const aov = orders > 0 ? revenue / orders : 0;
    return { revenue, orders, aov };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonMonth, enabledLocations, monthlyByLocation]);

  const revenueDelta =
    comparisonTotals != null
      ? deltaPercent(totals.revenue, comparisonTotals.revenue)
      : null;
  const ordersDelta =
    comparisonTotals != null
      ? deltaPercent(totals.orders, comparisonTotals.orders)
      : null;
  const aovDelta =
    comparisonTotals != null
      ? deltaPercent(totals.aov, comparisonTotals.aov)
      : null;

  const bestPerformer = useMemo(() => {
    const scored = locationRows
      .filter((r) => r.achievement != null)
      .sort((a, b) => (b.achievement ?? 0) - (a.achievement ?? 0));
    return scored[0] ?? null;
  }, [locationRows]);

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
  const lastSyncLabel = syncMeta.lastSyncedAt
    ? new Date(syncMeta.lastSyncedAt).toLocaleString(locale)
    : t("sync.never");
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
              {/* Single-row controls: Month + Compare with + Last synced + Goals chip */}
              <div className={styles.controlsRow}>
                <s-select
                  label={t("dashboard.month")}
                  value={dashboardMonth}
                  onChange={(e: Event) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    if (v) setDashboardMonth(v);
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
                <s-select
                  label={t("dashboard.compareWith")}
                  value={comparisonMode}
                  onChange={(e: Event) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    setComparisonMode(v as ComparisonMode);
                  }}
                >
                  <s-option value="none">
                    {t("dashboard.comparison.none")}
                  </s-option>
                  <s-option value="prev_month">
                    {t("dashboard.comparison.prevMonth")}
                  </s-option>
                  <s-option value="prev_year">
                    {t("dashboard.comparison.prevYear")}
                  </s-option>
                </s-select>
                <span className={`${styles.syncLabel} ${syncStaleClass}`}>
                  {t("sync.lastSynced")}: {lastSyncLabel}
                </span>
                <span className={styles.storesWithGoalsChip}>
                  {t("dashboard.storesWithGoalsChip", {
                    set: storesWithGoalsCount,
                    total: enabledLocations.length,
                  })}
                </span>
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

              {/* ─── Row 1: Scoreboard (Revenue = Orders × AOV) ─── */}
              <div className={styles.kpiGroupLabel}>
                {t("dashboard.kpiGroupScoreboard")}
              </div>
              <div className={styles.kpiGrid}>
                {/* Total revenue — clicking this opens the bar drilldown */}
                {(() => {
                  const k = dashboardKpis.revenue;
                  const projVsGoal =
                    k.projected != null && k.goal != null && k.goal > 0
                      ? ((k.projected - k.goal) / k.goal) * 100
                      : null;
                  const goalVsProj =
                    k.goal != null && k.projected != null && k.projected > 0
                      ? ((k.goal - k.projected) / k.projected) * 100
                      : null;
                  const pyVsProj =
                    k.py > 0 && k.projected != null
                      ? ((k.py - k.projected) / k.projected) * 100
                      : null;
                  return (
                    <KpiRichCard
                      title={t("dashboard.totalRevenue")}
                      primary={formatCurrency(k.mtd, currencyCode)}
                      primaryDelta={projVsGoal}
                      primaryDeltaSuffix={t("dashboard.vsGoal")}
                      projected={
                        k.projected != null
                          ? {
                              value: `${t("dashboard.projLabel")} ${formatCurrency(k.projected, currencyCode)}`,
                              early: isCurrentMonthEarly,
                            }
                          : null
                      }
                      lines={[
                        k.goal != null
                          ? {
                              label: t("dashboard.goalLabel"),
                              value: formatCurrency(k.goal, currencyCode),
                              delta: goalVsProj,
                            }
                          : {
                              label: t("dashboard.goalLabel"),
                              value: "—",
                            },
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
                {/* AOV */}
                {(() => {
                  const k = dashboardKpis.aov;
                  const projVsGoal =
                    k.projected != null && k.goal != null && k.goal > 0
                      ? ((k.projected - k.goal) / k.goal) * 100
                      : null;
                  const goalVsProj =
                    k.goal != null && k.projected != null && k.projected > 0
                      ? ((k.goal - k.projected) / k.projected) * 100
                      : null;
                  const pyVsProj =
                    k.py > 0 && k.projected != null
                      ? ((k.py - k.projected) / k.projected) * 100
                      : null;
                  return (
                    <KpiRichCard
                      title={t("dashboard.aov")}
                      primary={formatCurrency(k.mtd, currencyCode)}
                      primaryDelta={projVsGoal}
                      primaryDeltaSuffix={t("dashboard.vsGoal")}
                      projected={
                        k.projected != null
                          ? {
                              value: `${t("dashboard.projLabel")} ${formatCurrency(k.projected, currencyCode)}`,
                              early: isCurrentMonthEarly,
                            }
                          : null
                      }
                      tooltip={t("dashboard.aovGoalTooltip")}
                      lines={[
                        k.goal != null
                          ? {
                              label: t("dashboard.goalLabel"),
                              value: formatCurrency(k.goal, currencyCode),
                              delta: goalVsProj,
                            }
                          : { label: t("dashboard.goalLabel"), value: "—" },
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
                {/* Orders */}
                {(() => {
                  const k = dashboardKpis.orders;
                  const projVsGoal =
                    k.projected != null && k.goal != null && k.goal > 0
                      ? ((k.projected - k.goal) / k.goal) * 100
                      : null;
                  const goalVsProj =
                    k.goal != null && k.projected != null && k.projected > 0
                      ? ((k.goal - k.projected) / k.projected) * 100
                      : null;
                  const pyVsProj =
                    k.py > 0 && k.projected != null
                      ? ((k.py - k.projected) / k.projected) * 100
                      : null;
                  return (
                    <KpiRichCard
                      title={t("dashboard.orders")}
                      primary={k.mtd.toLocaleString(locale)}
                      primaryDelta={projVsGoal}
                      primaryDeltaSuffix={t("dashboard.vsGoal")}
                      projected={
                        k.projected != null
                          ? {
                              value: `${t("dashboard.projLabel")} ${k.projected.toLocaleString(locale)}`,
                              early: isCurrentMonthEarly,
                            }
                          : null
                      }
                      tooltip={t("dashboard.ordersGoalTooltip")}
                      lines={[
                        k.goal != null
                          ? {
                              label: t("dashboard.goalLabel"),
                              value: Math.round(k.goal).toLocaleString(locale),
                              delta: goalVsProj,
                            }
                          : { label: t("dashboard.goalLabel"), value: "—" },
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
              </div>

              {/* ─── Row-1 drilldown: renders below Row 1 when Revenue/AOV/Orders is active ─── */}
              {activeKpi === "revenue" ||
              activeKpi === "aov" ||
              activeKpi === "orders" ? (
                <KpiDrilldownBars
                  metric={activeKpi}
                  snapshots={dashboardSnapshots}
                  currencyCode={currencyCode}
                  locale={locale}
                  isCurrentMonthEarly={isCurrentMonthEarly}
                  isViewingCurrentMonth={isViewingCurrentMonth}
                  t={t}
                  formatCurrency={formatCurrency}
                />
              ) : null}

              {/* ─── Row 2: Volume / quality ─── */}
              <div className={styles.kpiGroupLabel}>
                {t("dashboard.kpiGroupVolume")}
              </div>
              <div className={styles.kpiGrid}>
                {/* Same-Store YoY */}
                {(() => {
                  const k = dashboardKpis.sameStoreYoY;
                  return (
                    <KpiRichCard
                      title={t("dashboard.sameStoreYoY")}
                      primary={
                        k.deltaPercent != null
                          ? `${k.deltaPercent >= 0 ? "+" : ""}${k.deltaPercent.toFixed(1)}%`
                          : "—"
                      }
                      tooltip={t("dashboard.sameStoreYoyTooltip")}
                      lines={
                        k.qualifyingCount > 0
                          ? [
                              {
                                label: "",
                                value: t("dashboard.declining", {
                                  declining: k.decliningCount,
                                  total: k.qualifyingCount,
                                }),
                              },
                            ]
                          : []
                      }
                      active={activeKpi === "sameStore"}
                      onClick={() => toggleKpi("sameStore")}
                    />
                  );
                })()}
                {/* Best vs worst */}
                {(() => {
                  const k = dashboardKpis.bestVsWorst;
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
                  return (
                    <KpiRichCard
                      title={t("dashboard.bestVsWorst")}
                      primary={k.best.name}
                      primaryDelta={k.gapPp}
                      primaryDeltaSuffix={t("dashboard.aheadLabel")}
                      lines={
                        k.worst
                          ? [
                              {
                                label: t("dashboard.bestAheadOf"),
                                value: `${k.worst.name} ${worstAchPct != null ? `${worstAchPct.toFixed(0)}%` : ""}`,
                              },
                              {
                                label: t("dashboard.bestAchLabel"),
                                value: `${bestAchPct.toFixed(0)}%`,
                              },
                            ]
                          : [
                              {
                                label: t("dashboard.bestAchLabel"),
                                value: `${bestAchPct.toFixed(0)}%`,
                              },
                            ]
                      }
                      active={activeKpi === "bestWorst"}
                      onClick={() => toggleKpi("bestWorst")}
                    />
                  );
                })()}
                {/* Discount rate */}
                {(() => {
                  const k = dashboardKpis.discountRate;
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
                  snapshots={dashboardSnapshots}
                  currencyCode={currencyCode}
                  locale={locale}
                  isCurrentMonthEarly={isCurrentMonthEarly}
                  isViewingCurrentMonth={isViewingCurrentMonth}
                  t={t}
                  formatCurrency={formatCurrency}
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
                        <span>{t("dashboard.mtdRevenue")}</span>
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
                            dashboardKpis.bestVsWorst.best?.locationId ===
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
