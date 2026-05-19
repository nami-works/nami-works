import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData, useNavigate, useRevalidator, useSearchParams, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  buildLalamoveRecipientRemarks,
  createLalamoveQuotation,
  cancelLalamoveOrder,
  getLalamoveOrderDetails,
  getLalamoveCityInfo,
  LalamoveApiError,
  normalizePhoneForMarket,
  placeLalamoveOrder,
  resolveSpecialRequestsForCity,
  sanitizeLalamoveErrorMessage,
} from "../services/lalamove.server";
import {
  getRuntimeCredentialsForShop,
  hasShopCredentials,
} from "../services/lalamove-credentials.server";
import type { CarrierServiceConfigData } from "../services/carrier/types";
import {
  buildSampleRatesForLocationWithOrders,
  getMaxZoneRadiusKm,
} from "../services/carrier/sample-rate-db.server";
import type { OptimizerOrderInput } from "../services/google-routes-shared.server";
import { LD_ADDRESS_CONFIRM_TAG, LD_FAILED_DELIVERY_TAG, LD_METHOD_OVERRIDE_TAG, LD_NUMBER_CONFIRM_TAG, getAllFailedDeliveryTags } from "../services/lalamove-tags";
import { runCarrierQuotationForOrderId } from "../services/auto-routing.server";
import { type EscalationResult } from "../services/lalamove-escalation.server";
import { resolveConfiguredSpecialRequests } from "../services/lalamove-special-requests.server";
import {
  isPhase1EnabledForLocation,
  runRouteOptimizationPipeline,
  buildPhase1PipelineInput,
  pickMarketKey,
} from "../services/route-optimization/pipeline.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { formatCustomerShort } from "../utils/format-name";
import { computeDueBuckets, type DueBucket } from "./app.local-delivery/due-bucket";
import { LdAnalyticsAside } from "../components/ld-analytics-aside";
import styles from "./app.local-delivery/styles.module.css";
import { markerIconHTML, type MarkerIconKind } from "../utils/map-marker-icons";

const DEFAULT_DELIVERY_METHOD = "local";
const DEFAULT_LOCATION_ID = "all";
// Hardwired window: orders processed in the last N days are considered for delivery routing.
// Was a user-facing filter; per-location settings + auto-delivery now own the relevant timing.
const DEFAULT_START_DATE_DAYS = 90;
const DEFAULT_DELIVERY_PROMISE_DAYS = 1;
const DEFAULT_SAME_DAY_HOUR = 12;
const DEFAULT_SAME_DAY_MINUTE = 0;

// Parses an "HH:mm" string from per-location settings into [hour, minute]. Falls
// back to the default same-day cutoff when the value is missing or malformed.
const parseCutoffTime = (value: string | null | undefined): [number, number] => {
  if (!value) return [DEFAULT_SAME_DAY_HOUR, DEFAULT_SAME_DAY_MINUTE];
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  if (!match) return [DEFAULT_SAME_DAY_HOUR, DEFAULT_SAME_DAY_MINUTE];
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return [DEFAULT_SAME_DAY_HOUR, DEFAULT_SAME_DAY_MINUTE];
  }
  return [hour, minute];
};
const MAP_STYLE_STORAGE_KEY = "omnify.localDelivery.mapStyle";

const toLegacyLocationId = (gid: string) => {
  if (!gid) return "";
  if (!gid.startsWith("gid://")) return gid;
  const parts = gid.split("/");
  return parts[parts.length - 1] || "";
};

const toAdminStoreHandle = (shop: string) => shop.replace(/\.myshopify\.com$/i, "");

const getStartOfDay = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// Detects wait-time special request sub-options by their description (e.g. "Até 30min", "Até 1h")
const WAIT_TIME_PATTERN = /\d+\s*(min|h\b|hora)/i;

// Strips diacritical marks for accent-insensitive city name comparison (e.g. "São Paulo" → "sao paulo")
const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Map Lalamove external status to internal status key (matches webhooks.lalamove.tsx) */
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

/** Map internal status to Polaris badge tone */
type BadgeTone = "info" | "warning" | "success" | "critical" | "auto" | "neutral" | "caution";
const getStatusBadgeTone = (status: string): BadgeTone => {
  switch (status) {
    case "assigning":
    case "heading_to_pickup":
      return "info";
    case "in_progress":
      return "warning";
    case "delivered":
    case "requested":
      return "success";
    case "failed":
    case "rejected":
      return "critical";
    case "expired":
      return "caution";
    default:
      return "info";
  }
};

const TERMINAL_DISPATCH_STATUSES = new Set(["failed", "rejected", "expired", "delivered"]);

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const toStartDateKey = (value: string | null) => {
  if (!value) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() - DEFAULT_START_DATE_DAYS);
    return toDateKey(fallback);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() - DEFAULT_START_DATE_DAYS);
    return toDateKey(fallback);
  }
  return toDateKey(parsed);
};

const toPresaleTags = (value: string | null) => {
  if (!value) return [] as string[];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
};

export default function Index() {
  // ── Viewport redirect to mobile route ──
  // Mobile version lives at /app/local-delivery-mobile. Redirect when the
  // client viewport is <768px AND the user hasn't explicitly asked for the
  // desktop view via ?desktop=1. First render matches SSR (no window, flag
  // stays false); effect below flips the flag on client + triggers the
  // navigation. A `return null` later in the component prevents further
  // renders once the redirect is in flight.
  const [hidingForMobileRedirect, setHidingForMobileRedirect] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 768) return;
    if (new URLSearchParams(window.location.search).has("desktop")) return;
    setHidingForMobileRedirect(true);
    const next = new URL(window.location.href);
    next.pathname = next.pathname.replace(
      /\/app\/local-delivery(?!-mobile)/,
      "/app/local-delivery-mobile",
    );
    window.location.replace(next.toString()); // preserves query params
  }, []);

  const {
    orders,
    locations,
    filters,
    debugLocalDelivery,
    ordersError,
    mapsApiKey,
    mapsMapId,
    routeStats,
    precomputedRoutes,
    lalamoveConfigs,
    credentialStatus,
    returnPickupRequests,
    shop,
    userLocale,
    availablePresaleTags,
    hasUnfulfilledPresaleOrders,
    failedDeliveryCount,
    warehouseOrdersCount,
    warehouseOrdersHiddenCount,
    activeDispatchData,
    optimizerAccuracy,
    pendingPostMortemReviewCount,
  } =
    useLoaderData<typeof loader>();
  const { t } = useTranslation("local-delivery");
  const lalamoveFetcher = useFetcher<typeof action>();
  const lalamoveSettingsFetcher = useFetcher<typeof action>();
  const optimizeFetcher = useFetcher<typeof action>();
  const optimizeLocationRef = useRef("");
  const [optimizeProgress, setOptimizeProgress] = useState<{
    phase: string;
    pct: number;
    startedAt: number;
    estimatedMs: number;
    orderCount: number;
  } | null>(null);
  const assignFetcher = useFetcher();
  const unassignFetcher = useFetcher();
  const updateRoutesFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const trackingFetcher = useFetcher<typeof action>();
  const trackingRouteRef = useRef<string | null>(null);
  const submit = useSubmit();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Warehouse-method override toggle. Reflects `?includeWarehouse=1` in the
  // URL and drives the loader's eligibility filter. Per-location preference
  // persisted in localStorage (key: `ld-include-warehouse:<locationId>`) so
  // switching to another store and back restores the operator's last choice
  // instead of resetting to default. The auto-restore effect below reads the
  // stored value on location change and updates the URL param to match.
  const includeWarehouse = filters.includeWarehouse ?? false;
  const handleToggleIncludeWarehouse = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    const nextValue = !includeWarehouse;
    if (nextValue) {
      next.set("includeWarehouse", "1");
    } else {
      next.delete("includeWarehouse");
    }
    // Persist per-location. Skip for "all locations" (no operator workflow
    // there) and skip silently if localStorage is unavailable.
    if (
      typeof window !== "undefined" &&
      filters.locationId &&
      filters.locationId !== DEFAULT_LOCATION_ID
    ) {
      try {
        window.localStorage.setItem(
          `ld-include-warehouse:${filters.locationId}`,
          nextValue ? "1" : "0",
        );
      } catch {
        // localStorage disabled / quota exceeded — non-fatal
      }
    }
    setSearchParams(next, { preventScrollReset: true });
  }, [includeWarehouse, searchParams, setSearchParams, filters.locationId]);

  // Auto-restore the toggle when locationId changes. Reads the per-location
  // preference from localStorage and rewrites the URL param if the current
  // state doesn't match. Without this, switching from store A (toggle ON) to
  // store B and back to A would reset A's toggle to OFF — and any warehouse
  // orders in A's routes would silently drop out of the dispatch payload.
  // 2026-05-15 incident.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!filters.locationId || filters.locationId === DEFAULT_LOCATION_ID) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(
        `ld-include-warehouse:${filters.locationId}`,
      );
    } catch {
      return;
    }
    if (stored === null) return; // no stored preference yet — leave URL as-is
    const shouldBeOn = stored === "1";
    if (shouldBeOn === includeWarehouse) return;
    const next = new URLSearchParams(searchParams);
    if (shouldBeOn) next.set("includeWarehouse", "1");
    else next.delete("includeWarehouse");
    setSearchParams(next, { preventScrollReset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.locationId]);

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [locationId, setLocationId] = useState(filters.locationId);
  const [selectedPresaleTags, setSelectedPresaleTags] = useState<string[]>(
    filters.selectedPresaleTags,
  );
  const [isPresaleModalOpen, setIsPresaleModalOpen] = useState(false);
  const [draftPresaleTags, setDraftPresaleTags] = useState<string[]>(
    filters.selectedPresaleTags,
  );
  const [isAddressErrorsModalOpen, setIsAddressErrorsModalOpen] = useState(false);
  const [isReturnPickupsModalOpen, setIsReturnPickupsModalOpen] = useState(false);
  // Bulk-dispatch stale-state banner (Item 7). Surfaced when dispatch-all
  // succeeds but the post-dispatch revalidate times out (typically due to
  // shop-ingest:reconcile holding the DB pool). Non-blocking — operator
  // refreshes manually to see latest route state.
  const [dispatchAllStaleBanner, setDispatchAllStaleBanner] = useState<string | null>(null);
  // Polyline edit mode (desktop only). When true:
  //  - polylines render dotted+subdued via google.maps Polyline.setOptions
  //  - per-route Dispatch buttons + destructive menu items are disabled
  //  - bulk actions (Dispatch all / Fetch quotes) are disabled
  // The edit toolbar replaces Edit with Confirm/Cancel buttons. Confirm
  // delegates to handleUpdateRoutes for the recompute (Track 1A: no
  // TRAFFIC_AWARE). Cancel exits edit mode without recomputing. Stop-marker
  // drag-and-drop wiring is deferred to a follow-up — the visual layer +
  // lockout already prevents mid-edit dispatch.
  const [polylineEditMode, setPolylineEditMode] = useState(false);
  // Pre-edit snapshots for the polyline editor's Cancel button. Captured when
  // entering edit mode; restored on Cancel; cleared on Confirm or after a
  // successful Cancel-restore. Only the two pieces the editor mutates are
  // snapshotted (editableRoutes + selectedOrderIds) — not the rest of the
  // page state.
  const preEditRoutesRef = useRef<PrecomputedRoute[] | null>(null);
  const preEditSelectionRef = useRef<Set<string> | null>(null);
  // Banner shown when an attempted reassign would push a route over the
  // 7-orders cap. Non-blocking — operator dismisses + picks a different route.
  const [polylineEditCapBanner, setPolylineEditCapBanner] = useState<string | null>(null);
  const [selectedReturnIds, setSelectedReturnIds] = useState<Set<string>>(() => new Set());
  const [returnInstructions, setReturnInstructions] = useState("");
  const [returnQuotePreview, setReturnQuotePreview] = useState<{
    quotationId: string;
    total: string | null;
    currency: string | null;
    stopIds: string[];
    requestIds: string[];
    locationId: string;
  } | null>(null);
  const returnPickupFetcher = useFetcher<typeof action>();
  const [returnPickupError, setReturnPickupError] = useState<string | null>(null);
  const [isMapStyleModalOpen, setIsMapStyleModalOpen] = useState(false);
  const [editableRoutes, setEditableRoutes] = useState<PrecomputedRoute[]>(() =>
    precomputedRoutes.map((route) => ({ ...route, orderIds: [] })),
  );
  const [dirtyRouteIds, setDirtyRouteIds] = useState<Set<string>>(new Set());
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [activeRouteIndex, setActiveRouteIndex] = useState<number | null>(null);
  const [activeModalType, setActiveModalType] = useState<"manage" | "details" | null>(null);
  const [removeFromRouteOrderIds, setRemoveFromRouteOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [ordersFilter, setOrdersFilter] = useState<
    "all" | "unassigned" | "assigned" | "failed"
  >("all");
  const [ordersSearch, setOrdersSearch] = useState("");
  const ordersSectionRef = useRef<HTMLDivElement | null>(null);
  const [lalamoveBusyRouteId, setLalamoveBusyRouteId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Auto-assign accuracy block is always-expanded (the chevron toggle was
  // removed 2026-05-06 — the metric is small enough that hiding it adds no
  // value).
  // Order details modal state (2026-05-07): clicking an order row in the
  // All-orders table opens an in-page Polaris s-modal instead of navigating
  // to Shopify admin in a new tab. The Shopify deep-link is preserved as
  // the modal footer's left-hand action.
  const [orderDetailsModalOrderId, setOrderDetailsModalOrderId] = useState<
    string | null
  >(null);
  const orderTagFetcher = useFetcher<typeof action>();
  const [settingsLocationId, setSettingsLocationId] = useState<string>("");
  const [lalamoveSettings, setLalamoveSettings] = useState<LalamoveConfig>(() => {
    return (
      lalamoveConfigs[settingsLocationId] ?? {
        market: "",
        city: "",
        language: userLocale,
        preferredServiceType: "LALAGO",
        locationName: "",
        locationPhone: "",
        locationAddress: "",
        locationDetails: "",
        pickupInstructions: "",
      }
    );
  });
  const [lalamoveConfigMap, setLalamoveConfigMap] =
    useState<Record<string, LalamoveConfig>>(lalamoveConfigs);
  const [lalamoveStatus, setLalamoveStatus] = useState<
    Record<string, { message: string; tone?: "success" | "critical"; errorDetails?: string }>
  >({});
  const lalamoveStatusTimeoutsRef = useRef<Record<string, number>>({});
  const lalamoveBusyTimerRef = useRef<number | null>(null);
  // EDIT MODE — 5s idle auto-confirm timer (2026-05-08 unified write flow).
  // Spec: any user-initiated write (Reassign/Unassign/Add-to-route/Clear/
  // Assign-to-new) enters edit mode automatically via the dirty-set watcher.
  // The timer fires 5s after the LAST interaction; on fire, auto-confirm
  // (calls handleUpdateRoutes). Any of these reset the timer:
  //   - marker click (selection toggle)
  //   - map zoom / pan
  //   - All-orders table checkbox toggle
  //   - another write (chains additional changes)
  const editModeIdleTimerRef = useRef<number | null>(null);
  // Per-route in-flight set (optimistic concurrency, follow-up): while
  // a route is mid-commit (handleUpdateRoutes for that routeId), other
  // routes could still be edited; only the in-flight route's action
  // buttons would be gated. Deferred from this branch -- the 5s idle
  // batching means most edits land in a single commit, so the
  // concurrency window is narrow. Wire when a real conflict surfaces.
  // const [inFlightRouteIds, setInFlightRouteIds] = useState<Set<string>>(new Set());
  // Stable ref to the "any interaction in editMode" handler, used by
  // Google Maps listeners (zoom_changed / dragend) which are attached
  // once at map creation. Without a ref the listeners would close over
  // a stale polylineEditMode + resetEditModeIdleTimer; with a ref they
  // always invoke the latest version. Updated each render via useEffect.
  const editInteractionHandlerRef = useRef<() => void>(() => {});
  // Tracks routes where a driver has been successfully requested (hydrated from DB)
  const [dispatchedRoutes, setDispatchedRoutes] = useState<
    Record<string, {
      shareLink?: string;
      status?: string;
      lalamoveOrderId?: string;
      market?: string;
      podBucket?: string | null;
      needsReviewReason?: string | null;
      partialDelivery?: boolean;
      stops?: Array<{
        shopifyOrderId: string;
        orderName: string | null;
        stopOutcome: string | null;
        stopFailureReason: string | null;
      }>;
    }>
  >(() => {
    const initial: Record<string, {
      shareLink?: string;
      status?: string;
      lalamoveOrderId?: string;
      market?: string;
      podBucket?: string | null;
      needsReviewReason?: string | null;
      partialDelivery?: boolean;
      stops?: Array<{
        shopifyOrderId: string;
        orderName: string | null;
        stopOutcome: string | null;
        stopFailureReason: string | null;
      }>;
    }> = {};
    (activeDispatchData ?? []).forEach((d) => {
      initial[d.routeId] = {
        shareLink: d.shareLink ?? undefined,
        status: d.status ?? undefined,
        lalamoveOrderId: d.lalamoveOrderId ?? undefined,
        market: d.market ?? undefined,
        podBucket: d.podBucket ?? null,
        needsReviewReason: d.needsReviewReason ?? null,
        partialDelivery: !!d.partialDelivery,
        stops: d.stops ?? [],
      };
    });
    return initial;
  });
  const [driverErrorModal, setDriverErrorModal] = useState<{
    routeId: string;
    message: string;
    errorDetails: string;
  } | null>(null);
  const [cancelConfirmRouteId, setCancelConfirmRouteId] = useState<string | null>(null);
  const [integrationLogRouteId, setIntegrationLogRouteId] = useState<string | null>(null);
  const [integrationLogEvents, setIntegrationLogEvents] = useState<Array<{
    id: string;
    eventType: string;
    externalStatus: string | null;
    processedAt: string;
    payload: any;
  }>>([]);
  const integrationLogFetcher = useFetcher();
  const cancelFetcher = useFetcher();
  const specialRequestsFetcher = useFetcher<{ ok: boolean; specialRequests?: Array<{ name: string; description: string }> }>();
  const [specialRequestsRoute, setSpecialRequestsRoute] = useState<PrecomputedRoute | null>(null);
  const [availableSpecialRequests, setAvailableSpecialRequests] = useState<Array<{ name: string; description: string }>>([]);
  const [selectedSpecialRequests, setSelectedSpecialRequests] = useState<Set<string>>(new Set());
  const [specialRequestsLoading, setSpecialRequestsLoading] = useState(false);
  const [waitTimeExpanded, setWaitTimeExpanded] = useState(false);
  const [selectedWaitTime, setSelectedWaitTime] = useState<string | null>(null);
  const resetWaitTimeState = () => {
    setWaitTimeExpanded(false);
    setSelectedWaitTime(null);
  };
  // Classify special requests: time-pattern items grouped under wait-time toggle;
  // single time-option falls into standaloneReqs (no need for a group of one)
  const { waitTimeOpts, standaloneReqs } = useMemo(() => {
    const sanitized = availableSpecialRequests.filter((sr) => sr?.name);
    const timeItems = sanitized.filter((sr) => WAIT_TIME_PATTERN.test(sr.description ?? ""));
    const nonTimeItems = sanitized.filter((sr) => !WAIT_TIME_PATTERN.test(sr.description ?? ""));
    // Only group as expandable when there are 2+ sub-options; a lone time-item renders inline
    return timeItems.length > 1
      ? { waitTimeOpts: timeItems, standaloneReqs: nonTimeItems }
      : { waitTimeOpts: [], standaloneReqs: sanitized };
  }, [availableSpecialRequests]);
  const [addressWarnRoute, setAddressWarnRoute] = useState<PrecomputedRoute | null>(null);
  const [addressWarnPendingRecheck, setAddressWarnPendingRecheck] = useState(false);
  const [foreignPhoneWarning, setForeignPhoneWarning] = useState<{
    routeId: string;
    affectedOrders: Array<{
      id: string;
      name: string;
      customerName: string;
      phone: string;
    }>;
  } | null>(null);
  const [addressVerifyRoute, setAddressVerifyRoute] = useState<PrecomputedRoute | null>(null);
  const [addressVerifyEdits, setAddressVerifyEdits] = useState<Record<string, string>>({});
  const addressVerifyRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const addressVerifyAutocompletes = useRef<Record<string, any>>({});
  // Tracks routes that were automatically re-requested at 60 min (routeId → time string)
  const [reorderedRoutes, setReorderedRoutes] = useState<Record<string, string>>({});
  const escalationFetcher = useFetcher<{ ok: boolean; intent: string; results: EscalationResult[] }>();
  const lastFittedLocationIdRef = useRef<string>("");
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const manageRouteMapRef = useRef<HTMLDivElement | null>(null);
  const manageRouteMapInstance = useRef<any>(null);
  const manageRouteMarkersRef = useRef<Array<{ type: "marker" | "advanced"; marker: any }>>(
    [],
  );
  const manageRouteRenderersRef = useRef<any[]>([]);
  const detailsRouteMapRef = useRef<HTMLDivElement | null>(null);
  const detailsRouteMapInstance = useRef<any>(null);
  const detailsRouteMarkersRef = useRef<Array<{ type: "marker" | "advanced"; marker: any }>>(
    [],
  );
  const detailsRouteRenderersRef = useRef<any[]>([]);
  // Diff-based marker registry (2026-05-16). Keyed by `${kind}:${id}` so the
  // map effect can reconcile against the desired set instead of tearing down
  // every marker on every effect run. The previous full-rebuild caused the
  // badges to visibly flicker every time the loader revalidated (e.g. after
  // auto-assign), because each fresh `editableRoutes` / `orders` reference
  // triggered the effect, which called `marker.map = null` followed by
  // `new AdvancedMarkerElement(...)` — the gap between the two is the flash.
  //
  // `signature` is a cheap pre-computed string snapshot of everything the
  // marker's visual depends on; when it matches the prior value we skip the
  // DOM mutation entirely. Listeners are removed + re-added unconditionally
  // (closure values change every render) but listener swaps don't flash.
  const markersRef = useRef<
    Map<
      string,
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- google.maps.marker.AdvancedMarkerElement; SDK types resolved at runtime via importLibrary.
        marker: any;
        wrapper: HTMLElement;
        label: HTMLElement;
        orderLine: HTMLElement;
        iconLine: HTMLElement | null;
        currentIconKind: MarkerIconKind | null;
        listenerHandles: Array<{ remove: () => void }>;
        contextmenuHandler: ((e: Event) => void) | null;
        contextmenuTarget: HTMLElement | null;
        signature: string;
      }
    >
  >(new Map());
  const assignedRouteRenderersRef = useRef<any[]>([]);
  const selectedRouteRenderersRef = useRef<any[]>([]);
  const precomputedRoutePolylinesRef = useRef<any[]>([]);
  const infoWindowRef = useRef<any>(null);
  const lalamoveAddressFieldRef = useRef<HTMLElement | null>(null);
  const lalamoveAddressInputRef = useRef<HTMLInputElement | null>(null);
  const lalamoveAddressAutocompleteRef = useRef<any>(null);
  const lalamoveAddressPlaceListenerRef = useRef<(() => void) | null>(null);
  const lalamoveAddressInputListenerRef = useRef<
    ((event: Event) => void) | null
  >(null);
  const [mapsLoadError, setMapsLoadError] = useState<string | null>(null);
  const [optimizerSummary, setOptimizerSummary] = useState<{
    routeCount: number;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    costTotal?: string;
    costCurrency?: string;
    totalLalamoveCost?: string;
    totalWaitSurcharge?: string;
  } | null>(null);
  // AI optimizer status surfaced by the optimize-fleet action.
  // - `null`              = no recent optimize attempt; nothing to show.
  // - `{ ok: true }`      = AI ran successfully (banner shown only if flags raised).
  // - `{ ok: false }`     = AI couldn't / didn't optimize; banner explains why.
  const [phase1Status, setPhase1Status] = useState<
    | { ok: true; decisionId: string; confidence: number; postMortemFlags: string[] }
    | {
        ok: false;
        reason:
          | "phase1_disabled"
          | "unknown_market"
          | "no_credentials"
          | "low_confidence"
          | "pipeline_error";
        message?: string;
        decisionId?: string;
      }
    | null
  >(null);
  const [isRequestDriverModalOpen, setIsRequestDriverModalOpen] = useState(false);
  const [quotePreview, setQuotePreview] = useState<{
    routeId: string;
    quotationId: string;
    expiresAt: string;
    total?: string;
    currency?: string;
    stopIds: string[];
    orderIds: string[];
    deliveryAssignments: LalamoveDeliveryAssignment[];
    locationId: string;
  } | null>(null);

  // ── Invalidate stale quotes ──
  // Clear quotePreview when the quoted route's orders change (drag-drop,
  // auto-assign, manual assign/unassign — all funnel through editableRoutes).
  useEffect(() => {
    if (!quotePreview) return;
    const route = editableRoutes.find((r) => r.id === quotePreview.routeId);
    if (!route) { setQuotePreview(null); return; }
    const currentIds = new Set(route.orderIds);
    const quotedIds = new Set(quotePreview.orderIds);
    if (currentIds.size !== quotedIds.size || [...currentIds].some((id) => !quotedIds.has(id))) {
      setQuotePreview(null);
    }
  }, [editableRoutes, quotePreview]);

  // Auto-clear quote when Lalamove's expiration time passes.
  useEffect(() => {
    if (!quotePreview?.expiresAt) return;
    const expiresMs = new Date(quotePreview.expiresAt).getTime() - Date.now();
    if (expiresMs <= 0) { setQuotePreview(null); return; }
    const id = setTimeout(() => setQuotePreview(null), expiresMs);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotePreview?.expiresAt]);

  const [routeQuoteTotals, setRouteQuoteTotals] = useState<
    Record<string, { total: string; currency?: string }>
  >({});
  const [mapStyle, setMapStyle] = useState<"dark" | "grayscale" | "light">("dark");
  const [draftMapStyle, setDraftMapStyle] = useState<"dark" | "grayscale" | "light">("dark");
  const [unassignConfirmRoute, setUnassignConfirmRoute] = useState<{
    route: PrecomputedRoute;
    index: number;
  } | null>(null);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  // Exit-confirm modal: opens when the user clicks Exit (✕) while
  // hasChangesPending — guards against accidental loss of pending Reassign /
  // Unassign work. State B (no work pending) bypasses the modal entirely.
  // Spec: inputs/mockups/local-delivery-control-row-v1.html → "Exit
  // confirmation modal" section.
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const autoAssignActiveRef = useRef(false);
  const prevUnassignedCountRef = useRef(0);
  const autoAssignCandidateMapRef = useRef<Map<string, string>>(new Map());
  const settingsHref = "/app/settings";

  const browserTimeZone = useMemo(() => {
    if (typeof Intl === "undefined") return "UTC";
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }, []);
  const locationsById = useMemo(() => {
    const map = new Map<string, LoaderLocation>();
    locations.forEach((location) => {
      map.set(location.id, location);
    });
    return map;
  }, [locations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(MAP_STYLE_STORAGE_KEY);
    if (stored === "dark" || stored === "grayscale" || stored === "light") {
      setMapStyle(stored);
      setDraftMapStyle(stored);
    }
  }, []);

  useEffect(() => {
    setLocationId(filters.locationId);
    setSelectedPresaleTags(filters.selectedPresaleTags);
    setDraftPresaleTags(filters.selectedPresaleTags);
  }, [
    filters.locationId,
    filters.selectedPresaleTags,
  ]);

  useEffect(() => {
    setLalamoveConfigMap(lalamoveConfigs);
  }, [lalamoveConfigs]);

  // Bug 5 fix (2026-05-08): release the lalamove busy lock as soon as the
  // action RESPONSE arrives (data set), not after revalidation completes
  // (state === "idle"). The old gate held the lock through ~15s of loader
  // re-fire, blocking dispatching Route 2 until well after Route 1 had
  // already received "Driver requested" from Lalamove. With this change
  // Route 2 unlocks immediately when the server responds.
  useEffect(() => {
    if (lalamoveFetcher.data || cancelFetcher.data) {
      setLalamoveBusyRouteId(null);
    }
  }, [lalamoveFetcher.data, cancelFetcher.data]);

  // Defensive: also release if both fetchers somehow end up idle (e.g.
  // user navigates back and re-mounts with stale state).
  useEffect(() => {
    if (lalamoveFetcher.state === "idle" && cancelFetcher.state === "idle" && !lalamoveFetcher.data && !cancelFetcher.data) {
      setLalamoveBusyRouteId(null);
    }
  }, [lalamoveFetcher.state, cancelFetcher.state, lalamoveFetcher.data, cancelFetcher.data]);

  // EDIT MODE — dirty-set watcher (2026-05-08).
  // Auto-enters edit mode the FIRST time any route becomes dirty, and
  // (re-)arms the 5s idle timer. Auto-exits when the dirty set drains.
  // Spec: inputs/backlog/local-delivery.md > "EDIT MODE" (Lucas's note
  // 2026-05-08 -- write triggers entry; selection alone does not).
  useEffect(() => {
    const hasDirty = dirtyRouteIds.size > 0;
    if (hasDirty && !polylineEditMode) {
      // First dirty mark -> snapshot + enter edit mode + arm timer.
      enterPolylineEditMode();
      resetEditModeIdleTimer();
    } else if (hasDirty && polylineEditMode) {
      // Already in edit mode + new write chained on top -> just bump
      // the idle timer back to 5s.
      resetEditModeIdleTimer();
    } else if (!hasDirty && polylineEditMode) {
      // Dirty set drained (auto-confirm success OR user reverted all
      // changes manually). Exit edit mode + clear timer.
      clearEditModeIdleTimer();
      setPolylineEditMode(false);
      preEditRoutesRef.current = null;
      preEditSelectionRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyRouteIds, polylineEditMode]);

  // Cleanup the idle timer on unmount.
  useEffect(() => {
    return () => clearEditModeIdleTimer();
  }, []);

  // Bug 3 fix (2026-05-08): when a route becomes dirty, clear its stale
  // encoded polyline string so the polyline-rendering loop skips it
  // (the `if (route.polyline)` guard at the polyline creation site
  // means no polyline is drawn for routes whose `polyline` is empty).
  // Without this, a removed-order's stop still appears on the rendered
  // polyline because the encoded string is the LAST server-returned
  // path. Once the server recomputes (handleUpdateRoutes response), a
  // fresh polyline string lands and renders correctly.
  useEffect(() => {
    if (dirtyRouteIds.size === 0) return;
    setEditableRoutes((current) => {
      let mutated = false;
      const next = current.map((route) => {
        if (dirtyRouteIds.has(route.id) && route.polyline) {
          mutated = true;
          return { ...route, polyline: "" };
        }
        return route;
      });
      return mutated ? next : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyRouteIds]);

  // Keep the map-listener interaction handler ref pointing at the latest
  // (polylineEditMode + resetEditModeIdleTimer). Map listeners attached
  // once at map creation read .current, so they always invoke the live
  // version.
  useEffect(() => {
    editInteractionHandlerRef.current = () => {
      if (polylineEditMode) resetEditModeIdleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // Backstop for the fetcher-idle effect above: if a Lalamove fetcher wedges (backgrounded tab, aborted submit) the busy id would never clear and every route-card button stays disabled — force-clear after 60s.
  useEffect(() => {
    if (lalamoveBusyTimerRef.current !== null) {
      window.clearTimeout(lalamoveBusyTimerRef.current);
      lalamoveBusyTimerRef.current = null;
    }
    if (lalamoveBusyRouteId === null) return;
    lalamoveBusyTimerRef.current = window.setTimeout(() => {
      setLalamoveBusyRouteId(null);
      lalamoveBusyTimerRef.current = null;
    }, 60000);
    return () => {
      if (lalamoveBusyTimerRef.current !== null) {
        window.clearTimeout(lalamoveBusyTimerRef.current);
        lalamoveBusyTimerRef.current = null;
      }
    };
  }, [lalamoveBusyRouteId]);

  useEffect(() => {
    setSettingsSaved(false);
  }, [settingsLocationId]);

  useEffect(() => {
    if (!settingsLocationId) {
      setLalamoveSettings({
        market: "",
        city: "",
        language: userLocale,
        preferredServiceType: "LALAGO",
        locationName: "",
        locationPhone: "",
        locationAddress: "",
        locationDetails: "",
        pickupInstructions: "",
      });
      return;
    }
    const config = lalamoveConfigMap[settingsLocationId];
    if (config) {
      const locationDefaults = locationsById.get(settingsLocationId);
      const defaultMarket = locationDefaults?.countryCode ?? "";
      const defaultCity = locationDefaults?.city ?? "";
      const defaultAddress = formatAddress([
        locationDefaults?.address1,
        locationDefaults?.city,
        locationDefaults?.province,
        locationDefaults?.country,
      ]);
      setLalamoveSettings({
        market: config.market || defaultMarket,
        city: config.city || defaultCity,
        language: config.language || userLocale,
        preferredServiceType:
          config.preferredServiceType || "LALAGO",
        locationName: config.locationName || locationDefaults?.name || "",
        locationPhone: config.locationPhone || locationDefaults?.phone || "",
        locationAddress:
          config.locationAddress || defaultAddress || locationDefaults?.name || "",
        locationDetails: config.locationDetails || locationDefaults?.address2 || "",
        pickupInstructions: config.pickupInstructions || "",
      });
      return;
    }
    const locationDefaults = locationsById.get(settingsLocationId);
    const defaultMarket = locationDefaults?.countryCode ?? "";
    const defaultCity = locationDefaults?.city ?? "";
    const defaultAddress = formatAddress([
      locationDefaults?.address1,
      locationDefaults?.city,
      locationDefaults?.province,
      locationDefaults?.country,
    ]);
    setLalamoveSettings({
      market: defaultMarket,
      city: defaultCity,
      language: userLocale,
      preferredServiceType: "LALAGO",
      locationName: locationDefaults?.name ?? "",
      locationPhone: locationDefaults?.phone ?? "",
      locationAddress: defaultAddress || locationDefaults?.name || "",
      locationDetails: locationDefaults?.address2 ?? "",
      pickupInstructions: "",
    });
  }, [settingsLocationId, lalamoveConfigMap, locationsById, userLocale]);

  useEffect(() => {
    if (locationId !== DEFAULT_LOCATION_ID) return;
    setEditableRoutes((current) => {
      const ordersSet = new Set(orders.map((order) => order.id));
      const currentById = new Map(current.map((route) => [route.id, route]));
      const precomputedIds = new Set(precomputedRoutes.map((r) => r.id));
      const fromPrecomputed = precomputedRoutes.map((route) => {
        const existing = currentById.get(route.id);
        const serverOrderIds = (route.orderIds ?? []).filter((orderId) => ordersSet.has(orderId));
        if (!existing) {
          return { ...route, orderIds: serverOrderIds };
        }
        const clientOrderIds = existing.orderIds.filter((orderId) => ordersSet.has(orderId));
        // If client state is empty but server has orders (e.g. after compaction),
        // trust the server to avoid stale merge conflicts.
        const orderIds = clientOrderIds.length === 0 ? serverOrderIds : clientOrderIds;
        return { ...route, orderIds };
      });
      const synthetic = current.filter((route) => !precomputedIds.has(route.id));
      return [...fromPrecomputed, ...synthetic];
    });
  }, [precomputedRoutes, orders, locationId]);

  useEffect(() => {
    if (locationId === DEFAULT_LOCATION_ID) return;
    console.info("[local-delivery:routeStats-sync] FIRED locationId=%s routeStats.length=%d", locationId, routeStats.length);
    setEditableRoutes((current) => {
      const next = ROUTE_TAG_DEFINITIONS.map((_, i) => {
        const fromServer = routeStats[i];
        const orderIds =
          fromServer?.orders?.map((o) => o.orderId).filter(Boolean) ?? [];
        const prev = current[i];
        const prevSet = prev ? new Set(prev.orderIds) : null;
        const sameOrderIds =
          prev &&
          prevSet!.size === orderIds.length &&
          orderIds.every((id) => prevSet!.has(id));
        const routeKey = `${locationId}-${i}`;
        const precomputedPolyline = precomputedRoutes.find(r => r.id === routeKey)?.polyline ?? "";
        // Keep prev polyline only if it belongs to the same route (same location);
        // otherwise fall back to the cached polyline from the loader.
        const keptPolyline = (prev?.id === routeKey && prev?.polyline) ? prev.polyline : precomputedPolyline;
        const prevPolylineLen = prev?.polyline?.length ?? 0;
        console.info(
          "[local-delivery:routeStats-sync] route[%d] id=%s prevOrders=%d serverOrders=%d sameOrderIds=%s prevPolylineLen=%d precomputedPolylineLen=%d resultPolylineLen=%d",
          i, routeKey, prev?.orderIds?.length ?? 0, orderIds.length, String(sameOrderIds), prevPolylineLen, precomputedPolyline.length, keptPolyline.length,
        );
        return {
          id: routeKey,
          locationId,
          polyline: keptPolyline,
          color:
            ROUTE_PRECOMPUTE_COLORS[i % ROUTE_PRECOMPUTE_COLORS.length] ?? "#2C6ECB",
          orderIds,
          ...(sameOrderIds && prev
            ? {
                totalDistanceMeters: prev.totalDistanceMeters,
                totalDurationSeconds: prev.totalDurationSeconds,
              }
            : {}),
        };
      });
      return next;
    });
  }, [locationId, routeStats, precomputedRoutes]);

  useEffect(() => {
    const data = lalamoveFetcher.data;
    if (!data) return;
    if ("error" in data) {
      const routeId = (data as any).routeId as string | undefined;
      const outOfAreaIds = (data as any).outOfAreaOrderIds as string[] | undefined;
      const errorDetails = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
      // If out-of-area orders were identified, include their names in the error
      let enrichedDetails = errorDetails;
      if (outOfAreaIds?.length) {
        const names = outOfAreaIds
          .map((id) => ordersById.get(id))
          .filter(Boolean)
          .map((o) => `${o!.name}${o!.customerName ? ` (${o!.customerName})` : ""}`)
          .join(", ");
        enrichedDetails = `${t("driverRequest.outOfAreaOrders")}: ${names}\n\n${errorDetails}`;
      }
      if (routeId) {
        const existingTimeout = lalamoveStatusTimeoutsRef.current[routeId];
        if (existingTimeout) window.clearTimeout(existingTimeout);
        setLalamoveStatus((current) => ({
          ...current,
          [routeId]: {
            message: t("driverRequest.requestFailed"),
            tone: "critical",
            errorDetails: enrichedDetails,
          },
        }));
      }
      setDriverErrorModal({
        routeId: routeId ?? "",
        message: t("driverRequest.requestFailed"),
        errorDetails: enrichedDetails,
      });
      return;
    }
    if ("foreignPhoneWarning" in data && (data as any).foreignPhoneWarning) {
      const d = data as any;
      setForeignPhoneWarning({
        routeId: d.routeId ?? "",
        affectedOrders: d.affectedOrders ?? [],
      });
      return;
    }
    if ("quotation" in data && data.routeId) {
      const routeId = data.routeId;
      const quote = data.quotation;
      if (!quote) return;
      const total = quote.priceBreakdown?.total;
      const currency = quote.priceBreakdown?.currency;
      if (total != null) {
        setRouteQuoteTotals((prev) => ({
          ...prev,
          [routeId]: { total, currency },
        }));
      }
      // If out-of-area orders were auto-removed, update route and show banner
      const outOfAreaIds = (data as any).outOfAreaOrderIds as string[] | undefined;
      if (outOfAreaIds?.length) {
        setEditableRoutes((current) =>
          current.map((r) =>
            r.id === routeId
              ? { ...r, orderIds: r.orderIds.filter((id) => !outOfAreaIds.includes(id)) }
              : r,
          ),
        );
        const names = outOfAreaIds
          .map((id) => ordersById.get(id))
          .filter(Boolean)
          .map((o) => `${o!.name}${o!.customerName ? ` (${o!.customerName})` : ""}`)
          .join(", ");
        // Unassign out-of-area orders from route tag on server
        const routeIndex = editableRoutes.findIndex((r) => r.id === routeId);
        const tag = routeIndex >= 0 ? ROUTE_TAG_DEFINITIONS[routeIndex]?.tag : undefined;
        const route = routeIndex >= 0 ? editableRoutes[routeIndex] : undefined;
        if (tag && route) {
          const unassignForm = new FormData();
          unassignForm.append("intent", "unassign");
          unassignForm.append("routeTag", tag);
          unassignForm.append("locationId", route.locationId);
          outOfAreaIds.forEach((id) => unassignForm.append("orderIds", id));
          unassignFetcher.submit(unassignForm, { method: "post" });
        }
        setDriverErrorModal({
          routeId,
          message: t("driverRequest.outOfAreaRemoved"),
          errorDetails: `${t("driverRequest.outOfAreaOrders")}: ${names}\n\n${t("driverRequest.outOfAreaContinued")}`,
        });
      }
      // Guard: if the route's orders changed while the quote was in-flight, discard
      const quotedRoute = editableRoutes.find((r) => r.id === routeId);
      const responseOrderIds = data.orderIds ?? [];
      if (quotedRoute) {
        const currentIds = new Set(quotedRoute.orderIds);
        const responseIds = new Set(responseOrderIds);
        if (currentIds.size !== responseIds.size || [...currentIds].some((id) => !responseIds.has(id))) {
          setLalamoveStatus((current) => ({
            ...current,
            [routeId]: { message: t("driverRequest.staleQuote"), tone: "critical" },
          }));
          return;
        }
      }
      setQuotePreview({
        routeId,
        quotationId: quote.quotationId,
        expiresAt: quote.expiresAt,
        total,
        currency,
        stopIds: (quote.stops ?? []).map((stop) => stop.stopId).filter(Boolean) as string[],
        orderIds: responseOrderIds,
        deliveryAssignments: data.deliveryAssignments ?? [],
        locationId: data.locationId ?? "",
      });
      // Quote fetched — card button will change to "Dispatch"; no modal needed
      setLalamoveStatus((current) => ({
        ...current,
        [routeId]: { message: t("driverRequest.readyForDelivery"), tone: "success" },
      }));
      return;
    }
    if ("placedOrderId" in data && data.routeId) {
      const routeId = data.routeId as string;
      const existingTimeout = lalamoveStatusTimeoutsRef.current[routeId];
      if (existingTimeout) window.clearTimeout(existingTimeout);
      // Mark route as dispatched and store share link + order details
      setDispatchedRoutes((prev) => ({
        ...prev,
        [routeId]: {
          shareLink: (data as any).shareLink ?? undefined,
          status: "requested",
          lalamoveOrderId: (data as any).placedOrderId ?? undefined,
          market: (data as any).market ?? undefined,
        },
      }));
      setLalamoveStatus((current) => ({
        ...current,
        [routeId]: { message: t("routeManager.driverRequested"), tone: "success" },
      }));
      lalamoveStatusTimeoutsRef.current[routeId] = window.setTimeout(() => {
        setLalamoveStatus((current) => {
          const next = { ...current };
          delete next[routeId];
          return next;
        });
        delete lalamoveStatusTimeoutsRef.current[routeId];
      }, 3000);
      setQuotePreview(null);
      setIsRequestDriverModalOpen(false);
    }
  }, [lalamoveFetcher.data]);

  // Watch tracking fetcher — open shareLink when fetched on demand
  useEffect(() => {
    if (trackingFetcher.state !== "idle" || !trackingFetcher.data) return;
    const data = trackingFetcher.data as any;
    const routeId = trackingRouteRef.current;
    if (!routeId || !data?.ok || !data?.details?.shareLink) return;
    setDispatchedRoutes((prev) => ({
      ...prev,
      [routeId]: { ...prev[routeId], shareLink: data.details.shareLink },
    }));
    window.open(data.details.shareLink, "_blank");
    trackingRouteRef.current = null;
  }, [trackingFetcher.data, trackingFetcher.state]);

  // Auto-refresh dispatched routes every 2 minutes to get status updates
  const hasActiveDispatches = Object.keys(dispatchedRoutes).length > 0;
  useEffect(() => {
    if (!hasActiveDispatches) return;
    const interval = setInterval(() => {
      revalidator.revalidate();
    }, 120_000);
    return () => clearInterval(interval);
  }, [hasActiveDispatches]);

  // Sync dispatchedRoutes with loader data on revalidation.
  // Rebuilds state from loader data so entries the loader stopped returning
  // (e.g. previous-day terminal dispatches) are cleaned up automatically.
  useEffect(() => {
    setDispatchedRoutes((prev) => {
      const loaderRouteIds = new Set((activeDispatchData ?? []).map((d) => d.routeId));
      const next: typeof prev = {};
      // Rebuild from loader data
      for (const d of activeDispatchData ?? []) {
        next[d.routeId] = {
          ...prev[d.routeId],
          status: d.status ?? prev[d.routeId]?.status,
          shareLink: d.shareLink ?? prev[d.routeId]?.shareLink,
          lalamoveOrderId: d.lalamoveOrderId ?? prev[d.routeId]?.lalamoveOrderId,
          market: d.market ?? prev[d.routeId]?.market,
          podBucket: d.podBucket ?? null,
          needsReviewReason: d.needsReviewReason ?? null,
          partialDelivery: !!d.partialDelivery,
          stops: d.stops ?? [],
        };
      }
      // Keep optimistic "requested" entries not yet in loader data
      // (just-dispatched routes whose DB record hasn't been picked up yet)
      for (const [routeId, entry] of Object.entries(prev)) {
        if (!loaderRouteIds.has(routeId) && entry.status === "requested") {
          next[routeId] = entry;
        }
      }
      return next;
    });
  }, [activeDispatchData]);

  // Watch return pickup fetcher results
  useEffect(() => {
    const data = returnPickupFetcher.data as Record<string, unknown> | undefined;
    if (!data) return;
    if (data.ok === false && typeof data.error === "string") {
      setReturnPickupError(data.error);
      return;
    }
    setReturnPickupError(null);
    if ("returnQuotation" in data && data.returnQuotation) {
      setReturnQuotePreview(data.returnQuotation as typeof returnQuotePreview);
    }
    if ("returnPlacedOrderId" in data) {
      setReturnQuotePreview(null);
      setSelectedReturnIds(new Set());
      setReturnInstructions("");
      setIsReturnPickupsModalOpen(false);
      const el = document.getElementById("return-pickups-modal");
      if (el && "hideOverlay" in el) (el as any).hideOverlay();
      else if (el && "hide" in el) (el as any).hide();
      revalidator.revalidate();
    }
  }, [returnPickupFetcher.data]);

  // Watch escalation results and record any re-orders for the UI indicator
  useEffect(() => {
    const data = escalationFetcher.data;
    if (!data?.results) return;
    const reorders = data.results.filter((r) => r.action.type === "reorder" && r.success);
    if (reorders.length === 0) return;
    setReorderedRoutes((prev) => {
      const next = { ...prev };
      reorders.forEach((r) => {
        next[r.routeId] = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      });
      return next;
    });
  }, [escalationFetcher.data]);

  // Escalation is now driven exclusively by the lalamove-watchdog cron
  // (every 5 min). The previous 120 s page-poller fired identical
  // checkAndApplyEscalations side effects from every open Local Delivery
  // tab — it duplicated cron work, amplified per-tab, raced with operator
  // actions, and was a major contributor to the 2026-05-13 cancellation
  // loop (29 of 56 loop reorders came from this path). Removed in favour
  // of the cron-only single-driver model.

  useEffect(() => {
    const data = assignFetcher.data as { ok?: boolean } | undefined;
    if (data && data.ok === true) {
      revalidator.revalidate();
    }
  }, [assignFetcher.data, revalidator]);

  // Handle update-routes response
  useEffect(() => {
    console.info("[local-delivery:update-routes-effect] CHECK state=%s hasData=%s", updateRoutesFetcher.state, String(!!updateRoutesFetcher.data));
    if (updateRoutesFetcher.state !== "idle") return;
    const raw = updateRoutesFetcher.data;
    if (!raw || typeof raw !== "object") {
      console.info("[local-delivery:update-routes-effect] SKIP raw is null/not-object");
      return;
    }
    if (!("intent" in raw) || raw.intent !== "update-routes") {
      console.info("[local-delivery:update-routes-effect] SKIP intent mismatch, raw keys=%s", Object.keys(raw).join(","));
      return;
    }
    const data = raw as {
      ok: boolean;
      results?: Array<{
        routeId: string;
        routeIndex: number;
        polyline: string;
        totalDistanceMeters: number;
        totalDurationSeconds: number;
        orderedIds: string[];
        error?: string;
      }>;
      error?: string;
    };
    console.info("[local-delivery:update-routes-effect] RECEIVED ok=%s resultCount=%d error=%s",
      String(data.ok), data.results?.length ?? 0, data.error ?? "none");
    if (data.results) {
      for (const r of data.results) {
        console.info("[local-delivery:update-routes-effect] result routeId=%s polylineLen=%d distM=%d durS=%d orderedIds=%d error=%s",
          r.routeId, r.polyline?.length ?? 0, r.totalDistanceMeters, r.totalDurationSeconds, r.orderedIds?.length ?? 0, r.error ?? "none");
      }
    }
    if (!data.ok || !data.results) return;

    setEditableRoutes((current) => {
      const next = [...current];
      console.info("[local-delivery:update-routes-effect] setEditableRoutes BEFORE routes=%s",
        current.map((r) => `${r.id}:orders=${r.orderIds.length}:polyLen=${r.polyline?.length ?? 0}`).join(" | "));
      for (const result of data.results!) {
        if (result.error) continue;
        const idx = next.findIndex((r) => r.id === result.routeId);
        if (idx < 0) {
          console.warn("[local-delivery:update-routes-effect] routeId=%s NOT FOUND in editableRoutes (ids: %s)", result.routeId, current.map((r) => r.id).join(","));
          continue;
        }
        console.info("[local-delivery:update-routes-effect] APPLYING routeId=%s idx=%d newPolylineLen=%d prevPolylineLen=%d",
          result.routeId, idx, result.polyline?.length ?? 0, next[idx]!.polyline?.length ?? 0);
        next[idx] = {
          ...next[idx]!,
          polyline: result.polyline,
          totalDistanceMeters: result.totalDistanceMeters,
          totalDurationSeconds: result.totalDurationSeconds,
          orderIds: result.orderedIds.length > 0 ? result.orderedIds : next[idx]!.orderIds,
        };
      }
      console.info("[local-delivery:update-routes-effect] setEditableRoutes AFTER routes=%s",
        next.map((r) => `${r.id}:orders=${r.orderIds.length}:polyLen=${r.polyline?.length ?? 0}`).join(" | "));
      return next;
    });

    // Clear dirty state for successfully updated routes
    setDirtyRouteIds((prev) => {
      const next = new Set(prev);
      for (const result of data.results!) {
        if (!result.error) next.delete(result.routeId);
      }
      return next;
    });

    // Clear stale quote totals for updated routes
    setRouteQuoteTotals((prev) => {
      const next = { ...prev };
      for (const result of data.results!) {
        if (!result.error) delete next[result.routeId];
      }
      return next;
    });
  }, [updateRoutesFetcher.data, updateRoutesFetcher.state]);

  useEffect(() => {
    if (!optimizeFetcher.data) return;
    if ("error" in optimizeFetcher.data) return;
    if (!("optimizedRoutes" in optimizeFetcher.data)) return;
    const optimizedRoutes = optimizeFetcher.data.optimizedRoutes as Array<{
      routeIndex: number;
      locationId: string;
      orderIds: string[];
      polyline: string;
      totalDistanceMeters?: number;
      totalDurationSeconds?: number;
    }>;
    // Surface AI optimizer status FIRST — runs even when routes are empty
    // (AI declined to optimize → banner explains why, no routes applied).
    type Phase1SkipReason =
      | "phase1_disabled"
      | "unknown_market"
      | "no_credentials"
      | "low_confidence"
      | "pipeline_error";
    const phase1 = (optimizeFetcher.data as {
      phase1?: { decisionId: string; confidence: number; postMortemFlags: string[] };
    }).phase1;
    const phase1SkippedFromAction = (optimizeFetcher.data as {
      phase1Skipped?: { reason: Phase1SkipReason; message?: string; decisionId?: string };
    }).phase1Skipped;
    if (phase1) {
      setPhase1Status({
        ok: true,
        decisionId: phase1.decisionId,
        confidence: phase1.confidence,
        postMortemFlags: phase1.postMortemFlags ?? [],
      });
    } else if (phase1SkippedFromAction) {
      setPhase1Status({
        ok: false,
        reason: phase1SkippedFromAction.reason,
        message: phase1SkippedFromAction.message,
        decisionId: phase1SkippedFromAction.decisionId,
      });
    } else {
      setPhase1Status(null);
    }

    if (
      !optimizedRoutes?.length ||
      optimizedRoutes.every((r) => !r.orderIds?.length)
    ) {
      // AI declined to assign routes — clear stale route state so the map
      // doesn't show last run's clustering alongside the new banner.
      setEditableRoutes((current) =>
        current.map((route) => ({ ...route, orderIds: [], polyline: "" })),
      );
      setSelectedOrderIds(new Set());
      return;
    }
    console.info("[local-delivery:optimize-response] Applying %d optimizedRoutes polylines: %s",
      optimizedRoutes.length,
      optimizedRoutes.map((r) => `idx=${r.routeIndex}:orders=${r.orderIds.length}:polyLen=${r.polyline?.length ?? 0}`).join(" | "));
    setEditableRoutes((current) =>
      current.map((route, index) => {
        const optimized = optimizedRoutes.find((item) => item.routeIndex === index);
        if (!optimized) {
          return { ...route, orderIds: [] };
        }
        return {
          ...route,
          locationId: optimized.locationId,
          orderIds: optimized.orderIds,
          polyline: optimized.polyline,
          totalDistanceMeters: optimized.totalDistanceMeters,
          totalDurationSeconds: optimized.totalDurationSeconds,
        };
      }),
    );
    // Extract summary with cost breakdown (carrier-quotation mode includes these)
    const summary = optimizeFetcher.data.summary as {
      routeCount?: number;
      costTotal?: string;
      costCurrency?: string;
      totalLalamoveCost?: string;
      totalWaitSurcharge?: string;
    } | undefined;

    if (optimizeFetcher.data.summary) {
      setOptimizerSummary(optimizeFetcher.data.summary as typeof optimizerSummary);
    }
    // Populate per-route quote totals from optimizer results
    if (summary?.costTotal != null) {
      const perRouteCosts = optimizedRoutes as Array<{
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
    }
    setSelectedOrderIds(new Set());
  }, [optimizeFetcher.data]);

  // ── Optimize progress timer ──
  // Advances the progress bar on a 500ms interval using estimated phase durations.
  // Caps at 95% until the actual response arrives.
  useEffect(() => {
    if (!optimizeProgress) return;
    const { startedAt, estimatedMs } = optimizeProgress;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const rawPct = Math.min(95, (elapsed / estimatedMs) * 100);
      let phase: string;
      // AI pipeline stages: candidate-generator → rule-engine → quote-engine
      // → spatial-reasoner (LLM) → decision-arbiter. Reflected here as
      // user-facing phase labels.
      if (rawPct < 10) phase = "Generating candidate clusterings...";
      else if (rawPct < 25) phase = "Evaluating against geofence rules...";
      else if (rawPct < 50) phase = "Quoting candidates with Lalamove...";
      else if (rawPct < 85) phase = "AI reviewing spatial trade-offs...";
      else phase = "Finalizing AI decision...";
      setOptimizeProgress((prev) => prev ? { ...prev, pct: rawPct, phase } : null);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimizeProgress?.startedAt, optimizeProgress?.estimatedMs]);

  // Clear progress when fetcher completes (success or error)
  useEffect(() => {
    if (optimizeFetcher.state === "idle" && optimizeProgress) {
      setOptimizeProgress(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimizeFetcher.state]);

  useEffect(() => {
    if (!lalamoveSettingsFetcher.data) return;
    if ("ok" in lalamoveSettingsFetcher.data && lalamoveSettingsFetcher.data.ok) {
      setLalamoveConfigMap((current) => ({
        ...current,
        [settingsLocationId]: lalamoveSettings,
      }));
      setSettingsSaved(true);
    }
  }, [lalamoveSettingsFetcher.data, lalamoveSettings, settingsLocationId]);


  // Re-fit map viewport when the user expands or collapses the map canvas.
  // Google Maps doesn't auto-resize when the CSS container changes; we must
  // trigger a "resize" event and re-run fitBounds after the animation settles.
  // Also filters by current locationId so only relevant orders are in view.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const gMaps = window.google?.maps;
      if (!mapRef.current || !gMaps) return;
      gMaps.event.trigger(mapRef.current, "resize");
      // Filter points by current location if set
      const filteredOrders = mapData.orders.filter((point) => {
        if (locationId === DEFAULT_LOCATION_ID) return true;
        const order = ordersById.get(point.id);
        return order?.fulfillmentLocation?.id === locationId;
      });
      const filteredLocations = mapData.locations.filter((point) => {
        if (locationId === DEFAULT_LOCATION_ID) return true;
        return point.id === locationId;
      });
      const allPoints = [...filteredLocations, ...filteredOrders];
      if (allPoints.length === 0) return;
      const bounds = new gMaps.LatLngBounds();
      allPoints.forEach((p) =>
        bounds.extend({ lat: p.latitude, lng: p.longitude }),
      );
      mapRef.current.fitBounds(bounds);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [isFullscreen]); // intentionally omit mapData — fires only on toggle

  const assignedOrderIds = useMemo(() => {
    const assigned = new Set<string>();
    editableRoutes.forEach((route) => {
      route.orderIds.forEach((orderId) => assigned.add(orderId));
    });
    return assigned;
  }, [editableRoutes]);

  const unassignedOrderIds = useMemo(() => {
    const unassigned = new Set<string>();
    orders.forEach((order) => {
      if (!assignedOrderIds.has(order.id)) {
        unassigned.add(order.id);
      }
    });
    return unassigned;
  }, [orders, assignedOrderIds]);

  const orderRouteMap = useMemo(() => {
    const map = new Map<string, PrecomputedRoute>();
    editableRoutes.forEach((route) => {
      route.orderIds.forEach((orderId) => map.set(orderId, route));
    });
    return map;
  }, [editableRoutes]);

  const mapData = useMemo(() => {
    const locationPoints = new Map<
      string,
      {
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        kind: "location";
      }
    >();
    const orderPoints: Array<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      kind: "order";
    }> = [];

    for (const order of orders) {
      if (order.fulfillmentLocation?.coordinates) {
        const { id, name, coordinates } = order.fulfillmentLocation;
        locationPoints.set(id, {
          id,
          name,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          kind: "location",
        });
      }
      if (order.shippingCoordinates) {
        orderPoints.push({
          id: order.id,
          name: order.name,
          latitude: order.shippingCoordinates.latitude,
          longitude: order.shippingCoordinates.longitude,
          kind: "order",
        });
      }
    }

    return {
      locations: Array.from(locationPoints.values()),
      orders: orderPoints,
    };
  }, [orders]);

  const ordersById = useMemo(() => {
    const map = new Map<string, LoaderOrder>();
    orders.forEach((order) => {
      map.set(order.id, order);
    });
    return map;
  }, [orders]);

  const orderDetailsModalOrder: LoaderOrder | null = useMemo(
    () =>
      orderDetailsModalOrderId
        ? ordersById.get(orderDetailsModalOrderId) ?? null
        : null,
    [orderDetailsModalOrderId, ordersById],
  );

  // Open / close the order details modal imperatively. Polaris s-modal
  // requires showOverlay() to surface; closing happens via the footer
  // close button (commandFor + onClick that resets the state). The effect
  // also handles the case where the user closes the modal via the
  // backdrop / esc — we don't currently observe that, so the state
  // resets only when the close button fires.
  useEffect(() => {
    if (!orderDetailsModalOrderId) return;
    const modal = document.getElementById("order-details-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [orderDetailsModalOrderId]);

  // After a tag-update completes, revalidate so the modal reflects the
  // updated tag list. The fetcher's data carries an ok/err signal.
  useEffect(() => {
    if (orderTagFetcher.state !== "idle") return;
    if (!orderTagFetcher.data) return;
    revalidator.revalidate();
    // We deliberately do NOT include revalidator in deps — calling its
    // .revalidate() triggers a re-render that would otherwise re-fire
    // this effect indefinitely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderTagFetcher.state, orderTagFetcher.data]);

  const submitOrderTagUpdate = (
    orderId: string,
    addTags: string[],
    removeTags: string[],
  ) => {
    const formData = new FormData();
    formData.append("intent", "order-tag-update");
    formData.append("orderId", orderId);
    addTags.forEach((tag) => formData.append("addTags", tag));
    removeTags.forEach((tag) => formData.append("removeTags", tag));
    orderTagFetcher.submit(formData, { method: "post" });
  };

  const handleOrderTagToggle = (
    orderId: string,
    tag: string,
    isCurrentlyActive: boolean,
  ) => {
    if (isCurrentlyActive) {
      submitOrderTagUpdate(orderId, [], [tag]);
    } else {
      submitOrderTagUpdate(orderId, [tag], []);
    }
  };

  const handleOrderTagAdd = (orderId: string, tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    submitOrderTagUpdate(orderId, [trimmed], []);
  };

  const handleOrderTagRemove = (orderId: string, tag: string) => {
    submitOrderTagUpdate(orderId, [], [tag]);
  };

  const pendingReturnPickups = useMemo(
    () =>
      locationId === DEFAULT_LOCATION_ID
        ? returnPickupRequests
        : returnPickupRequests.filter((r) => r.locationId === locationId),
    [returnPickupRequests, locationId],
  );

  const unassignedOrders = useMemo(
    () => orders.filter((order) => !assignedOrderIds.has(order.id)),
    [orders, assignedOrderIds],
  );

  // B5: Loop auto-assign until all orders assigned or no progress
  useEffect(() => {
    if (!autoAssignActiveRef.current) return;
    if (optimizeFetcher.state !== "idle") return;
    const currentUnassigned = unassignedOrders.length;
    if (currentUnassigned === 0) {
      // All assigned — stop looping
      autoAssignActiveRef.current = false;
      return;
    }
    const madeProgress = currentUnassigned < prevUnassignedCountRef.current;
    if (!madeProgress) {
      // No progress — stop looping to avoid infinite loop
      autoAssignActiveRef.current = false;
      return;
    }
    // Progress made, more orders remain — re-submit
    prevUnassignedCountRef.current = currentUnassigned;
    handleOptimizeFleet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unassignedOrders.length, optimizeFetcher.state]);

  // Per-location settings drive the bucket math (same-day cutoff + delivery
  // promise days). When all locations are selected, fall back to defaults —
  // we'd otherwise have to compute per-order using each order's location.
  const activeLocationConfig = locationId !== DEFAULT_LOCATION_ID
    ? lalamoveConfigMap[locationId]
    : undefined;
  const deliveryPromiseDays =
    activeLocationConfig?.deliveryPromiseDays ?? DEFAULT_DELIVERY_PROMISE_DAYS;
  const [sameDayHour, sameDayMinute] = parseCutoffTime(
    activeLocationConfig?.orderCutoffTime,
  );

  const dueBucketByOrderId = useMemo(
    () =>
      computeDueBuckets({
        orders,
        deliveryPromiseDays,
        sameDayHour,
        sameDayMinute,
        browserTimeZone,
        userLocale,
        failedDeliveryTags: getAllFailedDeliveryTags(),
      }),
    [orders, deliveryPromiseDays, sameDayHour, sameDayMinute, browserTimeZone, userLocale],
  );

  // Order IDs whose Shopify deliveryMethod is not LOCAL. Surfaced via the
  // `includeWarehouse` toggle. These rows show the `package` icon in the Due
  // column (replacing the bucket-driven icon) and trigger the warehouse-
  // override confirmation modal on dispatch.
  const warehouseOrderIds = useMemo(
    () =>
      new Set(
        orders
          .filter((o) => o.methodType && o.methodType !== "LOCAL")
          .map((o) => o.id),
      ),
    [orders],
  );

  // Returns the semantic icon kind for a due-bucket. The actual rendering
  // is delegated to the shared `markerIconHTML` util (inline SVG, replaces
  // emoji per CLAUDE.md Polaris-first rule).
  const dueBucketIconKind = useCallback(
    (bucket: DueBucket | undefined): MarkerIconKind => {
      switch (bucket) {
        case "failed": return "failed";
        case "overdue": return "overdue";
        case "today": return "dueToday";
        case "tomorrow": return "dueTomorrow";
        default: return "dueLater";
      }
    },
    [],
  );

  // Unassigned panel groups orders by due-date urgency. Failed orders are
  // excluded entirely (they live in the new Failed filter chip in the orders
  // table). Overdue orders fold into the "today" group — they share the
  // "must do now" semantic; the badge tells them apart visually.
  const dueBuckets = useMemo(() => {
    const today = unassignedOrders.filter((order) => {
      const bucket = dueBucketByOrderId.get(order.id);
      return bucket === "today" || bucket === "overdue";
    });
    const tomorrow = unassignedOrders.filter(
      (order) => dueBucketByOrderId.get(order.id) === "tomorrow",
    );
    const later = unassignedOrders.filter(
      (order) => dueBucketByOrderId.get(order.id) === "later",
    );
    return { today, tomorrow, later };
  }, [unassignedOrders, dueBucketByOrderId]);
  const visibleDueBuckets = useMemo(
    () =>
      [
        {
          key: "today",
          title: t("dueBuckets.today"),
          selectAllLabel: t("dueBuckets.todaySelectAll"),
          orders: dueBuckets.today,
        },
        {
          key: "tomorrow",
          title: t("dueBuckets.tomorrow"),
          selectAllLabel: t("dueBuckets.tomorrowSelectAll"),
          orders: dueBuckets.tomorrow,
        },
        {
          key: "later",
          title: t("dueBuckets.later"),
          selectAllLabel: t("dueBuckets.laterSelectAll"),
          orders: dueBuckets.later,
        },
      ].filter((bucket) => bucket.orders.length > 0),
    [dueBuckets, t],
  );

  const isBucketFullySelected = (bucketOrders: LoaderOrder[]) =>
    bucketOrders.length > 0 &&
    bucketOrders.every((order) => selectedOrderIds.has(order.id));

  const toggleBucketSelection = (bucketOrders: LoaderOrder[], checked: boolean) => {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      bucketOrders.forEach((order) => {
        if (checked) {
          next.add(order.id);
        } else {
          next.delete(order.id);
        }
      });
      return next;
    });
  };

  // Address-error badge tracks the runtime validation result only.
  //
  // 2026-05-19: previously this also OR'd in `tags.includes(ld_confirm-address)`
  // and `tags.includes(ld_number-confirm)` as a secondary signal. Removed
  // because:
  //   1. The runtime validator (`validateAddressFormat`) is the single source
  //      of truth — it checks the SAME three patterns that produce those tags
  //      server-side (apartment-in-line-1, multiple-numbers-in-line-1,
  //      duplicate-number-across-lines). Tags became a lagging mirror.
  //   2. Tag-as-badge produced false-positives: an operator who fixed the
  //      address in Shopify but forgot to remove the tag would see the badge
  //      keep counting their fixed order until they manually pruned the tag.
  //      That's the badge measuring history, not current state.
  //   3. Every loader pass re-runs validation against the freshly-fetched
  //      shipping address from Shopify, so the badge auto-updates the moment
  //      the address is corrected — no tag-cleanup step needed.
  //
  // Tags remain useful for OTHER purposes (auto-assign skip-list, Shopify-
  // side deep-link in the address-errors modal, server-side audit trail).
  // They're just not the source of truth for the badge.
  const addressErrorOrders = useMemo(
    () => orders.filter((order) => !order.addressValidation.isValid),
    [orders],
  );

  useEffect(() => {
    setSelectedOrderIds((current) => {
      const next = new Set<string>();
      current.forEach((orderId) => {
        if (ordersById.has(orderId)) {
          next.add(orderId);
        }
      });
      return next;
    });
  }, [ordersById]);

  useEffect(() => {
    if (!mapsApiKey) return;
    if (!mapsMapId) return;
    const mapContainerEl = mapContainerRef.current;
    if (!mapContainerEl) return;

    let isMounted = true;

    loadGoogleMaps(mapsApiKey)
      .then(async () => {
        if (!isMounted) return;
        const mapElement = mapContainerRef.current;
        if (!mapElement || !mapElement.isConnected) return;
        const googleMaps = window.google?.maps;
        if (!googleMaps) {
          setMapsLoadError(t("map.errors.sdkNotAvailable"));
          return;
        }
        setMapsLoadError(null);

        const { Map, InfoWindow } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("maps")
          : { Map: googleMaps.Map, InfoWindow: googleMaps.InfoWindow };
        const { AdvancedMarkerElement } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("marker")
          : { AdvancedMarkerElement: googleMaps.marker?.AdvancedMarkerElement };
        if (!AdvancedMarkerElement) {
          setMapsLoadError(
            t("map.errors.advancedMarkersUnavailable"),
          );
          return;
        }

        if (!mapRef.current) {
          const styledMapTypes = {
            light: new googleMaps.StyledMapType(null, { name: t("map.styles.light") }),
            grayscale: new googleMaps.StyledMapType(GRAYSCALE_MAP_STYLES, {
              name: t("map.styles.grayscale"),
            }),
            dark: new googleMaps.StyledMapType(DARK_MAP_STYLES, {
              name: t("map.styles.dark"),
            }),
          };
          mapRef.current = new Map(mapElement, {
            center: { lat: 0, lng: 0 },
            zoom: 2,
            mapId: mapsMapId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
            mapTypeId: mapStyle,
          });
          mapRef.current.mapTypes.set("light", styledMapTypes.light);
          mapRef.current.mapTypes.set("grayscale", styledMapTypes.grayscale);
          mapRef.current.mapTypes.set("dark", styledMapTypes.dark);
          // EDIT MODE timer reset (2026-05-08): zoom and pan count as
          // interactions per Lucas's spec. Listeners attached once at
          // map creation; they call into a ref to always invoke the
          // latest handler closure (avoids the stale-closure trap).
          mapRef.current.addListener("zoom_changed", () => {
            editInteractionHandlerRef.current();
          });
          mapRef.current.addListener("dragend", () => {
            editInteractionHandlerRef.current();
          });
        } else if (mapContainerEl) {
          mapRef.current.setOptions({
            mapTypeControl: false,
            mapTypeId: mapStyle,
          });
        }

        // Diff reconciliation (markers): we no longer tear down all markers
        // here. Markers that survive into the new desired set are mutated
        // in place below; markers that drop out get cleared at the end.
        precomputedRoutePolylinesRef.current.forEach((polyline) =>
          polyline.setMap(null),
        );
        precomputedRoutePolylinesRef.current = [];
        assignedRouteRenderersRef.current.forEach((renderer) =>
          renderer.setMap(null),
        );
        assignedRouteRenderersRef.current = [];
        if (!infoWindowRef.current) {
          infoWindowRef.current = new InfoWindow();
        }

        const allPoints = [...mapData.locations, ...mapData.orders];
        // Bounds always comprehend all orders at this location (never shrink after assignment)
        const boundsPoints = allPoints;

        // Returns the wrapper plus its mutable parts so the diff-reconciler
        // can update text / icon / style in place rather than recreating the
        // whole DOM tree on every effect run.
        const buildLabelParts = (
          text: string,
          iconKind: MarkerIconKind | null,
          badgeStyle?: Partial<CSSStyleDeclaration>,
        ) => {
          const wrapper = document.createElement("div");
          wrapper.className = styles.mapLabelContainer;

          const label = document.createElement("div");
          label.className = styles.mapLabelText;
          label.classList.add(styles.mapLabelBadge);

          const orderLine = document.createElement("div");
          orderLine.className = styles.mapLabelOrder;
          orderLine.textContent = text;

          let iconLine: HTMLElement | null = null;
          if (iconKind) {
            iconLine = document.createElement("div");
            iconLine.className = styles.mapLabelEmoji;
            iconLine.innerHTML = markerIconHTML(iconKind);
            label.appendChild(iconLine);
          }
          label.appendChild(orderLine);
          if (badgeStyle) {
            Object.assign(label.style, badgeStyle);
          }

          wrapper.appendChild(label);
          return { wrapper, label, orderLine, iconLine };
        };

        // Reset every style property the diff path touches. The previous
        // marker style might have set bg/color/border/boxShadow; clearing
        // them here lets `Object.assign(badgeStyle)` overwrite cleanly
        // without leaving stale properties from the prior render.
        const resetBadgeStyleProperties = (label: HTMLElement) => {
          label.style.backgroundColor = "";
          label.style.background = "";
          label.style.color = "";
          label.style.borderColor = "";
          label.style.boxShadow = "";
        };

        const getRouteDefinitionForOrder = (orderId: string) => {
          return orderRouteMap.get(orderId) ?? null;
        };

        const desiredIds = new Set<string>();
        allPoints.forEach((point) => {
          const recordKey = `${point.kind}:${point.id}`;
          desiredIds.add(recordKey);
          const position = { lat: point.latitude, lng: point.longitude };
          const labelText = point.name;
          const assignedRoute =
            point.kind === "order" ? getRouteDefinitionForOrder(point.id) : null;
          const dueBucket =
            point.kind === "order" ? dueBucketByOrderId.get(point.id) : undefined;
          const orderData = point.kind === "order" ? ordersById.get(point.id) : null;
          const hasAddressError = orderData ? !orderData.addressValidation.isValid : false;
          // Warehouse-origin rows force the `warehouse` icon at the marker
          // level, overriding addressError + due-bucket signals. Per Lucas
          // (2026-05-15): ALL warehouse orders show the package icon on the
          // map regardless of anything else. List-side override is in
          // `renderDueBadge`; this is the map equivalent.
          const isWarehouseOrder =
            point.kind === "order" && warehouseOrderIds.has(point.id);
          const iconKind: MarkerIconKind =
            point.kind === "order"
              ? isWarehouseOrder
                ? "warehouse"
                : hasAddressError
                  ? "addressError"
                  : dueBucketIconKind(dueBucket)
              : "storeLocation";
          const isSelected = point.kind === "order" && selectedOrderIds.has(point.id);
          // Map markers use the deeper 55% white-mix so per-route pastels
          // remain readable on dark Google Maps tiles. Side-panel cards stay
          // on 78% via the plain deriveBadgeColors() helper. 2026-05-12.
          const assignedBadgeColors =
            assignedRoute?.color && point.kind === "order"
              ? deriveBadgeColorsForMap(assignedRoute.color)
              : null;
          const badgeStyle: Partial<CSSStyleDeclaration> = {};
          if (assignedBadgeColors) {
            badgeStyle.backgroundColor = assignedBadgeColors.bg;
            badgeStyle.color = assignedBadgeColors.text;
          } else if (point.kind === "order") {
            // Polaris-neutral pairing for unassigned order markers (no route
            // color). Drops the prior pure-white fallback so unassigned
            // markers still read as "a badge" rather than a blank pill.
            badgeStyle.backgroundColor = "#e4e5e7";
            badgeStyle.color = "#303030";
          }
          if (isSelected) {
            // Signature holographic gradient at 55% alpha (was 25% — too
            // subtle for legibility on the map). Reinforces the brand
            // signature color used in the progress bar + accuracy meter,
            // while staying distinct from route palette index 4 (#FF7A00).
            // Label text rendered white for contrast against the gradient.
            badgeStyle.background =
              "linear-gradient(90deg, rgba(94, 206, 206, 0.55), rgba(176, 159, 218, 0.55), rgba(212, 168, 212, 0.55), rgba(94, 206, 206, 0.55))";
            badgeStyle.borderColor = "rgba(176, 159, 218, 0.85)";
            badgeStyle.color = "#ffffff";
            // Edit mode: extra ring outline so the operator can see at a
            // glance which stops are picked for the next reassign/unassign.
            if (polylineEditMode) {
              badgeStyle.boxShadow = "0 0 0 3px rgba(176, 159, 218, 0.7)";
            }
          }
          const markerTitle = point.kind === "order" && orderData?.customerName
            ? `${point.name} \u2022 ${orderData.customerName}`
            : point.name;

          // Visual signature for diff: every input that affects rendering.
          // When this matches the previous render we skip DOM mutation
          // entirely and only refresh the event listeners (closures change
          // every render but listener swaps don't cause visual flash).
          const styleSignature = JSON.stringify([
            badgeStyle.backgroundColor ?? null,
            badgeStyle.background ?? null,
            badgeStyle.color ?? null,
            badgeStyle.borderColor ?? null,
            badgeStyle.boxShadow ?? null,
          ]);
          const signature = [
            position.lat.toFixed(7),
            position.lng.toFixed(7),
            iconKind,
            labelText,
            markerTitle,
            styleSignature,
          ].join("|");

          let record = markersRef.current.get(recordKey);
          if (!record) {
            // First render of this marker \u2014 create from scratch.
            const parts = buildLabelParts(labelText, iconKind, badgeStyle);
            const advancedMarker = new AdvancedMarkerElement({
              map: mapRef.current!,
              position,
              title: markerTitle,
              content: parts.wrapper,
            });
            record = {
              marker: advancedMarker,
              wrapper: parts.wrapper,
              label: parts.label,
              orderLine: parts.orderLine,
              iconLine: parts.iconLine,
              currentIconKind: iconKind,
              listenerHandles: [],
              contextmenuHandler: null,
              contextmenuTarget: null,
              signature,
            };
            markersRef.current.set(recordKey, record);
          } else if (record.signature !== signature) {
            // Visual changed \u2014 mutate in place rather than recreating.
            const m = record.marker;
            const prevPos = m.position;
            if (
              !prevPos ||
              prevPos.lat !== position.lat ||
              prevPos.lng !== position.lng
            ) {
              m.position = position;
            }
            if (m.title !== markerTitle) m.title = markerTitle;
            if (record.orderLine.textContent !== labelText) {
              record.orderLine.textContent = labelText;
            }
            // Icon swap: only touch the DOM when the icon kind actually changed.
            if (iconKind !== record.currentIconKind) {
              if (record.iconLine) {
                record.iconLine.remove();
                record.iconLine = null;
              }
              if (iconKind) {
                const iconLine = document.createElement("div");
                iconLine.className = styles.mapLabelEmoji;
                iconLine.innerHTML = markerIconHTML(iconKind);
                record.label.insertBefore(iconLine, record.orderLine);
                record.iconLine = iconLine;
              }
              record.currentIconKind = iconKind;
            }
            resetBadgeStyleProperties(record.label);
            Object.assign(record.label.style, badgeStyle);
            record.signature = signature;
          }
          // (else signature unchanged \u2192 skip DOM update entirely)

          // Listener refresh: tear down + re-bind every render. Closures
          // depend on `polylineEditMode`, `ordersById`, `editableRoutes`,
          // `unassignSingleOrderFromRoute`, etc. \u2014 all of which can change
          // between renders. Listener swaps are cheap and don't flash.
          record.listenerHandles.forEach((h) => h.remove());
          record.listenerHandles = [];
          if (record.contextmenuHandler && record.contextmenuTarget) {
            record.contextmenuTarget.removeEventListener(
              "contextmenu",
              record.contextmenuHandler,
            );
            record.contextmenuHandler = null;
            record.contextmenuTarget = null;
          }
          const advancedMarker = record.marker;

          if (point.kind === "order" && !assignedRoute) {
            record.listenerHandles.push(
              advancedMarker.addListener("click", () => {
                // Location gate: when no specific location is selected, marker
                // clicks are no-op. The control row is hidden anyway (line
                // 5881) so any selection would be a ghost — early-return keeps
                // the affordance off. Banner above the page explains why.
                if (locationId === DEFAULT_LOCATION_ID) return;
                // Bug 4 fix (2026-05-08): selection alone no longer enters
                // edit mode. EDIT MODE is triggered by writes only (assign /
                // unassign / move / clear), via the dirty-set watcher.
                // Marker click is just selection.
                // EDIT MODE timer reset: any marker click while in editMode
                // resets the 5s idle countdown.
                if (polylineEditMode) resetEditModeIdleTimer();
                toggleSelection(point.id);
                const orderDetails = ordersById.get(point.id);
                if (!orderDetails) return;
                infoWindowRef.current?.setContent(
                  getOrderInfoContent(orderDetails, t("customer.guest"), t("customer.noShippingAddress")),
                );
                infoWindowRef.current?.open({
                  map: mapRef.current!,
                  anchor: advancedMarker,
                  shouldFocus: false,
                });
              }),
            );
            record.listenerHandles.push(
              advancedMarker.addListener("mouseover", () => {
                const orderDetails = ordersById.get(point.id);
                if (!orderDetails) return;
                infoWindowRef.current?.setContent(
                  getOrderInfoContent(orderDetails, t("customer.guest"), t("customer.noShippingAddress")),
                );
                infoWindowRef.current?.open({
                  map: mapRef.current!,
                  anchor: advancedMarker,
                  shouldFocus: false,
                });
              }),
            );
            record.listenerHandles.push(
              advancedMarker.addListener("mouseout", () => {
                infoWindowRef.current?.close();
              }),
            );
          } else if (point.kind === "order" && assignedRoute) {
            // Left-click: toggle multiselection (same as unassigned orders)
            record.listenerHandles.push(
              advancedMarker.addListener("click", () => {
                // Location gate — see unassigned-marker handler above for
                // rationale.
                if (locationId === DEFAULT_LOCATION_ID) return;
                // Bug 4 fix (2026-05-08): selection alone no longer enters
                // edit mode (rolled back from rev-21). Marker click resets
                // the EDIT MODE idle timer when already in edit mode.
                if (polylineEditMode) resetEditModeIdleTimer();
                toggleSelection(point.id);
                const orderDetails = ordersById.get(point.id);
                if (!orderDetails) return;
                infoWindowRef.current?.setContent(
                  getOrderInfoContent(orderDetails, t("customer.guest"), t("customer.noShippingAddress")),
                );
                infoWindowRef.current?.open({
                  map: mapRef.current!,
                  anchor: advancedMarker,
                  shouldFocus: false,
                });
              }),
            );
            // Hover preview (same as unassigned orders)
            record.listenerHandles.push(
              advancedMarker.addListener("mouseover", () => {
                const orderDetails = ordersById.get(point.id);
                if (!orderDetails) return;
                infoWindowRef.current?.setContent(
                  getOrderInfoContent(orderDetails, t("customer.guest"), t("customer.noShippingAddress")),
                );
                infoWindowRef.current?.open({
                  map: mapRef.current!,
                  anchor: advancedMarker,
                  shouldFocus: false,
                });
              }),
            );
            record.listenerHandles.push(
              advancedMarker.addListener("mouseout", () => {
                infoWindowRef.current?.close();
              }),
            );
            // Right-click: show unassign balloon. Stored on `record` so the
            // next render's listener-refresh can remove it before re-binding
            // (preserves the marker, swaps only the handler closure).
            if (advancedMarker.element) {
              const contextmenuHandler = (e: Event) => {
                e.preventDefault();
                // Location gate — same rationale as the click handlers above.
                if (locationId === DEFAULT_LOCATION_ID) return;
                const routeIndex = editableRoutes.findIndex(
                  (candidate) => candidate.id === assignedRoute.id,
                );
                const routeNumber = routeIndex >= 0 ? routeIndex + 1 : null;
                const buttonId = `map-unassign-${point.id.replace(
                  /[^a-zA-Z0-9_-]/g,
                  "_",
                )}`;
                infoWindowRef.current?.setContent(`
                  <div style="display:flex;flex-direction:column;gap:8px;min-width:220px;">
                    <span style="font-weight:600;">${t("infoWindow.assignedTo", { number: routeNumber ?? "?" })}</span>
                    <button id="${buttonId}" style="background:#d82c0d;color:#fff;border:0;border-radius:6px;padding:8px 10px;cursor:pointer;">
                      ${t("infoWindow.unassign")}
                    </button>
                  </div>
                `);
                infoWindowRef.current?.open({
                  map: mapRef.current!,
                  anchor: advancedMarker,
                  shouldFocus: false,
                });
                const attachUnassignHandler = () => {
                  document.getElementById(buttonId)?.addEventListener("click", () => {
                    unassignSingleOrderFromRoute(point.id, assignedRoute);
                    infoWindowRef.current?.close();
                  });
                };
                if (googleMaps.event?.addListenerOnce) {
                  googleMaps.event.addListenerOnce(infoWindowRef.current!, "domready", attachUnassignHandler);
                } else {
                  setTimeout(attachUnassignHandler, 100);
                }
              };
              advancedMarker.element.addEventListener("contextmenu", contextmenuHandler);
              record.contextmenuHandler = contextmenuHandler;
              record.contextmenuTarget = advancedMarker.element as HTMLElement;
            }
          }
        });

        // Remove markers no longer in the desired set.
        for (const [recordKey, record] of markersRef.current) {
          if (desiredIds.has(recordKey)) continue;
          record.listenerHandles.forEach((h) => h.remove());
          if (record.contextmenuHandler && record.contextmenuTarget) {
            record.contextmenuTarget.removeEventListener(
              "contextmenu",
              record.contextmenuHandler,
            );
          }
          record.marker.map = null;
          markersRef.current.delete(recordKey);
        }

        if (boundsPoints.length > 0) {
          if (
            locationId === filters.locationId &&
            lastFittedLocationIdRef.current !== locationId
          ) {
            const fitBounds = new googleMaps.LatLngBounds();
            boundsPoints.forEach((point) => {
              fitBounds.extend({ lat: point.latitude, lng: point.longitude });
            });
            mapRef.current.fitBounds(fitBounds);
            lastFittedLocationIdRef.current = locationId;
          }
        } else {
          mapRef.current.setCenter({ lat: 0, lng: 0 });
          mapRef.current.setZoom(2);
        }
        if (locationId !== DEFAULT_LOCATION_ID) {
          console.info("[local-delivery:map-render] Drawing polylines for %d editableRoutes", editableRoutes.length);
          editableRoutes.forEach((route, routeIdx) => {
            const routeOrderPoints = route.orderIds
              .map((orderId) => ordersById.get(orderId))
              .filter(
                (order): order is LoaderOrder =>
                  Boolean(order?.shippingCoordinates),
              )
              .map((order) => ({
                order,
                coordinates: order.shippingCoordinates!,
              }));
            if (routeOrderPoints.length === 0) {
              console.info("[local-delivery:map-render] route[%d] id=%s SKIP (0 order points)", routeIdx, route.id);
              return;
            }
            const origin = route.orderIds
              .map((orderId) => ordersById.get(orderId))
              .find((order) => order?.fulfillmentLocation?.coordinates)
              ?.fulfillmentLocation?.coordinates;
            if (!origin) {
              console.info("[local-delivery:map-render] route[%d] id=%s SKIP (no origin)", routeIdx, route.id);
              return;
            }

            // Skip polyline rendering if no polyline data — markers only
            if (!route.polyline) {
              console.info("[local-delivery:map-render] route[%d] id=%s SKIP (no polyline) orders=%d color=%s", routeIdx, route.id, route.orderIds.length, route.color);
              return;
            }
            console.info("[local-delivery:map-render] route[%d] id=%s DRAWING polylineLen=%d orders=%d color=%s", routeIdx, route.id, route.polyline.length, route.orderIds.length, route.color);

            const encoded = route.polyline;
            const path: Array<{ lat: number; lng: number }> = [];
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
              lat += result & 1 ? ~(result >> 1) : result >> 1;
              shift = 0;
              result = 0;
              do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
              } while (byte >= 0x20);
              lng += result & 1 ? ~(result >> 1) : result >> 1;
              path.push({ lat: lat / 1e5, lng: lng / 1e5 });
            }

            // Apply edit-mode (dotted+subdued) styling at CREATION when
            // polylineEditMode is already active. Without this, polylines
            // rebuilt mid-edit (e.g. after optimize) render solid because
            // the restyle effect at line 2377 runs synchronously BEFORE
            // the async polyline creation completes.
            const polyline = new googleMaps.Polyline(
              polylineEditMode
                ? {
                    path,
                    strokeColor: route.color,
                    strokeOpacity: 0,
                    strokeWeight: 2,
                    icons: [{
                      icon: { path: "M 0,-1 0,1", strokeOpacity: 0.5, scale: 3 },
                      offset: "0",
                      repeat: "10px",
                    }],
                    map: mapRef.current,
                  }
                : {
                    path,
                    strokeColor: route.color,
                    strokeOpacity: 0.85,
                    strokeWeight: 4,
                    map: mapRef.current,
                  },
            );
            precomputedRoutePolylinesRef.current.push(polyline);
          });
        }

        // Removed 2026-05-12: straight-line connectors between pickup and
        // selected orders. With AI-only optimization, those lines implied
        // a route order the LLM had not yet decided on — the merchant saw
        // a path before it existed. Still clear any stale renderers from a
        // previous run.
        selectedRouteRenderersRef.current.forEach((renderer) =>
          renderer.setMap(null),
        );
        selectedRouteRenderersRef.current = [];
      })
      .catch((error) => {
        if (!isMounted) return;
        console.error("Failed to load Google Maps", error);
        setMapsLoadError(
          t("map.errors.mapsLoadFailed"),
        );
      });

    return () => {
      isMounted = false;
    };
  }, [
    mapData.locations,
    mapData.orders,
    mapsApiKey,
    mapsMapId,
    mapStyle,
    ordersById,
    editableRoutes,
    assignedOrderIds,
    dueBucketByOrderId,
    dueBucketIconKind,
    warehouseOrderIds,
    selectedOrderIds,
    locationId,
    filters.locationId,
    polylineEditMode,
  ]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!window.google?.maps?.event?.trigger) return;
    window.google.maps.event.trigger(mapRef.current, "resize");
  }, [isFullscreen]);

  useEffect(() => {
    if (activeModalType !== "manage") return;
    if (!mapsApiKey || !mapsMapId) return;
    if (!activeRouteId || !manageRouteMapRef.current) return;
    const managedRoute =
      editableRoutes.find((route) => route.id === activeRouteId) ?? null;
    if (!managedRoute) return;

    let isMounted = true;

    loadGoogleMaps(mapsApiKey)
      .then(async () => {
        if (!isMounted) return;
        const googleMaps = window.google?.maps;
        if (!googleMaps) return;
        const { Map } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("maps")
          : { Map: googleMaps.Map };
        const { AdvancedMarkerElement } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("marker")
          : { AdvancedMarkerElement: googleMaps.marker?.AdvancedMarkerElement };
        if (!AdvancedMarkerElement) return;

        if (!manageRouteMapInstance.current) {
          const styledMapTypes = {
            light: new googleMaps.StyledMapType(null, { name: t("map.styles.light") }),
            grayscale: new googleMaps.StyledMapType(GRAYSCALE_MAP_STYLES, {
              name: t("map.styles.grayscale"),
            }),
            dark: new googleMaps.StyledMapType(DARK_MAP_STYLES, {
              name: t("map.styles.dark"),
            }),
          };
          manageRouteMapInstance.current = new Map(manageRouteMapRef.current!, {
            center: { lat: 0, lng: 0 },
            zoom: 3,
            mapId: mapsMapId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
            mapTypeId: mapStyle,
          });
          manageRouteMapInstance.current.mapTypes.set("light", styledMapTypes.light);
          manageRouteMapInstance.current.mapTypes.set(
            "grayscale",
            styledMapTypes.grayscale,
          );
          manageRouteMapInstance.current.mapTypes.set("dark", styledMapTypes.dark);
        } else {
          manageRouteMapInstance.current.setOptions({
            mapTypeControl: false,
            mapTypeId: mapStyle,
          });
        }

        manageRouteMarkersRef.current.forEach(({ type, marker }) => {
          if (type === "advanced") {
            marker.map = null;
          } else {
            marker.setMap(null);
          }
        });
        manageRouteMarkersRef.current = [];
        manageRouteRenderersRef.current.forEach((renderer) => renderer.setMap(null));
        manageRouteRenderersRef.current = [];

        const routePoints = managedRoute.orderIds
          .map((orderId) => ordersById.get(orderId))
          .filter(
            (order): order is LoaderOrder =>
              Boolean(order?.shippingCoordinates),
          );
        const origin = locationsById.get(managedRoute.locationId)?.coordinates;
        const bounds = new googleMaps.LatLngBounds();

        const buildLabel = (
          text: string,
          iconKind: MarkerIconKind | null,
          badgeStyle?: Partial<CSSStyleDeclaration>,
        ) => {
          const wrapper = document.createElement("div");
          wrapper.className = styles.mapLabelContainer;

          const label = document.createElement("div");
          label.className = styles.mapLabelText;
          label.classList.add(styles.mapLabelBadge);

          const textLine = document.createElement("div");
          textLine.className = styles.mapLabelOrder;
          textLine.textContent = text;

          if (iconKind) {
            const iconLine = document.createElement("div");
            iconLine.className = styles.mapLabelEmoji;
            iconLine.innerHTML = markerIconHTML(iconKind);
            label.appendChild(iconLine);
          }
          label.appendChild(textLine);
          if (badgeStyle) {
            Object.assign(label.style, badgeStyle);
          }

          wrapper.appendChild(label);
          return wrapper;
        };

        if (origin) {
          const originMarker = new AdvancedMarkerElement({
            map: manageRouteMapInstance.current,
            position: { lat: origin.latitude, lng: origin.longitude },
            title: t("map.fulfillmentLocation"),
            content: buildLabel(t("map.fulfillmentLabel"), "storeLocation"),
          });
          manageRouteMarkersRef.current.push({ type: "advanced", marker: originMarker });
          bounds.extend({ lat: origin.latitude, lng: origin.longitude });
        }

        routePoints.forEach((order) => {
          const coords = order.shippingCoordinates!;
          const badgeColors = deriveBadgeColors(managedRoute.color);
          const dueBucket = dueBucketByOrderId.get(order.id);
          // Warehouse-origin rows force the `warehouse` icon — overrides
          // addressError + due-bucket. Same rule as the main-map markers.
          const routeOrderIconKind: MarkerIconKind = warehouseOrderIds.has(order.id)
            ? "warehouse"
            : !order.addressValidation.isValid
              ? "addressError"
              : dueBucketIconKind(dueBucket);
          const marker = new AdvancedMarkerElement({
            map: manageRouteMapInstance.current,
            position: { lat: coords.latitude, lng: coords.longitude },
            title: order.customerName ? `${order.name} \u2022 ${order.customerName}` : order.name,
            content: buildLabel(
              order.name,
              routeOrderIconKind,
              { backgroundColor: badgeColors.bg, borderColor: "#111111" },
            ),
          });
          manageRouteMarkersRef.current.push({ type: "advanced", marker });
          bounds.extend({ lat: coords.latitude, lng: coords.longitude });
        });

        if (origin && routePoints.length > 0) {
          // Use corridor polyline if available, otherwise straight-line connectors
          // Only render polyline if polyline data exists — markers only otherwise
          if (managedRoute.polyline) {
            const encoded = managedRoute.polyline;
            const path: Array<{ lat: number; lng: number }> = [];
            let idx = 0;
            let dlat = 0;
            let dlng = 0;
            while (idx < encoded.length) {
              let shift = 0;
              let result = 0;
              let byte: number;
              do {
                byte = encoded.charCodeAt(idx++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
              } while (byte >= 0x20);
              dlat += result & 1 ? ~(result >> 1) : result >> 1;
              shift = 0;
              result = 0;
              do {
                byte = encoded.charCodeAt(idx++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
              } while (byte >= 0x20);
              dlng += result & 1 ? ~(result >> 1) : result >> 1;
              path.push({ lat: dlat / 1e5, lng: dlng / 1e5 });
            }
            const routePolyline = new googleMaps.Polyline({
              path,
              strokeColor: managedRoute.color,
              strokeOpacity: 0.85,
              strokeWeight: 4,
              map: manageRouteMapInstance.current,
            });
            manageRouteRenderersRef.current.push(routePolyline);
          }
        }

        if (!bounds.isEmpty()) {
          manageRouteMapInstance.current.fitBounds(bounds);
        }
      })
      .catch((error) => {
        console.error("Failed to initialize manage route map", error);
      });

    return () => {
      isMounted = false;
    };
  }, [
    activeModalType,
    activeRouteId,
    activeRouteIndex,
    editableRoutes,
    mapsApiKey,
    mapsMapId,
    ordersById,
    locationsById,
    mapStyle,
    dueBucketByOrderId,
    dueBucketIconKind,
    warehouseOrderIds,
  ]);

  // ── Details route modal map ──────────────────────────────────────────────
  useEffect(() => {
    if (activeModalType !== "details") return;
    if (!mapsApiKey || !mapsMapId) return;
    if (!activeRouteId || !detailsRouteMapRef.current) return;
    const managedRoute =
      editableRoutes.find((route) => route.id === activeRouteId) ?? null;
    if (!managedRoute) return;

    let isMounted = true;

    loadGoogleMaps(mapsApiKey)
      .then(async () => {
        if (!isMounted) return;
        const googleMaps = window.google?.maps;
        if (!googleMaps) return;
        const { Map } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("maps")
          : { Map: googleMaps.Map };
        const { AdvancedMarkerElement } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("marker")
          : { AdvancedMarkerElement: googleMaps.marker?.AdvancedMarkerElement };
        if (!AdvancedMarkerElement) return;

        if (!detailsRouteMapInstance.current) {
          const styledMapTypes = {
            light: new googleMaps.StyledMapType(null, { name: t("map.styles.light") }),
            grayscale: new googleMaps.StyledMapType(GRAYSCALE_MAP_STYLES, {
              name: t("map.styles.grayscale"),
            }),
            dark: new googleMaps.StyledMapType(DARK_MAP_STYLES, {
              name: t("map.styles.dark"),
            }),
          };
          detailsRouteMapInstance.current = new Map(detailsRouteMapRef.current!, {
            center: { lat: 0, lng: 0 },
            zoom: 3,
            mapId: mapsMapId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
            mapTypeId: mapStyle,
          });
          detailsRouteMapInstance.current.mapTypes.set("light", styledMapTypes.light);
          detailsRouteMapInstance.current.mapTypes.set(
            "grayscale",
            styledMapTypes.grayscale,
          );
          detailsRouteMapInstance.current.mapTypes.set("dark", styledMapTypes.dark);
        } else {
          detailsRouteMapInstance.current.setOptions({
            mapTypeControl: false,
            mapTypeId: mapStyle,
          });
        }

        detailsRouteMarkersRef.current.forEach(({ type, marker }) => {
          if (type === "advanced") {
            marker.map = null;
          } else {
            marker.setMap(null);
          }
        });
        detailsRouteMarkersRef.current = [];
        detailsRouteRenderersRef.current.forEach((renderer) => renderer.setMap(null));
        detailsRouteRenderersRef.current = [];

        const routePoints = managedRoute.orderIds
          .map((orderId) => ordersById.get(orderId))
          .filter(
            (order): order is LoaderOrder =>
              Boolean(order?.shippingCoordinates),
          );
        const origin = locationsById.get(managedRoute.locationId)?.coordinates;
        const bounds = new googleMaps.LatLngBounds();

        const buildLabel = (
          text: string,
          iconKind: MarkerIconKind | null,
          badgeStyle?: Partial<CSSStyleDeclaration>,
        ) => {
          const wrapper = document.createElement("div");
          wrapper.className = styles.mapLabelContainer;

          const label = document.createElement("div");
          label.className = styles.mapLabelText;
          label.classList.add(styles.mapLabelBadge);

          const textLine = document.createElement("div");
          textLine.className = styles.mapLabelOrder;
          textLine.textContent = text;

          if (iconKind) {
            const iconLine = document.createElement("div");
            iconLine.className = styles.mapLabelEmoji;
            iconLine.innerHTML = markerIconHTML(iconKind);
            label.appendChild(iconLine);
          }
          label.appendChild(textLine);
          if (badgeStyle) {
            Object.assign(label.style, badgeStyle);
          }

          wrapper.appendChild(label);
          return wrapper;
        };

        if (origin) {
          const originMarker = new AdvancedMarkerElement({
            map: detailsRouteMapInstance.current,
            position: { lat: origin.latitude, lng: origin.longitude },
            title: t("map.fulfillmentLocation"),
            content: buildLabel(t("map.fulfillmentLabel"), "storeLocation"),
          });
          detailsRouteMarkersRef.current.push({ type: "advanced", marker: originMarker });
          bounds.extend({ lat: origin.latitude, lng: origin.longitude });
        }

        routePoints.forEach((order) => {
          const coords = order.shippingCoordinates!;
          const badgeColors = deriveBadgeColors(managedRoute.color);
          const dueBucket = dueBucketByOrderId.get(order.id);
          // Warehouse-origin rows force the `warehouse` icon — overrides
          // addressError + due-bucket. Same rule as the main-map markers.
          const routeOrderIconKind: MarkerIconKind = warehouseOrderIds.has(order.id)
            ? "warehouse"
            : !order.addressValidation.isValid
              ? "addressError"
              : dueBucketIconKind(dueBucket);
          const marker = new AdvancedMarkerElement({
            map: detailsRouteMapInstance.current,
            position: { lat: coords.latitude, lng: coords.longitude },
            title: order.customerName ? `${order.name} \u2022 ${order.customerName}` : order.name,
            content: buildLabel(
              order.name,
              routeOrderIconKind,
              { backgroundColor: badgeColors.bg, borderColor: "#111111" },
            ),
          });
          detailsRouteMarkersRef.current.push({ type: "advanced", marker });
          bounds.extend({ lat: coords.latitude, lng: coords.longitude });
        });

        if (origin && routePoints.length > 0) {
          if (managedRoute.polyline) {
            const encoded = managedRoute.polyline;
            const path: Array<{ lat: number; lng: number }> = [];
            let idx = 0;
            let dlat = 0;
            let dlng = 0;
            while (idx < encoded.length) {
              let shift = 0;
              let result = 0;
              let byte: number;
              do {
                byte = encoded.charCodeAt(idx++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
              } while (byte >= 0x20);
              dlat += result & 1 ? ~(result >> 1) : result >> 1;
              shift = 0;
              result = 0;
              do {
                byte = encoded.charCodeAt(idx++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
              } while (byte >= 0x20);
              dlng += result & 1 ? ~(result >> 1) : result >> 1;
              path.push({ lat: dlat / 1e5, lng: dlng / 1e5 });
            }
            const routePolyline = new googleMaps.Polyline({
              path,
              strokeColor: managedRoute.color,
              strokeOpacity: 0.85,
              strokeWeight: 4,
              map: detailsRouteMapInstance.current,
            });
            detailsRouteRenderersRef.current.push(routePolyline);
          }
        }

        if (!bounds.isEmpty()) {
          detailsRouteMapInstance.current.fitBounds(bounds);
        }
      })
      .catch((error) => {
        console.error("Failed to initialize details route map", error);
      });

    return () => {
      isMounted = false;
    };
  }, [
    activeModalType,
    activeRouteId,
    activeRouteIndex,
    editableRoutes,
    mapsApiKey,
    mapsMapId,
    ordersById,
    locationsById,
    mapStyle,
    dueBucketByOrderId,
    dueBucketIconKind,
    warehouseOrderIds,
  ]);

  const toggleSelection = (orderId: string) => {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedOrderIds(new Set());
  };

  const autoAssignSelection = () => {
    setSelectedOrderIds(new Set(orders.map((order) => order.id)));
  };

  const handleOrderToggle = (event: Event, orderId: string) => {
    const target = event.currentTarget as { checked?: boolean } | null;
    if (!target) return;
    // EDIT MODE timer reset (2026-05-08): table checkbox toggle counts
    // as an interaction. Resets the 5s idle countdown when in edit mode.
    if (polylineEditMode) resetEditModeIdleTimer();
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (target.checked) {
        next.add(orderId);
      } else {
        next.delete(orderId);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!unassignConfirmRoute) return;
    const modal = document.getElementById("unassign-confirm-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [unassignConfirmRoute]);

  useEffect(() => {
    if (!clearAllConfirmOpen) return;
    const modal = document.getElementById("clear-all-confirm-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [clearAllConfirmOpen]);

  useEffect(() => {
    if (!exitConfirmOpen) return;
    const modal = document.getElementById("exit-confirm-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [exitConfirmOpen]);

  useEffect(() => {
    if (!isPresaleModalOpen) return;
    const modal = document.getElementById("presale-tags-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [isPresaleModalOpen]);

  useEffect(() => {
    if (!isAddressErrorsModalOpen) return;
    const modal = document.getElementById("address-errors-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
    // Reset immediately so the next click can re-trigger the effect
    setIsAddressErrorsModalOpen(false);
  }, [isAddressErrorsModalOpen]);

  useEffect(() => {
    if (!isReturnPickupsModalOpen) return;
    const modal = document.getElementById("return-pickups-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [isReturnPickupsModalOpen]);

  // Restyle precomputed-route polylines based on polyline edit mode.
  // Editing: dotted + reduced opacity (visual lerp toward white) so the
  // operator sees they're in edit state. Default: solid full opacity.
  useEffect(() => {
    const polylines = precomputedRoutePolylinesRef.current;
    if (polylines.length === 0) return;
    polylines.forEach((polyline) => {
      try {
        if (polylineEditMode) {
          polyline.setOptions({
            strokeOpacity: 0,
            strokeWeight: 2,
            icons: [
              {
                icon: { path: "M 0,-1 0,1", strokeOpacity: 0.5, scale: 3 },
                offset: "0",
                repeat: "10px",
              },
            ],
          });
        } else {
          polyline.setOptions({
            strokeOpacity: 0.85,
            strokeWeight: 4,
            icons: null,
          });
        }
      } catch (err) {
        console.warn(`[local-delivery:polyline-edit] restyle failed`, err);
      }
    });
  }, [polylineEditMode]);

  useEffect(() => {
    if (!isMapStyleModalOpen) return;
    const modal = document.getElementById("map-style-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [isMapStyleModalOpen]);

  useEffect(() => {
    if (!isRequestDriverModalOpen) return;
    const modal = document.getElementById("request-driver-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [isRequestDriverModalOpen]);

  useEffect(() => {
    if (!driverErrorModal) return;
    const modal = document.getElementById("driver-error-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [driverErrorModal]);
  // Cancel delivery response handler
  useEffect(() => {
    if (cancelFetcher.state !== "idle") return;
    const raw = cancelFetcher.data;
    if (raw == null || typeof raw !== "object") return;
    // Handle both direct { ok, routeId } and wrapped { data: { ok, routeId } } responses
    const data = ("data" in raw && raw.data != null && typeof raw.data === "object"
      ? raw.data
      : raw) as { ok?: boolean; error?: string; routeId?: string };
    const routeId = data?.routeId;
    if (!routeId) return;
    try {
      if (data.ok) {
        setLalamoveStatus((current) => ({
          ...current,
          [routeId]: { message: t("routeManager.deliveryCancelled"), tone: "critical" },
        }));
        setDispatchedRoutes((prev) => {
          const next = { ...prev };
          delete next[routeId];
          return next;
        });
        // Auto-clear the cancel success badge after 5 seconds
        const existingTimeout = lalamoveStatusTimeoutsRef.current[routeId];
        if (existingTimeout) window.clearTimeout(existingTimeout);
        lalamoveStatusTimeoutsRef.current[routeId] = window.setTimeout(() => {
          setLalamoveStatus((current) => {
            if (current[routeId]?.message !== t("routeManager.deliveryCancelled")) return current;
            const next = { ...current };
            delete next[routeId];
            return next;
          });
          delete lalamoveStatusTimeoutsRef.current[routeId];
        }, 5000);
      } else {
        setLalamoveStatus((current) => ({
          ...current,
          [routeId]: {
            message: t("driverRequest.cancelCouldNotBeCancelled"),
            tone: "critical",
            errorDetails: data.error ?? t("driverRequest.cancelFailed"),
          },
        }));
      }
    } catch (err) {
      console.warn("Cancel response handler error:", err);
    }
  }, [cancelFetcher.data, cancelFetcher.state, t]);

  // Process special requests fetch result
  useEffect(() => {
    if (!specialRequestsFetcher.data || specialRequestsFetcher.state !== "idle") return;
    const data = specialRequestsFetcher.data;
    if (data.ok && data.specialRequests) {
      setAvailableSpecialRequests(data.specialRequests);
    } else {
      setAvailableSpecialRequests([]);
    }
    setSpecialRequestsLoading(false);
  }, [specialRequestsFetcher.data, specialRequestsFetcher.state]);

  // Show address-warn modal when a route with errors is set
  useEffect(() => {
    if (addressWarnRoute) {
      const el = document.getElementById("address-warn-modal") as { showOverlay?: () => void } | null;
      el?.showOverlay?.();
    }
  }, [addressWarnRoute]);

  // Show foreign-phone-warn modal when foreign phone warning is set
  useEffect(() => {
    if (foreignPhoneWarning) {
      const el = document.getElementById("foreign-phone-modal") as { showOverlay?: () => void } | null;
      el?.showOverlay?.();
    }
  }, [foreignPhoneWarning]);

  // After revalidation triggered by "Problem fixed", re-check and auto-proceed if clean
  useEffect(() => {
    if (!addressWarnPendingRecheck || revalidator.state !== "idle" || !addressWarnRoute) return;
    setAddressWarnPendingRecheck(false);
    const routeOrders = addressWarnRoute.orderIds
      .map((id) => ordersById.get(id))
      .filter(Boolean) as LoaderOrder[];
    const stillHasErrors = routeOrders.some((o) => !o.addressValidation.isValid);
    if (!stillHasErrors) {
      hideModal("address-warn-modal");
      setAddressWarnRoute(null);
      // Proceed with the normal driver request flow
      proceedWithDriverRequest(addressWarnRoute);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressWarnPendingRecheck, revalidator.state]);

  // Show address verification modal
  useEffect(() => {
    if (addressVerifyRoute) {
      const el = document.getElementById("address-verify-modal") as
        | { showOverlay?: () => void }
        | null;
      el?.showOverlay?.();
    }
  }, [addressVerifyRoute]);

  // Set up Google Places Autocomplete on address verification inputs
  useEffect(() => {
    if (!addressVerifyRoute) {
      // Clean up autocompletes when modal closes
      addressVerifyAutocompletes.current = {};
      return;
    }
    // Ensure Google Places dropdown renders above s-modal overlay
    const styleId = "pac-container-zindex";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = ".pac-container { z-index: 100000 !important; }";
      document.head.appendChild(style);
    }
    const setupPlaces = async () => {
      const googleMaps = window.google?.maps;
      if (!googleMaps) return;
      const { Autocomplete } = googleMaps.importLibrary
        ? await googleMaps.importLibrary("places")
        : { Autocomplete: googleMaps.places?.Autocomplete };
      if (!Autocomplete) return;
      for (const [orderId, ref] of Object.entries(addressVerifyRefs.current)) {
        if (!ref || addressVerifyAutocompletes.current[orderId]) continue;
        const input = ref.querySelector("input");
        if (!input) continue;
        const ac = new Autocomplete(input, {
          fields: ["formatted_address", "geometry"],
        });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace?.();
          const formatted = place?.formatted_address;
          if (formatted) {
            setAddressVerifyEdits((prev) => ({
              ...prev,
              [orderId]: formatted,
            }));
          }
        });
        addressVerifyAutocompletes.current[orderId] = ac;
      }
    };
    // Delay to ensure refs are attached
    const timer = window.setTimeout(setupPlaces, 200);
    return () => window.clearTimeout(timer);
  }, [addressVerifyRoute]);

  // Show/hide special requests modal
  useEffect(() => {
    if (specialRequestsRoute) {
      const el = document.getElementById("special-requests-modal") as
        | { showOverlay?: () => void }
        | null;
      el?.showOverlay?.();
    }
  }, [specialRequestsRoute]);
  useEffect(() => {
    if (!cancelConfirmRouteId) return;
    const modal = document.getElementById("cancel-delivery-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [cancelConfirmRouteId]);



  // Integration log response handler
  useEffect(() => {
    if (!integrationLogFetcher.data || integrationLogFetcher.state !== "idle") return;
    const data = integrationLogFetcher.data as { ok?: boolean; events?: any[] };
    if (data.ok && data.events) {
      setIntegrationLogEvents(data.events);
      const modal = document.getElementById("integration-log-modal") as
        | { showOverlay?: () => void }
        | null;
      modal?.showOverlay?.();
    }
  }, [integrationLogFetcher.data, integrationLogFetcher.state]);



  const performUnassignEditableRoute = (
    route: PrecomputedRoute,
    routeIndex: number,
  ) => {
    if (route.orderIds.length === 0) return;
    const tag = ROUTE_TAG_DEFINITIONS[routeIndex]?.tag;
    if (!tag) return;
    const formData = new FormData();
    formData.append("intent", "unassign");
    formData.append("routeTag", tag);
    formData.append("locationId", route.locationId);
    route.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      route.orderIds.forEach((id) => next.delete(id));
      return next;
    });
    setEditableRoutes((current) =>
      current.map((r, i) =>
        i === routeIndex
          ? { ...r, orderIds: [] }
          : r,
      ),
    );
    setRouteQuoteTotals((prev) => {
      const next = { ...prev };
      delete next[route.id];
      return next;
    });
    setDirtyRouteIds((prev) => new Set(prev).add(route.id));
    setUnassignConfirmRoute(null);
    unassignFetcher.submit(formData, { method: "post" });
  };

  const performClearAllRoutes = () => {
    const allOrderIds = editableRoutes.flatMap((r) => r.orderIds);
    if (allOrderIds.length === 0) return;
    const locationIdForSubmit =
      locationId !== DEFAULT_LOCATION_ID
        ? locationId
        : editableRoutes[0]?.locationId ?? "all";
    const formData = new FormData();
    formData.append("intent", "unassign-all");
    formData.append("locationId", locationIdForSubmit);
    allOrderIds.forEach((orderId) => formData.append("orderIds", orderId));
    setSelectedOrderIds(new Set());
    setEditableRoutes((current) =>
      current.map((r) => ({ ...r, orderIds: [] })),
    );
    setRouteQuoteTotals({});
    setDirtyRouteIds(new Set());
    setClearAllConfirmOpen(false);
    unassignFetcher.submit(formData, { method: "post" });
  };


  const applyFilters = ({
    nextLocationId,
    nextPresaleTags,
  }: {
    nextLocationId?: string;
    nextPresaleTags?: string[];
  }) => {
    const payload: Record<string, string> = {
      locationId: nextLocationId ?? locationId,
    };
    const tags = nextPresaleTags ?? selectedPresaleTags;
    if (tags.length > 0) {
      payload.presaleTags = tags.join(",");
    }
    submit(payload, {
      method: "get",
      replace: true,
    });
  };

  const handleLocationChange = (event: Event) => {
    const target = event.currentTarget as { value?: string } | null;
    if (!target) return;
    const nextValue = target.value ?? DEFAULT_LOCATION_ID;
    if (nextValue === locationId) return;
    if (dirtyRouteIds.size > 0) {
      const confirmed = window.confirm(t("routeManager.discardChangesConfirm"));
      if (!confirmed) {
        target.value = locationId;
        return;
      }
    }
    window.scrollTo({ top: 0 });
    setDirtyRouteIds(new Set());
    lastFittedLocationIdRef.current = "";
    setLocationId(nextValue);
    setSelectedPresaleTags([]);
    setDraftPresaleTags([]);
    applyFilters({
      nextLocationId: nextValue,
      nextPresaleTags: [],
    });
  };

  const handleManageOrdersClick = () => {
    const googleMaps = typeof window !== "undefined" ? window.google?.maps : undefined;
    if (!mapRef.current || !googleMaps) return;

    const orderPointsAtLocation = mapData.orders.filter((point) => {
      if (locationId === DEFAULT_LOCATION_ID) return true;
      const order = ordersById.get(point.id);
      return order?.fulfillmentLocation.id === locationId;
    });
    const locationPoints = mapData.locations.filter((point) => {
      if (locationId === DEFAULT_LOCATION_ID) return true;
      return point.id === locationId;
    });
    const boundsPoints =
      orderPointsAtLocation.length > 0
        ? [...locationPoints, ...orderPointsAtLocation]
        : locationPoints;
    if (boundsPoints.length === 0) return;

    const bounds = new googleMaps.LatLngBounds();
    boundsPoints.forEach((point) => {
      bounds.extend({ lat: point.latitude, lng: point.longitude });
    });
    mapRef.current.fitBounds(bounds);
    lastFittedLocationIdRef.current = locationId;
  };

  const submitRouteAssignment = (routeValue: string) => {
    if (selectedOrderIds.size === 0) return;
    const routeIndex = Number(routeValue.split("-")[1]) - 1;
    if (routeIndex < 0) return;
    const selectedIds = Array.from(selectedOrderIds);
    const selectedSet = new Set(selectedIds);
    const projectedRoutes: PrecomputedRoute[] = (() => {
      if (routeIndex >= editableRoutes.length) {
        const withoutSelected = editableRoutes.map((route) => ({
          ...route,
          orderIds: route.orderIds.filter((orderId) => !selectedSet.has(orderId)),
        }));
        return [
          ...withoutSelected,
          {
            id: `${locationId}-${withoutSelected.length}`,
            locationId,
            polyline: "",
            color:
              ROUTE_PRECOMPUTE_COLORS[
                withoutSelected.length % ROUTE_PRECOMPUTE_COLORS.length
              ]!,
            orderIds: selectedIds,
          },
        ];
      }
      return editableRoutes.map((route, index) => {
        const withoutSelected = route.orderIds.filter(
          (orderId) => !selectedSet.has(orderId),
        );
        if (index !== routeIndex) {
          return { ...route, orderIds: withoutSelected };
        }
        return {
          ...route,
          orderIds: Array.from(new Set([...withoutSelected, ...selectedIds])),
        };
      });
    })();
    const selectedOrdersForAssignment = selectedIds
      .map((orderId) => ordersById.get(orderId))
      .filter((order): order is LoaderOrder => Boolean(order));
    const targetLocationId =
      selectedOrdersForAssignment[0]?.fulfillmentLocation.id ??
      (locationId !== DEFAULT_LOCATION_ID ? locationId : null);
    const unassignedOrdersAtLocation = targetLocationId
      ? unassignedOrders.filter(
          (order) => order.fulfillmentLocation.id === targetLocationId,
        )
      : unassignedOrders;
    const assigningAllRemainingAtLocation =
      unassignedOrdersAtLocation.length > 0 &&
      selectedIds.length === unassignedOrdersAtLocation.length &&
      unassignedOrdersAtLocation.every((order) => selectedSet.has(order.id));
    const scopedProjectedRoutes = targetLocationId
      ? projectedRoutes.filter((route) => route.locationId === targetLocationId)
      : projectedRoutes;
    const projectedRoutesWithOrdersInScope = scopedProjectedRoutes.filter(
      (route) => route.orderIds.length > 0,
    ).length;
    const projectedAssignedOrdersInScope = scopedProjectedRoutes.reduce(
      (total, route) => total + route.orderIds.length,
      0,
    );
    let pendingOptimize: { routeIndex: number; orderIds: string[] } | null =
      null;
    setEditableRoutes((current) => {
      if (routeIndex >= current.length) {
        const newRoute: PrecomputedRoute = {
          id: `${locationId}-${current.length}`,
          locationId,
          polyline: "",
          color:
            ROUTE_PRECOMPUTE_COLORS[
              current.length % ROUTE_PRECOMPUTE_COLORS.length
            ]!,
          orderIds: selectedIds,
        };
        const withoutSelected = current.map((route) => ({
          ...route,
          orderIds: route.orderIds.filter(
            (orderId) => !selectedOrderIds.has(orderId),
          ),
        }));
        pendingOptimize = { routeIndex: current.length, orderIds: selectedIds };
        return [...withoutSelected, newRoute];
      }
      const next = current.map((route, index) => {
        const withoutSelected = route.orderIds.filter(
          (orderId) => !selectedOrderIds.has(orderId),
        );
        if (index !== routeIndex) {
          return { ...route, orderIds: withoutSelected };
        }
        const nextOrderIds = Array.from(
          new Set([...withoutSelected, ...selectedIds]),
        );
        pendingOptimize = { routeIndex, orderIds: nextOrderIds };
        return { ...route, orderIds: nextOrderIds };
      });
      return next;
    });
    setRouteQuoteTotals((prev) => {
      const next = { ...prev };
      editableRoutes.forEach((route, index) => {
        const withoutSelected = route.orderIds.filter(
          (orderId) => !selectedSet.has(orderId),
        );
        if (index === routeIndex || withoutSelected.length !== route.orderIds.length) {
          delete next[route.id];
        }
      });
      return next;
    });
    // 2026-05-08 update — supersedes the 2026-05-06 "one-step assign"
    // decision per Lucas's unified EDIT MODE spec. ALL writes (Assign-to-
    // new + Add-to-route + Reassign + Unassign + Clear) now mark the
    // affected route(s) dirty. The dirty-set watcher useEffect auto-
    // enters EDIT MODE, polylines render dotted, the 5s idle timer arms,
    // and auto-confirm fires handleUpdateRoutes (server-side recompute
    // including any new routes). Manually clicking Confirm has the same
    // effect immediately. Bug 1 (assign-to-new no Confirm + no polyline)
    // and Bug 2b (Add-to-route no Confirm + no polyline) both resolve
    // because dirty marking now triggers the recompute path.
    //
    // The assignFetcher.submit is still kept here so the server learns
    // about the new route assignment immediately (the action handler
    // creates the server-side route record). The polyline recompute
    // (server-side Lalamove routing call) happens via handleUpdateRoutes
    // when the timer fires or the user clicks Confirm.
    const targetRouteId = (() => {
      if (routeIndex >= editableRoutes.length) {
        return `${locationId}-${editableRoutes.length}`;
      }
      return editableRoutes[routeIndex]?.id ?? null;
    })();
    if (targetRouteId) {
      setDirtyRouteIds((prev) => new Set(prev).add(targetRouteId));
    }
    clearSelection();
    const formData = new FormData();
    formData.append("route", routeValue);
    selectedOrderIds.forEach((orderId) =>
      formData.append("orderIds", orderId),
    );
    assignFetcher.submit(formData, { method: "post" });
  };

  const routesWithOrdersCount = useMemo(
    () =>
      editableRoutes.filter((route) => route.orderIds.length > 0).length,
    [editableRoutes],
  );

  // True when auto-assign or route-update fetchers are in flight — used to
  // disable buttons that could cause conflicts during routing operations.
  const isRoutingBusy = optimizeFetcher.state !== "idle" || updateRoutesFetcher.state !== "idle";

  const selectedOrderLocationIds = useMemo(() => {
    const ids = new Set<string>();
    selectedOrderIds.forEach((orderId) => {
      const order = ordersById.get(orderId);
      if (order?.fulfillmentLocation?.id) {
        ids.add(order.fulfillmentLocation.id);
      }
    });
    return ids;
  }, [selectedOrderIds, ordersById]);

  const assignableExistingRoutes = useMemo(() => {
    const scoped = editableRoutes.filter((route) => {
      if (route.orderIds.length === 0) return false;
      if (selectedOrderLocationIds.size > 0) {
        return selectedOrderLocationIds.has(route.locationId);
      }
      if (locationId === DEFAULT_LOCATION_ID) return true;
      return route.locationId === locationId;
    });
    const byId = new Map<string, PrecomputedRoute>();
    scoped.forEach((route) => {
      if (!byId.has(route.id)) {
        byId.set(route.id, route);
      }
    });
    return Array.from(byId.values());
  }, [editableRoutes, selectedOrderLocationIds, locationId]);

  const hasAssignedRoutes = routesWithOrdersCount > 0;
  const activeManagedRoute = useMemo(() => {
    if (!activeRouteId) return null;
    return editableRoutes.find((route) => route.id === activeRouteId) ?? null;
  }, [activeRouteId, editableRoutes]);

  const activeManagedRouteOrders = useMemo(() => {
    if (!activeManagedRoute) return [] as LoaderOrder[];
    return activeManagedRoute.orderIds
      .map((orderId) => ordersById.get(orderId))
      .filter((order): order is LoaderOrder => Boolean(order));
  }, [activeManagedRoute, ordersById]);

  const isManageRouteFullySelected =
    activeManagedRouteOrders.length > 0 &&
    activeManagedRouteOrders.every((order) =>
      removeFromRouteOrderIds.has(order.id),
    );

  const toggleManageRouteSelection = (checked: boolean) => {
    setRemoveFromRouteOrderIds(() => {
      if (!checked) return new Set();
      return new Set(activeManagedRouteOrders.map((order) => order.id));
    });
  };

  const toggleDraftPresaleTag = (tag: string, checked: boolean) => {
    setDraftPresaleTags((current) => {
      if (checked) {
        return Array.from(new Set([...current, tag]));
      }
      return current.filter((item) => item !== tag);
    });
  };

  const confirmPresaleTags = () => {
    const nextTags = draftPresaleTags;
    setSelectedPresaleTags(nextTags);
    setIsPresaleModalOpen(false);
    applyFilters({ nextPresaleTags: nextTags });
  };

  const confirmMapStyle = () => {
    setMapStyle(draftMapStyle);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, draftMapStyle);
    }
    setIsMapStyleModalOpen(false);
  };

  const assignToNextEmptyRoute = () => {
    const nextEmptyIndex = editableRoutes.findIndex(
      (route) => route.orderIds.length === 0,
    );
    if (nextEmptyIndex === -1) return;
    const nextRoute = `rota-${nextEmptyIndex + 1}`;
    submitRouteAssignment(nextRoute);
  };

  const handleAssignToNewRoute = () => {
    if (selectedOrderIds.size === 0) return;
    assignToNextEmptyRoute();
  };

  const handleAddSelectedToRoute = (routeIndex: number) => {
    if (selectedOrderIds.size === 0) return;
    submitRouteAssignment(`rota-${routeIndex + 1}`);
  };

  const handleUnassignSelected = () => {
    const toUnassign = [...selectedOrderIds].filter((id) => assignedOrderIds.has(id));
    if (toUnassign.length === 0) return;

    const byRoute = new Map<number, { tag: string; locationId: string; orderIds: string[] }>();
    for (const orderId of toUnassign) {
      const route = orderRouteMap.get(orderId);
      if (!route) continue;
      const routeIndex = editableRoutes.findIndex((r) => r.id === route.id);
      if (routeIndex < 0) continue;
      const tag = ROUTE_TAG_DEFINITIONS[routeIndex]?.tag;
      if (!tag) continue;
      let entry = byRoute.get(routeIndex);
      if (!entry) {
        entry = { tag, locationId: route.locationId, orderIds: [] };
        byRoute.set(routeIndex, entry);
      }
      entry.orderIds.push(orderId);
    }

    const unassignSet = new Set(toUnassign);
    setEditableRoutes((current) =>
      current.map((route) => ({
        ...route,
        orderIds: route.orderIds.filter((id) => !unassignSet.has(id)),
      })),
    );
    setRouteQuoteTotals((prev) => {
      const next = { ...prev };
      for (const orderId of toUnassign) {
        const route = orderRouteMap.get(orderId);
        if (route) delete next[route.id];
      }
      return next;
    });
    setDirtyRouteIds((prev) => {
      const next = new Set(prev);
      for (const orderId of toUnassign) {
        const route = orderRouteMap.get(orderId);
        if (route) next.add(route.id);
      }
      return next;
    });
    clearSelection();

    const entries = [...byRoute.values()];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const formData = new FormData();
      formData.append("intent", "unassign");
      formData.append("routeTag", entry.tag);
      formData.append("locationId", entry.locationId);
      entry.orderIds.forEach((id) => formData.append("orderIds", id));
      if (i === 0) {
        unassignFetcher.submit(formData, { method: "post" });
      } else {
        submit(formData, { method: "post" });
      }
    }
  };

  // Polyline editor: reassign all selected stops to the given target route.
  // Only mutates local state + marks affected routes dirty — the actual
  // recompute happens on Confirm via handleUpdateRoutes. Respects the
  // 7-orders-per-route hard cap (CLAUDE.md feedback_max_orders_per_route).
  // If the target would exceed the cap, no state mutation; surface a banner.
  const handleMoveSelectedToRoute = (targetRouteId: string) => {
    if (selectedOrderIds.size === 0) return;
    const targetRoute = editableRoutes.find((route) => route.id === targetRouteId);
    if (!targetRoute) return;
    // Only operate on selected orders that are currently assigned to a route
    // at the same location as the target. Unassigned selections + cross-location
    // selections are silently filtered (operator can re-do via the existing
    // assign flow).
    const selectedIds = [...selectedOrderIds];
    const movableIds = selectedIds.filter((id) => {
      const current = orderRouteMap.get(id);
      return current != null && current.locationId === targetRoute.locationId;
    });
    if (movableIds.length === 0) return;
    const movableSet = new Set(movableIds);
    // Compute the projected target order list (deduped) BEFORE mutating.
    const projectedTargetOrders = Array.from(
      new Set([
        ...targetRoute.orderIds.filter((id) => !movableSet.has(id)),
        ...targetRoute.orderIds,
        ...movableIds,
      ]),
    );
    if (projectedTargetOrders.length > 7) {
      const routeIndex = editableRoutes.findIndex((r) => r.id === targetRouteId);
      const routeName = t("routeManager.routeLabel", {
        number: routeIndex >= 0 ? routeIndex + 1 : "?",
      });
      setPolylineEditCapBanner(
        t("map.polylineEdit.cantExceedCap", { routeName }),
      );
      return;
    }
    // Track which routes are dirty BEFORE mutating: source routes that lose
    // an order + the target route.
    const sourceRouteIds = new Set<string>();
    for (const id of movableIds) {
      const src = orderRouteMap.get(id);
      if (src && src.id !== targetRouteId) sourceRouteIds.add(src.id);
    }
    setEditableRoutes((current) =>
      current.map((route) => {
        if (route.id === targetRouteId) {
          return {
            ...route,
            orderIds: Array.from(
              new Set([
                ...route.orderIds.filter((id) => !movableSet.has(id)),
                ...movableIds,
              ]),
            ),
          };
        }
        if (sourceRouteIds.has(route.id)) {
          return {
            ...route,
            orderIds: route.orderIds.filter((id) => !movableSet.has(id)),
          };
        }
        return route;
      }),
    );
    setDirtyRouteIds((prev) => {
      const next = new Set(prev);
      next.add(targetRouteId);
      sourceRouteIds.forEach((id) => next.add(id));
      return next;
    });
    // Clear quote totals for affected routes — quotes are stale post-move.
    setRouteQuoteTotals((prev) => {
      const next = { ...prev };
      delete next[targetRouteId];
      sourceRouteIds.forEach((id) => {
        delete next[id];
      });
      return next;
    });
    clearSelection();
    setPolylineEditCapBanner(null);
    console.info(
      `[local-delivery:polyline-edit] reassigned orders=${movableIds.length} target=${targetRouteId} sources=${[...sourceRouteIds].join(",")}`,
    );
  };

  // EDIT MODE — 5s idle timer helpers (2026-05-08).
  // resetEditModeIdleTimer is called from every watched interaction
  // (marker click, zoom, pan, table checkbox toggle, additional writes).
  // It (re-)arms a 5-second timeout; when fired, auto-confirm runs.
  // autoConfirmFromIdleTimer is the timer's payload — same effect as
  // clicking the Confirm button.
  const resetEditModeIdleTimer = () => {
    if (editModeIdleTimerRef.current !== null) {
      window.clearTimeout(editModeIdleTimerRef.current);
    }
    editModeIdleTimerRef.current = window.setTimeout(() => {
      editModeIdleTimerRef.current = null;
      autoConfirmFromIdleTimer();
    }, 5000);
  };

  const clearEditModeIdleTimer = () => {
    if (editModeIdleTimerRef.current !== null) {
      window.clearTimeout(editModeIdleTimerRef.current);
      editModeIdleTimerRef.current = null;
    }
  };

  const autoConfirmFromIdleTimer = () => {
    // Same effect as clicking Confirm. Server-side commit happens via
    // handleUpdateRoutes. On success the dirty set drains (per-result
    // delete at line ~1039); on failure the dirty set persists, the
    // timer restarts via the dirty-set watcher useEffect, and the user
    // can retry by interacting (or clicking Confirm manually).
    handleUpdateRoutes();
  };

  // Polyline editor: enter edit mode + snapshot the state pieces Cancel
  // restores. Snapshots are deep-copied so subsequent mutations don't bleed
  // back into the snapshot.
  const enterPolylineEditMode = () => {
    preEditRoutesRef.current = editableRoutes.map((route) => ({
      ...route,
      orderIds: [...route.orderIds],
    }));
    preEditSelectionRef.current = new Set(selectedOrderIds);
    setPolylineEditCapBanner(null);
    setPolylineEditMode(true);
  };

  // Polyline editor: Cancel — restore the snapshots, clear dirty flags +
  // banner, exit edit mode. Snapshots are released after restore.
  // Also: imperatively restyle the precomputed polylines back to solid as a
  // safety net — the polyline-creation useEffect will re-run with
  // polylineEditMode=false, but if its async load callback hasn't resolved
  // yet OR the cleanup races, polylines could remain dotted/invisible. The
  // imperative setOptions guarantees the visible state matches "not editing"
  // immediately (per 2026-05-06 review: "polylines not rendered again on
  // cancel").
  const cancelPolylineEditMode = () => {
    precomputedRoutePolylinesRef.current.forEach((polyline) => {
      try {
        polyline.setOptions({
          strokeOpacity: 0.85,
          strokeWeight: 4,
          icons: null,
        });
      } catch (err) {
        console.warn(
          `[local-delivery:polyline-edit] cancel restyle failed`,
          err,
        );
      }
    });
    if (preEditRoutesRef.current) {
      setEditableRoutes(preEditRoutesRef.current);
    }
    if (preEditSelectionRef.current) {
      setSelectedOrderIds(preEditSelectionRef.current);
    }
    preEditRoutesRef.current = null;
    preEditSelectionRef.current = null;
    setDirtyRouteIds(new Set());
    setPolylineEditCapBanner(null);
    setPolylineEditMode(false);
  };

  // Polyline editor: Confirm — flush dirty routes via the existing recompute
  // path. Snapshots are released; banner cleared. handleUpdateRoutes itself
  // early-returns when nothing is dirty.
  const confirmPolylineEditMode = () => {
    handleUpdateRoutes();
    preEditRoutesRef.current = null;
    preEditSelectionRef.current = null;
    setPolylineEditCapBanner(null);
    setPolylineEditMode(false);
  };

  const unassignSingleOrderFromRoute = (orderId: string, route: PrecomputedRoute) => {
    const routeIndex = editableRoutes.findIndex((candidate) => candidate.id === route.id);
    if (routeIndex < 0) return;
    const tag = ROUTE_TAG_DEFINITIONS[routeIndex]?.tag;
    if (!tag) return;

    const formData = new FormData();
    formData.append("intent", "unassign");
    formData.append("routeTag", tag);
    formData.append("locationId", route.locationId);
    formData.append("orderIds", orderId);

    setSelectedOrderIds((current) => {
      const next = new Set(current);
      next.delete(orderId);
      return next;
    });
    setEditableRoutes((current) =>
      current.map((candidate, index) =>
        index === routeIndex
          ? {
              ...candidate,
              orderIds: candidate.orderIds.filter((id) => id !== orderId),
            }
          : candidate,
      ),
    );
    setRouteQuoteTotals((prev) => {
      const next = { ...prev };
      delete next[`${route.locationId}-${routeIndex}`];
      return next;
    });
    setDirtyRouteIds((prev) => new Set(prev).add(route.id));
    unassignFetcher.submit(formData, { method: "post" });
  };

  type DisplayOrderRow = LoaderOrder & {
    route: PrecomputedRoute | null;
    routeIndex: number | null;
  };

  const allOrderRows = useMemo<DisplayOrderRow[]>(() => {
    return orders.map((order) => {
      const route = orderRouteMap.get(order.id) ?? null;
      const routeIndex = route
        ? editableRoutes.findIndex((r) => r.id === route.id)
        : -1;
      return {
        ...order,
        route,
        routeIndex: routeIndex >= 0 ? routeIndex : null,
      };
    });
  }, [orders, orderRouteMap, editableRoutes]);

  const filteredOrderRows = useMemo(() => {
    const term = ordersSearch.trim().toLowerCase();
    return allOrderRows
      .filter((row) => {
        if (ordersFilter === "assigned" && !row.route) return false;
        if (ordersFilter === "unassigned" && row.route) return false;
        if (ordersFilter === "failed" && dueBucketByOrderId.get(row.id) !== "failed") return false;
        if (!term) return true;
        const hay = `${row.name} ${row.customerName ?? ""} ${row.address1 ?? ""}`.toLowerCase();
        return hay.includes(term);
      })
      .sort((a, b) => {
        const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0;
        const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0;
        return tb - ta;
      });
  }, [allOrderRows, ordersFilter, ordersSearch, dueBucketByOrderId]);

  const unassignedCountAll = useMemo(
    () => allOrderRows.filter((r) => !r.route).length,
    [allOrderRows],
  );
  const assignedCountAll = allOrderRows.length - unassignedCountAll;
  const failedCountAll = useMemo(
    () => allOrderRows.filter((r) => dueBucketByOrderId.get(r.id) === "failed").length,
    [allOrderRows, dueBucketByOrderId],
  );

  const scrollToOrdersSection = useCallback(() => {
    ordersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const areAllVisibleSelected = (rows: DisplayOrderRow[]) =>
    rows.length > 0 && rows.every((r) => selectedOrderIds.has(r.id));

  const toggleAllVisibleSelection = (rows: DisplayOrderRow[], select: boolean) => {
    // EDIT MODE timer reset (2026-05-08): "select all" counts as
    // interaction. Resets idle timer when in edit mode.
    if (polylineEditMode) resetEditModeIdleTimer();
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (select) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  };

  // 2026-05-12: Due column badges switched from emoji-as-text to Polaris
  // `<s-icon>` via the `icon` prop on `<s-badge>`. dueToday's icon was the
  // hourglass; replaced with `bolt` for consistency with the "act now"
  // affordance used elsewhere in the admin.
  //
  // 2026-05-14: warehouse-method override — orders whose Shopify deliveryMethod
  // is not LOCAL (surfaced via the `includeWarehouse` toggle) replace the
  // bucket-driven icon with the `package` icon (Polaris `warning` tone =
  // orange — the "operator attention required" hue used elsewhere on this
  // page). Single column, dual semantic: due state for LOCAL orders,
  // warehouse-origin marker for non-LOCAL orders.
  const renderDueBadge = (orderId: string) => {
    if (warehouseOrderIds.has(orderId)) {
      return <s-badge tone="warning" icon="package" />;
    }
    const bucket = dueBucketByOrderId.get(orderId);
    if (bucket === "failed") {
      return <s-badge tone="critical" icon="x-circle" />;
    }
    if (bucket === "overdue") {
      return <s-badge tone="critical" icon="alert-triangle" />;
    }
    if (bucket === "today") {
      return <s-badge tone="warning" icon="bolt" />;
    }
    if (bucket === "tomorrow") {
      return <s-badge tone="info" icon="clock" />;
    }
    return <s-badge icon="clock" />;
  };

  const renderRouteNotification = (route: PrecomputedRoute) => {
    const dispatch = dispatchedRoutes[route.id];
    const status = dispatch?.status ?? null;
    const lalamove = lalamoveStatus[route.id];

    if (dispatch && lalamove?.tone === "critical" && lalamove.errorDetails) {
      return (
        <>
          <s-link
            onClick={() =>
              setDriverErrorModal({
                routeId: route.id,
                message: lalamove.message,
                errorDetails: lalamove.errorDetails ?? "",
              })
            }
          >
            <s-badge tone="critical">{lalamove.message}</s-badge>
          </s-link>
          <a
            href="https://web.lalamove.com/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.goToLalamoveLink}
          >
            {t("driverRequest.goToLalamove")}
          </a>
        </>
      );
    }

    if (status && TERMINAL_DISPATCH_STATUSES.has(status)) {
      return (
        <s-badge tone={getStatusBadgeTone(status)}>
          {t(`routeManager.status.${status}`)}
        </s-badge>
      );
    }

    // NOTE: the previous "dispatch && status" branch that rendered another
    // status badge was REMOVED — the post-dispatch action row at line ~4566
    // already renders the status badge for non-terminal states, so this slot
    // duplicated it (Lucas's 2026-05-06 review: "status badge is duplicated").
    // The terminal-status branch above stays because the action row hides
    // its badge for terminal states.

    if (lalamove && !dispatch) {
      if (lalamove.tone === "success") {
        return <s-badge tone="success">{lalamove.message}</s-badge>;
      }
      if (lalamove.tone === "critical" && lalamove.errorDetails) {
        return (
          <s-link
            onClick={() =>
              setDriverErrorModal({
                routeId: route.id,
                message: lalamove.message,
                errorDetails: lalamove.errorDetails ?? "",
              })
            }
          >
            <s-badge tone="critical">{lalamove.message}</s-badge>
          </s-link>
        );
      }
      if (lalamove.tone === "critical") {
        return <s-badge tone="critical">{lalamove.message}</s-badge>;
      }
      return <s-text color="subdued">{lalamove.message}</s-text>;
    }

    if (reorderedRoutes[route.id]) {
      return (
        <s-badge tone="warning">
          {t("routeManager.reRequestedAt", { time: reorderedRoutes[route.id] })}
        </s-badge>
      );
    }

    return null;
  };

  const renderOrdersSection = () => (
    <div ref={ordersSectionRef} className={styles.ordersSectionWrap}>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack
            direction="inline"
            gap="base"
            justifyContent="space-between"
          >
            <s-text type="strong">
              {t("routeManager.allOrders", { count: allOrderRows.length })}
            </s-text>
            <s-text-field
              label={t("routeManager.searchPlaceholder")}
              labelAccessibilityVisibility="exclusive"
              placeholder={t("routeManager.searchPlaceholder")}
              value={ordersSearch}
              onChange={(e: Event) =>
                setOrdersSearch((e.currentTarget as HTMLInputElement).value)
              }
            ></s-text-field>
          </s-stack>

          <div className={styles.ordersFilterChipsRow}>
            {(["all", "unassigned", "assigned", "failed"] as const).map((key) => {
              const count =
                key === "all"
                  ? allOrderRows.length
                  : key === "unassigned"
                  ? unassignedCountAll
                  : key === "assigned"
                  ? assignedCountAll
                  : failedCountAll;
              const label =
                key === "all"
                  ? t("routeManager.filterAll")
                  : key === "unassigned"
                  ? t("routeManager.filterUnassigned")
                  : key === "assigned"
                  ? t("routeManager.filterAssigned")
                  : t("routeManager.filterFailed");
              const isActive = ordersFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`${styles.ordersFilterChip}${
                    isActive ? ` ${styles.ordersFilterChipActive}` : ""
                  }`}
                  onClick={() => setOrdersFilter(key)}
                  aria-pressed={isActive}
                >
                  {label} <span className={styles.ordersFilterChipCount}>{count}</span>
                </button>
              );
            })}
          </div>

          {filteredOrderRows.length === 0 ? (
            <s-text color="subdued">
              {ordersSearch || ordersFilter !== "all"
                ? t("routeManager.noMatchingOrders")
                : t("routeManager.noUnassigned")}
            </s-text>
          ) : (
            <div
              className={styles.dueOrdersTable}
              data-mode={isFullscreen ? "expanded" : "collapsed"}
              data-no-cb={locationId === DEFAULT_LOCATION_ID ? "true" : undefined}
            >
              <div className={styles.dueOrdersHeader}>
                {locationId !== DEFAULT_LOCATION_ID ? (
                  <span>
                    <s-checkbox
                      accessibilityLabel={t("routeManager.selectAll")}
                      checked={areAllVisibleSelected(filteredOrderRows)}
                      onChange={(event) => {
                        const target = event.currentTarget as
                          | { checked?: boolean }
                          | null;
                        toggleAllVisibleSelection(
                          filteredOrderRows,
                          Boolean(target?.checked),
                        );
                      }}
                    />
                  </span>
                ) : null}
                <span>{t("routeManager.table.order")}</span>
                <span>{t("routeManager.table.customer")}</span>
                <span>{t("routeManager.table.date")}</span>
                <span className={styles.dueOrdersCenterCell}>{t("routeManager.table.due")}</span>
                <span className={styles.dueOrdersCenterCell}>{t("routeManager.table.route")}</span>
                <span>{t("routeManager.table.address")}</span>
              </div>
              {filteredOrderRows.map((row) => {
                const isSelected = selectedOrderIds.has(row.id);
                const routeBadgeColors = row.route
                  ? deriveBadgeColors(row.route.color)
                  : null;
                return (
                  <div
                    key={row.id}
                    className={`${styles.dueOrdersRow} ${styles.dueOrdersRowClickable}`}
                    onClick={(event) => {
                      // Skip if the click originated on an interactive child
                      // (checkbox, action button) — those have their own
                      // handlers and should not also open the modal.
                      const target = event.target as HTMLElement | null;
                      if (target?.closest("s-checkbox, s-button, button")) return;
                      setOrderDetailsModalOrderId(row.id);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOrderDetailsModalOrderId(row.id);
                      }
                    }}
                  >
                    {locationId !== DEFAULT_LOCATION_ID ? (
                      <span>
                        <s-checkbox
                          accessibilityLabel={t("routeManager.selectOrder", { name: row.name })}
                          checked={isSelected}
                          onChange={(event) => handleOrderToggle(event, row.id)}
                        />
                      </span>
                    ) : null}
                    <span className={styles.dueOrdersOrderName}>{row.name}</span>
                    {/* Customer + Address cells truncate with ellipsis at
                        their fixed column width; title= exposes the full
                        value on hover. v3 fixed-width grid (2026-05-12). */}
                    <span title={row.customerName ?? t("customer.guest")}>
                      {formatCustomerShort(row.customerName, t("customer.guest"))}
                    </span>
                    <span>{formatOrderDateShort(row.processedAt)}</span>
                    <span className={styles.dueOrdersCenterCell}>{renderDueBadge(row.id)}</span>
                    <span className={`${styles.dueOrdersCenterCell} ${styles.routeWithUnassignCell}`}>
                      {row.route && row.routeIndex !== null && routeBadgeColors ? (
                        <>
                          <span
                            className={styles.routeBadge}
                            style={
                              {
                                "--badge-bg": routeBadgeColors.bg,
                                "--badge-text": routeBadgeColors.text,
                              } as CSSProperties
                            }
                          >
                            {t(
                              isFullscreen
                                ? "routeManager.routeLabel"
                                : "routeManager.routeLabelCompact",
                              { number: String(row.routeIndex + 1).padStart(2, "0") },
                            )}
                          </span>
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            icon="x-circle"
                            accessibilityLabel={t("routeManager.rowAction.unassign")}
                            onClick={() => unassignSingleOrderFromRoute(row.id, row.route!)}
                          ></s-button>
                        </>
                      ) : (
                        <span className={styles.routeUnassignedDash}>—</span>
                      )}
                    </span>
                    <span title={row.address1 ?? undefined}>
                      {row.address1 ?? t("routeManager.noAddressLine1")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </s-stack>
      </s-section>
    </div>
  );

  const updateLalamoveField = (field: keyof LalamoveConfig, value: string) => {
    setSettingsSaved(false);
    setLalamoveSettings((current) => ({ ...current, [field]: value }));
  };

  const saveLocationSettings = () => {
    if (!settingsLocationId) return;
    const formData = new FormData();
    formData.append("intent", "save-lalamove-settings");
    formData.append("locationId", settingsLocationId);
    formData.append("market", lalamoveSettings.market);
    formData.append("city", lalamoveSettings.city);
    formData.append("language", lalamoveSettings.language);
    formData.append(
      "preferredServiceType",
      lalamoveSettings.preferredServiceType,
    );
    formData.append("locationName", lalamoveSettings.locationName);
    formData.append("locationPhone", lalamoveSettings.locationPhone);
    formData.append("locationAddress", lalamoveSettings.locationAddress);
    formData.append("locationDetails", lalamoveSettings.locationDetails);
    formData.append("pickupInstructions", lalamoveSettings.pickupInstructions);
    lalamoveSettingsFetcher.submit(formData, { method: "post" });
  };

  const handleOptimizeFleet = () => {
    // Bug 2a fix (2026-05-08): exclude orders carrying ld_failed-delivery
    // (or any tag in the failed-delivery family from getAllFailedDeliveryTags)
    // at candidate collection -- BEFORE any route placement runs. Per
    // inputs/backlog/local-delivery.md > "Assignment logic": these orders
    // must NEVER be added to a route by auto-assign. Operator-driven
    // dispatch only after the address/contact issue is resolved and the
    // tag is removed.
    const failedDeliveryTagSet = new Set(getAllFailedDeliveryTags());
    const candidates = unassignedOrders
      .filter((order) =>
        locationId === DEFAULT_LOCATION_ID
          ? true
          : order.fulfillmentLocation.id === locationId,
      )
      .filter(
        (order) => !order.tags.some((t) => failedDeliveryTagSet.has(t)),
      )
      .filter(
        (order) =>
          Boolean(order.shippingCoordinates) &&
          Boolean(order.fulfillmentLocation.coordinates),
      )
      .map((order) => ({
        orderId: order.id,
        orderName: order.name,
        locationId: order.fulfillmentLocation.id,
        shippingCoordinates: order.shippingCoordinates!,
        locationCoordinates: order.fulfillmentLocation.coordinates!,
        mustAssign: dueBucketByOrderId.get(order.id) === "today",
        processedAt: order.processedAt ?? null,
      }));
    if (candidates.length === 0) return;
    autoAssignActiveRef.current = true;
    prevUnassignedCountRef.current = unassignedOrders.length;
    autoAssignCandidateMapRef.current = new Map(
      candidates.map((c) => [c.orderId, ordersById.get(c.orderId)?.name ?? c.orderId]),
    );
    optimizeLocationRef.current = locationId;
    setOptimizeProgress({
      phase: "Generating candidate clusterings...",
      pct: 0,
      startedAt: Date.now(),
      estimatedMs: Math.max(8000, candidates.length * 1600),
      orderCount: candidates.length,
    });
    const formData = new FormData();
    formData.append("intent", "optimize-fleet");
    formData.append("ordersPayload", JSON.stringify(candidates));
    optimizeFetcher.submit(formData, { method: "post" });
  };

  const handleUpdateRoutes = () => {
    if (dirtyRouteIds.size === 0) return;
    const dirtyRoutes = editableRoutes
      .filter((route) => dirtyRouteIds.has(route.id) && route.orderIds.length > 0);
    console.info("[local-delivery:handleUpdateRoutes] dirtyRouteIds=%s dirtyRoutesWithOrders=%d allEditableRoutes=%s",
      Array.from(dirtyRouteIds).join(","), dirtyRoutes.length,
      editableRoutes.map((r) => `${r.id}:orders=${r.orderIds.length}:polyLen=${r.polyline?.length ?? 0}`).join(" | "));
    if (dirtyRoutes.length === 0) {
      setDirtyRouteIds(new Set());
      return;
    }
    const routesPayload = dirtyRoutes.map((route, _) => {
      const routeIndex = editableRoutes.findIndex((r) => r.id === route.id);
      return {
        routeId: route.id,
        routeIndex,
        locationId: route.locationId,
        orderIds: route.orderIds,
      };
    });
    console.info("[local-delivery:handleUpdateRoutes] SUBMITTING %d routes: %s",
      routesPayload.length, routesPayload.map((r) => `${r.routeId}:idx=${r.routeIndex}:orders=${r.orderIds.length}`).join(" | "));
    const formData = new FormData();
    formData.append("intent", "update-routes");
    formData.append("routesPayload", JSON.stringify(routesPayload));
    formData.append("locationId", locationId);
    updateRoutesFetcher.submit(formData, { method: "post" });
  };

  const handleAddToBestRoute = () => {
    const unassigned = unassignedOrders
      .filter((order) => selectedOrderIds.has(order.id))
      .filter((order) =>
        locationId === DEFAULT_LOCATION_ID
          ? true
          : order.fulfillmentLocation.id === locationId,
      )
      .filter(
        (order) =>
          Boolean(order.shippingCoordinates) &&
          Boolean(order.fulfillmentLocation.coordinates),
      )
      .map((order) => ({
        orderId: order.id,
        locationId: order.fulfillmentLocation.id,
        shippingCoordinates: order.shippingCoordinates!,
        locationCoordinates: order.fulfillmentLocation.coordinates!,
        mustAssign: dueBucketByOrderId.get(order.id) === "today",
        processedAt: order.processedAt ?? null,
      }));
    const routes = editableRoutes
      .map((r, index) => ({ routeIndex: index, locationId: r.locationId, orderIds: r.orderIds }))
      .filter((r) => r.orderIds.length > 0);
    if (unassigned.length === 0 || routes.length === 0) return;
    autoAssignActiveRef.current = false;
    const formData = new FormData();
    formData.append("intent", "add-to-best-route");
    formData.append("unassignedPayload", JSON.stringify(unassigned));
    formData.append("routesPayload", JSON.stringify(routes));
    optimizeFetcher.submit(formData, { method: "post" });
  };

    const handleCancelDelivery = (routeId: string) => {
    const formData = new FormData();
    formData.append("intent", "lalamove-cancel-order");
    formData.append("routeId", routeId);
    setLalamoveStatus((current) => ({
      ...current,
      [routeId]: { message: t("driverRequest.cancelling") },
    }));
    setLalamoveBusyRouteId(routeId);
    cancelFetcher.submit(formData, { method: "post" });
    setCancelConfirmRouteId(null);
  };

  const handleFetchTracking = (routeId: string) => {
    const dispatch = dispatchedRoutes[routeId];
    if (!dispatch?.lalamoveOrderId || !dispatch?.market) return;
    const formData = new FormData();
    formData.append("intent", "lalamove-reconcile-status");
    formData.append("lalamoveOrderId", dispatch.lalamoveOrderId);
    formData.append("market", dispatch.market);
    trackingFetcher.submit(formData, { method: "post" });
    trackingRouteRef.current = routeId;
  };

  const handleOpenIntegrationLog = (routeId: string) => {
    setIntegrationLogRouteId(routeId);
    const formData = new FormData();
    formData.append("intent", "fetch-integration-log");
    formData.append("routeId", routeId);
    integrationLogFetcher.submit(formData, { method: "post" });
  };

  // ── Bulk Route Manager actions ─────────────────────────────────
  // Both iterate routes at the active location and call existing server
  // intents per route, bypassing the route-card UI flow. Posts go through
  // raw fetch() so we can chain quote → place-order without sharing the
  // single useFetcher state machine across N routes.
  const [bulkOpStatus, setBulkOpStatus] = useState<{
    kind: "quote" | "dispatch";
    total: number;
    completed: number;
  } | null>(null);

  const postIntent = async (formData: FormData): Promise<unknown> => {
    const intent = String(formData.get("intent") ?? "?");
    const res = await fetch(window.location.pathname + window.location.search, {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      console.error(
        `[local-delivery:bulk] postIntent non-JSON response intent=${intent} status=${res.status} contentType=${res.headers.get("content-type") ?? "?"} bodyPreview=${text.slice(0, 200)}`,
      );
      return null;
    }
  };

  const handleQuoteAllRoutes = async () => {
    if (locationId === DEFAULT_LOCATION_ID) return;
    const routes = editableRoutes.filter(
      (r) => r.locationId === locationId && r.orderIds.length > 0,
    );
    if (routes.length === 0) return;
    setBulkOpStatus({ kind: "quote", total: routes.length, completed: 0 });
    console.info(`[local-delivery:bulk] quote-all START location=${locationId} routes=${routes.length}`);
    for (const route of routes) {
      const formData = new FormData();
      formData.append("intent", "lalamove-quote");
      formData.append("routeId", route.id);
      formData.append("locationId", route.locationId);
      route.orderIds.forEach((id) => formData.append("orderIds", id));
      try {
        const quoteRes = (await postIntent(formData)) as { ok?: boolean; error?: string } | null;
        if (!quoteRes?.ok) {
          console.warn(
            `[local-delivery:bulk] quote-all SKIP route=${route.id} reason=${quoteRes?.error ?? "unknown"}`,
          );
        }
      } catch (err) {
        console.error(`[local-delivery:bulk] quote-all FAILED route=${route.id}`, err);
      }
      setBulkOpStatus((prev) => (prev ? { ...prev, completed: prev.completed + 1 } : null));
    }
    console.info(`[local-delivery:bulk] quote-all OK location=${locationId} routes=${routes.length}`);
    setBulkOpStatus(null);
    revalidator.revalidate();
  };

  const handleDispatchAllRoutes = async () => {
    if (locationId === DEFAULT_LOCATION_ID) return;
    const routes = editableRoutes.filter(
      (r) => r.locationId === locationId && r.orderIds.length > 0,
    );
    if (routes.length === 0) return;
    setBulkOpStatus({ kind: "dispatch", total: routes.length, completed: 0 });
    console.info(`[local-delivery:bulk] dispatch-all START location=${locationId} routes=${routes.length}`);
    for (const route of routes) {
      try {
        // Phase 1 — fetch quote
        const quoteForm = new FormData();
        quoteForm.append("intent", "lalamove-quote");
        quoteForm.append("routeId", route.id);
        quoteForm.append("locationId", route.locationId);
        route.orderIds.forEach((id) => quoteForm.append("orderIds", id));
        const quoteRes = (await postIntent(quoteForm)) as
          | {
              ok?: boolean;
              quotationId?: string;
              total?: string | null;
              currency?: string | null;
              stopIds?: string[];
              orderIds?: string[];
              deliveryAssignments?: unknown;
            }
          | null;
        if (!quoteRes?.ok || !quoteRes.quotationId || !Array.isArray(quoteRes.stopIds)) {
          let preview = "?";
          try {
            preview = JSON.stringify(quoteRes)?.slice(0, 300) ?? "?";
          } catch {
            preview = "[unserializable]";
          }
          console.warn(
            `[local-delivery:bulk] dispatch-all SKIP route=${route.id} reason=quote-failed response=${preview}`,
          );
        } else {
          // Phase 2 — place order
          const placeForm = new FormData();
          placeForm.append("intent", "lalamove-place-order");
          placeForm.append("routeId", route.id);
          placeForm.append("locationId", route.locationId);
          placeForm.append("quotationId", quoteRes.quotationId);
          placeForm.append("quotationTotal", quoteRes.total ?? "");
          placeForm.append("quotationCurrency", quoteRes.currency ?? "");
          quoteRes.stopIds.forEach((id) => placeForm.append("stopIds", id));
          (quoteRes.orderIds ?? route.orderIds).forEach((id) =>
            placeForm.append("orderIds", id),
          );
          if (quoteRes.deliveryAssignments) {
            placeForm.append("deliveryAssignments", JSON.stringify(quoteRes.deliveryAssignments));
          }
          if (
            (quoteRes.orderIds ?? route.orderIds).some((id: string) =>
              warehouseOrderIds.has(id),
            )
          ) {
            placeForm.append("methodOverride", "1");
          }
          await postIntent(placeForm);
        }
      } catch (err) {
        console.error(`[local-delivery:bulk] dispatch-all FAILED route=${route.id}`, err);
      }
      setBulkOpStatus((prev) => (prev ? { ...prev, completed: prev.completed + 1 } : null));
    }
    console.info(`[local-delivery:bulk] dispatch-all OK location=${locationId} routes=${routes.length}`);
    setBulkOpStatus(null);
    // Item 7: revalidate-with-retry guard. The shop-ingest:reconcile
    // background job can hold the DB pool, causing the post-dispatch
    // loader call to 502 after ~9s. Retry once after 2s; if that also
    // fails, surface a non-blocking banner so the operator knows their
    // dispatches DID happen, only the UI state is stale.
    try {
      await Promise.resolve(revalidator.revalidate());
    } catch (err) {
      console.warn(`[local-delivery:bulk] dispatch-all revalidate FAILED, retrying in 2s shop=${shop}`, err);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        await Promise.resolve(revalidator.revalidate());
      } catch (retryErr) {
        console.error(`[local-delivery:bulk] dispatch-all revalidate FAILED after retry shop=${shop}`, retryErr);
        setDispatchAllStaleBanner(t("routeManager.dispatchAllStaleAfterDispatch"));
      }
    }
  };

  const proceedWithDriverRequest = (route: PrecomputedRoute) => {
    // Submit quote directly — no address verification modal
    const formData = new FormData();
    formData.append("intent", "lalamove-quote");
    formData.append("routeId", route.id);
    formData.append("locationId", route.locationId);
    route.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
    // Clear any stale lalamoveStatus message — the spinner button already
    // signals "request in flight"; no text needed (per 2026-05-06 review).
    setLalamoveStatus((current) => {
      const next = { ...current };
      delete next[route.id];
      return next;
    });
    setLalamoveBusyRouteId(route.id);
    lalamoveFetcher.submit(formData, { method: "post" });
  };

  const handleRequestDriver = (route: PrecomputedRoute) => {
    const routeOrders = route.orderIds
      .map((id) => ordersById.get(id))
      .filter(Boolean) as LoaderOrder[];
    const hasAddressErrors = routeOrders.some((o) => !o.addressValidation.isValid);
    if (hasAddressErrors) {
      setAddressWarnRoute(route);
      return;
    }
    proceedWithDriverRequest(route);
  };

  const hideModal = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Polaris s-modal supports hideOverlay() or the --hide command
    if ("hideOverlay" in el) {
      (el as any).hideOverlay();
    } else if ("hide" in el) {
      (el as any).hide();
    }
  };

  const handleAddressVerifyConfirm = () => {
    if (!addressVerifyRoute) return;
    const route = addressVerifyRoute;
    // Explicitly close address-verify modal before proceeding
    hideModal("address-verify-modal");
    setAddressVerifyRoute(null);
    // Skip special requests — submit quote directly
    const formData = new FormData();
    formData.append("intent", "lalamove-quote");
    formData.append("routeId", route.id);
    formData.append("locationId", route.locationId);
    route.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
    // Pass any edited addresses from address verification
    if (Object.keys(addressVerifyEdits).length > 0) {
      formData.append("addressEdits", JSON.stringify(addressVerifyEdits));
    }
    // Clear any stale lalamoveStatus message — the spinner button already
    // signals "request in flight"; no text needed (per 2026-05-06 review).
    setLalamoveStatus((current) => {
      const next = { ...current };
      delete next[route.id];
      return next;
    });
    setLalamoveBusyRouteId(route.id);
    lalamoveFetcher.submit(formData, { method: "post" });
  };

  const handleSubmitQuoteWithSpecialRequests = () => {
    if (!specialRequestsRoute) return;
    const route = specialRequestsRoute;
    // Explicitly close special-requests modal before submitting
    hideModal("special-requests-modal");
    const formData = new FormData();
    formData.append("intent", "lalamove-quote");
    formData.append("routeId", route.id);
    formData.append("locationId", route.locationId);
    route.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
    // Pass selected special requests
    const selected = Array.from(selectedSpecialRequests);
    if (selected.length > 0) {
      selected.forEach((sr) => formData.append("specialRequests", sr));
    }
    // Pass selected wait-time option (only if parent toggle is checked and selection is valid)
    if (waitTimeExpanded && selectedWaitTime) {
      formData.append("specialRequests", selectedWaitTime);
    }
    // Pass any edited addresses from address verification
    if (Object.keys(addressVerifyEdits).length > 0) {
      formData.append("addressEdits", JSON.stringify(addressVerifyEdits));
    }
    // Clear any stale lalamoveStatus message — the spinner button already
    // signals "request in flight"; no text needed (per 2026-05-06 review).
    setLalamoveStatus((current) => {
      const next = { ...current };
      delete next[route.id];
      return next;
    });
    setLalamoveBusyRouteId(route.id);
    lalamoveFetcher.submit(formData, { method: "post" });
    setSpecialRequestsRoute(null);
    resetWaitTimeState();
  };

  const handlePlaceOrderFromCard = (route: PrecomputedRoute, routeIndex: number) => {
    if (!quotePreview || quotePreview.routeId !== route.id) return;
    const formData = new FormData();
    formData.append("intent", "lalamove-place-order");
    formData.append("routeId", quotePreview.routeId);
    formData.append("locationId", quotePreview.locationId);
    formData.append("quotationId", quotePreview.quotationId);
    formData.append("quotationTotal", quotePreview.total ?? "");
    formData.append("quotationCurrency", quotePreview.currency ?? "");
    quotePreview.stopIds.forEach((stopId) => formData.append("stopIds", stopId));
    quotePreview.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
    formData.append("deliveryAssignments", JSON.stringify(quotePreview.deliveryAssignments));
    const confirmedRouteTag = ROUTE_TAG_DEFINITIONS[routeIndex]?.tag ?? null;
    if (confirmedRouteTag) formData.append("routeTag", confirmedRouteTag);
    // Warehouse-method override: flag the dispatch if any of the orders in this
    // route originated as non-LOCAL (surfaced via the includeWarehouse toggle).
    // The action handler reads this and writes both LalamoveDispatchJob.methodOverride
    // and the ld_method-override Shopify tag on each warehouse-method order.
    const routeContainsWarehouseOrder = quotePreview.orderIds.some((id) =>
      warehouseOrderIds.has(id),
    );
    if (routeContainsWarehouseOrder) {
      formData.append("methodOverride", "1");
    }
    setLalamoveBusyRouteId(route.id);
    lalamoveFetcher.submit(formData, { method: "post" });
  };

  const handleCollectReturns = () => {
    if (selectedReturnIds.size === 0) return;
    const formData = new FormData();
    formData.append("intent", "return-pickup-quote");
    formData.append("locationId", locationId);
    formData.append("returnInstructions", returnInstructions);
    selectedReturnIds.forEach((id) => formData.append("returnRequestIds", id));
    returnPickupFetcher.submit(formData, { method: "post" });
  };

  const handleConfirmReturnPickup = () => {
    if (!returnQuotePreview) return;
    const formData = new FormData();
    formData.append("intent", "return-pickup-place-order");
    formData.append("locationId", returnQuotePreview.locationId);
    formData.append("quotationId", returnQuotePreview.quotationId);
    formData.append("returnInstructions", returnInstructions);
    returnQuotePreview.stopIds.forEach((id) => formData.append("stopIds", id));
    returnQuotePreview.requestIds.forEach((id) => formData.append("returnRequestIds", id));
    returnPickupFetcher.submit(formData, { method: "post" });
  };

  const toggleReturnSelection = (id: string) => {
    setSelectedReturnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setReturnQuotePreview(null);
    setReturnPickupError(null);
  };

  const toggleAllReturnSelection = (checked: boolean) => {
    if (checked) {
      setSelectedReturnIds(new Set(pendingReturnPickups.map((r) => r.id)));
    } else {
      setSelectedReturnIds(new Set());
    }
    setReturnQuotePreview(null);
    setReturnPickupError(null);
  };

  const getRouteLabel = (_route: PrecomputedRoute, routeIndex?: number): string => {
    if (routeIndex != null && ROUTE_TAG_DEFINITIONS[routeIndex]) {
      return ROUTE_TAG_DEFINITIONS[routeIndex].label;
    }
    return t("routeManager.route", { number: String((routeIndex ?? 0) + 1).padStart(2, "0") });
  };

  const formatDurationSummary = (seconds: number) => {
    const safe = Math.max(0, Math.trunc(seconds));
    const hours = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    return t("routeManager.durationFormat", { hours, mins });
  };

  const openManageRouteModal = (route: PrecomputedRoute, routeIndex: number) => {
    setActiveRouteId(route.id);
    setActiveRouteIndex(routeIndex);
    setActiveModalType("manage");
    setRemoveFromRouteOrderIds(new Set());
    type ModalEl = { showOverlay?: () => void };
    const modal = document.getElementById("manage-route-modal") as ModalEl | null;
    modal?.showOverlay?.();
  };

  const openDetailsRouteModal = (route: PrecomputedRoute, routeIndex: number) => {
    setActiveRouteId(route.id);
    setActiveRouteIndex(routeIndex);
    setActiveModalType("details");
    type ModalEl = { showOverlay?: () => void };
    const modal = document.getElementById("details-route-modal") as ModalEl | null;
    modal?.showOverlay?.();
  };

  const closeEditRoute = () => {
    setActiveRouteId(null);
    setActiveRouteIndex(null);
    setActiveModalType(null);
    setRemoveFromRouteOrderIds(new Set());
  };

  const toggleRemoveRouteOrder = (orderId: string) => {
    setRemoveFromRouteOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const saveRouteEdits = () => {
    if (!activeRouteId) return;
    if (removeFromRouteOrderIds.size === 0) {
      closeEditRoute();
      return;
    }
    const routeIndex = editableRoutes.findIndex((r) => r.id === activeRouteId);
    const tag = routeIndex >= 0 ? ROUTE_TAG_DEFINITIONS[routeIndex]?.tag : undefined;
    const route = routeIndex >= 0 ? editableRoutes[routeIndex] : undefined;
    const idsToRemove = Array.from(removeFromRouteOrderIds);

    setEditableRoutes((current) =>
      current.map((r) =>
        r.id === activeRouteId
          ? {
              ...r,
              orderIds: r.orderIds.filter(
                (orderId) => !removeFromRouteOrderIds.has(orderId),
              ),
            }
          : r,
      ),
    );
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      idsToRemove.forEach((id) => next.delete(id));
      return next;
    });

    // Clear stale Lalamove state when route composition changes
    setLalamoveStatus((current) => {
      const next = { ...current };
      delete next[activeRouteId];
      return next;
    });
    setRouteQuoteTotals((current) => {
      const next = { ...current };
      delete next[activeRouteId];
      return next;
    });
    setDirtyRouteIds((prev) => new Set(prev).add(activeRouteId));
    if (quotePreview?.routeId === activeRouteId) {
      setQuotePreview(null);
    }
    const existingTimeout = lalamoveStatusTimeoutsRef.current[activeRouteId];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
      delete lalamoveStatusTimeoutsRef.current[activeRouteId];
    }
    // Allow fresh dispatch attempt if previous one failed
    setDispatchedRoutes((current) => {
      const existing = current[activeRouteId];
      if (existing && TERMINAL_DISPATCH_STATUSES.has(existing.status ?? "")) {
        const next = { ...current };
        delete next[activeRouteId];
        return next;
      }
      return current;
    });

    closeEditRoute();

    if (tag && route) {
      const formData = new FormData();
      formData.append("intent", "unassign");
      formData.append("routeTag", tag);
      formData.append("locationId", route.locationId);
      idsToRemove.forEach((id) => formData.append("orderIds", id));
      unassignFetcher.submit(formData, { method: "post" });
    }
  };

  // Hide desktop tree while the viewport-redirect navigation is in flight.
  // All hooks above still run (React rules) but no JSX is emitted, avoiding a
  // flash of desktop UI on mobile viewports during navigation.
  if (hidingForMobileRedirect) return null;

  // Single consolidated aside section — Fulfillment details merged in.
  // Location selector at the top; warning stack + routes show only when a
  // specific location is selected. Per-location delivery promise + cutoff
  // come from the Settings page (lalamoveConfigs), no longer surfaced here.
  const isLocationSelected = locationId !== DEFAULT_LOCATION_ID;
  // Address-error badge is visible regardless of location filter (per
  // Item 2: "All locations" should still surface address issues so
  // operators can triage them at the global view). Other warnings remain
  // location-scoped. The Shipment-Requests badge was retired (Item 1).
  const hasLocationScopedWarnings =
    isLocationSelected &&
    (failedDeliveryCount > 0 ||
      hasUnfulfilledPresaleOrders ||
      pendingReturnPickups.length > 0);
  // Warehouse-method override marker is location-scoped (only meaningful at a
  // specific store location) and only appears when the toggle is on AND the
  // current view actually contains warehouse-method orders.
  const showWarehouseBadge =
    isLocationSelected && includeWarehouse && (warehouseOrdersCount ?? 0) > 0;
  // Hint badge: toggle is OFF but warehouse-located unfulfilled orders exist
  // at the current store. Clicking flips the toggle ON so the operator sees
  // them in the route manager. Avoids the dispatch-drift class of bug where
  // a session navigates away, toggle resets to OFF, and warehouse-rerouted
  // orders silently disappear from the eligible set.
  const showWarehouseHiddenBadge =
    isLocationSelected && !includeWarehouse && (warehouseOrdersHiddenCount ?? 0) > 0;
  const hasWarnings =
    hasLocationScopedWarnings ||
    addressErrorOrders.length > 0 ||
    showWarehouseBadge ||
    showWarehouseHiddenBadge;

  const routeManagerSection = (
    <s-section heading={t("routeManager.heading")}>
      {/* 2026-05-12: collapsed badges + selector into a single tight column so
          the vertical rhythm is uniform across "All locations" (selector +
          Orders + Pick-a-location prompt) and "Specific location" (selector +
          warnings + Orders). The previous split between s-stack-internal gap
          and post-stack section gap made the gap between Failed-delivery and
          Orders-to-deliver visibly larger than the other rows. */}
      <div className={styles.routeManagerHeaderCol}>
        <s-select
          label={t("filters.location", "Location")}
          labelAccessibilityVisibility="exclusive"
          name="locationId"
          value={locationId}
          onChange={handleLocationChange}
        >
          <s-option value={DEFAULT_LOCATION_ID}>{t("filters.allLocations")}</s-option>
          {locations.map((location) => (
            <s-option key={location.id} value={location.id}>
              {location.name}
            </s-option>
          ))}
        </s-select>

        {/* Warehouse-method override toggle. Sits between the location selector
            and the warning badges so it reads as part of the section's native
            controls (not a separate boxed surface). Reflects `?includeWarehouse=1`
            in the URL. When on, the loader surfaces orders whose Shopify
            deliveryMethod is not LOCAL (originally placed for warehouse
            fulfillment). Operator must move each order's FulfillmentOrder to the
            target store in Shopify admin first; this toggle then makes them
            visible here for Lalamove dispatch. Off by default — flipping it is
            a deliberate per-session action; the toggle does not persist. */}
        <div
          className={styles.warehouseToggleInline}
          onClick={handleToggleIncludeWarehouse}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggleIncludeWarehouse();
            }
          }}
        >
          <s-checkbox
            checked={includeWarehouse || undefined}
            onChange={handleToggleIncludeWarehouse}
          />
          <span className={styles.warehouseToggleLabel}>
            {t("filters.includeWarehouse")}
          </span>
        </div>

        {hasWarnings ? (
          <div className={styles.headerBadgesRow}>
            {isLocationSelected && failedDeliveryCount > 0 ? (
              <s-badge tone="warning" icon="alert-octagon">
                {t("filters.failedDelivery", { count: failedDeliveryCount })}
              </s-badge>
            ) : null}
            {isLocationSelected && hasUnfulfilledPresaleOrders ? (
              <span className={styles.warningLink}>
                <s-link onClick={() => setIsPresaleModalOpen(true)}>
                  {t("filters.presaleWarning")}
                </s-link>
              </span>
            ) : null}
            {addressErrorOrders.length > 0 ? (
              <span style={{ cursor: "pointer" }} onClick={() => setIsAddressErrorsModalOpen(true)}>
                <s-badge tone="warning" icon="alert-triangle">
                  {t("warnings.addressErrors", { count: addressErrorOrders.length })}
                </s-badge>
              </span>
            ) : null}
            {isLocationSelected && pendingReturnPickups.length > 0 ? (
              <span style={{ cursor: "pointer" }} onClick={() => setIsReturnPickupsModalOpen(true)}>
                <s-badge tone="warning" icon="refresh">
                  {t("warnings.returnPickups", { count: pendingReturnPickups.length })}
                </s-badge>
              </span>
            ) : null}
            {showWarehouseBadge ? (
              <s-badge tone="warning" icon="package">
                {t("filters.warehouseCount", { count: warehouseOrdersCount ?? 0 })}
              </s-badge>
            ) : null}
            {showWarehouseHiddenBadge ? (
              <span
                style={{ cursor: "pointer" }}
                onClick={handleToggleIncludeWarehouse}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleToggleIncludeWarehouse();
                  }
                }}
              >
                <s-badge tone="warning" icon="package">
                  {t("warnings.warehouseHidden", { count: warehouseOrdersHiddenCount ?? 0 })}
                </s-badge>
              </span>
            ) : null}
          </div>
        ) : null}

      {/* Orders badge + actions menu. "Pick a location" badge moved here
          (2026-05-12) on its own row beneath "Orders to deliver" so the
          merchant sees the count first, then the prompt to refine. */}
      <div className={styles.routeManagerStatusRow}>
        <s-badge tone="info" icon="package">
          {t("filters.ordersToDeliver", { count: mapData.orders.length })}
        </s-badge>
        {locationId !== DEFAULT_LOCATION_ID ? (
          optimizeProgress ? (
            <div style={{ flex: 1 }} />
          ) : updateRoutesFetcher.state !== "idle" ? (
            <s-spinner size="base" accessibilityLabel={t("routeManager.updateRoutes")}></s-spinner>
          ) : (
            <div className={styles.routeManagerActionsMenu}>
              {dirtyRouteIds.size > 0 ? (
                <s-button
                  key="confirm-changes"
                  variant="primary"
                  disabled={isRoutingBusy}
                  onClick={handleUpdateRoutes}
                >
                  {t("routeManager.confirmChanges")}
                </s-button>
              ) : (
                <>
                  <s-button
                    key="actions-trigger"
                    variant="tertiary"
                    icon="menu-horizontal"
                    accessibilityLabel={t("routeManager.actions")}
                    commandFor="route-manager-actions"
                  ></s-button>
                  <s-menu id="route-manager-actions" accessibilityLabel={t("routeManager.actions")}>
                    {unassignedOrders.length > 0 ? (
                      <s-button
                        icon="wand"
                        disabled={orders.length === 0}
                        onClick={() => {
                          autoAssignSelection();
                          handleOptimizeFleet();
                        }}
                      >
                        {t("routeManager.autoAssign")}
                      </s-button>
                    ) : null}
                    <s-button icon="view" onClick={scrollToOrdersSection}>
                      {t("routeManager.seeOrders")}
                    </s-button>
                    {hasAssignedRoutes ? (
                      <s-button
                        icon="receipt-dollar"
                        disabled={bulkOpStatus !== null || polylineEditMode}
                        onClick={handleQuoteAllRoutes}
                      >
                        {t("routeManager.quoteAllRoutes")}
                      </s-button>
                    ) : null}
                    {hasAssignedRoutes ? (
                      <s-button
                        icon="bolt"
                        disabled={bulkOpStatus !== null || polylineEditMode}
                        onClick={handleDispatchAllRoutes}
                      >
                        {t("routeManager.dispatchAllRoutes")}
                      </s-button>
                    ) : null}
                    <s-button
                      icon="settings"
                      onClick={() =>
                        navigate(`/app/settings?locationId=${encodeURIComponent(locationId)}`)
                      }
                    >
                      {t("routeManager.openLocationSettings")}
                    </s-button>
                    {hasAssignedRoutes ? (
                      <s-button
                        tone="critical"
                        icon="delete"
                        disabled={isRoutingBusy}
                        onClick={() => setClearAllConfirmOpen(true)}
                      >
                        {t("routeManager.clearAllRoutes")}
                      </s-button>
                    ) : null}
                  </s-menu>
                </>
              )}
            </div>
          )
        ) : null}
      </div>
      {locationId === DEFAULT_LOCATION_ID ? (
        <div className={styles.locationGateBadgeRow}>
          <s-badge icon="info">
            {t("map.locationGate.shortHeading")}
          </s-badge>
        </div>
      ) : null}
      </div>
      {optimizeProgress ? (
        <div className={styles.optimizeProgressWrap}>
          {/* AI optimize is unpredictable per LLM call — the ETA countdown
              was misleading. Stretch the phase message across the whole
              header row instead so it's readable at a glance. */}
          <div className={styles.optimizeProgressHeader}>
            <span className={styles.optimizeProgressPhase}>{optimizeProgress.phase}</span>
          </div>
          <div className={styles.optimizeProgressBar}>
            <div className={styles.optimizeProgressFill} style={{ width: `${optimizeProgress.pct}%` }} />
          </div>
        </div>
      ) : null}
      {bulkOpStatus ? (
        <div className={styles.optimizeProgressWrap}>
          <div className={styles.optimizeProgressHeader}>
            <span>
              {bulkOpStatus.kind === "quote"
                ? t("routeManager.quoteAllProgress", {
                    completed: bulkOpStatus.completed,
                    total: bulkOpStatus.total,
                  })
                : t("routeManager.dispatchAllProgress", {
                    completed: bulkOpStatus.completed,
                    total: bulkOpStatus.total,
                  })}
            </span>
          </div>
          <div className={styles.optimizeProgressBar}>
            <div
              className={styles.optimizeProgressFill}
              style={{
                width: `${
                  bulkOpStatus.total > 0
                    ? Math.round((bulkOpStatus.completed / bulkOpStatus.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      ) : null}
      {/* ── Add to best route (contextual to selection) ── */}
      {locationId !== DEFAULT_LOCATION_ID ? (() => {
        const selectedUnassignedCount = unassignedOrders.filter(
          (o) => selectedOrderIds.has(o.id),
        ).length;
        return selectedUnassignedCount > 0 && hasAssignedRoutes ? (
          <div className={styles.routeManagerTopRow}>
            <s-button
              variant="secondary"
              onClick={handleAddToBestRoute}
              disabled={optimizeFetcher.state !== "idle"}
            >
              {t("routeManager.addToBestRoute")}
            </s-button>
          </div>
        ) : null;
      })() : null}
      {/* Route cards are hidden entirely on the all-locations view (2026-05-08
          per Lucas's spec). Only the Route Manager block (badge prompt +
          general stats), the All-orders table, and the Auto-assign accuracy
          block render when locationId === DEFAULT_LOCATION_ID. To see the
          per-route cards the operator MUST pick a specific location. The
          legacy "grouped by location" rendering inside this branch is left
          in place for safety (no behavior change for picked-location views)
          but is unreachable now. */}
      {hasAssignedRoutes && locationId !== DEFAULT_LOCATION_ID ? (
        <div className={styles.assignedRoutesSection}>
          {locationId === DEFAULT_LOCATION_ID ? (
            // Unreachable now (outer gate above) -- kept for diff clarity.
            // Grouped by location when "All locations" selected
            [...new Set(editableRoutes.filter((r) => r.orderIds.length > 0).map((r) => r.locationId))].map((locId) => {
              const groupName = locationsById.get(locId)?.name;
              return (
              <div key={locId} className={styles.locationGroup}>
                {groupName ? <s-text type="strong">{groupName}</s-text> : null}
                <div className={styles.assignedRoutesList}>
                  {editableRoutes
                    .map((route, index) => ({ route, index }))
                    .filter(({ route }) => route.orderIds.length > 0 && route.locationId === locId)
                    .map(({ route, index: routeIndex }) => {
                      const routeOrders = route.orderIds.map((orderId) => ordersById.get(orderId)).filter((order): order is LoaderOrder => Boolean(order));
                      const orderCount = routeOrders.length;
                      const label = getRouteLabel(route, routeIndex);
                      const badgeColors = deriveBadgeColors(route.color);
                      return (
                        <div key={route.id} className={styles.routeCard}>
                          <s-box padding="base" borderWidth="base" borderRadius="base">
                            <div className={styles.routeCardHeader}>
                              <span className={styles.routeBadge} style={{ "--badge-bg": badgeColors.bg, "--badge-text": badgeColors.text } as CSSProperties}>
                                {label}
                              </span>
                            </div>
                            <s-text color="subdued">{t("routeManager.ordersMeta", { count: orderCount, shipping: "--" })}</s-text>
                          </s-box>
                        </div>
                      );
                    })}
                </div>
              </div>
              );
            })
          ) : (
            <div className={styles.assignedRoutesList}>
              {editableRoutes
                .map((route, index) => ({ route, index }))
                .filter(({ route }) => route.orderIds.length > 0)
                .map(({ route, index: routeIndex }) => {
                  const routeOrders = route.orderIds
                    .map((orderId) => ordersById.get(orderId))
                    .filter((order): order is LoaderOrder => Boolean(order));
                  const orderCount = routeOrders.length;
                  const shippingAmounts = routeOrders
                    .map((order) => order.shippingCost)
                    .filter(Boolean) as Array<{
                    amount: number;
                    currencyCode: string;
                  }>;
                  const currencyCodes = new Set(
                    shippingAmounts.map((shipping) => shipping.currencyCode),
                  );
                  const hasMultipleCurrencies = currencyCodes.size > 1;
                  const shippingTotal = shippingAmounts.reduce(
                    (total, shipping) => total + shipping.amount,
                    0,
                  );
                  const formattedShippingTotal =
                    shippingAmounts.length === 0
                      ? "--"
                      : hasMultipleCurrencies
                        ? t("routeManager.multipleCurrencies")
                        : formatCurrency(
                            shippingTotal,
                            shippingAmounts[0]!.currencyCode,
                            userLocale,
                          );
                  const label = getRouteLabel(route, routeIndex);
                  const metaLine1 = t("routeManager.ordersMeta", { count: orderCount, shipping: formattedShippingTotal });
                  const hasDistance =
                    route.totalDistanceMeters != null &&
                    Number.isFinite(route.totalDistanceMeters);
                  const hasDuration =
                    route.totalDurationSeconds != null &&
                    Number.isFinite(route.totalDurationSeconds);
                  const distanceStr = hasDistance
                    ? `${(route.totalDistanceMeters! / 1000).toFixed(1)} km`
                    : "--";
                  const durationStr = hasDuration
                    ? formatDurationSummary(route.totalDurationSeconds!)
                    : "--";
                  const quoteTotal = routeQuoteTotals[route.id];
                  // Format the lalamove quote total through the same currency
                  // helper as the shipping line so both render "R$55,32" not
                  // "55.32 BRL" (per backlog 2026-05-16). If the API ever
                  // returns a non-numeric total fall back to the raw string.
                  const costStr = (() => {
                    if (!quoteTotal) return t("routeManager.costPlaceholder");
                    const parsedAmount = Number(quoteTotal.total);
                    const currency = quoteTotal.currency || "BRL";
                    const formatted = Number.isFinite(parsedAmount)
                      ? formatCurrency(parsedAmount, currency, userLocale)
                      : `${quoteTotal.total}${quoteTotal.currency ? ` ${quoteTotal.currency}` : ""}`;
                    return t("routeManager.costLabel", { cost: formatted });
                  })();
                  const metaLine2 = `${distanceStr} • ${durationStr} • ${costStr}`;
                  // Hide the "-- • -- • Cost: --" placeholder line entirely
                  // when none of the three values are populated (no Routes
                  // geometry, no quote). Once any value lands the line
                  // renders again with the populated values + placeholders
                  // for the missing ones.
                  const hasMetaLine2Data = hasDistance || hasDuration || Boolean(quoteTotal);
                  const lalamoveConfig = lalamoveConfigMap[route.locationId];
                  const isLalamoveReady =
                    credentialStatus.configured &&
                    lalamoveConfig &&
                    lalamoveConfig.market &&
                    lalamoveConfig.preferredServiceType &&
                    lalamoveConfig.locationName &&
                    lalamoveConfig.locationPhone &&
                    lalamoveConfig.locationAddress;
                  const badgeColors = deriveBadgeColors(route.color);
                  const hasSelectedOrders = selectedOrderIds.size > 0;
                  const canAddToRoute = assignableExistingRoutes.some(
                    (candidate) => candidate.id === route.id,
                  );
                  const allSelectedAlreadyInRoute = hasSelectedOrders
                    && [...selectedOrderIds].every((id) => route.orderIds.includes(id));
                  const isThisRouteBusy = lalamoveBusyRouteId === route.id;
                  const isAnyRouteBusy = lalamoveBusyRouteId !== null;
                  const isOtherRouteBusy = isAnyRouteBusy && !isThisRouteBusy;
                  const notification = renderRouteNotification(route);
                  // Per-state notification placement (per 2026-05-06 review):
                  // - pre-dispatch action row: render INLINE (left of the
                  //   primary button) so the action row is one line.
                  // - any other state: render BELOW the action row as before.
                  const dispatch = dispatchedRoutes[route.id];
                  const isPostDispatchActive =
                    !!dispatch &&
                    !TERMINAL_DISPATCH_STATUSES.has(dispatch.status ?? "");
                  const isPreDispatchRow =
                    !hasSelectedOrders && !isPostDispatchActive;
                  const inlineNotification = isPreDispatchRow ? notification : null;
                  const belowNotification = isPreDispatchRow ? null : notification;
                  const isNeedsReviewCard =
                    dispatchedRoutes[route.id]?.podBucket === "needs-review";
                  return (
                    <div
                      key={route.id}
                      className={`${styles.routeCard}${isOtherRouteBusy ? ` ${styles.routeCardSubdued}` : ""}${isNeedsReviewCard ? ` ${styles.routeCardNeedsReview}` : ""}`}
                    >
                      <s-box
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                      >
                        <div className={styles.routeCardHeader}>
                          <div className={styles.routeCardHeaderText}>
                            <span
                              className={styles.routeBadge}
                              style={
                                {
                                  "--badge-bg": badgeColors.bg,
                                  "--badge-text": badgeColors.text,
                                } as CSSProperties
                              }
                            >
                              {label}
                            </span>
                          </div>
                          {/* ⋯ overflow menu — pre-dispatch shows Manage/Details/Clear,
                              post-dispatch shows Details/Cancel (Manage and Clear hidden
                              once a Lalamove order is live). Polyline-edit lockout
                              disables destructive items via the disabled flag. */}
                          {(() => {
                            const dispatched = dispatchedRoutes[route.id];
                            const isPostDispatch = !!dispatched && (!TERMINAL_DISPATCH_STATUSES.has(dispatched.status ?? "") || dispatched.podBucket);
                            const menuId = `route-card-menu-${route.id}`;
                            return (
                              <>
                                <s-button
                                  variant="secondary"
                                  icon="menu-horizontal"
                                  accessibilityLabel={t("routeManager.moreActions")}
                                  commandFor={menuId}
                                  disabled={isOtherRouteBusy}
                                ></s-button>
                                <s-menu id={menuId} accessibilityLabel={t("routeManager.moreActions")}>
                                  {!isPostDispatch ? (
                                    <s-button
                                      icon="edit"
                                      disabled={polylineEditMode || isRoutingBusy || isOtherRouteBusy}
                                      onClick={() => openManageRouteModal(route, routeIndex)}
                                    >
                                      {t("routeManager.manage")}
                                    </s-button>
                                  ) : null}
                                  <s-button
                                    icon="info"
                                    disabled={isOtherRouteBusy}
                                    onClick={() => openDetailsRouteModal(route, routeIndex)}
                                  >
                                    {t("routeManager.details")}
                                  </s-button>
                                  {!isPostDispatch ? (
                                    <s-button
                                      icon="minus-circle"
                                      tone="critical"
                                      disabled={polylineEditMode || isRoutingBusy || isOtherRouteBusy}
                                      onClick={() =>
                                        setUnassignConfirmRoute({ route, index: routeIndex })
                                      }
                                    >
                                      {t("routeManager.clearRoute")}
                                    </s-button>
                                  ) : null}
                                  {isPostDispatch && !TERMINAL_DISPATCH_STATUSES.has(dispatched?.status ?? "") ? (
                                    <s-button
                                      icon="disabled"
                                      tone="critical"
                                      disabled={polylineEditMode || isOtherRouteBusy}
                                      onClick={() => setCancelConfirmRouteId(route.id)}
                                    >
                                      {t("routeManager.cancelDelivery")}
                                    </s-button>
                                  ) : null}
                                </s-menu>
                              </>
                            );
                          })()}
                        </div>
                        {dispatchedRoutes[route.id]?.partialDelivery ? (
                          <div className={styles.podPartialBanner} role="status">
                            <span className={styles.podPartialBannerTitle}>
                              {t("pod.partialBanner.title", {
                                fulfilled: (dispatchedRoutes[route.id]?.stops ?? []).filter((s) => s.stopOutcome === "DELIVERED").length,
                                total: (dispatchedRoutes[route.id]?.stops ?? []).length,
                              })}
                            </span>
                            <span className={styles.podPartialBannerBody}>
                              {t("pod.partialBanner.body")}
                            </span>
                          </div>
                        ) : null}
                        {dispatchedRoutes[route.id]?.podBucket ? (() => {
                          const bucket = dispatchedRoutes[route.id]!.podBucket as string;
                          // CSS modules don't expose hyphenated class names
                          // through bracket-lookup reliably; normalize to
                          // underscores so podBucket_needs-review resolves to
                          // .podBucket_needs_review in the stylesheet.
                          const classKey = bucket.replace(/-/g, "_");
                          return (
                            <div className={`${styles.podBucketBadge} ${styles[`podBucket_${classKey}`] ?? ""}`}>
                              {t(`pod.bucket.${bucket}`, {
                                delivered: (dispatchedRoutes[route.id]?.stops ?? []).filter((s) => s.stopOutcome === "DELIVERED").length,
                                total: (dispatchedRoutes[route.id]?.stops ?? []).length,
                              })}
                            </div>
                          );
                        })() : null}
                        <div className={styles.routeCardOrderStats}>
                          <s-stack direction="block" gap="small">
                            <s-text type="strong">{metaLine1}</s-text>
                            {hasMetaLine2Data ? (
                              <s-text color="subdued">{metaLine2}</s-text>
                            ) : null}
                          </s-stack>
                        </div>
                        {hasSelectedOrders ? (
                          <div className={styles.assignedRoutesTopActions}>
                            <s-button
                              variant="primary"
                              disabled={!canAddToRoute || allSelectedAlreadyInRoute || isRoutingBusy || isOtherRouteBusy}
                              onClick={() => handleAddSelectedToRoute(routeIndex)}
                            >
                              {t("routeManager.addToRoute")}
                            </s-button>
                          </div>
                        ) : dispatchedRoutes[route.id] && !TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id]?.status ?? "") ? (
                          // Post-dispatch action row: status badge only (right-aligned).
                          // The destructive Cancel delivery action lives in the ⋯ menu above.
                          <div className={styles.routeCardActionsRow}>
                            <s-badge tone={getStatusBadgeTone(dispatchedRoutes[route.id]?.status ?? "")}>
                              {t(`routeManager.status.${dispatchedRoutes[route.id]?.status ?? "requested"}`)}
                            </s-badge>
                          </div>
                        ) : dispatchedRoutes[route.id]?.podBucket === "needs-review" ? (
                          // Needs-review action row: terminal dispatch flagged by
                          // the watchdog reconciler. The Review button opens the
                          // details modal, which surfaces the warning banner +
                          // suspect-row highlights. Operator resolves via CLI
                          // (mark-stop-delivered / mark-stop-failed / clear-needs-review).
                          <div className={styles.routeCardActionsRow}>
                            <s-button
                              variant="primary"
                              onClick={() => openDetailsRouteModal(route, routeIndex)}
                            >
                              {t("routeManager.review")}
                            </s-button>
                          </div>
                        ) : (
                          // Pre-dispatch action row: notification (e.g. "Ready
                          // for delivery") inline-left, primary button right.
                          // Manage and Clear route moved into the ⋯ overflow menu.
                          <div className={styles.routeCardActionsRow}>
                            {inlineNotification ? (
                              <div className={styles.routeCardActionsRowInlineNotif}>
                                {inlineNotification}
                              </div>
                            ) : null}
                            {quotePreview?.routeId === route.id ? (
                              isThisRouteBusy ? (
                                <s-button
                                  key="requesting-driver"
                                  variant="primary"
                                  loading
                                  disabled
                                >
                                  {t("routeManager.requestingDriver")}
                                </s-button>
                              ) : (
                                <s-button
                                  key="request-driver"
                                  variant="primary"
                                  disabled={polylineEditMode || isOtherRouteBusy}
                                  onClick={() => handlePlaceOrderFromCard(route, routeIndex)}
                                >
                                  {t("routeManager.requestDriver")}
                                </s-button>
                              )
                            ) : isThisRouteBusy ? (
                              <s-button
                                key="requesting-quote"
                                variant="primary"
                                loading
                                disabled
                              >
                                {t("routeManager.requestingQuote")}
                              </s-button>
                            ) : (
                              <s-button
                                key="request-quote"
                                variant="primary"
                                disabled={!isLalamoveReady || polylineEditMode || isRoutingBusy || isOtherRouteBusy}
                                onClick={() => handleRequestDriver(route)}
                              >
                                {t("routeManager.requestQuote")}
                              </s-button>
                            )}
                          </div>
                        )}
                        {belowNotification ? (
                          <div className={styles.routeCardNotifications}>
                            {belowNotification}
                          </div>
                        ) : null}
                      </s-box>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      ) : null}
      {locationId !== DEFAULT_LOCATION_ID &&
        (() => {
          const config = lalamoveConfigMap[locationId];
          const isMissing =
            !config ||
            !config.locationName ||
            !config.locationPhone ||
            !config.locationAddress ||
            !config.locationDetails;
          return isMissing ? (
            <div className={styles.mapFooterBadge}>
              <s-link href={settingsHref}>
                <s-badge tone="critical">
                  {t("routeManager.lalamoveDisabled")}
                </s-badge>
              </s-link>
            </div>
          ) : null;
        })()}
    </s-section>
  );

  const accuracyBlock = (optimizerAccuracy && optimizerAccuracy.optimizations > 0) ? (
    <s-section heading={t("routeManager.autoAssignAccuracy")}>
      {/* Post-mortem entry point. When unreviewed flagged decisions exist,
          render an attention-toned badge alongside the link. Otherwise just
          the silent "Review decisions →" link in the section heading row.
          Routes to /app/local-delivery/post-mortem (filter=needs-review when
          we have flagged rows to take the operator straight to them). */}
      <div slot="primary-action" className={styles.accuracyHeaderActions}>
        {pendingPostMortemReviewCount > 0 ? (
          <Link
            to="/app/local-delivery/post-mortem?chip=unreviewed"
            className={styles.accuracyReviewLink}
          >
            <s-badge tone="warning">
              {t("routeManager.postMortemPending", { count: pendingPostMortemReviewCount })}
            </s-badge>
          </Link>
        ) : (
          <Link
            to="/app/local-delivery/post-mortem"
            className={styles.accuracyReviewLink}
          >
            {t("routeManager.reviewDecisions")} →
          </Link>
        )}
      </div>
      {(() => {
        const accurate = optimizerAccuracy.totalDispatched - optimizerAccuracy.totalReassigned;
        const pct = optimizerAccuracy.totalDispatched > 0
          ? Math.round((accurate / optimizerAccuracy.totalDispatched) * 100)
          : 0;
        return (
          <div className={styles.accuracyContent}>
            <div className={styles.accuracyBarWrap}>
              <div
                className={styles.accuracyBarFill}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className={styles.accuracyStats}>
              <span className={styles.accuracyPct}>{pct}%</span>
              <span className={styles.accuracyDetail}>
                {t("routeManager.accurateOf", { accurate, total: optimizerAccuracy.totalDispatched })}
              </span>
            </div>
            <span className={styles.accuracyPeriod}>
              {t("routeManager.last30Days", { count: optimizerAccuracy.optimizations })}
            </span>
          </div>
        );
      })()}
    </s-section>
  ) : null;

  return (
    <s-page heading={t("pageHeading")}>
      <s-modal
        id="manage-route-modal"
        heading={activeRouteIndex != null ? getRouteLabel(editableRoutes[activeRouteIndex] ?? { id: "", locationId: "", polyline: "", color: "", orderIds: [] }, activeRouteIndex) : ""}
      >
        <s-stack direction="block" gap="base">
          {/* Map removed 2026-05-16 (watchdog mark-as-delivered refactor):
              this modal is for unassigning orders from a route. The geographic
              context lives in the main page map; duplicating it inside the
              modal added load and didn't change operator behavior. The
              effect that initializes manageRouteMapRef no-ops when the ref
              is never attached. */}
          <div className={styles.manageRouteTableRow}>
              {activeManagedRouteOrders.length > 0 ? (
                <div className={styles.dueOrdersTable}>
                  <div className={styles.dueOrdersHeader}>
                    <span>
                      <s-checkbox
                        accessibilityLabel={t("routeManager.selectAllInRoute")}
                        checked={isManageRouteFullySelected}
                        onChange={(event) => {
                          const target = event.currentTarget as
                            | { checked?: boolean }
                            | null;
                          toggleManageRouteSelection(Boolean(target?.checked));
                        }}
                      />
                    </span>
                    <span>{t("routeManager.table.order")}</span>
                    <span>{t("routeManager.table.customer")}</span>
                    <span>{t("routeManager.table.address")}</span>
                  </div>
                  {activeManagedRouteOrders.map((order) => (
                    <div key={order.id} className={styles.dueOrdersRow}>
                      <span>
                        <s-checkbox
                          accessibilityLabel={t("routeManager.removeFromRoute", { name: order.name })}
                          checked={removeFromRouteOrderIds.has(order.id)}
                          onChange={() => toggleRemoveRouteOrder(order.id)}
                        />
                      </span>
                      <s-link href={order.adminOrderUrl} target="_blank">
                        {order.name}
                      </s-link>
                      <span>{formatCustomerShort(order.customerName, t("customer.guest"))}</span>
                      <span>{order.address1 ?? t("routeManager.noAddressLine1")}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <s-text color="subdued">{t("modals.routeDetails.noOrders")}</s-text>
              )}
          </div>
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="manage-route-modal"
              command="--hide"
              onClick={closeEditRoute}
            >
              {t("modals.unassignConfirm.cancel")}
            </s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={removeFromRouteOrderIds.size === 0}
              commandFor="manage-route-modal"
              command="--hide"
              onClick={saveRouteEdits}
            >
              {t("routeManager.unassignOrders")}
            </s-button>
          </div>
        </s-stack>
      </s-modal>
      <s-modal
        id="details-route-modal"
        heading={activeRouteIndex != null ? t("modals.routeDetails.heading", { number: activeRouteIndex + 1 }) : ""}
      >
        <s-stack direction="block" gap="base">
          {/* Map removed 2026-05-16 (watchdog mark-as-delivered refactor):
              this is a status-review surface — the operator wants per-stop
              POD info, not the route shape. detailsRouteMapRef no-ops when
              the ref is never attached. */}
          {(() => {
            const activeRouteId =
              activeRouteIndex != null ? editableRoutes[activeRouteIndex]?.id ?? null : null;
            const dispatch = activeRouteId ? dispatchedRoutes[activeRouteId] : null;
            const isNeedsReview = dispatch?.podBucket === "needs-review";
            const reasonKey = dispatch?.needsReviewReason ?? "unknown";
            if (!isNeedsReview) return null;
            return (
              <div className={styles.needsReviewBanner} role="status">
                <span className={styles.needsReviewBannerIcon} aria-hidden="true">⚠</span>
                <div className={styles.needsReviewBannerContent}>
                  <div className={styles.needsReviewBannerTitle}>
                    {t(`pod.needsReview.${reasonKey}.title`)}
                  </div>
                  <div className={styles.needsReviewBannerHint}>
                    {t(`pod.needsReview.${reasonKey}.hint`)}
                  </div>
                </div>
              </div>
            );
          })()}
          {activeManagedRouteOrders.length > 0 ? (
            (() => {
              const activeRouteId =
                activeRouteIndex != null ? editableRoutes[activeRouteIndex]?.id ?? null : null;
              const dispatch = activeRouteId ? dispatchedRoutes[activeRouteId] : null;
              const isNeedsReview = dispatch?.podBucket === "needs-review";
              const stopByOrderId = new Map<string, { stopOutcome: string | null; stopFailureReason: string | null }>();
              if (activeRouteId) {
                for (const stop of dispatch?.stops ?? []) {
                  stopByOrderId.set(stop.shopifyOrderId, {
                    stopOutcome: stop.stopOutcome,
                    stopFailureReason: stop.stopFailureReason,
                  });
                }
              }
              const hasAnyOutcome = Array.from(stopByOrderId.values()).some((s) => !!s.stopOutcome);
              const showStatusColumn = hasAnyOutcome || isNeedsReview;
              return (
                <div className={`${styles.dueOrdersTable}${showStatusColumn ? ` ${styles.dueOrdersTableWithStatus}` : ""}`}>
                  <div className={styles.dueOrdersHeader}>
                    <span />
                    <span>{t("routeManager.table.order")}</span>
                    <span>{t("routeManager.table.customer")}</span>
                    <span>{t("routeManager.table.address")}</span>
                    {showStatusColumn ? <span>{t("pod.table.status")}</span> : null}
                  </div>
                  {activeManagedRouteOrders.map((order) => {
                    const stop = stopByOrderId.get(order.id);
                    const outcome = stop?.stopOutcome ?? null;
                    // When the route is flagged needs-review, every stop that
                    // hasn't been confirmed DELIVERED is a suspect — surfaces
                    // a warning-toned pill so the operator knows which rows
                    // need verification. The plain delivered/failed/pending
                    // pills only show on routes where outcomes are trusted.
                    const isSuspect = isNeedsReview && outcome !== "DELIVERED";
                    const pillKey = isSuspect
                      ? "suspect"
                      : outcome === "DELIVERED" ? "delivered"
                      : outcome === "FAILED" ? "failed"
                      : outcome === "PENDING" ? "pending"
                      : "unknown";
                    return (
                      <div
                        key={order.id}
                        className={`${styles.dueOrdersRow}${isSuspect ? ` ${styles.dueOrdersRowSuspect}` : ""}`}
                      >
                        <span />
                        <s-link href={order.adminOrderUrl} target="_blank">
                          {order.name}
                        </s-link>
                        <span>{formatCustomerShort(order.customerName, t("customer.guest"))}</span>
                        <span>{order.address1 ?? t("routeManager.noAddressLine1")}</span>
                        {showStatusColumn ? (
                          <span
                            className={`${styles.podStopPill} ${styles[`podStopPill_${pillKey}`] ?? ""}`}
                            title={stop?.stopFailureReason ?? undefined}
                          >
                            {t(`pod.stopPill.${pillKey}`)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : (
            <s-text color="subdued">{t("modals.routeDetails.noOrders")}</s-text>
          )}
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="details-route-modal"
              command="--hide"
              onClick={closeEditRoute}
            >
              {t("routeManager.close")}
            </s-button>
          </div>
        </s-stack>
      </s-modal>
      {unassignConfirmRoute ? (
        <s-modal id="unassign-confirm-modal" heading={t("modals.unassignConfirm.heading")}>
          <s-stack direction="block" gap="base">
            <s-text>
              {t("modals.unassignConfirm.message")}
            </s-text>
            <s-text>{t("modals.unassignConfirm.proceed")}</s-text>
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                commandFor="unassign-confirm-modal"
                command="--hide"
                onClick={() => setUnassignConfirmRoute(null)}
              >
                {t("modals.unassignConfirm.cancel")}
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                commandFor="unassign-confirm-modal"
                command="--hide"
                onClick={() => {
                  performUnassignEditableRoute(
                    unassignConfirmRoute.route,
                    unassignConfirmRoute.index,
                  );
                }}
              >
                {t("modals.unassignConfirm.confirm")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      {clearAllConfirmOpen ? (
        <s-modal id="clear-all-confirm-modal" heading={t("modals.clearAllConfirm.heading")}>
          <s-stack direction="block" gap="base">
            <s-text>
              {t("modals.clearAllConfirm.message")}
            </s-text>
            <s-text>{t("modals.clearAllConfirm.proceed")}</s-text>
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                commandFor="clear-all-confirm-modal"
                command="--hide"
                onClick={() => setClearAllConfirmOpen(false)}
              >
                {t("modals.clearAllConfirm.cancel")}
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                commandFor="clear-all-confirm-modal"
                command="--hide"
                onClick={performClearAllRoutes}
              >
                {t("modals.clearAllConfirm.confirm")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      {exitConfirmOpen ? (
        <s-modal id="exit-confirm-modal" heading={t("map.polylineEdit.exitConfirm.heading")}>
          <s-stack direction="block" gap="base">
            <s-text>
              {t("map.polylineEdit.exitConfirm.body", { count: dirtyRouteIds.size })}
            </s-text>
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                onClick={() => {
                  // Programmatic close per CLAUDE.md "<s-button> with
                  // commandFor + onClick" gotcha — the dismiss command
                  // races with the click handler.
                  setExitConfirmOpen(false);
                  document.getElementById("exit-confirm-modal")?.removeAttribute("open");
                }}
              >
                {t("map.polylineEdit.exitConfirm.stay")}
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                onClick={() => {
                  cancelPolylineEditMode();
                  setExitConfirmOpen(false);
                  document.getElementById("exit-confirm-modal")?.removeAttribute("open");
                }}
              >
                {t("map.polylineEdit.exitConfirm.discard")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      <s-modal id="address-verify-modal" heading={t("modals.addressVerify.heading")}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("modals.addressVerify.description")}</s-text>
            <div className={styles.addressVerifyScrollArea}>
              {(addressVerifyRoute?.orderIds ?? []).map((orderId, idx) => {
                const order = ordersById.get(orderId);
                if (!order) return null;
                return (
                  <div key={orderId}>
                    {idx > 0 ? <div className={styles.addressVerifyDivider} /> : null}
                    <div className={styles.addressVerifyItem}>
                      {/* Header: Order number | Customer name */}
                      <div className={styles.addressVerifyHeader}>
                        <span className={styles.addressVerifyOrderName}>{order.name}</span>
                        {order.customerName ? (
                          <>
                            <span className={styles.addressVerifyHeaderSep}>{" | "}</span>
                            <span className={styles.addressVerifyCustomerName}>{order.customerName}</span>
                          </>
                        ) : null}
                      </div>
                      {/* Original address (read-only) */}
                      <div className={styles.addressVerifyOriginal}>
                        {order.shippingSummary || "—"}
                      </div>
                      {/* Editable address with Google Places */}
                      <div
                        ref={(el) => { addressVerifyRefs.current[orderId] = el; }}
                        className={styles.addressVerifyInputWrap}
                      >
                        <input
                          type="text"
                          value={addressVerifyEdits[orderId] ?? ""}
                          onChange={(e) => {
                            const val = (e.target as HTMLInputElement).value;
                            setAddressVerifyEdits((prev) => ({ ...prev, [orderId]: val }));
                          }}
                          className={styles.addressVerifyInput}
                          placeholder={t("modals.addressVerify.addressPlaceholder")}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                onClick={() => {
                  hideModal("address-verify-modal");
                  setAddressVerifyRoute(null);
                }}
              >
                {t("modals.addressVerify.cancel")}
              </s-button>
              <s-button
                variant="primary"
                onClick={() => handleAddressVerifyConfirm()}
              >
                {t("modals.addressVerify.confirm")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      <s-modal id="special-requests-modal" heading={t("modals.specialRequests.heading")}>
          <s-stack direction="block" gap="base">
            {specialRequestsLoading ? (
              <s-text color="subdued">{t("modals.specialRequests.loading")}</s-text>
            ) : availableSpecialRequests.length === 0 ? (
              <s-text color="subdued">{t("modals.specialRequests.noOptions")}</s-text>
            ) : (
              <>
                <s-text color="subdued">{t("modals.specialRequests.description")}</s-text>
                {standaloneReqs.map((sr) => (
                  <label
                    key={sr.name}
                    style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSpecialRequests.has(sr.name)}
                      onChange={(e) => {
                        const checked = (e.target as HTMLInputElement).checked;
                        setSelectedSpecialRequests((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(sr.name);
                          else next.delete(sr.name);
                          return next;
                        });
                      }}
                    />
                    <span style={{ fontSize: 13 }}>{sr.description || sr.name}</span>
                  </label>
                ))}
                {waitTimeOpts.length > 0 && (
                  <>
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={waitTimeExpanded}
                        onChange={(e) => {
                          const checked = (e.target as HTMLInputElement).checked;
                          setWaitTimeExpanded(checked);
                          if (!checked) setSelectedWaitTime(null);
                        }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{t("modals.specialRequests.waitTimeLabel")}</span>
                    </label>
                    {waitTimeExpanded && (
                      <div style={{ marginLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
                        {waitTimeOpts.map((sr) => (
                          <label key={sr.name} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name="waitTimeOption"
                              value={sr.name}
                              checked={selectedWaitTime === sr.name}
                              onChange={() => setSelectedWaitTime(sr.name)}
                            />
                            <span style={{ fontSize: 13 }}>{sr.description || sr.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                onClick={() => {
                  hideModal("special-requests-modal");
                  setSpecialRequestsRoute(null);
                  resetWaitTimeState();
                }}
              >
                {t("modals.specialRequests.cancel")}
              </s-button>
              <s-button
                variant="primary"
                onClick={() => handleSubmitQuoteWithSpecialRequests()}
              >
                {t("modals.specialRequests.confirm")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
            {quotePreview ? (
        <s-modal id="request-driver-modal" heading={t("modals.requestDriver.heading")}>
          <s-stack direction="block" gap="base">
            <s-text>
              {t("modals.requestDriver.quoteId", { quotationId: quotePreview.quotationId })}
            </s-text>
            <s-text color="subdued">
              {t("modals.requestDriver.expiresAt", { time: new Date(quotePreview.expiresAt).toLocaleString() })}
            </s-text>
            <s-text color="subdued">
              {t("modals.requestDriver.estimatedTotal", { amount: `${quotePreview.total ?? "--"} ${quotePreview.currency ?? ""}`.trim() })}
            </s-text>
            <s-text color="subdued">
              {t("modals.requestDriver.ordersInRoute", { count: quotePreview.orderIds.length })}
            </s-text>
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                commandFor="request-driver-modal"
                command="--hide"
                onClick={() => {
                  setIsRequestDriverModalOpen(false);
                  setQuotePreview(null);
                }}
              >
                {t("modals.requestDriver.cancel")}
              </s-button>
              <s-button
                variant="primary"
                commandFor="request-driver-modal"
                command="--hide"
                onClick={() => {
                  if (!quotePreview) return;
                  const formData = new FormData();
                  formData.append("intent", "lalamove-place-order");
                  formData.append("routeId", quotePreview.routeId);
                  formData.append("locationId", quotePreview.locationId);
                  formData.append("quotationId", quotePreview.quotationId);
                  formData.append("quotationTotal", quotePreview.total ?? "");
                  formData.append("quotationCurrency", quotePreview.currency ?? "");
                  quotePreview.stopIds.forEach((stopId) =>
                    formData.append("stopIds", stopId),
                  );
                  quotePreview.orderIds.forEach((orderId) =>
                    formData.append("orderIds", orderId),
                  );
                  formData.append(
                    "deliveryAssignments",
                    JSON.stringify(quotePreview.deliveryAssignments),
                  );
                  const confirmedRouteIdx = editableRoutes.findIndex((r) => r.id === quotePreview.routeId);
                  const confirmedRouteTag = confirmedRouteIdx >= 0 ? (ROUTE_TAG_DEFINITIONS[confirmedRouteIdx]?.tag ?? null) : null;
                  if (confirmedRouteTag) formData.append("routeTag", confirmedRouteTag);
                  if (
                    quotePreview.orderIds.some((id) => warehouseOrderIds.has(id))
                  ) {
                    formData.append("methodOverride", "1");
                  }
                  lalamoveFetcher.submit(formData, { method: "post" });
                }}
              >
                {t("modals.requestDriver.confirm")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      <s-modal
        id="presale-tags-modal"
        heading={t("modals.tagFilter.heading")}
      >
        <s-stack direction="block" gap="base">
          {availablePresaleTags.length === 0 ? (
            <s-text color="subdued">{t("modals.tagFilter.noTags")}</s-text>
          ) : (
            availablePresaleTags.map((tag) => (
              <s-checkbox
                key={tag}
                label={tag}
                checked={draftPresaleTags.includes(tag)}
                onChange={(event: Event) =>
                  toggleDraftPresaleTag(
                    tag,
                    (event.currentTarget as unknown as HTMLInputElement).checked,
                  )
                }
              />
            ))
          )}
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="presale-tags-modal"
              command="--hide"
              onClick={() => setIsPresaleModalOpen(false)}
            >
              {t("modals.tagFilter.cancel")}
            </s-button>
            <s-button
              variant="primary"
              commandFor="presale-tags-modal"
              command="--hide"
              onClick={confirmPresaleTags}
            >
              {t("modals.tagFilter.confirm")}
            </s-button>
          </div>
        </s-stack>
      </s-modal>
      {/* Map style modal (2026-05-10 r2 cleanup):
            - Inline "Map style" label dropped (the modal's own heading
              already says "Map style"; rendering it twice was redundant).
            - Cancel + Confirm buttons moved into the canonical
              <div slot="footer"> (Polaris s-modal footer slot).
            - commandFor + onClick race replaced with programmatic close
              via removeAttribute("open") per the CLAUDE.md gotcha. */}
      <s-modal id="map-style-modal" heading={t("modals.mapStyle.heading")}>
        <div className={styles.mapStyleModalContent}>
          <s-choice-list
            label={t("modals.mapStyle.heading")}
            labelAccessibilityVisibility="exclusive"
            values={[draftMapStyle]}
            onChange={(event: Event) => {
              const target = event.currentTarget as { values?: string[] } | null;
              const value = target?.values?.[0];
              if (value === "dark" || value === "grayscale" || value === "light") {
                setDraftMapStyle(value);
              }
            }}
          >
            <s-choice value="dark">{t("modals.mapStyle.dark")}</s-choice>
            <s-choice value="grayscale">{t("modals.mapStyle.greyscale")}</s-choice>
            <s-choice value="light">{t("modals.mapStyle.light")}</s-choice>
          </s-choice-list>
        </div>
        <div className={styles.modalFooterRight} slot="footer">
          <s-button
            variant="secondary"
            onClick={() => {
              setDraftMapStyle(mapStyle);
              setIsMapStyleModalOpen(false);
              document
                .getElementById("map-style-modal")
                ?.removeAttribute("open");
            }}
          >
            {t("modals.mapStyle.cancel")}
          </s-button>
          <s-button
            variant="primary"
            onClick={() => {
              confirmMapStyle();
              document
                .getElementById("map-style-modal")
                ?.removeAttribute("open");
            }}
          >
            {t("modals.mapStyle.confirm")}
          </s-button>
        </div>
      </s-modal>
      <s-modal id="address-errors-modal" heading={t("modals.addressErrors.heading")}>
        <s-stack direction="block" gap="base">
          {addressErrorOrders.length === 0 ? (
            <s-text color="subdued">{t("modals.addressErrors.noErrors")}</s-text>
          ) : (
            addressErrorOrders.map((order) => (
              <s-box
                key={order.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-text type="strong">
                    {order.name}{order.customerName ? ` • ${order.customerName}` : ""}
                  </s-text>
                  <s-text color="subdued">
                    {order.addressValidation.issueType === "apartment_in_address1"
                      ? t("modals.addressErrors.apartmentInAddress")
                      : order.addressValidation.issueType === "duplicate_number"
                        ? t("modals.addressErrors.duplicateNumber")
                        : order.addressValidation.issueType === "multiple_numbers_in_address1"
                          ? t("modals.addressErrors.multipleNumbers")
                          : t("modals.addressErrors.reviewNeeded")}
                  </s-text>
                  {(order.address1 || order.address2) && (
                    <div style={{ fontSize: 13, color: "#303030" }}>
                      {order.address1 && (
                        <div>{renderAddressHighlighted(order.address1, order.addressValidation.highlightPatterns)}</div>
                      )}
                      {order.address2 && (
                        <div>{renderAddressHighlighted(order.address2, order.addressValidation.highlightPatterns)}</div>
                      )}
                    </div>
                  )}
                </s-stack>
              </s-box>
            ))
          )}
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              onClick={() => {
                setIsAddressErrorsModalOpen(false);
                document
                  .getElementById("address-errors-modal")
                  ?.removeAttribute("open");
              }}
            >
              {t("modals.addressErrors.close")}
            </s-button>
            {addressErrorOrders.length > 0 ? (
              <s-button
                variant="primary"
                href={
                  // Shopify orders index, filtered by the canonical tag.
                  // Forced to "All locations" via selectedView=all so the
                  // operator's last-used location filter doesn't hide results.
                  // Tag value comes from LD_ADDRESS_CONFIRM_TAG constant so
                  // future renames don't drift between deep-link + auto-tag.
                  // Polaris-native href (App-Bridge-aware) avoids the
                  // window.open store-prefix duplication we hit on the
                  // Order details modal (fix landed 2026-05-16).
                  `https://admin.shopify.com/store/${toAdminStoreHandle(shop)}/orders?query=${encodeURIComponent(`tag:${LD_ADDRESS_CONFIRM_TAG}`)}&selectedView=all`
                }
                target="_blank"
              >
                {t("modals.addressErrors.fixAddresses")}
              </s-button>
            ) : null}
          </div>
        </s-stack>
      </s-modal>
      <s-modal id="return-pickups-modal" heading={t("modals.returnPickups.heading")}>
        <s-stack direction="block" gap="base">
          {returnPickupError ? (
            <s-banner tone="critical" dismissible onDismiss={() => setReturnPickupError(null)}>
              {returnPickupError}
            </s-banner>
          ) : null}
          <s-text-field
            label={t("modals.returnPickups.instructionsLabel")}
            value={returnInstructions}
            placeholder={t("modals.returnPickups.instructionsPlaceholder")}
            onChange={(e: Event) => setReturnInstructions((e.currentTarget as HTMLInputElement).value)}
          />
          {pendingReturnPickups.length === 0 ? (
            <s-text color="subdued">{t("modals.returnPickups.noRequests")}</s-text>
          ) : (
            <div className={styles.dueOrdersTable}>
              <div className={styles.dueOrdersHeader}>
                <span>
                  <s-checkbox
                    accessibilityLabel={t("modals.returnPickups.selectAll")}
                    checked={pendingReturnPickups.length > 0 && selectedReturnIds.size === pendingReturnPickups.length}
                    onChange={(event: Event) => {
                      const target = event.currentTarget as { checked?: boolean } | null;
                      toggleAllReturnSelection(Boolean(target?.checked));
                    }}
                  />
                </span>
                <span>{t("modals.returnPickups.table.order")}</span>
                <span>{t("modals.returnPickups.table.customer")}</span>
                <span>{t("modals.returnPickups.table.address")}</span>
              </div>
              {pendingReturnPickups.map((req) => (
                <div key={req.id} className={styles.dueOrdersRow}>
                  <span>
                    <s-checkbox
                      accessibilityLabel={req.shopifyOrderName ?? req.id}
                      checked={selectedReturnIds.has(req.id)}
                      onChange={() => toggleReturnSelection(req.id)}
                    />
                  </span>
                  <span>{req.shopifyOrderName ?? "—"}</span>
                  <span>{req.customerName ?? "—"}</span>
                  <span>{req.customerAddress ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
          {returnQuotePreview ? (
            <div className={styles.returnQuoteRow}>
              <s-text type="strong">
                {t("modals.returnPickups.cost", {
                  amount: returnQuotePreview.total ?? "--",
                  currency: returnQuotePreview.currency ?? "",
                })}
              </s-text>
              {returnPickupFetcher.state !== "idle" ? (
                <s-button key="confirming-return" loading disabled>
                  {t("modals.returnPickups.confirming")}
                </s-button>
              ) : (
                <s-button key="confirm-return" variant="primary" onClick={handleConfirmReturnPickup}>
                  {t("modals.returnPickups.confirmRequest")}
                </s-button>
              )}
            </div>
          ) : null}
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="return-pickups-modal"
              command="--hide"
              onClick={() => setIsReturnPickupsModalOpen(false)}
            >
              {t("modals.returnPickups.cancel")}
            </s-button>
            {!returnQuotePreview ? (
              returnPickupFetcher.state !== "idle" ? (
                <s-button key="collecting-returns" loading disabled>
                  {t("modals.returnPickups.collecting")}
                </s-button>
              ) : (
                <s-button
                  key="collect-returns"
                  variant="primary"
                  disabled={selectedReturnIds.size === 0}
                  onClick={handleCollectReturns}
                >
                  {t("modals.returnPickups.collectReturns")}
                </s-button>
              )
            ) : null}
          </div>
        </s-stack>
      </s-modal>
      {addressWarnRoute ? (
        <s-modal id="address-warn-modal" heading={t("modals.addressWarn.heading")}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("modals.addressWarn.description")}</s-text>
            {addressWarnRoute.orderIds
              .map((id) => ordersById.get(id))
              .filter((o): o is LoaderOrder => o !== undefined && !o.addressValidation.isValid)
              .map((order) => (
                <s-box key={order.id} padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">
                      {order.name}{order.customerName ? ` • ${order.customerName}` : ""}
                    </s-text>
                    <s-text color="subdued">
                      {order.addressValidation.issueType === "apartment_in_address1"
                        ? t("modals.addressErrors.apartmentInAddress")
                        : order.addressValidation.issueType === "duplicate_number"
                          ? t("modals.addressErrors.duplicateNumber")
                          : order.addressValidation.issueType === "multiple_numbers_in_address1"
                            ? t("modals.addressErrors.multipleNumbers")
                            : t("modals.addressErrors.reviewNeeded")}
                    </s-text>
                    {(order.address1 || order.address2) && (
                      <div style={{ fontSize: 13, color: "#303030" }}>
                        {order.address1 && (
                          <div>{renderAddressHighlighted(order.address1, order.addressValidation.highlightPatterns)}</div>
                        )}
                        {order.address2 && (
                          <div>{renderAddressHighlighted(order.address2, order.addressValidation.highlightPatterns)}</div>
                        )}
                      </div>
                    )}
                    <s-link href={order.adminOrderUrl} target="_blank">
                      {t("modals.addressErrors.fixAddress")}
                    </s-link>
                  </s-stack>
                </s-box>
              ))}
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                onClick={() => {
                  setAddressWarnPendingRecheck(true);
                  revalidator.revalidate();
                }}
                disabled={revalidator.state !== "idle"}
              >
                {revalidator.state !== "idle" ? (
                  <s-spinner size="base" accessibilityLabel="" />
                ) : null}
                {t("modals.addressWarn.problemFixed")}
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                onClick={() => {
                  hideModal("address-warn-modal");
                  setAddressWarnRoute(null);
                  proceedWithDriverRequest(addressWarnRoute);
                }}
              >
                {t("modals.addressWarn.proceedAnyway")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      {foreignPhoneWarning ? (
        <s-modal id="foreign-phone-modal" heading={t("modals.foreignPhone.heading")}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("modals.foreignPhone.description")}</s-text>
            {foreignPhoneWarning.affectedOrders.map((order) => (
              <s-box key={order.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">
                    {order.name}{order.customerName ? ` • ${order.customerName}` : ""}
                  </s-text>
                  {order.phone ? (
                    <s-text color="subdued">{t("modals.foreignPhone.orderPhone", { phone: order.phone })}</s-text>
                  ) : null}
                </s-stack>
              </s-box>
            ))}
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                onClick={() => {
                  hideModal("foreign-phone-modal");
                  setForeignPhoneWarning(null);
                }}
              >
                {t("modals.foreignPhone.cancel")}
              </s-button>
              <s-button
                variant="primary"
                onClick={() => {
                  if (!quotePreview || quotePreview.routeId !== foreignPhoneWarning.routeId) {
                    setForeignPhoneWarning(null);
                    return;
                  }
                  const formData = new FormData();
                  formData.append("intent", "lalamove-place-order");
                  formData.append("routeId", quotePreview.routeId);
                  formData.append("locationId", quotePreview.locationId);
                  formData.append("quotationId", quotePreview.quotationId);
                  formData.append("quotationTotal", quotePreview.total ?? "");
                  formData.append("quotationCurrency", quotePreview.currency ?? "");
                  quotePreview.stopIds.forEach((stopId) => formData.append("stopIds", stopId));
                  quotePreview.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
                  formData.append("deliveryAssignments", JSON.stringify(quotePreview.deliveryAssignments));
                  const routeIdx = editableRoutes.findIndex((r) => r.id === quotePreview.routeId);
                  const routeTag = routeIdx >= 0 ? (ROUTE_TAG_DEFINITIONS[routeIdx]?.tag ?? null) : null;
                  if (routeTag) formData.append("routeTag", routeTag);
                  formData.append("skipPhoneWarning", "true");
                  if (
                    quotePreview.orderIds.some((id) => warehouseOrderIds.has(id))
                  ) {
                    formData.append("methodOverride", "1");
                  }
                  lalamoveFetcher.submit(formData, { method: "post" });
                  hideModal("foreign-phone-modal");
                  setForeignPhoneWarning(null);
                }}
              >
                {t("modals.foreignPhone.proceed")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      {cancelConfirmRouteId ? (
        <s-modal id="cancel-delivery-modal" heading={t("routeManager.cancelDeliveryHeading")}>
          <s-stack direction="block" gap="base">
            <s-text>{t("routeManager.cancelDeliveryConfirm")}</s-text>
            <div className={styles.cancelWarningBox}>
              <s-text type="strong">{t("routeManager.cancelDeliveryWarning")}</s-text>
            </div>
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                onClick={() => setCancelConfirmRouteId(null)}
              >
                {t("routeManager.cancelNo")}
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                onClick={() => handleCancelDelivery(cancelConfirmRouteId)}
              >
                {t("routeManager.cancelYes")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      <s-modal id="integration-log-modal" heading={t("routeManager.integrationLogHeading")}>
        <s-stack direction="block" gap="base">
          {integrationLogEvents.length === 0 ? (
            <s-text color="subdued">{t("routeManager.noLogEvents")}</s-text>
          ) : (
            integrationLogEvents.map((event) => (
              <s-box key={event.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <div className={styles.integrationLogEventHeader}>
                    <s-badge tone={event.eventType === "SHOPIFY_SYNC" ? "info" : undefined}>
                      {event.eventType}
                    </s-badge>
                    <s-text color="subdued">
                      {new Date(event.processedAt).toLocaleString()}
                    </s-text>
                  </div>
                  {event.externalStatus ? (
                    <s-text type="strong">{event.externalStatus}</s-text>
                  ) : null}
                </s-stack>
              </s-box>
            ))
          )}
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="integration-log-modal"
              command="--hide"
              onClick={() => setIntegrationLogRouteId(null)}
            >
              {t("modals.driverError.close")}
            </s-button>
          </div>
        </s-stack>
      </s-modal>
      {driverErrorModal ? (
        <s-modal id="driver-error-modal" heading={t("modals.driverError.headingFailed")}>
          <s-stack direction="block" gap="base">
            {/* Carrier readiness diagnostic — shown first */}
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-text type="strong">{t("modals.driverError.carrierDiagnostic")}</s-text>
              {locationId === DEFAULT_LOCATION_ID ? (
                <div className={styles.carrierDiagnosticSpacing}>
                  <s-text color="subdued">
                    {t("routeManager.selectLocationForCarrier")}
                  </s-text>
                </div>
              ) : (
                <div className={styles.carrierDiagnosticSpacing}>
                  {(() => {
                    const lalamoveConfig = lalamoveConfigMap[locationId];
                    const checks = [
                      { ok: !!credentialStatus.configured, label: t("modals.driverError.apiCredentials") },
                      { ok: !!lalamoveConfig?.market, label: t("modals.driverError.market") },
                      { ok: !!lalamoveConfig?.preferredServiceType, label: t("modals.driverError.vehicleType") },
                      { ok: !!lalamoveConfig?.locationName, label: t("modals.driverError.locationName") },
                      { ok: !!lalamoveConfig?.locationPhone, label: t("modals.driverError.locationPhone") },
                      { ok: !!lalamoveConfig?.locationAddress, label: t("modals.driverError.locationAddress") },
                    ];
                    return checks.map(({ ok, label }) => (
                      <div key={label} className={styles.carrierDiagnosticCheckRow}>
                        <span className={styles.carrierDiagnosticSymbol} style={{ color: ok ? "#008060" : "#D72C0D" }}>
                          {ok ? "✓" : "✗"}
                        </span>
                        <span className={styles.carrierDiagnosticLabel} style={{ color: ok ? undefined : "#D72C0D" }}>{label}</span>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </s-box>
            {/* Error details — shown second */}
            {driverErrorModal.errorDetails ? (
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-text type="strong">{t("modals.driverError.errorDetails")}</s-text>
                <pre className={styles.driverErrorDetails}>
                  {driverErrorModal.errorDetails}
                </pre>
              </s-box>
            ) : null}
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                commandFor="driver-error-modal"
                command="--hide"
                onClick={() => setDriverErrorModal(null)}
              >
                {t("modals.driverError.close")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      {dispatchAllStaleBanner ? (
        <s-banner tone="warning" dismissible onDismiss={() => setDispatchAllStaleBanner(null)}>
          {dispatchAllStaleBanner}
        </s-banner>
      ) : null}
      {polylineEditCapBanner ? (
        <s-banner
          tone="warning"
          dismissible
          onDismiss={() => setPolylineEditCapBanner(null)}
        >
          {polylineEditCapBanner}
        </s-banner>
      ) : null}
      {!mapsApiKey ? (
        <s-banner tone="warning" heading={t("banners.mapsKeyMissing")}>
          {t("banners.mapsKeyDescription")}
        </s-banner>
      ) : null}
      {!mapsMapId ? (
        <s-banner tone="warning" heading={t("banners.mapsMapIdMissing")}>
          {t("banners.mapsMapIdAdvancedMarkers")}
        </s-banner>
      ) : null}
      {ordersError ? (
        <s-banner tone="critical" heading={t("banners.ordersAccessRequired")}>
          {ordersError}
        </s-banner>
      ) : null}
      {debugLocalDelivery ? (
        <s-banner tone="info" heading={t("banners.debugMode")}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(debugLocalDelivery, null, 2)}
          </pre>
        </s-banner>
      ) : null}
      {/* Location gate (page-level): when no specific location is selected,
          neither map markers nor table checkboxes can do anything useful —
          control row is hidden, marker clicks are gated to no-op (lines
          ~1691/1722), and the All-orders checkbox column is hidden. This
          banner is the single source of truth explaining the gate. Spec:
          inputs/mockups/local-delivery-control-row-v1.html → "Location ===
          'all' — selection gate (page-level)" section. */}
      {/* The page-top all-locations banner was relocated to a grey badge
          inside the Route Manager block (2026-05-08, see routeManagerSection
          above). Body copy was dropped -- the short heading "Pick a
          location to start" is enough; the location selector right
          below the badge is the single affordance to fix the gate. */}
      <s-section>
      <div className={styles.mainBlocks}>
        <div className={isFullscreen ? styles.fullscreenOverlay : undefined}>
          <div className={isFullscreen ? styles.fullscreenContent : undefined}>
            <div
              className={
                isFullscreen ? styles.fullscreenSplitLayout : undefined
              }
            >
              <div className={isFullscreen ? styles.fullscreenMapPane : undefined}>
                <div className={styles.mapCanvasWrap}>
                  <div className={styles.mapOverlayButton} role="group">
                    <s-button
                      variant="secondary"
                      icon={isFullscreen ? "minimize" : "maximize"}
                      accessibilityLabel={
                        isFullscreen ? t("map.collapseMap") : t("map.expandMap")
                      }
                      aria-expanded={isFullscreen}
                      onClick={() => setIsFullscreen((current) => !current)}
                    />
                  </div>
                  {/* On-map polyline toolbar REMOVED (2026-05-06 review):
                      all editor actions (Edit / Confirm / Exit / Reassign-to /
                      Unassign / Clear selection) consolidated into the footer
                      control row below the map. Map overlay area is now just
                      the expand/collapse toggle. */}
                  <div
                    ref={mapContainerRef}
                    className={`${styles.mapCanvas} ${
                      isFullscreen ? styles.mapCanvasFullscreen : ""
                    } ${polylineEditMode ? styles.mapCanvasEditing : ""}`}
                  />
                </div>
                {mapData.locations.length === 0 && mapData.orders.length === 0 ? (
                  <s-text color="subdued">
                    {t("map.noCoordinates")}
                  </s-text>
                ) : null}
                <div className={styles.mapMetaRow}>
                  <div className={styles.mapLegendOutside}>
                    {/* 2026-05-15 v2: chip is icon-only at rest (mimics Polaris
                        secondary <s-button>); hover/focus reveals the "Legend"
                        label inline AND opens the popover. Popover has two
                        unlabeled columns: time-sensitive (chronological) | others
                        (alphabetical). Spec: inputs/mockups/local-delivery-
                        control-row-v1.html → "Legend chip + always-expanded
                        control buttons" section. */}
                    <span
                      className={styles.legendChip}
                      tabIndex={0}
                      role="button"
                      aria-label={t("map.legend.chipLabel")}
                    >
                      <span className={styles.legendChipIcon} aria-hidden="true">
                        <s-icon type="book-open" size="small" />
                      </span>
                      <span className={styles.legendChipLabel}>{t("map.legend.chipLabel")}</span>
                      <span className={styles.legendPop}>
                        <span className={styles.legendPopCol}>
                          <span className={styles.legendPopItem}>
                            <s-icon type="alert-triangle" tone="critical" size="small" />
                            {t("map.legend.overdue")}
                          </span>
                          <span className={styles.legendPopItem}>
                            <s-icon type="bolt" tone="caution" size="small" />
                            {t("map.legend.dueToday")}
                          </span>
                          <span className={styles.legendPopItem}>
                            <s-icon type="clock" tone="info" size="small" />
                            {t("map.legend.dueTomorrow")}
                          </span>
                          <span className={styles.legendPopItem}>
                            <s-icon type="clock" tone="neutral" size="small" />
                            {t("map.legend.dueLater")}
                          </span>
                        </span>
                        <span className={styles.legendPopCol}>
                          <span className={styles.legendPopItem}>
                            <s-icon type="alert-triangle" tone="caution" size="small" />
                            {t("map.legend.addressError")}
                          </span>
                          <span className={styles.legendPopItem}>
                            <s-icon type="x-circle" tone="critical" size="small" />
                            {t("map.legend.failed")}
                          </span>
                          <span className={styles.legendPopItem}>
                            <s-icon type="package" tone="neutral" size="small" />
                            {t("map.legend.routedFromWarehouse")}
                          </span>
                        </span>
                      </span>
                    </span>
                  </div>
                  {/* Unified state-driven control row (2026-05-06 review).
                      Buttons render only when in-context. 2026-05-15: dropped
                      the hover-expand pattern — labels now render permanently
                      in BOTH collapsed map block and fullscreen (legend
                      compaction frees the horizontal budget).
                      Spec: inputs/mockups/local-delivery-control-row-v1.html */}
                  <div
                    className={`${styles.mapBlockFooterRight}${
                      isFullscreen ? ` ${styles.mapBlockFooterRightFullscreen}` : ""
                    }`}
                  >
                    {(() => {
                      const isLocationContext = locationId !== DEFAULT_LOCATION_ID;
                      if (!isLocationContext) return null;
                      const hasSelection = selectedOrderIds.size > 0;
                      const hasAssignedSelection = [...selectedOrderIds].some((id) => assignedOrderIds.has(id));
                      const hasUnassignedSelection = [...selectedOrderIds].some((id) => !assignedOrderIds.has(id));
                      const hasChangesPending = dirtyRouteIds.size > 0;
                      const routesAtLocation = editableRoutes
                        .map((route, index) => ({ route, index }))
                        .filter(({ route }) => route.locationId === locationId);
                      // Edit button DROPPED (2026-05-06 final review): clicking
                      // any map label now enters edit mode automatically (wired
                      // in the marker click handler), so the explicit Edit
                      // button is redundant. State A (default, no selection)
                      // shows just the ⋯ menu.
                      // Reassign + Unassign: assigned selection (always inside
                      //   edit mode now since clicking enters it).
                      const showReassignCluster = hasAssignedSelection && routesAtLocation.length > 0;
                      // Assign-to-new-route: unassigned selection (auto-confirms).
                      const showAssignToNew = hasUnassignedSelection;
                      // Clear selection: any selection. Single icon (minus-circle)
                      //   regardless of state — Lucas's 2026-05-06 final pick.
                      const showClearSelection = hasSelection;
                      // Confirm: editing + changes pending.
                      const showConfirm = polylineEditMode && hasChangesPending;
                      // Exit: editing AND (no selection OR changes pending) —
                      //   hidden when selection exists with no changes (use
                      //   Clear selection first to surface Exit).
                      const showExit = polylineEditMode && (!hasSelection || hasChangesPending);
                      return (
                        <>
                          {showReassignCluster ? (
                            <>
                              <div className={styles.polylineReassignPopover}>
                                <s-button
                                  key="reassign-trigger"
                                  variant="secondary"
                                  icon="exchange"
                                  accessibilityLabel={t("map.polylineEdit.reassign")}
                                  commandFor="polyline-reassign-popover"
                                  command="--toggle"
                                >
                                  {t("map.polylineEdit.reassign")}
                                </s-button>
                                <s-popover id="polyline-reassign-popover">
                                  <s-menu accessibilityLabel={t("map.polylineEdit.reassign")}>
                                    {routesAtLocation.map(({ route, index }) => (
                                      <s-button
                                        key={`reassign-target-${route.id}`}
                                        onClick={() => {
                                          handleMoveSelectedToRoute(route.id);
                                          // CLAUDE.md: combining commandFor=--hide with
                                          // onClick races; dismiss programmatically instead.
                                          document.getElementById("polyline-reassign-popover")?.removeAttribute("open");
                                        }}
                                      >
                                        {t("map.polylineEdit.routeOptionLabel", {
                                          routeName: t("routeManager.routeLabel", { number: index + 1 }),
                                          orderCount: route.orderIds.length,
                                        })}
                                      </s-button>
                                    ))}
                                  </s-menu>
                                </s-popover>
                              </div>
                              <s-button
                                key="unassign"
                                variant="secondary"
                                tone="critical"
                                icon="delete"
                                accessibilityLabel={t("map.polylineEdit.unassign")}
                                disabled={isRoutingBusy || undefined}
                                onClick={handleUnassignSelected}
                              >
                                {t("map.polylineEdit.unassign")}
                              </s-button>
                            </>
                          ) : null}
                          {showAssignToNew ? (
                            <s-button
                              key="assign-to-new"
                              variant="primary"
                              icon="arrow-right-circle"
                              accessibilityLabel={t("map.assignToNewRoute")}
                              loading={isRoutingBusy}
                              disabled={
                                selectedOrderIds.size === 0 ||
                                routesWithOrdersCount >= ROUTE_TAGS.size ||
                                isRoutingBusy
                              }
                              onClick={handleAssignToNewRoute}
                            >
                              {t("map.assignToNewRoute")}
                            </s-button>
                          ) : null}
                          {showClearSelection ? (
                            <s-button
                              key="clear-selection"
                              variant="secondary"
                              icon="minus-circle"
                              accessibilityLabel={t("map.clearSelection")}
                              disabled={isRoutingBusy || undefined}
                              onClick={clearSelection}
                            >
                              {t("map.clearSelection")}
                            </s-button>
                          ) : null}
                          {showConfirm ? (
                            <s-button
                              key="confirm"
                              variant="primary"
                              icon="check-circle"
                              accessibilityLabel={t("map.polylineEdit.confirm")}
                              disabled={isRoutingBusy}
                              onClick={confirmPolylineEditMode}
                            >
                              {t("map.polylineEdit.confirm")}
                            </s-button>
                          ) : null}
                          {showExit ? (
                            <s-button
                              key="exit"
                              variant="secondary"
                              icon="x"
                              accessibilityLabel={t("map.polylineEdit.exit")}
                              onClick={() => {
                                // Exit-confirm gate: when changes are
                                // pending (States D / D' / G in the matrix),
                                // open the confirmation modal first. State B
                                // (no work pending) exits immediately. Spec:
                                // inputs/mockups/local-delivery-control-row-v1.html
                                if (hasChangesPending) {
                                  setExitConfirmOpen(true);
                                } else {
                                  cancelPolylineEditMode();
                                }
                              }}
                            >
                              {t("map.polylineEdit.exit")}
                            </s-button>
                          ) : null}
                        </>
                      );
                    })()}
                    {/* Map style — Polaris <s-link> (2026-05-10 final).
                        Doc: shopify.dev/docs/api/app-home/web-components/actions/link
                        Earlier iterations used s-button variant="tertiary"
                        (didn't render as a link) and a custom styled native
                        button (worked but bypassed Polaris). s-link is the
                        canonical primitive: native blue rendering, click
                        handler supported (no href + onClick = button-as-link
                        per the docs). Visible only when NOT in edit mode. */}
                    {!polylineEditMode ? (
                      <s-link
                        key="map-style"
                        onClick={() => {
                          // Programmatic open: setDraftMapStyle has to run
                          // BEFORE the modal opens (binds the radio group
                          // to the current style), and showOverlay() is
                          // the documented escape hatch when commandFor +
                          // sibling-menu auto-dismiss race (2026-05-06).
                          setDraftMapStyle(mapStyle);
                          setIsMapStyleModalOpen(true);
                          const modal = document.getElementById(
                            "map-style-modal",
                          ) as
                            | (HTMLElement & { showOverlay?: () => void })
                            | null;
                          modal?.showOverlay?.();
                        }}
                      >
                        {t("map.mapStyleButton")}
                      </s-link>
                    ) : null}
                  </div>
                </div>
                {isFullscreen ? renderOrdersSection() : null}
              </div>
              {/* Sidebar parity (Item 6): in fullscreen, render the same
                  Route Manager + Auto-assign Accuracy stack as the
                  collapsed view, in the same relative order, inside the
                  expanded split layout's aside column. */}
              {isFullscreen ? (
                <div className={styles.fullscreenAsidePane}>
                  {routeManagerSection}
                  {accuracyBlock}
                  <LdAnalyticsAside />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      </s-section>

      {!isFullscreen ? (
        <div slot="aside" className={styles.routeManagerBlock}>
          {phase1Status ? (
            <s-banner
              tone={phase1Status.ok ? "info" : "warning"}
              heading={
                phase1Status.ok
                  ? "AI route optimization succeeded"
                  : phase1Status.reason === "phase1_disabled"
                    ? "AI route optimization is off"
                    : phase1Status.reason === "unknown_market"
                      ? "AI doesn't support this city yet"
                      : phase1Status.reason === "no_credentials"
                        ? "Lalamove credentials missing"
                        : phase1Status.reason === "low_confidence"
                          ? "AI declined to optimize"
                          : "AI optimization failed"
              }
              dismissible
              onDismiss={() => setPhase1Status(null)}
            >
              {phase1Status.ok
                ? phase1Status.postMortemFlags.length > 0
                  ? `Routes applied. Confidence ${(phase1Status.confidence * 100).toFixed(0)}% — review the post-mortem panel for flagged choices (${phase1Status.decisionId}).`
                  : `Routes applied at ${(phase1Status.confidence * 100).toFixed(0)}% confidence.`
                : phase1Status.reason === "phase1_disabled"
                  ? "Turn on \"Use AI-powered route optimization\" in Settings > Local delivery for this location, then try again."
                  : phase1Status.reason === "unknown_market"
                    ? "Supported cities: São Paulo, Rio de Janeiro, Niterói, Recife. This location isn't covered yet — assign orders to routes manually."
                    : phase1Status.reason === "no_credentials"
                      ? "AI needs live Lalamove quotes to reason about cost. Add credentials in Settings > Carriers and try again."
                      : phase1Status.reason === "low_confidence"
                        ? `${phase1Status.message ?? "AI could not form a confident decision."} Try again in a moment, or assign orders manually. Decision id: ${phase1Status.decisionId ?? "—"}.`
                        : `${phase1Status.message ?? "Unknown error."} No routes were assigned — try again or assign orders manually.`}
            </s-banner>
          ) : null}
          {routeManagerSection}
          {accuracyBlock}
          <LdAnalyticsAside />
        </div>
      ) : null}

      {!isFullscreen ? renderOrdersSection() : null}

      {/* Order details modal — opens when an operator clicks a row in the
          All-orders table. Replaces the prior "open in Shopify in new tab"
          behavior. The Shopify deep-link is preserved as the footer's
          left-hand action. The Hybrid tag editor (operator quick-toggles
          + chip editor) is wired to the order-tag-update server action. */}
      <s-modal
        id="order-details-modal"
        heading={
          orderDetailsModalOrder
            ? t("orderDetailsModal.heading", {
                orderName: orderDetailsModalOrder.name,
              })
            : t("orderDetailsModal.headingFallback")
        }
      >
        {orderDetailsModalOrder ? (
          <div className={styles.orderModalBody}>
            {/* 2026-05-10 r2 reorganization: "Processed at" was inside the
                Items block at the top, which was hierarchically incoherent
                (an order-level timestamp inside a product-level container).
                Pulled out as a subtle subdued metadata strip directly under
                the modal heading. Items block now focuses purely on
                products + total. Date/time format stays the same. */}
            <div className={styles.orderModalSubtitle}>
              {formatOrderDateShort(orderDetailsModalOrder.processedAt)}
            </div>
            <div
              className={`${styles.orderModalCard} ${styles.orderModalFull}`}
            >
              <h3 className={styles.orderModalSectionTitle}>
                {t("orderDetailsModal.itemsHeading")}
              </h3>
              <div className={styles.orderModalLineItems}>
                {orderDetailsModalOrder.lineItems.length === 0 ? (
                  <span className={styles.orderModalKey}>
                    {t("orderDetailsModal.noLineItems")}
                  </span>
                ) : (
                  orderDetailsModalOrder.lineItems.map((li) => (
                    <div key={li.id} className={styles.orderModalLineItemRow}>
                      <span className={styles.orderModalVal}>{li.title}</span>
                      <span className={styles.orderModalKey}>
                        {t("orderDetailsModal.lineItemQty", {
                          count: li.quantity,
                        })}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className={styles.orderModalTotals}>
                <div className={styles.orderModalTotalsRow}>
                  <span>{t("orderDetailsModal.total")}</span>
                  <span>{orderDetailsModalOrder.total}</span>
                </div>
              </div>
            </div>

            {/* Customer block (2026-05-08 rewrite):
                  - "Name" label dropped (the value is self-evident).
                  - Email + Phone added with labels. Both fall back to "—" for
                    guest checkouts where the customer record has no contact.
                  - Processed at moved out of this block, now lives in Items. */}
            <div className={styles.orderModalCard}>
              <h3 className={styles.orderModalSectionTitle}>
                {t("orderDetailsModal.customer")}
              </h3>
              <div className={styles.orderModalCustomerName}>
                {orderDetailsModalOrder.customerName ??
                  t("customer.guest")}
              </div>
              <div className={styles.orderModalKeyVal}>
                <span className={styles.orderModalKey}>
                  {t("orderDetailsModal.customerEmail")}
                </span>
                <span className={styles.orderModalVal}>
                  {orderDetailsModalOrder.customerEmail ??
                    t("orderDetailsModal.noEmail")}
                </span>
              </div>
              <div className={styles.orderModalKeyVal}>
                <span className={styles.orderModalKey}>
                  {t("orderDetailsModal.customerPhone")}
                </span>
                <span className={styles.orderModalVal}>
                  {orderDetailsModalOrder.customerPhone ??
                    t("orderDetailsModal.noPhone")}
                </span>
              </div>
            </div>

            {/* Shipping address block — Plan B per Lucas's spec (Plan A,
                making the address editable inline, requires a Shopify
                orderUpdate mutation + form fields and is parked as a
                follow-up). The deep-link is now plain text "Edit in
                order page" with the diagonal arrow dropped. */}
            <div className={styles.orderModalCard}>
              <h3 className={styles.orderModalSectionTitle}>
                {t("orderDetailsModal.shippingAddress")}
              </h3>
              <div className={styles.orderModalAddress}>
                <span className={styles.orderModalVal}>
                  {orderDetailsModalOrder.address1 ??
                    t("orderDetailsModal.noAddress")}
                </span>
                {orderDetailsModalOrder.address2 ? (
                  <span className={styles.orderModalVal}>
                    {orderDetailsModalOrder.address2}
                  </span>
                ) : null}
                <span className={styles.orderModalKey}>
                  {t("orderDetailsModal.fulfillsFrom", {
                    location: orderDetailsModalOrder.fulfillmentLocation.name,
                  })}
                </span>
              </div>
              <a
                href={orderDetailsModalOrder.adminOrderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.orderModalAddressLink}
              >
                {t("orderDetailsModal.editAddressInShopify")}
              </a>
            </div>

            <div
              className={`${styles.orderModalCard} ${styles.orderModalFull}`}
            >
              <h3 className={styles.orderModalSectionTitle}>
                {t("orderDetailsModal.tags")}
              </h3>
              <div className={styles.orderModalTagsLabel}>
                {t("orderDetailsModal.operatorTagsLabel")}
              </div>
              <div className={styles.orderModalTagToggleRow}>
                {[
                  LD_FAILED_DELIVERY_TAG,
                  LD_ADDRESS_CONFIRM_TAG,
                  LD_NUMBER_CONFIRM_TAG,
                ].map((tag) => {
                  const isActive = (orderDetailsModalOrder.tags ?? []).includes(
                    tag,
                  );
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`${styles.orderModalTagToggle}${
                        isActive
                          ? ` ${styles.orderModalTagToggleActive}`
                          : ""
                      }`}
                      onClick={() =>
                        handleOrderTagToggle(
                          orderDetailsModalOrder.id,
                          tag,
                          isActive,
                        )
                      }
                    >
                      <span className={styles.orderModalTagToggleIndicator} />
                      {tag}
                    </button>
                  );
                })}
              </div>
              <div className={styles.orderModalTagsLabel}>
                {t("orderDetailsModal.allTagsLabel")}
              </div>
              <div className={styles.orderModalChipRow}>
                {(orderDetailsModalOrder.tags ?? [])
                  .filter(
                    (tag) =>
                      tag !== LD_FAILED_DELIVERY_TAG &&
                      tag !== LD_ADDRESS_CONFIRM_TAG &&
                      tag !== LD_NUMBER_CONFIRM_TAG,
                  )
                  .map((tag) => (
                    <span key={tag} className={styles.orderModalChip}>
                      {tag}
                      <button
                        type="button"
                        className={styles.orderModalChipRemove}
                        onClick={() =>
                          handleOrderTagRemove(
                            orderDetailsModalOrder.id,
                            tag,
                          )
                        }
                        aria-label={t("orderDetailsModal.removeTag", { tag })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions --
                    onKeyDown bubbles from the inner s-text-field; the wrapper
                    isn't interactive itself, it's a listener for the child
                    web component's events (Polaris s-text-field doesn't
                    expose onKeyDown via its React adapter). */}
                <div
                  className={styles.orderModalAddTagWrap}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      // s-text-field exposes its underlying input via the
                      // event target. We read .value off the target's
                      // value property.
                      const tf = event.target as { value?: string } | null;
                      const value = tf?.value ?? "";
                      if (value.trim()) {
                        handleOrderTagAdd(
                          orderDetailsModalOrder.id,
                          value,
                        );
                        if (tf) tf.value = "";
                      }
                    }
                  }}
                >
                  <s-text-field
                    label={t("orderDetailsModal.addTagPlaceholder")}
                    labelAccessibilityVisibility="exclusive"
                    placeholder={t("orderDetailsModal.addTagPlaceholder")}
                  />
                </div>
              </div>
            </div>

            <div
              className={`${styles.orderModalCard} ${styles.orderModalFull}`}
            >
              <h3 className={styles.orderModalSectionTitle}>
                {t("orderDetailsModal.internalNotes")}
              </h3>
              <p className={styles.orderModalNotesEmpty}>
                {t("orderDetailsModal.noNotes")}
              </p>
              <s-button disabled>
                {t("orderDetailsModal.addNote")} ·{" "}
                {t("orderDetailsModal.addNoteSoon")}
              </s-button>
            </div>
          </div>
        ) : null}

        {/* Footer — right-aligned buttons via shared .modalFooterRight class.
            2026-05-16: switched "Open full order" from <s-button onClick={window.open}>
            to <s-button href target="_blank"> because window.open() inside the
            Shopify Admin iframe was being intercepted by App Bridge and
            re-prefixed with the current store-scoped path, producing URLs that
            duplicated the `store/<handle>/` segment. Polaris-native href is
            App-Bridge-aware. Close button drops the `commandFor`/`command` race
            with onClick (CLAUDE.md rule) — dismiss programmatically. */}
        <div className={styles.modalFooterRight} slot="footer">
          {orderDetailsModalOrder ? (
            <s-button
              variant="secondary"
              href={orderDetailsModalOrder.adminOrderUrl}
              target="_blank"
            >
              {t("orderDetailsModal.openInShopify")}
            </s-button>
          ) : null}
          <s-button
            variant="primary"
            onClick={() => {
              setOrderDetailsModalOrderId(null);
              document
                .getElementById("order-details-modal")
                ?.removeAttribute("open");
            }}
          >
            {t("orderDetailsModal.close")}
          </s-button>
        </div>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

type LoaderOrder = {
  id: string;
  name: string;
  processedAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  total: string;
  shippingCost: { amount: number; currencyCode: string } | null;
  shippingSummary: string | null;
  address1: string | null;
  address2: string | null;
  adminOrderUrl: string;
  addressValidation: AddressValidationResult;
  shippingCoordinates: { latitude: number; longitude: number } | null;
  fulfillmentLocation: {
    id: string;
    name: string;
    coordinates: { latitude: number; longitude: number } | null;
  };
  /// Shopify fulfillmentOrders.deliveryMethod.methodType for the FulfillmentOrder
  /// matched at this location. "LOCAL" for native local-delivery orders;
  /// "SHIPPING" / "PICK_UP" / "RETAIL" / "NONE" for orders surfaced via the
  /// includeWarehouse override. Drives the warehouse marker in the Due column.
  methodType: string;
  tags: string[];
  lineItems: Array<{ id: string; title: string; quantity: number }>;
};

type LoaderLocation = {
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
};

type LalamoveConfig = {
  market: string;
  city: string;
  language: string;
  preferredServiceType: string;
  locationName: string;
  locationPhone: string;
  locationAddress: string;
  locationDetails: string;
  pickupInstructions: string;
  /** 0=same-day, 1=next-day, 2=D+2, etc. Drives due-bucket math for this location. */
  deliveryPromiseDays?: number | null;
  /** Same-day cutoff "HH:mm" — orders placed at/after this shift to next cycle. */
  orderCutoffTime?: string | null;
};

type LalamoveDeliveryAssignment = {
  stopId: string;
  orderId: string;
};

type DeliveryOrderPoint = {
  orderId: string;
  latitude: number;
  longitude: number;
};

const MAX_STOP_MATCH_DISTANCE = 0.0003;

const coordKey = (lat: number | string, lng: number | string): string => {
  const latitude = typeof lat === "string" ? parseFloat(lat) : lat;
  const longitude = typeof lng === "string" ? parseFloat(lng) : lng;
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
};

const tryParseNumber = (value: string | number | null | undefined) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const reconcileDeliveryAssignments = (
  responseDeliveryStops: Array<{
    stopId?: string;
    coordinates?: { lat?: string; lng?: string };
  }>,
  orderPoints: DeliveryOrderPoint[],
) => {
  const queueByCoord = new Map<string, string[]>();
  const pointByOrderId = new Map<string, { latitude: number; longitude: number }>();
  for (const point of orderPoints) {
    pointByOrderId.set(point.orderId, {
      latitude: point.latitude,
      longitude: point.longitude,
    });
    const key = coordKey(point.latitude, point.longitude);
    const list = queueByCoord.get(key) ?? [];
    list.push(point.orderId);
    queueByCoord.set(key, list);
  }

  const remainingOrderIds = new Set(orderPoints.map((point) => point.orderId));
  const assignments: LalamoveDeliveryAssignment[] = [];
  let exactMatches = 0;
  let nearestMatches = 0;

  for (const stop of responseDeliveryStops) {
    const stopId = stop.stopId;
    const stopLat = tryParseNumber(stop.coordinates?.lat);
    const stopLng = tryParseNumber(stop.coordinates?.lng);
    if (!stopId || stopLat == null || stopLng == null) {
      return {
        ok: false as const,
        error:
          "Lalamove returned an optimized stop without valid stopId/coordinates.",
      };
    }

    const key = coordKey(stopLat, stopLng);
    const queued = queueByCoord.get(key);
    let matchedOrderId: string | undefined;
    while (queued && queued.length > 0) {
      const candidate = queued.shift();
      if (candidate && remainingOrderIds.has(candidate)) {
        matchedOrderId = candidate;
        break;
      }
    }

    if (matchedOrderId) {
      exactMatches += 1;
    } else {
      let best: { orderId: string; distance: number } | null = null;
      let secondBest: { orderId: string; distance: number } | null = null;
      for (const orderId of remainingOrderIds) {
        const point = pointByOrderId.get(orderId);
        if (!point) continue;
        const distance = Math.hypot(
          stopLat - point.latitude,
          stopLng - point.longitude,
        );
        if (!best || distance < best.distance) {
          secondBest = best;
          best = { orderId, distance };
        } else if (!secondBest || distance < secondBest.distance) {
          secondBest = { orderId, distance };
        }
      }

      if (!best || best.distance > MAX_STOP_MATCH_DISTANCE) {
        return {
          ok: false as const,
          error:
            "Unable to map optimized Lalamove stops back to Shopify orders safely.",
        };
      }

      // Reject tie-like matches to avoid assigning remarks to the wrong order.
      if (
        secondBest &&
        Math.abs(secondBest.distance - best.distance) <= 1e-8
      ) {
        return {
          ok: false as const,
          error:
            "Ambiguous optimized stop mapping detected for nearby delivery addresses.",
        };
      }

      matchedOrderId = best.orderId;
      nearestMatches += 1;
    }

    remainingOrderIds.delete(matchedOrderId);
    assignments.push({ stopId, orderId: matchedOrderId });
  }

  if (assignments.length !== responseDeliveryStops.length) {
    return {
      ok: false as const,
      error: "Failed to reconcile all optimized stops to order IDs.",
    };
  }

  return {
    ok: true as const,
    assignments,
    stats: {
      totalStops: responseDeliveryStops.length,
      exactMatches,
      nearestMatches,
      unmatched: remainingOrderIds.size,
    },
  };
};

const toQueryValue = (value: string | null, fallback: string) =>
  value && value.length > 0 ? value : fallback;

const toDeliveryMethodType = (value: string) =>
  value.replace("-", "_").toUpperCase();

const getOrderInfoContent = (order: LoaderOrder, guestFallback: string, noAddressFallback: string) => {
  const customer = order.customerName ?? guestFallback;
  const address = order.shippingSummary ?? noAddressFallback;
  return `
    <div style="display:flex;flex-direction:column;gap:4px;">
      <strong>${order.name}</strong>
      <span>${customer}</span>
      <span>${address}</span>
      <span>${order.total}</span>
    </div>
  `;
};

const GRAYSCALE_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  {
    featureType: "poi",
    elementType: "all",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.land_parcel",
    elementType: "labels.text.fill",
    stylers: [{ color: "#bdbdbd" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }],
  },
  {
    featureType: "road.arterial",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#dadada" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#616161" }],
  },
  {
    featureType: "road.local",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9e9e9e" }],
  },
  {
    featureType: "transit",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#c9c9c9" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9e9e9e" }],
  },
];

const DARK_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi",
    elementType: "all",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#38414e" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#212a37" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9ca5b3" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#746855" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1f2835" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#f3d19c" }],
  },
  {
    featureType: "transit",
    elementType: "all",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17263c" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#515c6d" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#17263c" }],
  },
];

const MAPS_SCRIPT_ID = "google-maps-sdk";
let mapsLoader: Promise<void> | null = null;

const loadGoogleMaps = (apiKey: string) => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Maps can only load in the browser"));
  }
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return Promise.reject(new Error("Google Maps API key is missing"));
  }
  if (window.google?.maps) {
    return Promise.resolve();
  }
  if (mapsLoader) {
    return mapsLoader;
  }

  mapsLoader = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(
      MAPS_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve());
      existingScript.addEventListener("error", () =>
        reject(new Error("Google Maps failed to load")),
      );
      return;
    }

    const script = document.createElement("script");
    script.id = MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      trimmedKey,
    )}&v=weekly&libraries=marker,geometry,places`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () =>
      reject(new Error("Google Maps failed to load")),
    );
    document.head.appendChild(script);
  });

  return mapsLoader;
};

const formatAddress = (parts: Array<string | null | undefined>) =>
  parts.filter(Boolean).join(", ");

// Returns just the street line. address2 (complemento) is appended downstream
// by enrichStopAddressWithAddress2 in lalamove.server.ts; including it here too
// produced "{adr2}, {adr1}, {adr2}" in Lalamove POSTs.
const formatDeliveryStopAddress = (
  address1: string | null | undefined,
  address2: string | null | undefined,
) => {
  const line1 = (address1 ?? "").trim();
  const line2 = (address2 ?? "").trim();
  return line1 || line2;
};

const formatFulfillmentStopAddress = (
  locationName: string | null | undefined,
  locationAddress: string | null | undefined,
  locationDetails: string | null | undefined,
) => {
  const name = (locationName ?? "").trim();
  const address = (locationAddress ?? "").trim();
  const details = (locationDetails ?? "").trim();
  return [name, address, details].filter(Boolean).join(" • ");
};

const formatMoney = (amount: string, currencyCode: string) =>
  `${currencyCode} ${Number(amount).toFixed(2)}`;

const formatCurrency = (amount: number, currencyCode: string, userLocale: string) => {
  const locale = userLocale.replace("_", "-");
  // Per backlog 2026-05-16: the route-card cost + shipping line must read
  // "R$31,66" not "R$ 31,66". Intl.NumberFormat for pt-BR always inserts a
  // narrow no-break space between symbol and digits — strip it so the route
  // card and lalamove quote share one consistent currency format.
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  })
    .format(amount)
    .replace(/(\D)\s+(\d)/, "$1$2");
};

function formatOrderDateShort(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const hour24 = date.getHours();
  const ampm = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const time = `${hour12}${ampm}`;
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
    return `${weekday} ${time}`;
  }
  const md = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  return `${md} ${time}`;
}

const isPresaleTag = (tag: string) => {
  const lower = tag.toLowerCase();
  return lower.startsWith("pré-venda") || lower.startsWith("pre-venda");
};

const extractPresaleTagsFromOrders = (
  inputOrders: Array<{ tags?: string[] | string | null }>,
) => {
  const set = new Set<string>();
  inputOrders.forEach((order) => {
    const tagsRaw = order.tags ?? [];
    const tags = Array.isArray(tagsRaw)
      ? tagsRaw
      : String(tagsRaw)
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
    tags.forEach((tag) => {
      if (isPresaleTag(tag)) set.add(tag);
    });
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

type AddressValidationResult = {
  isValid: boolean;
  issueType: "apartment_in_address1" | "duplicate_number" | "multiple_numbers_in_address1" | null;
  suggestedAddress1: string | null;
  suggestedAddress2: string | null;
  highlightPatterns: string[]; // substrings to bold in address display
};

function renderAddressHighlighted(text: string | null | undefined, patterns: string[]): React.ReactNode {
  if (!text) return null;
  if (patterns.length === 0) return text;
  const escaped = [...patterns].sort((a, b) => b.length - a.length).map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const regex = new RegExp(`(${escaped.join("|")})`, "g");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        patterns.includes(part) ? <strong key={i}>{part}</strong> : part,
      )}
    </>
  );
}

const validateAddressFormat = (
  address1: string | null | undefined,
  address2: string | null | undefined,
): AddressValidationResult => {
  const line1 = (address1 ?? "").trim();
  const line2 = (address2 ?? "").trim();
  if (!line1) {
    return {
      isValid: true,
      issueType: null,
      suggestedAddress1: line1 || null,
      suggestedAddress2: line2 || null,
      highlightPatterns: [],
    };
  }

  const apartmentKeywordRegex =
    /\b(apt|apto|apartamento|suite|bloco|casa|sala|andar|ap|unit|unidade|floor)\b[\s#-]*(\d+)/i;
  const apartmentMatch = line1.match(apartmentKeywordRegex);
  if (apartmentMatch) {
    const aptPart = apartmentMatch[0]!.trim();
    const cleanedLine1 = line1.replace(apartmentKeywordRegex, "").replace(/\s{2,}/g, " ").trim();
    const nextLine2 = [line2, aptPart].filter(Boolean).join(", ");
    return {
      isValid: false,
      issueType: "apartment_in_address1",
      suggestedAddress1: cleanedLine1 || line1,
      suggestedAddress2: nextLine2 || aptPart,
      highlightPatterns: [aptPart],
    };
  }

  const numberRegex = /\b\d+\b/g;
  const line1Numbers = line1.match(numberRegex) ?? [];
  const line2Numbers: string[] = line2.match(numberRegex) ?? [];

  // Flag if address1 alone has 2+ separate numeric tokens (e.g. "Rua Catuana 902 60")
  if (line1Numbers.length >= 2) {
    return {
      isValid: false,
      issueType: "multiple_numbers_in_address1",
      suggestedAddress1: line1,
      suggestedAddress2: line2 || null,
      highlightPatterns: line1Numbers,
    };
  }

  const duplicated = line1Numbers.find((num) => line2Numbers.includes(num));
  if (duplicated) {
    const nextLine2 = line2
      .replace(new RegExp(`\\b${duplicated}\\b`, "g"), "")
      .replace(/\s{2,}/g, " ")
      .replace(/^,\s*|\s*,$/g, "")
      .trim();
    return {
      isValid: false,
      issueType: "duplicate_number",
      suggestedAddress1: line1,
      suggestedAddress2: nextLine2 || null,
      highlightPatterns: [duplicated],
    };
  }

  return {
    isValid: true,
    issueType: null,
    suggestedAddress1: line1 || null,
    suggestedAddress2: line2 || null,
    highlightPatterns: [],
  };
};

// ---------------------------------------------------------------------------
// Route precompute constants & helpers (must be before loader)
// ---------------------------------------------------------------------------

const ROUTE_PRECOMPUTE_COLORS = [
  "#2C6ECB",
  "#008060",
  "#B98900",
  "#D82C0D",
  "#6D47C7",
  "#FFD400",
  "#955251",
  "#8B5E3C",
  "#6D7175",
  "#FF7A00",
  "#00A3A3",
  "#C2185B",
  "#5E35B1",
  "#2E7D32",
  "#3949AB",
];

const ROUTE_EMOJIS = [
  "🔴", "🟠", "🟢", "🔵", "🟣", "🟤", "⚫", "⚪",
  "🔴", "🟠", "🟢", "🔵", "🟣", "🟤", "⚫", "⚪",
  "🔴", "🟠", "🟢",
];

const ROUTE_TAG_DEFINITIONS = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const label = `Route ${String(n).padStart(2, "0")}`;
  const tag = `ld_rota-${String(n).padStart(2, "0")}`;
  return {
    label,
    tag,
    emoji: ROUTE_EMOJIS[i] ?? "📦",
    color: ROUTE_PRECOMPUTE_COLORS[i % ROUTE_PRECOMPUTE_COLORS.length]!,
  };
});

const ROUTE_TAGS = new Map<string, string>(
  ROUTE_TAG_DEFINITIONS.map((def, i) => [`rota-${i + 1}`, def.tag]),
);


const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 6) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
};

const toRgbString = (rgb: { r: number; g: number; b: number }) =>
  `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

const mix = (value: number, target: number, ratio: number) =>
  Math.round(value + (target - value) * ratio);

// 78% white-mix produces a Polaris-pastel bg readable on the white side-panel
// cards. The map markers need a more saturated mix because the dark Google
// Maps tiles wash out anything that pale. Per 2026-05-12 Lucas decision
// (inputs/mockups/ld-map-pills-polaris-v1.html), the map gets its own
// 55%-mix derivation while side-panel cards keep 78%.
const deriveBadgeColorsAt = (hexColor: string, bgRatio: number) => {
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return {
      bg: "rgb(235, 239, 246)",
      text: "rgb(44, 58, 76)",
    };
  }
  const bg = {
    r: mix(rgb.r, 255, bgRatio),
    g: mix(rgb.g, 255, bgRatio),
    b: mix(rgb.b, 255, bgRatio),
  };
  const text = {
    r: mix(rgb.r, 0, 0.35),
    g: mix(rgb.g, 0, 0.35),
    b: mix(rgb.b, 0, 0.35),
  };
  return {
    bg: toRgbString({
      r: clamp(bg.r, 0, 255),
      g: clamp(bg.g, 0, 255),
      b: clamp(bg.b, 0, 255),
    }),
    text: toRgbString({
      r: clamp(text.r, 0, 255),
      g: clamp(text.g, 0, 255),
      b: clamp(text.b, 0, 255),
    }),
  };
};

const deriveBadgeColors = (hexColor: string) => deriveBadgeColorsAt(hexColor, 0.78);
const deriveBadgeColorsForMap = (hexColor: string) => deriveBadgeColorsAt(hexColor, 0.55);
const LALAMOVE_SERVICE_TYPES = [
  { value: "CAR", label: "CAR" },
  { value: "CARFOURH", label: "CARFOURH" },
  { value: "HATCHBACK", label: "HATCHBACK" },
  { value: "HATCHFOURH", label: "HATCHFOURH" },
  { value: "LALAGO", label: "LALAGO" },
  { value: "LALAGOFOUR", label: "LALAGOFOUR" },
  { value: "LALAPRO", label: "LALAPRO" },
  { value: "TRUCK330", label: "TRUCK330" },
  { value: "TRUCK3_5T", label: "TRUCK3_5T" },
  { value: "TRUCK_6H", label: "TRUCK_6H" },
  { value: "UV_4H", label: "UV_4H" },
  { value: "UV_FIORINO", label: "UV_FIORINO" },
  { value: "VAN", label: "VAN" },
  { value: "VANFOURH", label: "VANFOURH" },
];

type PrecomputedRoute = {
  id: string;
  locationId: string;
  polyline: string;
  color: string;
  orderIds: string[];
  totalDistanceMeters?: number;
  totalDurationSeconds?: number;
};


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const loaderT0 = Date.now();
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const userLocale =
    typeof (session as any).locale === "string" && (session as any).locale.length > 0
      ? (session as any).locale
      : "pt_BR";
  const url = new URL(request.url);
  const debugEnabled = url.searchParams.get("debugLocalDelivery") === "1";
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
  // Warehouse-method override toggle. When set to "1", the loader surfaces
  // orders whose Shopify deliveryMethod is not LOCAL (e.g. SHIPPING) so the
  // operator can dispatch them via Lalamove from the store location where
  // their FulfillmentOrder has been moved (in Shopify admin, separately).
  // Off by default — deliberate operator action required to surface them.
  const includeWarehouse = url.searchParams.get("includeWarehouse") === "1";
  const deliveryMethod = includeWarehouse
    ? "all"
    : toQueryValue(
        url.searchParams.get("deliveryMethod"),
        DEFAULT_DELIVERY_METHOD,
      );
  const locationId = toQueryValue(
    url.searchParams.get("locationId"),
    DEFAULT_LOCATION_ID,
  );
  // Hardwired D-90 window — was a user-facing filter, now a fixed lookback so
  // the ops surface always shows the relevant order pool.
  const startDateKey = toStartDateKey(null);
  // deliveryPromiseDays comes from per-location Lalamove settings on the client;
  // the server-side default exists only for back-compat with the filters payload.
  const deliveryPromiseDays = DEFAULT_DELIVERY_PROMISE_DAYS;
  const selectedPresaleTags = toPresaleTags(url.searchParams.get("presaleTags"));

  // Per-step timing — fires through the whole loader so we can attribute
  // latency post-hoc when the route hits 502 again. Convention follows
  // CLAUDE.md "Logging" §[module] step=… durationMs=… shop=…
  const timeStep = (label: string) => {
    const t0 = Date.now();
    return (extra?: string) => {
      const ms = Date.now() - t0;
      console.info(
        `[local-delivery] loader step=${label} durationMs=${ms}${extra ? ` ${extra}` : ""} shop=${shop}`,
      );
    };
  };

  // Phase 1 — three independent boundary fetches in parallel:
  //   (a) Shopify locations,
  //   (b) Shopify delivery profiles (used to filter which locations have a "local" method),
  //   (c) the per-shop Prisma trio (lalamove configs + credentials + return-pickup requests).
  // None of these depend on each other, so the prior sequential layout was
  // wasting ~500-1000ms of round-trip time per loader fire.
  const endPhase1 = timeStep("phase1-parallel");
  const locationsPromise = admin.graphql(
    `#graphql
      query LocationsForMap {
        locations(first: 50) {
          nodes {
            id
            name
            localPickupSettingsV2 { instructions }
            address {
              address1
              address2
              city
              province
              country
              countryCode
              phone
              latitude
              longitude
            }
          }
        }
      }`,
  );

  const deliveryProfilesPromise = admin
    .graphql(
      `#graphql
        query DeliveryProfilesForLocalDelivery {
          deliveryProfiles(first: 20) {
            nodes {
              profileLocationGroups {
                locationGroup {
                  locations(first: 20) {
                    nodes {
                      id
                    }
                  }
                }
                locationGroupZones(first: 20) {
                  nodes {
                    methodDefinitions(first: 20) {
                      nodes {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
    )
    .then((res) => res.json())
    .catch((error: unknown) => {
      console.warn(
        "[local-delivery] loader: failed to load delivery profiles for filtering",
        error,
      );
      return null;
    });

  const prismaTrioPromise = Promise.all([
    prisma.lalamoveLocationConfig.findMany({ where: { shop } }),
    hasShopCredentials(shop),
    prisma.returnPickupRequest.findMany({
      where: { shop, status: { in: ["pending", "quoted"] } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const [locationsResponse, deliveryProfilesJson, [lalamoveConfigRows, credentialStatus, returnPickupRequests]] =
    await Promise.all([locationsPromise, deliveryProfilesPromise, prismaTrioPromise]);
  endPhase1();

  const endLocationsParse = timeStep("locations-parse");
  const locationsJson = await locationsResponse.json();
  const allLocations = (locationsJson?.data?.locations?.nodes ?? []) as Array<{
    id: string;
    name: string;
    localPickupSettingsV2: { instructions: string } | null;
    address: {
      address1: string | null;
      address2: string | null;
      city: string | null;
      province: string | null;
      country: string | null;
      countryCode: string | null;
      phone: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
  }>;

  // Filter to stores only (pickup enabled = physical store, null = warehouse/DC)
  const locations = allLocations.filter((loc) => loc.localPickupSettingsV2 != null);
  endLocationsParse(`stores=${locations.length} all=${allLocations.length}`);

  const lalamoveConfigs = lalamoveConfigRows.reduce<
    Record<string, LalamoveConfig>
  >((acc, row) => {
    acc[row.locationId] = row.data as LalamoveConfig;
    return acc;
  }, {});

  // Always inject Location registration data into Lalamove config (name, details); Location overrides saved config
  const locationsById = new Map(
    locations.map((loc) => [loc.id, loc]),
  );
  for (const [locId, config] of Object.entries(lalamoveConfigs)) {
    const loc = locationsById.get(locId);
    if (loc) {
      (lalamoveConfigs as Record<string, LalamoveConfig>)[locId] = {
        ...config,
        locationName: (loc.name ?? "").trim() || config.locationName || "",
        locationDetails: (loc.address?.address2 ?? "").trim() || config.locationDetails || "",
        pickupInstructions: config.pickupInstructions ?? "",
      };
    }
  }

  // Parse delivery profiles (already fetched in phase 1).
  let localDeliveryLocationIds: Set<string> | null = null;
  if (deliveryProfilesJson) {
    const profileGroups =
      deliveryProfilesJson.data?.deliveryProfiles?.nodes?.flatMap(
        (profile: {
          profileLocationGroups: Array<{
            locationGroup: { locations: { nodes: Array<{ id: string }> } };
            locationGroupZones: {
              nodes: Array<{
                methodDefinitions: { nodes: Array<{ name: string | null }> };
              }>;
            };
          }>;
        }) => profile.profileLocationGroups,
      ) ?? [];
    const localIds = new Set<string>();
    profileGroups.forEach((group: any) => {
      const hasLocalDelivery = group.locationGroupZones.nodes.some((zone: any) =>
        zone.methodDefinitions.nodes.some((method: any) =>
          (method.name ?? "").toLowerCase().includes("local"),
        ),
      );
      if (!hasLocalDelivery) return;
      group.locationGroup.locations.nodes.forEach((location: any) =>
        localIds.add(location.id),
      );
    });
    localDeliveryLocationIds = localIds.size > 0 ? localIds : null;
  }

  const effectiveLocationId =
    locationId !== DEFAULT_LOCATION_ID &&
    localDeliveryLocationIds &&
    !localDeliveryLocationIds.has(locationId)
      ? DEFAULT_LOCATION_ID
      : locationId;

  const orderFilters: string[] = [];
  if (deliveryMethod === "all") {
    // Warehouse-override toggle on — narrow the server-side query to the
    // only two methodTypes that ever reach the page (LOCAL natively + SHIPPING
    // for warehouse-bound rows) AND drop fully-FULFILLED orders. Prior to
    // 2026-05-15 the toggle-on path dropped the delivery_method filter
    // entirely, which caused the loader to page through ~2000 orders for a
    // typical ge-beauty session (PICK_UP + RETAIL + NONE + already-shipped
    // FULFILLED rows all came back). Concurrent loader revalidations then
    // tripped Shopify's cost-based GraphQL rate limit → application errors.
    //
    // Why `-fulfillment_status:fulfilled` instead of `fulfillment_status:unshipped`:
    // negation drops ONLY fully fulfilled rows. UNFULFILLED, PARTIALLY_FULFILLED,
    // IN_PROGRESS, ON_HOLD, SCHEDULED, PENDING_FULFILLMENT, RESTOCKED all
    // still pass, which keeps the failed-Lalamove-delivery retry path intact
    // (those orders sit at `UNFULFILLED` with a `Failed delivery` tag — never
    // FULFILLED at the Shopify level). Client-side per-row gates in the
    // warehouse-bound block (channel allowlist + UNFULFILLED/PARTIALLY) are
    // unchanged.
    orderFilters.push("(delivery_method:local OR delivery_method:shipping)");
    orderFilters.push("-fulfillment_status:fulfilled");
  } else {
    orderFilters.push(`delivery_method:${toDeliveryMethodType(deliveryMethod)}`);
  }
  if (effectiveLocationId !== DEFAULT_LOCATION_ID) {
    const legacyId = toLegacyLocationId(effectiveLocationId);
    orderFilters.push(`fulfillment_location_id:${legacyId}`);
  }
  // Toggle-off: include all fulfillment statuses, then exclude delivered /
  // cancelled in post-filter. Preserves the retry-failed-LOCAL-delivery path.
  orderFilters.push("-status:cancelled");
  orderFilters.push(`created_at:>=${startDateKey}`);
  const query = orderFilters.length > 0 ? orderFilters.join(" ") : undefined;

  // Parallel count of warehouse-located UNFULFILLED orders for the current
  // store location. Runs regardless of the includeWarehouse toggle so we can
  // surface a hint badge ("N warehouse orders hidden") when the toggle is OFF
  // but warehouse-method rows would be eligible. Skipped at "All locations"
  // (the badge is location-scoped, mirrors the warehouse toggle visibility).
  // Cost: ~1 extra GraphQL call returning a single integer.
  const endWarehouseHiddenCount = timeStep("warehouse-hidden-count");
  const warehouseHiddenCountPromise: Promise<number> = (async () => {
    if (effectiveLocationId === DEFAULT_LOCATION_ID) return 0;
    if (includeWarehouse) return 0; // already visible — nothing to hint
    const legacyId = toLegacyLocationId(effectiveLocationId);
    const hiddenQuery = [
      "delivery_method:shipping",
      `fulfillment_location_id:${legacyId}`,
      "-fulfillment_status:fulfilled",
      "-status:cancelled",
      `created_at:>=${startDateKey}`,
    ].join(" ");
    try {
      const response = await admin.graphql(
        `#graphql
        query WarehouseHiddenCount($query: String!) {
          ordersCount(query: $query) { count precision }
        }`,
        { variables: { query: hiddenQuery } },
      );
      const json = await response.json();
      const raw = json?.data?.ordersCount?.count;
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (error) {
      console.warn(
        `[local-delivery] warehouseHiddenCount FAILED shop=${shop} location=${effectiveLocationId}`,
        error,
      );
      return 0;
    }
  })();

  let ordersError: string | null = null;
  let orders: Array<{
    id: string;
    name: string;
    processedAt: string | null;
    displayFulfillmentStatus: string;
    /// Channel origin — used by the warehouse-method override eligibility
    /// filter. `web` = Online Store, `shopify_draft_order` = completed draft,
    /// numeric app ID = third-party channel (e.g. `316281618433` = Hexagon,
    /// `206755758081` = IGLU POS). Empty / null on some pre-channel orders.
    sourceName: string | null;
    tags: string[];
    email: string | null;
    phone: string | null;
    customer: { displayName: string; email: string | null; phone: string | null } | null;
    currentTotalPriceSet: {
      shopMoney: { amount: string; currencyCode: string };
    } | null;
    currentShippingPriceSet: {
      shopMoney: { amount: string; currencyCode: string };
    } | null;
    lineItems: {
      nodes: Array<{
        id: string;
        title: string;
        quantity: number;
      }>;
    } | null;
    shippingAddress: {
      address1: string | null;
      address2: string | null;
      city: string | null;
      province: string | null;
      country: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
    fulfillmentOrders: {
      nodes: Array<{
        id: string;
        deliveryMethod: { methodType: string; presentedName: string | null };
        destination: {
          firstName: string | null;
          lastName: string | null;
          email: string | null;
          phone: string | null;
        } | null;
        assignedLocation: {
          name: string;
          address1: string | null;
          city: string | null;
          province: string | null;
          countryCode: string | null;
          zip: string | null;
          location: {
            id: string;
            address: {
              address1: string | null;
              city: string | null;
              province: string | null;
              country: string | null;
              latitude: number | null;
              longitude: number | null;
            } | null;
          } | null;
        } | null;
      }>;
    };
    fulfillments?: Array<{ displayStatus: string }>;
  }> = [];

  // Phase 2 — orders pagination + the optimizer-accuracy lookup run in parallel.
  // The optimizer-accuracy query is independent (filters routeCorrection by
  // shop + 30d window) and adds another DB round-trip if run sequentially.
  // Use a promise that returns the value (rather than mutating an outer `let`)
  // so TypeScript narrows the type cleanly across the await boundary.
  type OptimizerAccuracy = {
    optimizations: number;
    modified: number;
    totalDispatched: number;
    totalReassigned: number;
  };
  const endOrdersFetch = timeStep("orders-graphql-pagination");
  // Count AI decisions that need operator review — unreviewed rows that
  // carry at least one postMortemFlag. Surfaces inside the Auto-assign
  // accuracy section as a "N decisions to review" badge + link to the
  // post-mortem panel.
  const pendingPostMortemReviewCountPromise: Promise<number> = (async () => {
    try {
      const rows = await (prisma as {
        routeOptimizationDecision: {
          findMany: (args: unknown) => Promise<Array<{ postMortemFlagsJson: unknown }>>;
        };
      }).routeOptimizationDecision.findMany({
        where: { shop, operatorReviewed: false },
        select: { postMortemFlagsJson: true },
      });
      return rows.filter((r) => {
        const flags = r.postMortemFlagsJson;
        return Array.isArray(flags) && flags.length > 0;
      }).length;
    } catch {
      return 0;
    }
  })();
  const optimizerAccuracyPromise: Promise<OptimizerAccuracy | null> = (async () => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const corrections = await (prisma as any).routeCorrection.findMany({
        where: { shop, dispatchedAt: { gte: thirtyDaysAgo } },
        select: { snapshotId: true, wasModified: true, ordersDispatched: true, ordersReassigned: true },
      });
      if (corrections.length > 0) {
        const uniqueSnapshots = new Set(corrections.map((c: any) => c.snapshotId));
        const modifiedSnapshots = new Set(
          corrections.filter((c: any) => c.wasModified).map((c: any) => c.snapshotId),
        );
        return {
          optimizations: uniqueSnapshots.size,
          modified: modifiedSnapshots.size,
          totalDispatched: corrections.reduce((sum: number, c: any) => sum + (c.ordersDispatched ?? 0), 0),
          totalReassigned: corrections.reduce((sum: number, c: any) => sum + (c.ordersReassigned ?? 0), 0),
        };
      }
      return null;
    } catch {
      return null;
    }
  })();

  let pagesFetched = 0;
  try {
    let hasNextPage = true;
    let after: string | null = null;
    while (hasNextPage) {
      const ordersResponse: Response = await admin.graphql(
        `#graphql
        query OrdersMapView($first: Int!, $after: String, $query: String) {
          orders(first: $first, after: $after, query: $query) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              name
              processedAt
              displayFulfillmentStatus
              sourceName
              tags
              email
              phone
              customer {
                displayName
                email
                phone
              }
              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              currentShippingPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              lineItems(first: 20) {
                nodes {
                  id
                  title
                  quantity
                }
              }
              shippingAddress {
                address1
                address2
                city
                province
                country
                latitude
                longitude
              }
              fulfillmentOrders(first: 10) {
                nodes {
                  id
                  deliveryMethod {
                    methodType
                    presentedName
                  }
                  destination {
                    firstName
                    lastName
                    email
                    phone
                  }
                  assignedLocation {
                    name
                    address1
                    city
                    province
                    countryCode
                    zip
                    location {
                      id
                      address {
                        address1
                        city
                        province
                        country
                        latitude
                        longitude
                      }
                    }
                  }
                }
              }
              fulfillments(first: 10) {
                displayStatus
              }
            }
          }
        }`,
        { variables: { first: 100, after, query } },
      );

      const ordersJson: any = await ordersResponse.json();
      const payload: any = ordersJson?.data?.orders;
      const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
      orders.push(...nodes);
      pagesFetched += 1;
      hasNextPage = Boolean(payload?.pageInfo?.hasNextPage);
      after = payload?.pageInfo?.endCursor ?? null;
    }

  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error loading orders.";
    if (message.includes("not approved to access the Order object")) {
      ordersError =
        "This app needs protected customer data approval to access orders. Request approval in the Shopify Partner Dashboard, then reinstall the app.";
    } else if (
      // Shopify GraphQL cost-based throttle. Returns `GraphqlQueryError:
      // Throttled` when concurrent paginations exceed the bucket. Surface as
      // a recoverable banner instead of throwing to React Router's error
      // boundary — the user sees an actionable message + can retry, rather
      // than the generic "Application error" wall.
      error instanceof Error &&
      (error.name === "GraphqlQueryError" || message.includes("Throttled"))
    ) {
      console.warn(
        `[local-delivery] orders-graphql-pagination THROTTLED shop=${shop} pages=${pagesFetched} message=${message}`,
      );
      ordersError =
        "Shopify rate-limited the request. Please wait a few seconds and refresh.";
    } else {
      throw error;
    }
  }
  endOrdersFetch(`pages=${pagesFetched} rows=${orders.length}`);

  // Wait for the optimizer-accuracy lookup if it hasn't completed yet
  // (typically much faster than orders pagination, but await to be safe).
  const optimizerAccuracy = await optimizerAccuracyPromise;
  const pendingPostMortemReviewCount = await pendingPostMortemReviewCountPromise;

  const normalizedDeliveryMethod =
    deliveryMethod === "all" ? null : toDeliveryMethodType(deliveryMethod);

  const debugDropCounters = debugEnabled
    ? {
        noFulfillmentOrders: 0,
        noAssignedLocation: 0,
        locationMismatch: 0,
        deliveryMethodMismatch: 0,
        unknown: 0,
      }
    : null;

  const endFilterMap = timeStep("orders-filter-map");
  const availablePresaleTags = extractPresaleTagsFromOrders(orders);
  const selectedPresaleTagSet = new Set(selectedPresaleTags);

  const filteredOrders: LoaderOrder[] = orders
    .map((order) => {
      const matchingFulfillment = order.fulfillmentOrders.nodes.find(
        (fulfillment) => {
          if (!fulfillment.assignedLocation?.location?.id) return false;
          if (
            locationId !== DEFAULT_LOCATION_ID &&
            fulfillment.assignedLocation.location.id !== locationId
          ) {
            return false;
          }
          if (
            normalizedDeliveryMethod &&
            fulfillment.deliveryMethod?.methodType !==
              normalizedDeliveryMethod
          ) {
            return false;
          }
          return true;
        },
      );

      if (!matchingFulfillment?.assignedLocation?.location) {
        if (debugDropCounters) {
          const fulfillments = order.fulfillmentOrders.nodes;
          if (fulfillments.length === 0) {
            debugDropCounters.noFulfillmentOrders += 1;
          } else {
            const withAssignedLocation = fulfillments.filter((fulfillment) =>
              Boolean(fulfillment.assignedLocation?.location?.id),
            );
            if (withAssignedLocation.length === 0) {
              debugDropCounters.noAssignedLocation += 1;
            } else if (
              locationId !== DEFAULT_LOCATION_ID &&
              !withAssignedLocation.some(
                (fulfillment) =>
                  fulfillment.assignedLocation?.location?.id === locationId,
              )
            ) {
              debugDropCounters.locationMismatch += 1;
            } else if (
              normalizedDeliveryMethod &&
              !withAssignedLocation.some(
                (fulfillment) =>
                  fulfillment.deliveryMethod?.methodType ===
                  normalizedDeliveryMethod,
              )
            ) {
              debugDropCounters.deliveryMethodMismatch += 1;
            } else {
              debugDropCounters.unknown += 1;
            }
          }
        }
        return null;
      }
      if (order.displayFulfillmentStatus === "CANCELLED") {
        return null;
      }
      const isFulfilled =
        order.displayFulfillmentStatus === "FULFILLED" ||
        order.displayFulfillmentStatus === "PARTIALLY_FULFILLED";
      const hasDeliveredFulfillment = (order.fulfillments ?? []).some(
        (f) => f.displayStatus === "DELIVERED",
      );
      if (isFulfilled && hasDeliveredFulfillment) {
        return null;
      }

      // ── Warehouse-method override eligibility ──────────────────────────────
      // Non-LOCAL orders surfaced via the `includeWarehouse` toggle have
      // stricter gates than native LOCAL rows. Per Lucas (2026-05-15):
      //   1. methodType must be exactly `LOCAL` (native local delivery — not
      //      gated by this block) or `SHIPPING` (warehouse-bound, what the
      //      override surface is for). `PICK_UP` (customer collects at the
      //      store), `RETAIL` (in-person POS), and `NONE` (digital goods /
      //      gift cards / no-fulfillment-needed) are never deliverable via
      //      Lalamove and are dropped regardless of toggle state. Anything
      //      else (future Shopify enum value) is also dropped — fail closed.
      //   2. Drop if `displayFulfillmentStatus` is anything other than
      //      `UNFULFILLED` or `PARTIALLY_FULFILLED`. The existing FULFILLED-
      //      + delivered-fulfillment check above is too permissive for
      //      non-LOCAL: a FULFILLED order without a DELIVERED fulfillment
      //      record was leaking through (warehouse already shipped → not a
      //      local-delivery candidate).
      //   3. Drop unless `sourceName` is in the allowlist — only Online Store
      //      (`web`), completed drafts (`shopify_draft_order`), and Hexagon
      //      (numeric app ID `316281618433`) are eligible. POS-style channels
      //      (IGLU POS = `206755758081`, future Shopify POS, etc.) are
      //      excluded because they represent in-store purchases that should
      //      never be routed for delivery.
      //
      // LOCAL rows are untouched by gates 2 and 3 — their existing
      // eligibility rules remain. Gate 1 (methodType allowlist) applies to
      // ALL rows: even when the toggle is on, a PICK_UP / RETAIL / NONE row
      // would never be a delivery candidate.
      const methodType =
        (matchingFulfillment.deliveryMethod?.methodType ?? "").toUpperCase();
      if (methodType !== "LOCAL" && methodType !== "SHIPPING") {
        return null;
      }
      if (methodType === "SHIPPING") {
        const WAREHOUSE_SOURCE_ALLOWLIST = new Set([
          "",                       // empty / unset
          "web",                    // Online Store
          "shopify_draft_order",    // Completed Draft Orders
          "316281618433",           // Hexagon app
        ]);
        const channelEligible =
          !order.sourceName || WAREHOUSE_SOURCE_ALLOWLIST.has(order.sourceName);
        if (!channelEligible) {
          return null;
        }
        const warehouseFulfillmentEligible =
          order.displayFulfillmentStatus === "UNFULFILLED" ||
          order.displayFulfillmentStatus === "PARTIALLY_FULFILLED";
        if (!warehouseFulfillmentEligible) {
          return null;
        }
      }

      const locationAddress = matchingFulfillment.assignedLocation.location
        .address;
      const locationCoordinates =
        locationAddress?.latitude != null && locationAddress.longitude != null
          ? {
              latitude: locationAddress.latitude,
              longitude: locationAddress.longitude,
            }
          : null;

      const shippingCoordinates =
        order.shippingAddress?.latitude != null &&
        order.shippingAddress.longitude != null
          ? {
              latitude: order.shippingAddress.latitude,
              longitude: order.shippingAddress.longitude,
            }
          : null;
      const orderPresaleTags = (order.tags ?? []).filter((tag) => isPresaleTag(tag));
      const shouldExcludePresale =
        orderPresaleTags.length > 0 &&
        !orderPresaleTags.some((tag) => selectedPresaleTagSet.has(tag));
      if (shouldExcludePresale) {
        return null;
      }
      const addressValidation = validateAddressFormat(
        order.shippingAddress?.address1,
        order.shippingAddress?.address2,
      );

      return {
        id: order.id,
        name: order.name,
        processedAt: order.processedAt ?? null,
        // 2026-05-19 rewire: source the "Customer" block from the matching
        // fulfillmentOrder's Delivery-address group (= destination) so the
        // operator sees the RECIPIENT contact info, not the account holder.
        // Pickup / gift / B2B orders frequently have an account holder
        // (customer.*) distinct from the actual recipient (destination.*),
        // and the recipient is who the courier is calling.
        //
        // Precedence per field: destination → customer record → order-level
        // → null. The customer-record fallback preserves backwards behavior
        // for orders without a fulfillmentOrder.destination (rare; mostly
        // very old orders predating Shopify's delivery-method model).
        customerName: (() => {
          const dest = matchingFulfillment.destination;
          const destFull = [dest?.firstName, dest?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim();
          return destFull.length > 0
            ? destFull
            : order.customer?.displayName ?? null;
        })(),
        customerEmail:
          matchingFulfillment.destination?.email ??
          order.customer?.email ??
          order.email ??
          null,
        customerPhone:
          matchingFulfillment.destination?.phone ??
          order.customer?.phone ??
          order.phone ??
          null,
        total: order.currentTotalPriceSet
          ? formatMoney(
              order.currentTotalPriceSet.shopMoney.amount,
              order.currentTotalPriceSet.shopMoney.currencyCode,
            )
          : "--",
        shippingCost: order.currentShippingPriceSet
          ? {
              amount: Number(order.currentShippingPriceSet.shopMoney.amount),
              currencyCode:
                order.currentShippingPriceSet.shopMoney.currencyCode,
            }
          : null,
        shippingSummary: order.shippingAddress
          ? formatAddress([
              order.shippingAddress.address1,
              order.shippingAddress.city,
              order.shippingAddress.province,
              order.shippingAddress.country,
            ])
          : null,
        address1: order.shippingAddress?.address1 ?? null,
        address2: order.shippingAddress?.address2 ?? null,
        addressValidation,
        adminOrderUrl: `https://admin.shopify.com/store/${toAdminStoreHandle(shop)}/orders/${toLegacyLocationId(order.id)}`,
        shippingCoordinates,
        fulfillmentLocation: {
          id: matchingFulfillment.assignedLocation.location.id,
          name: matchingFulfillment.assignedLocation.name,
          coordinates: locationCoordinates,
        },
        methodType:
          (matchingFulfillment.deliveryMethod?.methodType ?? "UNKNOWN").toUpperCase(),
        tags: order.tags ?? [],
        lineItems: (order.lineItems?.nodes ?? []).map((li: { id: string; title: string; quantity: number }) => ({
          id: li.id,
          title: li.title,
          quantity: li.quantity,
        })),
      };
    })
    .filter((order): order is LoaderOrder => Boolean(order));
  endFilterMap(`fetched=${orders.length} kept=${filteredOrders.length}`);

  // 2026-05-16: persist the runtime address-validation flag as a Shopify tag.
  // Any order the loader flagged as `addressValidation.isValid === false` AND
  // not already carrying LD_ADDRESS_CONFIRM_TAG gets tagged in the background.
  // Fire-and-forget — the loader response doesn't wait, and idempotent addTags
  // means concurrent loads can't double-write. Goal: keep the tag visible to
  // operators across surfaces (Shopify Orders page filter, Order details modal,
  // automated dispatch skip-list) without depending on the auto-delivery cron
  // having seen the order first.
  //
  // 2026-05-19 scope tightening: only tag orders whose fulfillment location
  // is in the LD-enabled set. Without this gate, address-flagged orders at
  // non-LD locations (warehouse shipping, in-store retail, etc.) were getting
  // tagged too, which surfaced them in the LD address-error modal even
  // though they would never be routed by Lalamove. `localDeliveryLocationIds`
  // is derived from Shopify Delivery Profiles (locations with a local-
  // delivery method definition); null means "no profile data, don't filter".
  const ordersNeedingAddressTag = filteredOrders.filter(
    (o) =>
      !o.addressValidation.isValid &&
      !(o.tags ?? []).includes(LD_ADDRESS_CONFIRM_TAG) &&
      (localDeliveryLocationIds === null ||
        localDeliveryLocationIds.has(o.fulfillmentLocation.id)),
  );
  if (ordersNeedingAddressTag.length > 0) {
    void (async () => {
      try {
        const { addTags } = await import("../services/lalamove-sync.server");
        for (const o of ordersNeedingAddressTag) {
          try {
            await addTags(admin, o.id, [LD_ADDRESS_CONFIRM_TAG]);
          } catch (err) {
            console.warn(
              `[local-delivery:address-tag-sync] failed order=${o.id} shop=${shop}`,
              err,
            );
          }
        }
        console.info(
          `[local-delivery:address-tag-sync] OK shop=${shop} tagged=${ordersNeedingAddressTag.length}`,
        );
      } catch (err) {
        console.warn(
          `[local-delivery:address-tag-sync] FAILED shop=${shop}`,
          err,
        );
      }
    })();
  }

  const endRouteStats = timeStep("route-stats-build");
  const routeStats = ROUTE_TAG_DEFINITIONS.map((route) => {
    const routeOrders = filteredOrders.filter((order) =>
      order.tags.includes(route.tag),
    );
    const currencyCode =
      routeOrders.find((order) => order.shippingCost)?.shippingCost
        ?.currencyCode ?? null;
    const shippingTotal = routeOrders.reduce((total, order) => {
      return total + (order.shippingCost?.amount ?? 0);
    }, 0);
    return {
      label: route.label,
      tag: route.tag,
      emoji: route.emoji,
      color: route.color,
      shippingTotal: currencyCode
        ? formatMoney(shippingTotal.toFixed(2), currencyCode)
        : "--",
      orders: routeOrders.map((order) => ({
        orderId: order.id,
        id: order.name,
        customer: formatCustomerShort(order.customerName),
      })),
    };
  });

  endRouteStats(`routes=${routeStats.filter((r) => r.orders.length > 0).length}`);

  // Look up cached corridor polylines from DB (zero Google API calls)
  const endPolylineLookup = timeStep("polyline-cache-lookup");
  const routesForCacheLookup = routeStats
    .map((r, i) => ({
      id: `${effectiveLocationId}-${i}`,
      locationId: effectiveLocationId,
      orderIds: r.orders.map((o) => o.orderId),
    }))
    .filter((r) => r.orderIds.length > 0);

  let cachedPolylines = new Map<string, string>();
  if (routesForCacheLookup.length > 0) {
    const { lookupCachedPolylines } = await import(
      "../services/carrier-quotation-optimizer.server"
    );
    cachedPolylines = await lookupCachedPolylines(shop, routesForCacheLookup);
  }
  endPolylineLookup(`requested=${routesForCacheLookup.length} hit=${cachedPolylines.size}`);

  const precomputedRoutes: PrecomputedRoute[] = routeStats.map((r, i) => ({
    id: `${effectiveLocationId}-${i}`,
    locationId: effectiveLocationId,
    polyline: cachedPolylines.get(`${effectiveLocationId}-${i}`) ?? "",
    color: ROUTE_PRECOMPUTE_COLORS[i % ROUTE_PRECOMPUTE_COLORS.length] ?? "#2C6ECB",
    orderIds: r.orders.map((o) => o.orderId),
  }));
  const failedDeliveryTagSet = new Set(getAllFailedDeliveryTags());
  const failedDeliveryCount = filteredOrders.filter((order) =>
    order.tags.some((t) => failedDeliveryTagSet.has(t)),
  ).length;
  // Count of warehouse-method orders that flowed in because includeWarehouse
  // was on (their methodType is non-LOCAL). When the toggle is off the
  // Shopify query already filtered to LOCAL-only so this stays 0.
  const warehouseOrdersCount = filteredOrders.filter(
    (order) => order.methodType !== "LOCAL",
  ).length;

  const warehouseOrdersHiddenCount = await warehouseHiddenCountPromise;
  endWarehouseHiddenCount(`count=${warehouseOrdersHiddenCount} includeWarehouse=${includeWarehouse}`);

  const normalizedLocations: LoaderLocation[] = locations.map((location) => {
    const coordinates =
      location.address?.latitude != null && location.address.longitude != null
        ? {
            latitude: location.address.latitude,
            longitude: location.address.longitude,
          }
        : null;

    return {
      id: location.id,
      name: location.name,
      addressSummary: formatAddress([
        location.address?.address1,
        location.address?.city,
        location.address?.province,
        location.address?.country,
      ]),
      coordinates,
      phone: location.address?.phone ?? null,
      address1: location.address?.address1 ?? null,
      address2: location.address?.address2 ?? null,
      city: location.address?.city ?? null,
      province: location.address?.province ?? null,
      country: location.address?.country ?? null,
      countryCode: location.address?.countryCode ?? null,
    };
  });

  const localDeliveryLocations = localDeliveryLocationIds
    ? normalizedLocations.filter((location) =>
        localDeliveryLocationIds.has(location.id),
      )
    : normalizedLocations;

  const debugLocalDelivery = debugEnabled
    ? {
        query: query ?? null,
        filters: {
          deliveryMethod,
          normalizedDeliveryMethod,
          locationId,
          effectiveLocationId,
          startDateKey,
          deliveryPromiseDays,
          selectedPresaleTags,
        },
        fetchedOrdersCount: orders.length,
        filteredOrdersCount: filteredOrders.length,
        localDeliveryLocationCount: localDeliveryLocationIds?.size ?? 0,
        dropCounters: debugDropCounters,
      }
    : null;

  // Load Lalamove dispatch jobs for routes that still have tagged orders.
  // Tags are the source of truth: present = needs action, removed = fulfilled.
  // No date filter — dispatch records are fetched by routeId, not by time window.
  const endDispatchReconcile = timeStep("dispatch-reconcile");
  let dispatchReconcileMeta = { dispatches: 0, lalamoveCalls: 0 };
  let activeDispatchData: Array<{
    routeId: string;
    shareLink: string | null;
    status: string;
    lalamoveOrderId: string;
    market: string;
    podBucket: string | null;
    needsReviewReason: string | null;
    partialDelivery: boolean;
    stops: Array<{
      shopifyOrderId: string;
      orderName: string | null;
      stopOutcome: string | null;
      stopFailureReason: string | null;
    }>;
  }> = [];
  try {
    const activeRouteIds = routeStats
      .map((r, i) => ({ routeId: `${effectiveLocationId}-${i}`, hasOrders: r.orders.length > 0 }))
      .filter((r) => r.hasOrders)
      .map((r) => r.routeId);

    // Single query: all non-terminal dispatches for active routes.
    // Terminal statuses (completed, cancelled, failed, etc.) are excluded at query
    // level so previous-day dispatches on reused route IDs never block new requests.
    const terminalExclude = [
      "cancelled", "CANCELLED", "CANCELED",
      "failed", "FAILED",
      "REJECTED", "rejected",
      "EXPIRED", "expired", "EXPIRED_CUTOFF",
      "FULFILLED",
      "COMPLETED", "completed", "delivered", "DELIVERED",
    ];
    // Active in-flight dispatches only. The previous OR-branch that surfaced
    // recently-bucketed terminal dispatches for 6h post-close (the "Yasmin
    // visibility window") was removed 2026-05-14: route slots recycle daily,
    // and yesterday's bucketed dispatch on the same slot was colliding with
    // today's freshly auto-assigned route to render a stale "All delivered"
    // badge. Per-stop bucketing keeps the correctness guard for FAILED stops
    // (ld_redelivery_pending tag on the Shopify order); the immediate UI
    // post-close visibility moves to the failed-delivery counter at the top
    // of the page + the order tag itself, both of which are slot-reuse-immune.
    const allDispatches = activeRouteIds.length > 0
      ? await (prisma as any).lalamoveDispatchJob.findMany({
          where: {
            shop,
            routeId: { in: activeRouteIds },
            status: { notIn: terminalExclude },
          },
          select: {
            id: true,
            routeId: true,
            lalamoveOrderId: true,
            market: true,
            status: true,
            requestedAt: true,
            podBucket: true,
            needsReviewReason: true,
            partialDelivery: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

    // Deduplicate: keep only the latest dispatch per routeId
    const latestByRoute = new Map<string, (typeof allDispatches)[0]>();
    for (const d of allDispatches) {
      if (!latestByRoute.has(d.routeId)) latestByRoute.set(d.routeId, d);
    }

    const activeDispatches = Array.from(latestByRoute.values());

    // Reconcile with Lalamove API — check current status and capture shareLink
    const dispatchDetails = new Map<string, { shareLink: string | null; apiStatus: string | null }>();
    const credentials = await getRuntimeCredentialsForShop(shop);
    dispatchReconcileMeta.dispatches = activeDispatches.length;
    if (credentials && activeDispatches.length > 0) {
      dispatchReconcileMeta.lalamoveCalls = activeDispatches.length;
      const terminalStatuses = ["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"];
      await Promise.allSettled(
        activeDispatches.map((dispatch: any) =>
          getLalamoveOrderDetails(
            dispatch.market ?? "BR_SAO",
            dispatch.lalamoveOrderId,
            credentials,
          ).then(async (details: any) => {
            const apiStatus = details?.status;
            dispatchDetails.set(dispatch.routeId, {
              shareLink: details?.shareLink ?? null,
              apiStatus: apiStatus ?? null,
            });
            if (apiStatus && terminalStatuses.includes(apiStatus) && dispatch.status !== apiStatus) {
              await (prisma as any).lalamoveDispatchJob.update({
                where: { id: dispatch.id },
                data: { status: apiStatus },
              });
              dispatch.status = apiStatus;
            }
          }),
        ),
      );
    }

    // Post-reconciliation filter: remove dispatches that became terminal during
    // API reconciliation, or that are stale intermediates (API unreachable).
    // EXCEPTION: keep terminal dispatches that have a bucket computed — those
    // surface bucket badge + partialDelivery banner on the route card.
    const STALE_THRESHOLD_MS = 18 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const terminalRaw = new Set(["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"]);
    const finalDispatches = activeDispatches.filter((d: any) => {
      const hasBucket = !!d.podBucket;
      // Reconciliation may have updated status to terminal
      if (terminalRaw.has(String(d.status).toUpperCase()) && !hasBucket) {
        return false;
      }
      // Intermediate dispatches older than 18h are stale (deliveries complete within hours)
      const age = nowMs - new Date(d.requestedAt).getTime();
      const isIntermediate = ["ASSIGNING_DRIVER", "ON_GOING", "PICKED_UP"].includes(
        String(d.status).toUpperCase(),
      );
      if (isIntermediate && age > STALE_THRESHOLD_MS) {
        // Mark as expired in DB so it doesn't come back
        (prisma as any).lalamoveDispatchJob.update({
          where: { id: d.id },
          data: { status: "EXPIRED" },
        }).catch(() => {});
        return false;
      }
      return true;
    });

    // Fetch per-stop POD outcomes for each surviving dispatch so the UI can
    // render per-stop pills + bucket badge.
    type StopRow = {
      dispatchJobId: string;
      shopifyOrderId: string;
      stopOutcome: string | null;
      stopFailureReason: string | null;
    };
    const dispatchIds = finalDispatches.map((d: { id: string }) => d.id);
    const stopRows: StopRow[] = dispatchIds.length > 0
      ? await (prisma as unknown as {
          lalamoveDispatchOrderMap: {
            findMany: (args: unknown) => Promise<StopRow[]>;
          };
        }).lalamoveDispatchOrderMap.findMany({
          where: { shop, dispatchJobId: { in: dispatchIds } },
          select: {
            dispatchJobId: true,
            shopifyOrderId: true,
            stopOutcome: true,
            stopFailureReason: true,
          },
        })
      : [];
    const stopsByJob = new Map<string, Array<{
      shopifyOrderId: string;
      orderName: string | null;
      stopOutcome: string | null;
      stopFailureReason: string | null;
    }>>();
    for (const row of stopRows) {
      if (!stopsByJob.has(row.dispatchJobId)) stopsByJob.set(row.dispatchJobId, []);
      const orderName = orders.find((o: { id: string; name?: string | null }) => o.id === row.shopifyOrderId)?.name ?? null;
      stopsByJob.get(row.dispatchJobId)!.push({
        shopifyOrderId: row.shopifyOrderId,
        orderName,
        stopOutcome: row.stopOutcome ?? null,
        stopFailureReason: row.stopFailureReason ?? null,
      });
    }

    activeDispatchData = finalDispatches.map((d: any) => ({
      routeId: d.routeId as string,
      shareLink: dispatchDetails.get(d.routeId)?.shareLink ?? null,
      status: mapLalamoveStatusToInternal(dispatchDetails.get(d.routeId)?.apiStatus ?? d.status),
      lalamoveOrderId: d.lalamoveOrderId as string,
      market: (d.market ?? "BR_SAO") as string,
      podBucket: (d.podBucket ?? null) as string | null,
      needsReviewReason: (d.needsReviewReason ?? null) as string | null,
      partialDelivery: !!d.partialDelivery,
      stops: stopsByJob.get(d.id) ?? [],
    }));
  } catch {
    // Silently ignore if table is unavailable
  }
  endDispatchReconcile(
    `dispatches=${dispatchReconcileMeta.dispatches} lalamoveCalls=${dispatchReconcileMeta.lalamoveCalls} returned=${activeDispatchData.length}`,
  );

  console.info(
    `[local-delivery] loader OK durationMs=${Date.now() - loaderT0} shop=${shop} location=${effectiveLocationId} ordersFetched=${orders.length} ordersKept=${filteredOrders.length} includeWarehouse=${includeWarehouse} warehouseOrdersCount=${warehouseOrdersCount} warehouseOrdersHiddenCount=${warehouseOrdersHiddenCount} pages=${pagesFetched} dispatches=${activeDispatchData.length}`,
  );

  return {
    orders: filteredOrders,
    locations: localDeliveryLocations,
    filters: {
      deliveryMethod,
      locationId: effectiveLocationId,
      startDate: startDateKey,
      deliveryPromiseDays,
      selectedPresaleTags,
      includeWarehouse,
    },
    ordersError,
    mapsApiKey,
    mapsMapId: process.env.GOOGLE_MAPS_MAP_ID?.trim() || "",
    routeStats,
    precomputedRoutes,
    lalamoveConfigs,
    credentialStatus,
    returnPickupRequests,
    shop,
    userLocale,
    debugLocalDelivery,
    availablePresaleTags,
    hasUnfulfilledPresaleOrders: availablePresaleTags.length > 0,
    failedDeliveryCount,
    warehouseOrdersCount,
    warehouseOrdersHiddenCount,
    activeDispatchData,
    optimizerAccuracy,
    pendingPostMortemReviewCount,
  };
};


export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  try {

  const route = formData.get("route");
  const orderIds = formData.getAll("orderIds");

  /** Process items in sequential batches to avoid Shopify rate limits / gateway timeouts. */
  async function batchProcess<T>(items: T[], batchSize: number, fn: (item: T) => Promise<unknown>) {
    for (let i = 0; i < items.length; i += batchSize) {
      await Promise.all(items.slice(i, i + batchSize).map(fn));
    }
  }
  const GQL_BATCH_SIZE = 10;

  /**
   * Shifts populated route tags down into empty earlier slots so the fulfillment team's
   * sequential tag views (ld_rota-01, ld_rota-02, ...) have no gaps. Dispatched routes
   * are frozen anchors — their slot index never changes, and compaction does not cross
   * them. Compaction happens independently within each contiguous block of non-dispatched
   * slots.
   */
  async function compactRouteTags(targetLocationId: string) {
    const normalizeLoc = (locId: string | null | undefined) =>
      locId ? (locId.startsWith("gid://") ? locId.split("/").pop() ?? locId : locId) : "";
    const targetLocNorm = normalizeLoc(targetLocationId);

    const activeDispatches = await (prisma as any).lalamoveDispatchJob.findMany({
      where: {
        shop,
        routeId: { startsWith: `${targetLocationId}-` },
        status: { notIn: ["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"] },
      },
      select: { routeId: true },
    });
    const dispatchedSlots = new Set<number>();
    for (const d of activeDispatches as Array<{ routeId: string }>) {
      const suffix = d.routeId.slice(targetLocationId.length + 1);
      const idx = Number.parseInt(suffix, 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < ROUTE_TAG_DEFINITIONS.length) {
        dispatchedSlots.add(idx);
      }
    }

    const populatedBySlot = new Map<number, string[]>();
    for (let slot = 0; slot < ROUTE_TAG_DEFINITIONS.length; slot += 1) {
      const tag = ROUTE_TAG_DEFINITIONS[slot]!.tag;
      const resp = await admin.graphql(
        `#graphql
          query OrdersByRouteTag($first: Int!, $query: String) {
            orders(first: $first, query: $query) {
              nodes {
                id
                fulfillmentOrders(first: 10, displayable: true) {
                  nodes { assignedLocation { location { id } } }
                }
              }
            }
          }`,
        { variables: { first: 250, query: `tag:${tag}` } },
      );
      const json = await resp.json();
      const nodes = (json.data?.orders?.nodes ?? []) as Array<{
        id: string;
        fulfillmentOrders: {
          nodes: Array<{ assignedLocation?: { location?: { id: string } | null } | null }>;
        };
      }>;
      const orderIds = nodes
        .filter((o) => normalizeLoc(o.fulfillmentOrders?.nodes?.[0]?.assignedLocation?.location?.id) === targetLocNorm)
        .map((o) => o.id);
      if (orderIds.length > 0) populatedBySlot.set(slot, orderIds);
    }

    const sourceToTarget = new Map<number, number>();
    let writeSlot = 0;
    for (let slot = 0; slot < ROUTE_TAG_DEFINITIONS.length; slot += 1) {
      if (dispatchedSlots.has(slot)) {
        writeSlot = slot + 1;
        continue;
      }
      if (!populatedBySlot.has(slot)) continue;
      if (slot !== writeSlot) sourceToTarget.set(slot, writeSlot);
      writeSlot += 1;
    }

    if (sourceToTarget.size === 0) {
      console.info(`[local-delivery:compact] no gaps shop=${shop} location=${targetLocationId}`);
      return;
    }
    console.info(
      `[local-delivery:compact] START shop=${shop} location=${targetLocationId} shifts=${sourceToTarget.size} dispatched=${dispatchedSlots.size}`,
    );

    const moves: Array<{ orderId: string; fromTag: string; toTag: string }> = [];
    for (const [source, target] of sourceToTarget.entries()) {
      const fromTag = ROUTE_TAG_DEFINITIONS[source]!.tag;
      const toTag = ROUTE_TAG_DEFINITIONS[target]!.tag;
      for (const orderId of populatedBySlot.get(source) ?? []) {
        moves.push({ orderId, fromTag, toTag });
      }
    }
    await batchProcess(moves, GQL_BATCH_SIZE, async ({ orderId, fromTag, toTag }) => {
      await admin.graphql(
        `#graphql
          mutation AddOrderTag($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) { userErrors { message } }
          }`,
        { variables: { id: orderId, tags: [toTag] } },
      );
      await admin.graphql(
        `#graphql
          mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
            tagsRemove(id: $id, tags: $tags) { userErrors { message } }
          }`,
        { variables: { id: orderId, tags: [fromTag] } },
      );
    });
    console.info(`[local-delivery:compact] OK shop=${shop} location=${targetLocationId} moved=${moves.length}`);
  }

  if (intent === "save-lalamove-settings") {
    const locationId = formData.get("locationId");
    if (typeof locationId !== "string" || !locationId) {
      return { ok: false, error: "Location not provided." };
    }
    console.info(`[local-delivery] save-lalamove-settings shop=${shop} location=${locationId}`);
    const existing = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId } },
    });
    const isNewLocation = !existing;

    const data: LalamoveConfig = {
      market: String(formData.get("market") ?? ""),
      city: String(formData.get("city") ?? ""),
      language: String(formData.get("language") ?? ""),
      preferredServiceType: String(formData.get("preferredServiceType") ?? ""),
      locationName: String(formData.get("locationName") ?? ""),
      locationPhone: String(formData.get("locationPhone") ?? ""),
      locationAddress: String(formData.get("locationAddress") ?? ""),
      locationDetails: String(formData.get("locationDetails") ?? ""),
      pickupInstructions: String(formData.get("pickupInstructions") ?? ""),
    };
    await prisma.lalamoveLocationConfig.upsert({
      where: { shop_locationId: { shop, locationId } },
      update: { data },
      create: { shop, locationId, data },
    });

    if (isNewLocation && data.locationAddress?.trim()) {
      const configRow = await prisma.carrierServiceConfig.findUnique({
        where: { shop },
      });
      const carrierConfig = configRow?.data as CarrierServiceConfigData | undefined;
      const maxRadiusKm = getMaxZoneRadiusKm(carrierConfig ?? null);
      buildSampleRatesForLocationWithOrders(
        admin,
        shop,
        locationId,
        "lalamove",
        data.locationAddress,
        maxRadiusKm,
        "BRL",
        { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim() },
      ).catch((e) => console.warn(`[local-delivery] save-lalamove-settings sample-rate build failed location=${locationId}`, e));
    }
    return { ok: true };
  }

  const ids = orderIds.filter((id): id is string => typeof id === "string");

  if (intent === "unassign-all") {
    const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);
    const orderIdsToClear = ids.length > 0 ? ids : [];
    console.info(`[local-delivery] unassign-all shop=${shop} orders=${orderIdsToClear.length}`);
    await Promise.all(
      orderIdsToClear.map((id) =>
        admin.graphql(
          `#graphql
            mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
              tagsRemove(id: $id, tags: $tags) {
                node { id }
                userErrors { field message }
              }
            }`,
          { variables: { id, tags: allRouteTags } },
        ),
      ),
    );
    return { ok: true };
  }

  // Shared empty-summary helper for AI-only optimize fallback responses
  // (used when the LLM pipeline can't or won't propose routes — the action
  // returns ok=true with empty routes + `phase1Skipped`, and the UI uses
  // `phase1Skipped` to render a banner explaining why).
  const zeroSummary = (totalOrders: number) => ({
    routeCount: 0,
    totalDistanceMeters: 0,
    totalDurationSeconds: 0,
    totalOrders,
    costTotal: "0",
    costCurrency: "BRL",
    totalLalamoveCost: "0",
    totalWaitSurcharge: "0",
  });

  if (intent === "optimize-fleet") {
    const payload = formData.get("ordersPayload");
    if (typeof payload !== "string" || !payload.trim()) {
      return { ok: false, error: "No orders provided for optimization." };
    }
    let ordersInput: OptimizerOrderInput[] = [];
    try {
      const parsed = JSON.parse(payload) as OptimizerOrderInput[];
      ordersInput = Array.isArray(parsed) ? parsed : [];
    } catch {
      return { ok: false, error: "Invalid optimize fleet payload." };
    }
    const validOrders = ordersInput.filter(
      (order) =>
        order?.orderId &&
        order?.locationId &&
        Number.isFinite(order?.shippingCoordinates?.latitude) &&
        Number.isFinite(order?.shippingCoordinates?.longitude) &&
        Number.isFinite(order?.locationCoordinates?.latitude) &&
        Number.isFinite(order?.locationCoordinates?.longitude),
    );
    if (validOrders.length === 0) {
      return { ok: false, error: "No valid orders to optimize." };
    }

    console.info(`[local-delivery] optimize-fleet START shop=${shop} orders=${validOrders.length}`);

    // Load carrier config for vehicle preferences + max orders per route
    const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({
      where: { shop },
    });
    const carrierConfig = carrierConfigRow?.data as CarrierServiceConfigData | undefined;

    // Load location config for pickup coordinates
    const primaryLocationId = validOrders[0]?.locationId;
    if (!primaryLocationId) {
      return { ok: false, error: "No valid location for optimization." };
    }
    const locConfigRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId: primaryLocationId } },
    });
    if (!locConfigRow) {
      return { ok: false, error: "Missing Lalamove location settings." };
    }
    const llmConfig = locConfigRow.data as import("../services/carrier/lalamove-adapter.server").LalamoveConfig;

    // Load credentials
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return { ok: false, error: "Missing Lalamove credentials." };
    }

    const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
    if (!mapsApiKey) {
      return { ok: false, error: "GOOGLE_MAPS_API_KEY is missing." };
    }

    // ── AI-only optimizer ─────────────────────────────────────────────────
    // The legacy VRP (Clarke-Wright + Google Distance Matrix) fallback was
    // removed 2026-05-12. The optimizer is now AI-only: the LLM pipeline
    // either produces a confident clustering OR the action returns
    // `phase1Skipped: { reason }` with NO routes applied. The UI surfaces
    // a banner explaining why, and the merchant decides whether to retry,
    // adjust settings, or hand-cluster.
    //
    // Skip reasons:
    //   - phase1_disabled  → "Use AI-powered route optimization" toggle off
    //   - unknown_market   → location's city isn't in the geofence registry
    //   - no_credentials   → Lalamove credentials missing (needed for quotes)
    //   - low_confidence   → pipeline ran but arbiter chose `exclude-from-optimize`
    //                        (typically Anthropic API or schema validation failure)
    //   - pipeline_error   → unrecoverable exception in the pipeline
    if (!isPhase1EnabledForLocation(llmConfig)) {
      console.warn(`[local-delivery] optimize-fleet Phase1 disabled shop=${shop} location=${primaryLocationId} — AI toggle off`);
      return {
        ok: true,
        optimizeLocationId: primaryLocationId,
        optimizedRoutes: [],
        phase1Skipped: { reason: "phase1_disabled" as const },
        summary: zeroSummary(validOrders.length),
      };
    }

    const market = pickMarketKey(llmConfig.city);
    if (market === "other") {
      console.warn(`[local-delivery] optimize-fleet Phase1 skipped (unknown_market) shop=${shop} city=${llmConfig.city ?? "?"}`);
      return {
        ok: true,
        optimizeLocationId: primaryLocationId,
        optimizedRoutes: [],
        phase1Skipped: { reason: "unknown_market" as const },
        summary: zeroSummary(validOrders.length),
      };
    }

    const ordersWithNames = validOrders as Array<
      OptimizerOrderInput & { orderName?: string }
    >;

    let pipelineInput: Awaited<ReturnType<typeof buildPhase1PipelineInput>>;
    try {
      pipelineInput = await buildPhase1PipelineInput({
        shop,
        locationId: primaryLocationId,
        config: {
          market: llmConfig.market,
          language: llmConfig.language,
          preferredServiceType:
            carrierConfig?.lalamovePreferredServiceType ||
            llmConfig.preferredServiceType ||
            "LALAGO",
          city: llmConfig.city,
          locationName: llmConfig.locationName,
        },
        pickupLat: ordersWithNames[0].locationCoordinates.latitude,
        pickupLng: ordersWithNames[0].locationCoordinates.longitude,
        orders: ordersWithNames.map((o) => ({
          id: o.orderId,
          name: o.orderName || o.orderId,
          lat: o.shippingCoordinates.latitude,
          lng: o.shippingCoordinates.longitude,
        })),
        credentialsResolver: getRuntimeCredentialsForShop,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[local-delivery] optimize-fleet Phase1 input-build FAILED shop=${shop}`, err);
      return {
        ok: true,
        optimizeLocationId: primaryLocationId,
        optimizedRoutes: [],
        phase1Skipped: { reason: "pipeline_error" as const, message },
        summary: zeroSummary(validOrders.length),
      };
    }
    if (!pipelineInput) {
      console.warn(`[local-delivery] optimize-fleet Phase1 skipped (no_credentials) shop=${shop}`);
      return {
        ok: true,
        optimizeLocationId: primaryLocationId,
        optimizedRoutes: [],
        phase1Skipped: { reason: "no_credentials" as const },
        summary: zeroSummary(validOrders.length),
      };
    }

    let pipelineResult: Awaited<ReturnType<typeof runRouteOptimizationPipeline>>;
    try {
      const phase1Start = Date.now();
      pipelineResult = await runRouteOptimizationPipeline(pipelineInput);
      console.info(
        `[local-delivery] optimize-fleet Phase1 OK shop=${shop} decisionId=${pipelineResult.decisionId} winner=${pipelineResult.decision.winningCandidateId} path=${pipelineResult.decision.decisionPath} elapsed=${Date.now() - phase1Start}ms`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[local-delivery] optimize-fleet Phase1 pipeline FAILED shop=${shop}`, err);
      return {
        ok: true,
        optimizeLocationId: primaryLocationId,
        optimizedRoutes: [],
        phase1Skipped: { reason: "pipeline_error" as const, message },
        summary: zeroSummary(validOrders.length),
      };
    }

    // Decision-arbiter chose to NOT assign any routes (typically because the
    // spatial reasoner failed validation, low confidence, or no eligible
    // candidate). Surface the reasoner's reasoning text so the merchant has
    // a concrete explanation in the banner.
    if (pipelineResult.decision.decisionPath === "exclude-from-optimize") {
      const flagReason =
        pipelineResult.decision.postMortemFlags[0]?.reasoning ||
        "AI could not form a confident routing decision.";
      console.warn(`[local-delivery] optimize-fleet Phase1 exclude-from-optimize shop=${shop} decisionId=${pipelineResult.decisionId} — ${flagReason}`);
      return {
        ok: true,
        optimizeLocationId: primaryLocationId,
        optimizedRoutes: [],
        phase1Skipped: {
          reason: "low_confidence" as const,
          message: flagReason,
          decisionId: pipelineResult.decisionId,
        },
        summary: zeroSummary(validOrders.length),
      };
    }

    // AI produced a confident clustering — apply ld_rota tags + persist snapshot.
    const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);
    const tagAssignments: Array<{ orderId: string; tag: string }> = [];
    const optimizedRoutes: Array<{
      routeIndex: number;
      locationId: string;
      orderIds: string[];
      polyline: string;
      totalDistanceMeters: number;
      totalDurationSeconds: number;
    }> = [];
    for (const slot of pipelineResult.winningClustering) {
      const routeIndex = slot.slot;
      const tag = ROUTE_TAG_DEFINITIONS[routeIndex]?.tag;
      if (!tag) continue;
      const orderIds = slot.orderIds
        .map((name) =>
          ordersWithNames.find((o) => (o.orderName || o.orderId) === name)
            ?.orderId,
        )
        .filter((id): id is string => Boolean(id));
      for (const orderId of orderIds) {
        tagAssignments.push({ orderId, tag });
      }
      optimizedRoutes.push({
        routeIndex,
        locationId: primaryLocationId,
        orderIds,
        polyline: "",
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
      });
    }

    const allOptimizedIds = optimizedRoutes.flatMap((r) => r.orderIds);
    await batchProcess(allOptimizedIds, GQL_BATCH_SIZE, (orderId) =>
      admin.graphql(
        `#graphql
          mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
            tagsRemove(id: $id, tags: $tags) {
              userErrors { message }
            }
          }`,
        { variables: { id: orderId, tags: allRouteTags } },
      ),
    );
    await batchProcess(tagAssignments, GQL_BATCH_SIZE, ({ orderId, tag }) =>
      admin.graphql(
        `#graphql
          mutation AddOrderTag($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors { message }
            }
          }`,
        { variables: { id: orderId, tags: [tag] } },
      ),
    );

    try {
      const proposedRoutes = optimizedRoutes.map((r) => ({
        routeIndex: r.routeIndex,
        orderIds: r.orderIds,
        serviceType:
          carrierConfig?.lalamovePreferredServiceType ||
          llmConfig.preferredServiceType ||
          "LALAGO",
        costSubunits: 0,
      }));
      const orderCoordinates = ordersWithNames.map((o) => ({
        orderId: o.orderId,
        lat: o.shippingCoordinates.latitude,
        lng: o.shippingCoordinates.longitude,
      }));
      await (prisma as { routeOptimizationSnapshot: { create: (args: unknown) => Promise<unknown> } }).routeOptimizationSnapshot.create({
        data: {
          shop,
          locationId: primaryLocationId,
          proposedRoutes,
          orderCoordinates,
          orderCount: ordersWithNames.length,
          routeCount: optimizedRoutes.length,
        },
      });
    } catch (snapshotErr) {
      console.warn("[local-delivery] optimize-fleet Phase1 snapshot FAILED", snapshotErr);
    }

    return {
      ok: true,
      optimizeLocationId: primaryLocationId,
      optimizedRoutes,
      summary: {
        routeCount: optimizedRoutes.length,
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        totalOrders: ordersWithNames.length,
        costTotal: "0",
        costCurrency: "BRL",
        totalLalamoveCost: "0",
        totalWaitSurcharge: "0",
      },
      phase1: {
        decisionId: pipelineResult.decisionId,
        decisionPath: pipelineResult.decision.decisionPath,
        winningCandidateId: pipelineResult.decision.winningCandidateId,
        confidence: pipelineResult.decision.confidence,
        postMortemFlags: pipelineResult.decision.postMortemFlags,
        timings: pipelineResult.timings,
      },
    };
  }

  if (intent === "add-to-best-route") {
    console.info(`[local-delivery] add-to-best-route START shop=${shop}`);
    const unassignedPayload = formData.get("unassignedPayload");
    const routesPayload = formData.get("routesPayload");
    if (typeof unassignedPayload !== "string" || !unassignedPayload.trim() ||
        typeof routesPayload !== "string" || !routesPayload.trim()) {
      return { ok: false, error: "Missing payload for add-to-best-route." };
    }
    let unassignedOrders: OptimizerOrderInput[] = [];
    let existingRoutes: Array<{ routeIndex: number; locationId: string; orderIds: string[] }> = [];
    try {
      unassignedOrders = JSON.parse(unassignedPayload) as OptimizerOrderInput[];
      existingRoutes = JSON.parse(routesPayload) as Array<{ routeIndex: number; locationId: string; orderIds: string[] }>;
    } catch {
      return { ok: false, error: "Invalid payload for add-to-best-route." };
    }
    const validUnassigned = unassignedOrders.filter(
      (o) =>
        o?.orderId &&
        o?.locationId &&
        Number.isFinite(o?.shippingCoordinates?.latitude) &&
        Number.isFinite(o?.shippingCoordinates?.longitude) &&
        Number.isFinite(o?.locationCoordinates?.latitude) &&
        Number.isFinite(o?.locationCoordinates?.longitude),
    );
    if (validUnassigned.length === 0) {
      return { ok: false, error: "No valid unassigned orders." };
    }

    const allOrdersById = new Map<string, OptimizerOrderInput>(
      validUnassigned.map((o) => [o.orderId, o]),
    );

    const primaryLocationId = validUnassigned[0]?.locationId;
    if (!primaryLocationId) {
      return { ok: false, error: "No valid location for add-to-best-route." };
    }
    const locConfigRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId: primaryLocationId } },
    });
    if (!locConfigRow) {
      return { ok: false, error: "Missing Lalamove location settings." };
    }
    const llmConfig = locConfigRow.data as import("../services/carrier/lalamove-adapter.server").LalamoveConfig;

    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return { ok: false, error: "Missing Lalamove credentials." };
    }

    const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
    const carrierConfig = carrierConfigRow?.data as CarrierServiceConfigData | undefined;
    const primaryVehicle = carrierConfig?.lalamovePreferredServiceType || llmConfig.preferredServiceType || "LALAGO";
    const secondaryVehicle = carrierConfig?.lalamoveSecondaryServiceType || undefined;

    const { addToExistingRoutesByCarrierQuotation } = await import(
      "../services/carrier-quotation-optimizer.server"
    );

    // Resolve configured special requests for this shop+market+city.
    const resolvedAddRequests = await resolveConfiguredSpecialRequests(
      shop,
      llmConfig,
      credentials,
    );

    const result = await addToExistingRoutesByCarrierQuotation(
      existingRoutes,
      validUnassigned,
      allOrdersById,
      llmConfig,
      credentials,
      { primary: primaryVehicle, secondary: secondaryVehicle },
      resolvedAddRequests,
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);
    const newlyAssignedIds = validUnassigned.map((o) => o.orderId);
    await batchProcess(newlyAssignedIds, GQL_BATCH_SIZE, (orderId) =>
      admin.graphql(
        `#graphql
          mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
            tagsRemove(id: $id, tags: $tags) {
              userErrors { message }
            }
          }`,
        { variables: { id: orderId, tags: allRouteTags } },
      ),
    );
    const tagAssignments = result.routes.flatMap((route) => {
      const tag = ROUTE_TAG_DEFINITIONS[route.routeIndex]?.tag;
      const newOrderIds = newlyAssignedIds.filter((id) => route.orderIds.includes(id));
      return tag ? newOrderIds.map((orderId) => ({ orderId, tag })) : [];
    });
    await batchProcess(tagAssignments, GQL_BATCH_SIZE, ({ orderId, tag }) =>
      admin.graphql(
        `#graphql
          mutation AddOrderTag($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors { message }
            }
          }`,
        { variables: { id: orderId, tags: [tag] } },
      ),
    );

    return {
      ok: true,
      optimizedRoutes: result.routes.map((r) => ({
        routeIndex: r.routeIndex,
        locationId: r.locationId,
        orderIds: r.orderIds,
        polyline: (r as { corridorPolyline?: string }).corridorPolyline ?? "",
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        costTotal: r.costTotal,
        costCurrency: r.costCurrency,
      })),
      summary: {
        routeCount: result.summary.routeCount,
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        costTotal: result.summary.totalCost,
        costCurrency: result.summary.costCurrency,
        totalLalamoveCost: result.summary.totalLalamoveCost,
        totalWaitSurcharge: result.summary.totalWaitSurcharge,
      },
    };
  }


  if (intent === "update-routes") {
    const payload = formData.get("routesPayload");
    const requestLocationId = formData.get("locationId");
    if (typeof payload !== "string" || !payload.trim()) {
      return { ok: false, error: "No routes provided for update." };
    }
    let routesInput: Array<{ routeId: string; routeIndex: number; locationId: string; orderIds: string[] }>;
    try {
      routesInput = JSON.parse(payload);
    } catch {
      return { ok: false, error: "Invalid update-routes payload." };
    }
    if (!Array.isArray(routesInput) || routesInput.length === 0) {
      return { ok: false, error: "No routes to update." };
    }
    const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
    if (!mapsApiKey) {
      return { ok: false, error: "GOOGLE_MAPS_API_KEY is missing." };
    }
    console.info(`[local-delivery] update-routes START shop=${shop} routes=${routesInput.length}`);

    // Fetch shipping coordinates for all orders across all dirty routes
    const allOrderIds = [...new Set(routesInput.flatMap((r) => r.orderIds))];
    console.info(`[local-delivery] update-routes fetching ${allOrderIds.length} orders`);
    let orderCoordsJson: any;
    try {
      const orderCoordsResponse = await admin.graphql(
        `#graphql
          query UpdateRoutesOrders($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Order {
                id
                shippingAddress { latitude longitude }
              }
            }
          }`,
        { variables: { ids: allOrderIds } },
      );
      orderCoordsJson = await orderCoordsResponse.json();
    } catch (gqlErr) {
      console.error("[local-delivery] update-routes GraphQL FAILED", gqlErr instanceof Error ? gqlErr.message : String(gqlErr));
      return { ok: false, intent: "update-routes", error: "Failed to fetch order coordinates." };
    }
    const orderNodes = (orderCoordsJson?.data?.nodes ?? []) as Array<{
      id: string;
      shippingAddress?: { latitude?: number | null; longitude?: number | null } | null;
    }>;
    const shippingCoordsMap = new Map<string, { latitude: number; longitude: number }>();
    for (const node of orderNodes) {
      if (node?.id && node.shippingAddress?.latitude != null && node.shippingAddress?.longitude != null) {
        shippingCoordsMap.set(node.id, {
          latitude: node.shippingAddress.latitude,
          longitude: node.shippingAddress.longitude,
        });
      }
    }
    console.info(`[local-delivery] update-routes ordersWithCoords=${shippingCoordsMap.size}/${allOrderIds.length}`);

    // Fetch fulfillment location coordinates (origin for polyline computation)
    const uniqueLocationIds = [...new Set(routesInput.map((r) => r.locationId))];
    const locationCoordsMap = new Map<string, { latitude: number; longitude: number }>();
    for (const locId of uniqueLocationIds) {
      try {
        const locResponse = await admin.graphql(
          `#graphql
            query UpdateRoutesLocation($id: ID!) {
              location(id: $id) {
                id
                address { latitude longitude }
              }
            }`,
          { variables: { id: locId } },
        );
        const locJson = await locResponse.json();
        const addr = locJson?.data?.location?.address;
        if (addr?.latitude != null && addr?.longitude != null) {
          locationCoordsMap.set(locId, { latitude: addr.latitude, longitude: addr.longitude });
          console.info(`[local-delivery] update-routes location OK id=${locId} lat=${addr.latitude} lng=${addr.longitude}`);
        } else {
          console.warn(`[local-delivery] update-routes location SKIP id=${locId} (no coords)`);
        }
      } catch (locErr) {
        console.error(`[local-delivery] update-routes location FAILED id=${locId}`, locErr instanceof Error ? locErr.message : String(locErr));
      }
    }

    const { computeRoutePolyline } = await import("../services/google-routes-shared.server");

    const results: Array<{
      routeId: string;
      routeIndex: number;
      polyline: string;
      totalDistanceMeters: number;
      totalDurationSeconds: number;
      orderedIds: string[];
      error?: string;
    }> = [];

    for (const route of routesInput) {
      const locationCoords = locationCoordsMap.get(route.locationId);
      if (!locationCoords) {
        console.warn(`[local-delivery] update-routes SKIP route=${route.routeId} (no location coords for ${route.locationId})`);
        results.push({
          routeId: route.routeId,
          routeIndex: route.routeIndex,
          polyline: "",
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          orderedIds: [],
          error: "Fulfillment location coordinates missing.",
        });
        continue;
      }
      const routeOrders: OptimizerOrderInput[] = route.orderIds
        .map((orderId) => {
          const shipping = shippingCoordsMap.get(orderId);
          if (!shipping) return null;
          return {
            orderId,
            locationId: route.locationId,
            shippingCoordinates: shipping,
            locationCoordinates: locationCoords,
          };
        })
        .filter((o): o is OptimizerOrderInput => o != null);

      if (routeOrders.length === 0) {
        console.warn(`[local-delivery] update-routes SKIP route=${route.routeId} (0 orders with coords out of ${route.orderIds.length})`);
        results.push({
          routeId: route.routeId,
          routeIndex: route.routeIndex,
          polyline: "",
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          orderedIds: [],
          error: "No valid order coordinates.",
        });
        continue;
      }
      const orderIdsKey = [...route.orderIds].sort().join("|");

      // Cache-read guard: if the same sorted orderIds were already computed,
      // reuse the cached Google Routes result instead of paying for it again.
      // Legacy rows (created before the metadata columns existed) have null
      // distance/duration/orderedIdsKey and fall through to recompute.
      let polylineResult: {
        polyline: string;
        distanceMeters: number;
        durationSeconds: number;
        ordered: Array<{ orderId: string }>;
      } | null = null;
      try {
        const cached = await prisma.routePolylineCache.findUnique({
          where: { shop_locationId_orderIdsKey: { shop, locationId: route.locationId, orderIdsKey } },
        });
        if (
          cached?.encodedPolyline &&
          cached.distanceMeters != null &&
          cached.durationSeconds != null &&
          cached.orderedIdsKey
        ) {
          polylineResult = {
            polyline: cached.encodedPolyline,
            distanceMeters: cached.distanceMeters,
            durationSeconds: cached.durationSeconds,
            ordered: cached.orderedIdsKey.split("|").map((orderId) => ({ orderId })),
          };
          console.info(`[local-delivery] update-routes polyline CACHE HIT route=${route.routeId} orders=${routeOrders.length}`);
        }
      } catch (cacheReadErr) {
        console.warn("[local-delivery] update-routes cache read FAILED", cacheReadErr instanceof Error ? cacheReadErr.message : String(cacheReadErr));
      }

      if (!polylineResult) {
        console.info(`[local-delivery] update-routes computing polyline route=${route.routeId} orders=${routeOrders.length}`);
        try {
          const computed = await computeRoutePolyline(
            mapsApiKey,
            locationCoords,
            routeOrders,
          );
          polylineResult = computed;
          // Cache the full result so subsequent calls with the same orderIds skip Google Routes.
          try {
            const orderedIdsKey = computed.ordered.map((o) => o.orderId).join("|");
            await prisma.routePolylineCache.upsert({
              where: { shop_locationId_orderIdsKey: { shop, locationId: route.locationId, orderIdsKey } },
              update: {
                encodedPolyline: computed.polyline,
                distanceMeters: Math.round(computed.distanceMeters),
                durationSeconds: Math.round(computed.durationSeconds),
                orderedIdsKey,
              },
              create: {
                shop,
                locationId: route.locationId,
                orderIdsKey,
                encodedPolyline: computed.polyline,
                distanceMeters: Math.round(computed.distanceMeters),
                durationSeconds: Math.round(computed.durationSeconds),
                orderedIdsKey,
              },
            });
          } catch (cacheErr) {
            console.warn("[local-delivery] update-routes cache FAILED", cacheErr instanceof Error ? cacheErr.message : String(cacheErr));
          }
          console.info(`[local-delivery] update-routes polyline OK route=${route.routeId} distance=${computed.distanceMeters}m`);
        } catch (err) {
          console.error(`[local-delivery] update-routes polyline FAILED route=${route.routeId}`, err);
          results.push({
            routeId: route.routeId,
            routeIndex: route.routeIndex,
            polyline: "",
            totalDistanceMeters: 0,
            totalDurationSeconds: 0,
            orderedIds: route.orderIds,
            error: err instanceof Error ? err.message : "Polyline computation failed.",
          });
          continue;
        }
      }

      results.push({
        routeId: route.routeId,
        routeIndex: route.routeIndex,
        polyline: polylineResult.polyline,
        totalDistanceMeters: polylineResult.distanceMeters,
        totalDurationSeconds: polylineResult.durationSeconds,
        orderedIds: polylineResult.ordered.map((o) => o.orderId),
      });
    }

    // Now re-quote each route with Lalamove
    const credentials = await getRuntimeCredentialsForShop(shop);
    const effectiveLocationId = typeof requestLocationId === "string" ? requestLocationId : routesInput[0]?.locationId ?? "";
    const configRow = effectiveLocationId
      ? await prisma.lalamoveLocationConfig.findUnique({
          where: { shop_locationId: { shop, locationId: effectiveLocationId } },
        })
      : null;

    if (credentials && configRow) {
      const config = configRow.data as LalamoveConfig;
      for (const routeResult of results) {
        if (routeResult.error || routeResult.orderedIds.length === 0) continue;
        // Submit a Lalamove quote by reusing the lalamove-quote logic via internal call
        // For now, we leave quotation to the user via the existing "Request quote" button per route.
        // The polyline + distance/duration update is the primary deliverable of update-routes.
      }
    }

    // Persist Shopify tag assignments matching the new route mapping.
    // Without this, manual reshuffles in update-routes never reach the
    // rendering source of truth (Shopify order tags) and snap back on reload.
    // Also strips orphan tags from orders that USED to live on a dirty route
    // but no longer appear in any of the new orderIds (i.e. dragged out).
    const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);
    const tagAssignments: Array<{ orderId: string; tag: string }> = [];
    const ordersInNewRoutes = new Set<string>();
    const ordersToTouch = new Set<string>();
    for (const route of routesInput) {
      const tag = ROUTE_TAG_DEFINITIONS[route.routeIndex]?.tag;
      if (!tag) continue;
      for (const orderId of route.orderIds) {
        tagAssignments.push({ orderId, tag });
        ordersInNewRoutes.add(orderId);
        ordersToTouch.add(orderId);
      }
    }
    const normalizeLocForOrphanScan = (locId: string | null | undefined) =>
      locId ? (locId.startsWith("gid://") ? locId.split("/").pop() ?? locId : locId) : "";
    let orphansFound = 0;
    for (const route of routesInput) {
      const tag = ROUTE_TAG_DEFINITIONS[route.routeIndex]?.tag;
      if (!tag) continue;
      const targetLocNorm = normalizeLocForOrphanScan(route.locationId);
      try {
        const resp = await admin.graphql(
          `#graphql
            query OrdersByDirtyRouteTag($first: Int!, $query: String) {
              orders(first: $first, query: $query) {
                nodes {
                  id
                  fulfillmentOrders(first: 10, displayable: true) {
                    nodes { assignedLocation { location { id } } }
                  }
                }
              }
            }`,
          { variables: { first: 250, query: `tag:${tag}` } },
        );
        const json = await resp.json();
        const nodes = (json.data?.orders?.nodes ?? []) as Array<{
          id: string;
          fulfillmentOrders: {
            nodes: Array<{ assignedLocation?: { location?: { id: string } | null } | null }>;
          };
        }>;
        for (const node of nodes) {
          const locForOrder = normalizeLocForOrphanScan(
            node.fulfillmentOrders?.nodes?.[0]?.assignedLocation?.location?.id,
          );
          if (locForOrder !== targetLocNorm) continue;
          if (!ordersInNewRoutes.has(node.id)) {
            ordersToTouch.add(node.id);
            orphansFound += 1;
          }
        }
      } catch (orphanErr) {
        console.warn(
          `[local-delivery] update-routes orphan-scan FAILED route=${route.routeId}`,
          orphanErr instanceof Error ? orphanErr.message : String(orphanErr),
        );
      }
    }
    if (ordersToTouch.size > 0) {
      await batchProcess(Array.from(ordersToTouch), GQL_BATCH_SIZE, (orderId) =>
        admin.graphql(
          `#graphql
            mutation RemoveOrderTagsForUpdate($id: ID!, $tags: [String!]!) {
              tagsRemove(id: $id, tags: $tags) { userErrors { message } }
            }`,
          { variables: { id: orderId, tags: allRouteTags } },
        ),
      );
      await batchProcess(tagAssignments, GQL_BATCH_SIZE, ({ orderId, tag }) =>
        admin.graphql(
          `#graphql
            mutation AddOrderTagForUpdate($id: ID!, $tags: [String!]!) {
              tagsAdd(id: $id, tags: $tags) { userErrors { message } }
            }`,
          { variables: { id: orderId, tags: [tag] } },
        ),
      );
    }
    console.info(
      `[local-delivery] update-routes tags OK shop=${shop} assigned=${tagAssignments.length} orphansUntagged=${orphansFound}`,
    );

    if (effectiveLocationId && effectiveLocationId !== "all") {
      try {
        await compactRouteTags(effectiveLocationId);
      } catch (compactErr) {
        console.error(
          "[local-delivery:compact] FAILED shop=%s location=%s",
          shop,
          effectiveLocationId,
          compactErr instanceof Error ? compactErr.message : String(compactErr),
        );
      }
    }

    console.info(`[local-delivery] update-routes OK shop=${shop} updated=${results.filter((r) => !r.error).length}/${results.length}`);
    return { ok: true, intent: "update-routes", results };
  }

  if (intent === "lalamove-quote") {
    const routeId = formData.get("routeId");
    const locationId = formData.get("locationId");
    if (typeof routeId !== "string" || typeof locationId !== "string") {
      return { ok: false, error: "Route information missing.", routeId: typeof routeId === "string" ? routeId : undefined };
    }
    if (ids.length === 0) {
      return { ok: false, error: "No orders selected.", routeId };
    }
    console.info(`[local-delivery] lalamove-quote START shop=${shop} route=${routeId} orders=${ids.length}`);
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return {
        ok: false,
        error:
          "Missing Lalamove API credentials. Add your API key and secret in Settings.",
        routeId,
      };
    }
    const configRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId } },
    });
    if (!configRow) {
      console.warn(`[local-delivery] lalamove-quote SKIP settings missing shop=${shop} location=${locationId} route=${routeId}`);
      return { ok: false, error: "Missing Lalamove settings.", routeId };
    }
    const config = configRow.data as LalamoveConfig;
    const ordersResponse = await admin.graphql(
      `#graphql
        query LalamoveOrders($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order {
              id
              name
              shippingAddress {
                address1
                address2
                city
                province
                zip
                country
                latitude
                longitude
                phone
              }
              customer {
                displayName
                phone
              }
            }
          }
        }`,
      { variables: { ids } },
    );
    const ordersJson = await ordersResponse.json();
    const orderNodes = (ordersJson?.data?.nodes ?? []) as Array<{
      id: string;
      shippingAddress: {
        address1: string | null;
        address2: string | null;
        city: string | null;
        province: string | null;
        zip: string | null;
        country: string | null;
        latitude: number | null;
        longitude: number | null;
      } | null;
    }>;
    const locationResponse = await admin.graphql(
      `#graphql
        query LalamovePickupLocation($id: ID!) {
          location(id: $id) {
            id
            name
            address {
              address1
              address2
              city
              province
              zip
              country
              latitude
              longitude
            }
          }
        }`,
      { variables: { id: locationId } },
    );
    const locationJson = await locationResponse.json();
    const locationNode = locationJson?.data?.location as {
      name?: string | null;
      address?: {
        address1?: string | null;
        address2?: string | null;
        city?: string | null;
        province?: string | null;
        zip?: string | null;
        country?: string | null;
        latitude?: number | null;
        longitude?: number | null;
      } | null;
    } | null;
    const pickupAddress = locationNode?.address;
    if (
      pickupAddress?.latitude == null ||
      pickupAddress?.longitude == null ||
      !pickupAddress?.address1
    ) {
      return { ok: false, error: "Pickup location coordinates are missing.", routeId };
    }
    const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({
      where: { shop },
    });
    const carrierConfig = carrierConfigRow?.data as CarrierServiceConfigData | undefined;
    const defaultServiceType =
      carrierConfig?.lalamovePreferredServiceType?.trim() || "LALAGO";
    // Always inject Location name and details into config for Lalamove request
    const configWithLocation: LalamoveConfig = {
      ...config,
      preferredServiceType: config.preferredServiceType?.trim() || defaultServiceType,
      locationName: (locationNode?.name ?? "").trim() || config.locationName || "",
      locationDetails: (pickupAddress.address2 ?? "").trim() || config.locationDetails || "",
    };

    // Parse address edits from address verification modal
    const addressEditsRaw = formData.get("addressEdits");
    const addressEdits: Record<string, string> = addressEditsRaw
      ? (JSON.parse(String(addressEditsRaw)) as Record<string, string>)
      : {};

    const deliveryStopsRaw = await Promise.all(
      orderNodes.map(async (order) => {
        const address = order.shippingAddress;
        if (!address) return null;
        if (address.latitude == null || address.longitude == null) return null;
        // Use edited address from verification modal if available
        const editedAddress = addressEdits[order.id];
        const defaultDeliveryAddress = formatDeliveryStopAddress(
          address.address1,
          address.address2,
        );
        const resolvedAddress = editedAddress
          ? editedAddress
          : defaultDeliveryAddress;
        return {
          coordinates: {
            lat: String(address.latitude),
            lng: String(address.longitude),
          },
          address: resolvedAddress,
          sourceAddress2: address.address2 ?? null,
        };
      }),
    );
    const deliveryStops = deliveryStopsRaw.filter(
      Boolean,
    ) as Array<{ coordinates: { lat: string; lng: string }; address: string }>;
    const deliveryOrderPoints: DeliveryOrderPoint[] = [];
    for (let i = 0; i < orderNodes.length && i < ids.length; i++) {
      const addr = orderNodes[i]?.shippingAddress;
      if (addr?.latitude != null && addr?.longitude != null) {
        deliveryOrderPoints.push({
          orderId: ids[i]!,
          latitude: addr.latitude,
          longitude: addr.longitude,
        });
      }
    }
    if (deliveryStops.length === 0) {
      console.warn(`[local-delivery] lalamove-quote SKIP missing coordinates shop=${shop} route=${routeId} orderCount=${orderNodes.length}`);
      return { ok: false, error: "Orders missing coordinates.", routeId };
    }
    const shopifyFormattedAddress = formatAddress([
      pickupAddress.address1,
      pickupAddress.address2,
      pickupAddress.city,
      pickupAddress.province,
      pickupAddress.zip,
      pickupAddress.country,
    ]);
    const pickupAddressBase =
      formatFulfillmentStopAddress(
        config.locationName,
        config.locationAddress,
        config.locationDetails,
      ) || shopifyFormattedAddress;

    const stops = [
      {
        coordinates: {
          lat: String(pickupAddress.latitude),
          lng: String(pickupAddress.longitude),
        },
        address: pickupAddressBase,
      },
      ...deliveryStops,
    ];
    // Read special requests from form data (from pre-quote modal), falling back to saved config
    const formSpecialRequests = formData.getAll("specialRequests") as string[];
    let specialRequests = formSpecialRequests.length > 0
      ? formSpecialRequests
      : (carrierConfig?.lalamoveSpecialRequests?.[configWithLocation.market] ?? []);
    try {

      // Validate special requests against the specific city+service available options.
      if (specialRequests.length > 0 && credentials) {
        specialRequests = await resolveSpecialRequestsForCity(
          specialRequests, configWithLocation, credentials,
        );
      }

      const quotation = await createLalamoveQuotation({
        market: configWithLocation.market,
        language: configWithLocation.language,
        serviceType: configWithLocation.preferredServiceType,
        stops,
        isRouteOptimized: stops.length >= 3,
        ...(specialRequests.length ? { specialRequests } : {}),
      }, credentials);
      // quotation.stops[0] is the pickup; stops[1..n] are deliveries in optimized order.
      const responseDeliveryStops = (quotation.stops ?? []).slice(1);
      if (responseDeliveryStops.length !== deliveryStops.length) {
        console.error(`[local-delivery] lalamove-quote FAILED stop count mismatch route=${routeId} expected=${deliveryStops.length} got=${responseDeliveryStops.length}`);
        return {
          ok: false,
          error:
            "Lalamove returned a different number of optimized delivery stops. Please request a new quote.",
          routeId,
        };
      }
      const reconciliation = reconcileDeliveryAssignments(
        responseDeliveryStops,
        deliveryOrderPoints,
      );
      if (!reconciliation.ok) {
        console.error(`[local-delivery] lalamove-quote FAILED reconciliation route=${routeId} stops=${responseDeliveryStops.length} orders=${deliveryOrderPoints.length} error=${reconciliation.error}`);
        return {
          ok: false,
          error:
            "Could not map optimized route stops to orders reliably. Please retry the quote.",
          routeId,
        };
      }
      console.info(`[local-delivery] lalamove-quote OK route=${routeId} location=${locationId}`, reconciliation.stats);
      const finalOrderIds = reconciliation.assignments.map(
        (assignment) => assignment.orderId,
      );
      return {
        ok: true,
        routeId,
        locationId,
        quotation,
        orderIds: finalOrderIds,
        deliveryAssignments: reconciliation.assignments,
      };
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Lalamove quote failed.";
      const message = sanitizeLalamoveErrorMessage(rawMessage);

      // ── Out-of-service-area recovery ────────────────────────────────────
      // Lalamove returns 422 "out of service area" but doesn't say WHICH stop.
      // Probe each delivery stop individually to identify the bad ones, remove
      // them, and retry with the rest.
      const isOutOfArea =
        rawMessage.includes("out of service area") ||
        rawMessage.includes("service_area");
      if (isOutOfArea && deliveryStops.length > 1 && credentials) {
        console.info(
          `[local-delivery] lalamove-quote out-of-area recovery START route=${routeId} probing ${deliveryStops.length} stops`,
        );
        const pickupStop = stops[0]!;
        const outOfAreaIndices: number[] = [];
        // Probe each delivery stop individually (Lalamove API is free)
        for (let i = 0; i < deliveryStops.length; i++) {
          try {
            await createLalamoveQuotation(
              {
                market: configWithLocation.market,
                language: configWithLocation.language,
                serviceType: configWithLocation.preferredServiceType,
                stops: [pickupStop, deliveryStops[i]!],
                isRouteOptimized: false,
              },
              credentials,
            );
          } catch (probeErr) {
            const probeMsg =
              probeErr instanceof Error ? probeErr.message : "";
            if (
              probeMsg.includes("out of service area") ||
              probeMsg.includes("service_area")
            ) {
              outOfAreaIndices.push(i);
            }
          }
        }

        if (outOfAreaIndices.length > 0 && outOfAreaIndices.length < deliveryStops.length) {
          const outOfAreaOrderIds = outOfAreaIndices
            .map((idx) => deliveryOrderPoints[idx]?.orderId)
            .filter(Boolean) as string[];
          const validStops = deliveryStops.filter(
            (_, idx) => !outOfAreaIndices.includes(idx),
          );
          const validOrderPoints = deliveryOrderPoints.filter(
            (_, idx) => !outOfAreaIndices.includes(idx),
          );

          console.info(
            `[local-delivery] lalamove-quote out-of-area found=${outOfAreaOrderIds.length} remaining=${validStops.length} route=${routeId}`,
          );

          // Retry with valid stops only
          if (validStops.length > 0) {
            try {
              const retryStops = [pickupStop, ...validStops];
              const retryQuotation = await createLalamoveQuotation(
                {
                  market: configWithLocation.market,
                  language: configWithLocation.language,
                  serviceType: configWithLocation.preferredServiceType,
                  stops: retryStops,
                  isRouteOptimized: retryStops.length >= 3,
                  ...(specialRequests.length ? { specialRequests } : {}),
                },
                credentials,
              );
              const retryDeliveryStops = (retryQuotation.stops ?? []).slice(1);
              const retryReconciliation = reconcileDeliveryAssignments(
                retryDeliveryStops,
                validOrderPoints,
              );
              if (retryReconciliation.ok) {
                console.info(
                  `[local-delivery] lalamove-quote out-of-area recovery OK route=${routeId} removed=${outOfAreaOrderIds.length}`,
                );
                const finalOrderIds = retryReconciliation.assignments.map(
                  (a) => a.orderId,
                );
                return {
                  ok: true,
                  routeId,
                  locationId,
                  quotation: retryQuotation,
                  orderIds: finalOrderIds,
                  deliveryAssignments: retryReconciliation.assignments,
                  outOfAreaOrderIds,
                };
              }
            } catch (retryErr) {
              console.error(
                `[local-delivery] lalamove-quote out-of-area retry FAILED route=${routeId}`,
                retryErr,
              );
            }
          }

          // If retry failed but we know which orders are bad, still report them
          return {
            ok: false,
            error: message,
            routeId,
            outOfAreaOrderIds,
          };
        }
      }

      console.error(`[local-delivery] lalamove-quote FAILED shop=${shop} route=${routeId} location=${locationId} error=${message}`);
      return { ok: false, error: message, routeId };
    }
  }


  if (intent === "fetch-special-requests") {
    const market = String(formData.get("market") ?? "").trim();
    const serviceType = String(formData.get("serviceType") ?? "").trim();
    if (!market) return { ok: false, error: "Market not provided." };
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) return { ok: false, error: "Missing credentials." };
    try {
      const cities = await getLalamoveCityInfo(market, credentials);
      const srs: Array<{ name: string; description: string }> = [];
      for (const city of cities) {
        for (const service of city.services ?? []) {
          if (!serviceType || service.key === serviceType) {
            for (const sr of service.specialRequests ?? []) {
              if (!srs.some((x) => x.name === sr.name)) srs.push(sr);
            }
          }
        }
      }
      return { ok: true, specialRequests: srs };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch special requests.";
      return { ok: false, error: msg, specialRequests: [] };
    }
  }

  // mark-fulfilled intent removed — fulfillment is now handled automatically
  // by the webhook (tag rename on COMPLETED, dispatch marked FULFILLED).

  if (intent === "order-tag-update") {
    const orderId = String(formData.get("orderId") ?? "").trim();
    if (!orderId) {
      return { ok: false, error: "Missing order ID." };
    }
    const tagsToAdd = formData
      .getAll("addTags")
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
    const tagsToRemove = formData
      .getAll("removeTags")
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
    console.info(
      `[local-delivery:order-tags] update START shop=${shop} orderId=${orderId} add=${tagsToAdd.length} remove=${tagsToRemove.length}`,
    );
    try {
      const { addTags, removeTags } = await import(
        "../services/lalamove-sync.server"
      );
      if (tagsToAdd.length > 0) {
        await addTags(admin, orderId, tagsToAdd);
      }
      if (tagsToRemove.length > 0) {
        await removeTags(admin, orderId, tagsToRemove);
      }
      console.info(
        `[local-delivery:order-tags] update OK shop=${shop} orderId=${orderId}`,
      );
      return { ok: true };
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Tag update failed.";
      console.error(
        `[local-delivery:order-tags] update FAILED shop=${shop} orderId=${orderId}`,
        error,
      );
      return { ok: false, error: msg };
    }
  }

  if (intent === "fix-address") {
    const orderId = String(formData.get("orderId") ?? "").trim();
    const address1 = String(formData.get("address1") ?? "").trim();
    const address2 = String(formData.get("address2") ?? "").trim();
    if (!orderId) return { ok: false, error: "Missing order ID." };
    console.info(`[local-delivery] fix-address START shop=${shop} order=${orderId}`);
    try {
      await admin.graphql(
        `#graphql
          mutation UpdateOrderAddress($input: OrderInput!) {
            orderUpdate(input: $input) {
              order { id }
              userErrors { message }
            }
          }`,
        {
          variables: {
            input: {
              id: orderId,
              shippingAddress: {
                address1: address1 || undefined,
                address2: address2 || undefined,
              },
            },
          },
        },
      );
      // Remove address review tag
      const { removeTags } = await import("../services/lalamove-sync.server");
      await removeTags(admin, orderId, [LD_ADDRESS_CONFIRM_TAG]);
      console.info(`[local-delivery] fix-address OK shop=${shop} order=${orderId}`);
      return { ok: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Address update failed.";
      console.error(`[local-delivery] fix-address FAILED shop=${shop} order=${orderId}`, error);
      return { ok: false, error: msg };
    }
  }

        if (intent === "lalamove-cancel-order") {
      const routeId = String(formData.get("routeId") ?? "").trim();
      if (!routeId) return { ok: false, error: "Missing routeId.", routeId: "" };
      console.info(`[local-delivery] lalamove-cancel-order START shop=${shop} route=${routeId}`);

      const credentials = await getRuntimeCredentialsForShop(shop);
      if (!credentials) {
        return { ok: false, error: "Missing Lalamove API credentials.", routeId };
      }

      const prismaAny = prisma as any;
      const dispatchJob = await prismaAny.lalamoveDispatchJob.findFirst({
        where: { shop, routeId, status: { notIn: ["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"] } },
        orderBy: { createdAt: "desc" },
      });

      if (!dispatchJob?.lalamoveOrderId) {
        return { ok: false, error: "No active dispatch found for this route.", routeId };
      }

      try {
        await cancelLalamoveOrder(dispatchJob.market, dispatchJob.lalamoveOrderId, credentials);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Cancel failed.";
        return { ok: false, error: sanitizeLalamoveErrorMessage(msg), routeId };
      }

      // Update DB status + Shopify state + log event
      try {
        await prismaAny.lalamoveDispatchJob.update({
          where: { id: dispatchJob.id },
          data: { status: "CANCELED" },
        });
        await prismaAny.lalamoveDispatchOrderMap.updateMany({
          where: { dispatchJobId: dispatchJob.id },
          data: { currentStatus: "CANCELED" },
        });

        // Log event
        await prismaAny.lalamoveDispatchEvent.create({
          data: {
            shop,
            dispatchJobId: dispatchJob.id,
            lalamoveOrderId: dispatchJob.lalamoveOrderId,
            eventType: "MANUAL_CANCEL",
            externalStatus: "CANCELED",
          },
        });
      } catch (dbError) {
        console.error(`[local-delivery] lalamove-cancel-order FAILED DB/Shopify update shop=${shop} route=${routeId} job=${dispatchJob.id}`, dbError);
      }

      console.info(`[local-delivery] lalamove-cancel-order OK shop=${shop} route=${routeId} orderId=${dispatchJob.lalamoveOrderId}`);
      return { ok: true, routeId };
    }


    if (intent === "fetch-integration-log") {
      const routeId = String(formData.get("routeId") ?? "").trim();
      if (!routeId) return { ok: false, error: "Missing routeId." };

      try {
        const prismaAny = prisma as any;
        const dispatchJob = await prismaAny.lalamoveDispatchJob.findFirst({
          where: { shop, routeId },
          orderBy: { createdAt: "desc" },
        });

        if (!dispatchJob) {
          return { ok: true, events: [] };
        }

        const events = await prismaAny.lalamoveDispatchEvent.findMany({
          where: {
            shop,
            OR: [
              { dispatchJobId: dispatchJob.id },
              { lalamoveOrderId: dispatchJob.lalamoveOrderId },
            ],
          },
          orderBy: { processedAt: "desc" },
          take: 50,
        });

        return {
          ok: true,
          events: events.map((e: any) => ({
            id: e.id,
            eventType: e.eventType,
            externalStatus: e.externalStatus,
            processedAt: e.processedAt?.toISOString?.() ?? e.processedAt,
            payload: e.payload,
          })),
        };
      } catch (dbError) {
        console.error(`[local-delivery] fetch-integration-log FAILED shop=${shop} route=${routeId}`, dbError);
        return { ok: false, error: "Failed to load integration log." };
      }
    }

if (intent === "lalamove-place-order") {
    const routeId = formData.get("routeId");
    const locationId = formData.get("locationId");
    const quotationId = formData.get("quotationId");
    console.info(`[local-delivery] lalamove-place-order START shop=${shop} route=${routeId} quotation=${quotationId}`);

    // Check for existing active dispatch today (shop + location + route + date) to prevent duplicates
    if (typeof routeId === "string" && typeof locationId === "string") {
      try {
        const startOfToday = getStartOfDay();
        const existingDispatch = await (prisma as any).lalamoveDispatchJob.findFirst({
          where: {
            shop,
            locationId,
            routeId,
            requestedAt: { gte: startOfToday },
            status: { notIn: ["cancelled", "CANCELLED", "CANCELED", "failed", "FAILED", "COMPLETED", "completed", "REJECTED", "rejected", "EXPIRED", "expired", "delivered", "DELIVERED", "FULFILLED"] },
          },
        });
        if (existingDispatch) {
          return {
            ok: false,
            error: "A driver has already been requested for this route. Refresh the page to see the current status.",
            routeId,
          };
        }
      } catch {
        // Continue if table unavailable
      }
    }
    const quotationTotal = String(formData.get("quotationTotal") ?? "").trim() || null;
    const quotationCurrency = String(formData.get("quotationCurrency") ?? "").trim() || null;
    const stopIds = formData
      .getAll("stopIds")
      .filter((value): value is string => typeof value === "string");
    const deliveryAssignmentsRaw = formData.get("deliveryAssignments");
    let deliveryAssignments: LalamoveDeliveryAssignment[] = [];
    if (typeof deliveryAssignmentsRaw === "string" && deliveryAssignmentsRaw.trim()) {
      try {
        const parsed = JSON.parse(deliveryAssignmentsRaw) as Array<{
          stopId?: unknown;
          orderId?: unknown;
        }>;
        deliveryAssignments = Array.isArray(parsed)
          ? parsed
              .filter(
                (item): item is { stopId: string; orderId: string } =>
                  typeof item?.stopId === "string" &&
                  item.stopId.length > 0 &&
                  typeof item?.orderId === "string" &&
                  item.orderId.length > 0,
              )
              .map((item) => ({ stopId: item.stopId, orderId: item.orderId }))
          : [];
      } catch {
        return { ok: false, error: "Invalid delivery assignment payload.", routeId: typeof routeId === "string" ? routeId : undefined };
      }
    }
    if (
      typeof routeId !== "string" ||
      typeof locationId !== "string" ||
      typeof quotationId !== "string"
    ) {
      return { ok: false, error: "Missing route or quotation data.", routeId: typeof routeId === "string" ? routeId : undefined };
    }
    if (stopIds.length < 2) {
      return { ok: false, error: "Invalid order/stop mapping for dispatch.", routeId };
    }
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return {
        ok: false,
        error:
          "Missing Lalamove API credentials. Add your API key and secret in Settings.",
        routeId,
      };
    }

    const configRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId } },
    });
    if (!configRow) {
      return { ok: false, error: "Missing Lalamove settings.", routeId };
    }
    const config = configRow.data as LalamoveConfig;

    const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({
      where: { shop },
    });
    const carrierConfig = carrierConfigRow?.data as CarrierServiceConfigData | undefined;
    const defaultServiceType =
      carrierConfig?.lalamovePreferredServiceType?.trim() || "LALAGO";

    const locationResponse = await admin.graphql(
      `#graphql
        query LalamovePlaceOrderLocation($id: ID!) {
          location(id: $id) {
            id
            name
            address {
              address2
            }
          }
        }`,
      { variables: { id: locationId } },
    );
    const locationJson = await locationResponse.json();
    const locationNode = locationJson?.data?.location as {
      name?: string | null;
      address?: { address2?: string | null } | null;
    } | null;
    // Always inject Location name and details into config for Lalamove request
    const configWithLocation: LalamoveConfig = {
      ...config,
      preferredServiceType: config.preferredServiceType?.trim() || defaultServiceType,
      locationName: (locationNode?.name ?? "").trim() || config.locationName || "",
      locationDetails: (locationNode?.address?.address2 ?? "").trim() || config.locationDetails || "",
    };

    const senderStopId = stopIds[0]!;
    const recipientStopIds = stopIds.slice(1);
    const assignmentByStopId = new Map(
      deliveryAssignments.map((assignment) => [assignment.stopId, assignment.orderId]),
    );
    const assignmentOrderIds =
      deliveryAssignments.length > 0
        ? recipientStopIds.map((stopId) => assignmentByStopId.get(stopId) ?? "")
        : ids.slice(0, recipientStopIds.length);
    if (
      assignmentOrderIds.length !== recipientStopIds.length ||
      assignmentOrderIds.some((id) => !id)
    ) {
      return {
        ok: false,
        error:
          "Invalid stop-to-order assignment for dispatch. Please request a new quote.",
        routeId,
      };
    }
    const uniqueOrderIds = Array.from(new Set(assignmentOrderIds));
    if (uniqueOrderIds.length !== assignmentOrderIds.length) {
      return {
        ok: false,
        error:
          "Duplicate order assignment detected for optimized stops. Please request a new quote.",
        routeId,
      };
    }
    console.info(`[local-delivery] lalamove-place-order assignment resolved route=${routeId} stops=${recipientStopIds.length} source=${deliveryAssignments.length > 0 ? "deliveryAssignments" : "legacyOrderIds"}`);

    // ── Dispatch-vs-route drift guard ──────────────────────────────────────
    // Query Shopify for every order tagged with this route at this location
    // (no methodType filter — tags are the source of truth) and refuse the
    // dispatch if any are missing from assignmentOrderIds. This catches a
    // class of bug Lucas hit 2026-05-15: the includeWarehouse toggle reset
    // on location switch, the route card silently re-derived from the now-
    // filtered order pool, and the dispatch sent a strict subset of the
    // route's real contents (warehouse-method rows dropped without warning).
    // The toggle continues to gate both viewing AND the dispatch payload by
    // design; this gate ensures the dispatch path can never silently send
    // less than what's actually in the route.
    try {
      const routeIndex = Number.parseInt(routeId.split("-").pop() ?? "", 10);
      const routeTag = Number.isFinite(routeIndex)
        ? ROUTE_TAG_DEFINITIONS[routeIndex]?.tag
        : null;
      if (routeTag) {
        const locationLegacy = locationId.replace("gid://shopify/Location/", "");
        const driftQuery = `fulfillment_location_id:${locationLegacy} tag:${routeTag} fulfillment_status:unshipped status:open`;
        const driftRes = await admin.graphql(
          `#graphql
            query DispatchDriftCheck($query: String!) {
              orders(query: $query, first: 100) {
                nodes { id name displayFulfillmentStatus }
              }
            }`,
          { variables: { query: driftQuery } },
        );
        const driftJson = (await driftRes.json()) as {
          data?: { orders?: { nodes?: Array<{ id: string; name: string; displayFulfillmentStatus?: string }> } };
        };
        const expected = (driftJson?.data?.orders?.nodes ?? []).filter(
          (n) =>
            n.displayFulfillmentStatus === "UNFULFILLED" ||
            n.displayFulfillmentStatus === "PARTIALLY_FULFILLED",
        );
        const dispatchedSet = new Set(assignmentOrderIds);
        const missing = expected.filter((n) => !dispatchedSet.has(n.id));
        if (missing.length > 0) {
          const missingNames = missing.slice(0, 5).map((m) => m.name).join(", ");
          const tail = missing.length > 5 ? ` (+${missing.length - 5} more)` : "";
          console.warn(
            `[local-delivery] lalamove-place-order DRIFT shop=${shop} route=${routeId} expected=${expected.length} dispatched=${assignmentOrderIds.length} missing=${missing.length}`,
          );
          return {
            ok: false,
            error:
              `This route has ${expected.length} order(s) tagged ${routeTag} at this location, but only ${assignmentOrderIds.length} are in the dispatch. ` +
              `Missing: ${missingNames}${tail}. ` +
              `If you've moved orders from a warehouse location, enable "Include warehouse" and request a new quote.`,
            routeId,
          };
        }
      }
    } catch (err) {
      // Drift check is defense-in-depth — log but don't block on its own failure.
      console.warn(
        `[local-delivery] lalamove-place-order drift check FAILED shop=${shop} route=${routeId}`,
        err instanceof Error ? err.message : String(err),
      );
    }

    const ordersResponse = await admin.graphql(
      `#graphql
        query LalamoveOrderContacts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order {
              id
              name
              shippingAddress {
                address1
                address2
                city
                province
                zip
                country
                latitude
                longitude
                phone
              }
              customer {
                displayName
                phone
                defaultPhoneNumber { phoneNumber }
              }
            }
          }
        }`,
      { variables: { ids: assignmentOrderIds } },
    );
    const ordersJson = await ordersResponse.json();
    const orderNodes = (ordersJson?.data?.nodes ?? []) as Array<{
      id: string;
      name: string;
      shippingAddress?: {
        address1?: string | null;
        address2?: string | null;
        city?: string | null;
        province?: string | null;
        zip?: string | null;
        country?: string | null;
        latitude?: number | null;
        longitude?: number | null;
        phone?: string | null;
      } | null;
      customer?: {
        displayName?: string | null;
        phone?: string | null;
        defaultPhoneNumber?: { phoneNumber: string } | null;
      } | null;
    }>;
    const orderById = new Map(orderNodes.map((order) => [order.id, order]));
    const missingAssignedOrderId = assignmentOrderIds.find(
      (orderId) => !orderById.has(orderId),
    );
    if (missingAssignedOrderId) {
      return {
        ok: false,
        error:
          "Could not load one or more assigned Shopify orders for this optimized route.",
        routeId,
      };
    }
    // ── Foreign phone warning ───────────────────────────────────────────────
    const skipPhoneWarning = formData.get("skipPhoneWarning") === "true";
    if (!skipPhoneWarning) {
      const foreignPhoneOrders: Array<{
        id: string;
        name: string;
        customerName: string;
        phone: string;
      }> = [];
      for (const orderId of assignmentOrderIds) {
        const order = orderById.get(orderId)!;
        const phoneCandidates = [
          order.customer?.defaultPhoneNumber?.phoneNumber,
          order.shippingAddress?.phone,
          order.customer?.phone,
        ];
        const hasValidPhone = phoneCandidates.some(
          (p) => !!normalizePhoneForMarket(p, configWithLocation.market),
        );
        if (!hasValidPhone) {
          const bestRaw =
            phoneCandidates.find((p) => p?.trim()) ?? "";
          foreignPhoneOrders.push({
            id: orderId,
            name: order.name,
            customerName: order.customer?.displayName ?? "",
            phone: bestRaw?.trim() ?? "",
          });
        }
      }
      if (foreignPhoneOrders.length > 0) {
        console.info(
          `[local-delivery] lalamove-place-order PHONE_WARNING shop=${shop} route=${routeId} affected=${foreignPhoneOrders.length}`,
        );
        return {
          ok: false,
          foreignPhoneWarning: true,
          affectedOrders: foreignPhoneOrders,
          routeId,
        };
      }
    }

    const pickupInstructions = configWithLocation.pickupInstructions?.trim();
    const recipients = recipientStopIds.map((stopId, index) => {
      const orderId = assignmentOrderIds[index]!;
      const order = orderById.get(orderId)!;
      const remarks = buildLalamoveRecipientRemarks(
        index,
        pickupInstructions,
        order.shippingAddress?.address2,
      );
      return {
        stopId,
        name: order.customer?.displayName || order.name || "Customer",
        phone: (() => {
          const candidates = [
            order.customer?.defaultPhoneNumber?.phoneNumber,
            order.shippingAddress?.phone,
            order.customer?.phone,
          ];
          for (const candidate of candidates) {
            const normalized = normalizePhoneForMarket(
              candidate,
              configWithLocation.market,
            );
            if (normalized) return normalized;
          }
          return config.locationPhone || "";
        })(),
        ...(remarks ? { remarks } : {}),
      };
    });

    let placeResponse;
    try {
      placeResponse = await placeLalamoveOrder({
        market: configWithLocation.market,
        quotationId,
        sender: {
          stopId: senderStopId,
          name: config.locationName?.trim() ?? "",
          phone: configWithLocation.locationPhone ?? "",
        },
        recipients,
        isPODEnabled: true,
        metadata: {
          shop,
        },
      }, credentials);
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Lalamove place order failed.";
      const message = sanitizeLalamoveErrorMessage(rawMessage);

      // 404 recovery: Lalamove sometimes returns 404 when the order was actually created
      const is404 = rawMessage.includes("404") || rawMessage.includes("NOT_FOUND") || rawMessage.includes("not found");
      if (is404 && quotationId && typeof quotationId === "string") {
        console.warn(`[local-delivery] lalamove-place-order 404 recovery check shop=${shop} route=${routeId} quotation=${quotationId}`);
        try {
          // Check if there is a recent dispatch job for this quotation
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          const recentJob = await (prisma as any).lalamoveDispatchJob.findFirst({
            where: { shop, quotationId, requestedAt: { gte: fiveMinutesAgo } },
            orderBy: { requestedAt: "desc" as const },
          });
          if (recentJob?.lalamoveOrderId) {
            // Order was already recorded — return success
            console.info(`[local-delivery] lalamove-place-order 404 recovery OK job=${recentJob.id} orderId=${recentJob.lalamoveOrderId}`);
            return {
              ok: true,
              routeId,
              placedOrderId: recentJob.lalamoveOrderId,
              shareLink: null,
            };
          }
        } catch {
          // Fall through to error return
        }
      }

      // Payload recovery: Lalamove returned non-ok but may have included the orderId
      if (error instanceof LalamoveApiError) {
        const errPayload = error.payload as { data?: { orderId?: string } } | null | undefined;
        if (errPayload?.data?.orderId) {
        const recoveredOrderId = errPayload.data.orderId;
        console.warn(`[local-delivery] lalamove-place-order payload-recovery: HTTP ${error.status} but orderId=${recoveredOrderId} — verifying shop=${shop} route=${routeId}`);
        try {
          const verified = await getLalamoveOrderDetails(configWithLocation.market, recoveredOrderId, credentials);
          placeResponse = {
            orderId: verified.orderId ?? recoveredOrderId,
            quotationId: verified.quotationId ?? quotationId,
            status: verified.status ?? "ASSIGNING_DRIVER",
            shareLink: verified.shareLink,
          };
          console.info(`[local-delivery] lalamove-place-order payload-recovery OK orderId=${placeResponse.orderId} status=${placeResponse.status}`);
        } catch (verifyErr) {
          console.error(`[local-delivery] lalamove-place-order payload-recovery FAILED orderId=${recoveredOrderId}`, verifyErr);
        }
        }
      }

      if (!placeResponse) {
        console.error(`[local-delivery] lalamove-place-order FAILED shop=${shop} route=${routeId} location=${locationId} error=${message}`);
        return { ok: false, error: message, routeId };
      }
    }

    // Build snapshot of order stops so escalation reorder can rebuild the
    // quotation without depending on PendingDeliveryRoute (which manual
    // dispatch does not write).
    const orderedStopsSnapshot = assignmentOrderIds
      .map((orderId) => {
        const order = orderById.get(orderId);
        if (!order) return null;
        const addr = order.shippingAddress;
        const lat = typeof addr?.latitude === "number" ? addr.latitude : null;
        const lng = typeof addr?.longitude === "number" ? addr.longitude : null;
        if (lat == null || lng == null) return null;
        const composedAddress = [
          addr?.address1,
          addr?.city,
          addr?.province,
          addr?.zip,
          addr?.country,
        ]
          .filter((part) => typeof part === "string" && part.trim())
          .join(", ");
        const phone = (() => {
          const candidates = [
            order.customer?.defaultPhoneNumber?.phoneNumber,
            addr?.phone,
            order.customer?.phone,
          ];
          for (const candidate of candidates) {
            const normalized = normalizePhoneForMarket(
              candidate,
              configWithLocation.market,
            );
            if (normalized) return normalized;
          }
          return configWithLocation.locationPhone ?? "";
        })();
        return {
          shopifyOrderId: orderId,
          lat,
          lng,
          address: composedAddress,
          name: order.customer?.displayName || order.name || "Customer",
          phone,
        };
      })
      .filter((stop): stop is {
        shopifyOrderId: string;
        lat: number;
        lng: number;
        address: string;
        name: string;
        phone: string;
      } => stop !== null);

    // Warehouse-method override flag — set by the client whenever the route
    // being dispatched contains at least one order whose Shopify deliveryMethod
    // is not LOCAL. Drives both LalamoveDispatchJob.methodOverride and the
    // `ld_method-override` Shopify tag application below.
    const methodOverride = formData.get("methodOverride") === "1";

    const prismaAny = prisma as any;
    try {
      const dispatchJob = await prismaAny.lalamoveDispatchJob.create({
        data: {
          shop,
          routeId,
          locationId,
          status: placeResponse.status,
          quotationId,
          lalamoveOrderId: placeResponse.orderId,
          market: configWithLocation.market,
          serviceType: configWithLocation.preferredServiceType,
          quotationTotal,
          quotationCurrency,
          methodOverride,
          ordersData:
            orderedStopsSnapshot.length === assignmentOrderIds.length
              ? orderedStopsSnapshot
              : null,
        },
      });

      await prismaAny.lalamoveDispatchOrderMap.createMany({
        data: assignmentOrderIds.map((orderId) => ({
          shop,
          dispatchJobId: dispatchJob.id,
          shopifyOrderId: orderId,
          lalamoveOrderId: placeResponse.orderId,
          currentStatus: placeResponse.status,
        })),
      });

      // ── Correction tracking: compare vs optimizer proposal ──
      try {
        if (typeof locationId === "string") {
          const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
          const snapshot = await (prisma as any).routeOptimizationSnapshot.findFirst({
            where: { shop, locationId, proposedAt: { gte: fourHoursAgo } },
            orderBy: { proposedAt: "desc" },
          });
          if (snapshot) {
            const proposed = snapshot.proposedRoutes as Array<{ routeIndex: number; orderIds: string[] }>;
            const coordsMap = new Map(
              (snapshot.orderCoordinates as Array<{ orderId: string; lat: number; lng: number }>)
                .map((c: { orderId: string; lat: number; lng: number }) => [c.orderId, { lat: c.lat, lng: c.lng }]),
            );
            const proposedRouteByOrder = new Map<string, number>();
            for (const route of proposed) {
              for (const oid of route.orderIds) proposedRouteByOrder.set(oid, route.routeIndex);
            }
            const routeIndexStr = typeof routeId === "string" ? routeId.split("-").pop() : null;
            const actualRouteIndex = routeIndexStr != null ? Number(routeIndexStr) : null;

            const corrections: Array<{ orderId: string; fromRoute: number | null; toRoute: number | null; lat: number | null; lng: number | null }> = [];

            for (const orderId of assignmentOrderIds) {
              const proposedRoute = proposedRouteByOrder.get(orderId) ?? null;
              if (proposedRoute !== actualRouteIndex) {
                const coords = coordsMap.get(orderId);
                corrections.push({ orderId, fromRoute: proposedRoute, toRoute: actualRouteIndex, lat: coords?.lat ?? null, lng: coords?.lng ?? null });
              }
            }
            if (actualRouteIndex != null) {
              const proposedForThis = proposed.find((r) => r.routeIndex === actualRouteIndex);
              if (proposedForThis) {
                const dispatchedSet = new Set(assignmentOrderIds);
                for (const oid of proposedForThis.orderIds) {
                  if (!dispatchedSet.has(oid)) {
                    const coords = coordsMap.get(oid);
                    corrections.push({ orderId: oid, fromRoute: actualRouteIndex, toRoute: null, lat: coords?.lat ?? null, lng: coords?.lng ?? null });
                  }
                }
              }
            }

            await (prisma as any).routeCorrection.create({
              data: {
                shop,
                snapshotId: snapshot.id,
                dispatchedRouteIndex: actualRouteIndex,
                corrections,
                wasModified: corrections.length > 0,
                ordersReassigned: corrections.length,
                ordersDispatched: assignmentOrderIds.length,
              },
            });
          }
        }
      } catch (correctionErr) {
        console.warn("[local-delivery] correction tracking FAILED", correctionErr);
      }

    } catch (dbError) {
      console.error(`[local-delivery] lalamove-place-order FAILED DB write (order was placed) shop=${shop} route=${routeId} orderId=${placeResponse.orderId}`, dbError);
    }

    // B6: Add ld_rota-NN tag to dispatched orders to confirm route assignment.
    // 2026-05-14: when the route is a warehouse-method override, also apply
    // ld_method-override to every order so future auto-cron ticks treat them
    // as already-handled (getAllAutoAssignSkipTags() includes this tag).
    const routeTag = formData.get("routeTag");
    const tagsToApply: string[] = [];
    if (typeof routeTag === "string" && /^ld_rota-\d+$/.test(routeTag)) {
      tagsToApply.push(routeTag);
    }
    if (methodOverride) {
      tagsToApply.push(LD_METHOD_OVERRIDE_TAG);
    }
    if (tagsToApply.length > 0) {
      await batchProcess(assignmentOrderIds, GQL_BATCH_SIZE, (id) =>
        admin.graphql(
          `#graphql
            mutation AddOrderTag($id: ID!, $tags: [String!]!) {
              tagsAdd(id: $id, tags: $tags) {
                userErrors { message }
              }
            }`,
          { variables: { id, tags: tagsToApply } },
        ),
      );
    }

    console.info(`[local-delivery] lalamove-place-order OK shop=${shop} route=${routeId} orderId=${placeResponse.orderId} orders=${assignmentOrderIds.length} methodOverride=${methodOverride}`);
    return {
      ok: true,
      routeId,
      placedOrderId: placeResponse.orderId,
      shareLink: placeResponse.shareLink ?? null,
      market: configWithLocation.market,
    };
  }

  if (intent === "return-pickup-quote") {
    const locationId = formData.get("locationId");
    const returnInstructions = String(formData.get("returnInstructions") ?? "").trim();
    const returnRequestIds = formData
      .getAll("returnRequestIds")
      .filter((v): v is string => typeof v === "string");

    if (typeof locationId !== "string") {
      return { ok: false, error: "Location ID missing." };
    }
    if (returnRequestIds.length === 0) {
      return { ok: false, error: "No return requests selected." };
    }

    console.info(`[local-delivery] return-pickup-quote START shop=${shop} location=${locationId} requests=${returnRequestIds.length}`);

    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return { ok: false, error: "Missing Lalamove API credentials. Add your API key and secret in Settings." };
    }

    const configRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId } },
    });
    if (!configRow) {
      return { ok: false, error: "Missing Lalamove settings for this location." };
    }
    const config = configRow.data as LalamoveConfig;

    const returnRequests = await prisma.returnPickupRequest.findMany({
      where: { id: { in: returnRequestIds }, shop },
    });
    if (returnRequests.length === 0) {
      return { ok: false, error: "No valid return requests found." };
    }

    // Filter requests with valid coordinates
    const validRequests = returnRequests.filter(
      (r) => r.customerLat != null && r.customerLng != null,
    );
    if (validRequests.length === 0) {
      return { ok: false, error: "Selected return requests are missing customer coordinates." };
    }

    // Get fulfillment location coordinates
    const locResponse = await admin.graphql(
      `#graphql
        query ReturnPickupLocation($id: ID!) {
          location(id: $id) {
            name
            address {
              address1
              address2
              city
              province
              zip
              country
              latitude
              longitude
            }
          }
        }
      `,
      { variables: { id: locationId } },
    );
    const locJson = await locResponse.json();
    const locData = locJson.data?.location;
    const locAddress = locData?.address;
    if (!locAddress?.latitude || !locAddress?.longitude) {
      return { ok: false, error: "Fulfillment location coordinates are missing." };
    }

    const fulfillmentStop = {
      coordinates: { lat: String(locAddress.latitude), lng: String(locAddress.longitude) },
      address:
        formatFulfillmentStopAddress(config.locationName, config.locationAddress, config.locationDetails) ||
        formatAddress([locAddress.address1, locAddress.city, locAddress.province, locAddress.country]),
    };

    // Build customer stops — for multiple returns, pick farthest customer as start
    const { haversineMeters } = await import("../utils/polyline.server");
    const depot = { latitude: locAddress.latitude, longitude: locAddress.longitude };
    const sorted = [...validRequests].sort((a, b) => {
      const distA = haversineMeters(depot, { latitude: a.customerLat!, longitude: a.customerLng! });
      const distB = haversineMeters(depot, { latitude: b.customerLat!, longitude: b.customerLng! });
      return distB - distA; // farthest first
    });

    const customerStops = sorted.map((r, index) => ({
      coordinates: { lat: String(r.customerLat!), lng: String(r.customerLng!) },
      address: r.customerAddress ?? "Unknown address",
      sourceAddress2: r.customerAddress2 ?? null,
      ...(index === 0 && returnInstructions ? { remarks: returnInstructions } : {}),
    }));

    // Reversed: customers first → fulfillment location last
    const stops = [...customerStops, fulfillmentStop];

    const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
    const carrierConfig = carrierConfigRow?.data as CarrierServiceConfigData | undefined;
    const serviceType = config.preferredServiceType?.trim() || carrierConfig?.lalamovePreferredServiceType?.trim() || "LALAGO";

    try {
      const quotation = await createLalamoveQuotation({
        market: config.market,
        language: config.language,
        serviceType,
        stops,
        isRouteOptimized: stops.length >= 3,
      }, credentials);

      const stopIds = (quotation.stops ?? []).map((s: { stopId?: string }) => s.stopId ?? "");

      console.info(`[local-delivery] return-pickup-quote OK shop=${shop} quotationId=${quotation.quotationId} total=${quotation.priceBreakdown?.total ?? "?"}`);
      return {
        ok: true,
        intent: "return-pickup-quote",
        returnQuotation: {
          quotationId: quotation.quotationId,
          total: quotation.priceBreakdown?.total ?? null,
          currency: quotation.priceBreakdown?.currency ?? null,
          stopIds,
          requestIds: sorted.map((r) => r.id),
          locationId,
        },
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Lalamove quote failed.";
      const message = sanitizeLalamoveErrorMessage(rawMessage);
      console.error(`[local-delivery] return-pickup-quote FAILED shop=${shop} error=${message}`);
      return { ok: false, error: message };
    }
  }

  if (intent === "return-pickup-place-order") {
    const locationId = formData.get("locationId");
    const quotationId = formData.get("quotationId");
    const returnInstructions = String(formData.get("returnInstructions") ?? "").trim();
    const returnRequestIds = formData
      .getAll("returnRequestIds")
      .filter((v): v is string => typeof v === "string");
    const stopIds = formData
      .getAll("stopIds")
      .filter((v): v is string => typeof v === "string");

    if (typeof locationId !== "string" || typeof quotationId !== "string") {
      return { ok: false, error: "Missing quotation or location information." };
    }
    if (returnRequestIds.length === 0 || stopIds.length === 0) {
      return { ok: false, error: "Missing return request or stop information." };
    }

    console.info(`[local-delivery] return-pickup-place-order START shop=${shop} quotation=${quotationId}`);

    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return { ok: false, error: "Missing Lalamove API credentials." };
    }

    const configRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId } },
    });
    if (!configRow) {
      return { ok: false, error: "Missing Lalamove settings." };
    }
    const config = configRow.data as LalamoveConfig;

    const returnRequests = await prisma.returnPickupRequest.findMany({
      where: { id: { in: returnRequestIds }, shop },
    });
    if (returnRequests.length === 0) {
      return { ok: false, error: "No valid return requests found." };
    }

    // First stop = first customer (sender), remaining = other customers + fulfillment (recipients)
    const sender = {
      stopId: stopIds[0]!,
      name: returnRequests[0]?.customerName ?? "Customer",
      phone: returnRequests[0]?.customerPhone ?? config.locationPhone ?? "",
      ...(returnInstructions ? { remarks: returnInstructions } : {}),
    };

    const recipients = stopIds.slice(1).map((stopId, index) => {
      // Last stopId = fulfillment location
      const isLocation = index === stopIds.length - 2;
      if (isLocation) {
        return {
          stopId,
          name: config.locationName ?? "Store",
          phone: config.locationPhone ?? "",
        };
      }
      // Intermediate customer stops
      const req = returnRequests[index + 1];
      return {
        stopId,
        name: req?.customerName ?? "Customer",
        phone: req?.customerPhone ?? "",
      };
    });

    try {
      const placeResponse = await placeLalamoveOrder({
        market: config.market,
        quotationId,
        sender,
        recipients,
        isPODEnabled: false,
        metadata: { shop },
      }, credentials);

      // Update all return requests to dispatched
      await prisma.returnPickupRequest.updateMany({
        where: { id: { in: returnRequestIds } },
        data: {
          status: "dispatched",
          lalamoveOrderId: placeResponse.orderId,
          quotationId,
        },
      });

      // Audit trail for return pickup dispatch
      const prismaAny = prisma as any;
      await prismaAny.lalamoveDispatchEvent.create({
        data: {
          shop,
          lalamoveOrderId: placeResponse.orderId,
          eventType: "RETURN_PICKUP_DISPATCHED",
          externalStatus: "ASSIGNING_DRIVER",
          payload: { returnRequestIds, quotationId } as object,
        },
      });

      console.info(`[local-delivery] return-pickup-place-order OK shop=${shop} orderId=${placeResponse.orderId}`);
      return {
        ok: true,
        intent: "return-pickup-place-order",
        returnPlacedOrderId: placeResponse.orderId,
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Lalamove order failed.";
      const message = sanitizeLalamoveErrorMessage(rawMessage);
      console.error(`[local-delivery] return-pickup-place-order FAILED shop=${shop} error=${message}`);
      return { ok: false, error: message };
    }
  }

  // Removed: `lalamove-check-escalation` intent. Escalation is now exclusively
  // driven by the lalamove-watchdog cron. The page poller that fired this
  // intent has been removed (see comment near the previous useEffect call).

  if (intent === "lalamove-reconcile-status") {
    const lalamoveOrderId = formData.get("lalamoveOrderId");
    const market = formData.get("market");
    if (typeof lalamoveOrderId !== "string" || typeof market !== "string") {
      return { ok: false, error: "Missing reconciliation payload." };
    }
    console.info(`[local-delivery] lalamove-reconcile-status shop=${shop} orderId=${lalamoveOrderId}`);
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return {
        ok: false,
        error:
          "Missing Lalamove API credentials. Add your API key and secret in Settings.",
      };
    }
    const details = await getLalamoveOrderDetails(
      market,
      lalamoveOrderId,
      credentials,
    );
    return { ok: true, details };
  }

  if (ids.length === 0) {
    return { ok: false, error: "No orders selected." };
  }

  if (intent === "unassign") {
    const routeTag = formData.get("routeTag");
    if (typeof routeTag !== "string") {
      return { ok: false, error: "Route tag not provided." };
    }
    console.info(`[local-delivery] unassign shop=${shop} orders=${ids.length} tag=${routeTag}`);

    await Promise.all(
      ids.map((id) =>
        admin.graphql(
          `#graphql
            mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
              tagsRemove(id: $id, tags: $tags) {
                node {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
          { variables: { id, tags: [routeTag] } },
        ),
      ),
    );

    return { ok: true };
  }

  if (typeof route !== "string") {
    return { ok: false, error: "Route not provided." };
  }

  const tag = ROUTE_TAGS.get(route);
  if (!tag) {
    return { ok: false, error: "Unsupported route." };
  }

  const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);

  await Promise.all(
    ids.map(async (id) => {
      await admin.graphql(
        `#graphql
          mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
            tagsRemove(id: $id, tags: $tags) {
              node { id }
              userErrors { field message }
            }
          }`,
        { variables: { id, tags: allRouteTags } },
      );
      await admin.graphql(
        `#graphql
          mutation AddOrderTag($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              node {
                id
              }
              userErrors {
                field
                message
              }
            }
          }`,
        { variables: { id, tags: [tag] } },
      );
    }),
  );

  return { ok: true };

  } catch (err) {
    console.error("[local-delivery:action] Unhandled error", {
      shop,
      intent: String(intent ?? "unknown"),
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { ok: false, error: "An unexpected error occurred. Check server logs." };
  }
};
