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
import prisma from "../db.server";
import { normalizeLocale } from "../i18n/config";
import { formatCurrencyCompact, formatNumberCompact } from "../i18n/format";
import styles from "./app.affiliates/styles.module.css";
import {
  readAffiliateProfiles,
  readAffiliateSyncMeta,
  importBixGrowCsv,
} from "../affiliates/storage.server";
import type { AffiliateProfile } from "../affiliates/storage.server";
import { backfillAffiliateOrders } from "../affiliates/sync.server";
import {
  getAffiliateDashboardStats,
  getAffiliateDetailStats,
  getLtvCohortCurve,
  type CohortWindow,
  type LtvCohortCurve,
} from "../affiliates/analytics-queries.server";
import {
  PAID_ADS_PCT,
  STALE_SYNC_DAYS,
} from "../affiliates/classification-thresholds";
import type { AffiliateOverviewStats } from "../affiliates/overview-stats.server";
import { KpiCard, type DrillDownKey } from "./app.affiliates/kpi-card";
import { ProfilesList } from "./app.affiliates/profiles-list";
import { ProfileDetail } from "./app.affiliates/profile-detail";
import { AttributionQueue } from "./app.affiliates/attribution-queue";
import type { AttributionTabLoaderData } from "../affiliates/attribution.server";
import {
  buildAttributionQueueSnapshot,
  createAttributionClaim,
  deleteAttributionClaim,
  importPedidosCsv,
  listForgottenClaims,
  readAttributionTabLoaderData,
  DEFAULT_LOOKBACK_DAYS,
} from "../affiliates/attribution.server";

// ─── Types ──────────────────────────────────────────────────────────────────

type CachedAttributionSnapshot = {
  fetchedAt: string;
  fetchedVia: string | null;
  lookbackDays: number;
  scannedCount: number;
  pendingCount: number;
  claimedCount: number;
  unknownCount: number;
  rows: unknown;
  stats: unknown;
} | null;

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
  shop: string;
  attribution: AttributionTabLoaderData;
  attributionSnapshot: CachedAttributionSnapshot;
};

type PeriodPreset =
  | "last_7d"
  | "last_30d"
  | "last_month"
  | "last_3_months"
  | "custom";

type ComparisonMode = "none" | "prev_period" | "prev_year" | "custom";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extracts a clean handle from a raw social field (Instagram or TikTok).
 * Accepts any of:
 *   - "@handle"
 *   - "handle"
 *   - "https://www.instagram.com/handle"
 *   - "https://www.instagram.com/handle/"
 *   - "https://www.instagram.com/handle?igsh=..."
 *   - "https://www.instagram.com/handle/?hl=en"
 *   - "instagram.com/handle"
 * Returns null if no handle can be extracted.
 */
function sanitizeSocialHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  // Strip protocol
  s = s.replace(/^https?:\/\//i, "");
  // Strip www.
  s = s.replace(/^www\./i, "");
  // Strip known domains
  s = s.replace(/^(instagram|tiktok)\.com\//i, "");
  // Strip query string and hash
  s = s.split("?")[0].split("#")[0];
  // Strip trailing slash
  s = s.replace(/\/+$/, "");
  // Strip leading @ signs (one or many)
  s = s.replace(/^@+/, "");
  // Only take the first path segment (e.g. handle/feed → handle)
  s = s.split("/")[0];
  // Bail out on things that obviously aren't handles
  if (!s || s.length > 60) return null;
  // Valid Instagram/TikTok handles use letters, digits, underscore, dot
  if (!/^[A-Za-z0-9._]+$/.test(s)) return null;
  return s;
}

/** Builds an Instagram profile URL from a sanitized handle. */
function instagramUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}

/** Serializes a Date to YYYY-MM-DD using local calendar parts (not UTC). */
function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parses a YYYY-MM-DD string to a local-midnight Date (avoids UTC drift). */
function parseLocalYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/**
 * Formats a date range in the user-friendly format
 * "Mar 1 – Apr 10, 2026" (same year)
 * "Dec 20, 2025 – Jan 10, 2026" (different years)
 */
function formatDateRangeFriendly(start: string, end: string, locale: string): string {
  if (!start || !end) return "";
  const s = parseLocalYmd(start);
  const e = parseLocalYmd(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";

  const fmtMonthDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const sameYear = s.getFullYear() === e.getFullYear();

  if (sameYear) {
    return `${fmtMonthDay.format(s)} – ${fmtMonthDay.format(e)}, ${e.getFullYear()}`;
  }
  const fmtFull = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${fmtFull.format(s)} – ${fmtFull.format(e)}`;
}

/** Shorter last-sync format: "Last sync: 4/10/2026, 1PM" */
function formatLastSyncShort(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(d);
  let hour = d.getHours();
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${date}, ${hour}${ampm}`;
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
        start: toLocalYmd(start),
        end: toLocalYmd(lastDay),
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
    start: toLocalYmd(start),
    end: toLocalYmd(end),
  };
}

function getComparisonDates(
  mode: ComparisonMode,
  start: string,
  end: string,
): { compStart: string; compEnd: string } | null {
  if (mode === "none") return null;
  const s = parseLocalYmd(start);
  const e = parseLocalYmd(end);
  const rangeDays = Math.round(
    (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (mode === "prev_period") {
    const compEnd = new Date(s);
    compEnd.setDate(compEnd.getDate() - 1);
    const compStart = new Date(compEnd);
    compStart.setDate(compStart.getDate() - rangeDays);
    return {
      compStart: toLocalYmd(compStart),
      compEnd: toLocalYmd(compEnd),
    };
  }

  if (mode === "prev_year") {
    const compStart = new Date(s);
    compStart.setFullYear(compStart.getFullYear() - 1);
    const compEnd = new Date(e);
    compEnd.setFullYear(compEnd.getFullYear() - 1);
    return {
      compStart: toLocalYmd(compStart),
      compEnd: toLocalYmd(compEnd),
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

  const [profiles, syncMeta, attribution, snapshotRow] = await Promise.all([
    readAffiliateProfiles(shop),
    readAffiliateSyncMeta(shop),
    readAttributionTabLoaderData(shop),
    // Read cached queue snapshot so the Attribution tab renders instantly
    // without paginating Shopify. Missing row = tab falls back to the live
    // Refresh path (the action's existing behavior).
    prisma.attributionQueueSnapshot.findUnique({ where: { shop } }),
  ]);

  const attributionSnapshot: CachedAttributionSnapshot = snapshotRow
    ? {
        fetchedAt: snapshotRow.fetchedAt.toISOString(),
        fetchedVia: snapshotRow.fetchedVia,
        lookbackDays: snapshotRow.lookbackDays,
        scannedCount: snapshotRow.scannedCount,
        pendingCount: snapshotRow.pendingCount,
        claimedCount: snapshotRow.claimedCount,
        unknownCount: snapshotRow.unknownCount,
        rows: snapshotRow.rowsJson,
        stats: snapshotRow.statsJson,
      }
    : null;

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
    shop,
    attribution,
    attributionSnapshot,
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

  if (intent === "fetch-affiliate-detail") {
    const affiliateCode = String(formData.get("affiliateCode") || "");
    const startDate = String(formData.get("startDate") || "");
    const endDate = String(formData.get("endDate") || "");
    const compStart = formData.get("compStart")
      ? String(formData.get("compStart"))
      : null;
    const compEnd = formData.get("compEnd")
      ? String(formData.get("compEnd"))
      : null;

    if (!affiliateCode) {
      return {
        ok: false,
        intent: "fetch-affiliate-detail",
        error: "Missing affiliateCode",
      };
    }

    try {
      const detail = await getAffiliateDetailStats(
        shop,
        affiliateCode,
        startDate,
        endDate,
        compStart,
        compEnd,
      );
      return { ok: true, intent: "fetch-affiliate-detail", detail };
    } catch (error) {
      console.error(
        `[affiliates] fetch-affiliate-detail FAILED shop=${shop} code=${affiliateCode}`,
        error,
      );
      return {
        ok: false,
        intent: "fetch-affiliate-detail",
        error: String((error as Error)?.message ?? "Failed to fetch detail"),
      };
    }
  }

  if (intent === "fetch-ltv-cohort") {
    const windowRaw = String(formData.get("cohortWindow") || "12mo");
    const window: CohortWindow =
      windowRaw === "6mo" || windowRaw === "24mo" || windowRaw === "all"
        ? (windowRaw as CohortWindow)
        : "12mo";
    try {
      const cohort = await getLtvCohortCurve(shop, window);
      return { ok: true, intent: "fetch-ltv-cohort", cohort };
    } catch (error) {
      console.error(`[affiliates] fetch-ltv-cohort FAILED shop=${shop}`, error);
      return {
        ok: false,
        intent: "fetch-ltv-cohort",
        error: String((error as Error)?.message ?? "Failed to fetch cohort"),
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

  if (intent === "attribution-fetch-queue") {
    const lookbackRaw = Number.parseInt(
      String(formData.get("lookbackDays") || DEFAULT_LOOKBACK_DAYS),
      10,
    );
    const lookbackDays = Number.isFinite(lookbackRaw) && lookbackRaw > 0
      ? Math.min(lookbackRaw, 365 * 2)
      : DEFAULT_LOOKBACK_DAYS;
    try {
      const [snapshot, forgotten, tabMeta] = await Promise.all([
        buildAttributionQueueSnapshot(admin, shop, { lookbackDays }),
        listForgottenClaims(shop),
        readAttributionTabLoaderData(shop),
      ]);
      // Persist to AttributionQueueSnapshot so subsequent page loads paint
      // from cache without re-paginating Shopify. Matches the hourly cron's
      // persistence path.
      await prisma.attributionQueueSnapshot
        .upsert({
          where: { shop },
          create: {
            shop,
            fetchedAt: new Date(snapshot.fetchedAt),
            fetchedVia: "manual",
            lookbackDays: snapshot.lookbackDays,
            scannedCount: snapshot.scannedCount,
            pendingCount: snapshot.stats.pending,
            claimedCount: snapshot.stats.claimed,
            unknownCount: snapshot.stats.unknown,
            rowsJson: snapshot.rows as unknown as object,
            statsJson: {
              sinceDate: snapshot.sinceDate,
              matchedCount: snapshot.matchedCount,
              stats: snapshot.stats,
            } as unknown as object,
          },
          update: {
            fetchedAt: new Date(snapshot.fetchedAt),
            fetchedVia: "manual",
            lookbackDays: snapshot.lookbackDays,
            scannedCount: snapshot.scannedCount,
            pendingCount: snapshot.stats.pending,
            claimedCount: snapshot.stats.claimed,
            unknownCount: snapshot.stats.unknown,
            rowsJson: snapshot.rows as unknown as object,
            statsJson: {
              sinceDate: snapshot.sinceDate,
              matchedCount: snapshot.matchedCount,
              stats: snapshot.stats,
            } as unknown as object,
          },
        })
        .catch((err) => {
          console.warn(
            `[affiliates] attribution-fetch-queue snapshot-persist SKIP shop=${shop}`,
            err,
          );
        });
      return {
        ok: true as const,
        intent: "attribution-fetch-queue" as const,
        snapshot,
        forgotten,
        tabMeta,
      };
    } catch (error) {
      console.error(
        `[affiliates] attribution-fetch-queue FAILED shop=${shop}`,
        error,
      );
      return {
        ok: false as const,
        intent: "attribution-fetch-queue" as const,
        error: String((error as Error)?.message ?? "Fetch failed"),
      };
    }
  }

  if (intent === "attribution-claim-order") {
    const orderName = String(formData.get("orderName") || "").trim();
    const couponCode = String(formData.get("couponCode") || "").trim();
    if (!orderName || !couponCode) {
      return {
        ok: false as const,
        intent: "attribution-claim-order" as const,
        error: "Missing orderName or couponCode",
      };
    }
    const orderGid = formData.get("orderGid")
      ? String(formData.get("orderGid"))
      : null;
    const affiliateCode = formData.get("affiliateCode")
      ? String(formData.get("affiliateCode"))
      : null;
    const affiliateEmail = formData.get("affiliateEmail")
      ? String(formData.get("affiliateEmail"))
      : null;
    const subtotalRaw = formData.get("subtotal")
      ? Number.parseFloat(String(formData.get("subtotal")))
      : null;
    const subtotal =
      subtotalRaw != null && Number.isFinite(subtotalRaw) ? subtotalRaw : null;
    const currencyCode = formData.get("currencyCode")
      ? String(formData.get("currencyCode"))
      : null;
    const sourceName = formData.get("sourceName")
      ? String(formData.get("sourceName"))
      : null;
    const orderDateRaw = formData.get("orderDate")
      ? String(formData.get("orderDate"))
      : null;
    const orderDate = orderDateRaw ? new Date(orderDateRaw) : null;
    const claimedBy =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((session as any).onlineAccessInfo?.associated_user?.email as
        | string
        | undefined) ?? null;
    try {
      const result = await createAttributionClaim(shop, {
        orderName,
        orderGid,
        couponCode,
        affiliateCode,
        affiliateEmail,
        subtotal,
        currencyCode,
        sourceName,
        orderDate: orderDate && !Number.isNaN(orderDate.getTime()) ? orderDate : null,
        claimedBy,
      });
      return {
        ok: true as const,
        intent: "attribution-claim-order" as const,
        claimId: result.id,
        alreadyExisted: result.alreadyExisted,
        orderName,
      };
    } catch (error) {
      console.error(
        `[affiliates] attribution-claim-order FAILED shop=${shop} order=${orderName}`,
        error,
      );
      return {
        ok: false as const,
        intent: "attribution-claim-order" as const,
        error: String((error as Error)?.message ?? "Claim failed"),
      };
    }
  }

  if (intent === "attribution-unclaim-order") {
    const orderName = String(formData.get("orderName") || "").trim();
    if (!orderName) {
      return {
        ok: false as const,
        intent: "attribution-unclaim-order" as const,
        error: "Missing orderName",
      };
    }
    try {
      const result = await deleteAttributionClaim(shop, orderName);
      return {
        ok: true as const,
        intent: "attribution-unclaim-order" as const,
        deleted: result.deleted,
        orderName,
      };
    } catch (error) {
      console.error(
        `[affiliates] attribution-unclaim-order FAILED shop=${shop} order=${orderName}`,
        error,
      );
      return {
        ok: false as const,
        intent: "attribution-unclaim-order" as const,
        error: String((error as Error)?.message ?? "Unclaim failed"),
      };
    }
  }

  if (intent === "attribution-import-pedidos-csv") {
    const csvText = String(formData.get("csvText") || "");
    const fileName = formData.get("fileName")
      ? String(formData.get("fileName"))
      : null;
    if (!csvText.trim()) {
      return {
        ok: false as const,
        intent: "attribution-import-pedidos-csv" as const,
        error: "No CSV data provided",
      };
    }
    const importedBy =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((session as any).onlineAccessInfo?.associated_user?.email as
        | string
        | undefined) ?? null;
    try {
      const result = await importPedidosCsv(shop, csvText, {
        importedBy,
        fileName,
      });
      const tabMeta = await readAttributionTabLoaderData(shop);
      return {
        ok: true as const,
        intent: "attribution-import-pedidos-csv" as const,
        result,
        tabMeta,
      };
    } catch (error) {
      console.error(
        `[affiliates] attribution-import-pedidos-csv FAILED shop=${shop}`,
        error,
      );
      return {
        ok: false as const,
        intent: "attribution-import-pedidos-csv" as const,
        error: String((error as Error)?.message ?? "Import failed"),
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
    shop,
    attribution: attributionMeta,
    attributionSnapshot,
  } = useLoaderData<LoaderData>();

  void _syncStartedAt; // reserved for future elapsed-time display
  const { t } = useTranslation("affiliates");
  const fetcher = useFetcher<typeof action>();
  // Separate fetcher for the cohort LTV drill so its response doesn't race
  // with dashboard fetches (they share no state and different cadences).
  const cohortFetcher = useFetcher<typeof action>();

  // Cohort-window state lives in this component so the control persists
  // across drill open/close. Default to 12 months per the plan.
  const [cohortWindow, setCohortWindow] = useState<CohortWindow>("12mo");
  const [cohortCurve, setCohortCurve] = useState<LtvCohortCurve | null>(null);
  const revalidator = useRevalidator();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── State ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<
    "overview" | "profiles" | "attribution"
  >("overview");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("last_30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  // Custom range uses a draft → apply flow. s-date-picker cell clicks write
  // into draftStart/draftEnd; nothing hits the network until the user clicks
  // Apply. Cancel discards drafts and reverts to the previous preset.
  // customCalendarOpen controls visibility separately so Apply can collapse
  // the calendar while keeping periodPreset === "custom".
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [customCalendarOpen, setCustomCalendarOpen] = useState(false);
  const prevPresetRef = useRef<PeriodPreset>("last_30d");
  // Default to prev_period: the Overview tab's delta arrows are the whole
  // point of a monthly review; hiding them by default is a usability tax.
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("prev_period");
  const [selectedAffiliate, setSelectedAffiliate] = useState("all");
  // Combobox state: typed query + dropdown open. The actual selected
  // affiliate lives in `selectedAffiliate`; this `affiliateSearch` is the
  // input's visible text (either the typed query or the selected name).
  const [affiliateSearch, setAffiliateSearch] = useState("");
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const comboboxRef = useRef<HTMLDivElement | null>(null);
  // Profiles tab: when non-null, the Profiles tab shows the per-affiliate
  // detail view for this code instead of the enhanced list. Clicking a row
  // in the Overview tab's leaderboard drill sets this and switches tabs.
  const [profileDetailCode, setProfileDetailCode] = useState<string | null>(null);

  const [dashboardStats, setDashboardStats] =
    useState<AffiliateOverviewStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Single drill-down state — only one card can be expanded across all rows.
  const [activeDrill, setActiveDrill] = useState<DrillDownKey>(null);

  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);


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
    if (fetcher.data?.intent === "sync-orders") {
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator]);

  // Cohort LTV response handler (separate fetcher).
  useEffect(() => {
    if (cohortFetcher.data?.intent === "fetch-ltv-cohort" && cohortFetcher.data.ok) {
      setCohortCurve(cohortFetcher.data.cohort as LtvCohortCurve);
    }
  }, [cohortFetcher.data]);

  // Re-fetch the cohort curve whenever the drill is open AND the window
  // changes. The drill itself triggers the first fetch when opened.
  const fetchCohortCurve = (w: CohortWindow) => {
    const fd = new FormData();
    fd.append("intent", "fetch-ltv-cohort");
    fd.append("cohortWindow", w);
    cohortFetcher.submit(fd, { method: "post" });
  };
  const lastFetchedWindowRef = useRef<CohortWindow | null>(null);
  useEffect(() => {
    if (activeDrill !== "ltv") return;
    if (lastFetchedWindowRef.current === cohortWindow) return;
    lastFetchedWindowRef.current = cohortWindow;
    fetchCohortCurve(cohortWindow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrill, cohortWindow]);

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

  // Re-fetch whenever any filter changes (period, comparison, affiliate, or custom dates).
  // Fix for stale-state bug: relying on useEffect instead of setTimeout ensures state
  // is flushed before fetchStats reads it.
  useEffect(() => {
    if (!hasData || !initialFetchDone.current) return;
    // Skip custom preset until both dates are set
    if (periodPreset === "custom" && (!customStart || !customEnd)) return;
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodPreset, comparisonMode, selectedAffiliate, customStart, customEnd]);

  // Track previous preset so Cancel can revert, and pre-populate drafts
  // from the applied values whenever Custom is entered.
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
    const target = prevPresetRef.current || "last_30d";
    setPeriodPreset(target === "custom" ? "last_30d" : target);
  };

  const handleEditCustomDates = () => {
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    setCustomCalendarOpen(true);
  };

  // ─── Sync handler ──────────────────────────────────────────────────
  const handleSync = () => {
    const fd = new FormData();
    fd.append("intent", "sync-orders");
    fetcher.submit(fd, { method: "post" });
  };

  // ─── Drill-down handler (mutex across all rows) ─────────────────────
  const handleDrillClick = (key: string) =>
    setActiveDrill((prev) => (prev === key ? null : key));

  // renderDelta is now in ./app.affiliates/kpi-card (used by the
  // extracted KpiCard component).

  // ─── Format helpers bound to locale ─────────────────────────────────
  const cc = dashboardStats?.currencyCode ?? "BRL";
  const fmtCurrency = (v: number) => formatCurrencyCompact(v, cc, userLocale);
  const fmtNum = formatNumberCompact;
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const stats = dashboardStats;
  const isLoading = statsLoading;

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

  // ─── Active date range for friendly format display ─────────────────
  const activeDateRange = useMemo(() => {
    if (periodPreset === "custom") {
      if (!customStart || !customEnd) return null;
      return { start: customStart, end: customEnd };
    }
    return getPresetDates(periodPreset);
  }, [periodPreset, customStart, customEnd]);

  const activeRangeFriendly = useMemo(() => {
    if (!activeDateRange) return "";
    return formatDateRangeFriendly(activeDateRange.start, activeDateRange.end, userLocale);
  }, [activeDateRange, userLocale]);

  // ─── Sanitized profiles (handles cleaned up once) ───────────────────
  const sanitizedProfiles = useMemo(() => {
    return profiles.map((p) => ({
      ...p,
      handle: sanitizeSocialHandle(p.instagram) ?? sanitizeSocialHandle(p.tiktok),
    }));
  }, [profiles]);

  // Close the affiliate combobox when the user clicks outside its wrapper.
  useEffect(() => {
    if (!comboboxOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!comboboxRef.current || !target) return;
      if (!comboboxRef.current.contains(target)) setComboboxOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [comboboxOpen]);

  // Filtered dropdown items. Empty query = full list.
  const comboboxItems = useMemo(() => {
    const q = affiliateSearch.trim().toLowerCase();
    if (!q) return sanitizedProfiles.slice(0, 200);
    return sanitizedProfiles.filter((p) => {
      return (
        p.affiliateName.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.handle?.toLowerCase().includes(q) ?? false)
      );
    }).slice(0, 200);
  }, [affiliateSearch, sanitizedProfiles]);

  const pickAffiliate = (code: string, label: string) => {
    setSelectedAffiliate(code);
    setAffiliateSearch(label);
    setComboboxOpen(false);
  };

  const clearAffiliate = () => {
    setSelectedAffiliate("all");
    setAffiliateSearch("");
    setComboboxOpen(false);
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
              <tr
                key={row.code}
                className={styles.clickableRow}
                onClick={() => {
                  setActiveTab("profiles");
                  setProfileDetailCode(row.code);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setActiveTab("profiles");
                    setProfileDetailCode(row.code);
                  }
                }}
              >
                <td>{i + 1}</td>
                <td>
                  <div className={styles.profileName}>{row.affiliateName}</div>
                  {(() => {
                    const h =
                      sanitizeSocialHandle(row.instagram) ??
                      sanitizeSocialHandle(row.tiktok);
                    if (!h) return null;
                    return (
                      <a
                        className={styles.affiliateHandle}
                        href={instagramUrl(h)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        @{h}
                      </a>
                    );
                  })()}
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

  // ─── Revenue vertical-bar ranking (top N affiliates) ──────────────
  const renderRevenueVerticalBars = () => {
    if (!stats?.leaderboard?.length) {
      return <p className={styles.noData}>No data</p>;
    }
    const top = stats.leaderboard.slice(0, 12);
    const maxRev = Math.max(...top.map((r) => r.revenue), 1);
    return (
      <div className={styles.vbarChart}>
        {top.map((row) => {
          const pct = Math.max((row.revenue / maxRev) * 100, 1);
          const handle =
            sanitizeSocialHandle(row.instagram) ??
            sanitizeSocialHandle(row.tiktok);
          return (
            <div key={row.code} className={styles.vbarColumn}>
              <div className={styles.vbarBarArea}>
                <div
                  className={styles.vbarBar}
                  style={{
                    height: `${pct}%`,
                    background:
                      "linear-gradient(180deg, #5ecece 0%, #b09fda 100%)",
                  }}
                  title={`${row.affiliateName}: ${fmtCurrency(row.revenue)}`}
                />
                <span className={styles.vbarBarValue}>
                  {fmtCurrency(row.revenue)}
                </span>
              </div>
              <span className={styles.vbarLabel}>
                {handle ? `@${handle}` : row.affiliateName}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // ─── Cohort LTV line chart (New / Lifted / N/A) ───────────────────
  const renderLtvCohortChart = () => {
    const isLoading =
      cohortFetcher.state !== "idle" || cohortCurve === null;
    const tickPrefix = (label: LtvCohortCurve["bucketLabel"]) =>
      label === "week"
        ? "W"
        : label === "month"
          ? "M"
          : label === "bimonth"
            ? "2M"
            : "Q";

    // Header row: title + Cohort window select (right-aligned).
    const header = (
      <div className={styles.ltvCohortHeader}>
        <div className={styles.waterfallTitle}>
          {t("drill.ltvCohortTitle", "LTV by cohort")}
        </div>
        <div className={styles.ltvCohortWindowControl}>
          <span className={styles.filterLabel}>
            {t("drill.ltvCohortWindowLabel", "Cohort window")}
          </span>
          <s-select
            label={t("drill.ltvCohortWindowLabel", "Cohort window")}
            labelAccessibilityVisibility="exclusive"
            value={cohortWindow}
            onChange={(event: Event) =>
              setCohortWindow(
                (event.currentTarget as HTMLSelectElement).value as CohortWindow,
              )
            }
          >
            <s-option value="6mo">
              {t("drill.ltvCohortWindow6mo", "Last 6 months")}
            </s-option>
            <s-option value="12mo">
              {t("drill.ltvCohortWindow12mo", "Last 12 months")}
            </s-option>
            <s-option value="24mo">
              {t("drill.ltvCohortWindow24mo", "Last 24 months")}
            </s-option>
            <s-option value="all">
              {t("drill.ltvCohortWindowAll", "All time")}
            </s-option>
          </s-select>
        </div>
      </div>
    );

    if (isLoading && !cohortCurve) {
      return (
        <>
          {header}
          <div className={styles.noData}>…</div>
        </>
      );
    }
    if (!cohortCurve) return header;
    const cc = cohortCurve;
    const totalN = cc.totalCohortSizes.new + cc.totalCohortSizes.lifted + cc.totalCohortSizes.na;
    if (totalN === 0) {
      return (
        <>
          {header}
          <div className={styles.noData}>
            {t(
              "drill.ltvCohortEmpty",
              "No LTV data yet, run Sync Orders to populate the cohort",
            )}
          </div>
        </>
      );
    }

    // SVG canvas: 600x280. Chart area leaves room for axes + legend.
    const W = 600;
    const H = 280;
    const padL = 48;
    const padR = 64; // room for end-labels
    const padT = 8;
    const padB = 28;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxY = Math.max(
      1,
      ...cc.points.flatMap((p) => [p.new, p.lifted, p.na]),
    ) * 1.08;
    const n = cc.points.length;
    const xFor = (i: number) =>
      padL + (n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW);
    const yFor = (v: number) => padT + chartH - (v / maxY) * chartH;

    const mkPath = (values: number[]) =>
      values
        .map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`)
        .join(" ");

    const newVals = cc.points.map((p) => p.new);
    const liftedVals = cc.points.map((p) => p.lifted);
    const naVals = cc.points.map((p) => p.na);

    const tickP = tickPrefix(cc.bucketLabel);

    const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: padT + chartH - f * chartH,
      label: fmtCurrency(f * maxY),
    }));

    return (
      <>
        {header}
        <div className={styles.ltvCohortLegend}>
          <span>
            <span className={`${styles.legendDot} ${styles.ltvDotNew}`} />
            {t("drill.ltvCohortNew", "New")}
          </span>
          <span>
            <span className={`${styles.legendDot} ${styles.ltvDotLifted}`} />
            {t("drill.ltvCohortLifted", "Lifted")}
          </span>
          <span>
            <span className={`${styles.legendDot} ${styles.ltvDotNa}`} />
            {t("drill.ltvCohortNa", "N/A")}
          </span>
        </div>
        <svg
          className={styles.ltvCohortChart}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {gridYs.map((g, i) => (
            <g key={`g${i}`}>
              <line x1={padL} y1={g.y} x2={W - padR} y2={g.y}
                stroke="#e1e3e5" strokeWidth={1} />
              <text x={padL - 6} y={g.y + 3} textAnchor="end"
                fontSize={10} fill="#6d7175">{g.label}</text>
            </g>
          ))}
          {cc.points.map((_, i) => (
            <text key={`x${i}`} x={xFor(i)} y={H - padB / 2}
              textAnchor="middle" fontSize={10} fill="#6d7175">
              {tickP}{i}
            </text>
          ))}
          <path d={mkPath(newVals)} fill="none" stroke="#008060" strokeWidth={2} />
          <path d={mkPath(liftedVals)} fill="none" stroke="#00527c" strokeWidth={2} />
          <path d={mkPath(naVals)} fill="none" stroke="#6d7175" strokeWidth={2} strokeDasharray="4 3" />
          {cc.points.map((p, i) => (
            <g key={`pt${i}`}>
              <circle cx={xFor(i)} cy={yFor(p.new)} r={3} fill="#008060">
                <title>{`${tickP}${i}: ${fmtCurrency(p.new)} · n=${p.newSampleSize}`}</title>
              </circle>
              <circle cx={xFor(i)} cy={yFor(p.lifted)} r={3} fill="#00527c">
                <title>{`${tickP}${i}: ${fmtCurrency(p.lifted)} · n=${p.liftedSampleSize}`}</title>
              </circle>
              <circle cx={xFor(i)} cy={yFor(p.na)} r={3} fill="#6d7175">
                <title>{`${tickP}${i}: ${fmtCurrency(p.na)} · n=${p.naSampleSize}`}</title>
              </circle>
            </g>
          ))}
          {/* End-of-line pills */}
          <g>
            <rect x={xFor(n - 1) + 6} y={yFor(newVals[n - 1]!) - 9}
              width={54} height={18} rx={9} fill="#008060" />
            <text x={xFor(n - 1) + 33} y={yFor(newVals[n - 1]!) + 4}
              textAnchor="middle" fontSize={11} fill="#fff" fontWeight={600}>
              {t("drill.ltvCohortNew", "New")}
            </text>
          </g>
          <g>
            <rect x={xFor(n - 1) + 6} y={yFor(liftedVals[n - 1]!) - 9}
              width={54} height={18} rx={9} fill="#00527c" />
            <text x={xFor(n - 1) + 33} y={yFor(liftedVals[n - 1]!) + 4}
              textAnchor="middle" fontSize={11} fill="#fff" fontWeight={600}>
              {t("drill.ltvCohortLifted", "Lifted")}
            </text>
          </g>
          <g>
            <rect x={xFor(n - 1) + 6} y={yFor(naVals[n - 1]!) - 9}
              width={40} height={18} rx={9} fill="#6d7175" />
            <text x={xFor(n - 1) + 26} y={yFor(naVals[n - 1]!) + 4}
              textAnchor="middle" fontSize={11} fill="#fff" fontWeight={600}>
              {t("drill.ltvCohortNa", "N/A")}
            </text>
          </g>
        </svg>
        <div className={styles.ltvCohortFootnote}>
          {t("drill.ltvCohortSample", {
            new: cc.totalCohortSizes.new,
            lifted: cc.totalCohortSizes.lifted,
            na: cc.totalCohortSizes.na,
            defaultValue:
              "Cohorts: {{new}} new · {{lifted}} lifted · {{na}} N/A",
          })}
        </div>
      </>
    );
  };

  // ─── Dual vertical waterfall (Affiliate margin | Organic margin) ──
  const renderMarginDualWaterfall = () => {
    if (!stats?.marginAnalysis) return null;
    const m = stats.marginAnalysis;

    // Everything normalized to %% of that cohort's gross sales so the two
    // columns are directly comparable on the same y-axis.
    const affGross = m.affiliateGrossSales || 1;
    const orgGross = m.organicGrossSales || 1;
    const pct = (v: number, gross: number) => (v / gross) * 100;

    type Step = {
      key: string;
      label: string;
      pct: number;      // bar height in %% of gross
      color: string;
      isFinal?: boolean; // standing net-margin bar
    };

    // Affiliate: Gross → -site disc → -aff disc → -commission → Net margin
    const affiliateSteps: Step[] = [
      {
        key: "site",
        label: t("drill.siteDiscount", "Site disc."),
        pct: pct(m.affiliateSiteDiscountTotal, affGross),
        color: "#c48fd0",
      },
      {
        key: "aff",
        label: t("drill.affiliateDiscount", "Aff. disc."),
        pct: pct(m.affiliateDiscountTotal, affGross),
        color: "#b09fda",
      },
      {
        key: "comm",
        label: t("drill.commission", "Commission"),
        pct: pct(m.commissionTotal, affGross),
        color: "#f0b775",
      },
    ];
    const affiliateNetPct = Math.max(
      0,
      100 - affiliateSteps.reduce((s, x) => s + x.pct, 0),
    );

    // Organic: Gross → -site disc → -paid ads (fixed 10%) → Net margin
    const organicSteps: Step[] = [
      {
        key: "site",
        label: t("drill.siteDiscount", "Site disc."),
        pct: pct(m.organicDiscountTotal, orgGross),
        color: "#c48fd0",
      },
      {
        key: "ads",
        label: t("drill.paidAds", "Paid ads"),
        pct: PAID_ADS_PCT,
        color: "#f0b775",
      },
    ];
    const organicNetPct = Math.max(
      0,
      100 - organicSteps.reduce((s, x) => s + x.pct, 0),
    );

    const fmtPctSign = (v: number, sign: "+" | "-") =>
      `${sign}${v.toFixed(1)}%`;

    const renderColumn = (
      title: string,
      subtractionSteps: Step[],
      netPct: number,
    ) => {
      // Running total tracks the top of each subtraction bar as a %% offset
      // from the top of the chart area. Gross starts at top (0%); each
      // subtraction pushes the next bar down by its height.
      let running = 0;
      const subtractionColumns = subtractionSteps.map((step) => {
        const topOffsetPct = running;
        running += step.pct;
        return { ...step, topOffsetPct };
      });

      return (
        <div className={styles.vwaterfallCol}>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div className={styles.vwaterfallColInner}>
              <div className={styles.vwaterfallTitle}>
                {title}{" "}
                <span className={styles.vwaterfallPct}>
                  {netPct.toFixed(1)}%
                </span>
              </div>
              <div className={styles.waterfallChart}>
            {/* Gross: full-height reference bar at col 1 */}
            <div className={styles.waterfallCol}>
              <div className={styles.waterfallBarArea}>
                <div
                  className={`${styles.waterfallBar} ${styles.waterfallBarGross}`}
                  style={{ height: "100%", top: 0 }}
                  title={`${t("drill.grossSales", "Gross")}: 100%`}
                />
                <span className={styles.waterfallBarValue}>100%</span>
              </div>
              <span className={styles.waterfallBarLabel}>
                {t("drill.grossSales", "Gross")}
              </span>
            </div>

            {/* Subtraction bars: float at their running-total offset */}
            {subtractionColumns.map((step) => (
              <div key={step.key} className={styles.waterfallCol}>
                <div className={styles.waterfallBarArea}>
                  <div
                    className={`${styles.waterfallBar} ${styles.waterfallBarSubtract}`}
                    style={{
                      top: `${step.topOffsetPct}%`,
                      height: `${Math.max(step.pct, 1)}%`,
                      background: step.color,
                    }}
                    title={`${step.label}: -${step.pct.toFixed(1)}%`}
                  />
                  <span className={styles.waterfallBarValue}>
                    {fmtPctSign(step.pct, "-")}
                  </span>
                </div>
                <span className={styles.waterfallBarLabel}>{step.label}</span>
              </div>
            ))}

            {/* Net margin: standing bar from floor, height = remaining % */}
            <div className={styles.waterfallCol}>
              <div className={styles.waterfallBarArea}>
                <div
                  className={`${styles.waterfallBar} ${styles.waterfallBarNet}`}
                  style={{
                    height: `${Math.max(netPct, 1)}%`,
                    bottom: 0,
                    top: "auto",
                  }}
                  title={`${t("drill.netMargin", "Net margin")}: ${netPct.toFixed(1)}%`}
                />
                <span className={styles.waterfallBarValue}>
                  {netPct.toFixed(1)}%
                </span>
              </div>
              <span className={styles.waterfallBarLabel}>
                {t("drill.netMargin", "Net margin")}
              </span>
            </div>
              </div>
            </div>
          </s-box>
        </div>
      );
    };

    return (
      <div className={styles.vwaterfallContainer}>
        {renderColumn(
          t("drill.affiliateColumn", "Affiliate"),
          affiliateSteps,
          affiliateNetPct,
        )}
        {renderColumn(
          t("drill.organicColumn", "Organic"),
          organicSteps,
          organicNetPct,
        )}
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

  // KpiCard is now imported from ./app.affiliates/kpi-card; the
  // rendered cards below pass `isLoading` explicitly.

  // ─── Period controls (used by Overview + Affiliates tabs) ────────
  // Layout stays 2:2:3 across both tabs so switching feels seamless.
  // The third column is the affiliate search on Overview, and blank
  // whitespace on Affiliates (where each row is already clickable).
  const renderPeriodControls = (showSearch: boolean) => (
    <div className={styles.periodBar}>
      {/* Period column */}
      <div className={styles.filterControl}>
        <span className={styles.filterLabel}>{t("period.label", "Period")}</span>
        <s-select
          label={t("period.label", "Period")}
          labelAccessibilityVisibility="exclusive"
          value={periodPreset}
          onChange={(event: Event) =>
            setPeriodPreset(
              (event.currentTarget as HTMLSelectElement).value as PeriodPreset,
            )
          }
        >
          <s-option value="last_7d">{t("period.last7d", "Last 7 days")}</s-option>
          <s-option value="last_30d">{t("period.last30d", "Last 30 days")}</s-option>
          <s-option value="last_month">{t("period.lastMonth", "Last month")}</s-option>
          <s-option value="last_3_months">{t("period.last3Months", "Last 3 months")}</s-option>
          <s-option value="custom">{t("period.custom", "Custom")}</s-option>
        </s-select>
      </div>

      {/* Compare-with column */}
      <div className={styles.filterControl}>
        <span className={styles.filterLabel}>{t("comparison.label", "Compare with")}</span>
        <s-select
          label={t("comparison.label", "Compare with")}
          labelAccessibilityVisibility="exclusive"
          value={comparisonMode}
          onChange={(event: Event) =>
            setComparisonMode(
              (event.currentTarget as HTMLSelectElement).value as ComparisonMode,
            )
          }
        >
          <s-option value="none">{t("comparison.none", "No comparison")}</s-option>
          <s-option value="prev_period">{t("comparison.prevPeriod", "Previous period")}</s-option>
          <s-option value="prev_year">{t("comparison.prevYear", "Previous year")}</s-option>
        </s-select>
      </div>

      {/* Search column (Overview only) or blank spacer (Affiliates tab) */}
      {showSearch ? (
        <div className={styles.filterControl} ref={comboboxRef}>
          <span className={styles.filterLabel}>
            {t("filter.search", "Search affiliate")}
          </span>
          <div className={styles.combobox}>
            <input
              type="text"
              className={styles.comboboxInput}
              placeholder={t("filter.allAffiliates", "All affiliates")}
              value={affiliateSearch}
              onFocus={() => setComboboxOpen(true)}
              onChange={(e) => {
                setAffiliateSearch(e.target.value);
                setComboboxOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  clearAffiliate();
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            {(selectedAffiliate !== "all" || affiliateSearch) && (
              <button
                type="button"
                className={styles.comboboxClear}
                onClick={clearAffiliate}
                aria-label={t("filter.clear", "Clear filter")}
              >
                ×
              </button>
            )}
            {comboboxOpen && comboboxItems.length > 0 && (
              <ul className={styles.comboboxDropdown} role="listbox">
                {comboboxItems.map((p) => {
                  const label = `${p.affiliateName}${p.handle ? ` (@${p.handle})` : ""}`;
                  const isSelected =
                    selectedAffiliate.toLowerCase() === p.code.toLowerCase();
                  return (
                    <li
                      key={p.code}
                      role="option"
                      aria-selected={isSelected}
                      className={`${styles.comboboxItem}${isSelected ? ` ${styles.comboboxItemActive}` : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickAffiliate(p.code, label);
                      }}
                    >
                      {label}
                    </li>
                  );
                })}
              </ul>
            )}
            {comboboxOpen && comboboxItems.length === 0 && (
              <ul className={styles.comboboxDropdown} role="listbox">
                <li className={styles.comboboxEmpty}>
                  {t("filter.noMatches", "No matches")}
                </li>
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.filterControl} aria-hidden />
      )}
    </div>
  );

  const renderCustomCalendar = () => {
    if (periodPreset !== "custom" || !customCalendarOpen) return null;
    return (
      <div className={styles.customDateGrid}>
        <div className={styles.customDateCol}>
          <span className={styles.customDateLabel}>
            {t("period.startDate", "Start date")}
          </span>
          <s-date-picker
            type="single"
            value={draftStart}
            onChange={(event: Event) =>
              setDraftStart(
                (event.currentTarget as HTMLInputElement).value,
              )
            }
          />
        </div>
        <div className={styles.customDateCol}>
          <span className={styles.customDateLabel}>
            {t("period.endDate", "End date")}
          </span>
          <s-date-picker
            type="single"
            value={draftEnd}
            onChange={(event: Event) =>
              setDraftEnd(
                (event.currentTarget as HTMLInputElement).value,
              )
            }
          />
        </div>
        <div className={styles.customDateActions}>
          <s-button variant="secondary" onClick={handleCancelCustom}>
            {t("period.cancel", "Cancel")}
          </s-button>
          {canApplyCustom ? (
            <s-button variant="primary" onClick={handleApplyCustom}>
              {t("period.apply", "Apply")}
            </s-button>
          ) : (
            <s-button variant="primary" disabled>
              {t("period.apply", "Apply")}
            </s-button>
          )}
        </div>
      </div>
    );
  };

  // ─── JSX ────────────────────────────────────────────────────────────
  return (
    <s-page heading={t("page.title", "Affiliates")}>
      <s-section>
        {/* ── Tabs — left-aligned, divider bleeds to section edges
            (matches Settings page pattern). Badge + actions sit far-right
            on the same row, pushed by margin-left: auto. ── */}
        <div className={styles.tabsRow}>
          <button
            type="button"
            className={`${styles.tab}${activeTab === "overview" ? ` ${styles.tabActive}` : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            {t("tab.overview", "Overview")}
          </button>
          <button
            type="button"
            className={`${styles.tab}${activeTab === "profiles" ? ` ${styles.tabActive}` : ""}`}
            onClick={() => {
              setActiveTab("profiles");
              setProfileDetailCode(null);
            }}
          >
            {t("tab.affiliates", "Affiliates")}
          </button>
          <button
            type="button"
            className={`${styles.tab}${activeTab === "attribution" ? ` ${styles.tabActive}` : ""}`}
            onClick={() => setActiveTab("attribution")}
          >
            {t("tab.attributionQueue", "Attribution queue")}
            {(attributionMeta?.claimedPendingCount ?? 0) +
              (attributionMeta?.forgottenCount ?? 0) >
              0 && (
              <>
                {" "}
                <s-badge
                  tone={
                    (attributionMeta?.forgottenCount ?? 0) > 0
                      ? "warning"
                      : "info"
                  }
                >
                  {(attributionMeta?.claimedPendingCount ?? 0) +
                    (attributionMeta?.forgottenCount ?? 0)}
                </s-badge>
              </>
            )}
          </button>

          {/* Badge + action buttons, pushed to far right */}
          <div className={styles.tabsRightGroup}>
            {syncLastSyncedAt && (
              <s-badge tone="info">
                {t("sync.lastSyncShort", "Last sync")}: {formatLastSyncShort(syncLastSyncedAt, userLocale)}
              </s-badge>
            )}
            {syncStatus === "running" ? (
              <s-button
                variant="secondary"
                {...{ icon: "refresh" } as Record<string, string>}
                disabled
                key="sync-btn-disabled"
              >
                {t("sync.running", "Syncing...")}
              </s-button>
            ) : (
              <s-button
                variant="secondary"
                {...{
                  icon: "refresh",
                  title: t(
                    "page.syncButtonTooltip",
                    "Webhooks + hourly cron keep data current automatically. Use this only for a full 14-month resync.",
                  ),
                } as Record<string, string>}
                key="sync-btn-active"
                onClick={handleSync}
              >
                {t("page.syncButton", "Force full resync")}
              </s-button>
            )}
            <s-button
              variant="secondary"
              {...{ icon: "upload" } as Record<string, string>}
              onClick={handleCsvDropZoneClick}
            >
              {t("page.updateDatabase", "Update database")}
            </s-button>
          </div>
        </div>

        {/* ── Sync progress ─────────────────────────────────────── */}
        {syncStatus === "running" && (() => {
          // Real progress: use the last sync's totalOrders as a rolling
          // estimate. If we've never synced before, fall back to a gentle
          // animated sweep at 5% so the bar at least moves.
          const estimate = syncTotalOrders ?? 0;
          const progress = syncProgressCount ?? 0;
          const pct =
            estimate > 0
              ? Math.min(100, Math.max(5, (progress / estimate) * 100))
              : 5;
          return (
            <div>
              <div className={styles.syncProgressRow}>
                <span className={styles.syncProgressPhaseLabel}>
                  {syncPhase ?? t("sync.running", "Syncing orders...")}
                </span>
                {syncProgressCount != null && (
                  <span className={styles.syncProgressPct}>
                    {fmtNum(progress)}
                    {estimate > 0 ? ` / ~${fmtNum(estimate)}` : ""}{" "}
                    {t("sync.processed", "processed")}
                  </span>
                )}
              </div>
              <div className={styles.syncProgressBarBg}>
                <div
                  className={styles.syncProgressBarFill}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}

        {/* ── Stale sync warning ────────────────────────────────── */}
        {syncStatus !== "running" &&
          syncLastSyncedAt &&
          (() => {
            const lastSynced = new Date(syncLastSyncedAt);
            const ageMs = Date.now() - lastSynced.getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays < STALE_SYNC_DAYS) return null;
            return (
              <s-banner tone="warning">
                {t("sync.stale", {
                  days: Math.floor(ageDays),
                  defaultValue:
                    "Affiliate data is {{days}} days old — run Sync Orders to refresh before drawing conclusions.",
                })}
              </s-banner>
            );
          })()}

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

        {/* ── Overview header strip (mirrors Retail Footprint) ── */}
        {activeTab === "overview" && hasData && (
          <>
            <div className={styles.overviewStrip}>
              <div className={styles.overviewStripHeader}>
                <h2 className={styles.overviewStripHeading}>
                  {t("overview.heading", "Program overview")}
                </h2>
                {activeRangeFriendly && (
                  periodPreset === "custom" && !customCalendarOpen ? (
                    <button
                      type="button"
                      className={`${styles.periodFriendly} ${styles.periodFriendlyEditable}`}
                      onClick={handleEditCustomDates}
                      title={t("period.edit", "Change dates")}
                    >
                      {activeRangeFriendly}
                    </button>
                  ) : (
                    <span className={styles.periodFriendly}>{activeRangeFriendly}</span>
                  )
                )}
              </div>
              <div className={styles.overviewStripSubtitle}>
                {stats
                  ? `${fmtNum(stats.leaderboard?.length ?? 0)} ${t("overview.activeAffiliates", "active affiliates")} · ${fmtCurrency(stats.revenueImpact?.affiliateRevenue ?? 0)} ${t("overview.affiliateRevenue", "affiliate revenue")} · ${fmtPct(stats.revenueImpact?.affiliateSharePct ?? 0)} ${t("overview.ofTotal", "of total")}`
                  : ""}
              </div>
            </div>

            {renderPeriodControls(true)}
            {renderCustomCalendar()}
          </>
        )}

        {/* ── Commission-limitation disclosure ──────────────────
            Margin %, CAC, and ROAS on this tab all depend on a per-affiliate
            commission rate that BixGrow's CSV export does not provide. Until
            that source of truth exists, these cards use a flat 10% default for
            every affiliate. This banner discloses it once per page load so
            the numbers are never mistaken for ground truth. */}
        {activeTab === "overview" && hasData && (
          <s-banner tone="info">
            {t(
              "overview.commissionCaveat",
              "Margin, CAC, and ROAS estimates assume a flat 10% commission for every affiliate — BixGrow's CSV doesn't export per-affiliate commission rates, so these three cards are directional, not exact.",
            )}
          </s-banner>
        )}

        {/* ── Row 1: Acquisition & Economics ───────────────────── */}
        {activeTab === "overview" && hasData && (
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
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "revenue" && (
                <div className={styles.drillDown}>
                  <h3 className={styles.waterfallTitle}>
                    {t("drill.revenueLeaderboard", "Revenue by affiliate")}
                  </h3>
                  {renderRevenueVerticalBars()}
                  <h3
                    className={`${styles.waterfallTitle} ${styles.drillSectionHeading}`}
                  >
                    {t("drill.revenueTrend", "Monthly Trend")}
                  </h3>
                  {renderTrendChart()}
                </div>
              )}

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
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "margin" && (
                <div className={styles.drillDown}>
                  {renderMarginDualWaterfall()}
                </div>
              )}

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
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "cac" && (
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
            </div>

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
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "ltv" && (
                <div className={styles.drillDown}>
                  {renderLtvCohortChart()}
                </div>
              )}

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
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "repeat" && (
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
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "aov" && (
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
            </div>

            {/* ── Row 3: Program Performance ───────────────────── */}
            <div className={styles.overviewRowLabel}>
              {t("row3.title", "Program Performance")}
            </div>
            <div className={styles.overviewGrid}>
              <KpiCard
                primary={
                  stats?.leaderboard?.length
                    ? t("card.topAffiliates", "Top affiliates")
                    : "--"
                }
                label={t("card.leaderboard", "Leaderboard")}
                secondary={
                  stats?.leaderboard?.length
                    ? `${t("card.top", "#1")}: ${stats.leaderboard[0]?.affiliateName ?? "--"}`
                    : ""
                }
                drillKey="leaderboard"
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "leaderboard" && (
                <div className={styles.drillDown}>
                  {renderLeaderboardTable()}
                </div>
              )}

              <KpiCard
                primary={
                  stats?.productMix?.length
                    ? t("card.topProducts", "Top products")
                    : "--"
                }
                label={t("card.productMix", "Product mix")}
                secondary={
                  stats?.productMix?.length
                    ? `${t("card.top", "#1")}: ${stats.productMix[0]?.title ?? "--"}`
                    : ""
                }
                drillKey="products"
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "products" && (
                <div className={styles.drillDown}>
                  {renderProductMix()}
                </div>
              )}

              <KpiCard
                primary={
                  stats?.roas
                    ? `${stats.roas.affiliateROAS.toFixed(2)} ROAS`
                    : "--"
                }
                label={t("card.roas", "Commission efficiency")}
                secondary={
                  stats?.roas
                    ? `${t("card.revenue", "Revenue")}: ${fmtCurrency(stats.roas.totalRevenue)} / ${t("card.cost", "Cost")}: ${fmtCurrency(stats.roas.totalCost)}`
                    : ""
                }
                delta={stats?.roas?.delta}
                drillKey="roas"
                activeDrill={activeDrill}
                isLoading={isLoading}
                onClick={handleDrillClick}
              />
              {activeDrill === "roas" && (
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
            </div>
          </>
        )}

        {/* ── Empty state: stepped onboarding (overview only) ──── */}
        {activeTab === "overview" && !hasData && syncStatus !== "running" && (
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
              <div
                className={`${styles.onboardingStep}${csvDragActive ? ` ${styles.onboardingStepDrag}` : ""}`}
                onDragOver={handleCsvDragOver}
                onDragEnter={handleCsvDragOver}
                onDragLeave={handleCsvDragLeave}
                onDrop={handleCsvDrop}
              >
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <div className={styles.onboardingStepInner}>
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
                    : csvFileName
                      ? t("empty.step1Ready", "File selected")
                      : t("empty.step1Title", "Import affiliates")}
                </div>

                {/* State A — profiles already imported (success) */}
                {profiles.length > 0 && (
                  <>
                    <div className={styles.onboardingStepBody}>
                      <s-badge tone="success">
                        {t("empty.step1BodyDone", {
                          count: profiles.length,
                          defaultValue: "{{count}} affiliates imported",
                        })}
                      </s-badge>
                    </div>
                    <div className={styles.onboardingStepAction}>
                      <s-button
                        variant="secondary"
                        onClick={handleCsvDropZoneClick}
                      >
                        {t("empty.step1ActionDone", "Re-import CSV")}
                      </s-button>
                    </div>
                  </>
                )}

                {/* State B — file loaded, ready to import */}
                {profiles.length === 0 && csvFileName && (
                  <>
                    <div className={styles.onboardingStepBody}>
                      <div className={styles.fileStateCard}>
                        <div className={styles.fileStateIcon}>
                          <svg
                            viewBox="0 0 20 20"
                            width="20"
                            height="20"
                            aria-hidden="true"
                            fill="currentColor"
                          >
                            <path d="M4 2a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7.414a2 2 0 00-.586-1.414l-3.414-3.414A2 2 0 0012.586 2H4zm8 1.5V7a1 1 0 001 1h3.5L12 3.5z" />
                          </svg>
                        </div>
                        <div className={styles.fileStateName}>{csvFileName}</div>
                      </div>
                    </div>
                    <div className={styles.onboardingStepAction}>
                      <s-button
                        variant="secondary"
                        onClick={() => {
                          setCsvFileName("");
                          setCsvText("");
                        }}
                      >
                        {t("empty.step1Remove", "Remove")}
                      </s-button>
                      {fetcher.state === "submitting" ? (
                        <s-button
                          variant="primary"
                          disabled
                          key="import-submitting"
                        >
                          {t("empty.step1Importing", "Importing...")}
                        </s-button>
                      ) : (
                        <s-button
                          variant="primary"
                          onClick={handleCsvImport}
                          key="import-ready"
                        >
                          {t("empty.step1ActionImport", "Import")}
                        </s-button>
                      )}
                    </div>
                  </>
                )}

                {/* State C — idle (no file, no profiles) */}
                {profiles.length === 0 && !csvFileName && (
                  <>
                    <div className={styles.onboardingStepBody}>
                      {csvDragActive
                        ? t("empty.step1BodyDrag", "Drop your CSV file here")
                        : t(
                            "empty.step1Body",
                            "Drag and drop your BixGrow CSV export, or click to browse.",
                          )}
                    </div>
                    <div className={styles.onboardingStepAction}>
                      <s-button
                        variant="primary"
                        onClick={handleCsvDropZoneClick}
                      >
                        {t("empty.step1Action", "Select file")}
                      </s-button>
                    </div>
                  </>
                )}

                {/* Error banner — import failed */}
                {importResult && importResult.errors.length > 0 && (
                  <s-banner tone="critical">
                    {importResult.errors.join(", ")}
                  </s-banner>
                )}
                  </div>
                </s-box>
              </div>

              {/* Step 2 — Sync */}
              <div
                className={
                  profiles.length === 0
                    ? `${styles.onboardingStep} ${styles.onboardingStepDisabled}`
                    : styles.onboardingStep
                }
              >
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <div className={styles.onboardingStepInner}>
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
                </s-box>
              </div>
            </div>
          </div>
        )}

        {/* ── Affiliates tab header strip ─────────────────────── */}
        {activeTab === "profiles" && !profileDetailCode && (
          <>
            <div className={styles.overviewStrip}>
              <div className={styles.overviewStripHeader}>
                <h2 className={styles.overviewStripHeading}>
                  {t("profiles.heading", "Affiliate ranking")}
                </h2>
                {activeRangeFriendly && (
                  periodPreset === "custom" && !customCalendarOpen ? (
                    <button
                      type="button"
                      className={`${styles.periodFriendly} ${styles.periodFriendlyEditable}`}
                      onClick={handleEditCustomDates}
                      title={t("period.edit", "Change dates")}
                    >
                      {activeRangeFriendly}
                    </button>
                  ) : (
                    <span className={styles.periodFriendly}>{activeRangeFriendly}</span>
                  )
                )}
              </div>
              <div className={styles.overviewStripSubtitle}>
                {t("profiles.subtitle", {
                  count: profiles.length,
                  defaultValue: "Total affiliates: {{count}}",
                })}
              </div>
            </div>
            {hasData && renderPeriodControls(false)}
            {hasData && renderCustomCalendar()}
          </>
        )}

        {/* ── Profiles tab: detail view for a single affiliate ── */}
        {activeTab === "profiles" && profileDetailCode && activeDateRange && (
          <ProfileDetail
            code={profileDetailCode}
            startDate={activeDateRange.start}
            endDate={activeDateRange.end}
            compStart={
              getComparisonDates(
                comparisonMode,
                activeDateRange.start,
                activeDateRange.end,
              )?.compStart ?? null
            }
            compEnd={
              getComparisonDates(
                comparisonMode,
                activeDateRange.start,
                activeDateRange.end,
              )?.compEnd ?? null
            }
            userLocale={userLocale}
            onBack={() => setProfileDetailCode(null)}
            fmtCurrency={fmtCurrency}
            fmtNum={fmtNum}
            fmtPct={fmtPct}
            t={t}
          />
        )}

        {/* ── Profiles tab: enhanced list with quartile bands ── */}
        {activeTab === "profiles" && !profileDetailCode && profiles.length > 0 && (
          <ProfilesList
            leaderboard={stats?.leaderboard ?? []}
            profiles={sanitizedProfiles}
            onRowClick={setProfileDetailCode}
            fmtCurrency={fmtCurrency}
            fmtNum={fmtNum}
            fmtPct={fmtPct}
            t={t}
          />
        )}

        {activeTab === "profiles" && !profileDetailCode && profiles.length === 0 && (
          <div className={styles.noData}>
            <s-text>
              {t("profiles.emptyMessage", "No affiliate profiles yet. Import a BixGrow CSV to get started.")}
            </s-text>
          </div>
        )}

        {/* ── Attribution queue tab ── */}
        {activeTab === "attribution" && attributionMeta && (
          <AttributionQueue
            shop={shop}
            meta={attributionMeta}
            userLocale={userLocale}
            t={t}
            initialSnapshot={
              // Hydrate from the cached cron/manual snapshot so the tab paints
              // instantly. The Refresh button replaces this with a fresh live
              // snapshot.
              attributionSnapshot
                ? ({
                    fetchedAt: attributionSnapshot.fetchedAt,
                    lookbackDays: attributionSnapshot.lookbackDays,
                    sinceDate:
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (attributionSnapshot.stats as any)?.sinceDate ?? "",
                    scannedCount: attributionSnapshot.scannedCount,
                    matchedCount:
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (attributionSnapshot.stats as any)?.matchedCount ?? 0,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    rows: attributionSnapshot.rows as any,
                    stats: {
                      pending: attributionSnapshot.pendingCount,
                      claimed: attributionSnapshot.claimedCount,
                      unknown: attributionSnapshot.unknownCount,
                    },
                  })
                : null
            }
          />
        )}
      </s-section>

      {/* Hidden file input — triggered by buttons and drop zones */}
      <input
        ref={csvFileInputRef}
        type="file"
        accept=".csv"
        onChange={handleCsvFileChange}
        className={styles.hiddenFileInput}
      />
    </s-page>
  );
}
