import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useSubmit } from "react-router";
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
import {
  getFailedDeliveryTag,
} from "../services/lalamove-sync.server";
import { runCarrierQuotationForOrderId } from "../services/auto-routing.server";
import {
  checkAndApplyEscalations,
  type EscalationResult,
} from "../services/lalamove-escalation.server";
import { resolveConfiguredSpecialRequests } from "../services/lalamove-special-requests.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import styles from "./app.local-delivery/styles.module.css";

const DEFAULT_DELIVERY_METHOD = "local";
const DEFAULT_LOCATION_ID = "all";
const DEFAULT_START_DATE_DAYS = 30;
const DEFAULT_DELIVERY_PROMISE_DAYS = 1;
const MAP_STYLE_STORAGE_KEY = "omnify.localDelivery.mapStyle";

const toLegacyLocationId = (gid: string) => {
  if (!gid) return "";
  if (!gid.startsWith("gid://")) return gid;
  const parts = gid.split("/");
  return parts[parts.length - 1] || "";
};

const toAdminStoreHandle = (shop: string) => shop.replace(/\.myshopify\.com$/i, "");

const DAY_MS = 24 * 60 * 60 * 1000;

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

const getDayIndexInTimeZone = (
  date: Date,
  timeZone: string,
  userLocale: string,
) => {
  const locale = userLocale?.replace("_", "-") || "en-US";
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  if (!year || !month || !day) return 0;
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
};

// Returns the 0–23 hour for a given date in the specified timezone.
// hourCycle "h23" guarantees midnight = 0, 1 PM = 13, avoiding the "24" edge case.
const getHourInTimeZone = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? Number(hourPart.value) : date.getUTCHours();
};

const getMinuteInTimeZone = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const minutePart = parts.find((p) => p.type === "minute");
  return minutePart ? Number(minutePart.value) : date.getUTCMinutes();
};

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

const toDeliveryPromiseDays = (value: string | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DELIVERY_PROMISE_DAYS;
  const normalized = Math.trunc(parsed);
  if (![0, 1, 2, 3, 4].includes(normalized)) return DEFAULT_DELIVERY_PROMISE_DAYS;
  return normalized;
};

const toPresaleTags = (value: string | null) => {
  if (!value) return [] as string[];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
};

export default function Index() {
  const {
    orders,
    locations,
    filters,
    debugLocalDelivery,
    ordersError,
    mapsApiKey,
    mapsMapId,
    shipmentRequestOrders,
    routeStats,
    precomputedRoutes,
    lalamoveConfigs,
    credentialStatus,
    pendingRoutes,
    returnPickupRequests,
    shop,
    userLocale,
    availablePresaleTags,
    hasUnfulfilledPresaleOrders,
    failedDeliveryCount,
    activeDispatchData,
    optimizerAccuracy,
  } =
    useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation("local-delivery");
  const lalamoveFetcher = useFetcher<typeof action>();
  const lalamoveSettingsFetcher = useFetcher<typeof action>();
  const optimizeFetcher = useFetcher<typeof action>();
  const assignFetcher = useFetcher();
  const unassignFetcher = useFetcher();
  const pendingRouteFetcher = useFetcher<typeof action>();
  const updateRoutesFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const trackingFetcher = useFetcher<typeof action>();
  const trackingRouteRef = useRef<string | null>(null);
  const submit = useSubmit();
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [locationId, setLocationId] = useState(filters.locationId);
  const [startDate, setStartDate] = useState(filters.startDate);
  const [deliveryPromiseDays, setDeliveryPromiseDays] = useState(
    filters.deliveryPromiseDays,
  );
  const [sameDayHour, setSameDayHour] = useState(12);
  const [sameDayMinute, setSameDayMinute] = useState(0);
  const [selectedPresaleTags, setSelectedPresaleTags] = useState<string[]>(
    filters.selectedPresaleTags,
  );
  const [isPresaleModalOpen, setIsPresaleModalOpen] = useState(false);
  const [draftPresaleTags, setDraftPresaleTags] = useState<string[]>(
    filters.selectedPresaleTags,
  );
  const [isAddressErrorsModalOpen, setIsAddressErrorsModalOpen] = useState(false);
  const [isShipmentRequestsModalOpen, setIsShipmentRequestsModalOpen] = useState(false);
  const [isReturnPickupsModalOpen, setIsReturnPickupsModalOpen] = useState(false);
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
  const [activeTab, setActiveTab] = useState<"routes" | "settings">("routes");
  const [ordersFilter, setOrdersFilter] = useState<"all" | "unassigned" | "assigned">("all");
  const [ordersSearch, setOrdersSearch] = useState("");
  const ordersSectionRef = useRef<HTMLDivElement | null>(null);
  const [lalamoveBusyRouteId, setLalamoveBusyRouteId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRouteManagerVisible, setIsRouteManagerVisible] = useState(false);
  const [isAccuracyCollapsed, setIsAccuracyCollapsed] = useState(false);
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
  // Tracks routes where a driver has been successfully requested (hydrated from DB)
  const [dispatchedRoutes, setDispatchedRoutes] = useState<
    Record<string, { shareLink?: string; status?: string; lalamoveOrderId?: string; market?: string }>
  >(() => {
    const initial: Record<string, { shareLink?: string; status?: string; lalamoveOrderId?: string; market?: string }> = {};
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
  const markersRef = useRef<Array<{ type: "marker" | "advanced"; marker: any }>>(
    [],
  );
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
  const [settingsSaved, setSettingsSaved] = useState(false);
  const autoAssignActiveRef = useRef(false);
  const prevUnassignedCountRef = useRef(0);
  const autoAssignCandidateMapRef = useRef<Map<string, string>>(new Map());
  const [assignmentSuccessMessage, setAssignmentSuccessMessage] = useState<
    string | null
  >(null);
  const [assignmentWarningMessage, setAssignmentWarningMessage] = useState<
    string | null
  >(null);
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
    setStartDate(filters.startDate);
    setDeliveryPromiseDays(filters.deliveryPromiseDays);
    setSelectedPresaleTags(filters.selectedPresaleTags);
    setDraftPresaleTags(filters.selectedPresaleTags);
  }, [
    filters.locationId,
    filters.startDate,
    filters.deliveryPromiseDays,
    filters.selectedPresaleTags,
  ]);

  useEffect(() => {
    setLalamoveConfigMap(lalamoveConfigs);
  }, [lalamoveConfigs]);

  useEffect(() => {
    if (lalamoveFetcher.state === "idle" && cancelFetcher.state === "idle") {
      setLalamoveBusyRouteId(null);
    }
  }, [lalamoveFetcher.state, cancelFetcher.state]);

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
      setQuotePreview({
        routeId,
        quotationId: quote.quotationId,
        expiresAt: quote.expiresAt,
        total,
        currency,
        stopIds: (quote.stops ?? []).map((stop) => stop.stopId).filter(Boolean) as string[],
        orderIds: data.orderIds ?? [],
        deliveryAssignments: data.deliveryAssignments ?? [],
        locationId: data.locationId ?? "",
      });
      // Quote fetched — card button will change to "Request driver"; no modal needed
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

  // Sync dispatchedRoutes with loader data on revalidation (status + shareLink updates)
  useEffect(() => {
    if (!activeDispatchData?.length) return;
    setDispatchedRoutes((prev) => {
      const next = { ...prev };
      for (const d of activeDispatchData) {
        next[d.routeId] = {
          ...next[d.routeId],
          status: d.status ?? next[d.routeId]?.status,
          shareLink: d.shareLink ?? next[d.routeId]?.shareLink,
          lalamoveOrderId: d.lalamoveOrderId ?? next[d.routeId]?.lalamoveOrderId,
          market: d.market ?? next[d.routeId]?.market,
        };
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

  // Poll for escalation actions every 2 minutes
  useEffect(() => {
    escalationFetcher.submit(
      { intent: "lalamove-check-escalation" },
      { method: "post" },
    );
    const interval = window.setInterval(() => {
      escalationFetcher.submit(
        { intent: "lalamove-check-escalation" },
        { method: "post" },
      );
    }, 120_000);
    return () => window.clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if ("error" in optimizeFetcher.data) {
      setAssignmentSuccessMessage(optimizeFetcher.data.error ?? null);
      return;
    }
    if (!("optimizedRoutes" in optimizeFetcher.data)) return;
    const optimizedRoutes = optimizeFetcher.data.optimizedRoutes as Array<{
      routeIndex: number;
      locationId: string;
      orderIds: string[];
      polyline: string;
      totalDistanceMeters?: number;
      totalDurationSeconds?: number;
    }>;
    if (
      !optimizedRoutes?.length ||
      optimizedRoutes.every((r) => !r.orderIds?.length)
    ) {
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
    const routeCountMsg = `${summary?.routeCount ?? 0} routes`;
    const costMsg = summary?.costTotal
      ? ` · ${summary.costCurrency ?? "BRL"} ${summary.costTotal}`
        + (summary.totalLalamoveCost && summary.totalWaitSurcharge
          ? ` (delivery ${summary.totalLalamoveCost} + wait ${summary.totalWaitSurcharge})`
          : "")
      : "";
    setAssignmentSuccessMessage(`Optimization applied: ${routeCountMsg}${costMsg}`);
    const assignedIds = new Set(optimizedRoutes.flatMap((r) => r.orderIds));
    const unassignedEntries = [...autoAssignCandidateMapRef.current.entries()].filter(
      ([id]) => !assignedIds.has(id),
    );
    if (unassignedEntries.length === 1) {
      setAssignmentWarningMessage(
        `Order ${unassignedEntries[0]![1]} not assigned: not in delivery area`,
      );
    } else if (unassignedEntries.length > 1) {
      setAssignmentWarningMessage(
        `${unassignedEntries.length} orders not assigned: not in delivery area`,
      );
    } else {
      setAssignmentWarningMessage(null);
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
  }, [optimizeFetcher.data]);

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


  useEffect(() => {
    if (!mapsApiKey) return;
    if (activeTab !== "settings") return;
    let isMounted = true;

    const setupAutocomplete = async () => {
      if (!lalamoveAddressFieldRef.current) return;
      const googleMaps = window.google?.maps;
      if (!googleMaps) return;
      const { Autocomplete } = googleMaps.importLibrary
        ? await googleMaps.importLibrary("places")
        : { Autocomplete: googleMaps.places?.Autocomplete };
      if (!Autocomplete) return;

      const input =
        lalamoveAddressFieldRef.current.querySelector("input") ||
        lalamoveAddressFieldRef.current.shadowRoot?.querySelector("input");
      if (!input) return;

      lalamoveAddressInputRef.current = input;
      input.value = lalamoveSettings.locationAddress || "";

      if (!lalamoveAddressInputListenerRef.current) {
        const inputHandler = (event: Event) => {
          const target = event.currentTarget as HTMLInputElement | null;
          if (!target) return;
          setLalamoveSettings((current) => ({
            ...current,
            locationAddress: target.value,
          }));
        };
        input.addEventListener("input", inputHandler);
        lalamoveAddressInputListenerRef.current = inputHandler;
      }

      if (!lalamoveAddressAutocompleteRef.current) {
        lalamoveAddressAutocompleteRef.current = new Autocomplete(input, {
          fields: ["formatted_address", "name"],
        });
        const placeChanged = () => {
          const place = lalamoveAddressAutocompleteRef.current?.getPlace?.();
          const formatted =
            place?.formatted_address ||
            place?.name ||
            lalamoveSettings.locationAddress;
          if (!formatted) return;
          setLalamoveSettings((current) => ({
            ...current,
            locationAddress: formatted,
          }));
        };
        lalamoveAddressAutocompleteRef.current.addListener(
          "place_changed",
          placeChanged,
        );
        lalamoveAddressPlaceListenerRef.current = placeChanged;
      }
    };

    loadGoogleMaps(mapsApiKey)
      .then(async () => {
        if (!isMounted) return;
        await setupAutocomplete();
      })
      .catch((error) => {
        console.error("Failed to load Google Maps Places", error);
        setMapsLoadError(
          t("map.errors.placesLoadFailed"),
        );
      });

    return () => {
      isMounted = false;
      if (
        lalamoveAddressInputRef.current &&
        lalamoveAddressInputListenerRef.current
      ) {
        lalamoveAddressInputRef.current.removeEventListener(
          "input",
          lalamoveAddressInputListenerRef.current,
        );
        lalamoveAddressInputListenerRef.current = null;
      }
    };
  }, [mapsApiKey, lalamoveSettings.locationAddress, activeTab]);

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

  const dueBucketByOrderId = useMemo(() => {
    const now = new Date();
    const todayDayIndex = getDayIndexInTimeZone(now, browserTimeZone, userLocale);
    const map = new Map<string, "today" | "tomorrow" | "later">();
    orders.forEach((order) => {
      const processedAt = order.processedAt ? new Date(order.processedAt) : null;
      if (!processedAt || Number.isNaN(processedAt.getTime())) {
        // Unknown placement time → treat as due today (safest for operations)
        map.set(order.id, "today");
        return;
      }
      const orderDayIndex = getDayIndexInTimeZone(
        processedAt,
        browserTimeZone,
        userLocale,
      );
      const orderHour = getHourInTimeZone(processedAt, browserTimeZone);
      const orderMinute = getMinuteInTimeZone(processedAt, browserTimeZone);
      // Cutoff driven by sameDayHour:sameDayMinute (user-configurable).
      // Orders placed before cutoff count from that day's cycle;
      // at/after cutoff they count from the next day's cycle.
      const pastCutoff =
        orderHour > sameDayHour ||
        (orderHour === sameDayHour && orderMinute >= sameDayMinute);
      const cycleDayIndex = pastCutoff ? orderDayIndex + 1 : orderDayIndex;
      // Due day = cycle day + (deliveryPromiseDays - 1)
      const dueDayIndex = cycleDayIndex + (deliveryPromiseDays - 1);
      if (dueDayIndex <= todayDayIndex) {
        map.set(order.id, "today"); // due today or overdue
      } else if (dueDayIndex === todayDayIndex + 1) {
        map.set(order.id, "tomorrow");
      } else {
        map.set(order.id, "later");
      }
    });
    return map;
  }, [orders, deliveryPromiseDays, sameDayHour, sameDayMinute, browserTimeZone]);

  const dueBuckets = useMemo(() => {
    const today = unassignedOrders.filter(
      (order) => dueBucketByOrderId.get(order.id) === "today",
    );
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

  const addressErrorOrders = useMemo(
    () => orders.filter((order) => !order.addressValidation.isValid),
    [orders],
  );

  useEffect(() => {
    if (unassignedOrders.length > 0 && assignmentSuccessMessage) {
      setAssignmentSuccessMessage(null);
    }
    if (unassignedOrders.length === 0 && assignmentWarningMessage) {
      setAssignmentWarningMessage(null);
    }
  }, [unassignedOrders.length, assignmentSuccessMessage, assignmentWarningMessage]);


  useEffect(() => {
    setSelectedOrderIds((current) => {
      const next = new Set<string>();
      current.forEach((orderId) => {
        if (ordersById.has(orderId) && !assignedOrderIds.has(orderId)) {
          next.add(orderId);
        }
      });
      return next;
    });
  }, [ordersById, assignedOrderIds]);

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
        } else if (mapContainerEl) {
          mapRef.current.setOptions({
            mapTypeControl: false,
            mapTypeId: mapStyle,
          });
        }

        markersRef.current.forEach(({ type, marker }) => {
          if (type === "advanced") {
            marker.map = null;
          } else {
            marker.setMap(null);
          }
        });
        markersRef.current = [];
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

        const buildLabel = (
          text: string,
          emoji: string | null,
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

          if (emoji) {
            const emojiLine = document.createElement("div");
            emojiLine.className = styles.mapLabelEmoji;
            emojiLine.textContent = emoji;
            label.appendChild(emojiLine);
          }
          label.appendChild(orderLine);
          if (badgeStyle) {
            Object.assign(label.style, badgeStyle);
          }

          wrapper.appendChild(label);
          return wrapper;
        };

        const getRouteDefinitionForOrder = (orderId: string) => {
          return orderRouteMap.get(orderId) ?? null;
        };

        allPoints.forEach((point) => {
          const position = { lat: point.latitude, lng: point.longitude };
          const labelText = point.name;
          const assignedRoute =
            point.kind === "order" ? getRouteDefinitionForOrder(point.id) : null;
          const dueBucket =
            point.kind === "order" ? dueBucketByOrderId.get(point.id) : undefined;
          const orderData = point.kind === "order" ? ordersById.get(point.id) : null;
          const hasAddressError = orderData ? !orderData.addressValidation.isValid : false;
          const emoji =
            point.kind === "order"
              ? hasAddressError
                ? "🟡"
                : dueBucket === "today"
                  ? "📦"
                  : dueBucket === "tomorrow"
                    ? "⏰"
                    : "🕒"
              : "🏬";
          const isSelected = point.kind === "order" && selectedOrderIds.has(point.id);
          const assignedBadgeColors =
            assignedRoute?.color && point.kind === "order"
              ? deriveBadgeColors(assignedRoute.color)
              : null;
          const badgeStyle: Partial<CSSStyleDeclaration> = {};
          if (assignedBadgeColors) {
            badgeStyle.backgroundColor = assignedBadgeColors.bg;
          }
          if (!isSelected) {
            badgeStyle.borderColor = "#111111";
          }
          if (isSelected) {
            badgeStyle.borderColor = "#ff7a00";
            badgeStyle.backgroundColor = "#fff3e0";
          }
          const content = buildLabel(labelText, emoji, badgeStyle);

          const markerTitle = point.kind === "order" && orderData?.customerName
            ? `${point.name} \u2022 ${orderData.customerName}`
            : point.name;
          const advancedMarker = new AdvancedMarkerElement({
            map: mapRef.current!,
            position,
            title: markerTitle,
            content,
          });

          if (point.kind === "order" && !assignedRoute) {
            advancedMarker.addListener("click", () => {
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
            });
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
            });
            advancedMarker.addListener("mouseout", () => {
              infoWindowRef.current?.close();
            });
          } else if (point.kind === "order" && assignedRoute) {
            // Left-click: toggle multiselection (same as unassigned orders)
            advancedMarker.addListener("click", () => {
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
            });
            // Hover preview (same as unassigned orders)
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
            });
            advancedMarker.addListener("mouseout", () => {
              infoWindowRef.current?.close();
            });
            // Right-click: show unassign balloon
            if (advancedMarker.element) {
              advancedMarker.element.addEventListener("contextmenu", (e: Event) => {
                e.preventDefault();
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
              });
            }
          }

          markersRef.current.push({ type: "advanced", marker: advancedMarker });
        });

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

            const polyline = new googleMaps.Polyline({
              path,
              strokeColor: route.color,
              strokeOpacity: 0.85,
              strokeWeight: 4,
              map: mapRef.current,
            });
            precomputedRoutePolylinesRef.current.push(polyline);
          });
        }

        selectedRouteRenderersRef.current.forEach((renderer) =>
          renderer.setMap(null),
        );
        selectedRouteRenderersRef.current = [];

        const selectedOrders = Array.from(selectedOrderIds)
          .map((orderId) => ordersById.get(orderId))
          .filter(
            (order): order is LoaderOrder =>
              Boolean(
                order?.shippingCoordinates &&
                  order?.fulfillmentLocation?.coordinates,
              ),
          );
        const selectedByLocation: Map<
          string,
          { origin: { latitude: number; longitude: number }; orders: LoaderOrder[] }
        > = new Map();
        selectedOrders.forEach((order) => {
          const origin = order.fulfillmentLocation?.coordinates;
          if (!origin) return;
          const group = selectedByLocation.get(order.fulfillmentLocation.id);
          if (group) {
            group.orders.push(order);
          } else {
            selectedByLocation.set(order.fulfillmentLocation.id, {
              origin,
              orders: [order],
            });
          }
        });

        selectedByLocation.forEach((group: { origin: { latitude: number; longitude: number }; orders: LoaderOrder[] }) => {
          if (group.orders.length === 0) return;
          const ordered = group.orders.filter((order: LoaderOrder) => order.shippingCoordinates);
          if (ordered.length === 0) return;

          // Straight-line connectors for selected orders (free, no API call)
          const path = [
            { lat: group.origin.latitude, lng: group.origin.longitude },
            ...ordered.map((order: LoaderOrder) => ({
              lat: order.shippingCoordinates!.latitude,
              lng: order.shippingCoordinates!.longitude,
            })),
          ];
          const polyline = new googleMaps.Polyline({
            path,
            strokeColor: "#ff7a00",
            strokeOpacity: 0.85,
            strokeWeight: 4,
            map: mapRef.current,
          });
          selectedRouteRenderersRef.current.push(polyline);
        });
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
    selectedOrderIds,
    locationId,
    filters.locationId,
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
          emoji: string | null,
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

          if (emoji) {
            const emojiLine = document.createElement("div");
            emojiLine.className = styles.mapLabelEmoji;
            emojiLine.textContent = emoji;
            label.appendChild(emojiLine);
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
            content: buildLabel(t("map.fulfillmentLabel"), "🏬"),
          });
          manageRouteMarkersRef.current.push({ type: "advanced", marker: originMarker });
          bounds.extend({ lat: origin.latitude, lng: origin.longitude });
        }

        routePoints.forEach((order) => {
          const coords = order.shippingCoordinates!;
          const badgeColors = deriveBadgeColors(managedRoute.color);
          const dueBucket = dueBucketByOrderId.get(order.id);
          const routeOrderEmoji = !order.addressValidation.isValid
            ? "🟡"
            : dueBucket === "today"
              ? "📦"
              : dueBucket === "tomorrow"
                ? "⏰"
                : "🕒";
          const marker = new AdvancedMarkerElement({
            map: manageRouteMapInstance.current,
            position: { lat: coords.latitude, lng: coords.longitude },
            title: order.customerName ? `${order.name} \u2022 ${order.customerName}` : order.name,
            content: buildLabel(
              order.name,
              routeOrderEmoji,
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
          emoji: string | null,
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

          if (emoji) {
            const emojiLine = document.createElement("div");
            emojiLine.className = styles.mapLabelEmoji;
            emojiLine.textContent = emoji;
            label.appendChild(emojiLine);
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
            content: buildLabel(t("map.fulfillmentLabel"), "🏬"),
          });
          detailsRouteMarkersRef.current.push({ type: "advanced", marker: originMarker });
          bounds.extend({ lat: origin.latitude, lng: origin.longitude });
        }

        routePoints.forEach((order) => {
          const coords = order.shippingCoordinates!;
          const badgeColors = deriveBadgeColors(managedRoute.color);
          const dueBucket = dueBucketByOrderId.get(order.id);
          const routeOrderEmoji = !order.addressValidation.isValid
            ? "🟡"
            : dueBucket === "today"
              ? "📦"
              : dueBucket === "tomorrow"
                ? "⏰"
                : "🕒";
          const marker = new AdvancedMarkerElement({
            map: detailsRouteMapInstance.current,
            position: { lat: coords.latitude, lng: coords.longitude },
            title: order.customerName ? `${order.name} \u2022 ${order.customerName}` : order.name,
            content: buildLabel(
              order.name,
              routeOrderEmoji,
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
    if (!isShipmentRequestsModalOpen) return;
    const modal = document.getElementById("shipment-requests-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [isShipmentRequestsModalOpen]);

  useEffect(() => {
    if (!isReturnPickupsModalOpen) return;
    const modal = document.getElementById("return-pickups-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [isReturnPickupsModalOpen]);

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
          if (place?.formatted_address) {
            setAddressVerifyEdits((prev) => ({
              ...prev,
              [orderId]: place.formatted_address,
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



  // Revalidate after a pending route action (dismiss / load) succeeds
  useEffect(() => {
    const data = pendingRouteFetcher.data as
      | { ok?: boolean; intent?: string }
      | undefined;
    if (data?.ok && pendingRouteFetcher.state === "idle") {
      revalidator.revalidate();
    }
  }, [pendingRouteFetcher.data, pendingRouteFetcher.state, revalidator]);

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
    nextStartDate,
    nextDeliveryPromiseDays,
    nextPresaleTags,
  }: {
    nextLocationId?: string;
    nextStartDate?: string;
    nextDeliveryPromiseDays?: number;
    nextPresaleTags?: string[];
  }) => {
    const payload: Record<string, string> = {
      locationId: nextLocationId ?? locationId,
      startDate: nextStartDate ?? startDate,
      deliveryPromiseDays: String(nextDeliveryPromiseDays ?? deliveryPromiseDays),
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
    lastFittedLocationIdRef.current = "";
    setIsRouteManagerVisible(nextValue !== DEFAULT_LOCATION_ID);
    setLocationId(nextValue);
    setSelectedPresaleTags([]);
    setDraftPresaleTags([]);
    applyFilters({
      nextLocationId: nextValue,
      nextPresaleTags: [],
    });
  };

  const handleDeliveryPromiseChange = (event: Event) => {
    const target = event.currentTarget as { value?: string } | null;
    if (!target) return;
    const nextValue = toDeliveryPromiseDays(target.value ?? null);
    setDeliveryPromiseDays(nextValue);
    setSelectedPresaleTags([]);
    setDraftPresaleTags([]);
    applyFilters({
      nextDeliveryPromiseDays: nextValue,
      nextPresaleTags: [],
    });
  };

  const handleStartDateChange = (event: Event) => {
    const target = event.currentTarget as { value?: string } | null;
    if (!target) return;
    const nextValue = toStartDateKey(target.value ?? null);
    setStartDate(nextValue);
    setSelectedPresaleTags([]);
    setDraftPresaleTags([]);
    applyFilters({
      nextStartDate: nextValue,
      nextPresaleTags: [],
    });
  };

  const formatStartDateLabel = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    const dd = String(parsed.getDate()).padStart(2, "0");
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const yy = String(parsed.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  };

  const daysAgoText = useMemo(() => {
    const parsed = new Date(startDate);
    if (Number.isNaN(parsed.getTime())) return t("filters.daysAgo", { count: 0 });
    const now = new Date();
    const diffDays = Math.max(
      0,
      Math.floor((now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24)),
    );
    return t("filters.daysAgo", { count: diffDays });
  }, [startDate]);

  const handleManageOrdersClick = () => {
    setIsRouteManagerVisible(true);
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
    setDirtyRouteIds((prev) => {
      const next = new Set(prev);
      editableRoutes.forEach((route, index) => {
        const withoutSelected = route.orderIds.filter(
          (orderId) => !selectedSet.has(orderId),
        );
        if (index === routeIndex || withoutSelected.length !== route.orderIds.length) {
          next.add(route.id);
        }
      });
      // Also mark newly created route if applicable
      if (routeIndex >= editableRoutes.length) {
        next.add(`${locationId}-${editableRoutes.length}`);
      }
      return next;
    });
    if (assigningAllRemainingAtLocation) {
      setAssignmentSuccessMessage(
        t("routeManager.assignmentSuccess", { assigned: projectedAssignedOrdersInScope, routes: projectedRoutesWithOrdersInScope }),
      );
    } else {
      setAssignmentSuccessMessage(null);
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

  /**
   * Loads all matching orders from a pending auto-route into the planner and
   * marks the pending route as dispatched (so it disappears from the list).
   */
  const handleLoadPendingRoute = (pending: (typeof pendingRoutes)[number]) => {
    const ordersData = pending.ordersData as Array<{
      shopifyOrderId: string;
      lat: number;
      lng: number;
      address: string;
      name: string;
      phone: string;
    }>;
    const matchedOrderIds = ordersData
      .map((s) => s.shopifyOrderId)
      .filter((id) => ordersById.has(id));

    if (matchedOrderIds.length === 0) return;

    // Find the next empty route slot
    const nextEmptyIndex = editableRoutes.findIndex(
      (route) => route.orderIds.length === 0,
    );
    if (nextEmptyIndex === -1) return;
    const routeValue = `rota-${nextEmptyIndex + 1}`;

    // Optimistically assign to the editable routes
    const matchedSet = new Set(matchedOrderIds);
    setEditableRoutes((current) => {
      const withoutMatched = current.map((route) => ({
        ...route,
        orderIds: route.orderIds.filter((id) => !matchedSet.has(id)),
      }));
      return withoutMatched.map((route, index) => {
        if (index !== nextEmptyIndex) return route;
        return {
          ...route,
          orderIds: Array.from(new Set([...route.orderIds, ...matchedOrderIds])),
        };
      });
    });

    // Submit Shopify tag assignment
    const fd = new FormData();
    fd.append("route", routeValue);
    matchedOrderIds.forEach((id) => fd.append("orderIds", id));
    assignFetcher.submit(fd, { method: "post" });

    // Mark the pending route as dispatched
    const pendingFd = new FormData();
    pendingFd.append("intent", "dismiss-pending-route");
    pendingFd.append("pendingRouteId", pending.id);
    pendingRouteFetcher.submit(pendingFd, { method: "post" });
  };

  const handleDismissPendingRoute = (routeId: string) => {
    const fd = new FormData();
    fd.append("intent", "dismiss-pending-route");
    fd.append("pendingRouteId", routeId);
    pendingRouteFetcher.submit(fd, { method: "post" });
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
        if (!term) return true;
        const hay = `${row.name} ${row.customerName ?? ""} ${row.address1 ?? ""}`.toLowerCase();
        return hay.includes(term);
      })
      .sort((a, b) => {
        const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0;
        const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0;
        return tb - ta;
      });
  }, [allOrderRows, ordersFilter, ordersSearch]);

  const unassignedCountAll = useMemo(
    () => allOrderRows.filter((r) => !r.route).length,
    [allOrderRows],
  );
  const assignedCountAll = allOrderRows.length - unassignedCountAll;

  const scrollToOrdersSection = useCallback(() => {
    ordersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const areAllVisibleSelected = (rows: DisplayOrderRow[]) =>
    rows.length > 0 && rows.every((r) => selectedOrderIds.has(r.id));

  const toggleAllVisibleSelection = (rows: DisplayOrderRow[], select: boolean) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (select) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  };

  const renderDueBadge = (orderId: string) => {
    const bucket = dueBucketByOrderId.get(orderId);
    if (bucket === "today") {
      return (
        <span className={`${styles.dueBadge} ${styles.dueBadgeToday}`}>
          {t("map.legend.dueTodayEmoji")} {t("map.legend.dueToday")}
        </span>
      );
    }
    if (bucket === "tomorrow") {
      return (
        <span className={`${styles.dueBadge} ${styles.dueBadgeTomorrow}`}>
          {t("map.legend.dueTomorrowEmoji")} {t("map.legend.dueTomorrow")}
        </span>
      );
    }
    return (
      <span className={`${styles.dueBadge} ${styles.dueBadgeLater}`}>
        {t("map.legend.dueLaterEmoji")} {t("map.legend.dueLater")}
      </span>
    );
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

    if (dispatch && status) {
      return (
        <s-badge tone={getStatusBadgeTone(status)}>
          {t(`routeManager.status.${status}`)}
        </s-badge>
      );
    }

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

          <s-stack direction="inline" gap="small">
            {(["all", "unassigned", "assigned"] as const).map((key) => {
              const count =
                key === "all"
                  ? allOrderRows.length
                  : key === "unassigned"
                  ? unassignedCountAll
                  : assignedCountAll;
              const label =
                key === "all"
                  ? t("routeManager.filterAll")
                  : key === "unassigned"
                  ? t("routeManager.filterUnassigned")
                  : t("routeManager.filterAssigned");
              return (
                <button
                  key={key}
                  type="button"
                  className={`${styles.ordersFilterPill}${
                    ordersFilter === key ? ` ${styles.ordersFilterPillActive}` : ""
                  }`}
                  onClick={() => setOrdersFilter(key)}
                >
                  {label} ({count})
                </button>
              );
            })}
          </s-stack>

          {filteredOrderRows.length === 0 ? (
            <s-text color="subdued">
              {ordersSearch || ordersFilter !== "all"
                ? t("routeManager.noMatchingOrders")
                : t("routeManager.noUnassigned")}
            </s-text>
          ) : (
            <div className={styles.dueOrdersTable}>
              <div className={styles.dueOrdersHeader}>
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
                <span>{t("routeManager.table.order")}</span>
                <span>{t("routeManager.table.date")}</span>
                <span>{t("routeManager.table.customer")}</span>
                <span>{t("routeManager.table.route")}</span>
                <span>{t("routeManager.table.due")}</span>
                <span>{t("routeManager.table.address")}</span>
                <span aria-hidden="true" />
              </div>
              {filteredOrderRows.map((row) => {
                const isSelected = selectedOrderIds.has(row.id);
                const routeBadgeColors = row.route
                  ? deriveBadgeColors(row.route.color)
                  : null;
                return (
                  <div key={row.id} className={styles.dueOrdersRow}>
                    <span>
                      <s-checkbox
                        accessibilityLabel={t("routeManager.selectOrder", { name: row.name })}
                        checked={isSelected}
                        onChange={(event) => handleOrderToggle(event, row.id)}
                      />
                    </span>
                    <s-link href={row.adminOrderUrl} target="_blank">
                      {row.name}
                    </s-link>
                    <span>{formatOrderDateShort(row.processedAt)}</span>
                    <span>{formatCustomerShort(row.customerName, t("customer.guest"))}</span>
                    <span>
                      {row.route && row.routeIndex !== null && routeBadgeColors ? (
                        <span
                          className={styles.routeBadge}
                          style={
                            {
                              "--badge-bg": routeBadgeColors.bg,
                              "--badge-text": routeBadgeColors.text,
                            } as CSSProperties
                          }
                        >
                          {t("routeManager.routeLabel", {
                            number: String(row.routeIndex + 1).padStart(2, "0"),
                          })}
                        </span>
                      ) : (
                        <span className={styles.unassignedBadge}>
                          {t("routeManager.filterUnassigned")}
                        </span>
                      )}
                    </span>
                    <span>{renderDueBadge(row.id)}</span>
                    <span>{row.address1 ?? t("routeManager.noAddressLine1")}</span>
                    <span className={styles.rowActionCell}>
                      {row.route ? (
                        <s-button
                          variant="secondary"
                          tone="critical"
                          onClick={() => unassignSingleOrderFromRoute(row.id, row.route!)}
                        >
                          {t("routeManager.rowAction.removeFromRoute")}
                        </s-button>
                      ) : null}
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
    const candidates = unassignedOrders
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
    if (candidates.length === 0) {
      setAssignmentSuccessMessage(t("routeManager.noUnassigned"));
      return;
    }
    autoAssignActiveRef.current = true;
    prevUnassignedCountRef.current = unassignedOrders.length;
    autoAssignCandidateMapRef.current = new Map(
      candidates.map((c) => [c.orderId, ordersById.get(c.orderId)?.name ?? c.orderId]),
    );
    setAssignmentWarningMessage(null);
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

  const proceedWithDriverRequest = (route: PrecomputedRoute) => {
    // Submit quote directly — no address verification modal
    const formData = new FormData();
    formData.append("intent", "lalamove-quote");
    formData.append("routeId", route.id);
    formData.append("locationId", route.locationId);
    route.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
    setLalamoveStatus((current) => ({
      ...current,
      [route.id]: { message: t("driverRequest.creatingQuotation") },
    }));
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
    setLalamoveStatus((current) => ({
      ...current,
      [route.id]: { message: t("driverRequest.creatingQuotation") },
    }));
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
    setLalamoveStatus((current) => ({
      ...current,
      [route.id]: { message: t("driverRequest.creatingQuotation") },
    }));
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

  return (
    <s-page heading={t("pageHeading")} inlineSize="base">
      <s-modal
        id="manage-route-modal"
        heading={activeRouteIndex != null ? getRouteLabel(editableRoutes[activeRouteIndex] ?? { id: "", locationId: "", polyline: "", color: "", orderIds: [] }, activeRouteIndex) : ""}
      >
        <s-stack direction="block" gap="base">
          <div className={styles.manageRouteLayout}>
            <div className={styles.mapCanvasWrap}>
              <div
                ref={manageRouteMapRef}
                className={`${styles.mapCanvas} ${styles.manageRouteMapCanvas}`}
              />
            </div>
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
          <div className={styles.manageRouteLayout}>
            <div className={styles.mapCanvasWrap}>
              <div
                ref={detailsRouteMapRef}
                className={`${styles.mapCanvas} ${styles.manageRouteMapCanvas}`}
              />
            </div>
            <div className={styles.manageRouteTableRow}>
              {activeManagedRouteOrders.length > 0 ? (
                <div className={styles.dueOrdersTable}>
                  <div className={styles.dueOrdersHeader}>
                    <span />
                    <span>{t("routeManager.table.order")}</span>
                    <span>{t("routeManager.table.customer")}</span>
                    <span>{t("routeManager.table.address")}</span>
                  </div>
                  {activeManagedRouteOrders.map((order) => (
                    <div key={order.id} className={styles.dueOrdersRow}>
                      <span />
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
          </div>
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
      <s-modal id="map-style-modal" heading={t("modals.mapStyle.heading")}>
        <div className={styles.mapStyleModalContent}>
        <s-stack direction="block" gap="base">
          <div className={styles.mapStyleModalColumns}>
            <div>
              <s-text type="strong">{t("modals.mapStyle.mapStyleLabel")}</s-text>
              <s-choice-list
                label=""
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
          </div>
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="map-style-modal"
              command="--hide"
              onClick={() => {
                setDraftMapStyle(mapStyle);
                setIsMapStyleModalOpen(false);
              }}
            >
              {t("modals.mapStyle.cancel")}
            </s-button>
            <s-button
              variant="primary"
              commandFor="map-style-modal"
              command="--hide"
              onClick={confirmMapStyle}
            >
              {t("modals.mapStyle.confirm")}
            </s-button>
          </div>
        </s-stack>
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
                  <s-link href={order.adminOrderUrl} target="_blank">
                    {t("modals.addressErrors.fixAddress")}
                  </s-link>
                </s-stack>
              </s-box>
            ))
          )}
          <s-text color="subdued">
            {t("modals.addressErrors.instruction")}
          </s-text>
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="address-errors-modal"
              command="--hide"
              onClick={() => setIsAddressErrorsModalOpen(false)}
            >
              {t("modals.addressErrors.close")}
            </s-button>
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
      <s-modal id="shipment-requests-modal" heading={t("modals.shipmentRequests.heading")}>
        <s-stack direction="block" gap="base">
          {shipmentRequestOrders.length === 0 ? (
            <s-text color="subdued">{t("modals.shipmentRequests.noIssues")}</s-text>
          ) : (
            shipmentRequestOrders.map((order) => (
              <s-box
                key={order.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-text type="strong">{order.name}</s-text>
                  <s-text color="subdued">
                    {t("modals.shipmentRequests.statusPrefix", { status: order.displayFulfillmentStatus })}
                  </s-text>
                  <s-text color="subdued">
                    {t("modals.shipmentRequests.deliveryMethodPrefix", { method: order.deliveryMethodTypes.join(", ") })}
                  </s-text>
                  <s-link href={order.adminOrderUrl} target="_blank">
                    {t("modals.addressErrors.openInShopify")}
                  </s-link>
                </s-stack>
              </s-box>
            ))
          )}
          <s-text color="subdued">
            {t("modals.shipmentRequests.instruction")}
          </s-text>
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="shipment-requests-modal"
              command="--hide"
              onClick={() => setIsShipmentRequestsModalOpen(false)}
            >
              {t("modals.shipmentRequests.close")}
            </s-button>
          </div>
        </s-stack>
      </s-modal>
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
      <div
        slot="aside"
        className={styles.collapsibleSectionWrap}
      >
      <s-section heading={t("filters.fulfillmentDetails")}>
        <s-stack direction="block" gap="base">
          <div className={styles.locationSelectRow}>
            <div className={styles.locationSelectFlex}>
              <s-select
                label=""
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
            </div>
          </div>
          {!isRouteManagerVisible ? (
            <div className={styles.startDateFieldGroup}>
              <s-date-field
                label={t("filters.startDate")}
                value={startDate}
                {...{ lang: i18n.language } as Record<string, string>}
                onChange={handleStartDateChange}
              />
              <s-text color="subdued">{daysAgoText}</s-text>
            </div>
          ) : null}
          {!isRouteManagerVisible ? (
            <s-select
              label={t("filters.deliveryPromise")}
              value={`${deliveryPromiseDays}`}
              onChange={handleDeliveryPromiseChange}
            >
              <s-option value="0">{t("filters.sameDay")}</s-option>
              <s-option value="1">{t("filters.nextDay")}</s-option>
              <s-option value="2">{t("filters.dayPlus2")}</s-option>
              <s-option value="3">{t("filters.dayPlus3")}</s-option>
              <s-option value="4">{t("filters.dayPlus4")}</s-option>
            </s-select>
          ) : null}
          {!isRouteManagerVisible ? (
            <s-text-field
              label={t("filters.sameDayTimeLimit")}
              {...{ type: "time" } as Record<string, string>}
              value={`${String(sameDayHour).padStart(2, "0")}:${String(sameDayMinute).padStart(2, "0")}`}
              onChange={(e: Event) => {
                const val = (e.currentTarget as HTMLInputElement).value;
                if (!val) return;
                const [h, m] = val.split(":").map(Number);
                if (!isNaN(h)) setSameDayHour(h);
                if (!isNaN(m)) setSameDayMinute(m);
              }}
            ></s-text-field>
          ) : null}
          {locationId !== DEFAULT_LOCATION_ID && isRouteManagerVisible ? (
            <>
              {failedDeliveryCount > 0 ? (
                <div className={styles.warningLink}>
                  <s-text>{t("filters.failedDelivery", { count: failedDeliveryCount })}</s-text>
                </div>
              ) : null}
              {hasUnfulfilledPresaleOrders ? (
                <span className={styles.warningLink}>
                <s-link
                  onClick={() => setIsPresaleModalOpen(true)}
                >
                  {t("filters.presaleWarning")}
                </s-link></span>
              ) : null}
              {addressErrorOrders.length > 0 ? (
                <span style={{ cursor: "pointer" }} onClick={() => setIsAddressErrorsModalOpen(true)}>
                  <s-badge tone="warning">
                    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: 4, color: "currentColor" }}><path fillRule="evenodd" d="M11.251 3.25a1.412 1.412 0 0 0-2.502 0L1.91 16.244A1.29 1.29 0 0 0 3.062 18h13.876a1.29 1.29 0 0 0 1.153-1.756L11.25 3.25Zm-1.25 4a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75Zm1 7.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" fill="currentColor" /></svg>
                    {t("warnings.addressErrors", { count: addressErrorOrders.length })}
                  </s-badge>
                </span>
              ) : null}
              {shipmentRequestOrders.length > 0 ? (
                <span style={{ cursor: "pointer" }} onClick={() => setIsShipmentRequestsModalOpen(true)}>
                  <s-badge tone="warning">
                    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: 4, color: "currentColor" }}><path fillRule="evenodd" d="M11.251 3.25a1.412 1.412 0 0 0-2.502 0L1.91 16.244A1.29 1.29 0 0 0 3.062 18h13.876a1.29 1.29 0 0 0 1.153-1.756L11.25 3.25Zm-1.25 4a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75Zm1 7.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" fill="currentColor" /></svg>
                    {t("warnings.shipmentRequests", { count: shipmentRequestOrders.length })}
                  </s-badge>
                </span>
              ) : null}
              {pendingReturnPickups.length > 0 ? (
                <span style={{ cursor: "pointer" }} onClick={() => setIsReturnPickupsModalOpen(true)}>
                  <s-badge tone="warning">
                    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: 4, color: "currentColor" }}><path fillRule="evenodd" d="M17 8.5A8.5 8.5 0 1 1 8.5 0H9v4.1A4.5 4.5 0 1 0 13 8.5h-1.5l3-4 3 4H16a7 7 0 1 1-7-7V0a8.5 8.5 0 0 1 8 8.5Z" fill="currentColor" /></svg>
                    {t("warnings.returnPickups", { count: pendingReturnPickups.length })}
                  </s-badge>
                </span>
              ) : null}
            </>
          ) : null}
        </s-stack>
        <div
          className={`${styles.collapseChevron}${isRouteManagerVisible ? ` ${styles.collapsed}` : ""}`}
          onClick={() => setIsRouteManagerVisible((prev) => !prev)}
          role="button"
          aria-label={isRouteManagerVisible ? t("map.expand") : t("map.collapse")}
        >
          <span className={styles.chevronIcon}>›</span>
        </div>
      </s-section>
      </div>
      <div className={styles.mainBlocks}>
        <div className={isFullscreen ? styles.fullscreenOverlay : undefined}>
          <div className={isFullscreen ? styles.fullscreenContent : undefined}>
            <div
              className={
                isFullscreen ? styles.fullscreenSplitLayout : undefined
              }
            >
              <div className={isFullscreen ? styles.fullscreenMapPane : undefined}>
                <s-section>
                <div className={styles.mapCanvasWrap}>
                  <div className={styles.mapOverlayButton} role="group">
                    <s-button
                      variant="secondary"
                      accessibilityLabel={
                        isFullscreen ? t("map.collapseMap") : t("map.expandMap")
                      }
                      aria-expanded={isFullscreen}
                      onClick={() => setIsFullscreen((current) => !current)}
                    >
                      {isFullscreen ? t("map.collapse") : t("map.expand")}
                    </s-button>
                  </div>
                  <div
                    ref={mapContainerRef}
                    className={`${styles.mapCanvas} ${
                      isFullscreen ? styles.mapCanvasFullscreen : ""
                    }`}
                  />
                </div>
                {mapData.locations.length === 0 && mapData.orders.length === 0 ? (
                  <s-text color="subdued">
                    {t("map.noCoordinates")}
                  </s-text>
                ) : null}
                <div className={styles.mapMetaRow}>
                  <div className={styles.mapLegendOutside}>
                    <span className={styles.legendPill}>
                      <span className={styles.legendPillEmoji}>{t("map.legend.dueTodayEmoji")}</span>
                      <span className={styles.legendPillText}>{t("map.legend.dueToday")}</span>
                    </span>
                    <span className={styles.legendPill}>
                      <span className={styles.legendPillEmoji}>{t("map.legend.dueTomorrowEmoji")}</span>
                      <span className={styles.legendPillText}>{t("map.legend.dueTomorrow")}</span>
                    </span>
                    <span className={styles.legendPill}>
                      <span className={styles.legendPillEmoji}>{t("map.legend.dueLaterEmoji")}</span>
                      <span className={styles.legendPillText}>{t("map.legend.dueLater")}</span>
                    </span>
                    <span className={styles.legendPill}>
                      <span className={styles.legendPillEmoji}>{t("map.legend.addressErrorEmoji")}</span>
                      <span className={styles.legendPillText}>{t("map.legend.addressError")}</span>
                    </span>
                  </div>
                  <div className={styles.mapBlockFooterRight}>
                    <s-link
                      commandFor="map-style-modal"
                      command="--show"
                      onClick={() => {
                        setDraftMapStyle(mapStyle);
                        setIsMapStyleModalOpen(true);
                      }}
                    >
                      {t("map.mapStyleButton")}
                    </s-link>
                    {locationId !== DEFAULT_LOCATION_ID ? (
                      <>
                        <s-button
                          variant="secondary"
                          disabled={selectedOrderIds.size === 0 || isRoutingBusy}
                          onClick={clearSelection}
                        >
                          {t("map.clearSelection")}
                        </s-button>
                        <s-button
                          variant="primary"
                          disabled={
                            selectedOrderIds.size === 0 ||
                            routesWithOrdersCount >= ROUTE_TAGS.size ||
                            isRoutingBusy
                          }
                          loading={isRoutingBusy}
                          onClick={handleAssignToNewRoute}
                        >
                          {t("map.assignToNewRoute")}
                        </s-button>
                      </>
                    ) : null}
                  </div>
                </div>
                </s-section>
                {isFullscreen ? renderOrdersSection() : null}
              </div>
              {isFullscreen ? (
                <div className={styles.fullscreenAssignedPane}>
                  <s-section heading={t("filters.fulfillmentDetails")}>
                    <s-stack direction="block" gap="base">
                      <div className={styles.locationSelectRow}>
                        <div className={styles.locationSelectFlex}>
                          <s-select
                            label=""
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
                        </div>
                      </div>
                      {!isRouteManagerVisible ? (
                        <div className={styles.startDateFieldGroup}>
                          <s-date-field
                            label={t("filters.startDate")}
                            value={startDate}
                            {...{ lang: i18n.language } as Record<string, string>}
                            onChange={handleStartDateChange}
                          />
                          <s-text color="subdued">{daysAgoText}</s-text>
                        </div>
                      ) : null}
                      {!isRouteManagerVisible ? (
                        <s-select
                          label={t("filters.deliveryPromise")}
                          value={`${deliveryPromiseDays}`}
                          onChange={handleDeliveryPromiseChange}
                        >
                          <s-option value="0">{t("filters.sameDay")}</s-option>
                          <s-option value="1">{t("filters.nextDay")}</s-option>
                          <s-option value="2">{t("filters.dayPlus2")}</s-option>
                          <s-option value="3">{t("filters.dayPlus3")}</s-option>
                          <s-option value="4">{t("filters.dayPlus4")}</s-option>
                        </s-select>
                      ) : null}
                      {!isRouteManagerVisible ? (
                        <s-text-field
                          label={t("filters.sameDayTimeLimit")}
                          {...{ type: "time" } as Record<string, string>}
                          value={`${String(sameDayHour).padStart(2, "0")}:${String(sameDayMinute).padStart(2, "0")}`}
                          onChange={(e: Event) => {
                            const val = (e.currentTarget as HTMLInputElement).value;
                            if (!val) return;
                            const [h, m] = val.split(":").map(Number);
                            if (!isNaN(h)) setSameDayHour(h);
                            if (!isNaN(m)) setSameDayMinute(m);
                          }}
                        ></s-text-field>
                      ) : null}
                      {locationId !== DEFAULT_LOCATION_ID && isRouteManagerVisible ? (
                        <>
                          {failedDeliveryCount > 0 ? (
                            <div className={styles.warningLink}>
                              <s-text>{t("filters.failedDelivery", { count: failedDeliveryCount })}</s-text>
                            </div>
                          ) : null}
                          {hasUnfulfilledPresaleOrders ? (
                            <s-link onClick={() => setIsPresaleModalOpen(true)}>
                              {t("filters.presaleWarning")}
                            </s-link>
                          ) : null}
                          {addressErrorOrders.length > 0 ? (
                            <span style={{ cursor: "pointer" }} onClick={() => setIsAddressErrorsModalOpen(true)}>
                              <s-badge tone="warning">
                                <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: 4, color: "currentColor" }}><path fillRule="evenodd" d="M11.251 3.25a1.412 1.412 0 0 0-2.502 0L1.91 16.244A1.29 1.29 0 0 0 3.062 18h13.876a1.29 1.29 0 0 0 1.153-1.756L11.25 3.25Zm-1.25 4a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75Zm1 7.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" fill="currentColor" /></svg>
                                {t("warnings.addressErrors", { count: addressErrorOrders.length })}
                              </s-badge>
                            </span>
                          ) : null}
                          {shipmentRequestOrders.length > 0 ? (
                            <span style={{ cursor: "pointer" }} onClick={() => setIsShipmentRequestsModalOpen(true)}>
                              <s-badge tone="warning">
                                <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: 4, color: "currentColor" }}><path fillRule="evenodd" d="M11.251 3.25a1.412 1.412 0 0 0-2.502 0L1.91 16.244A1.29 1.29 0 0 0 3.062 18h13.876a1.29 1.29 0 0 0 1.153-1.756L11.25 3.25Zm-1.25 4a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75Zm1 7.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" fill="currentColor" /></svg>
                                {t("warnings.shipmentRequests", { count: shipmentRequestOrders.length })}
                              </s-badge>
                            </span>
                          ) : null}
                          {pendingReturnPickups.length > 0 ? (
                            <span style={{ cursor: "pointer" }} onClick={() => setIsReturnPickupsModalOpen(true)}>
                              <s-badge tone="warning">
                                <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: 4, color: "currentColor" }}><path fillRule="evenodd" d="M17 8.5A8.5 8.5 0 1 1 8.5 0H9v4.1A4.5 4.5 0 1 0 13 8.5h-1.5l3-4 3 4H16a7 7 0 1 1-7-7V0a8.5 8.5 0 0 1 8 8.5Z" fill="currentColor" /></svg>
                                {t("warnings.returnPickups", { count: pendingReturnPickups.length })}
                              </s-badge>
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </s-stack>
                    <div
                      className={`${styles.collapseChevron}${isRouteManagerVisible ? ` ${styles.collapsed}` : ""}`}
                      onClick={() => setIsRouteManagerVisible((prev) => !prev)}
                      role="button"
                      aria-label={isRouteManagerVisible ? t("map.expand") : t("map.collapse")}
                    >
                      <span className={styles.chevronIcon}>›</span>
                    </div>
                  </s-section>
                  {isRouteManagerVisible ? (
                  <s-section heading={t("routeManager.heading")}>
                    {/* Orders badge + actions menu */}
                    <div className={styles.routeManagerStatusRow}>
                      <s-badge>{t("filters.ordersToDeliver", { count: mapData.orders.length })}</s-badge>
                      {locationId !== DEFAULT_LOCATION_ID ? (
                        optimizeFetcher.state !== "idle" || updateRoutesFetcher.state !== "idle" ? (
                          <s-spinner size="base" accessibilityLabel={t("routeManager.autoAssign")}></s-spinner>
                        ) : (
                          <div className={styles.routeManagerActionsMenu}>
                            <s-button
                              variant="tertiary"
                              icon="menu-horizontal"
                              accessibilityLabel={t("routeManager.actions")}
                              commandFor="route-manager-actions-main"
                            ></s-button>
                            <s-menu id="route-manager-actions-main" accessibilityLabel={t("routeManager.actions")}>
                              <s-button icon="view" onClick={scrollToOrdersSection}>
                                {t("routeManager.seeOrders")}
                              </s-button>
                              {unassignedOrders.length > 0 ? (
                                <s-button
                                  icon="transfer"
                                  disabled={orders.length === 0}
                                  onClick={() => {
                                    autoAssignSelection();
                                    handleOptimizeFleet();
                                  }}
                                >
                                  {t("routeManager.autoAssign")}
                                </s-button>
                              ) : null}
                              <s-button
                                icon="refresh"
                                disabled={dirtyRouteIds.size === 0 || isRoutingBusy}
                                onClick={handleUpdateRoutes}
                              >
                                {t("routeManager.updateRoutes")}
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
                          </div>
                        )
                      ) : null}
                    </div>
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
                    {assignmentSuccessMessage ? (
                      <div className={styles.successBadgeRow}>
                        <s-badge tone="success">{assignmentSuccessMessage}</s-badge>
                      </div>
                    ) : null}
                    {assignmentWarningMessage ? (
                      <div className={styles.successBadgeRow}>
                        <s-badge tone="caution">{assignmentWarningMessage}</s-badge>
                      </div>
                    ) : null}
                    {hasAssignedRoutes ? (
                      <div className={styles.assignedRoutesSection}>
                        {locationId === DEFAULT_LOCATION_ID ? (
                          // Grouped by location when "All locations" selected
                          [...new Set(editableRoutes.filter((r) => r.orderIds.length > 0).map((r) => r.locationId))].map((locId) => (
                            <div key={locId} className={styles.locationGroup}>
                              <s-text type="strong">{locationsById.get(locId)?.name ?? locId}</s-text>
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
                          ))
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
                              const costStr = quoteTotal
                                ? t("routeManager.costLabel", { cost: `${quoteTotal.total}${quoteTotal.currency ? ` ${quoteTotal.currency}` : ""}` })
                                : t("routeManager.costPlaceholder");
                              const metaLine2 = `${distanceStr} • ${durationStr} • ${costStr}`;
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
                              const isThisRouteBusy = lalamoveBusyRouteId === route.id;
                              const isAnyRouteBusy = lalamoveBusyRouteId !== null;
                              const isOtherRouteBusy = isAnyRouteBusy && !isThisRouteBusy;
                              const notification = renderRouteNotification(route);
                              return (
                                <div
                                  key={route.id}
                                  className={`${styles.routeCard}${isOtherRouteBusy ? ` ${styles.routeCardSubdued}` : ""}`}
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
                                    {dispatchedRoutes[route.id] && !TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id]?.status ?? "") ? (
                                      <s-button
                                        variant="secondary"
                                        disabled={isOtherRouteBusy}
                                        onClick={() => openDetailsRouteModal(route, routeIndex)}
                                      >
                                        {t("routeManager.details")}
                                      </s-button>
                                    ) : (
                                      <span title={dispatchedRoutes[route.id] ? t("routeManager.clearRouteDisabledTooltip") : undefined}>
                                        <s-button
                                          variant="secondary"
                                          tone="critical"
                                          disabled={!!dispatchedRoutes[route.id] || isRoutingBusy || isOtherRouteBusy}
                                          onClick={() =>
                                            setUnassignConfirmRoute({
                                              route,
                                              index: routeIndex,
                                            })
                                          }
                                        >
                                          {t("routeManager.clearRoute")}
                                        </s-button>
                                      </span>
                                    )}
                                  </div>
                                  <div className={styles.routeCardOrderStats}>
                                    <s-stack direction="block" gap="small">
                                      <s-text type="strong">{metaLine1}</s-text>
                                      <s-text color="subdued">{metaLine2}</s-text>
                                    </s-stack>
                                  </div>
                                  {hasSelectedOrders ? (
                                    <div className={styles.assignedRoutesTopActions}>
                                      <s-button
                                        variant="primary"
                                        disabled={!canAddToRoute || isRoutingBusy || isOtherRouteBusy}
                                        onClick={() => handleAddSelectedToRoute(routeIndex)}
                                      >
                                        {t("routeManager.addToRoute")}
                                      </s-button>
                                    </div>
                                  ) : dispatchedRoutes[route.id] && !TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id]?.status ?? "") ? (
                                    <div className={styles.dispatchedBlock}>
                                      <div className={styles.deliveryStatusRow}>
                                        <s-button
                                          variant="primary"
                                          tone="critical"
                                          disabled={isOtherRouteBusy}
                                          onClick={() => setCancelConfirmRouteId(route.id)}
                                        >
                                          {t("routeManager.cancelDelivery")}
                                        </s-button>
                                      </div>
                                    </div>
                                  ) : dispatchedRoutes[route.id]?.status && TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id].status!) ? null : (
                                    <s-stack
                                      direction="inline"
                                      gap="base"
                                      justifyContent="space-between"
                                    >
                                      <div />
                                      <s-stack direction="inline" gap="base">
                                        <s-button
                                          variant="secondary"
                                          disabled={isRoutingBusy || isOtherRouteBusy}
                                          onClick={() =>
                                            openManageRouteModal(route, routeIndex)
                                          }
                                        >
                                          {t("routeManager.manage")}
                                        </s-button>
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
                                              disabled={isOtherRouteBusy}
                                              onClick={() => handlePlaceOrderFromCard(route, routeIndex)}
                                            >
                                              {t("routeManager.requestDriver")}
                                            </s-button>
                                          )
                                        ) : isThisRouteBusy ? (
                                          <s-button
                                            key="requesting-quote"
                                            variant="secondary"
                                            loading
                                            disabled
                                          >
                                            {t("routeManager.requestingQuote")}
                                          </s-button>
                                        ) : (
                                          <s-button
                                            key="request-quote"
                                            variant="secondary"
                                            disabled={!isLalamoveReady || isRoutingBusy || isOtherRouteBusy}
                                            onClick={() => handleRequestDriver(route)}
                                          >
                                            {t("routeManager.requestQuote")}
                                          </s-button>
                                        )}
                                      </s-stack>
                                    </s-stack>
                                  )}
                                  {notification ? (
                                    <div className={styles.routeCardNotifications}>
                                      {notification}
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
                  </s-section>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {!isFullscreen && isRouteManagerVisible ? (
      <s-section heading={t("routeManager.heading")} slot="aside">
          {/* Orders badge + actions menu */}
          <div className={styles.routeManagerStatusRow}>
            <s-badge>{t("filters.ordersToDeliver", { count: mapData.orders.length })}</s-badge>
            {locationId !== DEFAULT_LOCATION_ID ? (
              optimizeFetcher.state !== "idle" || updateRoutesFetcher.state !== "idle" ? (
                <s-spinner size="base" accessibilityLabel={t("routeManager.autoAssign")}></s-spinner>
              ) : (
                <div className={styles.routeManagerActionsMenu}>
                  <s-button
                    variant="tertiary"
                    icon="menu-horizontal"
                    accessibilityLabel={t("routeManager.actions")}
                    commandFor="route-manager-actions-aside"
                  ></s-button>
                  <s-menu id="route-manager-actions-aside" accessibilityLabel={t("routeManager.actions")}>
                    <s-button icon="view" onClick={scrollToOrdersSection}>
                      {t("routeManager.seeOrders")}
                    </s-button>
                    {unassignedOrders.length > 0 ? (
                      <s-button
                        icon="transfer"
                        disabled={orders.length === 0}
                        onClick={() => {
                          autoAssignSelection();
                          handleOptimizeFleet();
                        }}
                      >
                        {t("routeManager.autoAssign")}
                      </s-button>
                    ) : null}
                    <s-button
                      icon="refresh"
                      disabled={dirtyRouteIds.size === 0 || isRoutingBusy}
                      onClick={handleUpdateRoutes}
                    >
                      {t("routeManager.updateRoutes")}
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
                </div>
              )
            ) : null}
          </div>
          {/* ── Auto-assigned pending routes ── */}
          {(() => {
            const visiblePending = locationId === DEFAULT_LOCATION_ID
              ? pendingRoutes
              : pendingRoutes.filter((pr) => pr.locationId === locationId);
            if (visiblePending.length === 0) return null;
            const isDismissing = pendingRouteFetcher.state !== "idle";
            return (
              <div className={styles.pendingRoutesSection}>
                <s-text type="strong">
                  {t("routeManager.autoAssignedResult", {
                    count: visiblePending.length,
                    routeCount: visiblePending.length,
                    routeWord: visiblePending.length === 1 ? t("routeManager.routeWord") : t("routeManager.routeWordPlural"),
                  })}
                </s-text>
                <div className={styles.assignedRoutesList}>
                  {visiblePending.map((pr) => {
                    const ordersData = pr.ordersData as Array<{
                      shopifyOrderId: string;
                      address: string;
                      name: string;
                    }>;
                    const stopCount = ordersData.length;
                    const matchedCount = ordersData.filter((s) =>
                      ordersById.has(s.shopifyOrderId),
                    ).length;
                    const canLoad =
                      matchedCount > 0 &&
                      editableRoutes.some((r) => r.orderIds.length === 0);
                    const locName =
                      lalamoveConfigMap[pr.locationId]?.locationName ??
                      pr.locationId;
                    return (
                      <div key={pr.id} className={styles.routeCard}>
                      <s-box
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                      >
                        <div className={styles.routeCardHeader}>
                          <div className={styles.routeCardHeaderText}>
                            <s-badge tone="info">{t("routeManager.autoRouted")}</s-badge>
                          </div>
                        </div>
                        <div className={styles.routeCardOrderStats}>
                          <s-stack direction="block" gap="small">
                            <s-text type="strong">
                              {t("routeManager.stops", { count: stopCount })}
                              {locationId === DEFAULT_LOCATION_ID
                                ? ` · ${locName}`
                                : ""}
                            </s-text>
                            {ordersData.slice(0, 2).map((s, i) => (
                              <s-text key={i} color="subdued">
                                {s.name
                                  ? `${s.name} — `
                                  : ""}{s.address}
                              </s-text>
                            ))}
                            {stopCount > 2 ? (
                              <s-text color="subdued">
                                {t("routeManager.moreOrders", { count: stopCount - 2 })}
                              </s-text>
                            ) : null}
                            {matchedCount < stopCount ? (
                              <s-text color="subdued">
                                {t("routeManager.ordersVisible", { count: matchedCount })}
                              </s-text>
                            ) : null}
                          </s-stack>
                        </div>
                        <s-stack
                          direction="inline"
                          gap="base"
                          justifyContent="space-between"
                        >
                          <s-button
                            variant="secondary"
                            tone="critical"
                            disabled={isDismissing}
                            onClick={() => handleDismissPendingRoute(pr.id)}
                          >
                            {t("routeManager.dismiss")}
                          </s-button>
                          <s-button
                            variant="primary"
                            disabled={!canLoad || isDismissing || isRoutingBusy}
                            onClick={() => handleLoadPendingRoute(pr)}
                          >
                            {t("routeManager.loadToPlanner")}
                          </s-button>
                        </s-stack>
                      </s-box>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
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
          {assignmentSuccessMessage ? (
            <div className={styles.successBadgeRow}>
              <s-badge tone="success">{assignmentSuccessMessage}</s-badge>
            </div>
          ) : null}
          {assignmentWarningMessage ? (
            <div className={styles.successBadgeRow}>
              <s-badge tone="caution">{assignmentWarningMessage}</s-badge>
            </div>
          ) : null}
          {hasAssignedRoutes ? (
            <div className={styles.assignedRoutesSection}>
              {locationId === DEFAULT_LOCATION_ID ? (
                // Grouped by location when "All locations" selected
                [...new Set(editableRoutes.filter((r) => r.orderIds.length > 0).map((r) => r.locationId))].map((locId) => (
                  <div key={locId} className={styles.locationGroup}>
                    <s-text type="strong">{locationsById.get(locId)?.name ?? locId}</s-text>
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
                ))
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
                    const costStr = quoteTotal
                      ? t("routeManager.costLabel", { cost: `${quoteTotal.total}${quoteTotal.currency ? ` ${quoteTotal.currency}` : ""}` })
                      : t("routeManager.costPlaceholder");
                    const metaLine2 = `${distanceStr} • ${durationStr} • ${costStr}`;
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
                    const isThisRouteBusy = lalamoveBusyRouteId === route.id;
                    const isAnyRouteBusy = lalamoveBusyRouteId !== null;
                    const isOtherRouteBusy = isAnyRouteBusy && !isThisRouteBusy;
                    const notification = renderRouteNotification(route);
                    return (
                      <div
                        key={route.id}
                        className={`${styles.routeCard}${isOtherRouteBusy ? ` ${styles.routeCardSubdued}` : ""}`}
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
                          {dispatchedRoutes[route.id] && !TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id]?.status ?? "") ? (
                            <s-button
                              variant="secondary"
                              disabled={isOtherRouteBusy}
                              onClick={() => openDetailsRouteModal(route, routeIndex)}
                            >
                              {t("routeManager.details")}
                            </s-button>
                          ) : (
                            <span title={dispatchedRoutes[route.id] ? t("routeManager.clearRouteDisabledTooltip") : undefined}>
                              <s-button
                                variant="secondary"
                                tone="critical"
                                disabled={!!dispatchedRoutes[route.id] || isRoutingBusy || isOtherRouteBusy}
                                onClick={() =>
                                  setUnassignConfirmRoute({ route, index: routeIndex })
                                }
                              >
                                {t("routeManager.clearRoute")}
                              </s-button>
                            </span>
                          )}
                        </div>
                        <div className={styles.routeCardOrderStats}>
                          <s-stack direction="block" gap="small">
                            <s-text type="strong">{metaLine1}</s-text>
                            <s-text color="subdued">{metaLine2}</s-text>
                          </s-stack>
                        </div>
                        {hasSelectedOrders ? (
                          <div className={styles.assignedRoutesTopActions}>
                            <s-button
                              variant="primary"
                              disabled={!canAddToRoute || isRoutingBusy || isOtherRouteBusy}
                              onClick={() => handleAddSelectedToRoute(routeIndex)}
                            >
                              {t("routeManager.addToRoute")}
                            </s-button>
                          </div>
                        ) : dispatchedRoutes[route.id] && !TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id]?.status ?? "") ? (
                          <div className={styles.dispatchedBlock}>
                            <div className={styles.deliveryStatusRow}>
                              <s-button
                                variant="primary"
                                tone="critical"
                                disabled={isOtherRouteBusy}
                                onClick={() => setCancelConfirmRouteId(route.id)}
                              >
                                {t("routeManager.cancelDelivery")}
                              </s-button>
                            </div>
                          </div>
                        ) : dispatchedRoutes[route.id]?.status && TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id].status!) ? null : (
                          <s-stack
                            direction="inline"
                            gap="base"
                            justifyContent="space-between"
                          >
                            <div />
                            <s-stack direction="inline" gap="base">
                              <s-button
                                variant="secondary"
                                disabled={isRoutingBusy || isOtherRouteBusy}
                                onClick={() => openManageRouteModal(route, routeIndex)}
                              >
                                {t("routeManager.manage")}
                              </s-button>
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
                                    disabled={isOtherRouteBusy}
                                    onClick={() => handlePlaceOrderFromCard(route, routeIndex)}
                                  >
                                    {t("routeManager.requestDriver")}
                                  </s-button>
                                )
                              ) : isThisRouteBusy ? (
                                <s-button
                                  key="requesting-quote"
                                  variant="secondary"
                                  loading
                                  disabled
                                >
                                  {t("routeManager.requestingQuote")}
                                </s-button>
                              ) : (
                                <s-button
                                  key="request-quote"
                                  variant="secondary"
                                  disabled={!isLalamoveReady || isRoutingBusy || isOtherRouteBusy}
                                  onClick={() => handleRequestDriver(route)}
                                >
                                  {t("routeManager.requestQuote")}
                                </s-button>
                              )}
                            </s-stack>
                          </s-stack>
                        )}
                        {notification ? (
                          <div className={styles.routeCardNotifications}>
                            {notification}
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
      ) : null}

      {/* ── Auto-assign accuracy (standalone aside, always visible) ── */}
      {optimizerAccuracy && optimizerAccuracy.optimizations > 0 ? (
        <div className={styles.collapsibleSectionWrap} slot="aside">
          <s-section heading={t("routeManager.autoAssignAccuracy")}>
            {!isAccuracyCollapsed ? (() => {
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
            })() : null}
            <div
              className={`${styles.collapseChevron}${isAccuracyCollapsed ? ` ${styles.collapsed}` : ""}`}
              onClick={() => setIsAccuracyCollapsed((prev) => !prev)}
              role="button"
              aria-label="Toggle section"
            >
              <span className={styles.chevronIcon}>›</span>
            </div>
          </s-section>
        </div>
      ) : null}

      {!isFullscreen ? renderOrdersSection() : null}
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
  tags: string[];
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

const formatDeliveryStopAddress = (
  address1: string | null | undefined,
  address2: string | null | undefined,
) => {
  const line1 = (address1 ?? "").trim();
  const line2 = (address2 ?? "").trim();
  if (line1 && line2) return `${line2} , ${line1}`;
  return line2 || line1;
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
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(amount);
};

function formatOrderDateShort(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(" AM", " am")
    .replace(" PM", " pm");
  if (diffDays === 0) return `Today at ${time}`;
  if (diffDays === 1) return `Yesterday at ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
    return `${weekday} at ${time}`;
  }
  const md = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  return `${md} at ${time}`;
}

const formatCustomerShort = (name: string | null, guestFallback = "Guest") => {
  if (!name) return guestFallback;
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toLocaleUpperCase() +
        word.slice(1).toLocaleLowerCase(),
    );
  if (words.length === 0) return guestFallback;
  if (words.length === 1) return words[0]!;
  if (words.length === 2) return `${words[0]} ${words[1]}`;
  const first = words[0]!;
  const firstMiddleInitial = words[1]!.charAt(0).toLocaleUpperCase();
  const last = words[words.length - 1]!;
  return `${first} ${firstMiddleInitial} ${last}`;
};

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

const deriveBadgeColors = (hexColor: string) => {
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return {
      bg: "rgb(235, 239, 246)",
      text: "rgb(44, 58, 76)",
    };
  }
  const bg = {
    r: mix(rgb.r, 255, 0.78),
    g: mix(rgb.g, 255, 0.78),
    b: mix(rgb.b, 255, 0.78),
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
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const userLocale =
    typeof (session as any).locale === "string" && (session as any).locale.length > 0
      ? (session as any).locale
      : "pt_BR";
  const url = new URL(request.url);
  const debugEnabled = url.searchParams.get("debugLocalDelivery") === "1";
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
  const deliveryMethod = toQueryValue(
    url.searchParams.get("deliveryMethod"),
    DEFAULT_DELIVERY_METHOD,
  );
  const locationId = toQueryValue(
    url.searchParams.get("locationId"),
    DEFAULT_LOCATION_ID,
  );
  const startDateKey = toStartDateKey(url.searchParams.get("startDate"));
  const deliveryPromiseDays = toDeliveryPromiseDays(
    url.searchParams.get("deliveryPromiseDays"),
  );
  const selectedPresaleTags = toPresaleTags(url.searchParams.get("presaleTags"));

  let locationsResponse: Response;
  try {
    locationsResponse = await admin.graphql(
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
  } catch (error) {
    throw error;
  }

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

  const [lalamoveConfigRows, credentialStatus, pendingRoutes, returnPickupRequests] = await Promise.all([
    prisma.lalamoveLocationConfig.findMany({ where: { shop } }),
    hasShopCredentials(shop),
    (prisma as any).pendingDeliveryRoute.findMany({
      where: { shop, status: "open" },
      orderBy: { createdAt: "asc" as const },
    }) as Promise<Array<{
      id: string;
      locationId: string;
      routeId: string;
      status: string;
      ordersData: Array<{
        shopifyOrderId: string;
        lat: number;
        lng: number;
        address: string;
        name: string;
        phone: string;
      }>;
      createdAt: Date;
    }>>,
    prisma.returnPickupRequest.findMany({
      where: { shop, status: { in: ["pending", "quoted"] } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
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

  let localDeliveryLocationIds: Set<string> | null = null;
  try {
    const deliveryProfilesResponse = await admin.graphql(
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
    );
    const deliveryProfilesJson = await deliveryProfilesResponse.json();
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
  } catch (error) {
    console.warn("[local-delivery] loader: failed to load delivery profiles for filtering", error);
  }

  const effectiveLocationId =
    locationId !== DEFAULT_LOCATION_ID &&
    localDeliveryLocationIds &&
    !localDeliveryLocationIds.has(locationId)
      ? DEFAULT_LOCATION_ID
      : locationId;

  const orderFilters: string[] = [];
  if (deliveryMethod !== "all") {
    orderFilters.push(`delivery_method:${toDeliveryMethodType(deliveryMethod)}`);
  }
  if (effectiveLocationId !== DEFAULT_LOCATION_ID) {
    const legacyId = toLegacyLocationId(effectiveLocationId);
    orderFilters.push(`fulfillment_location_id:${legacyId}`);
  }
  // Include all fulfillment statuses, then exclude delivered/cancelled in post-filter.
  orderFilters.push("-status:cancelled");
  orderFilters.push(`created_at:>=${startDateKey}`);
  const query = orderFilters.length > 0 ? orderFilters.join(" ") : undefined;

  let ordersError: string | null = null;
  let orders: Array<{
    id: string;
    name: string;
    processedAt: string | null;
    displayFulfillmentStatus: string;
    tags: string[];
    customer: { displayName: string } | null;
    currentTotalPriceSet: {
      shopMoney: { amount: string; currencyCode: string };
    } | null;
    currentShippingPriceSet: {
      shopMoney: { amount: string; currencyCode: string };
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
  let warningOrders: Array<{
    id: string;
    name: string;
    displayFulfillmentStatus: string;
    tags: string[];
    fulfillmentOrders: {
      nodes: Array<{
        deliveryMethod: { methodType: string; presentedName: string | null };
      }>;
    };
  }> = [];

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
              tags
              customer {
                displayName
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
      hasNextPage = Boolean(payload?.pageInfo?.hasNextPage);
      after = payload?.pageInfo?.endCursor ?? null;
    }

    const warningResponse = await admin.graphql(
      `#graphql
        query OrdersWarningView($first: Int!, $query: String) {
          orders(first: $first, query: $query) {
            nodes {
              id
              name
              displayFulfillmentStatus
              tags
              fulfillmentOrders(first: 10) {
                nodes {
                  deliveryMethod {
                    methodType
                    presentedName
                  }
                }
              }
            }
          }
        }`,
      {
        variables: {
          first: 50,
          query: `tag:LOCAL created_at:>=${startDateKey}`,
        },
      },
    );

    const warningJson = await warningResponse.json();
    warningOrders = warningJson?.data?.orders?.nodes ?? [];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error loading orders.";
    if (message.includes("not approved to access the Order object")) {
      ordersError =
        "This app needs protected customer data approval to access orders. Request approval in the Shopify Partner Dashboard, then reinstall the app.";
    } else {
      throw error;
    }
  }

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

  const shipmentRequestOrders = warningOrders
    .filter((order) => {
      if (
        order.displayFulfillmentStatus === "DELIVERED" ||
        order.displayFulfillmentStatus === "CANCELLED"
      ) {
        return false;
      }
      if (!order.tags?.some((tag) => tag.toUpperCase() === "LOCAL")) return false;
      return order.fulfillmentOrders.nodes.some((fulfillment) => {
        const methodType = fulfillment.deliveryMethod?.methodType;
        return methodType != null && methodType !== "LOCAL";
      });
    })
    .map((order) => ({
      id: order.id,
      name: order.name,
      displayFulfillmentStatus: order.displayFulfillmentStatus,
      deliveryMethodTypes: order.fulfillmentOrders.nodes
        .map((fo) => fo.deliveryMethod?.methodType)
        .filter(Boolean) as string[],
      adminOrderUrl: `https://admin.shopify.com/store/${toAdminStoreHandle(shop)}/orders/${toLegacyLocationId(order.id)}`,
    }));

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
        customerName: order.customer?.displayName ?? null,
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
        tags: order.tags ?? [],
      };
    })
    .filter((order): order is LoaderOrder => Boolean(order));

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

  // Look up cached corridor polylines from DB (zero Google API calls)
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

  const precomputedRoutes: PrecomputedRoute[] = routeStats.map((r, i) => ({
    id: `${effectiveLocationId}-${i}`,
    locationId: effectiveLocationId,
    polyline: cachedPolylines.get(`${effectiveLocationId}-${i}`) ?? "",
    color: ROUTE_PRECOMPUTE_COLORS[i % ROUTE_PRECOMPUTE_COLORS.length] ?? "#2C6ECB",
    orderIds: r.orders.map((o) => o.orderId),
  }));
  const failedDeliveryCount = filteredOrders.filter((order) =>
    order.tags.includes(getFailedDeliveryTag()),
  ).length;

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
  let activeDispatchData: Array<{ routeId: string; shareLink: string | null; status: string; lalamoveOrderId: string; market: string }> = [];
  try {
    const activeRouteIds = routeStats
      .map((r, i) => ({ routeId: `${effectiveLocationId}-${i}`, hasOrders: r.orders.length > 0 }))
      .filter((r) => r.hasOrders)
      .map((r) => r.routeId);

    // Single query: all non-terminal dispatches (including COMPLETED) for active routes.
    // COMPLETED dispatches are filtered below by order overlap, not by date.
    const terminalExclude = ["cancelled", "CANCELLED", "CANCELED", "failed", "FAILED", "REJECTED", "rejected", "EXPIRED", "expired", "FULFILLED"];
    const allDispatches = activeRouteIds.length > 0
      ? await (prisma as any).lalamoveDispatchJob.findMany({
          where: {
            shop,
            routeId: { in: activeRouteIds },
            status: { notIn: terminalExclude },
          },
          select: { id: true, routeId: true, lalamoveOrderId: true, market: true, status: true },
          orderBy: { createdAt: "desc" },
        })
      : [];

    // Deduplicate: keep only the latest dispatch per routeId
    const latestByRoute = new Map<string, (typeof allDispatches)[0]>();
    for (const d of allDispatches) {
      if (!latestByRoute.has(d.routeId)) latestByRoute.set(d.routeId, d);
    }

    // Order-overlap filter for COMPLETED dispatches.
    // Active dispatches (driver en route) always show. COMPLETED dispatches only
    // show if their orders overlap with the current route's orders — this prevents
    // stale dispatches from previous days (whose route ID was reused) from blocking.
    const deduped = Array.from(latestByRoute.values());
    const completedIds = deduped
      .filter((d: any) => ["COMPLETED", "completed"].includes(d.status))
      .map((d: any) => d.id as string);

    let overlappingCompleted = new Set<string>();
    if (completedIds.length > 0) {
      const currentRouteOrderIds = new Set<string>();
      routeStats.forEach((r) => r.orders.forEach((o) => currentRouteOrderIds.add(o.orderId)));

      const orderMaps = await (prisma as any).lalamoveDispatchOrderMap.findMany({
        where: { shop, dispatchJobId: { in: completedIds } },
        select: { dispatchJobId: true, shopifyOrderId: true },
      });
      for (const m of orderMaps) {
        if (currentRouteOrderIds.has(m.shopifyOrderId)) {
          overlappingCompleted.add(m.dispatchJobId);
        }
      }
    }

    const activeDispatches = deduped.filter((d: any) =>
      ["COMPLETED", "completed"].includes(d.status) ? overlappingCompleted.has(d.id) : true,
    );

    // Reconcile with Lalamove API — check current status and capture shareLink
    const dispatchDetails = new Map<string, { shareLink: string | null; apiStatus: string | null }>();
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (credentials && activeDispatches.length > 0) {
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

    activeDispatchData = activeDispatches.map((d: any) => ({
      routeId: d.routeId as string,
      shareLink: dispatchDetails.get(d.routeId)?.shareLink ?? null,
      status: mapLalamoveStatusToInternal(dispatchDetails.get(d.routeId)?.apiStatus ?? d.status),
      lalamoveOrderId: d.lalamoveOrderId as string,
      market: (d.market ?? "BR_SAO") as string,
    }));
  } catch {
    // Silently ignore if table is unavailable
  }

  // ── Optimizer accuracy stats (last 30 days) ──
  let optimizerAccuracy: { optimizations: number; modified: number; totalDispatched: number; totalReassigned: number } | null = null;
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
      optimizerAccuracy = {
        optimizations: uniqueSnapshots.size,
        modified: modifiedSnapshots.size,
        totalDispatched: corrections.reduce((sum: number, c: any) => sum + (c.ordersDispatched ?? 0), 0),
        totalReassigned: corrections.reduce((sum: number, c: any) => sum + (c.ordersReassigned ?? 0), 0),
      };
    }
  } catch {
    // Non-blocking
  }

  return {
    orders: filteredOrders,
    locations: localDeliveryLocations,
    filters: {
      deliveryMethod,
      locationId: effectiveLocationId,
      startDate: startDateKey,
      deliveryPromiseDays,
      selectedPresaleTags,
    },
    ordersError,
    mapsApiKey,
    mapsMapId: process.env.GOOGLE_MAPS_MAP_ID?.trim() || "",
    shipmentRequestOrders,
    routeStats,
    precomputedRoutes,
    lalamoveConfigs,
    credentialStatus,
    pendingRoutes,
    returnPickupRequests,
    shop,
    userLocale,
    debugLocalDelivery,
    availablePresaleTags,
    hasUnfulfilledPresaleOrders: availablePresaleTags.length > 0,
    failedDeliveryCount,
    activeDispatchData,
    optimizerAccuracy,
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

    // Run VRP optimizer (Clarke-Wright savings + Google Distance Matrix)
    const { optimizeByVRP } = await import(
      "../services/carrier-quotation-optimizer.server"
    );
    const primaryVehicle =
      carrierConfig?.lalamovePreferredServiceType ||
      llmConfig.preferredServiceType ||
      "LALAGO";
    const secondaryVehicle =
      carrierConfig?.lalamoveSecondaryServiceType || undefined;
    const maxPerRoute = carrierConfig?.lalamoveMaxOrdersPerRoute ?? 10;

    // Resolve configured special requests for this shop+market+city.
    const resolvedSpecialRequests = await resolveConfiguredSpecialRequests(
      shop,
      llmConfig,
      credentials,
    );

    const result = await optimizeByVRP(
      validOrders,
      llmConfig,
      credentials,
      mapsApiKey,
      shop,
      ROUTE_TAG_DEFINITIONS.length,
      { primary: primaryVehicle, secondary: secondaryVehicle },
      maxPerRoute,
      resolvedSpecialRequests,
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    // Apply order tags in batches to avoid Shopify rate limits / gateway timeouts
    const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);
    const allOptimizedIds = result.routes.flatMap((r) => r.orderIds);
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
    const tagAssignments = result.routes.flatMap((route) => {
      const tag = ROUTE_TAG_DEFINITIONS[route.routeIndex]?.tag;
      return tag ? route.orderIds.map((orderId) => ({ orderId, tag })) : [];
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

    // ── Persist optimization snapshot for correction tracking ──
    try {
      const proposedRoutes = result.routes.map((r) => ({
        routeIndex: r.routeIndex,
        orderIds: r.orderIds,
        serviceType: r.serviceType,
        costSubunits: r.costSubunits,
      }));
      const orderCoordinates = validOrders.map((o) => ({
        orderId: o.orderId,
        lat: o.shippingCoordinates.latitude,
        lng: o.shippingCoordinates.longitude,
      }));
      await (prisma as any).routeOptimizationSnapshot.create({
        data: {
          shop,
          locationId: primaryLocationId,
          proposedRoutes,
          orderCoordinates,
          orderCount: validOrders.length,
          routeCount: result.routes.length,
        },
      });
      console.info(`[local-delivery] optimize-fleet snapshot saved shop=${shop} routes=${result.routes.length} orders=${validOrders.length}`);
    } catch (snapshotErr) {
      console.warn("[local-delivery] optimize-fleet snapshot FAILED", snapshotErr);
    }

    console.info(`[local-delivery] optimize-fleet OK routes=${result.summary.routeCount} orders=${result.summary.totalOrders}`);
    return {
      ok: true,
      optimizedRoutes: result.routes.map((r) => ({
        routeIndex: r.routeIndex,
        locationId: r.locationId,
        orderIds: r.orderIds,
        polyline: r.corridorPolyline,
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
      })),
      summary: {
        routeCount: result.summary.routeCount,
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        totalOrders: result.summary.totalOrders,
        costTotal: result.summary.totalCost,
        costCurrency: result.summary.costCurrency,
        totalLalamoveCost: result.summary.totalLalamoveCost,
        totalWaitSurcharge: result.summary.totalWaitSurcharge,
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
      console.info(`[local-delivery] update-routes computing polyline route=${route.routeId} orders=${routeOrders.length}`);

      try {
        const polylineResult = await computeRoutePolyline(
          mapsApiKey,
          locationCoords,
          routeOrders,
        );
        // Cache the new polyline
        try {
          const orderIdsKey = [...route.orderIds].sort().join("|");
          await prisma.routePolylineCache.upsert({
            where: { shop_locationId_orderIdsKey: { shop, locationId: route.locationId, orderIdsKey } },
            update: { encodedPolyline: polylineResult.polyline },
            create: { shop, locationId: route.locationId, orderIdsKey, encodedPolyline: polylineResult.polyline },
          });
        } catch (cacheErr) {
          console.warn("[local-delivery] update-routes cache FAILED", cacheErr instanceof Error ? cacheErr.message : String(cacheErr));
        }

        results.push({
          routeId: route.routeId,
          routeIndex: route.routeIndex,
          polyline: polylineResult.polyline,
          totalDistanceMeters: polylineResult.distanceMeters,
          totalDurationSeconds: polylineResult.durationSeconds,
          orderedIds: polylineResult.ordered.map((o) => o.orderId),
        });
        console.info(`[local-delivery] update-routes polyline OK route=${route.routeId} distance=${polylineResult.distanceMeters}m`);
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
      }
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
      await removeTags(admin, orderId, ["ld_address_review"]);
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
            status: { notIn: ["cancelled", "CANCELLED", "CANCELED", "failed", "FAILED", "COMPLETED", "completed", "REJECTED", "rejected", "EXPIRED", "expired"] },
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
      if (error instanceof LalamoveApiError && error.payload?.data?.orderId) {
        const recoveredOrderId = error.payload.data.orderId as string;
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

    // B6: Add ld_rota-NN tag to dispatched orders to confirm route assignment
    const routeTag = formData.get("routeTag");
    if (typeof routeTag === "string" && /^ld_rota-\d+$/.test(routeTag)) {
      await batchProcess(assignmentOrderIds, GQL_BATCH_SIZE, (id) =>
        admin.graphql(
          `#graphql
            mutation AddOrderTag($id: ID!, $tags: [String!]!) {
              tagsAdd(id: $id, tags: $tags) {
                userErrors { message }
              }
            }`,
          { variables: { id, tags: [routeTag] } },
        ),
      );
    }

    console.info(`[local-delivery] lalamove-place-order OK shop=${shop} route=${routeId} orderId=${placeResponse.orderId} orders=${assignmentOrderIds.length}`);
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

  if (intent === "lalamove-check-escalation") {
    console.info(`[local-delivery] lalamove-check-escalation shop=${shop}`);
    const results = await checkAndApplyEscalations(shop, admin);
    console.info(`[local-delivery] lalamove-check-escalation OK shop=${shop} results=${results.length}`);
    return { ok: true, intent: "lalamove-check-escalation", results };
  }

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

  if (intent === "dismiss-pending-route") {
    const pendingRouteId = String(formData.get("pendingRouteId") ?? "").trim();
    if (!pendingRouteId) {
      return { ok: false, error: "Pending route ID not provided." };
    }
    console.info(`[local-delivery] dismiss-pending-route shop=${shop} id=${pendingRouteId}`);
    await (prisma as any).pendingDeliveryRoute.updateMany({
      where: { id: pendingRouteId, shop },
      data: { status: "cancelled" },
    });
    return { ok: true, intent: "dismiss-pending-route" };
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
    const locationId = formData.get("locationId");
    const filterByLocation =
      typeof locationId === "string" && locationId !== "" && locationId !== "all";

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

    // Only compact (shift subsequent routes up) if the unassigned route is now empty.
    // Query Shopify for remaining orders with this route tag.
    const K = ROUTE_TAG_DEFINITIONS.findIndex((d) => d.tag === routeTag);
    if (K >= 0) {
      const remainingResponse = await admin.graphql(
        `#graphql
          query RemainingOrdersInRoute($first: Int!, $query: String) {
            orders(first: $first, query: $query) {
              nodes { id }
            }
          }`,
        { variables: { first: 1, query: `tag:${routeTag}` } },
      );
      const remainingJson = await remainingResponse.json();
      const remainingCount = (remainingJson.data?.orders?.nodes ?? []).length;
      // Skip compaction if route still has orders
      if (remainingCount > 0) {
        return { ok: true };
      }
      for (let i = K + 1; i < ROUTE_TAG_DEFINITIONS.length; i += 1) {
        const tagFrom = ROUTE_TAG_DEFINITIONS[i]!.tag;
        const tagTo = ROUTE_TAG_DEFINITIONS[i - 1]!.tag;
        const ordersByTagResponse = await admin.graphql(
          `#graphql
            query OrdersByRouteTag($first: Int!, $query: String) {
              orders(first: $first, query: $query) {
                nodes {
                  id
                  fulfillmentOrders(first: 10, displayable: true) {
                    nodes {
                      assignedLocation {
                        location {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }`,
          {
            variables: {
              first: 250,
              query: `tag:${tagFrom}`,
            },
          },
        );
        const ordersByTagJson = await ordersByTagResponse.json();
        const orderNodes = (ordersByTagJson.data?.orders?.nodes ?? []) as Array<{
          id: string;
          fulfillmentOrders: {
            nodes: Array<{
              assignedLocation?: {
                location?: { id: string } | null;
              } | null;
            }>;
          };
        }>;
        const normalizeLoc = (locId: string | null | undefined) =>
          locId ? (locId.startsWith("gid://") ? locId.split("/").pop() ?? locId : locId) : "";

        const orderIdsToShift = orderNodes.filter((order) => {
          if (!filterByLocation || typeof locationId !== "string") return true;
          const orderLocId = order.fulfillmentOrders?.nodes?.[0]?.assignedLocation?.location?.id;
          return normalizeLoc(orderLocId) === normalizeLoc(locationId);
        }).map((o) => o.id);

        for (const orderId of orderIdsToShift) {
          await admin.graphql(
            `#graphql
              mutation AddOrderTag($id: ID!, $tags: [String!]!) {
                tagsAdd(id: $id, tags: $tags) {
                  node { id }
                  userErrors { field message }
                }
              }`,
            { variables: { id: orderId, tags: [tagTo] } },
          );
          await admin.graphql(
            `#graphql
              mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
                tagsRemove(id: $id, tags: $tags) {
                  node { id }
                  userErrors { field message }
                }
              }`,
            { variables: { id: orderId, tags: [tagFrom] } },
          );
        }
      }
    }
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
