import { useEffect, useMemo, useRef, useState } from "react";
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
  placeLalamoveOrder,
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
import {
  computeRouteMetrics,
  optimizeFleetRoutesDispatcher,
  type OptimizerOrderInput,
  type RoutingLogic,
} from "../services/google-routes-optimizer.server";
import { MAX_ORDERS_PER_ROUTE } from "../services/google-routes-shared.server";
import {
  applyLalamoveDeliveryState,
  getFailedDeliveryTag,
} from "../services/lalamove-sync.server";
import { runCarrierQuotationForOrderId } from "../services/auto-routing.server";
import {
  checkAndApplyEscalations,
  type EscalationResult,
} from "../services/lalamove-escalation.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import styles from "./app.local-delivery/styles.module.css";

const DEFAULT_DELIVERY_METHOD = "local";
const DEFAULT_LOCATION_ID = "all";
const DEFAULT_START_DATE_DAYS = 30;
const DEFAULT_DELIVERY_PROMISE_DAYS = 1;
const MAP_STYLE_STORAGE_KEY = "omnify.localDelivery.mapStyle";
const ROUTING_LOGIC_STORAGE_KEY = "omnify.localDelivery.routingLogic";

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

const TERMINAL_DISPATCH_STATUSES = new Set(["failed", "rejected", "expired"]);

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
  } =
    useLoaderData<typeof loader>();
  const { t } = useTranslation("local-delivery");
  const lalamoveFetcher = useFetcher<typeof action>();
  const lalamoveSettingsFetcher = useFetcher<typeof action>();
  const optimizeFetcher = useFetcher<typeof action>();
  const assignFetcher = useFetcher();
  const unassignFetcher = useFetcher();
  const refreshStatsFetcher = useFetcher<typeof action>();
  const pendingRouteFetcher = useFetcher<typeof action>();
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
  const [isMapStyleModalOpen, setIsMapStyleModalOpen] = useState(false);
  const [editableRoutes, setEditableRoutes] = useState<PrecomputedRoute[]>(() =>
    precomputedRoutes.map((route) => ({ ...route, orderIds: [] })),
  );
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [activeRouteIndex, setActiveRouteIndex] = useState<number | null>(null);
  const [removeFromRouteOrderIds, setRemoveFromRouteOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeTab, setActiveTab] = useState<"routes" | "settings">("routes");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRouteManagerVisible, setIsRouteManagerVisible] = useState(false);
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
  const [routingLogic, setRoutingLogic] = useState<RoutingLogic>("distance");
  const [draftRoutingLogic, setDraftRoutingLogic] = useState<RoutingLogic>("distance");
  const [unassignConfirmRoute, setUnassignConfirmRoute] = useState<{
    route: PrecomputedRoute;
    index: number;
  } | null>(null);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [pendingRouteOptimize, setPendingRouteOptimize] = useState<{
    routeIndex: number;
    orderIds: string[];
  } | null>(null);
  const [routeOptimizeQueue, setRouteOptimizeQueue] = useState<Array<{
    routeIndex: number;
    orderIds: string[];
  }>>([]);
  const [autoAssignLocked, setAutoAssignLocked] = useState(false);
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
    const storedLogic = window.localStorage.getItem(ROUTING_LOGIC_STORAGE_KEY);
    if (
      storedLogic === "distance" ||
      storedLogic === "topological" ||
      storedLogic === "inward" ||
      storedLogic === "carrier-quotation"
    ) {
      setRoutingLogic(storedLogic);
      setDraftRoutingLogic(storedLogic);
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
    setEditableRoutes((current) => {
      const next = ROUTE_TAG_DEFINITIONS.map((_, i) => {
        const fromServer = routeStats[i];
        const orderIds =
          fromServer?.orders?.map((o) => o.orderId).filter(Boolean) ?? [];
        const prev = current[i];
        const sameOrderIds =
          prev &&
          prev.orderIds.length === orderIds.length &&
          prev.orderIds.every((id, j) => id === orderIds[j]);
        return {
          id: `${locationId}-${i}`,
          locationId,
          polyline: sameOrderIds && prev?.polyline ? prev.polyline : "",
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
  }, [locationId, routeStats]);

  useEffect(() => {
    const data = lalamoveFetcher.data;
    if (!data) return;
    if ("error" in data) {
      const routeId = (data as any).routeId as string | undefined;
      const errorDetails = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
      if (routeId) {
        const existingTimeout = lalamoveStatusTimeoutsRef.current[routeId];
        if (existingTimeout) window.clearTimeout(existingTimeout);
        setLalamoveStatus((current) => ({
          ...current,
          [routeId]: {
            message: t("driverRequest.requestFailed"),
            tone: "critical",
            errorDetails,
          },
        }));
      }
      setDriverErrorModal({
        routeId: routeId ?? "",
        message: t("driverRequest.requestFailed"),
        errorDetails,
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
        if (next[d.routeId]) {
          next[d.routeId] = {
            ...next[d.routeId],
            status: d.status ?? next[d.routeId].status,
            shareLink: d.shareLink ?? next[d.routeId].shareLink,
          };
        }
      }
      return next;
    });
  }, [activeDispatchData]);

  // Watch return pickup fetcher results
  useEffect(() => {
    const data = returnPickupFetcher.data as Record<string, unknown> | undefined;
    if (!data) return;
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
    setEditableRoutes((current) =>
      current.map((route, index) => {
        const optimized = optimizedRoutes.find((item) => item.routeIndex === index);
        if (!optimized) {
          return { ...route, orderIds: [], polyline: "" };
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
    if (optimizeFetcher.data.summary) {
      setOptimizerSummary(optimizeFetcher.data.summary);
    }
    // B4: Queue each updated route with ≥2 orders for Google Maps waypoint optimization
    const routesToOptimize = optimizedRoutes.filter((r) => r.orderIds.length >= 2);
    if (routesToOptimize.length > 0) {
      const [first, ...rest] = routesToOptimize.map((r) => ({ routeIndex: r.routeIndex, orderIds: r.orderIds }));
      setPendingRouteOptimize(first!);
      if (rest.length > 0) setRouteOptimizeQueue(rest);
    }
    setAssignmentSuccessMessage(
      `Optimization applied: ${optimizeFetcher.data.summary?.routeCount ?? 0} routes`,
    );
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
    const routesWithOrders = optimizedRoutes.filter((r) => r.orderIds.length > 0);
    if (routesWithOrders.length > 0) {
      const routesPayload = JSON.stringify(
        routesWithOrders.map((r) => ({
          routeId: `${r.locationId}-${r.routeIndex}`,
          locationId: r.locationId,
          orderIds: r.orderIds,
        })),
      );
      const fd = new FormData();
      fd.append("intent", "refresh-route-stats");
      fd.append("routesPayload", routesPayload);
      refreshStatsFetcher.submit(fd, { method: "post" });
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
    const data = refreshStatsFetcher.data;
    if (!data || !("routeStats" in data) || !Array.isArray(data.routeStats)) return;
    const stats = data.routeStats as Array<{
      routeId: string;
      totalDistanceMeters: number;
      totalDurationSeconds: number;
      costTotal?: string;
      costCurrency?: string;
    }>;
    const byRouteId = new Map(stats.map((s) => [s.routeId, s]));
    setEditableRoutes((current) =>
      current.map((route) => {
        const s = byRouteId.get(route.id);
        if (!s) return route;
        return {
          ...route,
          totalDistanceMeters: s.totalDistanceMeters,
          totalDurationSeconds: s.totalDurationSeconds,
        };
      }),
    );
    setRouteQuoteTotals((prev) => {
      const next = { ...prev };
      stats.forEach((s) => {
        if (s.costTotal != null) {
          next[s.routeId] = { total: s.costTotal, currency: s.costCurrency };
        }
      });
      return next;
    });
  }, [refreshStatsFetcher.data]);

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
      // All assigned — lock the button
      autoAssignActiveRef.current = false;
      setAutoAssignLocked(true);
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
      // 1 PM cutoff: orders placed before 13:00 count from that day's cycle;
      // at/after 13:00 they count from the next day's cycle.
      const cycleDayIndex = orderHour < 13 ? orderDayIndex : orderDayIndex + 1;
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
  }, [orders, deliveryPromiseDays, browserTimeZone]);

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
    () => unassignedOrders.filter((order) => !order.addressValidation.isValid),
    [unassignedOrders],
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
    if (!pendingRouteOptimize) return;
    const { routeIndex, orderIds } = pendingRouteOptimize;
    const googleMaps = typeof window !== "undefined" ? window.google?.maps : null;
    if (!googleMaps) {
      setPendingRouteOptimize(null);
      return;
    }
    const route = editableRoutes[routeIndex];
    if (!route || orderIds.length < 2) {
      setPendingRouteOptimize(null);
      return;
    }
    const routeOrders = orderIds
      .map((id) => ordersById.get(id))
      .filter(
        (order): order is LoaderOrder =>
          Boolean(order?.shippingCoordinates),
      );
    if (routeOrders.length < 2) {
      setPendingRouteOptimize(null);
      return;
    }
    const origin =
      locationsById.get(route.locationId)?.coordinates ??
      routeOrders[0]?.fulfillmentLocation?.coordinates;
    if (!origin) {
      setPendingRouteOptimize(null);
      return;
    }
    const destinationOrder = routeOrders[routeOrders.length - 1]!;
    const waypointOrders = routeOrders.slice(0, -1);
    const waypointOrderIds = orderIds.slice(0, -1);
    const destinationOrderId = orderIds[orderIds.length - 1]!;

    const directionsService = new googleMaps.DirectionsService();
    directionsService.route(
      {
        origin: { lat: origin.latitude, lng: origin.longitude },
        destination: {
          lat: destinationOrder.shippingCoordinates!.latitude,
          lng: destinationOrder.shippingCoordinates!.longitude,
        },
        waypoints: waypointOrders.map((order) => ({
          location: {
            lat: order.shippingCoordinates!.latitude,
            lng: order.shippingCoordinates!.longitude,
          },
          stopover: true,
        })),
        optimizeWaypoints: true,
        travelMode: googleMaps.TravelMode.DRIVING,
      },
      (result: unknown, status: unknown) => {
        setPendingRouteOptimize(null);
        setRouteOptimizeQueue((q) => {
          if (q.length > 0) {
            const [next, ...rest] = q;
            setPendingRouteOptimize(next!);
            return rest;
          }
          return q;
        });
        if (status !== googleMaps.DirectionsStatus.OK) return;
        const res = result as { routes?: Array<{ waypoint_order?: number[] }> };
        if (!res?.routes?.[0]?.waypoint_order) return;
        const waypointOrder = res.routes[0].waypoint_order;
        if (waypointOrder.length !== waypointOrderIds.length) return;
        const optimizedOrderIds = [
          ...waypointOrder.map((i: number) => waypointOrderIds[i]!),
          destinationOrderId,
        ];
        setEditableRoutes((current) =>
          current.map((r, i) =>
            i === routeIndex ? { ...r, orderIds: optimizedOrderIds } : r,
          ),
        );
      },
    );
  }, [
    pendingRouteOptimize,
    editableRoutes,
    ordersById,
    locationsById,
  ]);

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

          const advancedMarker = new AdvancedMarkerElement({
            map: mapRef.current!,
            position,
            title: point.name,
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
            advancedMarker.addListener("click", () => {
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
          const directionsService = new googleMaps.DirectionsService();
          editableRoutes.forEach((route) => {
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
            if (routeOrderPoints.length === 0) return;
            const origin = route.orderIds
              .map((orderId) => ordersById.get(orderId))
              .find((order) => order?.fulfillmentLocation?.coordinates)
              ?.fulfillmentLocation?.coordinates;
            if (!origin) return;

            const renderer = new googleMaps.DirectionsRenderer({
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: {
                strokeColor: route.color,
                strokeOpacity: 0.85,
                strokeWeight: 4,
              },
            });
            renderer.setMap(mapRef.current);
            assignedRouteRenderersRef.current.push(renderer);

            directionsService.route(
              {
                origin: { lat: origin.latitude, lng: origin.longitude },
                destination: {
                  lat: routeOrderPoints[routeOrderPoints.length - 1]!.coordinates
                    .latitude,
                  lng: routeOrderPoints[routeOrderPoints.length - 1]!.coordinates
                    .longitude,
                },
                waypoints: routeOrderPoints.slice(0, -1).map((point) => ({
                  location: {
                    lat: point.coordinates.latitude,
                    lng: point.coordinates.longitude,
                  },
                  stopover: true,
                })),
                optimizeWaypoints: true,
                travelMode: googleMaps.TravelMode.DRIVING,
              },
              (result: any, status: any) => {
                if (status === googleMaps.DirectionsStatus.OK) {
                  renderer.setDirections(result);
                } else {
                  renderer.setDirections({ routes: [] });
                }
              },
            );
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

        const selectedDirectionsService = new googleMaps.DirectionsService();
        selectedByLocation.forEach((group: { origin: { latitude: number; longitude: number }; orders: LoaderOrder[] }) => {
          if (group.orders.length === 0) return;
          const ordered = group.orders.filter((order: LoaderOrder) => order.shippingCoordinates);
          if (ordered.length === 0) return;
          const destinationOrder = ordered[ordered.length - 1]!;
          const intermediates = ordered.slice(0, -1);
          const renderer = new googleMaps.DirectionsRenderer({
            suppressMarkers: true,
            preserveViewport: true,
            polylineOptions: {
              strokeColor: "#ff7a00",
              strokeOpacity: 0.85,
              strokeWeight: 4,
            },
          });
          renderer.setMap(mapRef.current);
          selectedRouteRenderersRef.current.push(renderer);
          selectedDirectionsService.route(
            {
              origin: {
                lat: group.origin.latitude,
                lng: group.origin.longitude,
              },
              destination: {
                lat: destinationOrder.shippingCoordinates!.latitude,
                lng: destinationOrder.shippingCoordinates!.longitude,
              },
              waypoints: intermediates.map((order: LoaderOrder) => ({
                location: {
                  lat: order.shippingCoordinates!.latitude,
                  lng: order.shippingCoordinates!.longitude,
                },
                stopover: true,
              })),
              optimizeWaypoints: true,
              travelMode: googleMaps.TravelMode.DRIVING,
            },
            (result: any, status: any) => {
              if (status === googleMaps.DirectionsStatus.OK) {
                renderer.setDirections(result);
              } else {
                renderer.setDirections({ routes: [] });
              }
            },
          );
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
    precomputedRoutes,
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
            title: order.name,
            content: buildLabel(
              order.name,
              routeOrderEmoji,
              { backgroundColor: badgeColors.bg, borderColor: "#111111" },
            ),
          });
          manageRouteMarkersRef.current.push({ type: "advanced", marker });
          bounds.extend({ lat: coords.latitude, lng: coords.longitude });
        });

        const directionsService = new googleMaps.DirectionsService();
        if (origin && routePoints.length > 0) {
          const routeRenderer = new googleMaps.DirectionsRenderer({
            suppressMarkers: true,
            preserveViewport: true,
            polylineOptions: {
              strokeColor: managedRoute.color,
              strokeOpacity: 0.85,
              strokeWeight: 4,
            },
          });
          routeRenderer.setMap(manageRouteMapInstance.current);
          manageRouteRenderersRef.current.push(routeRenderer);
          directionsService.route(
            {
              origin: { lat: origin.latitude, lng: origin.longitude },
              destination: {
                lat: routePoints[routePoints.length - 1]!.shippingCoordinates!.latitude,
                lng: routePoints[routePoints.length - 1]!.shippingCoordinates!.longitude,
              },
              waypoints: routePoints.slice(0, -1).map((order) => ({
                location: {
                  lat: order.shippingCoordinates!.latitude,
                  lng: order.shippingCoordinates!.longitude,
                },
                stopover: true,
              })),
              optimizeWaypoints: true,
              travelMode: googleMaps.TravelMode.DRIVING,
            },
            (result: any, status: any) => {
              if (status === googleMaps.DirectionsStatus.OK) {
                routeRenderer.setDirections(result);
              } else {
                routeRenderer.setDirections({ routes: [] });
              }
            },
          );
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

  const handleUnassignRoute = (route: (typeof routeStats)[number]) => {
    if (route.orders.length === 0) return;
    const orderIds = route.orders.map((order) => order.orderId);
    const formData = new FormData();
    formData.append("intent", "unassign");
    formData.append("routeTag", route.tag);
    orderIds.forEach((orderId) => formData.append("orderIds", orderId));
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      orderIds.forEach((orderId) => next.delete(orderId));
      return next;
    });
    unassignFetcher.submit(formData, { method: "post" });
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
          [routeId]: { message: t("routeManager.deliveryCancelled"), tone: "success" },
        }));
        setDispatchedRoutes((prev) => {
          const next = { ...prev };
          delete next[routeId];
          return next;
        });
      } else {
        setLalamoveStatus((current) => ({
          ...current,
          [routeId]: { message: data.error ?? t("driverRequest.cancelFailed"), tone: "critical" },
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
        i === routeIndex ? { ...r, orderIds: [] } : r,
      ),
    );
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
    if (assigningAllRemainingAtLocation) {
      setAssignmentSuccessMessage(
        t("routeManager.assignmentSuccess", { assigned: projectedAssignedOrdersInScope, routes: projectedRoutesWithOrdersInScope }),
      );
    } else {
      setAssignmentSuccessMessage(null);
    }
    const toOptimize = pendingOptimize as
      | { routeIndex: number; orderIds: string[] }
      | null;
    if (toOptimize && toOptimize.orderIds.length >= 2) {
      setPendingRouteOptimize(toOptimize);
    }
    clearSelection();
    const formData = new FormData();
    formData.append("route", routeValue);
    selectedOrderIds.forEach((orderId) =>
      formData.append("orderIds", orderId),
    );
    assignFetcher.submit(formData, { method: "post" });
    const routesToRefresh = projectedRoutes.filter((r) => r.orderIds.length > 0);
    if (routesToRefresh.length > 0) {
      const routesPayload = JSON.stringify(
        routesToRefresh.map((r) => ({
          routeId: r.id,
          locationId: r.locationId,
          orderIds: r.orderIds,
        })),
      );
      const refreshFd = new FormData();
      refreshFd.append("intent", "refresh-route-stats");
      refreshFd.append("routesPayload", routesPayload);
      refreshStatsFetcher.submit(refreshFd, { method: "post" });
    }
  };

  const routesWithOrdersCount = useMemo(
    () =>
      editableRoutes.filter((route) => route.orderIds.length > 0).length,
    [editableRoutes],
  );

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
    setRoutingLogic(draftRoutingLogic);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, draftMapStyle);
      window.localStorage.setItem(ROUTING_LOGIC_STORAGE_KEY, draftRoutingLogic);
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
    unassignFetcher.submit(formData, { method: "post" });
  };

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
    formData.append("routingLogic", routingLogic);
    optimizeFetcher.submit(formData, { method: "post" });
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
    formData.append("routingLogic", routingLogic);
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
  };

  const toggleAllReturnSelection = (checked: boolean) => {
    if (checked) {
      setSelectedReturnIds(new Set(pendingReturnPickups.map((r) => r.id)));
    } else {
      setSelectedReturnIds(new Set());
    }
    setReturnQuotePreview(null);
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
    setRemoveFromRouteOrderIds(new Set());
    type ModalEl = { showOverlay?: () => void };
    const modal = document.getElementById("manage-route-modal") as ModalEl | null;
    modal?.showOverlay?.();
  };

  const closeEditRoute = () => {
    setActiveRouteId(null);
    setActiveRouteIndex(null);
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
            <div>
              <s-text type="strong">{t("modals.mapStyle.routingLogic")}</s-text>
              <s-choice-list
                label=""
                values={[draftRoutingLogic]}
                onChange={(event: Event) => {
                  const target = event.currentTarget as { values?: string[] } | null;
                  const value = target?.values?.[0];
                  if (
                    value === "distance" ||
                    value === "topological" ||
                    value === "inward" ||
                    value === "carrier-quotation"
                  ) {
                    setDraftRoutingLogic(value);
                  }
                }}
              >
                <s-choice value="distance">{t("modals.mapStyle.distanceFirst")}</s-choice>
                <s-choice value="topological">{t("modals.mapStyle.topological")}</s-choice>
                <s-choice value="inward">{t("modals.mapStyle.inwardMatrix")}</s-choice>
                <s-choice value="carrier-quotation">{t("modals.mapStyle.carrierQuotation")}</s-choice>
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
                setDraftRoutingLogic(routingLogic);
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
        className={`${styles.collapsibleSectionWrap}${!isRouteManagerVisible ? ` ${styles.collapsed}` : ""}`}
        onClick={(e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest?.('button, [role="button"], s-button, s-link, s-select, a, input, select, s-date-field')) return;
          setIsRouteManagerVisible((prev) => !prev);
        }}
      >
      <s-section heading={t("filters.fulfillmentDetails")}>
        <s-stack direction="block" gap="base">
          <div className={styles.locationSelectRow}>
            <div className={styles.locationSelectFlex}>
              <s-select
                label={t("filters.fulfillmentLocation")}
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
          {!isRouteManagerVisible && deliveryPromiseDays === 0 ? (
            <div className={styles.sameDayTimeLimitRow}>
              <span className={styles.sameDayTimeLimitLabel}>{t("filters.sameDayTimeLimit")}</span>
              <div className={styles.sameDayTimeSelects}>
                <s-select
                  label="Hour"
                  value={`${sameDayHour}`}
                  onChange={(e: Event) => {
                    const v = (e.currentTarget as { value?: string } | null)?.value;
                    if (v !== undefined) setSameDayHour(Number(v));
                  }}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <s-option key={i} value={`${i}`}>{String(i).padStart(2, "0")}h</s-option>
                  ))}
                </s-select>
                <s-select
                  label="Min"
                  value={`${sameDayMinute}`}
                  onChange={(e: Event) => {
                    const v = (e.currentTarget as { value?: string } | null)?.value;
                    if (v !== undefined) setSameDayMinute(Number(v));
                  }}
                >
                  {[0, 15, 30, 45].map((m) => (
                    <s-option key={m} value={`${m}`}>{String(m).padStart(2, "0")}m</s-option>
                  ))}
                </s-select>
              </div>
            </div>
          ) : null}
          {/* Orders badge */}
          <s-badge>{t("filters.ordersToDeliver", { count: mapData.orders.length })}</s-badge>
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
                        setDraftRoutingLogic(routingLogic);
                        setIsMapStyleModalOpen(true);
                      }}
                    >
                      {t("map.mapStyleButton")}
                    </s-link>
                    {locationId !== DEFAULT_LOCATION_ID ? (
                      <>
                        <s-button
                          variant="secondary"
                          disabled={selectedOrderIds.size === 0}
                          onClick={clearSelection}
                        >
                          {t("map.clearSelection")}
                        </s-button>
                        <s-button
                          variant="primary"
                          disabled={
                            selectedOrderIds.size === 0 ||
                            routesWithOrdersCount >= ROUTE_TAGS.size
                          }
                          onClick={handleAssignToNewRoute}
                        >
                          {t("map.assignToNewRoute")}
                        </s-button>
                      </>
                    ) : null}
                  </div>
                </div>
                </s-section>
                {isFullscreen ? (
                  <s-section>
                    <s-stack direction="block" gap="base">
                      <div className={styles.unassignedHeaderRow}>
                        <s-text type="strong">
                          {t("routeManager.unassignedOrders", { count: unassignedOrders.length })}
                        </s-text>
                      </div>
                      {unassignedOrders.length === 0 ? (
                        <s-text color="subdued">
                          {t("routeManager.noUnassigned")}
                        </s-text>
                      ) : visibleDueBuckets.length === 0 ? null : (
                        <div className={styles.unassignedBucketsScroll}>
                          {visibleDueBuckets.map((bucket, index) => (
                            <div
                              key={bucket.key}
                              className={`${styles.dueGroup} ${
                                visibleDueBuckets.length > 1 &&
                                index < visibleDueBuckets.length - 1
                                  ? styles.dueGroupWithDivider
                                  : ""
                              }`}
                            >
                              <div className={styles.dueGroupHeader}>
                                <s-text type="strong">
                                  {bucket.title} ({bucket.orders.length})
                                </s-text>
                              </div>
                              <div className={styles.dueOrdersTable}>
                                <div className={styles.dueOrdersHeader}>
                                  <span>
                                    <s-checkbox
                                      accessibilityLabel={bucket.selectAllLabel}
                                      checked={isBucketFullySelected(bucket.orders)}
                                      onChange={(event) => {
                                        const target = event.currentTarget as
                                          | { checked?: boolean }
                                          | null;
                                        toggleBucketSelection(
                                          bucket.orders,
                                          Boolean(target?.checked),
                                        );
                                      }}
                                    />
                                  </span>
                                  <span>{t("routeManager.table.order")}</span>
                                  <span>{t("routeManager.table.customer")}</span>
                                  <span>{t("routeManager.table.address")}</span>
                                </div>
                                {bucket.orders.map((order) => {
                                  const isSelected = selectedOrderIds.has(order.id);
                                  return (
                                    <div key={order.id} className={styles.dueOrdersRow}>
                                      <span>
                                        <s-checkbox
                                          accessibilityLabel={t("routeManager.selectOrder", { name: order.name })}
                                          checked={isSelected}
                                          onChange={(event) =>
                                            handleOrderToggle(event, order.id)
                                          }
                                        />
                                      </span>
                                      <span>{order.name}</span>
                                      <span>{formatCustomerShort(order.customerName, t("customer.guest"))}</span>
                                      <span>{order.address1 ?? t("routeManager.noAddressLine1")}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </s-stack>
                  </s-section>
                ) : null}
              </div>
              {isFullscreen ? (
                <div className={styles.fullscreenAssignedPane}>
                  <s-section>
                    <s-stack direction="block" gap="base">
                      <div className={styles.locationSelectRow}>
                        <div className={styles.locationSelectFlex}>
                          <s-select
                            label={t("filters.fulfillmentLocation")}
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
                        <button
                          type="button"
                          className={styles.collapseToggle}
                          onClick={() => setIsRouteManagerVisible((prev) => !prev)}
                          aria-label={isRouteManagerVisible ? t("map.collapse") : t("map.expand")}
                        >
                          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            {isRouteManagerVisible ? (
                              <polyline points="5 8 10 13 15 8" />
                            ) : (
                              <polyline points="5 13 10 8 15 13" />
                            )}
                          </svg>
                        </button>
                      </div>
                      {!isRouteManagerVisible ? (
                        <div className={styles.startDateFieldGroup}>
                          <s-date-field
                            label={t("filters.startDate")}
                            value={startDate}
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
                      {!isRouteManagerVisible && deliveryPromiseDays === 0 ? (
                        <div className={styles.sameDayTimeLimitRow}>
                          <span className={styles.sameDayTimeLimitLabel}>{t("filters.sameDayTimeLimit")}</span>
                          <div className={styles.sameDayTimeSelects}>
                            <s-select
                              label="Hour"
                              value={`${sameDayHour}`}
                              onChange={(e: Event) => {
                                const v = (e.currentTarget as { value?: string } | null)?.value;
                                if (v !== undefined) setSameDayHour(Number(v));
                              }}
                            >
                              {Array.from({ length: 24 }, (_, i) => (
                                <s-option key={i} value={`${i}`}>{String(i).padStart(2, "0")}h</s-option>
                              ))}
                            </s-select>
                            <s-select
                              label="Min"
                              value={`${sameDayMinute}`}
                              onChange={(e: Event) => {
                                const v = (e.currentTarget as { value?: string } | null)?.value;
                                if (v !== undefined) setSameDayMinute(Number(v));
                              }}
                            >
                              {[0, 15, 30, 45].map((m) => (
                                <s-option key={m} value={`${m}`}>{String(m).padStart(2, "0")}m</s-option>
                              ))}
                            </s-select>
                          </div>
                        </div>
                      ) : null}
                      {/* Orders badge */}
                      <s-badge>{t("filters.ordersToDeliver", { count: mapData.orders.length })}</s-badge>
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
                  </s-section>
                  {isRouteManagerVisible ? (
                  <s-section heading={t("routeManager.heading")}>
                    {/* "No assigned routes" — badge, same style as "Orders to deliver" */}
                    {locationId !== DEFAULT_LOCATION_ID && !hasAssignedRoutes && optimizeFetcher.state === "idle" ? (
                      <div className={styles.asideSummaryRow}>
                        <s-badge>{t("routeManager.noRoutesForLocation")}</s-badge>
                      </div>
                    ) : null}
                    {locationId !== DEFAULT_LOCATION_ID ? (() => {
                      const selectedUnassignedCount = unassignedOrders.filter(
                        (o) => selectedOrderIds.has(o.id),
                      ).length;
                      return (
                      <div className={styles.routeManagerTopRow}>
                        <span>
                          {hasAssignedRoutes && selectedUnassignedCount > 0 ? (
                            <s-button
                              variant="secondary"
                              onClick={handleAddToBestRoute}
                              disabled={optimizeFetcher.state !== "idle"}
                            >
                              {t("routeManager.addToBestRoute")}
                            </s-button>
                          ) : null}
                        </span>
                        {unassignedOrders.length > 0 ? (
                          <span>
                            {optimizeFetcher.state !== "idle" ? (
                              <s-button key="auto-assign-loading" variant="primary" loading disabled>
                                {t("routeManager.autoAssign")}
                              </s-button>
                            ) : (
                              <s-button
                                key="auto-assign-idle"
                                variant="primary"
                                onClick={() => {
                                  setAutoAssignLocked(false);
                                  autoAssignSelection();
                                  handleOptimizeFleet();
                                }}
                                disabled={autoAssignLocked || orders.length === 0}
                              >
                                {t("routeManager.autoAssign")}
                              </s-button>
                            )}
                          </span>
                        ) : null}
                      </div>
                      );
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
                    {locationId !== DEFAULT_LOCATION_ID && hasAssignedRoutes ? (
                      <div className={styles.assignedRoutesSection}>
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
                              return (
                                <div key={route.id} className={styles.routeCard}>
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
                                    <span title={dispatchedRoutes[route.id] ? t("routeManager.clearRouteDisabledTooltip") : undefined}>
                                      <s-button
                                        variant="secondary"
                                        tone="critical"
                                        disabled={!!dispatchedRoutes[route.id]}
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
                                        disabled={!canAddToRoute}
                                        onClick={() => handleAddSelectedToRoute(routeIndex)}
                                      >
                                        {t("routeManager.addToRoute")}
                                      </s-button>
                                    </div>
                                  ) : dispatchedRoutes[route.id] && !TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id]?.status ?? "") ? (
                                    <div className={styles.dispatchedBlock}>
                                      <div className={styles.deliveryStatusRow}>
                                        <s-badge tone={getStatusBadgeTone(dispatchedRoutes[route.id]?.status ?? "requested")}>
                                          {t(`routeManager.status.${dispatchedRoutes[route.id]?.status ?? "requested"}`)}
                                        </s-badge>
                                        <s-button variant="primary" tone="critical" onClick={() => setCancelConfirmRouteId(route.id)}>
                                          {t("routeManager.cancelDelivery")}
                                        </s-button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      {dispatchedRoutes[route.id]?.status && TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id].status!) ? (
                                        <div className={styles.routeCardStatus}>
                                          <s-badge tone={getStatusBadgeTone(dispatchedRoutes[route.id].status!)}>
                                            {t(`routeManager.status.${dispatchedRoutes[route.id].status}`)}
                                          </s-badge>
                                        </div>
                                      ) : null}
                                      <s-stack
                                        direction="inline"
                                        gap="base"
                                        justifyContent="space-between"
                                      >
                                        <div />
                                        <s-stack direction="inline" gap="base">
                                          <s-button
                                            variant="secondary"
                                            onClick={() =>
                                              openManageRouteModal(route, routeIndex)
                                            }
                                          >
                                            {t("routeManager.manage")}
                                          </s-button>
                                          {quotePreview?.routeId === route.id ? (
                                            lalamoveFetcher.state !== "idle" ? (
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
                                                onClick={() => handlePlaceOrderFromCard(route, routeIndex)}
                                              >
                                                {t("routeManager.requestDriver")}
                                              </s-button>
                                            )
                                          ) : lalamoveStatus[route.id] && lalamoveFetcher.state !== "idle" ? (
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
                                              disabled={!isLalamoveReady}
                                              onClick={() => handleRequestDriver(route)}
                                            >
                                              {t("routeManager.requestQuote")}
                                            </s-button>
                                          )}
                                        </s-stack>
                                      </s-stack>
                                    </>
                                  )}
                                  {lalamoveStatus[route.id] && !dispatchedRoutes[route.id] ? (
                                    <div className={styles.routeCardStatus}>
                                      {lalamoveStatus[route.id].tone === "success" ? (
                                        <s-badge tone="success">
                                          {lalamoveStatus[route.id].message}
                                        </s-badge>
                                      ) : lalamoveStatus[route.id].tone === "critical" ? (
                                        <s-link onClick={() => setDriverErrorModal({
                                          routeId: route.id,
                                          message: lalamoveStatus[route.id].message,
                                          errorDetails: lalamoveStatus[route.id].errorDetails ?? "",
                                        })}>
                                          <s-badge tone="critical">
                                            {lalamoveStatus[route.id].message}
                                          </s-badge>
                                        </s-link>
                                      ) : (
                                        <s-text color="subdued">
                                          {lalamoveStatus[route.id].message}
                                        </s-text>
                                      )}
                                    </div>
                                  ) : null}
                                  {reorderedRoutes[route.id] ? (
                                    <div className={styles.routeCardStatus}>
                                      <s-badge tone="warning">
                                        {t("routeManager.reRequestedAt", { time: reorderedRoutes[route.id] })}
                                      </s-badge>
                                    </div>
                                  ) : null}
                                </s-box>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ) : null}
                    {/* Clear all routes — bottom, right-aligned, critical */}
                    {hasAssignedRoutes ? (
                      <div className={styles.clearAllRoutesBottom}>
                        <s-button
                          variant="primary"
                          tone="critical"
                          onClick={() => setClearAllConfirmOpen(true)}
                        >
                          {t("routeManager.clearAllRoutes")}
                        </s-button>
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
                            disabled={!canLoad || isDismissing}
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
          {/* "No assigned routes" — badge, same style as "Orders to deliver" */}
          {locationId !== DEFAULT_LOCATION_ID && !hasAssignedRoutes && optimizeFetcher.state === "idle" ? (
            <div className={styles.asideSummaryRow}>
              <s-badge>{t("routeManager.noRoutesForLocation")}</s-badge>
            </div>
          ) : null}
          {/* ── Manually assigned routes header ── */}
          {locationId !== DEFAULT_LOCATION_ID ? (() => {
            const selectedUnassignedCount = unassignedOrders.filter(
              (o) => selectedOrderIds.has(o.id),
            ).length;
            return (
            <div className={styles.routeManagerTopRow}>
              <span>
                {hasAssignedRoutes && selectedUnassignedCount > 0 ? (
                  <s-button
                    variant="secondary"
                    onClick={handleAddToBestRoute}
                    disabled={optimizeFetcher.state !== "idle"}
                  >
                    {t("routeManager.addToBestRoute")}
                  </s-button>
                ) : null}
              </span>
              {unassignedOrders.length > 0 ? (
                <span>
                  {optimizeFetcher.state !== "idle" ? (
                    <s-button key="auto-assign-loading" variant="primary" loading disabled>
                      {t("routeManager.autoAssign")}
                    </s-button>
                  ) : (
                    <s-button
                      key="auto-assign-idle"
                      variant="primary"
                      onClick={() => {
                        setAutoAssignLocked(false);
                        autoAssignSelection();
                        handleOptimizeFleet();
                      }}
                      disabled={autoAssignLocked || orders.length === 0}
                    >
                      {t("routeManager.autoAssign")}
                    </s-button>
                  )}
                </span>
              ) : null}
            </div>
            );
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
          {locationId !== DEFAULT_LOCATION_ID && hasAssignedRoutes ? (
            <div className={styles.assignedRoutesSection}>
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
                    return (
                      <div key={route.id} className={styles.routeCard}>
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
                          <span title={dispatchedRoutes[route.id] ? t("routeManager.clearRouteDisabledTooltip") : undefined}>
                            <s-button
                              variant="secondary"
                              tone="critical"
                              disabled={!!dispatchedRoutes[route.id]}
                              onClick={() =>
                                setUnassignConfirmRoute({ route, index: routeIndex })
                              }
                            >
                              {t("routeManager.clearRoute")}
                            </s-button>
                          </span>
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
                              disabled={!canAddToRoute}
                              onClick={() => handleAddSelectedToRoute(routeIndex)}
                            >
                              {t("routeManager.addToRoute")}
                            </s-button>
                          </div>
                        ) : dispatchedRoutes[route.id] && !TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id]?.status ?? "") ? (
                          <div className={styles.dispatchedBlock}>
                            <div className={styles.deliveryStatusRow}>
                              <s-badge tone={getStatusBadgeTone(dispatchedRoutes[route.id]?.status ?? "requested")}>
                                {t(`routeManager.status.${dispatchedRoutes[route.id]?.status ?? "requested"}`)}
                              </s-badge>
                              <s-button variant="primary" tone="critical" onClick={() => setCancelConfirmRouteId(route.id)}>
                                {t("routeManager.cancelDelivery")}
                              </s-button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {dispatchedRoutes[route.id]?.status && TERMINAL_DISPATCH_STATUSES.has(dispatchedRoutes[route.id].status!) ? (
                              <div className={styles.routeCardStatus}>
                                <s-badge tone={getStatusBadgeTone(dispatchedRoutes[route.id].status!)}>
                                  {t(`routeManager.status.${dispatchedRoutes[route.id].status}`)}
                                </s-badge>
                              </div>
                            ) : null}
                            <s-stack
                              direction="inline"
                              gap="base"
                              justifyContent="space-between"
                            >
                              <div />
                              <s-stack direction="inline" gap="base">
                                <s-button
                                  variant="secondary"
                                  onClick={() => openManageRouteModal(route, routeIndex)}
                                >
                                  {t("routeManager.manage")}
                                </s-button>
                                {quotePreview?.routeId === route.id ? (
                                  lalamoveFetcher.state !== "idle" ? (
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
                                      onClick={() => handlePlaceOrderFromCard(route, routeIndex)}
                                    >
                                      {t("routeManager.requestDriver")}
                                    </s-button>
                                  )
                                ) : lalamoveStatus[route.id] && lalamoveFetcher.state !== "idle" ? (
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
                                    disabled={!isLalamoveReady}
                                    onClick={() => handleRequestDriver(route)}
                                  >
                                    {t("routeManager.requestQuote")}
                                  </s-button>
                                )}
                              </s-stack>
                            </s-stack>
                          </>
                        )}
                        {lalamoveStatus[route.id] && !dispatchedRoutes[route.id] ? (
                          <div className={styles.routeCardStatus}>
                            {lalamoveStatus[route.id].tone === "success" ? (
                              <s-badge tone="success">
                                {lalamoveStatus[route.id].message}
                              </s-badge>
                            ) : lalamoveStatus[route.id].tone === "critical" ? (
                              <s-link onClick={() => setDriverErrorModal({
                                routeId: route.id,
                                message: lalamoveStatus[route.id].message,
                                errorDetails: lalamoveStatus[route.id].errorDetails ?? "",
                              })}>
                                <s-badge tone="critical">
                                  {lalamoveStatus[route.id].message}
                                </s-badge>
                              </s-link>
                            ) : (
                              <s-text color="subdued">
                                {lalamoveStatus[route.id].message}
                              </s-text>
                            )}
                          </div>
                        ) : null}
                        {reorderedRoutes[route.id] ? (
                          <div className={styles.routeCardStatus}>
                            <s-badge tone="warning">
                              {t("routeManager.reRequestedAt", { time: reorderedRoutes[route.id] })}
                            </s-badge>
                          </div>
                        ) : null}
                      </s-box>
                      </div>
                    );
                  })}
              </div>
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
          {/* Clear all routes — bottom, right-aligned, critical */}
          {hasAssignedRoutes ? (
            <div className={styles.clearAllRoutesBottom}>
              <s-button
                variant="primary"
                tone="critical"
                onClick={() => setClearAllConfirmOpen(true)}
              >
                {t("routeManager.clearAllRoutes")}
              </s-button>
            </div>
          ) : null}
      </s-section>
      ) : null}


      {!isFullscreen ? (
      <div className={`${styles.mainBlocks} ${styles.unassignedSectionWrap}`}>
        <s-section>
          <s-stack direction="block" gap="base">
            <div className={styles.unassignedHeaderRow}>
              <s-text type="strong">
                {t("routeManager.unassignedOrders", { count: unassignedOrders.length })}
              </s-text>
            </div>
            {unassignedOrders.length === 0 ? (
              <s-text color="subdued">{t("routeManager.noUnassigned")}</s-text>
            ) : visibleDueBuckets.length === 0 ? null : (
              <div className={styles.unassignedBucketsScroll}>
                {visibleDueBuckets.map((bucket, index) => (
                  <div
                    key={bucket.key}
                    className={`${styles.dueGroup} ${
                      visibleDueBuckets.length > 1 &&
                      index < visibleDueBuckets.length - 1
                        ? styles.dueGroupWithDivider
                        : ""
                    }`}
                  >
                    <div className={styles.dueGroupHeader}>
                      <s-text type="strong">
                        {bucket.title} ({bucket.orders.length})
                      </s-text>
                    </div>
                    <div className={styles.dueOrdersTable}>
                      <div className={styles.dueOrdersHeader}>
                        <span>
                          <s-checkbox
                            accessibilityLabel={bucket.selectAllLabel}
                            checked={isBucketFullySelected(bucket.orders)}
                            onChange={(event) => {
                              const target = event.currentTarget as
                                | { checked?: boolean }
                                | null;
                              toggleBucketSelection(bucket.orders, Boolean(target?.checked));
                            }}
                          />
                        </span>
                        <span>{t("routeManager.table.order")}</span>
                        <span>{t("routeManager.table.customer")}</span>
                        <span>{t("routeManager.table.address")}</span>
                      </div>
                      {bucket.orders.map((order) => {
                        const isSelected = selectedOrderIds.has(order.id);
                        return (
                          <div key={order.id} className={styles.dueOrdersRow}>
                            <span>
                              <s-checkbox
                                accessibilityLabel={t("routeManager.selectOrder", { name: order.name })}
                                checked={isSelected}
                                onChange={(event) => handleOrderToggle(event, order.id)}
                              />
                            </span>
                            <span>{order.name}</span>
                            <span>{formatCustomerShort(order.customerName, t("customer.guest"))}</span>
                            <span>{order.address1 ?? t("routeManager.noAddressLine1")}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </s-stack>
        </s-section>
      </div>
      ) : null}
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

const chunkArray = <T,>(items: T[], size: number) => {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

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

const MAX_ROUTE_WAYPOINTS = 10;

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

const computePrecomputedRoutes = async (
  apiKey: string,
  orders: LoaderOrder[],
): Promise<PrecomputedRoute[]> => {
  const ordersByLocation = new Map<
    string,
    { location: LoaderOrder["fulfillmentLocation"]; orders: LoaderOrder[] }
  >();

  orders.forEach((order) => {
    if (!order.shippingCoordinates) return;
    if (!order.fulfillmentLocation.coordinates) return;
    const existing = ordersByLocation.get(order.fulfillmentLocation.id);
    if (existing) {
      existing.orders.push(order);
    } else {
      ordersByLocation.set(order.fulfillmentLocation.id, {
        location: order.fulfillmentLocation,
        orders: [order],
      });
    }
  });

  const results: PrecomputedRoute[] = [];
  const locationEntries = Array.from(ordersByLocation.entries());

  for (let index = 0; index < locationEntries.length; index += 1) {
    const [locationId, group] = locationEntries[index]!;
    const color =
      ROUTE_PRECOMPUTE_COLORS[index % ROUTE_PRECOMPUTE_COLORS.length]!;
    const chunks = chunkArray(group.orders, MAX_ROUTE_WAYPOINTS);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex]!;
      const destinationOrder = chunk[chunk.length - 1]!;
      const intermediates = chunk.slice(0, -1);
      const response = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "routes.polyline,routes.optimizedIntermediateWaypointIndex",
          },
          body: JSON.stringify({
            origin: {
              location: {
                latLng: {
                  latitude: group.location.coordinates!.latitude,
                  longitude: group.location.coordinates!.longitude,
                },
              },
            },
            destination: {
              location: {
                latLng: {
                  latitude: destinationOrder.shippingCoordinates!.latitude,
                  longitude: destinationOrder.shippingCoordinates!.longitude,
                },
              },
            },
            intermediates: intermediates.map((order) => ({
              location: {
                latLng: {
                  latitude: order.shippingCoordinates!.latitude,
                  longitude: order.shippingCoordinates!.longitude,
                },
              },
            })),
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_AWARE",
            optimizeWaypointOrder: true,
          }),
        },
      );

      if (!response.ok) {
        continue;
      }

      const json = await response.json();
      const encodedPolyline = json.routes?.[0]?.polyline?.encodedPolyline;
      if (!encodedPolyline) continue;

      results.push({
        id: `${locationId}-${chunkIndex}`,
        locationId,
        polyline: encodedPolyline,
        color,
        orderIds: chunk.map((order) => order.id),
      });
    }
  }

  return results;
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
  const locations = (locationsJson?.data?.locations?.nodes ?? []) as Array<{
    id: string;
    name: string;
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
                  locations {
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
    localDeliveryLocationIds = localIds;
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

  const precomputedRoutes = mapsApiKey
    ? await computePrecomputedRoutes(mapsApiKey, filteredOrders)
    : [];

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

  // Load active Lalamove dispatch jobs to prevent duplicate requests after page reload
  // Also reconcile dispatch status with Lalamove API and capture shareLink + status
  let activeDispatchData: Array<{ routeId: string; shareLink: string | null; status: string; lalamoveOrderId: string; market: string }> = [];
  try {
    const startOfToday = getStartOfDay();
    const activeDispatches = await (prisma as any).lalamoveDispatchJob.findMany({
      where: {
        shop,
        status: { notIn: ["cancelled", "CANCELLED", "CANCELED", "COMPLETED", "completed", "failed", "FAILED", "REJECTED", "rejected", "EXPIRED", "expired"] },
        requestedAt: { gte: startOfToday },
      },
      select: { id: true, routeId: true, lalamoveOrderId: true, market: true, status: true },
    });

    // Reconcile with Lalamove API — check if any "active" dispatches have actually completed or failed
    // Also capture shareLink and current status for the UI
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
      // Silently ignore individual failures — keep existing status
    }

    // Only include routes with truly active dispatches
    const terminalSet = new Set(["COMPLETED", "completed", "CANCELED", "cancelled", "CANCELLED", "REJECTED", "EXPIRED", "failed", "FAILED"]);
    activeDispatchData = activeDispatches
      .filter((d: any) => !terminalSet.has(d.status))
      .map((d: any) => ({
        routeId: d.routeId as string,
        shareLink: dispatchDetails.get(d.routeId)?.shareLink ?? null,
        status: mapLalamoveStatusToInternal(dispatchDetails.get(d.routeId)?.apiStatus ?? d.status),
        lalamoveOrderId: d.lalamoveOrderId as string,
        market: (d.market ?? "BR_SAO") as string,
      }));
  } catch {
    // Silently ignore if table is unavailable
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
  };
};


export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
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

    const routingLogic = (formData.get("routingLogic") as RoutingLogic | null) ?? "distance";
    console.info(`[local-delivery] optimize-fleet START shop=${shop} orders=${validOrders.length} logic=${routingLogic}`);

    if (routingLogic === "carrier-quotation") {
      // Load carrier config for vehicle preferences + max orders per route
      const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({
        where: { shop },
      });
      const carrierConfig = carrierConfigRow?.data as CarrierServiceConfigData | undefined;

      // Load location config for pickup coordinates
      const primaryLocationId = validOrders[0]?.locationId;
      if (!primaryLocationId) {
        return { ok: false, error: "No valid location for carrier quotation." };
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

      // Run carrier quotation optimizer
      const { optimizeByCarrierQuotation } = await import(
        "../services/carrier-quotation-optimizer.server"
      );
      const primaryVehicle =
        carrierConfig?.lalamovePreferredServiceType ||
        llmConfig.preferredServiceType ||
        "LALAGO";
      const secondaryVehicle =
        carrierConfig?.lalamoveSecondaryServiceType || undefined;
      const maxPerRoute = carrierConfig?.lalamoveMaxOrdersPerRoute ?? 10;

      const result = await optimizeByCarrierQuotation(
        validOrders,
        llmConfig,
        credentials,
        ROUTE_TAG_DEFINITIONS.length,
        { primary: primaryVehicle, secondary: secondaryVehicle },
        maxPerRoute,
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

      console.info(`[local-delivery] optimize-fleet OK (carrier-quotation) routes=${result.summary.routeCount} orders=${result.summary.totalOrders}`);
      return {
        ok: true,
        optimizedRoutes: result.routes.map((r) => ({
          routeIndex: r.routeIndex,
          locationId: r.locationId,
          orderIds: r.orderIds,
          polyline: "",
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
        })),
        summary: {
          routeCount: result.summary.routeCount,
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          totalOrders: result.summary.totalOrders,
        },
      };
    }

    const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
    if (!mapsApiKey) {
      return { ok: false, error: "GOOGLE_MAPS_API_KEY is missing." };
    }
    const optimized = await optimizeFleetRoutesDispatcher(
      mapsApiKey,
      validOrders,
      routingLogic,
    );
    let routesInCapacity = optimized.routes.slice(0, ROUTE_TAG_DEFINITIONS.length);
    const byOrderId = new Map(validOrders.map((order) => [order.orderId, order]));
    let optimizedOrderIds = routesInCapacity.flatMap((route) => route.orderIds);

    const unassignedFromOptimizer = validOrders.filter(
      (o) => !optimizedOrderIds.includes(o.orderId),
    );
    for (const order of unassignedFromOptimizer) {
      const candidates = routesInCapacity
        .filter(
          (r) =>
            r.locationId === order.locationId &&
            r.orderIds.length < MAX_ORDERS_PER_ROUTE,
        )
        .sort((a, b) => a.orderIds.length - b.orderIds.length);
      if (candidates.length > 0) {
        const route = candidates[0]!;
        route.orderIds.push(order.orderId);
      } else {
        routesInCapacity.push({
          routeIndex: routesInCapacity.length,
          locationId: order.locationId,
          orderIds: [order.orderId],
          polyline: "",
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
        });
      }
    }
    optimizedOrderIds = routesInCapacity.flatMap((route) => route.orderIds);

    const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);

    await batchProcess(optimizedOrderIds, GQL_BATCH_SIZE, (orderId) =>
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
    const distanceTagAssignments = routesInCapacity.flatMap((route) => {
      const tag = ROUTE_TAG_DEFINITIONS[route.routeIndex]?.tag;
      return tag ? route.orderIds.map((orderId) => ({ orderId, tag })) : [];
    });
    await batchProcess(distanceTagAssignments, GQL_BATCH_SIZE, ({ orderId, tag }) =>
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

    console.info(`[local-delivery] optimize-fleet OK (${routingLogic}) routes=${routesInCapacity.length} orders=${optimizedOrderIds.length}`);
    return {
      ok: true,
      optimizedRoutes: routesInCapacity.map((route) => {
        const firstOrder = byOrderId.get(route.orderIds[0] ?? "");
        return {
          routeIndex: route.routeIndex,
          locationId: route.locationId || firstOrder?.locationId || "",
          orderIds: route.orderIds,
          polyline: route.polyline,
          totalDistanceMeters: route.totalDistanceMeters,
          totalDurationSeconds: route.totalDurationSeconds,
        };
      }),
      summary: optimized.summary,
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
    const result = await addToExistingRoutesByCarrierQuotation(
      existingRoutes,
      validUnassigned,
      allOrdersById,
      llmConfig,
      credentials,
      { primary: primaryVehicle, secondary: secondaryVehicle },
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
        polyline: "",
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
      })),
      summary: {
        routeCount: result.summary.routeCount,
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        costTotal: result.summary.totalCost,
        costCurrency: result.summary.costCurrency,
      },
    };
  }

  if (intent === "refresh-route-stats") {
    const credentials = await getRuntimeCredentialsForShop(shop);
    const routesPayload = formData.get("routesPayload");
    if (typeof routesPayload !== "string" || !routesPayload.trim()) {
      return { ok: false, error: "No routes payload." };
    }
    let routes: Array<{ routeId: string; locationId: string; orderIds: string[] }>;
    try {
      const parsed = JSON.parse(routesPayload) as Array<{
        routeId: string;
        locationId: string;
        orderIds: string[];
      }>;
      routes = Array.isArray(parsed) ? parsed.filter((r) => r?.routeId && r?.locationId && Array.isArray(r?.orderIds) && r.orderIds.length > 0) : [];
    } catch {
      return { ok: false, error: "Invalid routes payload." };
    }
    if (routes.length === 0) return { ok: true, routeStats: [] };

    const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
    const routeStats: Array<{
      routeId: string;
      totalDistanceMeters: number;
      totalDurationSeconds: number;
      costTotal?: string;
      costCurrency?: string;
    }> = [];

    const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({
      where: { shop },
    });
    const carrierConfig = carrierConfigRow?.data as CarrierServiceConfigData | undefined;

    for (const { routeId, locationId, orderIds: routeOrderIds } of routes) {
      let totalDistanceMeters = 0;
      let totalDurationSeconds = 0;
      let costTotal: string | undefined;
      let costCurrency: string | undefined;

      const locRes = await admin.graphql(
        `#graphql
          query RefreshRouteLocation($id: ID!) {
            location(id: $id) {
              address { latitude longitude }
            }
          }`,
        { variables: { id: locationId } },
      );
      const locJson = await locRes.json();
      const locAddress = locJson?.data?.location?.address as { latitude?: number | null; longitude?: number | null } | null;
      const locationCoordinates =
        locAddress?.latitude != null && locAddress?.longitude != null
          ? { latitude: locAddress.latitude, longitude: locAddress.longitude }
          : null;

      const ordersRes = await admin.graphql(
        `#graphql
          query RefreshRouteOrders($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Order {
                id
                shippingAddress { latitude longitude address1 address2 city province zip country }
              }
            }
          }`,
        { variables: { ids: routeOrderIds } },
      );
      const ordersJson = await ordersRes.json();
      const orderNodes = (ordersJson?.data?.nodes ?? []) as Array<{
        id: string;
        shippingAddress?: { latitude?: number | null; longitude?: number | null; address1?: string | null; address2?: string | null; city?: string | null; province?: string | null; zip?: string | null; country?: string | null } | null;
      }>;

      const ordersWithCoords = orderNodes
        .filter((o) => o?.shippingAddress && o.shippingAddress.latitude != null && o.shippingAddress.longitude != null)
        .map((o) => ({
          orderId: o.id,
          shippingCoordinates: {
            latitude: o.shippingAddress!.latitude!,
            longitude: o.shippingAddress!.longitude!,
          },
        }));

      if (locationCoordinates && ordersWithCoords.length > 0 && mapsApiKey) {
        const metrics = await computeRouteMetrics(
          mapsApiKey,
          locationCoordinates,
          locationId,
          ordersWithCoords,
        );
        totalDistanceMeters = metrics.totalDistanceMeters;
        totalDurationSeconds = metrics.totalDurationSeconds;
      }

      const configRow = await prisma.lalamoveLocationConfig.findUnique({
        where: { shop_locationId: { shop, locationId } },
      });
      const config = configRow?.data as LalamoveConfig | undefined;
      const effectiveServiceType =
        config?.preferredServiceType?.trim() ||
        carrierConfig?.lalamovePreferredServiceType?.trim() ||
        "LALAGO";
      if (config?.market && config?.language && effectiveServiceType && locationCoordinates && orderNodes.length > 0) {
        const pickupAddress = locJson?.data?.location?.address as { latitude?: number; longitude?: number; address1?: string; city?: string; province?: string; country?: string } | null;
        const deliveryStops = orderNodes
          .filter((o) => o?.shippingAddress && o.shippingAddress.latitude != null && o.shippingAddress.longitude != null)
          .map((o) => ({
            coordinates: { lat: String(o.shippingAddress!.latitude), lng: String(o.shippingAddress!.longitude) },
            address: formatDeliveryStopAddress(
              o.shippingAddress!.address1,
              o.shippingAddress!.address2,
            ),
            sourceAddress2: o.shippingAddress!.address2 ?? null,
          }));
        const fulfillmentStopAddress = formatFulfillmentStopAddress(
          config.locationName,
          config.locationAddress,
          config.locationDetails,
        );
        const stops = [
          {
            coordinates: { lat: String(pickupAddress?.latitude ?? 0), lng: String(pickupAddress?.longitude ?? 0) },
            address:
              fulfillmentStopAddress ||
              formatAddress([
                pickupAddress?.address1,
                pickupAddress?.city,
                pickupAddress?.province,
                pickupAddress?.country,
              ]),
          },
          ...deliveryStops,
        ];
        try {
          const specialRequests = carrierConfig?.lalamoveSpecialRequests?.[config.market] ?? [];
          const quotation = await createLalamoveQuotation({
            market: config.market,
            language: config.language,
            serviceType: effectiveServiceType,
            stops,
            isRouteOptimized: true,
            ...(specialRequests.length ? { specialRequests } : {}),
          }, credentials ?? undefined);
          costTotal = quotation.priceBreakdown?.total;
          costCurrency = quotation.priceBreakdown?.currency;
        } catch (_) {
          // leave cost as undefined on Lalamove failure
        }
      }

      routeStats.push({
        routeId,
        totalDistanceMeters,
        totalDurationSeconds,
        costTotal,
        costCurrency,
      });
    }

    return { ok: true, routeStats };
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
    try {
      // Read special requests from form data (from pre-quote modal), falling back to saved config
      const formSpecialRequests = formData.getAll("specialRequests") as string[];
      let specialRequests = formSpecialRequests.length > 0
        ? formSpecialRequests
        : (carrierConfig?.lalamoveSpecialRequests?.[configWithLocation.market] ?? []);

      // Validate special requests against the specific city+service available options.
      // Special requests are saved per market, but availability varies per city within the
      // same market (e.g. São Paulo supports RETURN_TRIP, Recife does not).
      if (specialRequests.length > 0 && credentials) {
        try {
          const cities = await getLalamoveCityInfo(configWithLocation.market, credentials);
          const availableNames = new Set<string>();
          const locationCity = ((config as any).city as string | undefined)?.trim().toLowerCase();
          console.info(`[local-delivery] special-request validation: market=${configWithLocation.market} locationCity=${locationCity ?? "?"} cities=[${cities.map((c) => `${c.locode}/${c.name}`).join(", ")}]`);
          const serviceType = configWithLocation.preferredServiceType;
          for (const city of cities) {
            // Filter by city when known — prevents cross-city leaks (e.g. SP options sent for Recife)
            if (locationCity) {
              const matchesLocode = city.locode?.toLowerCase() === locationCity;
              const matchesName = city.name?.trim().toLowerCase() === locationCity;
              if (!matchesLocode && !matchesName) continue;
            }
            for (const service of city.services ?? []) {
              if (serviceType && service.key !== serviceType) continue;
              for (const sr of service.specialRequests ?? []) {
                availableNames.add(sr.name);
              }
            }
          }
          const filtered = specialRequests.filter((sr) => availableNames.has(sr));
          if (filtered.length !== specialRequests.length) {
            console.warn(`[local-delivery] filtered invalid special requests for ${configWithLocation.market} city=${locationCity ?? "?"} service=${serviceType}: ${specialRequests.filter((sr) => !availableNames.has(sr)).join(", ")}`);
          }
          specialRequests = filtered;
        } catch {
          // If city info fetch fails, proceed with original requests
        }
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

        // Apply Shopify state
        const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
          where: { dispatchJobId: dispatchJob.id },
          select: { shopifyOrderId: true },
        });
        const orderIds = orderMaps.map((m: { shopifyOrderId: string }) => m.shopifyOrderId);
        if (orderIds.length > 0) {
          await applyLalamoveDeliveryState(admin, {
            orderIds,
            state: "failed",
            reason: "Delivery cancelled by merchant.",
            existingFulfillmentId: dispatchJob.shopifyFulfillmentId,
          });
        }

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
                address2
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
      shippingAddress?: { address2?: string | null; phone?: string | null } | null;
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
        phone:
          order.customer?.defaultPhoneNumber?.phoneNumber ||
          order.shippingAddress?.phone ||
          order.customer?.phone ||
          config.locationPhone,
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

      console.error(`[local-delivery] lalamove-place-order FAILED shop=${shop} route=${routeId} location=${locationId} error=${message}`);
      return { ok: false, error: message, routeId };
    }

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

      const { fulfillmentId: shopifyFulfillmentId } = await applyLalamoveDeliveryState(admin, {
        orderIds: assignmentOrderIds,
        state: "requested",
        existingFulfillmentId: null,
      });
      if (shopifyFulfillmentId) {
        await prismaAny.lalamoveDispatchJob.update({
          where: { id: dispatchJob.id },
          data: { shopifyFulfillmentId },
        });
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
};
