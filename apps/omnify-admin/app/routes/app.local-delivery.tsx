import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createLalamoveQuotation,
  getLalamoveOrderDetails,
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
import { normalizeShippingAddress } from "../services/carrier/geocode.server";
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

const getDayIndexInTimeZone = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
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
  if (![1, 2, 3, 4].includes(normalized)) return DEFAULT_DELIVERY_PROMISE_DAYS;
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
    shipmentRequestWarning,
    routeStats,
    precomputedRoutes,
    lalamoveConfigs,
    credentialStatus,
    pendingRoutes,
    autoAssignLogs,
    shop,
    userLocale,
    availablePresaleTags,
    hasUnfulfilledPresaleOrders,
    failedDeliveryCount,
  } =
    useLoaderData<typeof loader>();
  const lalamoveFetcher = useFetcher<typeof action>();
  const lalamoveSettingsFetcher = useFetcher<typeof action>();
  const optimizeFetcher = useFetcher<typeof action>();
  const assignFetcher = useFetcher();
  const unassignFetcher = useFetcher();
  const refreshStatsFetcher = useFetcher<typeof action>();
  const pendingRouteFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [locationId, setLocationId] = useState(filters.locationId);
  const [startDate, setStartDate] = useState(filters.startDate);
  const [deliveryPromiseDays, setDeliveryPromiseDays] = useState(
    filters.deliveryPromiseDays,
  );
  const [selectedPresaleTags, setSelectedPresaleTags] = useState<string[]>(
    filters.selectedPresaleTags,
  );
  const [isPresaleModalOpen, setIsPresaleModalOpen] = useState(false);
  const [draftPresaleTags, setDraftPresaleTags] = useState<string[]>(
    filters.selectedPresaleTags,
  );
  const [isAddressErrorsModalOpen, setIsAddressErrorsModalOpen] = useState(false);
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
  const [isCarrierStatusExpanded, setIsCarrierStatusExpanded] = useState(false);
  const [selectedAutoAssignLog, setSelectedAutoAssignLog] = useState<{
    id: string;
    orderId: string;
    orderName: string | null;
    locationId: string | null;
    status: string;
    reason: string | null;
    details: unknown;
    createdAt: Date;
  } | null>(null);
  const [isAutoAssignLogModalOpen, setIsAutoAssignLogModalOpen] = useState(false);
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
    Record<string, { message: string; tone?: "success" | "critical" }>
  >({});
  const lalamoveStatusTimeoutsRef = useRef<Record<string, number>>({});
  // Tracks routes where a driver has been successfully requested (session-only)
  const [dispatchedRoutes, setDispatchedRoutes] = useState<
    Record<string, { shareLink?: string }>
  >({});
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
  const [assignmentSuccessMessage, setAssignmentSuccessMessage] = useState<
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
        const orderIds = existing
          ? existing.orderIds.filter((orderId) => ordersSet.has(orderId))
          : (route.orderIds ?? []).filter((orderId) => ordersSet.has(orderId));
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
    if ("error" in data && data.routeId) {
      const routeId = data.routeId as string;
      const existingTimeout = lalamoveStatusTimeoutsRef.current[routeId];
      if (existingTimeout) window.clearTimeout(existingTimeout);
      setLalamoveStatus((current) => ({
        ...current,
        [routeId]: { message: "Request failed", tone: "critical" },
      }));
      lalamoveStatusTimeoutsRef.current[routeId] = window.setTimeout(() => {
        setLalamoveStatus((current) => {
          const next = { ...current };
          delete next[routeId];
          return next;
        });
        delete lalamoveStatusTimeoutsRef.current[routeId];
      }, 3000);
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
        locationId: data.locationId ?? "",
      });
      setIsRequestDriverModalOpen(true);
      setLalamoveStatus((current) => ({
        ...current,
        [routeId]: { message: "Ready for delivery", tone: "success" },
      }));
      return;
    }
    if ("placedOrderId" in data && data.routeId) {
      const routeId = data.routeId as string;
      const existingTimeout = lalamoveStatusTimeoutsRef.current[routeId];
      if (existingTimeout) window.clearTimeout(existingTimeout);
      // Mark route as dispatched and store share link (if returned by Lalamove)
      setDispatchedRoutes((prev) => ({
        ...prev,
        [routeId]: { shareLink: (data as any).shareLink ?? undefined },
      }));
      setLalamoveStatus((current) => ({
        ...current,
        [routeId]: { message: "Driver requested", tone: "success" },
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
    setAssignmentSuccessMessage(
      `Optimization applied: ${optimizeFetcher.data.summary?.routeCount ?? 0} routes`,
    );
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
          "Google Maps Places failed to load. Check your API key and billing setup.",
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
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const gMaps = window.google?.maps;
      if (!mapRef.current || !gMaps) return;
      gMaps.event.trigger(mapRef.current, "resize");
      const allPoints = [
        ...[...mapData.locations.values()],
        ...mapData.orders,
      ];
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

  const unassignedOrders = useMemo(
    () => orders.filter((order) => !assignedOrderIds.has(order.id)),
    [orders, assignedOrderIds],
  );

  const dueBucketByOrderId = useMemo(() => {
    const now = new Date();
    const todayDayIndex = getDayIndexInTimeZone(now, browserTimeZone);
    const map = new Map<string, "today" | "tomorrow" | "later">();
    unassignedOrders.forEach((order) => {
      const processedAt = order.processedAt ? new Date(order.processedAt) : null;
      if (!processedAt || Number.isNaN(processedAt.getTime())) {
        // Unknown placement time → treat as due today (safest for operations)
        map.set(order.id, "today");
        return;
      }
      const orderDayIndex = getDayIndexInTimeZone(processedAt, browserTimeZone);
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
  }, [unassignedOrders, deliveryPromiseDays, browserTimeZone]);

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
          title: "Orders due today",
          selectAllLabel: "Select all orders due today",
          orders: dueBuckets.today,
        },
        {
          key: "tomorrow",
          title: "Orders due tomorrow",
          selectAllLabel: "Select all orders due tomorrow",
          orders: dueBuckets.tomorrow,
        },
        {
          key: "later",
          title: "Orders due later",
          selectAllLabel: "Select all orders due later",
          orders: dueBuckets.later,
        },
      ].filter((bucket) => bucket.orders.length > 0),
    [dueBuckets],
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
  }, [unassignedOrders.length, assignmentSuccessMessage]);

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
          setMapsLoadError("Google Maps SDK not available.");
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
            "Google Maps Advanced Markers are unavailable. Check map ID and API setup.",
          );
          return;
        }

        if (!mapRef.current) {
          const styledMapTypes = {
            light: new googleMaps.StyledMapType(null, { name: "Light" }),
            grayscale: new googleMaps.StyledMapType(GRAYSCALE_MAP_STYLES, {
              name: "Grayscale",
            }),
            dark: new googleMaps.StyledMapType(DARK_MAP_STYLES, {
              name: "Dark",
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
          const emoji =
            point.kind === "order"
              ? assignedRoute
                ? null
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
                getOrderInfoContent(orderDetails),
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
                getOrderInfoContent(orderDetails),
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
                  <span style="font-weight:600;">Order assigned to Route ${
                    routeNumber ?? "?"
                  }</span>
                  <button id="${buttonId}" style="background:#d82c0d;color:#fff;border:0;border-radius:6px;padding:8px 10px;cursor:pointer;">
                    Unassign
                  </button>
                </div>
              `);
              infoWindowRef.current?.open({
                map: mapRef.current!,
                anchor: advancedMarker,
                shouldFocus: false,
              });
              if (googleMaps.event?.addListenerOnce) {
                googleMaps.event.addListenerOnce(infoWindowRef.current!, "domready", () => {
                  const button = document.getElementById(buttonId);
                  button?.addEventListener("click", () => {
                    unassignSingleOrderFromRoute(point.id, assignedRoute);
                    infoWindowRef.current?.close();
                  });
                });
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
        const selectedByLocation = new Map<
          string,
          { origin: { latitude: number; longitude: number }; orders: LoaderOrder[] }
        >();
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

        selectedByLocation.forEach((group) => {
          if (group.orders.length === 0) return;
          const ordered = group.orders.filter((order) => order.shippingCoordinates);
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
          directionsService.route(
            {
              origin: {
                lat: group.origin.latitude,
                lng: group.origin.longitude,
              },
              destination: {
                lat: destinationOrder.shippingCoordinates!.latitude,
                lng: destinationOrder.shippingCoordinates!.longitude,
              },
              waypoints: intermediates.map((order) => ({
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
          "Google Maps failed to load. Check your API key and billing setup.",
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
            light: new googleMaps.StyledMapType(null, { name: "Light" }),
            grayscale: new googleMaps.StyledMapType(GRAYSCALE_MAP_STYLES, {
              name: "Grayscale",
            }),
            dark: new googleMaps.StyledMapType(DARK_MAP_STYLES, {
              name: "Dark",
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
            title: "Fulfillment location",
            content: buildLabel("Fulfillment", "🏬"),
          });
          manageRouteMarkersRef.current.push({ type: "advanced", marker: originMarker });
          bounds.extend({ lat: origin.latitude, lng: origin.longitude });
        }

        routePoints.forEach((order) => {
          const coords = order.shippingCoordinates!;
          const badgeColors = deriveBadgeColors(managedRoute.color);
          const marker = new AdvancedMarkerElement({
            map: manageRouteMapInstance.current,
            position: { lat: coords.latitude, lng: coords.longitude },
            title: order.name,
            content: buildLabel(
              order.name,
              null,
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
  }, [isAddressErrorsModalOpen]);

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
    if (!isAutoAssignLogModalOpen) return;
    const modal = document.getElementById("auto-assign-log-modal") as
      | { showOverlay?: () => void }
      | null;
    modal?.showOverlay?.();
  }, [isAutoAssignLogModalOpen]);

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
    setIsRouteManagerVisible(false);
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
    if (Number.isNaN(parsed.getTime())) return "0 days ago";
    const now = new Date();
    const diffDays = Math.max(
      0,
      Math.floor((now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24)),
    );
    return `${diffDays} days ago`;
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
        `All ${projectedAssignedOrdersInScope} orders successfully assigned to ${projectedRoutesWithOrdersInScope} routes`,
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
      setAssignmentSuccessMessage("No unassigned orders with coordinates to optimize.");
      return;
    }
    const formData = new FormData();
    formData.append("intent", "optimize-fleet");
    formData.append("ordersPayload", JSON.stringify(candidates));
    formData.append("routingLogic", routingLogic);
    optimizeFetcher.submit(formData, { method: "post" });
  };

  const handleRequestDriver = (route: PrecomputedRoute) => {
    const formData = new FormData();
    formData.append("intent", "lalamove-quote");
    formData.append("routeId", route.id);
    formData.append("locationId", route.locationId);
    route.orderIds.forEach((orderId) => formData.append("orderIds", orderId));
    setLalamoveStatus((current) => ({
      ...current,
      [route.id]: { message: "Creating quotation..." },
    }));
    lalamoveFetcher.submit(formData, { method: "post" });
  };

  const formatDurationSummary = (seconds: number) => {
    const safe = Math.max(0, Math.trunc(seconds));
    const hours = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    return `${hours}h ${mins}m`;
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
    setEditableRoutes((current) =>
      current.map((route) =>
        route.id === activeRouteId
          ? {
              ...route,
              orderIds: route.orderIds.filter(
                (orderId) => !removeFromRouteOrderIds.has(orderId),
              ),
            }
          : route,
      ),
    );
    closeEditRoute();
  };

  return (
    <s-page heading="Local delivery" inlineSize="base">
      <s-modal
        id="manage-route-modal"
        heading={`Route ${
          activeRouteIndex != null ? activeRouteIndex + 1 : ""
        }`.trim()}
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
                        accessibilityLabel="Select all orders in route"
                        checked={isManageRouteFullySelected}
                        onChange={(event) => {
                          const target = event.currentTarget as
                            | { checked?: boolean }
                            | null;
                          toggleManageRouteSelection(Boolean(target?.checked));
                        }}
                      />
                    </span>
                    <span>Order</span>
                    <span>Customer</span>
                    <span>Address</span>
                  </div>
                  {activeManagedRouteOrders.map((order) => (
                    <div key={order.id} className={styles.dueOrdersRow}>
                      <span>
                        <s-checkbox
                          accessibilityLabel={`Remove ${order.name} from route`}
                          checked={removeFromRouteOrderIds.has(order.id)}
                          onChange={() => toggleRemoveRouteOrder(order.id)}
                        />
                      </span>
                      <s-link href={order.adminOrderUrl} target="_blank">
                        {order.name}
                      </s-link>
                      <span>{formatCustomerShort(order.customerName)}</span>
                      <span>{order.address1 ?? "No address line 1"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <s-text color="subdued">No orders in this route.</s-text>
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
              Cancel
            </s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={removeFromRouteOrderIds.size === 0}
              commandFor="manage-route-modal"
              command="--hide"
              onClick={saveRouteEdits}
            >
              Unassign orders
            </s-button>
          </div>
        </s-stack>
      </s-modal>
      {unassignConfirmRoute ? (
        <s-modal id="unassign-confirm-modal" heading="Warning">
          <s-stack direction="block" gap="base">
            <s-text>
              All orders will be unassigned from route.
            </s-text>
            <s-text>Do you wish to proceed?</s-text>
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                commandFor="unassign-confirm-modal"
                command="--hide"
                onClick={() => setUnassignConfirmRoute(null)}
              >
                Cancel
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
                Confirm
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      {clearAllConfirmOpen ? (
        <s-modal id="clear-all-confirm-modal" heading="Warning">
          <s-stack direction="block" gap="base">
            <s-text>
              All orders will be unassigned.
            </s-text>
            <s-text>Do you wish to proceed?</s-text>
            <div className={styles.assignModalFooter}>
              <s-button
                variant="secondary"
                commandFor="clear-all-confirm-modal"
                command="--hide"
                onClick={() => setClearAllConfirmOpen(false)}
              >
                Cancel
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                commandFor="clear-all-confirm-modal"
                command="--hide"
                onClick={performClearAllRoutes}
              >
                Confirm
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      {quotePreview ? (
        <s-modal id="request-driver-modal" heading="Request driver">
          <s-stack direction="block" gap="base">
            <s-text>
              Quote #{quotePreview.quotationId}
            </s-text>
            <s-text color="subdued">
              Expires at: {new Date(quotePreview.expiresAt).toLocaleString()}
            </s-text>
            <s-text color="subdued">
              Estimated total: {quotePreview.total ?? "--"} {quotePreview.currency ?? ""}
            </s-text>
            <s-text color="subdued">
              Orders in route: {quotePreview.orderIds.length}
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
                Cancel
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
                  lalamoveFetcher.submit(formData, { method: "post" });
                }}
              >
                Confirm request
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      <s-modal
        id="presale-tags-modal"
        heading="Select which tags to include in routes:"
      >
        <s-stack direction="block" gap="base">
          {availablePresaleTags.length === 0 ? (
            <s-text color="subdued">No pre-sale tags found.</s-text>
          ) : (
            availablePresaleTags.map((tag) => (
              <s-checkbox
                key={tag}
                checked={draftPresaleTags.includes(tag)}
                onChange={(event: Event) =>
                  toggleDraftPresaleTag(
                    tag,
                    (event.currentTarget as HTMLInputElement).checked,
                  )
                }
              >
                {tag}
              </s-checkbox>
            ))
          )}
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="presale-tags-modal"
              command="--hide"
              onClick={() => setIsPresaleModalOpen(false)}
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              commandFor="presale-tags-modal"
              command="--hide"
              onClick={confirmPresaleTags}
            >
              Confirm
            </s-button>
          </div>
        </s-stack>
      </s-modal>
      <s-modal id="map-style-modal" heading="Map style">
        <div className={styles.mapStyleModalContent}>
        <s-stack direction="block" gap="base">
          <div className={styles.mapStyleModalColumns}>
            <div>
              <s-text type="strong">Map style</s-text>
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
                <s-choice value="dark">Dark</s-choice>
                <s-choice value="grayscale">Greyscale</s-choice>
                <s-choice value="light">Light</s-choice>
              </s-choice-list>
            </div>
            <div>
              <s-text type="strong">Routing logic</s-text>
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
                <s-choice value="distance">Distance-first</s-choice>
                <s-choice value="topological">Topological</s-choice>
                <s-choice value="inward">Inward-matrix</s-choice>
                <s-choice value="carrier-quotation">Carrier quotation</s-choice>
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
              Cancel
            </s-button>
            <s-button
              variant="primary"
              commandFor="map-style-modal"
              command="--hide"
              onClick={confirmMapStyle}
            >
              Confirm
            </s-button>
          </div>
        </s-stack>
        </div>
      </s-modal>
      <s-modal id="address-errors-modal" heading="Potential address errors">
        <s-stack direction="block" gap="base">
          {addressErrorOrders.length === 0 ? (
            <s-text color="subdued">No potential address errors found.</s-text>
          ) : (
            addressErrorOrders.map((order) => (
              <s-box
                key={order.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-text type="strong">{order.name}</s-text>
                  <s-text color="subdued">
                    {order.addressValidation.issueType === "apartment_in_address1"
                      ? "Apartment/unit details likely in address line 1."
                      : order.addressValidation.issueType === "duplicate_number"
                        ? "Potential duplicate number across address lines."
                        : "Address review needed."}
                  </s-text>
                  <s-link href={order.adminOrderUrl} target="_blank">
                    Fix address in Shopify
                  </s-link>
                </s-stack>
              </s-box>
            ))
          )}
          <s-text color="subdued">
            Open the order, then use Customer {" > "} ... {" > "} Edit shipping
            address.
          </s-text>
          <div className={styles.assignModalFooter}>
            <s-button
              variant="secondary"
              commandFor="address-errors-modal"
              command="--hide"
              onClick={() => setIsAddressErrorsModalOpen(false)}
            >
              Close
            </s-button>
          </div>
        </s-stack>
      </s-modal>
      <s-modal
        id="auto-assign-log-modal"
        heading={selectedAutoAssignLog ? `Auto-assign: ${selectedAutoAssignLog.orderName ?? selectedAutoAssignLog.orderId}` : "Auto-assign log"}
      >
        {selectedAutoAssignLog ? (
          <s-stack direction="block" gap="base">
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text type="strong">
                  {selectedAutoAssignLog.status === "assigned"
                    ? "Successful"
                    : selectedAutoAssignLog.status === "skipped"
                      ? "Skipped"
                      : "Error"}
                </s-text>
                <s-text color="subdued">{selectedAutoAssignLog.reason ?? "—"}</s-text>
                <s-text color="subdued">
                  {new Date(selectedAutoAssignLog.createdAt).toLocaleString()}
                </s-text>
                {selectedAutoAssignLog.locationId ? (
                  <s-text color="subdued">
                    Location: {lalamoveConfigMap[selectedAutoAssignLog.locationId]?.locationName ?? selectedAutoAssignLog.locationId}
                  </s-text>
                ) : null}
              </s-stack>
            </s-box>
            {selectedAutoAssignLog.details &&
            typeof selectedAutoAssignLog.details === "object" &&
            Object.keys(selectedAutoAssignLog.details as object).length > 0 ? (
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-text type="strong">Debug details</s-text>
                <pre
                  className={styles.autoAssignLogDetails}
                  style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontSize: "12px" }}
                >
                  {JSON.stringify(selectedAutoAssignLog.details, null, 2)}
                </pre>
              </s-box>
            ) : null}
            <div className={styles.assignModalFooter}>
              <s-link
                href={`https://admin.shopify.com/store/${toAdminStoreHandle(shop)}/orders/${selectedAutoAssignLog.orderId}`}
                target="_blank"
              >
                Open order in Shopify
              </s-link>
              <s-button
                variant="secondary"
                commandFor="auto-assign-log-modal"
                command="--hide"
                onClick={() => {
                  setSelectedAutoAssignLog(null);
                  setIsAutoAssignLogModalOpen(false);
                }}
              >
                Close
              </s-button>
            </div>
          </s-stack>
        ) : (
          <s-text color="subdued">No log selected.</s-text>
        )}
      </s-modal>
      {!mapsApiKey ? (
        <s-banner tone="warning" heading="Google Maps API key missing">
          Set GOOGLE_MAPS_API_KEY in your environment and restart the dev server
          to enable the map.
        </s-banner>
      ) : null}
      {!mapsMapId ? (
        <s-banner tone="warning" heading="Google Maps Map ID missing">
          Set GOOGLE_MAPS_MAP_ID in your environment to use Advanced Markers.
        </s-banner>
      ) : null}
      {ordersError ? (
        <s-banner tone="critical" heading="Orders access requires approval">
          {ordersError}
        </s-banner>
      ) : null}
      {debugLocalDelivery ? (
        <s-banner tone="info" heading="Local Delivery debug mode">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(debugLocalDelivery, null, 2)}
          </pre>
        </s-banner>
      ) : null}
      {shipmentRequestWarning ? (
        <s-banner
          tone="warning"
          heading="There are shipment requests to be processed"
        />
      ) : null}
      {assignmentSuccessMessage ? (
        <s-banner tone="success" heading={assignmentSuccessMessage} />
      ) : null}
      <s-section slot="aside">
        <s-stack direction="block" gap="base">
          <s-select
            label="Fulfillment location"
            name="locationId"
            value={locationId}
            onChange={handleLocationChange}
          >
            <s-option value={DEFAULT_LOCATION_ID}>All locations</s-option>
            {locations.map((location) => (
              <s-option key={location.id} value={location.id}>
                {location.name}
              </s-option>
            ))}
          </s-select>
          {!isRouteManagerVisible ? (
            <div className={styles.startDateFieldGroup}>
              <s-date-field
                label="Start date"
                value={startDate}
                onChange={handleStartDateChange}
              />
              <s-text color="subdued">{daysAgoText}</s-text>
            </div>
          ) : null}
          {!isRouteManagerVisible ? (
            <s-select
              label="Delivery promisse"
              value={`${deliveryPromiseDays}`}
              onChange={handleDeliveryPromiseChange}
            >
              <s-option value="1">Next day</s-option>
              <s-option value="2">Day +2</s-option>
              <s-option value="3">Day +3</s-option>
              <s-option value="4">Day +4</s-option>
            </s-select>
          ) : null}
          <div className={styles.asideSummaryRow}>
            <s-badge>📦 Orders to deliver: {mapData.orders.length}</s-badge>
          </div>
          {failedDeliveryCount > 0 ? (
            <div className={styles.warningLink}>
              <s-text>⚠️ Failed delivery ({failedDeliveryCount})</s-text>
            </div>
          ) : null}
          {hasUnfulfilledPresaleOrders ? (
            <s-link
              className={styles.warningLink}
              onClick={() => setIsPresaleModalOpen(true)}
            >
              ⚠️ There are unfulfilled pre-sale orders
            </s-link>
          ) : null}
          {addressErrorOrders.length > 0 ? (
            <s-link
              className={styles.warningLink}
              onClick={() => setIsAddressErrorsModalOpen(true)}
            >
              ⚠️ Potential address errors ({addressErrorOrders.length})
            </s-link>
          ) : null}
          <div className={styles.asideButtonRow}>
            <div className={styles.asideButtonRowActions}>
              <s-button
                variant="secondary"
                onClick={() => {
                  autoAssignSelection();
                  handleOptimizeFleet();
                }}
                disabled={
                  locationId === DEFAULT_LOCATION_ID ||
                  orders.length === 0 ||
                  optimizeFetcher.state !== "idle" ||
                  unassignedOrders.length === 0
                }
              >
                Auto-assign orders
              </s-button>
              <s-button variant="primary" onClick={handleManageOrdersClick}>
                Manage orders
              </s-button>
            </div>
          </div>
          {optimizeFetcher.state !== "idle" ? (
            <div className={styles.autoAssignSpinnerWrap}>
              <s-stack direction="inline" gap="small">
                <s-spinner size="base" accessibilityLabel="Auto-assigning orders" />
                <s-text color="subdued">Auto-assignment in progress</s-text>
              </s-stack>
            </div>
          ) : null}
          {isRouteManagerVisible ? (
            <div className={styles.mapBlockFooterRight}>
              <s-link onClick={() => setIsRouteManagerVisible(false)}>
                Change settings
              </s-link>
            </div>
          ) : null}
          <div className={styles.carrierStatusBlock}>
            <s-link
              onClick={() =>
                setIsCarrierStatusExpanded((s) => !s)
              }
            >
              Carrier status
            </s-link>
            {isCarrierStatusExpanded ? (
              <div className={styles.carrierStatusExpanded}>
                {locationId === DEFAULT_LOCATION_ID ? (
                  <s-text color="subdued">
                    Select a fulfillment location to see carrier status.
                  </s-text>
                ) : (
                  <s-stack direction="block" gap="small">
                    {(() => {
                      const lalamoveConfig =
                        lalamoveConfigMap[locationId];
                      const isLalamoveReady =
                        credentialStatus.configured &&
                        lalamoveConfig &&
                        lalamoveConfig.market &&
                        lalamoveConfig.preferredServiceType &&
                        lalamoveConfig.locationName &&
                        lalamoveConfig.locationPhone &&
                        lalamoveConfig.locationAddress;
                      const statusLine = (
                        ok: boolean,
                        label: string,
                        value?: string,
                      ) => (
                        <div
                          key={label}
                          className={styles.carrierStatusLine}
                        >
                          <span
                            className={
                              ok
                                ? styles.carrierStatusOk
                                : styles.carrierStatusFail
                            }
                          >
                            {ok ? "✓" : "✗"}
                          </span>
                          <code className={styles.carrierStatusVar}>
                            {label}
                          </code>
                          {value !== undefined ? (
                            <span className={styles.carrierStatusValue}>
                              {value || "(empty)"}
                            </span>
                          ) : null}
                        </div>
                      );
                      return (
                        <>
                          {statusLine(
                            !!credentialStatus.configured,
                            "credentialStatus.configured",
                          )}
                          {statusLine(
                            !!lalamoveConfig,
                            "lalamoveConfig",
                          )}
                          {statusLine(
                            !!lalamoveConfig?.market,
                            "lalamoveConfig.market",
                            lalamoveConfig?.market,
                          )}
                          {statusLine(
                            !!lalamoveConfig?.preferredServiceType,
                            "lalamoveConfig.preferredServiceType",
                            lalamoveConfig?.preferredServiceType,
                          )}
                          {statusLine(
                            !!lalamoveConfig?.locationName,
                            "lalamoveConfig.locationName",
                            lalamoveConfig?.locationName,
                          )}
                          {statusLine(
                            !!lalamoveConfig?.locationPhone,
                            "lalamoveConfig.locationPhone",
                            lalamoveConfig?.locationPhone,
                          )}
                          {statusLine(
                            !!lalamoveConfig?.locationAddress,
                            "lalamoveConfig.locationAddress",
                            lalamoveConfig?.locationAddress,
                          )}
                          <div
                            className={`${styles.carrierStatusLine} ${styles.carrierStatusResult}`}
                          >
                            <span
                              className={
                                isLalamoveReady
                                  ? styles.carrierStatusOk
                                  : styles.carrierStatusFail
                              }
                            >
                              {isLalamoveReady ? "✓" : "✗"}
                            </span>
                            <code className={styles.carrierStatusVar}>
                              isLalamoveReady
                            </code>
                          </div>
                        </>
                      );
                    })()}
                  </s-stack>
                )}
              </div>
            ) : null}
          </div>
        </s-stack>
      </s-section>
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
                        isFullscreen ? "Collapse map" : "Expand map"
                      }
                      aria-expanded={isFullscreen}
                      onClick={() => setIsFullscreen((current) => !current)}
                    >
                      {isFullscreen ? "[-] Collapse" : "[+] Expand"}
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
                    No coordinates available for the selected filters.
                  </s-text>
                ) : null}
                <div className={styles.mapMetaRow}>
                  <div className={styles.mapLegendOutside}>
                    <s-text>📦 Due today</s-text>
                    <s-text>⏰ Due tomorrow</s-text>
                    <s-text>🕒 Due later</s-text>
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
                      Map style
                    </s-link>
                    {locationId !== DEFAULT_LOCATION_ID ? (
                      <>
                        <s-button
                          variant="secondary"
                          disabled={selectedOrderIds.size === 0}
                          onClick={clearSelection}
                        >
                          Clear selection
                        </s-button>
                        <s-button
                          variant="primary"
                          disabled={
                            selectedOrderIds.size === 0 ||
                            routesWithOrdersCount >= ROUTE_TAGS.size
                          }
                          onClick={handleAssignToNewRoute}
                        >
                          Assign to new route
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
                          Unassigned orders ({unassignedOrders.length})
                        </s-text>
                      </div>
                      {unassignedOrders.length === 0 ? (
                        <s-text color="subdued">
                          No unassigned orders for current filters.
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
                                  <span>Order</span>
                                  <span>Customer</span>
                                  <span>Address</span>
                                </div>
                                {bucket.orders.map((order) => {
                                  const isSelected = selectedOrderIds.has(order.id);
                                  return (
                                    <div key={order.id} className={styles.dueOrdersRow}>
                                      <span>
                                        <s-checkbox
                                          accessibilityLabel={`Select ${order.name}`}
                                          checked={isSelected}
                                          onChange={(event) =>
                                            handleOrderToggle(event, order.id)
                                          }
                                        />
                                      </span>
                                      <span>{order.name}</span>
                                      <span>{formatCustomerShort(order.customerName)}</span>
                                      <span>{order.address1 ?? "No address line 1"}</span>
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
                      <s-select
                        label="Fulfillment location"
                        name="locationId"
                        value={locationId}
                        onChange={handleLocationChange}
                      >
                        <s-option value={DEFAULT_LOCATION_ID}>All locations</s-option>
                        {locations.map((location) => (
                          <s-option key={location.id} value={location.id}>
                            {location.name}
                          </s-option>
                        ))}
                      </s-select>
                      {!isRouteManagerVisible ? (
                        <div className={styles.startDateFieldGroup}>
                          <s-date-field
                            label="Start date"
                            value={startDate}
                            onChange={handleStartDateChange}
                          />
                          <s-text color="subdued">{daysAgoText}</s-text>
                        </div>
                      ) : null}
                      {!isRouteManagerVisible ? (
                        <s-select
                          label="Delivery promisse"
                          value={`${deliveryPromiseDays}`}
                          onChange={handleDeliveryPromiseChange}
                        >
                          <s-option value="1">Next day</s-option>
                          <s-option value="2">Day +2</s-option>
                          <s-option value="3">Day +3</s-option>
                          <s-option value="4">Day +4</s-option>
                        </s-select>
                      ) : null}
                      <div className={styles.asideSummaryRow}>
                        <s-badge>📦 Orders to deliver: {mapData.orders.length}</s-badge>
                      </div>
                      {failedDeliveryCount > 0 ? (
                        <div className={styles.warningLink}>
                          <s-text>⚠️ Failed delivery ({failedDeliveryCount})</s-text>
                        </div>
                      ) : null}
                      {hasUnfulfilledPresaleOrders ? (
                        <s-link onClick={() => setIsPresaleModalOpen(true)}>
                          ⚠️ There are unfulfilled pre-sale orders
                        </s-link>
                      ) : null}
                      {addressErrorOrders.length > 0 ? (
                        <s-link onClick={() => setIsAddressErrorsModalOpen(true)}>
                          ⚠️ Potential address errors ({addressErrorOrders.length})
                        </s-link>
                      ) : null}
                      <div className={styles.asideButtonRow}>
                        <div className={styles.asideButtonRowActions}>
                          <s-button
                            variant="secondary"
                            onClick={() => {
                              autoAssignSelection();
                              handleOptimizeFleet();
                            }}
                            disabled={
                              locationId === DEFAULT_LOCATION_ID ||
                              orders.length === 0 ||
                              optimizeFetcher.state !== "idle" ||
                              unassignedOrders.length === 0
                            }
                          >
                            Auto-assign orders
                          </s-button>
                          <s-button variant="primary" onClick={handleManageOrdersClick}>
                            Manage orders
                          </s-button>
                        </div>
                      </div>
                      {optimizeFetcher.state !== "idle" ? (
                        <div className={styles.autoAssignSpinnerWrap}>
                          <s-stack direction="inline" gap="small">
                            <s-spinner size="base" accessibilityLabel="Auto-assigning orders" />
                            <s-text color="subdued">Auto-assignment in progress</s-text>
                          </s-stack>
                        </div>
                      ) : null}
                      {isRouteManagerVisible ? (
                        <div className={styles.mapBlockFooterRight}>
                          <s-link onClick={() => setIsRouteManagerVisible(false)}>
                            Change settings
                          </s-link>
                        </div>
                      ) : null}
                    </s-stack>
                  </s-section>
                  {isRouteManagerVisible ? (
                  <s-section heading="Route manager">
                    {locationId !== DEFAULT_LOCATION_ID && hasAssignedRoutes ? (
                      <div className={styles.routeManagerHeaderRow}>
                        <span />
                        <s-link onClick={() => setClearAllConfirmOpen(true)}>
                          Clear all routes
                        </s-link>
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
                                    ? "Multiple currencies"
                                    : formatCurrency(
                                        shippingTotal,
                                        shippingAmounts[0]!.currencyCode,
                                      );
                              const label = `Route ${routeIndex + 1}`;
                              const metaLine1 = `${orderCount} orders • Shipping charges: ${formattedShippingTotal}`;
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
                                ? `Cost: ${quoteTotal.total}${quoteTotal.currency ? ` ${quoteTotal.currency}` : ""}`
                                : "Cost: --";
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
                                <s-box
                                  key={route.id}
                                  padding="base"
                                  borderWidth="base"
                                  borderRadius="base"
                                  className={styles.routeCard}
                                >
                                  <div className={styles.routeCardHeader}>
                                    <div className={styles.routeCardHeaderText}>
                                      <span
                                        className={styles.routeBadge}
                                        style={
                                          {
                                            "--badge-bg": badgeColors.bg,
                                            "--badge-text": badgeColors.text,
                                          } as React.CSSProperties
                                        }
                                      >
                                        {label}
                                      </span>
                                    </div>
                                    <s-button
                                      variant="secondary"
                                      tone="critical"
                                      onClick={() =>
                                        setUnassignConfirmRoute({
                                          route,
                                          index: routeIndex,
                                        })
                                      }
                                    >
                                      Clear route
                                    </s-button>
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
                                        Add to route
                                      </s-button>
                                    </div>
                                  ) : (
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
                                          Manage
                                        </s-button>
                                        <s-button
                                          variant="primary"
                                          disabled={!isLalamoveReady || !!dispatchedRoutes[route.id]}
                                          onClick={() => handleRequestDriver(route)}
                                        >
                                          {dispatchedRoutes[route.id] ? "Driver requested" : "Request driver"}
                                        </s-button>
                                      </s-stack>
                                    </s-stack>
                                  )}
                                  {lalamoveStatus[route.id] ? (
                                    <div className={styles.routeCardStatus}>
                                      {lalamoveStatus[route.id].tone === "success" ? (
                                        <s-badge tone="success">
                                          {lalamoveStatus[route.id].message}
                                        </s-badge>
                                      ) : lalamoveStatus[route.id].tone === "critical" ? (
                                        <s-badge tone="critical">
                                          {lalamoveStatus[route.id].message}
                                        </s-badge>
                                      ) : (
                                        <s-text color="subdued">
                                          {lalamoveStatus[route.id].message}
                                        </s-text>
                                      )}
                                    </div>
                                  ) : null}
                                  {dispatchedRoutes[route.id]?.shareLink ? (
                                    <div className={styles.routeCardStatus}>
                                      <s-link url={dispatchedRoutes[route.id].shareLink} target="_blank">
                                        Track delivery →
                                      </s-link>
                                    </div>
                                  ) : null}
                                  {reorderedRoutes[route.id] ? (
                                    <div className={styles.routeCardStatus}>
                                      <s-badge tone="warning">
                                        Re-requested at {reorderedRoutes[route.id]}
                                      </s-badge>
                                    </div>
                                  ) : null}
                                </s-box>
                              );
                            })}
                        </div>
                      </div>
                    ) : (
                      <s-text color="subdued">
                        {locationId === DEFAULT_LOCATION_ID
                          ? "Select a fulfillment location to view assigned routes."
                          : "No assigned routes for this location."}
                      </s-text>
                    )}
                  </s-section>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {!isFullscreen && isRouteManagerVisible ? (
      <s-section heading="Route manager" slot="aside">
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
                  Auto-assigned ({visiblePending.length}{" "}
                  {visiblePending.length === 1 ? "route" : "routes"})
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
                      <s-box
                        key={pr.id}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                        className={styles.routeCard}
                      >
                        <div className={styles.routeCardHeader}>
                          <div className={styles.routeCardHeaderText}>
                            <s-badge tone="info">Auto-routed</s-badge>
                          </div>
                        </div>
                        <div className={styles.routeCardOrderStats}>
                          <s-stack direction="block" gap="small">
                            <s-text type="strong">
                              {stopCount}{" "}
                              {stopCount === 1 ? "stop" : "stops"}
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
                                +{stopCount - 2} more…
                              </s-text>
                            ) : null}
                            {matchedCount < stopCount ? (
                              <s-text color="subdued">
                                {matchedCount}/{stopCount} orders visible in
                                current filters
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
                            Dismiss
                          </s-button>
                          <s-button
                            variant="primary"
                            disabled={!canLoad || isDismissing}
                            onClick={() => handleLoadPendingRoute(pr)}
                          >
                            Load to planner
                          </s-button>
                        </s-stack>
                      </s-box>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {/* ── Manually assigned routes ── */}
          {locationId !== DEFAULT_LOCATION_ID && hasAssignedRoutes ? (
            <div className={styles.routeManagerHeaderRow}>
              <span />
              <s-link onClick={() => setClearAllConfirmOpen(true)}>
                Clear all routes
              </s-link>
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
                          ? "Multiple currencies"
                          : formatCurrency(
                              shippingTotal,
                              shippingAmounts[0]!.currencyCode,
                            );
                    const label = `Route ${routeIndex + 1}`;
                    const metaLine1 = `${orderCount} orders • Shipping charges: ${formattedShippingTotal}`;
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
                      ? `Cost: ${quoteTotal.total}${quoteTotal.currency ? ` ${quoteTotal.currency}` : ""}`
                      : "Cost: --";
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
                      <s-box
                        key={route.id}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                        className={styles.routeCard}
                      >
                        <div className={styles.routeCardHeader}>
                          <div className={styles.routeCardHeaderText}>
                            <span
                              className={styles.routeBadge}
                              style={
                                {
                                  "--badge-bg": badgeColors.bg,
                                  "--badge-text": badgeColors.text,
                                } as React.CSSProperties
                              }
                            >
                              {label}
                            </span>
                          </div>
                          <s-button
                            variant="secondary"
                            tone="critical"
                            onClick={() =>
                              setUnassignConfirmRoute({ route, index: routeIndex })
                            }
                          >
                            Clear route
                          </s-button>
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
                              Add to route
                            </s-button>
                          </div>
                        ) : (
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
                                Manage
                              </s-button>
                              <s-button
                                variant="primary"
                                disabled={!isLalamoveReady || !!dispatchedRoutes[route.id]}
                                onClick={() => handleRequestDriver(route)}
                              >
                                {dispatchedRoutes[route.id] ? "Driver requested" : "Request driver"}
                              </s-button>
                            </s-stack>
                          </s-stack>
                        )}
                        {lalamoveStatus[route.id] ? (
                          <div className={styles.routeCardStatus}>
                            {lalamoveStatus[route.id].tone === "success" ? (
                              <s-badge tone="success">
                                {lalamoveStatus[route.id].message}
                              </s-badge>
                            ) : lalamoveStatus[route.id].tone === "critical" ? (
                              <s-badge tone="critical">
                                {lalamoveStatus[route.id].message}
                              </s-badge>
                            ) : (
                              <s-text color="subdued">
                                {lalamoveStatus[route.id].message}
                              </s-text>
                            )}
                          </div>
                        ) : null}
                        {dispatchedRoutes[route.id]?.shareLink ? (
                          <div className={styles.routeCardStatus}>
                            <s-link url={dispatchedRoutes[route.id].shareLink} target="_blank">
                              Track delivery →
                            </s-link>
                          </div>
                        ) : null}
                        {reorderedRoutes[route.id] ? (
                          <div className={styles.routeCardStatus}>
                            <s-badge tone="warning">
                              Re-requested at {reorderedRoutes[route.id]}
                            </s-badge>
                          </div>
                        ) : null}
                      </s-box>
                    );
                  })}
              </div>
            </div>
          ) : (
            <s-text color="subdued">
              {locationId === DEFAULT_LOCATION_ID
                ? "Select a fulfillment location to view assigned routes."
                : "No assigned routes for this location."}
            </s-text>
          )}
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
                    Add location details to enable Lalamove.
                  </s-badge>
                </s-link>
              </div>
            ) : null;
          })()}
      </s-section>
      ) : null}

      {!isFullscreen && isRouteManagerVisible ? (
        <s-section heading="Auto-assign log" slot="aside">
          {(() => {
            const filteredLogs =
              locationId === DEFAULT_LOCATION_ID
                ? autoAssignLogs
                : autoAssignLogs.filter(
                    (log) => log.locationId === locationId,
                  );
            if (filteredLogs.length === 0) {
              return (
                <s-text color="subdued">
                  {locationId === DEFAULT_LOCATION_ID
                    ? "No auto-assign runs yet."
                    : "No auto-assign runs for this location."}
                </s-text>
              );
            }
            return (
              <ul className={styles.autoAssignLogList}>
                {filteredLogs.map((log) => (
                  <li key={log.id} className={styles.autoAssignLogItem}>
                    <span className={styles.autoAssignLogLink}>
                      <s-link
                        onClick={() => {
                          setSelectedAutoAssignLog(log);
                          setIsAutoAssignLogModalOpen(true);
                        }}
                      >
                        {log.orderName ?? `#${log.orderId}`}
                      </s-link>
                    </span>
                    <s-badge
                      tone={
                        log.status === "assigned"
                          ? "success"
                          : log.status === "skipped"
                            ? "caution"
                            : "critical"
                      }
                    >
                      {log.status}
                    </s-badge>
                    <s-text color="subdued">
                      {new Date(log.createdAt).toLocaleString()}
                    </s-text>
                  </li>
                ))}
              </ul>
            );
          })()}
        </s-section>
      ) : null}

      {!isFullscreen ? (
      <div className={`${styles.mainBlocks} ${styles.unassignedSectionWrap}`}>
        <s-section>
          <s-stack direction="block" gap="base">
            <div className={styles.unassignedHeaderRow}>
              <s-text type="strong">
                Unassigned orders ({unassignedOrders.length})
              </s-text>
            </div>
            {unassignedOrders.length === 0 ? (
              <s-text color="subdued">No unassigned orders for current filters.</s-text>
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
                        <span>Order</span>
                        <span>Customer</span>
                        <span>Address</span>
                      </div>
                      {bucket.orders.map((order) => {
                        const isSelected = selectedOrderIds.has(order.id);
                        return (
                          <div key={order.id} className={styles.dueOrdersRow}>
                            <span>
                              <s-checkbox
                                accessibilityLabel={`Select ${order.name}`}
                                checked={isSelected}
                                onChange={(event) => handleOrderToggle(event, order.id)}
                              />
                            </span>
                            <span>{order.name}</span>
                            <span>{formatCustomerShort(order.customerName)}</span>
                            <span>{order.address1 ?? "No address line 1"}</span>
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

const toQueryValue = (value: string | null, fallback: string) =>
  value && value.length > 0 ? value : fallback;

const toDeliveryMethodType = (value: string) =>
  value.replace("-", "_").toUpperCase();

const getOrderInfoContent = (order: LoaderOrder) => {
  const customer = order.customerName ?? "Guest";
  const address = order.shippingSummary ?? "No shipping address";
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

const formatMoney = (amount: string, currencyCode: string) =>
  `${currencyCode} ${Number(amount).toFixed(2)}`;

const formatCurrency = (amount: number, currencyCode: string) => {
  const locale = currencyCode === "BRL" ? "pt-BR" : "en-US";
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

const formatCustomerShort = (name: string | null) => {
  if (!name) return "Guest";
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toLocaleUpperCase() +
        word.slice(1).toLocaleLowerCase(),
    );
  if (words.length === 0) return "Guest";
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
  issueType: "apartment_in_address1" | "duplicate_number" | null;
  suggestedAddress1: string | null;
  suggestedAddress2: string | null;
};

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
    };
  }

  const numberRegex = /\b\d+\b/g;
  const line1Numbers = line1.match(numberRegex) ?? [];
  const line2Numbers = line2.match(numberRegex) ?? [];
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
    };
  }

  return {
    isValid: true,
    issueType: null,
    suggestedAddress1: line1 || null,
    suggestedAddress2: line2 || null,
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const userLocale =
    typeof session.locale === "string" && session.locale.length > 0
      ? session.locale
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
  const locations = locationsJson.data.locations.nodes as Array<{
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

  const [lalamoveConfigRows, credentialStatus, pendingRoutes, autoAssignLogs] = await Promise.all([
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
    prisma.autoAssignLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 100,
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
                    id
                  }
                }
                locationGroupZones {
                  zone {
                    methodDefinitions {
                      name
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
            locationGroup: { locations: Array<{ id: string }> };
            locationGroupZones: Array<{
              zone: { methodDefinitions: Array<{ name: string | null }> };
            }>;
          }>;
        }) => profile.profileLocationGroups,
      ) ?? [];
    const localIds = new Set<string>();
    profileGroups.forEach((group) => {
      const hasLocalDelivery = group.locationGroupZones.some((zone) =>
        zone.zone.methodDefinitions.some((method) =>
          (method.name ?? "").toLowerCase().includes("local"),
        ),
      );
      if (!hasLocalDelivery) return;
      group.locationGroup.locations.forEach((location) =>
        localIds.add(location.id),
      );
    });
    localDeliveryLocationIds = localIds;
  } catch (error) {
    console.warn(
      "Failed to load delivery profiles for local delivery filtering.",
      error,
    );
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
      const ordersResponse = await admin.graphql(
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

      const ordersJson = await ordersResponse.json();
      const payload = ordersJson?.data?.orders;
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
    warningOrders = warningJson.data.orders.nodes;
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

  const shipmentRequestWarning = warningOrders.some((order) => {
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
  });

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
    shipmentRequestWarning,
    routeStats,
    precomputedRoutes,
    lalamoveConfigs,
    credentialStatus,
    pendingRoutes,
    autoAssignLogs,
    shop,
    userLocale,
    debugLocalDelivery,
    availablePresaleTags,
    hasUnfulfilledPresaleOrders: availablePresaleTags.length > 0,
    failedDeliveryCount,
  };
};

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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const route = formData.get("route");
  const orderIds = formData.getAll("orderIds");

  if (intent === "save-lalamove-settings") {
    const locationId = formData.get("locationId");
    if (typeof locationId !== "string" || !locationId) {
      return { ok: false, error: "Location not provided." };
    }
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
      ).catch((e) => console.warn("Sample rate build failed:", e));
    }
    return { ok: true };
  }

  const ids = orderIds.filter((id): id is string => typeof id === "string");

  if (intent === "unassign-all") {
    const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);
    const orderIdsToClear = ids.length > 0 ? ids : [];
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

      // Apply order tags (same pattern as distance-based branch)
      const allRouteTags = ROUTE_TAG_DEFINITIONS.map((d) => d.tag);
      const allOptimizedIds = result.routes.flatMap((r) => r.orderIds);
      await Promise.all(
        allOptimizedIds.map(async (orderId) => {
          await admin.graphql(
            `#graphql
              mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
                tagsRemove(id: $id, tags: $tags) {
                  userErrors { message }
                }
              }`,
            { variables: { id: orderId, tags: allRouteTags } },
          );
        }),
      );
      await Promise.all(
        result.routes.map(async (route) => {
          const tag = ROUTE_TAG_DEFINITIONS[route.routeIndex]?.tag;
          if (!tag) return;
          await Promise.all(
            route.orderIds.map((orderId) =>
              admin.graphql(
                `#graphql
                  mutation AddOrderTag($id: ID!, $tags: [String!]!) {
                    tagsAdd(id: $id, tags: $tags) {
                      userErrors { message }
                    }
                  }`,
                { variables: { id: orderId, tags: [tag] } },
              ),
            ),
          );
        }),
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

    await Promise.all(
      optimizedOrderIds.map(async (orderId) => {
        await admin.graphql(
          `#graphql
            mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
              tagsRemove(id: $id, tags: $tags) {
                userErrors { message }
              }
            }`,
          { variables: { id: orderId, tags: allRouteTags } },
        );
      }),
    );
    await Promise.all(
      routesInCapacity.map(async (route) => {
        const tag = ROUTE_TAG_DEFINITIONS[route.routeIndex]?.tag;
        if (!tag) return;
        await Promise.all(
          route.orderIds.map((orderId) =>
            admin.graphql(
              `#graphql
                mutation AddOrderTag($id: ID!, $tags: [String!]!) {
                  tagsAdd(id: $id, tags: $tags) {
                    userErrors { message }
                  }
                }`,
              { variables: { id: orderId, tags: [tag] } },
            ),
          ),
        );
      }),
    );

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
            address: formatAddress([o.shippingAddress!.address1, o.shippingAddress!.address2, o.shippingAddress!.city, o.shippingAddress!.province, o.shippingAddress!.zip, o.shippingAddress!.country]),
          }));
        const stops = [
          {
            coordinates: { lat: String(pickupAddress?.latitude ?? 0), lng: String(pickupAddress?.longitude ?? 0) },
            address: formatAddress([pickupAddress?.address1, pickupAddress?.city, pickupAddress?.province, pickupAddress?.country]),
          },
          ...deliveryStops,
        ];
        try {
          const quotation = await createLalamoveQuotation({
            market: config.market,
            language: config.language,
            serviceType: effectiveServiceType,
            stops,
            isRouteOptimized: true,
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
      return { ok: false, error: "Route information missing." };
    }
    if (ids.length === 0) {
      return { ok: false, error: "No orders selected.", routeId };
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
      console.warn("Lalamove settings missing.", { shop, locationId, routeId });
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
    const orderNodes = ordersJson.data.nodes as Array<{
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

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";

    const deliveryStopsRaw = await Promise.all(
      orderNodes.map(async (order) => {
        const address = order.shippingAddress;
        if (!address) return null;
        if (address.latitude == null || address.longitude == null) return null;
        return {
          coordinates: {
            lat: String(address.latitude),
            lng: String(address.longitude),
          },
          address: googleApiKey
            ? await normalizeShippingAddress(address, googleApiKey)
            : formatAddress([
                address.address1,
                address.address2,
                address.city,
                address.province,
                address.zip,
                address.country,
              ]),
        };
      }),
    );
    const deliveryStops = deliveryStopsRaw.filter(
      Boolean,
    ) as Array<{ coordinates: { lat: string; lng: string }; address: string }>;
    if (deliveryStops.length === 0) {
      console.warn("Lalamove quotation missing coordinates.", {
        shop,
        routeId,
        orderCount: orderNodes.length,
      });
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
      (configWithLocation.locationAddress?.trim() || shopifyFormattedAddress) +
      (config.locationDetails?.trim()
        ? `, ${config.locationDetails.trim()}`
        : "");

    // Add 30-minute wait time to each delivery stop for routes with 3+ addresses
    const shouldAddWaitTime = deliveryStops.length >= 3;
    const deliveryStopsWithWait = shouldAddWaitTime
      ? deliveryStops.map((stop) => ({ ...stop, waitTime: 1800 }))
      : deliveryStops;

    const stops = [
      {
        coordinates: {
          lat: String(pickupAddress.latitude),
          lng: String(pickupAddress.longitude),
        },
        address: pickupAddressBase,
      },
      ...deliveryStopsWithWait,
    ];
    try {
      const quotation = await createLalamoveQuotation({
        market: configWithLocation.market,
        language: configWithLocation.language,
        serviceType: configWithLocation.preferredServiceType,
        stops,
        isRouteOptimized: stops.length >= 3,
      }, credentials);
      return { ok: true, routeId, locationId, quotation, orderIds: ids };
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Lalamove quote failed.";
      const message = sanitizeLalamoveErrorMessage(rawMessage);
      console.error("Lalamove quotation failed.", {
        shop,
        routeId,
        locationId,
        message,
      });
      return { ok: false, error: message, routeId };
    }
  }

  if (intent === "lalamove-place-order") {
    const routeId = formData.get("routeId");
    const locationId = formData.get("locationId");
    const quotationId = formData.get("quotationId");
    const quotationTotal = String(formData.get("quotationTotal") ?? "").trim() || null;
    const quotationCurrency = String(formData.get("quotationCurrency") ?? "").trim() || null;
    const stopIds = formData
      .getAll("stopIds")
      .filter((value): value is string => typeof value === "string");
    if (
      typeof routeId !== "string" ||
      typeof locationId !== "string" ||
      typeof quotationId !== "string"
    ) {
      return { ok: false, error: "Missing route or quotation data." };
    }
    if (ids.length === 0 || stopIds.length < 2) {
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
      { variables: { ids } },
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

    const senderStopId = stopIds[0]!;
    const recipientStopIds = stopIds.slice(1);
    const recipients = orderNodes
      .slice(0, recipientStopIds.length)
      .map((order, index) => ({
        stopId: recipientStopIds[index]!,
        name: order.customer?.displayName || order.name || "Customer",
        phone:
          order.customer?.defaultPhoneNumber?.phoneNumber ||
          order.shippingAddress?.phone ||
          order.customer?.phone ||
          config.locationPhone,
        remarks:
          index === 0
            ? [
                ids.length >= 3 ? "Tempo de espera incluído." : "",
                configWithLocation.pickupInstructions?.trim() ?? "",
              ]
                .filter(Boolean)
                .join(" ")
            : (order.shippingAddress?.address2?.trim() ?? ""),
      }));

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
      console.error("Lalamove place order failed.", {
        shop,
        routeId,
        locationId,
        message,
      });
      return { ok: false, error: message, routeId };
    }

    const prismaAny = prisma as any;
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
      data: ids.map((orderId) => ({
        shop,
        dispatchJobId: dispatchJob.id,
        shopifyOrderId: orderId,
        lalamoveOrderId: placeResponse.orderId,
        currentStatus: placeResponse.status,
      })),
    });

    await applyLalamoveDeliveryState(admin, {
      orderIds: ids,
      state: "requested",
      existingFulfillmentId: null,
    });

    return {
      ok: true,
      routeId,
      placedOrderId: placeResponse.orderId,
      shareLink: placeResponse.shareLink ?? null,
    };
  }

  if (intent === "lalamove-check-escalation") {
    const results = await checkAndApplyEscalations(shop, admin);
    return { ok: true, intent: "lalamove-check-escalation", results };
  }

  if (intent === "lalamove-reconcile-status") {
    const lalamoveOrderId = formData.get("lalamoveOrderId");
    const market = formData.get("market");
    if (typeof lalamoveOrderId !== "string" || typeof market !== "string") {
      return { ok: false, error: "Missing reconciliation payload." };
    }
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

    const K = ROUTE_TAG_DEFINITIONS.findIndex((d) => d.tag === routeTag);
    if (K >= 0) {
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
