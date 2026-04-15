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
  queryMonthlyAggregates,
  readSyncMeta,
  type MonthlyAggregateRow,
  type MonthProjection,
  type SyncMetaRecord,
} from "../sales-goals/analytics-queries.server";
import { runSalesGoalsSync } from "../sales-goals/sync.server";

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
};

type MonthlyByLocation = Record<string, Record<string, MonthlyBucket>>;

type LoaderData = {
  locations: RetailLocation[]; // all active non-fulfillment-service locations
  goals: SalesGoal[];
  monthlyByLocation: MonthlyByLocation;
  projectionsByLocation: Record<string, Record<string, MonthProjection>>;
  months: string[]; // YYYY-MM keys, oldest → newest
  currentMonth: string;
  currencyCode: string;
  orderSources: string[];
  orderTags: string[];
  locationConfigs: { locationId: string; data: LocationConfig }[];
  syncMeta: SyncMetaRecord;
};

type TabId = "dashboard" | "goals";
type ComparisonMode = "none" | "prev_month" | "prev_year";

// ─── Constants ────────────────────────────────────────────────────────────────

const TAB_IDS: TabId[] = ["dashboard", "goals"];

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
    };
    if (row.currencyCode) currencyCode = row.currencyCode;
  }

  // Collect tag suggestions from saved configs (sync-based, not live from Shopify).
  for (const row of locationConfigRows) {
    const cfg = normalizeLocationConfig(row.data);
    cfg.tags.tags.forEach((t) => allTags.add(t));
  }

  const goals = (configRecord?.data as SalesGoal[] | null) ?? [];

  const result: LoaderData = {
    locations: candidateLocations,
    goals,
    monthlyByLocation,
    projectionsByLocation,
    months,
    currentMonth,
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
  };

  console.info(
    `[sales-goals] loader OK shop=${shop} candidates=${candidateLocations.length} monthlyRows=${aggregates.length} goals=${goals.length} syncStatus=${syncMeta.status}`,
  );
  return result;
};

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function SalesGoalsPage() {
  const {
    locations,
    goals,
    monthlyByLocation,
    projectionsByLocation,
    months,
    currentMonth,
    currencyCode,
    locationConfigs,
    syncMeta,
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

  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [dashboardMonth, setDashboardMonth] = useState<string>(currentMonth);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("prev_year");
  const [goalsMonth, setGoalsMonth] = useState<string>(currentMonth);

  type KpiKey =
    | "revenue"
    | "goal"
    | "achievement"
    | "orders"
    | "aov"
    | "best";
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null);
  const toggleKpi = (key: KpiKey) =>
    setActiveKpi((prev) => (prev === key ? null : key));

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
    if (!month) return { orderCount: 0, revenue: 0 };
    return monthlyByLocation[locationId]?.[month] ?? { orderCount: 0, revenue: 0 };
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
    goal: number | null;
    achievement: number | null;
    yoyDelta: number | null;
    sparklineValues: number[];
  };

  const locationRows: LocationRow[] = useMemo(() => {
    return enabledLocations.map((loc) => {
      const current = bucketFor(loc.id, dashboardMonth);
      const prevYear = bucketFor(loc.id, addMonths(dashboardMonth, -12));
      const goal =
        goals.find(
          (g) => g.locationId === loc.id && g.month === dashboardMonth,
        )?.target ?? null;
      const achievement =
        goal != null && goal > 0 ? (current.revenue / goal) * 100 : null;
      const yoyDelta = deltaPercent(current.revenue, prevYear.revenue);
      const sparklineValues = months.map(
        (m) => monthlyByLocation[loc.id]?.[m]?.revenue ?? 0,
      );
      return {
        id: loc.id,
        name: loc.name,
        orders: current.orderCount,
        revenue: current.revenue,
        goal,
        achievement,
        yoyDelta,
        sparklineValues,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledLocations, goals, dashboardMonth, monthlyByLocation, months]);

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
        return rows.sort((a, b) => b.revenue - a.revenue);
      case "goal":
        return rows.sort((a, b) => nullLast(b.goal) - nullLast(a.goal));
      case "achievement":
      case "best":
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
              {/* Header */}
              <div className={styles.controlsRow}>
                <div className={styles.controlsLeft}>
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
                </div>
                <div className={styles.controlsRight}>
                  <span className={styles.syncLabel}>
                    {t("sync.lastSynced")}: {lastSyncLabel}
                  </span>
                  <s-button
                    variant="secondary"
                    onClick={triggerSyncNow}
                    disabled={isSyncing}
                  >
                    {isSyncing ? t("sync.syncing") : t("sync.syncNow")}
                  </s-button>
                </div>
              </div>

              {isSyncing ? (
                <s-banner tone="info">
                  {t("sync.bannerSyncing", {
                    phase: syncMeta.phase ?? "fetching",
                    count: syncMeta.progressCount ?? 0,
                  })}
                </s-banner>
              ) : null}

              {/* KPIs — Row 1: Scoreboard */}
              <div className={styles.kpiGroupLabel}>
                {t("dashboard.kpiGroupScoreboard")}
              </div>
              <div className={styles.kpiGrid}>
                <KpiCard
                  label={t("dashboard.totalRevenue")}
                  primary={formatCurrency(totals.revenue, currencyCode)}
                  secondary={
                    comparisonTotals
                      ? `${t("dashboard.vsCompare")}: ${formatCurrency(
                          comparisonTotals.revenue,
                          currencyCode,
                        )}`
                      : undefined
                  }
                  delta={revenueDelta}
                  active={activeKpi === "revenue"}
                  onClick={() => toggleKpi("revenue")}
                />
                <KpiCard
                  label={t("dashboard.totalGoal")}
                  primary={formatCurrency(totals.goal, currencyCode)}
                  secondary={
                    totals.goal === 0
                      ? t("dashboard.noGoalsSet")
                      : t("dashboard.sumAcrossStores", {
                          count: locationRows.filter((r) => r.goal != null).length,
                        })
                  }
                  active={activeKpi === "goal"}
                  onClick={() => toggleKpi("goal")}
                />
                <KpiCard
                  label={t("dashboard.achievement")}
                  primary={
                    totals.achievement != null
                      ? `${totals.achievement.toFixed(1)}%`
                      : "—"
                  }
                  secondary={
                    totals.goal > 0
                      ? formatCurrency(
                          totals.revenue - totals.goal,
                          currencyCode,
                        )
                      : undefined
                  }
                  active={activeKpi === "achievement"}
                  onClick={() => toggleKpi("achievement")}
                />
              </div>

              {/* KPIs — Row 2: Volume / Quality */}
              <div className={styles.kpiGroupLabel}>
                {t("dashboard.kpiGroupVolume")}
              </div>
              <div className={styles.kpiGrid}>
                <KpiCard
                  label={t("dashboard.bestPerformer")}
                  primary={bestPerformer?.name ?? "—"}
                  secondary={
                    bestPerformer?.achievement != null
                      ? `${bestPerformer.achievement.toFixed(1)}%`
                      : undefined
                  }
                  active={activeKpi === "best"}
                  onClick={() => toggleKpi("best")}
                />
                <KpiCard
                  label={t("dashboard.aov")}
                  primary={formatCurrency(totals.aov, currencyCode)}
                  delta={aovDelta}
                  active={activeKpi === "aov"}
                  onClick={() => toggleKpi("aov")}
                />
                <KpiCard
                  label={t("dashboard.orderCount")}
                  primary={totals.orders.toLocaleString(locale)}
                  delta={ordersDelta}
                  active={activeKpi === "orders"}
                  onClick={() => toggleKpi("orders")}
                />
              </div>

              {/* Per-location table */}
              <div className={styles.blockCard}>
                <s-box padding="base" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    <h2 className={styles.sectionTitle}>
                      {t("dashboard.breakdownTitle")}
                    </h2>
                    <div className={`${styles.table} ${styles.tableLocations}`}>
                      <div className={styles.tableHeader}>
                        <span>{t("common:label.location")}</span>
                        <span>{t("dashboard.orders")}</span>
                        <span>{t("dashboard.revenue")}</span>
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
                            activeKpi === "best" &&
                            bestPerformer?.id === row.id;
                          return (
                            <div
                              key={row.id}
                              className={`${styles.tableRow}${isBestHighlight ? ` ${styles.tableRowHighlight}` : ""}`}
                            >
                            <span>{row.name}</span>
                            <span>{row.orders.toLocaleString(locale)}</span>
                            <span>
                              {formatCurrency(row.revenue, currencyCode)}
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
