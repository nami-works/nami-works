import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import { normalizeLocale } from "../i18n/config";
import styles from "./app.affiliates/styles.module.css";
import {
  readAffiliateProfiles,
  readAffiliateSyncMeta,
  importBixGrowCsv,
  upsertAffiliateProfile,
  deleteAffiliateProfile,
} from "../affiliates/storage.server";
import type { AffiliateProfile } from "../affiliates/storage.server";
import { backfillAffiliateOrders } from "../affiliates/sync.server";
import { getAffiliateDashboardStats } from "../affiliates/analytics-queries.server";
import type { AffiliateOverviewStats } from "../affiliates/overview-stats.server";

// ─── Types ──────────────────────────────────────────────────────────────────

type LoaderData = {
  profiles: AffiliateProfile[];
  syncStatus: "idle" | "running" | "failed";
  syncError: string | null;
  syncWarning: string | null;
  syncPhase: string | null;
  syncProgressCount: number | null;
  syncStartedAt: string | null;
  syncTotalOrders: number | null;
  syncTotalAffiliateOrders: number | null;
  syncLastSyncedAt: string | null;
  userLocale: string;
};

type PeriodPreset =
  | "last_7d"
  | "last_30d"
  | "last_month"
  | "last_3_months"
  | "custom";

type ComparisonMode = "none" | "prev_period" | "prev_year" | "custom";

type DrillDownKey = string | null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrencyCompact(
  value: number,
  currency: string,
  locale: string,
): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M ${currency}`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K ${currency}`;
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumberCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function getPresetDates(preset: PeriodPreset): {
  start: string;
  end: string;
} {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  let start: Date;

  switch (preset) {
    case "last_7d":
      start = new Date(now);
      start.setDate(start.getDate() - 6);
      break;
    case "last_30d":
      start = new Date(now);
      start.setDate(start.getDate() - 29);
      break;
    case "last_month": {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        start: start.toISOString().slice(0, 10),
        end: lastDay.toISOString().slice(0, 10),
      };
    }
    case "last_3_months":
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      break;
    default:
      start = new Date(now);
      start.setDate(start.getDate() - 29);
  }

  start.setHours(0, 0, 0, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function getComparisonDates(
  mode: ComparisonMode,
  start: string,
  end: string,
): { compStart: string; compEnd: string } | null {
  if (mode === "none") return null;
  const s = new Date(start);
  const e = new Date(end);
  const rangeDays = Math.round(
    (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (mode === "prev_period") {
    const compEnd = new Date(s);
    compEnd.setDate(compEnd.getDate() - 1);
    const compStart = new Date(compEnd);
    compStart.setDate(compStart.getDate() - rangeDays);
    return {
      compStart: compStart.toISOString().slice(0, 10),
      compEnd: compEnd.toISOString().slice(0, 10),
    };
  }

  if (mode === "prev_year") {
    const compStart = new Date(s);
    compStart.setFullYear(compStart.getFullYear() - 1);
    const compEnd = new Date(e);
    compEnd.setFullYear(compEnd.getFullYear() - 1);
    return {
      compStart: compStart.toISOString().slice(0, 10),
      compEnd: compEnd.toISOString().slice(0, 10),
    };
  }

  return null;
}

// ─── Loader ─────────────────────────────────────────────────────────────────

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userLocale = normalizeLocale((session as any).locale);

  const [profiles, syncMeta] = await Promise.all([
    readAffiliateProfiles(shop),
    readAffiliateSyncMeta(shop),
  ]);

  const hasData =
    syncMeta.totalAffiliateOrders != null &&
    syncMeta.totalAffiliateOrders > 0;
  const effectiveStatus =
    syncMeta.status === "failed" && hasData ? "idle" : syncMeta.status;
  const syncWarning =
    syncMeta.status === "failed" && hasData
      ? (syncMeta.errorMessage ?? null)
      : null;

  console.info(
    `[affiliates] loader shop=${shop} syncStatus=${syncMeta.status}->${effectiveStatus} profiles=${profiles.length} lastSynced=${syncMeta.lastSyncedAt ?? "?"}`,
  );

  return {
    profiles,
    syncStatus: effectiveStatus as LoaderData["syncStatus"],
    syncError:
      effectiveStatus === "failed" ? (syncMeta.errorMessage ?? null) : null,
    syncWarning,
    syncPhase: syncMeta.phase,
    syncProgressCount: syncMeta.progressCount,
    syncStartedAt: syncMeta.startedAt,
    syncTotalOrders: syncMeta.totalOrders,
    syncTotalAffiliateOrders: syncMeta.totalAffiliateOrders,
    syncLastSyncedAt: syncMeta.lastSyncedAt,
    userLocale,
  };
};

// ─── Headers ────────────────────────────────────────────────────────────────

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

// ─── Action ─────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  console.info(`[affiliates] action intent=${intent ?? "?"} shop=${shop}`);

  if (intent === "sync-orders") {
    // Fire-and-forget
    backfillAffiliateOrders(admin, shop).catch((err) => {
      console.error(`[affiliates] background sync FAILED shop=${shop}`, err);
    });
    return { ok: true, intent: "sync-orders" };
  }

  if (intent === "fetch-dashboard-stats") {
    const startDate = String(formData.get("startDate") || "");
    const endDate = String(formData.get("endDate") || "");
    const compStart = formData.get("compStart")
      ? String(formData.get("compStart"))
      : null;
    const compEnd = formData.get("compEnd")
      ? String(formData.get("compEnd"))
      : null;
    const affiliateCode = formData.get("affiliateCode")
      ? String(formData.get("affiliateCode"))
      : null;

    try {
      const stats = await getAffiliateDashboardStats(
        shop,
        startDate,
        endDate,
        compStart,
        compEnd,
        affiliateCode,
      );
      return { ok: true, intent: "fetch-dashboard-stats", stats };
    } catch (error) {
      console.error(`[affiliates] fetch-dashboard-stats FAILED shop=${shop}`, error);
      return {
        ok: false,
        intent: "fetch-dashboard-stats",
        error: String((error as Error)?.message ?? "Failed to fetch stats"),
      };
    }
  }

  if (intent === "import-bixgrow-csv") {
    const csvText = String(formData.get("csvText") || "");
    if (!csvText.trim()) {
      return { ok: false, intent: "import-bixgrow-csv", error: "No CSV data provided" };
    }
    try {
      const result = await importBixGrowCsv(shop, csvText);
      return { ok: true, intent: "import-bixgrow-csv", result };
    } catch (error) {
      console.error(`[affiliates] import-bixgrow-csv FAILED shop=${shop}`, error);
      return {
        ok: false,
        intent: "import-bixgrow-csv",
        error: String((error as Error)?.message ?? "Import failed"),
      };
    }
  }

  if (intent === "update-profile") {
    const code = String(formData.get("code") || "");
    const affiliateName = String(formData.get("affiliateName") || code);
    const commissionPct = Number(formData.get("commissionPct") || 10);
    const tier = String(formData.get("tier") || "baseline");
    const status = String(formData.get("status") || "active");
    const notes = formData.get("notes") ? String(formData.get("notes")) : null;

    try {
      await upsertAffiliateProfile(shop, {
        code,
        affiliateName,
        commissionPct,
        tier,
        status,
        notes,
      });
      return { ok: true, intent: "update-profile" };
    } catch (error) {
      console.error(`[affiliates] update-profile FAILED shop=${shop}`, error);
      return {
        ok: false,
        intent: "update-profile",
        error: String((error as Error)?.message ?? "Update failed"),
      };
    }
  }

  if (intent === "delete-profile") {
    const profileId = String(formData.get("profileId") || "");
    try {
      await deleteAffiliateProfile(shop, profileId);
      return { ok: true, intent: "delete-profile" };
    } catch (error) {
      console.error(`[affiliates] delete-profile FAILED shop=${shop}`, error);
      return {
        ok: false,
        intent: "delete-profile",
        error: String((error as Error)?.message ?? "Delete failed"),
      };
    }
  }

  return { ok: false, error: "Unknown intent" };
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function AffiliatesPage() {
  const {
    profiles,
    syncStatus,
    syncError,
    syncWarning,
    syncPhase,
    syncProgressCount,
    syncStartedAt: _syncStartedAt,
    syncTotalOrders,
    syncTotalAffiliateOrders,
    syncLastSyncedAt,
    userLocale,
  } = useLoaderData<LoaderData>();

  void _syncStartedAt; // reserved for future elapsed-time display
  const { t } = useTranslation("affiliates");
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── State ──────────────────────────────────────────────────────────
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("last_30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("none");
  const [selectedAffiliate, setSelectedAffiliate] = useState("all");

  const [dashboardStats, setDashboardStats] =
    useState<AffiliateOverviewStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [row1DrillDown, setRow1DrillDown] = useState<DrillDownKey>(null);
  const [row2DrillDown, setRow2DrillDown] = useState<DrillDownKey>(null);
  const [row3DrillDown, setRow3DrillDown] = useState<DrillDownKey>(null);

  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const [editingProfile, setEditingProfile] =
    useState<AffiliateProfile | null>(null);
  const [editCommission, setEditCommission] = useState("10");
  const [editTier, setEditTier] = useState("baseline");
  const [editStatus, setEditStatus] = useState("active");
  const [editNotes, setEditNotes] = useState("");
  const [deleteConfirmProfileId, setDeleteConfirmProfileId] = useState<string | null>(null);

  // ─── Sync polling ───────────────────────────────────────────────────
  useEffect(() => {
    if (syncStatus === "running") {
      pollRef.current = setInterval(() => {
        revalidator.revalidate();
      }, 5000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [syncStatus, revalidator]);

  // ─── Fetch dashboard on action response ──────────────────────────────
  useEffect(() => {
    if (fetcher.data?.intent === "fetch-dashboard-stats") {
      if (fetcher.data.ok && fetcher.data.stats) {
        setDashboardStats(fetcher.data.stats as AffiliateOverviewStats);
        setStatsError(null);
      } else if (fetcher.data.error) {
        setStatsError(fetcher.data.error);
      }
      setStatsLoading(false);
    }
    if (fetcher.data?.intent === "import-bixgrow-csv") {
      if (fetcher.data.ok && fetcher.data.result) {
        setImportResult(fetcher.data.result);
        revalidator.revalidate();
      } else if (fetcher.data.error) {
        setImportResult({ imported: 0, skipped: 0, errors: [fetcher.data.error] });
      }
    }
    if (fetcher.data?.intent === "update-profile") {
      if (fetcher.data.ok) {
        setEditingProfile(null);
        document.getElementById("profile-edit-modal")?.removeAttribute("open");
        revalidator.revalidate();
      }
    }
    if (fetcher.data?.intent === "delete-profile") {
      if (fetcher.data.ok) {
        revalidator.revalidate();
      }
    }
    if (fetcher.data?.intent === "sync-orders") {
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator]);

  // ─── Auto-fetch stats on mount if data exists ───────────────────────
  const hasData = syncTotalAffiliateOrders != null && syncTotalAffiliateOrders > 0;
  const initialFetchDone = useRef(false);

  useEffect(() => {
    if (hasData && !initialFetchDone.current && syncStatus !== "running") {
      initialFetchDone.current = true;
      fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, syncStatus]);

  // Re-fetch when sync completes
  const prevSyncStatus = useRef(syncStatus);
  useEffect(() => {
    if (prevSyncStatus.current === "running" && syncStatus === "idle") {
      fetchStats();
    }
    prevSyncStatus.current = syncStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus]);

  // ─── Fetch stats helper ─────────────────────────────────────────────
  const fetchStats = () => {
    const dates =
      periodPreset === "custom"
        ? { start: customStart, end: customEnd }
        : getPresetDates(periodPreset);

    if (!dates.start || !dates.end) return;

    const comp = getComparisonDates(comparisonMode, dates.start, dates.end);
    setStatsLoading(true);

    const fd = new FormData();
    fd.append("intent", "fetch-dashboard-stats");
    fd.append("startDate", dates.start);
    fd.append("endDate", dates.end);
    if (comp) {
      fd.append("compStart", comp.compStart);
      fd.append("compEnd", comp.compEnd);
    }
    if (selectedAffiliate !== "all") {
      fd.append("affiliateCode", selectedAffiliate);
    }
    fetcher.submit(fd, { method: "post" });
  };

  // ─── Period preset click ────────────────────────────────────────────
  const handlePresetClick = (preset: PeriodPreset) => {
    setPeriodPreset(preset);
    if (preset !== "custom") {
      setTimeout(fetchStats, 0);
    }
  };

  // Re-fetch when filters change (non-custom)
  useEffect(() => {
    if (hasData && periodPreset !== "custom" && initialFetchDone.current) {
      fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodPreset, comparisonMode, selectedAffiliate]);

  // ─── Sync handler ──────────────────────────────────────────────────
  const handleSync = () => {
    const fd = new FormData();
    fd.append("intent", "sync-orders");
    fetcher.submit(fd, { method: "post" });
  };

  // ─── Row drill-down handlers ────────────────────────────────────────
  const handleRow1Click = (key: string) =>
    setRow1DrillDown((prev) => (prev === key ? null : key));
  const handleRow2Click = (key: string) =>
    setRow2DrillDown((prev) => (prev === key ? null : key));
  const handleRow3Click = (key: string) =>
    setRow3DrillDown((prev) => (prev === key ? null : key));

  // ─── Render delta helper ────────────────────────────────────────────
  const renderDelta = (delta?: number) => {
    if (delta == null) return null;
    return (
      <span className={delta >= 0 ? styles.deltaUp : styles.deltaDown}>
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)}%
      </span>
    );
  };

  // ─── Format helpers bound to locale ─────────────────────────────────
  const cc = dashboardStats?.currencyCode ?? "BRL";
  const fmtCurrency = (v: number) => formatCurrencyCompact(v, cc, userLocale);
  const fmtNum = formatNumberCompact;
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const stats = dashboardStats;
  const isLoading = statsLoading;

  // ─── Presets ────────────────────────────────────────────────────────
  const presets: Array<{ id: PeriodPreset; label: string }> = [
    { id: "last_7d", label: t("period.last7d", "Last 7 days") },
    { id: "last_30d", label: t("period.last30d", "Last 30 days") },
    { id: "last_month", label: t("period.lastMonth", "Last month") },
    { id: "last_3_months", label: t("period.last3Months", "Last 3 months") },
  ];

  // ─── CSV file handler (input + drag+drop) ─────────────────────────
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [csvDragActive, setCsvDragActive] = useState(false);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  const readCsvFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setCsvFileName("");
      return;
    }
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(reader.result as string);
    };
    reader.readAsText(file);
  };

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readCsvFile(file);
  };

  const handleCsvDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!csvDragActive) setCsvDragActive(true);
  };

  const handleCsvDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setCsvDragActive(false);
  };

  const handleCsvDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setCsvDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readCsvFile(file);
  };

  const handleCsvDropZoneClick = () => {
    csvFileInputRef.current?.click();
  };

  const handleCsvImport = () => {
    if (!csvText.trim()) return;
    const fd = new FormData();
    fd.append("intent", "import-bixgrow-csv");
    fd.append("csvText", csvText);
    fetcher.submit(fd, { method: "post" });
  };

  // ─── Profile edit handlers ─────────────────────────────────────────
  const openEditProfile = (p: AffiliateProfile) => {
    setEditingProfile(p);
    setEditCommission(String(p.commissionPct));
    setEditTier(p.tier);
    setEditStatus(p.status);
    setEditNotes(p.notes ?? "");
    const modal = document.getElementById("profile-edit-modal");
    modal?.setAttribute("open", "");
  };

  const handleProfileSave = () => {
    if (!editingProfile) return;
    const fd = new FormData();
    fd.append("intent", "update-profile");
    fd.append("code", editingProfile.code);
    fd.append("affiliateName", editingProfile.affiliateName);
    fd.append("commissionPct", editCommission);
    fd.append("tier", editTier);
    fd.append("status", editStatus);
    fd.append("notes", editNotes);
    fetcher.submit(fd, { method: "post" });
  };

  const handleProfileDelete = (profileId: string) => {
    const fd = new FormData();
    fd.append("intent", "delete-profile");
    fd.append("profileId", profileId);
    fetcher.submit(fd, { method: "post" });
  };

  // ─── Custom date handlers ──────────────────────────────────────────
  const handleApplyCustomRange = () => {
    if (customStart && customEnd) {
      setPeriodPreset("custom");
      document.getElementById("custom-date-popover")?.removeAttribute("open");
      setTimeout(fetchStats, 0);
    }
  };

  // ─── Trend chart max value ──────────────────────────────────────────
  const trendMax = useMemo(() => {
    if (!stats?.trend?.length) return 1;
    return Math.max(
      ...stats.trend.map(
        (t) => Math.max(t.affiliateRevenue, t.organicRevenue),
      ),
      1,
    );
  }, [stats?.trend]);

  // ─── Leaderboard drill-down rendering ──────────────────────────────
  const renderLeaderboardTable = () => {
    if (!stats?.leaderboard?.length) return <p className={styles.noData}>No data</p>;
    return (
      <div className={styles.tableWrap}>
        <table className={styles.leaderboardTable}>
          <thead>
            <tr>
              <th>#</th>
              <th>{t("card.affiliate", "Affiliate")}</th>
              <th>{t("card.revenue", "Revenue")}</th>
              <th>{t("card.orders", "Orders")}</th>
              <th>{t("card.commission", "Commission")}</th>
              <th>{t("card.customers", "Customers")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.leaderboard.map((row, i) => (
              <tr key={row.code}>
                <td>{i + 1}</td>
                <td>
                  {row.affiliateName}
                  {(row.instagram || row.tiktok) && (
                    <span className={styles.affiliateHandle}>
                      {row.instagram
                        ? `@${row.instagram}`
                        : row.tiktok
                          ? `@${row.tiktok}`
                          : ""}
                    </span>
                  )}
                </td>
                <td>{fmtCurrency(row.revenue)}</td>
                <td>{fmtNum(row.orders)}</td>
                <td>{fmtCurrency(row.commission)}</td>
                <td>{fmtNum(row.customers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ─── Trend chart rendering ─────────────────────────────────────────
  const renderTrendChart = () => {
    if (!stats?.trend?.length) return <p className={styles.noData}>No data</p>;
    return (
      <>
        <div className={styles.trendChart}>
          {stats.trend.map((t) => {
            const affH = trendMax > 0 ? (t.affiliateRevenue / trendMax) * 100 : 0;
            const orgH = trendMax > 0 ? (t.organicRevenue / trendMax) * 100 : 0;
            return (
              <div key={t.month} className={styles.trendBar}>
                <div
                  className={styles.trendBarFill}
                  style={{
                    height: `${affH}%`,
                    background: "linear-gradient(180deg, #5ecece, #88c5d6)",
                  }}
                  title={`Affiliate: ${fmtCurrency(t.affiliateRevenue)}`}
                />
                <div
                  className={styles.trendBarFill}
                  style={{
                    height: `${orgH}%`,
                    background: "linear-gradient(180deg, #c48fd0, #d4a8d4)",
                  }}
                  title={`Organic: ${fmtCurrency(t.organicRevenue)}`}
                />
                <span className={styles.trendBarLabel}>{t.month.slice(5)}</span>
              </div>
            );
          })}
        </div>
        <div className={styles.chartLegend}>
          <span>
            <span
              className={styles.legendDot}
              style={{ background: "#5ecece" }}
            />
            {t("legend.affiliate", "Affiliate")}
          </span>
          <span>
            <span
              className={styles.legendDot}
              style={{ background: "#c48fd0" }}
            />
            {t("legend.organic", "Organic")}
          </span>
        </div>
      </>
    );
  };

  // ─── Waterfall rendering ───────────────────────────────────────────
  const renderMarginWaterfall = () => {
    if (!stats?.marginAnalysis) return null;
    const m = stats.marginAnalysis;
    const maxVal = Math.max(
      m.affiliateDiscountTotal,
      m.siteDiscountTotal,
      m.commissionTotal,
      1,
    );
    const bar = (label: string, value: number, color: string) => (
      <div className={styles.waterfallBar} key={label}>
        <span className={styles.waterfallBarLabel}>{label}</span>
        <div
          className={styles.waterfallBarFill}
          style={{
            width: `${Math.max((value / maxVal) * 100, 2)}%`,
            background: color,
            minWidth: "4px",
          }}
        />
        <span className={styles.waterfallBarValue}>{fmtCurrency(value)}</span>
      </div>
    );
    return (
      <div className={styles.waterfallContainer}>
        <div className={styles.waterfallColumn}>
          <div className={styles.waterfallTitle}>
            {t("drill.costBreakdown", "Cost Breakdown")}
          </div>
          {bar(t("drill.affiliateDiscount", "Affiliate discounts"), m.affiliateDiscountTotal, "#5ecece")}
          {bar(t("drill.siteDiscount", "Site discounts"), m.siteDiscountTotal, "#c48fd0")}
          {bar(t("drill.commission", "Commission"), m.commissionTotal, "#f0b775")}
        </div>
        <div className={styles.waterfallColumn}>
          <div className={styles.waterfallTitle}>
            {t("drill.marginComparison", "Margin Comparison")}
          </div>
          {bar(t("drill.affiliateMargin", "Affiliate margin"), m.affiliateMarginPct, "#5ecece")}
          {bar(t("drill.organicMargin", "Organic margin"), m.organicMarginPct, "#c48fd0")}
        </div>
      </div>
    );
  };

  // ─── Product mix table ─────────────────────────────────────────────
  const renderProductMix = () => {
    if (!stats?.productMix?.length) return <p className={styles.noData}>No data</p>;
    return (
      <div className={styles.tableWrap}>
        <table className={styles.leaderboardTable}>
          <thead>
            <tr>
              <th>{t("card.product", "Product")}</th>
              <th>{t("card.quantity", "Qty")}</th>
              <th>{t("card.revenue", "Revenue")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.productMix.map((p, i) => (
              <tr key={`${p.productId ?? i}`}>
                <td>{p.title}</td>
                <td>{fmtNum(p.quantity)}</td>
                <td>{fmtCurrency(p.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ─── KPI Card component ────────────────────────────────────────────
  const KpiCard = ({
    primary,
    label,
    secondary,
    delta,
    drillKey,
    activeDrill,
    onClick,
  }: {
    primary: string;
    label: string;
    secondary: string;
    delta?: number;
    drillKey: string;
    activeDrill: DrillDownKey;
    onClick: (key: string) => void;
  }) => {
    const isActive = activeDrill === drillKey;
    const boxClass = [
      styles.overviewBox,
      styles.overviewBoxClickable,
      isActive ? styles.overviewBoxActive : "",
      isLoading ? styles.overviewBoxLoading : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        className={boxClass}
        role="button"
        tabIndex={0}
        onClick={() => onClick(drillKey)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClick(drillKey);
        }}
      >
        {isLoading && (
          <div className={styles.overviewSpinner}>
            <s-spinner size="base" />
          </div>
        )}
        <span className={styles.overviewPrimary}>
          {primary}
          {renderDelta(delta)}
        </span>
        <span className={styles.overviewLabel}>{label}</span>
        <span className={styles.overviewSecondary}>{secondary}</span>
      </div>
    );
  };

  // ─── JSX ────────────────────────────────────────────────────────────
  return (
    <s-page heading={t("page.title", "Affiliates")}>
      <div slot="primary-action">
        {syncStatus === "running" ? (
          <s-button variant="primary" disabled key="sync-disabled">
            {t("sync.running", "Syncing...")}
          </s-button>
        ) : (
          <s-button variant="primary" onClick={handleSync} key="sync-active">
            {t("page.syncButton", "Sync Orders")}
          </s-button>
        )}
      </div>
      <div slot="secondary-actions">
        <s-button
          variant="secondary"
          commandFor="csv-import-modal"
          command="--show"
        >
          {t("page.importButton", "Import BixGrow CSV")}
        </s-button>
      </div>

      <s-section>
        {/* ── Sync progress ─────────────────────────────────────── */}
        {syncStatus === "running" && (
          <div>
            <div className={styles.syncProgressRow}>
              <span className={styles.syncProgressPhaseLabel}>
                {syncPhase ?? t("sync.running", "Syncing orders...")}
              </span>
              {syncProgressCount != null && (
                <span className={styles.syncProgressPct}>
                  {fmtNum(syncProgressCount)} {t("sync.processed", "processed")}
                </span>
              )}
            </div>
            <div className={styles.syncProgressBarBg}>
              <div
                className={styles.syncProgressBarFill}
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}

        {/* ── Error / Warning banners ──────────────────────────── */}
        {syncError && (
          <s-banner tone="critical">
            {syncError}
          </s-banner>
        )}
        {syncWarning && (
          <s-banner tone="warning">
            {t("sync.warning", "Previous sync had issues")}: {syncWarning}
          </s-banner>
        )}
        {statsError && (
          <s-banner tone="critical">
            {statsError}
          </s-banner>
        )}

        {/* ── Sync summary ─────────────────────────────────────── */}
        {syncLastSyncedAt && syncStatus !== "running" && (
          <div className={styles.syncProgressMeta}>
            <span>
              {t("sync.lastSynced", "Last synced")}:{" "}
              {new Date(syncLastSyncedAt).toLocaleString(userLocale)}
            </span>
            <span>
              {syncTotalOrders != null && (
                <>
                  {fmtNum(syncTotalOrders)} {t("sync.totalOrders", "orders")}
                  {" / "}
                  {fmtNum(syncTotalAffiliateOrders ?? 0)}{" "}
                  {t("sync.affiliateOrders", "affiliate")}
                </>
              )}
            </span>
          </div>
        )}

        {/* ── Period bar ───────────────────────────────────────── */}
        {hasData && (
          <div className={styles.periodBar}>
            {presets.map((p) => (
              <s-button
                key={p.id}
                variant={periodPreset === p.id ? "primary" : "secondary"}
                onClick={() => handlePresetClick(p.id)}
              >
                {p.label}
              </s-button>
            ))}
            <s-button
              variant={periodPreset === "custom" ? "primary" : "secondary"}
              commandFor="custom-date-popover"
              command="--toggle"
            >
              {t("period.custom", "Custom")}
            </s-button>
            <s-popover id="custom-date-popover">
              <div className={styles.customDatePopover}>
                <span className={styles.customDateLabel}>
                  {t("period.startDate", "Start date")}
                </span>
                <s-date-picker
                  type="single"
                  value={customStart}
                  onChange={(event: Event) =>
                    setCustomStart(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
                <span className={styles.customDateLabel}>
                  {t("period.endDate", "End date")}
                </span>
                <s-date-picker
                  type="single"
                  value={customEnd}
                  onChange={(event: Event) =>
                    setCustomEnd(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
                <div className={styles.customDateActions}>
                  <s-button
                    variant="primary"
                    onClick={handleApplyCustomRange}
                  >
                    {t("period.apply", "Apply")}
                  </s-button>
                </div>
              </div>
            </s-popover>

            <div className={styles.periodSeparator} />

            <s-select
              value={comparisonMode}
              onChange={(event: Event) =>
                setComparisonMode(
                  (event.currentTarget as HTMLSelectElement)
                    .value as ComparisonMode,
                )
              }
            >
              <s-option value="none">
                {t("comparison.none", "No comparison")}
              </s-option>
              <s-option value="prev_period">
                {t("comparison.prevPeriod", "Previous period")}
              </s-option>
              <s-option value="prev_year">
                {t("comparison.prevYear", "Previous year")}
              </s-option>
            </s-select>

            <s-select
              value={selectedAffiliate}
              onChange={(event: Event) =>
                setSelectedAffiliate(
                  (event.currentTarget as HTMLSelectElement).value,
                )
              }
            >
              <s-option value="all">
                {t("filter.allAffiliates", "All affiliates")}
              </s-option>
              {profiles.map((p) => (
                <s-option key={p.code} value={p.code}>
                  {p.affiliateName}
                </s-option>
              ))}
            </s-select>
          </div>
        )}

        {/* ── Row 1: Acquisition & Economics ───────────────────── */}
        {hasData && (
          <>
            <div
              className={`${styles.overviewRowLabel} ${styles.overviewRowLabelFirst}`}
            >
              {t("row1.title", "Acquisition & Economics")}
            </div>
            <div className={styles.overviewGrid}>
              <KpiCard
                primary={
                  stats?.revenueImpact
                    ? fmtCurrency(stats.revenueImpact.affiliateRevenue)
                    : "--"
                }
                label={t("card.affiliateRevenue", "Affiliate revenue")}
                secondary={
                  stats?.revenueImpact
                    ? `${t("card.organic", "Organic")}: ${fmtCurrency(stats.revenueImpact.organicRevenue)} | ${t("card.share", "Share")}: ${fmtPct(stats.revenueImpact.affiliateSharePct)}`
                    : ""
                }
                delta={stats?.revenueImpact?.delta}
                drillKey="revenue"
                activeDrill={row1DrillDown}
                onClick={handleRow1Click}
              />
              <KpiCard
                primary={
                  stats?.marginAnalysis
                    ? `${fmtPct(stats.marginAnalysis.affiliateMarginPct)}`
                    : "--"
                }
                label={t("card.affiliateMargin", "Affiliate margin")}
                secondary={
                  stats?.marginAnalysis
                    ? `${t("card.organic", "Organic")}: ${fmtPct(stats.marginAnalysis.organicMarginPct)}`
                    : ""
                }
                delta={stats?.marginAnalysis?.delta}
                drillKey="margin"
                activeDrill={row1DrillDown}
                onClick={handleRow1Click}
              />
              <KpiCard
                primary={
                  stats?.cac
                    ? fmtCurrency(stats.cac.affiliateCAC)
                    : "--"
                }
                label={t("card.cac", "Customer acquisition cost")}
                secondary={
                  stats?.cac
                    ? `${t("card.totalSpent", "Total spent")}: ${fmtCurrency(stats.cac.totalSpent)} | ${t("card.newCustomers", "New")}: ${fmtNum(stats.cac.newCustomersViaAffiliates)}`
                    : ""
                }
                delta={stats?.cac?.delta}
                drillKey="cac"
                activeDrill={row1DrillDown}
                onClick={handleRow1Click}
              />
            </div>

            {/* Row 1 drill-downs */}
            {row1DrillDown === "revenue" && (
              <div className={styles.drillDown}>
                <h3 className={styles.waterfallTitle}>
                  {t("drill.revenueLeaderboard", "Revenue Leaderboard")}
                </h3>
                {renderLeaderboardTable()}
                <h3
                  className={`${styles.waterfallTitle} ${styles.drillSectionHeading}`}
                >
                  {t("drill.revenueTrend", "Monthly Trend")}
                </h3>
                {renderTrendChart()}
              </div>
            )}
            {row1DrillDown === "margin" && (
              <div className={styles.drillDown}>
                {renderMarginWaterfall()}
              </div>
            )}
            {row1DrillDown === "cac" && (
              <div className={styles.drillDown}>
                <h3 className={styles.waterfallTitle}>
                  {t("drill.cacByAffiliate", "CAC by Affiliate")}
                </h3>
                {stats?.leaderboard?.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.leaderboardTable}>
                      <thead>
                        <tr>
                          <th>{t("card.affiliate", "Affiliate")}</th>
                          <th>{t("card.commission", "Commission")}</th>
                          <th>{t("card.customers", "New customers")}</th>
                          <th>{t("card.cac", "CAC")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.leaderboard.map((row) => {
                          const cacVal =
                            row.customers > 0
                              ? row.commission / row.customers
                              : 0;
                          return (
                            <tr key={row.code}>
                              <td>{row.affiliateName}</td>
                              <td>{fmtCurrency(row.commission)}</td>
                              <td>{fmtNum(row.customers)}</td>
                              <td>{fmtCurrency(cacVal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.noData}>No data</p>
                )}
              </div>
            )}

            {/* ── Row 2: Customer Quality ──────────────────────── */}
            <div className={styles.overviewRowLabel}>
              {t("row2.title", "Customer Quality")}
            </div>
            <div className={styles.overviewGrid}>
              <KpiCard
                primary={
                  stats?.ltv
                    ? fmtCurrency(stats.ltv.affiliateLTV)
                    : "--"
                }
                label={t("card.ltv", "Affiliate LTV")}
                secondary={
                  stats?.ltv
                    ? `${t("card.organic", "Organic")}: ${fmtCurrency(stats.ltv.organicLTV)} | ${t("card.affCustomers", "Customers")}: ${fmtNum(stats.ltv.affiliateCustomers)}`
                    : ""
                }
                delta={stats?.ltv?.delta}
                drillKey="ltv"
                activeDrill={row2DrillDown}
                onClick={handleRow2Click}
              />
              <KpiCard
                primary={
                  stats?.repeatRate
                    ? fmtPct(stats.repeatRate.affiliateRepeatPct)
                    : "--"
                }
                label={t("card.repeatRate", "Repeat rate")}
                secondary={
                  stats?.repeatRate
                    ? `${t("card.organic", "Organic")}: ${fmtPct(stats.repeatRate.organicRepeatPct)} | ${fmtNum(stats.repeatRate.affiliateRepeat)}/${fmtNum(stats.repeatRate.affiliateTotal)}`
                    : ""
                }
                delta={stats?.repeatRate?.delta}
                drillKey="repeat"
                activeDrill={row2DrillDown}
                onClick={handleRow2Click}
              />
              <KpiCard
                primary={
                  stats?.aov
                    ? fmtCurrency(stats.aov.affiliateAOV)
                    : "--"
                }
                label={t("card.aov", "Average order value")}
                secondary={
                  stats?.aov
                    ? `${t("card.organic", "Organic")}: ${fmtCurrency(stats.aov.organicAOV)}`
                    : ""
                }
                delta={stats?.aov?.delta}
                drillKey="aov"
                activeDrill={row2DrillDown}
                onClick={handleRow2Click}
              />
            </div>

            {/* Row 2 drill-downs */}
            {row2DrillDown === "ltv" && (
              <div className={styles.drillDown}>
                <div className={styles.waterfallContainer}>
                  <div className={styles.waterfallColumn}>
                    <div className={styles.waterfallTitle}>
                      {t("drill.ltvComparison", "LTV Comparison")}
                    </div>
                    <div className={styles.waterfallBar}>
                      <span className={styles.waterfallBarLabel}>
                        {t("card.affiliate", "Affiliate")}
                      </span>
                      <div
                        className={styles.waterfallBarFill}
                        style={{
                          width: `${Math.max(
                            stats?.ltv
                              ? (stats.ltv.affiliateLTV /
                                  Math.max(
                                    stats.ltv.affiliateLTV,
                                    stats.ltv.organicLTV,
                                    1,
                                  )) *
                                100
                              : 0,
                            2,
                          )}%`,
                          background: "#5ecece",
                        }}
                      />
                      <span className={styles.waterfallBarValue}>
                        {stats?.ltv ? fmtCurrency(stats.ltv.affiliateLTV) : "--"}
                      </span>
                    </div>
                    <div className={styles.waterfallBar}>
                      <span className={styles.waterfallBarLabel}>
                        {t("card.organic", "Organic")}
                      </span>
                      <div
                        className={styles.waterfallBarFill}
                        style={{
                          width: `${Math.max(
                            stats?.ltv
                              ? (stats.ltv.organicLTV /
                                  Math.max(
                                    stats.ltv.affiliateLTV,
                                    stats.ltv.organicLTV,
                                    1,
                                  )) *
                                100
                              : 0,
                            2,
                          )}%`,
                          background: "#c48fd0",
                        }}
                      />
                      <span className={styles.waterfallBarValue}>
                        {stats?.ltv ? fmtCurrency(stats.ltv.organicLTV) : "--"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {row2DrillDown === "repeat" && (
              <div className={styles.drillDown}>
                <div className={styles.waterfallContainer}>
                  <div className={styles.waterfallColumn}>
                    <div className={styles.waterfallTitle}>
                      {t("drill.repeatComparison", "Repeat Rate Comparison")}
                    </div>
                    <div className={styles.waterfallBar}>
                      <span className={styles.waterfallBarLabel}>
                        {t("card.affiliate", "Affiliate")}
                      </span>
                      <div
                        className={styles.waterfallBarFill}
                        style={{
                          width: `${Math.max(stats?.repeatRate?.affiliateRepeatPct ?? 0, 2)}%`,
                          background: "#5ecece",
                        }}
                      />
                      <span className={styles.waterfallBarValue}>
                        {stats?.repeatRate ? fmtPct(stats.repeatRate.affiliateRepeatPct) : "--"}
                      </span>
                    </div>
                    <div className={styles.waterfallBar}>
                      <span className={styles.waterfallBarLabel}>
                        {t("card.organic", "Organic")}
                      </span>
                      <div
                        className={styles.waterfallBarFill}
                        style={{
                          width: `${Math.max(stats?.repeatRate?.organicRepeatPct ?? 0, 2)}%`,
                          background: "#c48fd0",
                        }}
                      />
                      <span className={styles.waterfallBarValue}>
                        {stats?.repeatRate ? fmtPct(stats.repeatRate.organicRepeatPct) : "--"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {row2DrillDown === "aov" && (
              <div className={styles.drillDown}>
                <div className={styles.waterfallContainer}>
                  <div className={styles.waterfallColumn}>
                    <div className={styles.waterfallTitle}>
                      {t("drill.aovComparison", "AOV Comparison")}
                    </div>
                    <div className={styles.waterfallBar}>
                      <span className={styles.waterfallBarLabel}>
                        {t("card.affiliate", "Affiliate")}
                      </span>
                      <div
                        className={styles.waterfallBarFill}
                        style={{
                          width: `${Math.max(
                            stats?.aov
                              ? (stats.aov.affiliateAOV /
                                  Math.max(
                                    stats.aov.affiliateAOV,
                                    stats.aov.organicAOV,
                                    1,
                                  )) *
                                100
                              : 0,
                            2,
                          )}%`,
                          background: "#5ecece",
                        }}
                      />
                      <span className={styles.waterfallBarValue}>
                        {stats?.aov ? fmtCurrency(stats.aov.affiliateAOV) : "--"}
                      </span>
                    </div>
                    <div className={styles.waterfallBar}>
                      <span className={styles.waterfallBarLabel}>
                        {t("card.organic", "Organic")}
                      </span>
                      <div
                        className={styles.waterfallBarFill}
                        style={{
                          width: `${Math.max(
                            stats?.aov
                              ? (stats.aov.organicAOV /
                                  Math.max(
                                    stats.aov.affiliateAOV,
                                    stats.aov.organicAOV,
                                    1,
                                  )) *
                                100
                              : 0,
                            2,
                          )}%`,
                          background: "#c48fd0",
                        }}
                      />
                      <span className={styles.waterfallBarValue}>
                        {stats?.aov ? fmtCurrency(stats.aov.organicAOV) : "--"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Row 3: Program Performance ───────────────────── */}
            <div className={styles.overviewRowLabel}>
              {t("row3.title", "Program Performance")}
            </div>
            <div className={styles.overviewGrid}>
              <KpiCard
                primary={
                  stats?.leaderboard?.length
                    ? `${stats.leaderboard.length} ${t("card.affiliatesActive", "affiliates")}`
                    : "--"
                }
                label={t("card.leaderboard", "Leaderboard")}
                secondary={
                  stats?.leaderboard?.length
                    ? `${t("card.topAffiliate", "Top")}: ${stats.leaderboard[0]?.affiliateName ?? "--"}`
                    : ""
                }
                drillKey="leaderboard"
                activeDrill={row3DrillDown}
                onClick={handleRow3Click}
              />
              <KpiCard
                primary={
                  stats?.productMix?.length
                    ? `${stats.productMix.length} ${t("card.products", "products")}`
                    : "--"
                }
                label={t("card.productMix", "Product mix")}
                secondary={
                  stats?.productMix?.length
                    ? `${t("card.topProduct", "Top")}: ${stats.productMix[0]?.title ?? "--"}`
                    : ""
                }
                drillKey="products"
                activeDrill={row3DrillDown}
                onClick={handleRow3Click}
              />
              <KpiCard
                primary={
                  stats?.roas
                    ? `${stats.roas.affiliateROAS.toFixed(2)}x`
                    : "--"
                }
                label={t("card.roas", "ROAS")}
                secondary={
                  stats?.roas
                    ? `${t("card.revenue", "Revenue")}: ${fmtCurrency(stats.roas.totalRevenue)} / ${t("card.cost", "Cost")}: ${fmtCurrency(stats.roas.totalCost)}`
                    : ""
                }
                delta={stats?.roas?.delta}
                drillKey="roas"
                activeDrill={row3DrillDown}
                onClick={handleRow3Click}
              />
            </div>

            {/* Row 3 drill-downs */}
            {row3DrillDown === "leaderboard" && (
              <div className={styles.drillDown}>
                {renderLeaderboardTable()}
              </div>
            )}
            {row3DrillDown === "products" && (
              <div className={styles.drillDown}>
                {renderProductMix()}
              </div>
            )}
            {row3DrillDown === "roas" && (
              <div className={styles.drillDown}>
                <h3 className={styles.waterfallTitle}>
                  {t("drill.roasBreakdown", "ROAS Breakdown")}
                </h3>
                {stats?.roas ? (
                  <div className={styles.waterfallContainer}>
                    <div className={styles.waterfallColumn}>
                      <div className={styles.waterfallBar}>
                        <span className={styles.waterfallBarLabel}>
                          {t("card.revenue", "Revenue")}
                        </span>
                        <div
                          className={styles.waterfallBarFill}
                          style={{
                            width: `${Math.max(
                              (stats.roas.totalRevenue /
                                Math.max(
                                  stats.roas.totalRevenue,
                                  stats.roas.totalCost,
                                  1,
                                )) *
                                100,
                              2,
                            )}%`,
                            background: "#5ecece",
                          }}
                        />
                        <span className={styles.waterfallBarValue}>
                          {fmtCurrency(stats.roas.totalRevenue)}
                        </span>
                      </div>
                      <div className={styles.waterfallBar}>
                        <span className={styles.waterfallBarLabel}>
                          {t("card.cost", "Cost")}
                        </span>
                        <div
                          className={styles.waterfallBarFill}
                          style={{
                            width: `${Math.max(
                              (stats.roas.totalCost /
                                Math.max(
                                  stats.roas.totalRevenue,
                                  stats.roas.totalCost,
                                  1,
                                )) *
                                100,
                              2,
                            )}%`,
                            background: "#d72c0d",
                          }}
                        />
                        <span className={styles.waterfallBarValue}>
                          {fmtCurrency(stats.roas.totalCost)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className={styles.noData}>No data</p>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Empty state: stepped onboarding ──────────────────── */}
        {!hasData && syncStatus !== "running" && (
          <div className={styles.onboarding}>
            <div className={styles.onboardingHeader}>
              <h2 className={styles.onboardingTitle}>
                {profiles.length === 0
                  ? t("empty.title", "No affiliate data yet")
                  : t("empty.titleReady", "Ready to sync")}
              </h2>
              <p className={styles.onboardingSubtitle}>
                {profiles.length === 0
                  ? t(
                      "empty.subtitle",
                      "Get started in 2 steps to see your affiliate analytics.",
                    )
                  : t("empty.subtitleReady", {
                      count: profiles.length,
                      defaultValue:
                        "{{count}} affiliates imported. Now sync your Shopify orders.",
                    })}
              </p>
            </div>

            <div className={styles.onboardingGrid}>
              {/* Step 1 — Import */}
              <div className={styles.onboardingStep}>
                <div
                  className={
                    profiles.length > 0
                      ? `${styles.onboardingStepNumber} ${styles.onboardingStepDone}`
                      : styles.onboardingStepNumber
                  }
                >
                  {profiles.length > 0 ? "✓" : "1"}
                </div>
                <div className={styles.onboardingStepTitle}>
                  {profiles.length > 0
                    ? t("empty.step1Done", "Affiliates imported")
                    : t("empty.step1Title", "Import affiliates")}
                </div>
                <div className={styles.onboardingStepBody}>
                  {profiles.length > 0
                    ? t("empty.step1BodyDone", {
                        count: profiles.length,
                        defaultValue: "{{count}} profiles",
                      })
                    : t(
                        "empty.step1Body",
                        "Upload your BixGrow CSV export to populate affiliate profiles.",
                      )}
                </div>
                <div className={styles.onboardingStepAction}>
                  <s-button
                    variant={profiles.length > 0 ? "secondary" : "primary"}
                    commandFor="csv-import-modal"
                    command="--show"
                  >
                    {profiles.length > 0
                      ? t("empty.step1ActionDone", "Re-import CSV")
                      : t("empty.step1Action", "Import BixGrow CSV")}
                  </s-button>
                </div>
              </div>

              {/* Step 2 — Sync */}
              <div
                className={
                  profiles.length === 0
                    ? `${styles.onboardingStep} ${styles.onboardingStepDisabled}`
                    : styles.onboardingStep
                }
              >
                <div className={styles.onboardingStepNumber}>2</div>
                <div className={styles.onboardingStepTitle}>
                  {t("empty.step2Title", "Sync orders")}
                </div>
                <div className={styles.onboardingStepBody}>
                  {profiles.length === 0
                    ? t(
                        "empty.step2BodyDisabled",
                        "Import affiliates first, then pull Shopify orders to match them.",
                      )
                    : t(
                        "empty.step2Body",
                        "Pull Shopify orders and match them to your affiliate codes.",
                      )}
                </div>
                <div className={styles.onboardingStepAction}>
                  {profiles.length === 0 ? (
                    <s-button
                      variant="primary"
                      disabled
                      key="sync-empty-disabled"
                    >
                      {t("empty.step2Action", "Sync Orders")}
                    </s-button>
                  ) : (
                    <s-button
                      variant="primary"
                      onClick={handleSync}
                      key="sync-empty-active"
                    >
                      {t("empty.step2Action", "Sync Orders")}
                    </s-button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Affiliate profiles table ─────────────────────────── */}
        {profiles.length > 0 && (
          <>
            <div
              className={`${styles.overviewRowLabel} ${styles.profilesHeading}`}
            >
              {t("profiles.title", "Affiliate Profiles")} ({profiles.length})
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.leaderboardTable}>
                <thead>
                  <tr>
                    <th>{t("profile.code", "Code")}</th>
                    <th>{t("profile.name", "Name")}</th>
                    <th>{t("profile.commission", "Commission")}</th>
                    <th>{t("profile.tier", "Tier")}</th>
                    <th>{t("profile.status", "Status")}</th>
                    <th>{t("profile.actions", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id}>
                      <td>{p.code}</td>
                      <td>
                        {p.affiliateName}
                        {p.instagram && (
                          <span className={styles.affiliateHandle}>
                            @{p.instagram}
                          </span>
                        )}
                      </td>
                      <td>{p.commissionPct}%</td>
                      <td>
                        <s-badge>{p.tier}</s-badge>
                      </td>
                      <td>
                        <s-badge
                          tone={
                            p.status === "active"
                              ? "success"
                              : p.status === "paused"
                                ? "warning"
                                : "critical"
                          }
                        >
                          {p.status}
                        </s-badge>
                      </td>
                      <td>
                        <s-button
                          variant="secondary"
                          onClick={() => openEditProfile(p)}
                        >
                          {t("profile.edit", "Edit")}
                        </s-button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </s-section>

      {/* ── CSV Import Modal ───────────────────────────────────── */}
      <s-modal id="csv-import-modal" heading={t("import.title", "Import BixGrow Affiliates")}>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-text>
              {t(
                "import.description",
                "Upload your BixGrow affiliate export CSV. Affiliates will be matched by their coupon code.",
              )}
            </s-text>

            {/* Hidden file input — triggered by the drop zone or button */}
            <input
              ref={csvFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleCsvFileChange}
              className={styles.hiddenFileInput}
            />

            {/* Polaris-styled drop zone */}
            <div
              className={`${styles.dropZone}${csvDragActive ? ` ${styles.dropZoneActive}` : ""}${csvFileName ? ` ${styles.dropZoneFilled}` : ""}`}
              onClick={handleCsvDropZoneClick}
              onDragOver={handleCsvDragOver}
              onDragEnter={handleCsvDragOver}
              onDragLeave={handleCsvDragLeave}
              onDrop={handleCsvDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleCsvDropZoneClick();
              }}
            >
              <s-box padding="base">
                <s-stack direction="block" gap="base">
                  {csvFileName ? (
                    <>
                      <s-text type="strong">{csvFileName}</s-text>
                      <s-text color="subdued">
                        {t("import.dropZoneReplace", "Click or drop another file to replace")}
                      </s-text>
                    </>
                  ) : (
                    <>
                      <s-text type="strong">
                        {csvDragActive
                          ? t("import.dropZoneActive", "Drop CSV here")
                          : t("import.dropZoneIdle", "Drag and drop your CSV here")}
                      </s-text>
                      <s-text color="subdued">
                        {t("import.dropZoneOr", "or click to browse")}
                      </s-text>
                    </>
                  )}
                </s-stack>
              </s-box>
            </div>

            {importResult && (
              <s-banner
                tone={
                  importResult.errors.length > 0 ? "critical" : "success"
                }
              >
                {importResult.errors.length > 0
                  ? importResult.errors.join(", ")
                  : t("import.success", "Imported {{count}} affiliates, skipped {{skipped}}", {
                      count: importResult.imported,
                      skipped: importResult.skipped,
                    })}
              </s-banner>
            )}
            <div className={styles.modalActions}>
              <s-button
                variant="primary"
                onClick={handleCsvImport}
                disabled={!csvText.trim() || undefined}
              >
                {t("import.button", "Import")}
              </s-button>
            </div>
          </s-stack>
        </s-box>
      </s-modal>

      {/* ── Profile Edit Modal ─────────────────────────────────── */}
      <s-modal
        id="profile-edit-modal"
        heading={t("profile.editTitle", "Edit Affiliate")}
      >
        {editingProfile && (
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              <s-text type="strong">{editingProfile.affiliateName}</s-text>
              <s-text>{editingProfile.code}</s-text>

              <s-text-field
                label={t("profile.commission", "Commission %")}
                {...{ type: "number" } as Record<string, string>}
                value={editCommission}
                onChange={(event: Event) =>
                  setEditCommission(
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
              />

              <s-select
                label={t("profile.tier", "Tier")}
                value={editTier}
                onChange={(event: Event) =>
                  setEditTier(
                    (event.currentTarget as HTMLSelectElement).value,
                  )
                }
              >
                <s-option value="baseline">Baseline</s-option>
                <s-option value="silver">Silver</s-option>
                <s-option value="gold">Gold</s-option>
                <s-option value="platinum">Platinum</s-option>
              </s-select>

              <s-select
                label={t("profile.status", "Status")}
                value={editStatus}
                onChange={(event: Event) =>
                  setEditStatus(
                    (event.currentTarget as HTMLSelectElement).value,
                  )
                }
              >
                <s-option value="active">Active</s-option>
                <s-option value="paused">Paused</s-option>
                <s-option value="archived">Archived</s-option>
              </s-select>

              <s-text-field
                label={t("profile.notes", "Notes")}
                value={editNotes}
                onChange={(event: Event) =>
                  setEditNotes(
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
                {...{ multiline: true } as Record<string, unknown>}
              />

              <div className={styles.modalActionsSpread}>
                <s-button
                  variant="secondary"
                  tone="critical"
                  onClick={() => {
                    if (editingProfile) {
                      setDeleteConfirmProfileId(editingProfile.id);
                      document.getElementById("delete-confirm-modal")?.setAttribute("open", "");
                    }
                  }}
                >
                  {t("profile.delete", "Delete")}
                </s-button>
                <div className={styles.modalActionsRight}>
                  <s-button
                    variant="secondary"
                    onClick={() => {
                      document
                        .getElementById("profile-edit-modal")
                        ?.removeAttribute("open");
                    }}
                  >
                    {t("common:button.cancel", "Cancel")}
                  </s-button>
                  <s-button variant="primary" onClick={handleProfileSave}>
                    {t("common:button.save", "Save")}
                  </s-button>
                </div>
              </div>
            </s-stack>
          </s-box>
        )}
      </s-modal>
      {/* ── Delete Confirmation Modal ──────────────────────────── */}
      <s-modal
        id="delete-confirm-modal"
        heading={t("profile.deleteConfirmTitle", "Delete Affiliate")}
      >
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-text>
              {t(
                "profile.deleteConfirmMessage",
                "Are you sure you want to delete this affiliate profile? This action cannot be undone.",
              )}
            </s-text>
            <div className={styles.modalActions}>
              <s-button
                variant="secondary"
                onClick={() => {
                  setDeleteConfirmProfileId(null);
                  document.getElementById("delete-confirm-modal")?.removeAttribute("open");
                }}
              >
                {t("common:button.cancel", "Cancel")}
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                onClick={() => {
                  if (deleteConfirmProfileId) {
                    handleProfileDelete(deleteConfirmProfileId);
                  }
                  setDeleteConfirmProfileId(null);
                  document.getElementById("delete-confirm-modal")?.removeAttribute("open");
                  document.getElementById("profile-edit-modal")?.removeAttribute("open");
                }}
              >
                {t("profile.delete", "Delete")}
              </s-button>
            </div>
          </s-stack>
        </s-box>
      </s-modal>
    </s-page>
  );
}
