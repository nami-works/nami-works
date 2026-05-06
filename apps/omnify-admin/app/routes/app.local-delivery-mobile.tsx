import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useLoaderData, useRevalidator, useSubmit } from "react-router";
import { formatCustomerShort } from "../utils/format-name";
import styles from "./app.local-delivery-mobile/styles.module.css";

// ═══════════════════════════════════════════════════════════════════
// Re-export loader + action + headers from the desktop route so the
// mobile route reuses the exact same server behavior. The 9,847-line
// desktop file is the single source of truth — no server duplication.
// ═══════════════════════════════════════════════════════════════════
export { loader, action, headers } from "./app.local-delivery";

// ═══════════════════════════════════════════════════════════════════
// Local helpers duplicated from desktop (~40 lines). Keeps the desktop
// file untouched; a future session can extract these to a shared util.
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_LOCATION_ID = "all";
const DEFAULT_DELIVERY_PROMISE_DAYS = 1;
const MOBILE_REDIRECT_BREAKPOINT = 768;
const MOBILE_POLL_INTERVAL_MS = 15_000;

const mapLalamoveStatusToInternal = (status: string): string => {
  const normalized = status.trim().toUpperCase();
  switch (normalized) {
    case "ASSIGNING_DRIVER": return "assigning";
    case "ON_GOING": return "heading_to_pickup";
    case "PICKED_UP": return "in_progress";
    case "COMPLETED": return "delivered";
    case "CANCELED": return "failed";
    case "REJECTED": return "rejected";
    case "EXPIRED": return "expired";
    default: return "requested";
  }
};

const TERMINAL_DISPATCH_STATUSES = new Set(["failed", "rejected", "expired", "delivered"]);

const toLegacyLocationId = (gid: string) => {
  if (!gid) return "";
  if (!gid.startsWith("gid://")) return gid;
  const parts = gid.split("/");
  return parts[parts.length - 1] || "";
};

const STATUS_CLASS_MAP: Record<string, string> = {
  pending: styles.statusPending,
  quoted: styles.statusQuoted,
  requested: styles.statusRequested,
  assigning: styles.statusAssigning,
  heading_to_pickup: styles.statusHeadingToPickup,
  in_progress: styles.statusInProgress,
  delivered: styles.statusDelivered,
  failed: styles.statusFailed,
  rejected: styles.statusRejected,
  expired: styles.statusExpired,
};

const ROUTE_BADGE_PALETTE = [
  { bg: "#f0f4ff", text: "#1e3a8a", border: "#c6dbff" },
  { bg: "#f0f9ff", text: "#0b5270", border: "#a9d6ea" },
  { bg: "#f4f0ff", text: "#4c1d95", border: "#d6c6f2" },
  { bg: "#fff4e2", text: "#915407", border: "#f4d9a4" },
  { bg: "#e8f4ed", text: "#067647", border: "#a5d6b8" },
  { bg: "#fdecea", text: "#9e0c00", border: "#f2b6a3" },
];

const badgeStyleForIndex = (index: number) => {
  const tone = ROUTE_BADGE_PALETTE[index % ROUTE_BADGE_PALETTE.length]!;
  return {
    backgroundColor: tone.bg,
    color: tone.text,
    border: `1px solid ${tone.border}`,
  };
};

const formatKm = (meters: number | undefined) => {
  if (meters == null || !Number.isFinite(meters)) return "—";
  return `${(meters / 1000).toFixed(1)}`;
};

const formatMinutes = (seconds: number | undefined) => {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  return `${Math.round(seconds / 60)}`;
};

const formatExpiresAt = (iso: string | undefined) => {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

// ═══════════════════════════════════════════════════════════════════
// Types — mirrored from desktop loader return (must stay in sync)
// ═══════════════════════════════════════════════════════════════════

type MobileLoaderData = {
  orders: Array<{
    id: string;
    name: string;
    processedAt: string | null;
    customerName: string | null;
    total: string;
    shippingCost: { amount: number; currencyCode: string } | null;
    shippingSummary: string | null;
    address1: string | null;
    address2: string | null;
    adminOrderUrl: string;
    addressValidation: { isValid: boolean; errors?: string[] };
    shippingCoordinates: { latitude: number; longitude: number } | null;
    fulfillmentLocation: {
      id: string;
      name: string;
      coordinates: { latitude: number; longitude: number } | null;
    };
    tags: string[];
  }>;
  locations: Array<{
    id: string;
    name: string;
    addressSummary: string;
    coordinates: { latitude: number; longitude: number } | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    countryCode: string | null;
  }>;
  filters: {
    locationId: string;
    startDate: string;
    deliveryPromiseDays: number;
    selectedPresaleTags: string[];
  };
  mapsApiKey: string;
  mapsMapId: string;
  precomputedRoutes: Array<{
    id: string;
    locationId: string;
    polyline: string;
    color: string;
    orderIds: string[];
    totalDistanceMeters?: number;
    totalDurationSeconds?: number;
  }>;
  routeStats: Array<{
    orders?: Array<{ orderId: string }>;
    totalDistanceMeters?: number;
    totalDurationSeconds?: number;
  }>;
  lalamoveConfigs: Record<string, { market: string; city: string }>;
  credentialStatus?: { configured: boolean; reason?: string };
  pendingRoutes: Array<{ id: string }>;
  returnPickupRequests: Array<{ id: string }>;
  shop: string;
  userLocale: string;
  failedDeliveryCount: number;
  activeDispatchData: Array<{
    routeId: string;
    shareLink?: string;
    status?: string;
    lalamoveOrderId?: string;
    market?: string;
  }>;
  ordersError?: string;
};

type OrderRow = MobileLoaderData["orders"][number];
type LoaderLocation = MobileLoaderData["locations"][number];
type RouteRow = {
  id: string;
  locationId: string;
  polyline: string;
  color: string;
  orderIds: string[];
  totalDistanceMeters?: number;
  totalDurationSeconds?: number;
};

type DispatchedRecord = {
  shareLink?: string;
  status?: string;
  lalamoveOrderId?: string;
  market?: string;
};

type QuotePreview = {
  routeId: string;
  quotationId: string;
  expiresAt: string;
  total?: string;
  currency?: string;
  stopIds: string[];
  orderIds: string[];
  deliveryAssignments: Array<{ stopId: string; orderId: string }>;
  locationId: string;
};

type SheetState =
  | { kind: "none" }
  | { kind: "locationPicker" }
  | { kind: "datePicker" }
  | { kind: "promisePicker" }
  | { kind: "overflow" }
  | { kind: "order"; orderId: string }
  | { kind: "route"; routeId: string; routeIndex: number }
  | { kind: "quoteConfirm"; routeId: string; routeIndex: number }
  | { kind: "cancelConfirm"; routeId: string }
  | { kind: "clearRouteConfirm"; routeId: string; routeIndex: number }
  | { kind: "clearAllConfirm" }
  | { kind: "errorDetails"; routeId: string; message: string; errorDetails: string }
  | { kind: "addressErrors" };

// ═══════════════════════════════════════════════════════════════════
// Polyline decoder (Google Maps encoded polyline algorithm)
// Used to render route lines on the map panel. Matches google.maps.geometry.encoding.decodePath.
// ═══════════════════════════════════════════════════════════════════
const decodePolyline = (encoded: string): Array<{ lat: number; lng: number }> => {
  if (!encoded) return [];
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += dlng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
};

// ═══════════════════════════════════════════════════════════════════
// Map loader — dedup concurrent requests, match desktop behavior
// ═══════════════════════════════════════════════════════════════════
let mapsLoaderPromise: Promise<void> | null = null;
// Google Maps JS API is not strictly typed here — we use the global loaded at
// runtime via the script tag. `any` is pragmatic for the SDK surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoogleMapsGlobal = any;

const loadGoogleMaps = (apiKey: string): Promise<void> => {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const gw = (window as unknown as { google?: GoogleMapsGlobal }).google;
  if (gw?.maps?.Map) return Promise.resolve();
  if (mapsLoaderPromise) return mapsLoaderPromise;
  mapsLoaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps-loader="mobile"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Maps load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&v=weekly&libraries=marker,geometry`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = "mobile";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Maps load failed"));
    document.head.appendChild(script);
  });
  return mapsLoaderPromise;
};

// ═══════════════════════════════════════════════════════════════════
// BottomSheet primitive
// ═══════════════════════════════════════════════════════════════════
function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className={styles.sheetBackdrop}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className={styles.sheet} role="dialog" aria-modal="true">
        <div className={styles.sheetHandle} aria-hidden="true" />
        {children}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════
export default function MobileIndex() {
  const {
    orders,
    locations,
    filters,
    mapsApiKey,
    precomputedRoutes,
    lalamoveConfigs,
    returnPickupRequests,
    userLocale,
    activeDispatchData,
    ordersError,
  } = useLoaderData<MobileLoaderData>();

  const { t } = useTranslation("local-delivery");
  const submit = useSubmit();
  const revalidator = useRevalidator();

  // ── Redirect-back-to-desktop escape hatch ──
  // If mobile route is loaded with ?desktop=1 AND the viewport is wide, hop
  // back to the desktop URL (preserving all other params). If ?desktop=1 is
  // set but the viewport is narrow, stay and show a banner.
  const [willRedirectToDesktop, setWillRedirectToDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("desktop") !== "1") return;
    if (window.innerWidth < MOBILE_REDIRECT_BREAKPOINT) return;
    setWillRedirectToDesktop(true);
    const next = new URL(window.location.href);
    next.pathname = next.pathname.replace(
      /\/app\/local-delivery-mobile/,
      "/app/local-delivery",
    );
    window.location.replace(next.toString());
  }, []);

  // ── Wide-viewport banner: show when page is rendered at >=768 but user
  // hasn't explicitly asked for desktop. No auto-redirect — only a nudge. ──
  const [showWideViewportBanner, setShowWideViewportBanner] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const hasDesktopParam = params.get("desktop") === "1";
    if (hasDesktopParam) return; // unreadable-at-this-width banner handled separately
    const check = () => setShowWideViewportBanner(window.innerWidth >= MOBILE_REDIRECT_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Filters ──
  const [locationId, setLocationId] = useState(filters.locationId);
  const [startDate, setStartDate] = useState(filters.startDate);
  const [deliveryPromiseDays, setDeliveryPromiseDays] = useState(
    filters.deliveryPromiseDays ?? DEFAULT_DELIVERY_PROMISE_DAYS,
  );

  useEffect(() => {
    setLocationId(filters.locationId);
    setStartDate(filters.startDate);
    setDeliveryPromiseDays(filters.deliveryPromiseDays);
  }, [filters.locationId, filters.startDate, filters.deliveryPromiseDays]);

  const applyFilter = useCallback(
    (partial: { locationId?: string; startDate?: string; deliveryPromiseDays?: number }) => {
      const payload: Record<string, string> = {
        locationId: partial.locationId ?? locationId,
        startDate: partial.startDate ?? startDate,
        deliveryPromiseDays: String(partial.deliveryPromiseDays ?? deliveryPromiseDays),
      };
      submit(payload, { method: "get", replace: true });
    },
    [locationId, startDate, deliveryPromiseDays, submit],
  );

  // ── Fetchers ──
  const optimizeFetcher = useFetcher();
  const lalamoveFetcher = useFetcher();
  const cancelFetcher = useFetcher();
  const trackingFetcher = useFetcher();
  const clearFetcher = useFetcher();

  // ── Derived: indexed data ──
  const ordersById = useMemo(() => {
    const map = new Map<string, OrderRow>();
    orders.forEach((order) => map.set(order.id, order));
    return map;
  }, [orders]);

  const locationsById = useMemo(() => {
    const map = new Map<string, LoaderLocation>();
    locations.forEach((loc) => map.set(loc.id, loc));
    return map;
  }, [locations]);

  const locationLabel = useMemo(() => {
    if (locationId === DEFAULT_LOCATION_ID) return t("filters.allLocations");
    return locationsById.get(locationId)?.name ?? t("filters.allLocations");
  }, [locationId, locationsById, t]);

  // ── Routes state (simplified from desktop) ──
  const [editableRoutes, setEditableRoutes] = useState<RouteRow[]>(() =>
    precomputedRoutes.map((route) => ({ ...route, orderIds: route.orderIds ?? [] })),
  );

  // Rehydrate routes when loader data changes (location change, polling).
  useEffect(() => {
    setEditableRoutes(precomputedRoutes.map((route) => ({ ...route, orderIds: route.orderIds ?? [] })));
  }, [precomputedRoutes]);

  // ── Dispatched routes (hydrated from activeDispatchData) ──
  const [dispatchedRoutes, setDispatchedRoutes] = useState<Record<string, DispatchedRecord>>(() => {
    const initial: Record<string, DispatchedRecord> = {};
    (activeDispatchData ?? []).forEach((d) => {
      initial[d.routeId] = {
        shareLink: d.shareLink ?? undefined,
        status: d.status ?? undefined,
        lalamoveOrderId: d.lalamoveOrderId ?? undefined,
        market: d.market ?? undefined,
      };
    });
    return initial;
  });

  useEffect(() => {
    setDispatchedRoutes((prev) => {
      const loaderRouteIds = new Set((activeDispatchData ?? []).map((d) => d.routeId));
      const next: Record<string, DispatchedRecord> = {};
      for (const d of activeDispatchData ?? []) {
        next[d.routeId] = {
          ...prev[d.routeId],
          status: d.status ?? prev[d.routeId]?.status,
          shareLink: d.shareLink ?? prev[d.routeId]?.shareLink,
          lalamoveOrderId: d.lalamoveOrderId ?? prev[d.routeId]?.lalamoveOrderId,
          market: d.market ?? prev[d.routeId]?.market,
        };
      }
      for (const [routeId, entry] of Object.entries(prev)) {
        if (!loaderRouteIds.has(routeId) && entry.status === "requested") {
          next[routeId] = entry;
        }
      }
      return next;
    });
  }, [activeDispatchData]);

  // ── Lalamove status (per-route transient message) ──
  const [lalamoveBusyRouteId, setLalamoveBusyRouteId] = useState<string | null>(null);
  const [routeQuoteTotals, setRouteQuoteTotals] = useState<Record<string, { total: string; currency?: string }>>({});
  const [quotePreview, setQuotePreview] = useState<QuotePreview | null>(null);
  const [lastError, setLastError] = useState<{ routeId: string; message: string; errorDetails: string } | null>(null);

  // Auto-clear quote when expiration passes
  useEffect(() => {
    if (!quotePreview?.expiresAt) return;
    const expiresMs = new Date(quotePreview.expiresAt).getTime() - Date.now();
    if (expiresMs <= 0) {
      setQuotePreview(null);
      return;
    }
    const id = window.setTimeout(() => setQuotePreview(null), expiresMs);
    return () => window.clearTimeout(id);
  }, [quotePreview?.expiresAt]);

  // ── Optimize progress ──
  const [optimizeProgress, setOptimizeProgress] = useState<{
    phase: string;
    pct: number;
    startedAt: number;
    estimatedMs: number;
  } | null>(null);
  const [optimizeMessage, setOptimizeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!optimizeProgress) return;
    const { startedAt, estimatedMs } = optimizeProgress;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const rawPct = Math.min(95, (elapsed / estimatedMs) * 100);
      let phase: string;
      if (rawPct < 5) phase = t("mobile.phases.buildingMatrix");
      else if (rawPct < 10) phase = t("mobile.phases.computingRoutes");
      else if (rawPct < 40) phase = t("mobile.phases.quoting");
      else phase = t("mobile.phases.finalizing");
      setOptimizeProgress((prev) => (prev ? { ...prev, phase, pct: rawPct } : prev));
    };
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [optimizeProgress?.startedAt, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Optimize response handler
  useEffect(() => {
    if (optimizeFetcher.state !== "idle" || !optimizeFetcher.data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = optimizeFetcher.data as any;
    if ("error" in data && data.error) {
      setOptimizeProgress(null);
      setOptimizeMessage(typeof data.error === "string" ? data.error : "Optimization failed");
      return;
    }
    if (!("optimizedRoutes" in data)) {
      setOptimizeProgress(null);
      return;
    }
    const optimized = data.optimizedRoutes as Array<{
      routeIndex: number;
      locationId: string;
      orderIds: string[];
      polyline: string;
      totalDistanceMeters?: number;
      totalDurationSeconds?: number;
      costTotal?: string;
      costCurrency?: string;
    }>;
    setEditableRoutes((current) =>
      current.map((route, index) => {
        const match = optimized.find((item) => item.routeIndex === index);
        if (!match) return { ...route, orderIds: [] };
        return {
          ...route,
          locationId: match.locationId,
          orderIds: match.orderIds,
          polyline: match.polyline,
          totalDistanceMeters: match.totalDistanceMeters,
          totalDurationSeconds: match.totalDurationSeconds,
        };
      }),
    );
    const summary = data.summary as { routeCount?: number; costTotal?: string; costCurrency?: string } | undefined;
    setOptimizeMessage(
      summary?.routeCount
        ? t("routeManager.optimizeApplied", { count: summary.routeCount })
        : null,
    );
    // Populate per-route quote totals from optimizer (if carrier-quotation mode)
    const perRouteCosts = optimized as Array<{
      routeIndex: number;
      locationId: string;
      costTotal?: string;
      costCurrency?: string;
    }>;
    setRouteQuoteTotals((prev) => {
      const next = { ...prev };
      perRouteCosts.forEach((r) => {
        if (r.costTotal != null) {
          const routeId = `${r.locationId}-${r.routeIndex}`;
          next[routeId] = { total: r.costTotal, currency: r.costCurrency };
        }
      });
      return next;
    });
    setOptimizeProgress(null);
  }, [optimizeFetcher.data, optimizeFetcher.state, t]);

  // ── Lalamove quote/dispatch response handler ──
  useEffect(() => {
    if (lalamoveFetcher.state !== "idle" || !lalamoveFetcher.data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = lalamoveFetcher.data as any;
    setLalamoveBusyRouteId(null);

    if ("error" in data && data.error) {
      const routeId = data.routeId as string | undefined;
      const errorDetails =
        typeof data.error === "string" ? data.error : JSON.stringify(data.error, null, 2);
      if (routeId) {
        setLastError({
          routeId,
          message: t("driverRequest.requestFailed"),
          errorDetails,
        });
        setSheet({ kind: "errorDetails", routeId, message: t("driverRequest.requestFailed"), errorDetails });
      }
      return;
    }

    if ("quotation" in data && data.routeId) {
      const routeId = data.routeId as string;
      const quote = data.quotation as {
        quotationId: string;
        expiresAt: string;
        priceBreakdown?: { total?: string; currency?: string };
        stops?: Array<{ stopId?: string }>;
      };
      if (!quote) return;
      const total = quote.priceBreakdown?.total;
      const currency = quote.priceBreakdown?.currency;
      if (total != null) {
        setRouteQuoteTotals((prev) => ({
          ...prev,
          [routeId]: { total, currency },
        }));
      }
      const routeIndex = editableRoutes.findIndex((r) => r.id === routeId);
      setQuotePreview({
        routeId,
        quotationId: quote.quotationId,
        expiresAt: quote.expiresAt,
        total,
        currency,
        stopIds: (quote.stops ?? []).map((s) => s.stopId).filter(Boolean) as string[],
        orderIds: (data.orderIds as string[]) ?? [],
        deliveryAssignments: (data.deliveryAssignments as Array<{ stopId: string; orderId: string }>) ?? [],
        locationId: (data.locationId as string) ?? "",
      });
      // Auto-open quote-confirm sheet
      if (routeIndex >= 0) {
        setSheet({ kind: "quoteConfirm", routeId, routeIndex });
      }
      return;
    }

    if ("placedOrderId" in data && data.routeId) {
      const routeId = data.routeId as string;
      setDispatchedRoutes((prev) => ({
        ...prev,
        [routeId]: {
          shareLink: data.shareLink ?? undefined,
          status: "requested",
          lalamoveOrderId: data.placedOrderId ?? undefined,
          market: data.market ?? undefined,
        },
      }));
      setQuotePreview(null);
      setSheet({ kind: "none" });
      // Revalidate so the route card reflects the new dispatch status next render
      revalidator.revalidate();
    }
  }, [lalamoveFetcher.data, lalamoveFetcher.state, editableRoutes, t, revalidator]);

  // ── Cancel response handler ──
  useEffect(() => {
    if (cancelFetcher.state !== "idle" || !cancelFetcher.data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = cancelFetcher.data as any;
    const data = "data" in raw && raw.data ? raw.data : raw;
    const routeId = data?.routeId as string | undefined;
    if (!routeId) return;
    setLalamoveBusyRouteId(null);
    if (data.ok) {
      setDispatchedRoutes((prev) => {
        const next = { ...prev };
        delete next[routeId];
        return next;
      });
      revalidator.revalidate();
    } else {
      const errorDetails = data.error ?? "Cancel failed";
      setLastError({ routeId, message: t("driverRequest.cancelFailed"), errorDetails });
    }
  }, [cancelFetcher.data, cancelFetcher.state, t, revalidator]);

  // ── Tracking poll: every 15s when a dispatched route is non-terminal ──
  const hasActiveDispatches = useMemo(() => {
    return Object.values(dispatchedRoutes).some((d) => {
      const internal = d.status ? mapLalamoveStatusToInternal(d.status) : (d.status ?? "");
      const normalized = d.status && d.status.toUpperCase() === d.status ? internal : d.status ?? "";
      return normalized && !TERMINAL_DISPATCH_STATUSES.has(normalized);
    });
  }, [dispatchedRoutes]);

  useEffect(() => {
    if (!hasActiveDispatches) return;
    const revalidate = () => {
      if (document.visibilityState !== "visible") return;
      revalidator.revalidate();
    };
    const interval = window.setInterval(revalidate, MOBILE_POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasActiveDispatches, revalidator]);

  // ── UI state ──
  const [sheet, setSheet] = useState<SheetState>({ kind: "none" });
  const [routesExpanded, setRoutesExpanded] = useState(true);
  const [unassignedExpanded, setUnassignedExpanded] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

  // ── Derived: routes with orders ──
  const activeRoutes = useMemo(() => editableRoutes.filter((r) => r.orderIds.length > 0), [editableRoutes]);
  const assignedOrderIds = useMemo(() => {
    const set = new Set<string>();
    activeRoutes.forEach((r) => r.orderIds.forEach((id) => set.add(id)));
    return set;
  }, [activeRoutes]);
  const unassignedOrders = useMemo(
    () => orders.filter((o) => !assignedOrderIds.has(o.id)),
    [orders, assignedOrderIds],
  );
  const addressErrorOrders = useMemo(
    () => orders.filter((o) => !o.addressValidation?.isValid),
    [orders],
  );

  const hasSpecificLocation = locationId !== DEFAULT_LOCATION_ID;
  const lalamoveConfigured =
    hasSpecificLocation &&
    Boolean(lalamoveConfigs[toLegacyLocationId(locationId)] || lalamoveConfigs[locationId]);

  const canOptimize =
    hasSpecificLocation &&
    unassignedOrders.some(
      (o) =>
        o.fulfillmentLocation.id === locationId &&
        o.shippingCoordinates != null &&
        o.fulfillmentLocation.coordinates != null,
    );

  // ── Action handlers ──
  const handleOptimize = useCallback(() => {
    if (!hasSpecificLocation) return;
    const candidates = unassignedOrders
      .filter((o) => o.fulfillmentLocation.id === locationId)
      .filter((o) => Boolean(o.shippingCoordinates) && Boolean(o.fulfillmentLocation.coordinates))
      .map((o) => ({
        orderId: o.id,
        locationId: o.fulfillmentLocation.id,
        shippingCoordinates: o.shippingCoordinates!,
        locationCoordinates: o.fulfillmentLocation.coordinates!,
        mustAssign: false,
        processedAt: o.processedAt ?? null,
      }));
    if (candidates.length === 0) return;
    setOptimizeProgress({
      phase: t("mobile.phases.buildingMatrix"),
      pct: 0,
      startedAt: Date.now(),
      estimatedMs: Math.max(8000, candidates.length * 1600),
    });
    setOptimizeMessage(null);
    const formData = new FormData();
    formData.append("intent", "optimize-fleet");
    formData.append("ordersPayload", JSON.stringify(candidates));
    optimizeFetcher.submit(formData, { method: "post" });
  }, [hasSpecificLocation, unassignedOrders, locationId, t, optimizeFetcher]);

  const handleRequestQuote = useCallback(
    (route: RouteRow) => {
      if (!lalamoveConfigured) return;
      const formData = new FormData();
      formData.append("intent", "lalamove-quote");
      formData.append("routeId", route.id);
      formData.append("locationId", route.locationId);
      route.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
      setLalamoveBusyRouteId(route.id);
      lalamoveFetcher.submit(formData, { method: "post" });
    },
    [lalamoveConfigured, lalamoveFetcher],
  );

  const handlePlaceOrder = useCallback(
    () => {
      if (!quotePreview) return;
      const formData = new FormData();
      formData.append("intent", "lalamove-place-order");
      formData.append("routeId", quotePreview.routeId);
      formData.append("locationId", quotePreview.locationId);
      formData.append("quotationId", quotePreview.quotationId);
      formData.append("quotationTotal", quotePreview.total ?? "");
      formData.append("quotationCurrency", quotePreview.currency ?? "");
      quotePreview.stopIds.forEach((id) => formData.append("stopIds", id));
      quotePreview.orderIds.forEach((id) => formData.append("orderIds", id));
      formData.append("deliveryAssignments", JSON.stringify(quotePreview.deliveryAssignments));
      // Route tag is derived server-side when `routeTag` is absent — mobile
      // leaves it off (desktop passes it when it has the tag definition handy).
      setLalamoveBusyRouteId(quotePreview.routeId);
      lalamoveFetcher.submit(formData, { method: "post" });
    },
    [quotePreview, lalamoveFetcher],
  );

  const handleCancelDelivery = useCallback(
    (routeId: string) => {
      const formData = new FormData();
      formData.append("intent", "lalamove-cancel-order");
      formData.append("routeId", routeId);
      setLalamoveBusyRouteId(routeId);
      cancelFetcher.submit(formData, { method: "post" });
      setSheet({ kind: "none" });
    },
    [cancelFetcher],
  );

  const handleClearRoute = useCallback(
    (routeId: string) => {
      const route = editableRoutes.find((r) => r.id === routeId);
      if (!route || route.orderIds.length === 0) return;
      // Clear route client-side + tell server to unassign-all for this route's orders
      const formData = new FormData();
      formData.append("intent", "unassign-all");
      formData.append("locationId", route.locationId);
      route.orderIds.forEach((id) => formData.append("orderIds", id));
      setEditableRoutes((current) =>
        current.map((r) => (r.id === routeId ? { ...r, orderIds: [] } : r)),
      );
      setRouteQuoteTotals((prev) => {
        const next = { ...prev };
        delete next[routeId];
        return next;
      });
      clearFetcher.submit(formData, { method: "post" });
      setSheet({ kind: "none" });
    },
    [editableRoutes, clearFetcher],
  );

  const handleClearAllRoutes = useCallback(() => {
    const allIds = editableRoutes.flatMap((r) => r.orderIds);
    if (allIds.length === 0) return;
    const locationIdForSubmit =
      locationId !== DEFAULT_LOCATION_ID ? locationId : editableRoutes[0]?.locationId ?? "all";
    const formData = new FormData();
    formData.append("intent", "unassign-all");
    formData.append("locationId", locationIdForSubmit);
    allIds.forEach((id) => formData.append("orderIds", id));
    setEditableRoutes((current) => current.map((r) => ({ ...r, orderIds: [] })));
    setRouteQuoteTotals({});
    clearFetcher.submit(formData, { method: "post" });
    setSheet({ kind: "none" });
  }, [editableRoutes, locationId, clearFetcher]);

  const handleOpenTracking = useCallback(
    (routeId: string) => {
      const dispatch = dispatchedRoutes[routeId];
      if (dispatch?.shareLink) {
        window.open(dispatch.shareLink, "_blank");
        return;
      }
      if (!dispatch?.lalamoveOrderId || !dispatch?.market) return;
      const formData = new FormData();
      formData.append("intent", "lalamove-reconcile-status");
      formData.append("lalamoveOrderId", dispatch.lalamoveOrderId);
      formData.append("market", dispatch.market);
      trackingFetcher.submit(formData, { method: "post" });
    },
    [dispatchedRoutes, trackingFetcher],
  );

  // Trigger tracking fetcher → open shareLink on success
  useEffect(() => {
    if (trackingFetcher.state !== "idle" || !trackingFetcher.data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = trackingFetcher.data as any;
    if (!data?.ok || !data?.details?.shareLink) return;
    window.open(data.details.shareLink, "_blank");
  }, [trackingFetcher.data, trackingFetcher.state]);

  // ── Map rendering ──
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  // Google Maps objects are loaded at runtime and not typed at compile time.
  // `any` matches the untyped SDK surface used here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapOverlaysRef = useRef<any[]>([]);

  useEffect(() => {
    if (!mapExpanded) return;
    if (!mapsApiKey || !mapContainerRef.current) return;
    let cancelled = false;
    loadGoogleMaps(mapsApiKey)
      .then(() => {
        if (cancelled || !mapContainerRef.current) return;
        const gw = (window as unknown as { google?: GoogleMapsGlobal }).google;
        if (!gw?.maps) return;
        if (!mapInstanceRef.current) {
          mapInstanceRef.current = new gw.maps.Map(mapContainerRef.current, {
            center: { lat: -23.5505, lng: -46.6333 },
            zoom: 12,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "greedy",
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
        }
      })
      .catch((err) => {
        console.warn("[local-delivery-mobile] map load failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [mapExpanded, mapsApiKey]);

  // Render markers + polylines
  useEffect(() => {
    if (!mapExpanded) return;
    const gw = (window as unknown as { google?: GoogleMapsGlobal }).google;
    const map = mapInstanceRef.current;
    if (!gw?.maps || !map) return;

    // Clear previous overlays
    mapOverlaysRef.current.forEach((overlay) => {
      try {
        if (overlay?.setMap) overlay.setMap(null);
      } catch {
        // Ignore overlay cleanup failures — overlay may already be detached.
      }
    });
    mapOverlaysRef.current = [];

    const bounds = new gw.maps.LatLngBounds();
    let boundsTouched = false;

    // Location pin(s)
    const activeLocationId = hasSpecificLocation ? locationId : null;
    const locationsToPin = activeLocationId
      ? locations.filter((l) => l.id === activeLocationId)
      : locations;
    locationsToPin.forEach((loc) => {
      if (!loc.coordinates) return;
      const marker = new gw.maps.Marker({
        position: { lat: loc.coordinates.latitude, lng: loc.coordinates.longitude },
        map,
        icon: {
          path: gw.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: 5,
          fillColor: "#1a1a1a",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      mapOverlaysRef.current.push(marker);
      bounds.extend(marker.getPosition()!);
      boundsTouched = true;
    });

    // Route polylines + order markers
    activeRoutes.forEach((route, index) => {
      const palette = ROUTE_BADGE_PALETTE[index % ROUTE_BADGE_PALETTE.length]!;
      const path = decodePolyline(route.polyline);
      if (path.length > 1) {
        const polyline = new gw.maps.Polyline({
          path,
          strokeColor: palette.text,
          strokeOpacity: 0.85,
          strokeWeight: 3,
          map,
        });
        mapOverlaysRef.current.push(polyline);
      }
      route.orderIds.forEach((orderId) => {
        const order = ordersById.get(orderId);
        if (!order?.shippingCoordinates) return;
        const position = {
          lat: order.shippingCoordinates.latitude,
          lng: order.shippingCoordinates.longitude,
        };
        const marker = new gw.maps.Marker({
          position,
          map,
          icon: {
            path: gw.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: palette.text,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });
        marker.addListener("click", () => {
          setSheet({ kind: "order", orderId });
        });
        mapOverlaysRef.current.push(marker);
        bounds.extend(marker.getPosition()!);
        boundsTouched = true;
      });
    });

    // Unassigned order markers (gray)
    unassignedOrders.forEach((order) => {
      if (!order.shippingCoordinates) return;
      const marker = new gw.maps.Marker({
        position: {
          lat: order.shippingCoordinates.latitude,
          lng: order.shippingCoordinates.longitude,
        },
        map,
        icon: {
          path: gw.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: order.addressValidation?.isValid ? "#c9cccf" : "#d72c0d",
          fillOpacity: 0.85,
          strokeColor: "#ffffff",
          strokeWeight: 1.5,
        },
      });
      marker.addListener("click", () => {
        setSheet({ kind: "order", orderId: order.id });
      });
      mapOverlaysRef.current.push(marker);
      bounds.extend(marker.getPosition()!);
      boundsTouched = true;
    });

    if (boundsTouched) {
      map.fitBounds(bounds, 40);
    }
  }, [mapExpanded, activeRoutes, unassignedOrders, locations, locationId, hasSpecificLocation, ordersById]);

  // ── Status badges ──
  const getRouteStatusKey = (routeId: string): string => {
    const dispatch = dispatchedRoutes[routeId];
    if (dispatch?.status) {
      const internal =
        dispatch.status.toUpperCase() === dispatch.status
          ? mapLalamoveStatusToInternal(dispatch.status)
          : dispatch.status;
      return internal;
    }
    if (routeQuoteTotals[routeId]) return "quoted";
    return "pending";
  };

  const totalPinCount = useMemo(() => {
    const assigned = activeRoutes.reduce((sum, r) => sum + r.orderIds.length, 0);
    return assigned + unassignedOrders.length;
  }, [activeRoutes, unassignedOrders]);

  // ── Early returns ──
  if (willRedirectToDesktop) {
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════
  return (
    <s-page>
      <div className={styles.page}>
        {/* Desktop banners */}
        {showWideViewportBanner ? (
          <div className={styles.desktopBanner}>
            <span>{t("mobile.desktopBanner")}</span>
            <a
              href={(() => {
                const params = new URLSearchParams(
                  typeof window !== "undefined" ? window.location.search : "",
                );
                params.set("desktop", "1");
                return `/app/local-delivery?${params.toString()}`;
              })()}
            >
              {t("mobile.desktopBannerSwitch")} →
            </a>
          </div>
        ) : null}

        {typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("desktop") === "1" &&
        window.innerWidth < MOBILE_REDIRECT_BREAKPOINT ? (
          <div className={styles.desktopBanner}>
            <span>{t("mobile.desktopBannerUnreadable")}</span>
            <a
              href={(() => {
                const params = new URLSearchParams(window.location.search);
                return `/app/local-delivery?${params.toString()}`;
              })()}
            >
              {t("mobile.desktopBannerOpenAnyway")} →
            </a>
          </div>
        ) : null}

        {/* Sticky top chrome */}
        <div className={styles.stickyTop}>
          <div className={styles.pageHeading}>
            <h1 className={styles.pageTitle}>{t("pageHeading")}</h1>
            <button
              type="button"
              className={styles.overflowBtn}
              onClick={() => setSheet({ kind: "overflow" })}
              aria-label="More"
            >
              ⋯
            </button>
          </div>
          <button
            type="button"
            className={styles.locationChip}
            onClick={() => setSheet({ kind: "locationPicker" })}
          >
            <span className={styles.locationPin} aria-hidden="true">📍</span>
            {locationLabel}
          </button>
        </div>

        {/* Filter chips row */}
        <div className={styles.filtersRow}>
          <button type="button" className={styles.chip} onClick={() => setSheet({ kind: "datePicker" })}>
            {startDate}
          </button>
          <button type="button" className={styles.chip} onClick={() => setSheet({ kind: "promisePicker" })}>
            {deliveryPromiseDays === 0
              ? t("mobile.sheet.sameDay")
              : deliveryPromiseDays === 1
                ? t("mobile.sheet.nextDay")
                : deliveryPromiseDays === 2
                  ? t("mobile.sheet.dayPlus2")
                  : deliveryPromiseDays === 3
                    ? t("mobile.sheet.dayPlus3")
                    : t("mobile.sheet.dayPlus4")}
          </button>
        </div>

        {/* Status strip */}
        <div className={styles.statusStrip}>
          <span>
            <strong>{activeRoutes.length}</strong> routes
          </span>
          <span className={styles.sep}>·</span>
          <span>
            <strong>{unassignedOrders.length}</strong> pending
          </span>
          {addressErrorOrders.length > 0 ? (
            <>
              <span className={styles.sep}>·</span>
              <span className={styles.errStrong}>
                {t("mobile.statusStripAddrErrors", { count: addressErrorOrders.length })}
              </span>
            </>
          ) : null}
        </div>

        {/* Ordersaccess warning */}
        {ordersError ? (
          <div className={`${styles.banner} ${styles.bannerError}`}>{ordersError}</div>
        ) : null}

        {/* Optimize CTA */}
        {!hasSpecificLocation ? (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            {t("mobile.pickLocationFirst")}
          </div>
        ) : (
          <div className={styles.optimizeCta}>
            {optimizeProgress ? (
              <>
                <div className={styles.optimizeCtaHeading}>
                  {t("mobile.optimizeCta.optimizing", { count: unassignedOrders.length })}
                </div>
                <div className={styles.optimizeProgressWrap}>
                  <div className={styles.optimizeProgressBar}>
                    <div
                      className={styles.optimizeProgressFill}
                      style={{ width: `${Math.max(5, optimizeProgress.pct)}%` }}
                    />
                  </div>
                  <div className={styles.optimizeProgressLabel}>
                    <span>{optimizeProgress.phase}</span>
                    <span>{Math.round(optimizeProgress.pct)}%</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={styles.optimizeCtaHeading}>
                  {t("mobile.optimizeCta.heading", { count: unassignedOrders.length })}
                </div>
                <div className={styles.optimizeCtaBody}>{t("mobile.optimizeCta.body")}</div>
                {canOptimize ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary} ${styles.btnFull}`}
                    onClick={handleOptimize}
                    disabled={optimizeFetcher.state !== "idle"}
                  >
                    {t("mobile.optimizeCta.button")}
                  </button>
                ) : (
                  <div className={styles.optimizeCtaDisabledHint}>
                    {unassignedOrders.length === 0
                      ? t("routeManager.noUnassigned")
                      : t("mobile.noCoordsForOptimize")}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {optimizeMessage ? (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>{optimizeMessage}</div>
        ) : null}

        {/* Routes section */}
        <button
          type="button"
          className={`${styles.collapsibleHeader} ${
            routesExpanded ? styles.collapsibleExpanded : ""
          }`}
          onClick={() => setRoutesExpanded((prev) => !prev)}
          aria-expanded={routesExpanded}
        >
          <span>
            {t("mobile.routesHeading")}
            <span className={styles.collapsibleHeaderCount}>({activeRoutes.length})</span>
          </span>
          <span className={styles.collapsibleChevron}>▸</span>
        </button>

        {routesExpanded ? (
          activeRoutes.length === 0 ? (
            <div className={styles.emptyState}>
              {hasSpecificLocation
                ? t("routeManager.noRoutes")
                : t("mobile.pickLocationFirst")}
            </div>
          ) : (
            <div className={styles.routeList}>
              {activeRoutes.map((route, index) => (
                <MobileRouteCard
                  key={route.id}
                  route={route}
                  index={index}
                  statusKey={getRouteStatusKey(route.id)}
                  dispatch={dispatchedRoutes[route.id]}
                  quote={routeQuoteTotals[route.id]}
                  busy={lalamoveBusyRouteId === route.id}
                  optimizeFetcherState={optimizeFetcher.state}
                  lalamoveFetcherState={lalamoveFetcher.state}
                  locationName={locationsById.get(route.locationId)?.name ?? ""}
                  onRequestQuote={() => handleRequestQuote(route)}
                  onRequestDriver={() => handleRequestQuote(route)}
                  onOpenQuoteSheet={() =>
                    setSheet({ kind: "quoteConfirm", routeId: route.id, routeIndex: index })
                  }
                  onOpenDetails={() =>
                    setSheet({ kind: "route", routeId: route.id, routeIndex: index })
                  }
                  onOpenTracking={() => handleOpenTracking(route.id)}
                  onCancelDelivery={() =>
                    setSheet({ kind: "cancelConfirm", routeId: route.id })
                  }
                  onClearRoute={() =>
                    setSheet({ kind: "clearRouteConfirm", routeId: route.id, routeIndex: index })
                  }
                  onViewError={() => {
                    if (lastError && lastError.routeId === route.id) {
                      setSheet({
                        kind: "errorDetails",
                        routeId: route.id,
                        message: lastError.message,
                        errorDetails: lastError.errorDetails,
                      });
                    }
                  }}
                  hasError={lastError?.routeId === route.id}
                  lalamoveConfigured={lalamoveConfigured}
                  t={t}
                />
              ))}
              {activeRoutes.length > 1 ? (
                <div className={styles.routeActions}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnCritical} ${styles.btnSm}`}
                    onClick={() => setSheet({ kind: "clearAllConfirm" })}
                  >
                    {t("routeManager.clearAllRoutes")}
                  </button>
                </div>
              ) : null}
            </div>
          )
        ) : null}

        {/* Unassigned orders section */}
        <button
          type="button"
          className={`${styles.collapsibleHeader} ${
            unassignedExpanded ? styles.collapsibleExpanded : ""
          }`}
          onClick={() => setUnassignedExpanded((prev) => !prev)}
          aria-expanded={unassignedExpanded}
        >
          <span>
            {t("mobile.unassignedSection")}
            <span className={styles.collapsibleHeaderCount}>({unassignedOrders.length})</span>
          </span>
          <span className={styles.collapsibleChevron}>▸</span>
        </button>

        {unassignedExpanded ? (
          unassignedOrders.length === 0 ? (
            <div className={styles.emptyState}>{t("mobile.unassignedEmpty")}</div>
          ) : (
            <div className={styles.ordersList}>
              {unassignedOrders.map((order) => (
                <MobileOrderCard
                  key={order.id}
                  order={order}
                  onClick={() => setSheet({ kind: "order", orderId: order.id })}
                  t={t}
                />
              ))}
            </div>
          )
        ) : null}

        {/* Map section */}
        <button
          type="button"
          className={`${styles.collapsibleHeader} ${
            mapExpanded ? styles.collapsibleExpanded : ""
          }`}
          onClick={() => setMapExpanded((prev) => !prev)}
          aria-expanded={mapExpanded}
        >
          <span>
            {mapExpanded ? t("mobile.hideMap") : t("mobile.showMap")}
            <span className={styles.collapsibleHeaderCount}>
              ({t("mobile.mapPins", { routes: activeRoutes.length, pins: totalPinCount })})
            </span>
          </span>
          <span className={styles.collapsibleChevron}>▸</span>
        </button>

        {mapExpanded ? (
          !mapsApiKey ? (
            <div className={styles.mapPanelEmpty}>{t("mobile.bannerMapsMissing")}</div>
          ) : totalPinCount === 0 ? (
            <div className={styles.mapPanelEmpty}>{t("mobile.mapEmpty")}</div>
          ) : (
            <div className={styles.mapPanel} ref={mapContainerRef} />
          )
        ) : null}

        {/* Chip section */}
        <div className={styles.chipSection}>
          {addressErrorOrders.length > 0 ? (
            <>
              <div className={styles.chipSectionHeading}>{t("mobile.triage")}</div>
              <button
                type="button"
                className={`${styles.triageChip} ${styles.triageChipActionable}`}
                onClick={() => setSheet({ kind: "addressErrors" })}
              >
                <span className={styles.triageLabel}>
                  <span className={styles.triageIcon}>⚠</span>
                  {t("mobile.triageChip.addressErrors", { count: addressErrorOrders.length })}
                </span>
                <span className={styles.chipArrow}>→</span>
              </button>
            </>
          ) : null}

          <div className={styles.chipSectionHeading}>{t("mobile.desktopOnlyHeading")}</div>
          {returnPickupRequests.length > 0 ? (
            <a
              className={`${styles.triageChip} ${styles.triageChipDesktopOnly}`}
              href="/app/local-delivery?desktop=1"
              style={{ textDecoration: "none" }}
            >
              <span className={styles.triageLabel}>
                <span className={styles.triageIcon}>↩</span>
                {t("mobile.triageChip.returnPickups", { count: returnPickupRequests.length })}
              </span>
              <span className={styles.chipArrow}>{t("mobile.triageChip.openOnDesktop")}</span>
            </a>
          ) : null}
          <a
            className={`${styles.triageChip} ${styles.triageChipDesktopOnly}`}
            href="/app/local-delivery?desktop=1"
            style={{ textDecoration: "none" }}
          >
            <span className={styles.triageLabel}>
              <span className={styles.triageIcon}>🎯</span>
              {t("mobile.triageChip.specialRequests")}
            </span>
            <span className={styles.chipArrow}>{t("mobile.triageChip.openOnDesktop")}</span>
          </a>
          <a
            className={`${styles.triageChip} ${styles.triageChipDesktopOnly}`}
            href="/app/local-delivery?desktop=1"
            style={{ textDecoration: "none" }}
          >
            <span className={styles.triageLabel}>
              <span className={styles.triageIcon}>🗺</span>
              {t("mobile.triageChip.mapStyle")}
            </span>
            <span className={styles.chipArrow}>{t("mobile.triageChip.openOnDesktop")}</span>
          </a>
          <a
            className={`${styles.triageChip} ${styles.triageChipDesktopOnly}`}
            href="/app/settings?desktop=1"
            style={{ textDecoration: "none" }}
          >
            <span className={styles.triageLabel}>
              <span className={styles.triageIcon}>⚙</span>
              {t("mobile.triageChip.lalamoveSettings")}
            </span>
            <span className={styles.chipArrow}>{t("mobile.triageChip.openOnDesktop")}</span>
          </a>
        </div>

        {/* ═════════════════════════════════════════════
            Bottom sheets (one primitive, many instances)
            ═════════════════════════════════════════════ */}

        {/* Location picker */}
        <BottomSheet
          open={sheet.kind === "locationPicker"}
          onClose={() => setSheet({ kind: "none" })}
        >
          <h2 className={styles.sheetHeading}>{t("mobile.pickLocation")}</h2>
          <div className={styles.sheetOverflowList}>
            <button
              type="button"
              className={`${styles.sheetOptionRow} ${
                locationId === DEFAULT_LOCATION_ID ? styles.sheetOptionRowActive : ""
              }`}
              onClick={() => {
                setLocationId(DEFAULT_LOCATION_ID);
                applyFilter({ locationId: DEFAULT_LOCATION_ID });
                setSheet({ kind: "none" });
              }}
            >
              <span>{t("filters.allLocations")}</span>
              {locationId === DEFAULT_LOCATION_ID ? (
                <span className={styles.sheetOptionCheckmark}>✓</span>
              ) : null}
            </button>
            {locations.map((loc) => (
              <button
                key={loc.id}
                type="button"
                className={`${styles.sheetOptionRow} ${
                  locationId === loc.id ? styles.sheetOptionRowActive : ""
                }`}
                onClick={() => {
                  setLocationId(loc.id);
                  applyFilter({ locationId: loc.id });
                  setSheet({ kind: "none" });
                }}
              >
                <span>{loc.name}</span>
                {locationId === loc.id ? (
                  <span className={styles.sheetOptionCheckmark}>✓</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className={styles.sheetActionRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={() => setSheet({ kind: "none" })}
            >
              {t("mobile.sheet.close")}
            </button>
          </div>
        </BottomSheet>

        {/* Date picker — native input */}
        <BottomSheet
          open={sheet.kind === "datePicker"}
          onClose={() => setSheet({ kind: "none" })}
        >
          <h2 className={styles.sheetHeading}>{t("mobile.pickDate")}</h2>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.currentTarget.value)}
            style={{
              fontSize: 15,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #c9cccf",
              width: "100%",
              marginTop: 8,
              fontFamily: "inherit",
            }}
          />
          <div className={styles.sheetActionRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={() => setSheet({ kind: "none" })}
            >
              {t("mobile.sheet.close")}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
              onClick={() => {
                applyFilter({ startDate });
                setSheet({ kind: "none" });
              }}
            >
              {t("modals.tagFilter.confirm")}
            </button>
          </div>
        </BottomSheet>

        {/* Delivery promise picker */}
        <BottomSheet
          open={sheet.kind === "promisePicker"}
          onClose={() => setSheet({ kind: "none" })}
        >
          <h2 className={styles.sheetHeading}>{t("filters.deliveryPromise")}</h2>
          <div className={styles.sheetOverflowList}>
            {[
              { v: 0, k: "mobile.sheet.sameDay" },
              { v: 1, k: "mobile.sheet.nextDay" },
              { v: 2, k: "mobile.sheet.dayPlus2" },
              { v: 3, k: "mobile.sheet.dayPlus3" },
              { v: 4, k: "mobile.sheet.dayPlus4" },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                className={`${styles.sheetOptionRow} ${
                  deliveryPromiseDays === opt.v ? styles.sheetOptionRowActive : ""
                }`}
                onClick={() => {
                  setDeliveryPromiseDays(opt.v);
                  applyFilter({ deliveryPromiseDays: opt.v });
                  setSheet({ kind: "none" });
                }}
              >
                <span>{t(opt.k)}</span>
                {deliveryPromiseDays === opt.v ? (
                  <span className={styles.sheetOptionCheckmark}>✓</span>
                ) : null}
              </button>
            ))}
          </div>
        </BottomSheet>

        {/* Overflow menu */}
        <BottomSheet
          open={sheet.kind === "overflow"}
          onClose={() => setSheet({ kind: "none" })}
        >
          <h2 className={styles.sheetHeading}>{t("routeManager.actions")}</h2>
          <div className={styles.sheetOverflowList}>
            <a
              className={styles.sheetOptionRow}
              href={(() => {
                const params =
                  typeof window !== "undefined"
                    ? new URLSearchParams(window.location.search)
                    : new URLSearchParams();
                params.set("desktop", "1");
                return `/app/local-delivery?${params.toString()}`;
              })()}
              style={{ textDecoration: "none" }}
            >
              <span>{t("mobile.sheet.viewDesktop")}</span>
              <span>↗</span>
            </a>
            <button
              type="button"
              className={styles.sheetOptionRow}
              onClick={() => {
                revalidator.revalidate();
                setSheet({ kind: "none" });
              }}
            >
              <span>{t("mobile.sheet.refresh")}</span>
              <span>↻</span>
            </button>
          </div>
          <div className={styles.sheetActionRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={() => setSheet({ kind: "none" })}
            >
              {t("mobile.sheet.close")}
            </button>
          </div>
        </BottomSheet>

        {/* Order details */}
        {sheet.kind === "order"
          ? (() => {
              const order = ordersById.get(sheet.orderId);
              if (!order) return null;
              const fullName = order.customerName
                ? formatCustomerShort(order.customerName, userLocale)
                : t("customer.guest");
              const addressLine1 = order.address1 ?? t("mobile.addressErrorsSheet.noAddress");
              return (
                <BottomSheet open onClose={() => setSheet({ kind: "none" })}>
                  <h2 className={styles.sheetHeading}>
                    {t("mobile.orderDetails.heading", {
                      name: order.name,
                      customer: fullName,
                    })}
                  </h2>
                  <div className={styles.sheetDivider} />
                  <div className={styles.sheetBody}>
                    <strong>{t("mobile.orderDetails.address")}</strong>
                    <br />
                    {addressLine1}
                    {order.address2 ? (
                      <>
                        <br />
                        {order.address2}
                      </>
                    ) : null}
                  </div>
                  <div className={styles.sheetStatLine}>
                    <span className="label">{t("mobile.orderDetails.fulfillment")}</span>
                    <span className="val">{order.fulfillmentLocation.name}</span>
                  </div>
                  <div className={styles.sheetStatLine}>
                    <span className="label">{t("mobile.orderDetails.total")}</span>
                    <span className="val">{order.total}</span>
                  </div>
                  {order.tags && order.tags.length > 0 ? (
                    <div className={styles.sheetStatLine}>
                      <span className="label">{t("mobile.orderDetails.tags")}</span>
                      <span className="val">{order.tags.join(", ")}</span>
                    </div>
                  ) : null}
                  <div className={styles.sheetActionRow}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                      onClick={() => setSheet({ kind: "none" })}
                    >
                      {t("mobile.sheet.close")}
                    </button>
                    <a
                      href={order.adminOrderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                      style={{ textDecoration: "none" }}
                    >
                      {t("mobile.sheet.openInShopify")}
                    </a>
                  </div>
                </BottomSheet>
              );
            })()
          : null}

        {/* Route details */}
        {sheet.kind === "route"
          ? (() => {
              const route = editableRoutes[sheet.routeIndex];
              if (!route) return null;
              const routeOrders = route.orderIds
                .map((id) => ordersById.get(id))
                .filter(Boolean) as OrderRow[];
              const dispatch = dispatchedRoutes[route.id];
              const quote = routeQuoteTotals[route.id];
              return (
                <BottomSheet open onClose={() => setSheet({ kind: "none" })}>
                  <h2 className={styles.sheetHeading}>
                    {t("mobile.routeDetails.heading", {
                      number: String(sheet.routeIndex + 1).padStart(2, "0"),
                      location: locationsById.get(route.locationId)?.name ?? "",
                    })}
                  </h2>
                  <div className={styles.sheetStatLine}>
                    <span className="label">{t("mobile.routeDetails.stops")}</span>
                    <span className="val">{routeOrders.length}</span>
                  </div>
                  <div className={styles.sheetStatLine}>
                    <span className="label">{t("mobile.routeDetails.distance")}</span>
                    <span className="val">{formatKm(route.totalDistanceMeters)} km</span>
                  </div>
                  <div className={styles.sheetStatLine}>
                    <span className="label">{t("mobile.routeDetails.duration")}</span>
                    <span className="val">~{formatMinutes(route.totalDurationSeconds)} min</span>
                  </div>
                  {quote ? (
                    <div className={styles.sheetStatLine}>
                      <span className="label">{t("mobile.routeDetails.cost")}</span>
                      <span className="val">
                        {quote.currency ? `${quote.currency} ` : ""}
                        {quote.total}
                      </span>
                    </div>
                  ) : null}
                  {dispatch?.lalamoveOrderId ? (
                    <div className={styles.sheetStatLine}>
                      <span className="label">{t("mobile.routeDetails.lalamoveOrder")}</span>
                      <span className="val">{dispatch.lalamoveOrderId.slice(0, 10)}…</span>
                    </div>
                  ) : null}
                  <div className={styles.sheetDivider} />
                  <div>
                    {routeOrders.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={styles.sheetListRow}
                        onClick={() => setSheet({ kind: "order", orderId: o.id })}
                        style={{
                          background: "transparent",
                          border: "none",
                          borderBottom: "1px solid #ebebeb",
                          width: "100%",
                          textAlign: "left",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{o.name}</div>
                          <div style={{ color: "#6d7175", fontSize: 11 }}>{o.address1}</div>
                        </div>
                        <span style={{ color: "#005bd3", fontWeight: 600 }}>→</span>
                      </button>
                    ))}
                  </div>
                  <div className={styles.sheetActionRow}>
                    {dispatch?.shareLink ? (
                      <a
                        href={dispatch.shareLink}
                        target="_blank"
                        rel="noreferrer"
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                        style={{ textDecoration: "none" }}
                      >
                        {t("mobile.routeDetails.lalamoveLink")}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                      onClick={() => setSheet({ kind: "none" })}
                    >
                      {t("mobile.sheet.close")}
                    </button>
                  </div>
                </BottomSheet>
              );
            })()
          : null}

        {/* Quote confirm */}
        {sheet.kind === "quoteConfirm" && quotePreview && quotePreview.routeId === sheet.routeId
          ? (() => {
              const route = editableRoutes[sheet.routeIndex];
              if (!route) return null;
              return (
                <BottomSheet open onClose={() => setSheet({ kind: "none" })}>
                  <h2 className={styles.sheetHeading}>
                    {t("mobile.quoteConfirm.heading", {
                      number: String(sheet.routeIndex + 1).padStart(2, "0"),
                    })}
                  </h2>
                  <div className={styles.sheetSubheading}>
                    {t("mobile.quoteConfirm.sub", { stops: quotePreview.orderIds.length })}
                  </div>
                  <div className={styles.sheetBigPrice}>
                    <span className="amount">
                      {quotePreview.currency ? `${quotePreview.currency} ` : ""}
                      {quotePreview.total ?? "—"}
                    </span>
                    <span className="expires">
                      {t("mobile.card.quoteExpiresAt", {
                        time: formatExpiresAt(quotePreview.expiresAt),
                      })}
                    </span>
                  </div>
                  <div className={styles.sheetStatLine}>
                    <span className="label">{t("mobile.quoteConfirm.distance")}</span>
                    <span className="val">{formatKm(route.totalDistanceMeters)} km</span>
                  </div>
                  <div className={styles.sheetStatLine}>
                    <span className="label">{t("mobile.quoteConfirm.duration")}</span>
                    <span className="val">~{formatMinutes(route.totalDurationSeconds)} min</span>
                  </div>
                  <div className={styles.sheetStatLine}>
                    <span className="label">{t("mobile.quoteConfirm.pickup")}</span>
                    <span className="val">{t("mobile.quoteConfirm.pickupAsap")}</span>
                  </div>
                  <div className={styles.sheetDivider} />
                  <div
                    style={{
                      fontSize: 11,
                      color: "#6d7175",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("mobile.quoteConfirm.disclaimer")}
                  </div>
                  <div className={styles.sheetActionRow}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                      onClick={() => setSheet({ kind: "none" })}
                    >
                      {t("mobile.quoteConfirm.cancel")}
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm} ${
                        lalamoveBusyRouteId === sheet.routeId ? styles.btnLoading : ""
                      }`}
                      onClick={() => handlePlaceOrder()}
                      disabled={lalamoveBusyRouteId === sheet.routeId}
                    >
                      {t("mobile.quoteConfirm.requestDriver")}
                    </button>
                  </div>
                </BottomSheet>
              );
            })()
          : null}

        {/* Cancel confirm */}
        {sheet.kind === "cancelConfirm" ? (
          <BottomSheet open onClose={() => setSheet({ kind: "none" })}>
            <h2 className={styles.sheetHeading}>{t("mobile.cancelConfirm.heading")}</h2>
            <div className={styles.sheetBody}>{t("mobile.cancelConfirm.body")}</div>
            <div className={styles.sheetActionRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                onClick={() => setSheet({ kind: "none" })}
              >
                {t("mobile.cancelConfirm.cancel")}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnCritical} ${styles.btnSm}`}
                onClick={() => handleCancelDelivery(sheet.routeId)}
              >
                {t("mobile.cancelConfirm.confirm")}
              </button>
            </div>
          </BottomSheet>
        ) : null}

        {/* Clear route confirm */}
        {sheet.kind === "clearRouteConfirm" ? (
          <BottomSheet open onClose={() => setSheet({ kind: "none" })}>
            <h2 className={styles.sheetHeading}>{t("mobile.clearRouteConfirm.heading")}</h2>
            <div className={styles.sheetBody}>{t("mobile.clearRouteConfirm.body")}</div>
            <div className={styles.sheetActionRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                onClick={() => setSheet({ kind: "none" })}
              >
                {t("mobile.clearRouteConfirm.cancel")}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnCritical} ${styles.btnSm}`}
                onClick={() => handleClearRoute(sheet.routeId)}
              >
                {t("mobile.clearRouteConfirm.confirm")}
              </button>
            </div>
          </BottomSheet>
        ) : null}

        {/* Clear all confirm */}
        {sheet.kind === "clearAllConfirm" ? (
          <BottomSheet open onClose={() => setSheet({ kind: "none" })}>
            <h2 className={styles.sheetHeading}>{t("mobile.clearAllConfirm.heading")}</h2>
            <div className={styles.sheetBody}>{t("mobile.clearAllConfirm.body")}</div>
            <div className={styles.sheetActionRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                onClick={() => setSheet({ kind: "none" })}
              >
                {t("mobile.clearAllConfirm.cancel")}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnCritical} ${styles.btnSm}`}
                onClick={handleClearAllRoutes}
              >
                {t("mobile.clearAllConfirm.confirm")}
              </button>
            </div>
          </BottomSheet>
        ) : null}

        {/* Error details */}
        {sheet.kind === "errorDetails" ? (
          <BottomSheet open onClose={() => setSheet({ kind: "none" })}>
            <h2 className={styles.sheetHeading}>{t("mobile.errorDetails.heading")}</h2>
            <div className={styles.sheetBody}>{sheet.message}</div>
            <div className={styles.sheetErrorDetails}>{sheet.errorDetails}</div>
            <div className={styles.sheetActionRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                onClick={() => setSheet({ kind: "none" })}
              >
                {t("mobile.errorDetails.close")}
              </button>
            </div>
          </BottomSheet>
        ) : null}

        {/* Address errors */}
        {sheet.kind === "addressErrors" ? (
          <BottomSheet open onClose={() => setSheet({ kind: "none" })}>
            <h2 className={styles.sheetHeading}>
              {t("mobile.addressErrorsSheet.heading", { count: addressErrorOrders.length })}
            </h2>
            <div className={styles.sheetSubheading}>{t("mobile.addressErrorsSheet.sub")}</div>
            <div className={styles.sheetDivider} />
            {addressErrorOrders.length === 0 ? (
              <div className={styles.sheetBody}>{t("mobile.addressErrorsSheet.empty")}</div>
            ) : (
              addressErrorOrders.map((o) => (
                <div key={o.id} className={styles.sheetListRow}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>
                      {o.name} · {o.customerName ? formatCustomerShort(o.customerName, userLocale) : t("customer.guest")}
                    </div>
                    <div style={{ color: "#6d7175", fontSize: 11 }}>
                      {o.address1 ?? t("mobile.addressErrorsSheet.noAddress")}
                    </div>
                  </div>
                  <a
                    href={o.adminOrderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.sheetListRowLink}
                  >
                    {t("mobile.sheet.openInShopify")}
                  </a>
                </div>
              ))
            )}
            <div className={styles.sheetActionRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm} ${styles.btnFull}`}
                onClick={() => setSheet({ kind: "none" })}
              >
                {t("mobile.sheet.close")}
              </button>
            </div>
          </BottomSheet>
        ) : null}

      </div>
    </s-page>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MobileRouteCard — renders a single route in all dispatch states
// ═══════════════════════════════════════════════════════════════════
function MobileRouteCard({
  route,
  index,
  statusKey,
  dispatch,
  quote,
  busy,
  optimizeFetcherState,
  lalamoveFetcherState,
  locationName,
  onRequestQuote,
  onOpenQuoteSheet,
  onOpenDetails,
  onOpenTracking,
  onCancelDelivery,
  onClearRoute,
  onViewError,
  hasError,
  lalamoveConfigured,
  t,
}: {
  route: RouteRow;
  index: number;
  statusKey: string;
  dispatch: DispatchedRecord | undefined;
  quote: { total: string; currency?: string } | undefined;
  busy: boolean;
  optimizeFetcherState: string;
  lalamoveFetcherState: string;
  locationName: string;
  onRequestQuote: () => void;
  onRequestDriver: () => void;
  onOpenQuoteSheet: () => void;
  onOpenDetails: () => void;
  onOpenTracking: () => void;
  onCancelDelivery: () => void;
  onClearRoute: () => void;
  onViewError: () => void;
  hasError: boolean;
  lalamoveConfigured: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const isTerminal = TERMINAL_DISPATCH_STATUSES.has(statusKey);
  const isError = hasError || statusKey === "failed" || statusKey === "rejected";
  const isDispatched = Boolean(dispatch?.lalamoveOrderId);
  const isBusyGlobal = lalamoveFetcherState !== "idle" || optimizeFetcherState !== "idle";
  const routeLabel = t("routeManager.route", {
    number: String(index + 1).padStart(2, "0"),
  });

  return (
    <div
      className={`${styles.routeCard} ${isError ? styles.routeCardError : ""} ${
        isTerminal ? styles.routeCardTerminal : ""
      }`}
    >
      <div className={styles.routeCardHeader}>
        <div className={styles.routeBadgeAndLoc}>
          <span className={styles.routeBadge} style={badgeStyleForIndex(index)}>
            {routeLabel}
          </span>
          {locationName ? <span className={styles.routeLocLabel}>{locationName}</span> : null}
        </div>
        <span className={`${styles.statusBadge} ${STATUS_CLASS_MAP[statusKey] ?? styles.statusPending}`}>
          {t(`mobile.card.status${statusKey.charAt(0).toUpperCase()}${statusKey.slice(1).replace(/_(.)/g, (_, c) => c.toUpperCase())}`, { defaultValue: statusKey })}
        </span>
      </div>

      <div className={styles.routeStats}>
        <strong>{t("mobile.card.orderCount", { count: route.orderIds.length })}</strong>
        {" · "}
        {formatKm(route.totalDistanceMeters)} km · ~{formatMinutes(route.totalDurationSeconds)} min
        {quote ? ` · ${quote.currency ? `${quote.currency} ` : ""}${quote.total}` : ""}
      </div>

      {/* Quote banner (pre-dispatch, when quote present) */}
      {statusKey === "quoted" && quote && !isDispatched ? (
        <div className={styles.routeQuoteBanner}>
          <span>
            <strong>
              {quote.currency ? `${quote.currency} ` : ""}
              {quote.total}
            </strong>
          </span>
        </div>
      ) : null}

      {/* Tracking banner (in-flight dispatched) */}
      {isDispatched && !isTerminal && dispatch?.shareLink ? (
        <div className={styles.routeTrackingBanner}>
          {t("mobile.card.tracking")}
          <br />
          <a href={dispatch.shareLink} target="_blank" rel="noreferrer">
            {t("mobile.card.trackingLink")}
          </a>
        </div>
      ) : null}

      {/* Error banner */}
      {isError && !isDispatched ? (
        <div className={styles.routeErrorBanner}>
          <strong>{t("mobile.card.errorHeading")}</strong>
        </div>
      ) : null}

      {/* Actions — state-dependent */}
      <div className={styles.routeActions}>
        {isDispatched && !isTerminal ? (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={onOpenDetails}
            >
              {t("mobile.card.viewDetails")}
            </button>
            {dispatch?.shareLink ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                onClick={onOpenTracking}
              >
                {t("routeManager.trackDelivery")}
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCritical} ${styles.btnSm}`}
              onClick={onCancelDelivery}
              disabled={busy}
            >
              {t("mobile.card.cancelDelivery")}
            </button>
          </>
        ) : isTerminal ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
            onClick={onOpenDetails}
          >
            {t("mobile.card.viewDetails")}
          </button>
        ) : isError ? (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={onViewError}
            >
              {t("mobile.card.viewError")}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCritical} ${styles.btnSm}`}
              onClick={onClearRoute}
            >
              {t("mobile.card.cancelDelivery")}
            </button>
            {lalamoveConfigured ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm} ${
                  busy ? styles.btnLoading : ""
                }`}
                onClick={onRequestQuote}
                disabled={busy || isBusyGlobal}
              >
                {t("mobile.card.retryDriver")}
              </button>
            ) : null}
          </>
        ) : statusKey === "quoted" && quote ? (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={onOpenDetails}
            >
              {t("mobile.card.viewDetails")}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCritical} ${styles.btnSm}`}
              onClick={onClearRoute}
            >
              {t("mobile.card.cancelDelivery")}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm} ${
                busy ? styles.btnLoading : ""
              }`}
              onClick={onOpenQuoteSheet}
              disabled={busy}
            >
              {t("mobile.card.requestDriver")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={onOpenDetails}
            >
              {t("mobile.card.viewOrders")}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCritical} ${styles.btnSm}`}
              onClick={onClearRoute}
              disabled={busy}
            >
              {t("mobile.card.cancelDelivery")}
            </button>
            {lalamoveConfigured ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm} ${
                  busy ? styles.btnLoading : ""
                }`}
                onClick={onRequestQuote}
                disabled={busy || isBusyGlobal}
              >
                {busy ? t("mobile.card.requestingQuote") : t("mobile.card.requestQuote")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MobileOrderCard — single order row (read-only)
// ═══════════════════════════════════════════════════════════════════
function MobileOrderCard({
  order,
  onClick,
  t,
}: {
  order: OrderRow;
  onClick: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const customer = order.customerName
    ? formatCustomerShort(order.customerName, "pt_BR")
    : t("customer.guest");
  const address = order.address1 ?? t("mobile.addressErrorsSheet.noAddress");
  const addressValid = order.addressValidation?.isValid;
  return (
    <button type="button" className={styles.orderCard} onClick={onClick}>
      <div className={styles.orderCardRow}>
        <span className={styles.orderName}>
          {order.name} · {customer}
        </span>
        <span className={styles.orderTotal}>{order.total}</span>
      </div>
      <div className={styles.orderAddress}>{address}</div>
      <div className={styles.orderMeta}>
        {!addressValid ? (
          <span className={styles.orderErr}>⚠ address issue</span>
        ) : null}
      </div>
    </button>
  );
}
