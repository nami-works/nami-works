import { useMemo, useState } from "react";
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
import { MultiSelectInput } from "../components/multi-select-input";
import {
  formatCurrency as fmtCurrencyBase,
  formatMonthLabel as fmtMonthBase,
} from "../i18n/format";
import styles from "./app.sales-goals/styles.module.css";

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

type Location = {
  id: string;
  name: string;
};

type MonthlySales = Record<string, Record<string, number>>;

type Publication = {
  id: string;
  name: string;
};

type LocationConfig = {
  enabled: boolean;
  salesChannels: { enabled: boolean; channels: string[] };
  tags: { enabled: boolean; tags: string[] };
  shippingMethods: { enabled: boolean; methods: string[] };
};

type LoaderData = {
  locations: Location[];
  goals: SalesGoal[];
  monthlySales: MonthlySales;
  currencyCode: string;
  publications: Publication[];
  orderTags: string[];
  shippingMethods: string[];
  locationConfigs: { locationId: string; data: LocationConfig }[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TAB_IDS = ["dashboard", "goals", "kpis", "ranking", "settings"] as const;

const DEFAULT_MONTH = new Date().toISOString().slice(0, 7);

const DEFAULT_LOCATION_CONFIG: LocationConfig = {
  enabled: true,
  salesChannels: { enabled: false, channels: [] },
  tags: { enabled: false, tags: [] },
  shippingMethods: { enabled: false, methods: [] },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const monthKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;

const getEventValue = (event: Event) => {
  const current = event.currentTarget as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  const value = current?.value ?? target?.value;
  if (value != null) return value;
  return (event as CustomEvent<{ value?: string }>).detail?.value ?? "";
};

const getEventChecked = (event: Event) => {
  const current = event.currentTarget as HTMLInputElement | null;
  const target = event.target as HTMLInputElement | null;
  const checked = current?.checked ?? target?.checked;
  if (typeof checked === "boolean") return checked;
  return Boolean(
    (event as CustomEvent<{ checked?: boolean }>).detail?.checked,
  );
};

const computeBasePeriod = (month: string, periodType: string) => {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1, 1);
  if (periodType === "previous-month") {
    date.setMonth(date.getMonth() - 1);
  } else if (periodType === "previous-year") {
    date.setFullYear(date.getFullYear() - 1);
  }
  return monthKey(date);
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SalesGoalsPage() {
  const {
    locations,
    goals,
    monthlySales,
    currencyCode,
    publications,
    orderTags,
    shippingMethods: shippingMethodSuggestions,
    locationConfigs,
  } = useLoaderData<LoaderData>();

  const { t, i18n } = useTranslation("sales-goals");
  const locale = i18n.language;
  const formatCurrency = (value: number, code: string) =>
    fmtCurrencyBase(value, code, locale);
  const formatMonthLabel = (monthStr: string) =>
    fmtMonthBase(monthStr, locale);

  const saveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const configFetcher = useFetcher();

  const [activeTab, setActiveTab] =
    useState<(typeof TAB_IDS)[number]>("dashboard");
  const [useCalculator, setUseCalculator] = useState(false);
  const [newGoal, setNewGoal] = useState<Partial<SalesGoal>>({
    locationId: locations[0]?.id ?? "",
    locationName: locations[0]?.name ?? "",
    month: DEFAULT_MONTH,
    target: 0,
    basePeriod: "previous-month",
    baseValue: 0,
    growthType: "percentage",
    growthValue: 0,
  });

  // Local config state — one entry per location
  const [localConfigs, setLocalConfigs] = useState<
    Record<string, LocationConfig>
  >(() =>
    Object.fromEntries(
      locationConfigs.map((c) => [c.locationId, c.data]),
    ),
  );

  const getConfig = (locationId: string): LocationConfig =>
    localConfigs[locationId] ?? { ...DEFAULT_LOCATION_CONFIG };

  const patchConfig = (
    locationId: string,
    patch: Partial<LocationConfig> | ((prev: LocationConfig) => LocationConfig),
  ) => {
    setLocalConfigs((prev) => {
      const current = prev[locationId] ?? { ...DEFAULT_LOCATION_CONFIG };
      const next =
        typeof patch === "function" ? patch(current) : { ...current, ...patch };
      return { ...prev, [locationId]: next };
    });
  };

  const saveCard = (locationId: string) => {
    const fd = new FormData();
    fd.append("intent", "save-location-config");
    fd.append("locationId", locationId);
    fd.append("config", JSON.stringify(getConfig(locationId)));
    configFetcher.submit(fd, { method: "post" });
  };

  // Locations that have the master toggle enabled (default: all enabled)
  const enabledLocations = useMemo(
    () =>
      locations.filter((loc) => {
        const cfg = localConfigs[loc.id];
        return !cfg || cfg.enabled !== false;
      }),
    [locations, localConfigs],
  );

  const goalMonth = newGoal.month ?? DEFAULT_MONTH;
  const locationSales = monthlySales[newGoal.locationId ?? ""] ?? {};
  const basePeriod =
    newGoal.basePeriod && newGoal.basePeriod !== "custom"
      ? computeBasePeriod(goalMonth, newGoal.basePeriod)
      : goalMonth;
  const baseValue = locationSales[basePeriod] ?? 0;

  const handleCalculate = () => {
    if (!newGoal.locationId) return;
    let calculatedTarget = baseValue;
    if (newGoal.growthType === "percentage") {
      calculatedTarget = baseValue * (1 + (newGoal.growthValue ?? 0) / 100);
    } else {
      calculatedTarget = baseValue + (newGoal.growthValue ?? 0);
    }
    setNewGoal((current) => ({
      ...current,
      baseValue,
      target: Math.round(calculatedTarget),
    }));
  };

  const submitGoal = () => {
    if (!newGoal.locationId || !newGoal.target) return;
    const payload: SalesGoal = {
      id: newGoal.id ?? String(Date.now()),
      locationId: newGoal.locationId,
      locationName:
        locations.find((location) => location.id === newGoal.locationId)
          ?.name ?? newGoal.locationName ?? "Location",
      month: newGoal.month ?? DEFAULT_MONTH,
      target: Number(newGoal.target),
      basePeriod: newGoal.basePeriod,
      baseValue: newGoal.baseValue,
      growthType: newGoal.growthType,
      growthValue: newGoal.growthValue,
    };
    const formData = new FormData();
    formData.append("intent", "save-goal");
    formData.append("goal", JSON.stringify(payload));
    saveFetcher.submit(formData, { method: "post" });
    setNewGoal((current) => ({
      ...current,
      target: 0,
      baseValue: 0,
      growthValue: 0,
    }));
    setUseCalculator(false);
  };

  const removeGoal = (id: string) => {
    const formData = new FormData();
    formData.append("intent", "delete-goal");
    formData.append("goalId", id);
    deleteFetcher.submit(formData, { method: "post" });
  };

  const totalSales = useMemo(() => {
    return Object.entries(monthlySales)
      .filter(([locId]) => enabledLocations.some((l) => l.id === locId))
      .reduce((sum, [, byMonth]) => sum + (byMonth[goalMonth] ?? 0), 0);
  }, [monthlySales, goalMonth, enabledLocations]);

  const totalGoal = useMemo(() => {
    return goals
      .filter(
        (goal) =>
          goal.month === goalMonth &&
          enabledLocations.some((l) => l.id === goal.locationId),
      )
      .reduce((sum, goal) => sum + goal.target, 0);
  }, [goals, goalMonth, enabledLocations]);

  const achievementRate =
    totalGoal > 0 ? ((totalSales / totalGoal) * 100).toFixed(1) : "--";

  const rankedGoals = useMemo(() => {
    return goals
      .filter(
        (goal) =>
          goal.month === goalMonth &&
          enabledLocations.some((l) => l.id === goal.locationId),
      )
      .map((goal) => {
        const achieved = monthlySales[goal.locationId]?.[goalMonth] ?? 0;
        const achievement =
          goal.target > 0 ? (achieved / goal.target) * 100 : 0;
        return { ...goal, achieved, achievement };
      })
      .sort((a, b) => b.achievement - a.achievement);
  }, [goals, monthlySales, goalMonth, enabledLocations]);

  const averageTicketRows = useMemo(() => {
    return goals
      .filter((goal) =>
        enabledLocations.some((l) => l.id === goal.locationId),
      )
      .map((goal) => {
        const achieved = monthlySales[goal.locationId]?.[goalMonth] ?? 0;
        return {
          locationName: goal.locationName,
          totalSales: achieved,
          averageTicket: goals.length
            ? achieved / Math.max(1, goals.length)
            : achieved,
        };
      });
  }, [goals, monthlySales, goalMonth, enabledLocations]);

  const channelSuggestions = publications.map((p) => p.name);

  return (
    <s-page heading={t("pageHeading")} inlineSize="base">
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
      {/* ── Dashboard ─────────────────────────────────────────────────────── */}
      {activeTab === "dashboard" ? (
        <>
          <div className={styles.locationSettingsBlock}>
            <div className={styles.blockCard}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("dashboard.title")}</h2>
                <s-text color="subdued">{formatMonthLabel(goalMonth)}</s-text>
                <div className={styles.summaryGrid}>
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <div className={styles.statCardContent}>
                      <span className={styles.statLabel}>{t("dashboard.totalSales")}</span>
                      <span className={styles.statValue}>
                        {formatCurrency(totalSales, currencyCode)}
                      </span>
                    </div>
                  </s-box>
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <div className={styles.statCardContent}>
                      <span className={styles.statLabel}>{t("dashboard.totalGoal")}</span>
                      <span className={styles.statValue}>
                        {formatCurrency(totalGoal, currencyCode)}
                      </span>
                    </div>
                  </s-box>
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <div className={styles.statCardContent}>
                      <span className={styles.statLabel}>{t("dashboard.achievementRate")}</span>
                      <span className={styles.statValue}>{achievementRate}%</span>
                    </div>
                  </s-box>
                </div>
              </s-stack>
            </s-box>
            </div>
          </div>
          <div className={styles.locationSettingsBlock}>
            <div className={styles.blockCard}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("dashboard.salesRanking")}</h2>
                <div className={`${styles.table} ${styles.table3Col}`}>
                  <div className={styles.tableHeader}>
                    <span>{t("common:label.location")}</span>
                    <span>{t("dashboard.actualSales")}</span>
                    <span>{t("dashboard.goal")}</span>
                  </div>
                  {rankedGoals.map((goal) => (
                    <div key={goal.id} className={styles.tableRow}>
                      <span>{goal.locationName}</span>
                      <span>{formatCurrency(goal.achieved, currencyCode)}</span>
                      <span>{formatCurrency(goal.target, currencyCode)}</span>
                    </div>
                  ))}
                </div>
              </s-stack>
            </s-box>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Goals ─────────────────────────────────────────────────────────── */}
      {activeTab === "goals" ? (
        <>
          <div className={styles.locationSettingsBlock}>
            <div className={styles.blockCard}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("goals.title")}</h2>
                <s-text color="subdued">
                  {t("goals.subtitle")}
                </s-text>
                <div className={styles.formGrid}>
              <s-select
                label={t("goals.selectLocation")}
                value={newGoal.locationId}
                onChange={(event: Event) => {
                  const value = getEventValue(event);
                  if (!value) return;
                  const location = enabledLocations.find(
                    (loc) => loc.id === value,
                  );
                  setNewGoal((current) => ({
                    ...current,
                    locationId: value,
                    locationName: location?.name ?? "",
                  }));
                }}
              >
                {enabledLocations.map((location) => (
                  <s-option key={location.id} value={location.id}>
                    {location.name}
                  </s-option>
                ))}
              </s-select>
              <s-text-field
                label={t("goals.referenceMonth")}
                value={goalMonth}
                onChange={(event: Event) =>
                  setNewGoal((current) => ({
                    ...current,
                    month: getEventValue(event),
                  }))
                }
              />
            </div>
            <div className={styles.calculatorRow}>
              <s-checkbox
                checked={useCalculator}
                accessibilityLabel={t("goals.enableCalculator")}
                onChange={(event: Event) =>
                  setUseCalculator(getEventChecked(event))
                }
              />
              <s-text type="strong">
                {t("goals.calculateBasedOnPrevious")}
              </s-text>
            </div>
            {useCalculator ? (
              <div className={styles.calculatorPanel}>
                <div className={styles.formGrid}>
                  <s-select
                    label={t("goals.basePeriod")}
                    value={newGoal.basePeriod}
                    onChange={(event: Event) =>
                      setNewGoal((current) => ({
                        ...current,
                        basePeriod: getEventValue(event),
                      }))
                    }
                  >
                    <s-option value="previous-month">{t("goals.previousMonth")}</s-option>
                    <s-option value="previous-year">{t("goals.previousYear")}</s-option>
                  </s-select>
                  <s-select
                    label={t("goals.growthType")}
                    value={newGoal.growthType}
                    onChange={(event: Event) =>
                      setNewGoal((current) => ({
                        ...current,
                        growthType: getEventValue(event) as
                          | "percentage"
                          | "absolute",
                      }))
                    }
                  >
                    <s-option value="percentage">{t("goals.percentage")}</s-option>
                    <s-option value="absolute">{t("goals.absolute")}</s-option>
                  </s-select>
                  <s-text-field
                    label={
                      newGoal.growthType === "percentage"
                        ? t("goals.growthPercent")
                        : t("goals.growth")
                    }
                    value={String(newGoal.growthValue ?? "")}
                    onChange={(event: Event) =>
                      setNewGoal((current) => ({
                        ...current,
                        growthValue: Number(getEventValue(event)),
                      }))
                    }
                  />
                </div>
                <s-button
                  variant="secondary"
                  onClick={handleCalculate}
                  disabled={!newGoal.locationId}
                >
                  {t("goals.calculateGoal")}
                </s-button>
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-text color="subdued">
                    {t("goals.basePeriodSales")}{" "}
                    {formatCurrency(baseValue, currencyCode)}
                  </s-text>
                </s-box>
              </div>
            ) : null}
            <s-text-field
              label={t("goals.salesGoal")}
              value={String(newGoal.target ?? "")}
              onChange={(event: Event) =>
                setNewGoal((current) => ({
                  ...current,
                  target: Number(getEventValue(event)),
                }))
              }
            />
                <div className={styles.actionsRow}>
                  <s-button
                    variant="primary"
                    onClick={submitGoal}
                    disabled={!newGoal.locationId || !newGoal.target}
                  >
                    {t("goals.saveGoal")}
                  </s-button>
                </div>
              </s-stack>
            </s-box>
            </div>
          </div>
          <div className={styles.locationSettingsBlock}>
            <div className={styles.blockCard}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("goals.registeredGoals")}</h2>
                <div className={`${styles.table} ${styles.table5Col}`}>
              <div className={styles.tableHeader}>
                <span>{t("common:label.location")}</span>
                <span>{t("goals.month")}</span>
                <span>{t("goals.base")}</span>
                <span>{t("dashboard.goal")}</span>
                <span></span>
              </div>
              {goals
                .filter((goal) =>
                  enabledLocations.some((l) => l.id === goal.locationId),
                )
                .map((goal) => (
                  <div key={goal.id} className={styles.tableRow}>
                    <span>{goal.locationName}</span>
                    <span>{formatMonthLabel(goal.month)}</span>
                    <span>
                      {goal.baseValue
                        ? formatCurrency(goal.baseValue, currencyCode)
                        : t("goals.manual")}
                    </span>
                    <span>{formatCurrency(goal.target, currencyCode)}</span>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => removeGoal(goal.id)}
                    >
                      {t("common:button.delete")}
                    </s-button>
                  </div>
                ))}
                </div>
              </s-stack>
            </s-box>
            </div>
          </div>
        </>
      ) : null}

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      {activeTab === "kpis" ? (
        <>
          <div className={styles.locationSettingsBlock}>
            <div className={styles.blockCard}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("kpis.title")}</h2>
                <s-text color="subdued">
                  {t("kpis.subtitle")}
                </s-text>
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <div className={styles.statCardContent}>
                    <span className={styles.statLabel}>{t("kpis.overallAov")}</span>
                    <span className={styles.statValue}>
                      {formatCurrency(
                        totalSales / Math.max(1, enabledLocations.length),
                        currencyCode,
                      )}
                    </span>
                  </div>
                </s-box>
              </s-stack>
            </s-box>
            </div>
          </div>
          <div className={styles.locationSettingsBlock}>
            <div className={styles.blockCard}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("kpis.breakdown")}</h2>
                <div className={`${styles.table} ${styles.table3Col}`}>
                  <div className={styles.tableHeader}>
                    <span>{t("common:label.location")}</span>
                    <span>{t("kpis.totalSales")}</span>
                    <span>{t("kpis.aov")}</span>
                  </div>
                  {averageTicketRows.map((row) => (
                    <div key={row.locationName} className={styles.tableRow}>
                      <span>{row.locationName}</span>
                      <span>{formatCurrency(row.totalSales, currencyCode)}</span>
                      <span>{formatCurrency(row.averageTicket, currencyCode)}</span>
                    </div>
                  ))}
                </div>
              </s-stack>
            </s-box>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Ranking ───────────────────────────────────────────────────────── */}
      {activeTab === "ranking" ? (
        <>
          <div className={styles.locationSettingsBlock}>
            <div className={styles.blockCard}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("ranking.title")}</h2>
                <s-text color="subdued">
                  {t("ranking.subtitle")}
                </s-text>
                <div className={styles.summaryGrid}>
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <div className={styles.statCardContent}>
                      <span className={styles.statLabel}>{t("ranking.locationsAboveGoal")}</span>
                      <span className={styles.statValue}>
                        {rankedGoals.filter((goal) => goal.achievement >= 100).length}{" "}
                        {t("ranking.of")} {rankedGoals.length}
                      </span>
                    </div>
                  </s-box>
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <div className={styles.statCardContent}>
                      <span className={styles.statLabel}>{t("ranking.averageAchievement")}</span>
                      <span className={styles.statValue}>
                        {rankedGoals.length
                          ? (
                              rankedGoals.reduce(
                                (sum, goal) => sum + goal.achievement,
                                0,
                              ) / rankedGoals.length
                            ).toFixed(1)
                          : "--"}
                        %
                      </span>
                    </div>
                  </s-box>
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <div className={styles.statCardContent}>
                      <span className={styles.statLabel}>{t("ranking.bestPerformance")}</span>
                      <span className={styles.statValue}>
                        {rankedGoals[0]?.locationName ?? "--"}
                      </span>
                    </div>
                  </s-box>
                </div>
              </s-stack>
            </s-box>
            </div>
          </div>
          <div className={styles.locationSettingsBlock}>
            <div className={styles.blockCard}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("ranking.rankingByAchievement")}</h2>
                <div className={`${styles.table} ${styles.table4Col}`}>
                  <div className={styles.tableHeader}>
                    <span>{t("common:label.location")}</span>
                    <span>{t("ranking.goal")}</span>
                    <span>{t("ranking.achieved")}</span>
                    <span>{t("ranking.achievement")}</span>
                  </div>
                  {rankedGoals.map((goal) => (
                    <div key={goal.id} className={styles.tableRow}>
                      <span>{goal.locationName}</span>
                      <span>{formatCurrency(goal.target, currencyCode)}</span>
                      <span>{formatCurrency(goal.achieved, currencyCode)}</span>
                      <span>{goal.achievement.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </s-stack>
            </s-box>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Settings ──────────────────────────────────────────────────────── */}
      {activeTab === "settings" ? (
        <div className={styles.locationSettingsBlock}>
          <div className={styles.blockCard}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>{t("settings.title")}</h2>
              <s-text color="subdued">
                {t("settings.subtitle")}
              </s-text>
              <div className={styles.settingsGrid}>
            {locations.map((loc) => {
              const cfg = getConfig(loc.id);
              return (
                <div key={loc.id} className={styles.locationCard}>
                  {/* Master toggle */}
                  <div className={styles.paramToggleRow}>
                    <h3 className={styles.locationCardTitle}>{loc.name}</h3>
                    <div className={styles.toggleLabelRow}>
                      <span className={styles.paramLabel}>
                        {t("settings.manageGoals")}
                      </span>
                      <s-checkbox
                        checked={cfg.enabled}
                        accessibilityLabel={`Manage goals for ${loc.name}`}
                        onChange={(e: Event) =>
                          patchConfig(loc.id, { enabled: getEventChecked(e) })
                        }
                      />
                    </div>
                  </div>

                  <hr className={styles.paramDivider} />

                  {/* Historic sales parameters */}
                  <div>
                    <p className={styles.paramSectionLabel}>
                      {t("settings.historicParams")}
                    </p>
                    <div className={styles.paramGrid}>
                      {/* Sales channels */}
                      <div className={styles.paramBlock}>
                        <div className={styles.paramToggleRow}>
                          <span className={styles.paramLabel}>
                            {t("settings.salesChannels")}
                          </span>
                          <s-checkbox
                            checked={cfg.salesChannels.enabled}
                            accessibilityLabel="Enable sales channels filter"
                            disabled={!cfg.enabled}
                            onChange={(e: Event) =>
                              patchConfig(loc.id, (prev) => ({
                                ...prev,
                                salesChannels: {
                                  ...prev.salesChannels,
                                  enabled: getEventChecked(e),
                                },
                              }))
                            }
                          />
                        </div>
                        <MultiSelectInput
                          value={cfg.salesChannels.channels}
                          suggestions={channelSuggestions}
                          disabled={
                            !cfg.enabled || !cfg.salesChannels.enabled
                          }
                          placeholder={t("settings.searchChannels")}
                          onChange={(next) =>
                            patchConfig(loc.id, (prev) => ({
                              ...prev,
                              salesChannels: {
                                ...prev.salesChannels,
                                channels: next,
                              },
                            }))
                          }
                        />
                      </div>

                      {/* Tags */}
                      <div className={styles.paramBlock}>
                        <div className={styles.paramToggleRow}>
                          <span className={styles.paramLabel}>{t("settings.tags")}</span>
                          <s-checkbox
                            checked={cfg.tags.enabled}
                            accessibilityLabel="Enable tags filter"
                            disabled={!cfg.enabled}
                            onChange={(e: Event) =>
                              patchConfig(loc.id, (prev) => ({
                                ...prev,
                                tags: {
                                  ...prev.tags,
                                  enabled: getEventChecked(e),
                                },
                              }))
                            }
                          />
                        </div>
                        <MultiSelectInput
                          value={cfg.tags.tags}
                          suggestions={orderTags}
                          disabled={!cfg.enabled || !cfg.tags.enabled}
                          placeholder={t("settings.searchTags")}
                          onChange={(next) =>
                            patchConfig(loc.id, (prev) => ({
                              ...prev,
                              tags: { ...prev.tags, tags: next },
                            }))
                          }
                        />
                      </div>

                      {/* Shipping methods */}
                      <div className={styles.paramBlock}>
                        <div className={styles.paramToggleRow}>
                          <span className={styles.paramLabel}>
                            {t("settings.shippingMethods")}
                          </span>
                          <s-checkbox
                            checked={cfg.shippingMethods.enabled}
                            accessibilityLabel="Enable shipping methods filter"
                            disabled={!cfg.enabled}
                            onChange={(e: Event) =>
                              patchConfig(loc.id, (prev) => ({
                                ...prev,
                                shippingMethods: {
                                  ...prev.shippingMethods,
                                  enabled: getEventChecked(e),
                                },
                              }))
                            }
                          />
                        </div>
                        <MultiSelectInput
                          value={cfg.shippingMethods.methods}
                          suggestions={shippingMethodSuggestions}
                          disabled={
                            !cfg.enabled || !cfg.shippingMethods.enabled
                          }
                          placeholder={t("settings.searchShippingMethods")}
                          onChange={(next) =>
                            patchConfig(loc.id, (prev) => ({
                              ...prev,
                              shippingMethods: {
                                ...prev.shippingMethods,
                                methods: next,
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* Per-card save */}
                  <div className={styles.settingsSaveRow}>
                    <s-button
                      variant="primary"
                      onClick={() => saveCard(loc.id)}
                      disabled={configFetcher.state !== "idle"}
                    >
                      {t("common:button.save")}
                    </s-button>
                  </div>
                </div>
              );
            })}
          </div>
              </s-stack>
            </s-box>
          </div>
        </div>
      ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  console.info(`[sales-goals] loader START shop=${shop}`);

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 13);
  const startKey = startDate.toISOString().slice(0, 10);
  const endKey = new Date().toISOString().slice(0, 10);

  // Fetch in parallel: locations, orders (tags + shipping), publications, location configs
  const [
    locationsResponse,
    ordersResponse,
    pubsResponse,
    locationConfigRows,
    configRecord,
  ] = await Promise.all([
    admin.graphql(
      `#graphql
        query LocationsForSalesGoals {
          locations(first: 50) {
            nodes { id name }
          }
        }`,
    ),
    admin.graphql(
      `#graphql
        query OrdersForSalesGoals($first: Int!, $query: String) {
          orders(first: $first, query: $query) {
            nodes {
              processedAt
              createdAt
              tags
              currentTotalPriceSet {
                shopMoney { amount currencyCode }
              }
              shippingLines(first: 5) {
                nodes { title }
              }
              fulfillmentOrders(first: 5) {
                nodes {
                  assignedLocation {
                    location { id name }
                  }
                }
              }
            }
          }
        }`,
      {
        variables: {
          first: 100,
          query: `created_at:>=${startKey} created_at:<=${endKey}`,
        },
      },
    ),
    admin.graphql(
      `#graphql
        query SalesGoalsPublications {
          publications(first: 250) {
            nodes { id name }
          }
        }`,
    ),
    prisma.salesGoalsLocationConfig.findMany({ where: { shop } }),
    prisma.salesGoalsConfig.findUnique({ where: { shop } }),
  ]);

  const locationsJson = await locationsResponse.json();
  const locations = (locationsJson.data.locations.nodes ?? []) as Location[];

  const ordersJson = await ordersResponse.json();
  const orders = ordersJson.data.orders.nodes ?? [];

  const pubsJson = await pubsResponse.json();
  const publications = (pubsJson.data.publications.nodes ?? []) as Publication[];

  // Aggregate monthly sales
  const monthlySales: MonthlySales = {};
  let currencyCode = "USD";
  const allTags = new Set<string>();
  const allShippingMethods = new Set<string>();

  orders.forEach((order: any) => {
    const amount = Number(order.currentTotalPriceSet?.shopMoney?.amount ?? 0);
    currencyCode =
      order.currentTotalPriceSet?.shopMoney?.currencyCode ?? currencyCode;
    const date = new Date(order.processedAt ?? order.createdAt);
    const month = monthKey(date);

    // Tags
    (order.tags ?? []).forEach((t: string) => allTags.add(t));

    // Shipping methods
    (order.shippingLines?.nodes ?? []).forEach((line: { title: string }) => {
      if (line.title) allShippingMethods.add(line.title);
    });

    const location =
      order.fulfillmentOrders.nodes[0]?.assignedLocation?.location;
    if (!location?.id) return;
    if (!monthlySales[location.id]) monthlySales[location.id] = {};
    monthlySales[location.id][month] =
      (monthlySales[location.id][month] ?? 0) + amount;
  });

  const goals = (configRecord?.data as SalesGoal[] | null) ?? [];

  console.info(
    `[sales-goals] loader OK shop=${shop} locations=${locations.length} orders=${orders.length} goals=${goals.length} publications=${publications.length}`,
  );

  return {
    locations,
    goals,
    monthlySales,
    currencyCode,
    publications,
    orderTags: Array.from(allTags).sort(),
    shippingMethods: Array.from(allShippingMethods).sort(),
    locationConfigs: locationConfigRows.map((row) => ({
      locationId: row.locationId,
      data: row.data as LocationConfig,
    })),
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
    const updated = goals.filter((item) => item.id !== goal.id).concat(goal);
    await prisma.salesGoalsConfig.upsert({
      where: { shop },
      update: { data: updated },
      create: { shop, data: updated },
    });
    console.info(`[sales-goals] save-goal OK shop=${shop}`);
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
      update: { data: config as any },
      create: { shop, locationId, data: config as any },
    });
    console.info(`[sales-goals] save-location-config OK shop=${shop} locationId=${locationId}`);
    return { ok: true };
  }

  return { ok: false, error: "Unsupported request." };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
