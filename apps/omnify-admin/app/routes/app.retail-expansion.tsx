import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import styles from "./app.retail-expansion/styles.module.css";
import {
  clearAnalyticsCache,
  readAnalyticsCache,
  readLocationSets,
  readLocations,
  writeAnalyticsCache,
  writeLocationSets,
  writeLocations,
  type AnalyticsCache,
  type LocationSet,
  type RetailLocation,
} from "../retail-expansion/storage.server";
import {
  getMonthsIncluded,
  bucketByMonth,
  monthlyAverageFromBuckets,
} from "../utils/kpi-monthly-average";

type LoaderData = {
  locations: RetailLocation[];
  locationSets: LocationSet[];
  analytics: AnalyticsCache;
  analyticsError: string | null;
  mapsApiKey: string;
  mapsMapId: string;
};

type RollingUnit = "minute" | "hour" | "day" | "week" | "month";

type DateRangeState = {
  mode: "fixed" | "rolling";
  fixed: { startDate: string; endDate: string };
  rolling: { unit: RollingUnit; last: number; includeCurrentPeriod: boolean };
  selectedPresetId?: string | null;
};

type HeatmapWeighting = "orders" | "revenue" | "customers";

const DEFAULT_RADIUS_KM = 10;
const MAPS_SCRIPT_ID = "google-maps-sdk";
const ANALYTICS_PAGE_SIZE = 50;
const MAX_THROTTLE_RETRIES = 5;
const HEATMAP_OPTIONS_STORAGE_KEY_PREFIX = "retail-expansion-heatmap-options";
const DEFAULT_OVERVIEW_CENTER = { lat: -15.793889, lng: -47.882778 };
const DEFAULT_OVERVIEW_ZOOM = 4;
const LOCAL_SCALING_STORAGE_KEY_PREFIX = "retail-expansion-local-scaling";

const CITY_ALIASES: Record<string, string> = {
  "sao paulo sp": "sao paulo",
  "sao paulo - sp": "sao paulo",
  sp: "sao paulo",
  "rio de janeiro rj": "rio de janeiro",
  "rio de janeiro - rj": "rio de janeiro",
  rj: "rio de janeiro",
};

let mapsLoader: Promise<void> | null = null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isThrottledGraphqlPayload = (json: any) => {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  return errors.some((error: any) =>
    String(error?.message ?? "").toLowerCase().includes("throttl"),
  );
};

const graphqlJsonWithRetry = async (
  admin: any,
  query: string,
  variables: Record<string, unknown>,
) => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_THROTTLE_RETRIES; attempt += 1) {
    try {
      const response = await admin.graphql(query, { variables });
      const json = await response.json();

      if (isThrottledGraphqlPayload(json)) {
        lastError = new Error("Throttled");
        if (attempt < MAX_THROTTLE_RETRIES) {
          await sleep(300 * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }

      if (Array.isArray(json?.errors) && json.errors.length > 0) {
        throw new Error(
          json.errors
            .map((error: any) => String(error?.message ?? "Unknown GraphQL error"))
            .join("; "),
        );
      }

      return json;
    } catch (error) {
      const message = String((error as Error)?.message ?? "");
      const throttled = message.toLowerCase().includes("throttl");
      lastError = error;
      if (throttled && attempt < MAX_THROTTLE_RETRIES) {
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("Failed to execute GraphQL request.");
};

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
    )}&v=weekly&libraries=marker,places,visualization`;
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

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const earthRadius = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const formatMoney = (amount: number, currencyCode: string | null) => {
  if (!currencyCode) return "--";
  return `${currencyCode} ${amount.toFixed(2)}`;
};

const formatCurrencyCompact = (amount: number, currencyCode: string | null) => {
  if (!currencyCode) return "--";
  const formatted = amount.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
  return currencyCode === "BRL" ? `R$${formatted}` : `${currencyCode} ${formatted}`;
};

const formatRangeSummary = (range: DateRangeState) => {
  if (range.mode === "rolling") {
    const unitLabel = range.rolling.last === 1 ? range.rolling.unit : `${range.rolling.unit}s`;
    return `Last ${range.rolling.last} ${unitLabel}`;
  }
  return `${range.fixed.startDate} - ${range.fixed.endDate}`;
};

const toTitleCase = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeCityKey = (city: string | null | undefined) => {
  if (!city) return "unknown city";
  const normalized = city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "unknown city";
  return CITY_ALIASES[normalized] ?? normalized;
};

const toDisplayCity = (cityKey: string, city: string) => {
  if (cityKey === "unknown city") return "Unknown city";
  return city || toTitleCase(cityKey);
};

const shiftDateByUnit = (value: Date, unit: RollingUnit, amount: number) => {
  const next = new Date(value);
  switch (unit) {
    case "minute":
      next.setMinutes(next.getMinutes() + amount);
      break;
    case "hour":
      next.setHours(next.getHours() + amount);
      break;
    case "day":
      next.setDate(next.getDate() + amount);
      break;
    case "week":
      next.setDate(next.getDate() + amount * 7);
      break;
    case "month":
      next.setMonth(next.getMonth() + amount);
      break;
  }
  return next;
};

const startOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
};

const getDateRangeBounds = (range: DateRangeState) => {
  if (range.mode === "fixed") {
    const start = new Date(range.fixed.startDate);
    const end = new Date(range.fixed.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }
    return {
      start: startOfDay(start),
      end: endOfDay(end),
    };
  }

  const now = new Date();
  const end = range.rolling.includeCurrentPeriod
    ? now
    : shiftDateByUnit(now, range.rolling.unit, -1);
  const start = shiftDateByUnit(end, range.rolling.unit, -(range.rolling.last - 1));
  return {
    start: startOfDay(start),
    end: endOfDay(end),
  };
};

const isWithinRange = (createdAt: string | null, range: DateRangeState) => {
  if (!createdAt) return false;
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return false;
  const bounds = getDateRangeBounds(range);
  if (!bounds) return false;
  return parsed >= bounds.start && parsed <= bounds.end;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [locations, locationSets, analytics] = await Promise.all([
    readLocations(shop),
    readLocationSets(shop),
    readAnalyticsCache(shop),
  ]);

  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
  const mapsMapId = process.env.GOOGLE_MAPS_MAP_ID?.trim() || "";

  let analyticsError: string | null = null;
  let updatedAnalytics = analytics;
  if (analytics.updatedAt === null) {
    try {
      updatedAnalytics = await backfillAnalytics(admin, analytics, shop);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load analytics data.";
      analyticsError = message.includes("not approved")
        ? "This app needs protected customer data approval to access customer email. Remove sensitive fields or request access in the Partner Dashboard."
        : message;
    }
  }

  return {
    locations,
    locationSets,
    analytics: updatedAnalytics,
    analyticsError,
    mapsApiKey,
    mapsMapId,
  };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "add-location") {
    const name = String(formData.get("name") || "").trim();
    const latitude = Number(formData.get("latitude"));
    const longitude = Number(formData.get("longitude"));
    if (!name || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      return { ok: false, error: "Missing location details." };
    }
    const locations = await readLocations(shop);
    const next: RetailLocation = {
      id: `loc-${Date.now()}`,
      name,
      latitude,
      longitude,
      createdAt: new Date().toISOString(),
    };
    await writeLocations([...locations, next], shop);
    return { ok: true, location: next };
  }

  if (intent === "remove-location") {
    const locationId = String(formData.get("locationId") || "");
    const locations = await readLocations(shop);
    await writeLocations(locations.filter((loc) => loc.id !== locationId), shop);
    return { ok: true };
  }

  if (intent === "clear-locations") {
    await writeLocations([], shop);
    return { ok: true };
  }

  if (intent === "save-location-set") {
    const setName = String(formData.get("setName") || "").trim();
    if (!setName) {
      return { ok: false, error: "Missing set name." };
    }
    const [locations, sets] = await Promise.all([
      readLocations(shop),
      readLocationSets(shop),
    ]);
    const nextSet: LocationSet = {
      id: `set-${Date.now()}`,
      name: setName,
      locations,
      createdAt: new Date().toISOString(),
    };
    await writeLocationSets([...sets, nextSet], shop);
    await writeLocations(nextSet.locations, shop);
    return { ok: true, setId: nextSet.id };
  }

  if (intent === "load-location-set") {
    const setId = String(formData.get("setId") || "");
    const sets = await readLocationSets(shop);
    const match = sets.find((set) => set.id === setId);
    if (match) {
      await writeLocations(match.locations, shop);
    }
    return { ok: true };
  }

  if (intent === "update-location-set") {
    const setId = String(formData.get("setId") || "");
    const setName = String(formData.get("setName") || "").trim();
    const locationsJson = formData.get("locations");
    let locations: RetailLocation[] = [];
    if (locationsJson && typeof locationsJson === "string") {
      try {
        locations = JSON.parse(locationsJson) as RetailLocation[];
      } catch {
        return { ok: false, error: "Invalid locations payload." };
      }
    }
    const sets = await readLocationSets(shop);
    const idx = sets.findIndex((s) => s.id === setId);
    if (idx < 0) return { ok: false, error: "Project not found." };
    const next = [...sets];
    next[idx] = {
      ...next[idx],
      name: setName || next[idx].name,
      locations,
    };
    await writeLocationSets(next, shop);
    return { ok: true };
  }

  if (intent === "delete-location-set") {
    const setId = String(formData.get("setId") || "");
    if (!setId) {
      return { ok: false, error: "Missing project id." };
    }
    const sets = await readLocationSets(shop);
    await writeLocationSets(sets.filter((set) => set.id !== setId), shop);
    await writeLocations([], shop);
    return { ok: true };
  }

  if (intent === "sync-analytics") {
    await clearAnalyticsCache(shop);
    return { ok: true };
  }

  return { ok: false, error: "Unknown action." };
};

export default function RetailLocatorRoute() {
  const {
    locations,
    locationSets,
    analytics,
    analyticsError,
    mapsApiKey,
    mapsMapId,
  } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [locationName, setLocationName] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const newProjectAutocompleteContainerRef = useRef<HTMLDivElement | null>(null);
  const loadedProjectAutocompleteContainerRef = useRef<HTMLDivElement | null>(
    null,
  );
  const newProjectAutocompleteRef = useRef<any>(null);
  const loadedProjectAutocompleteRef = useRef<any>(null);
  const newProjectAutocompleteListenerRef = useRef<((event: any) => void) | null>(
    null,
  );
  const loadedProjectAutocompleteListenerRef = useRef<((event: any) => void) | null>(
    null,
  );
  const [selectedSetId, setSelectedSetId] = useState("");
  const selectionMapRef = useRef<HTMLDivElement | null>(null);
  const overviewMapRef = useRef<HTMLDivElement | null>(null);
  const selectionMapInstance = useRef<any>(null);
  const selectionMarker = useRef<any>(null);
  const overviewMapInstance = useRef<any>(null);
  const overviewMarkers = useRef<any[]>([]);
  const overviewHeatmapLayer = useRef<any>(null);
  const overviewZoomListener = useRef<any>(null);
  const overviewIdleListener = useRef<any>(null);
  const overviewIdleDebounce = useRef<number | null>(null);
  const [mapsLoadError, setMapsLoadError] = useState<string | null>(null);
  const [setName, setSetName] = useState("");
  const [showSelectionMap, setShowSelectionMap] = useState(false);
  const [mapLocationName, setMapLocationName] = useState("");
  const [showLoadedProject, setShowLoadedProject] = useState(false);
  const [isHeatmapExpanded, setIsHeatmapExpanded] = useState(false);
  const [showNationalViewReset, setShowNationalViewReset] = useState(false);
  const [storedCityName, setStoredCityName] = useState<string | null>(null);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editingSetName, setEditingSetName] = useState("");
  const [editingSetLocations, setEditingSetLocations] = useState<RetailLocation[]>(
    [],
  );
  const [lastClickedCity, setLastClickedCity] = useState<{
    lat: number;
    lng: number;
    city: string;
  } | null>(null);
  const [heatmapWeightApplied, setHeatmapWeightApplied] =
    useState<HeatmapWeighting>("orders");
  const [localScalingDraft, setLocalScalingDraft] = useState(true);
  const [localScalingApplied, setLocalScalingApplied] = useState(true);
  const [showCustomDates, setShowCustomDates] = useState(false);
  const [dateRangeDraft, setDateRangeDraft] = useState<DateRangeState>(() => {
    const today = new Date();
    const formatted = today.toISOString().slice(0, 10);
    return {
      mode: "rolling" as "fixed" | "rolling",
      fixed: { startDate: formatted, endDate: formatted },
      rolling: { unit: "month" as RollingUnit, last: 12, includeCurrentPeriod: true },
      selectedPresetId: "last-12-months",
    };
  });
  const [dateRangeApplied, setDateRangeApplied] = useState<DateRangeState>(() => {
    const today = new Date();
    const formatted = today.toISOString().slice(0, 10);
    return {
      mode: "rolling" as "fixed" | "rolling",
      fixed: { startDate: formatted, endDate: formatted },
      rolling: { unit: "month" as RollingUnit, last: 12, includeCurrentPeriod: true },
      selectedPresetId: "last-12-months",
    };
  });

  const selectedSetName =
    locationSets.find((set) => set.id === selectedSetId)?.name || "Project";
  const heatmapOptionsStorageKey = `${HEATMAP_OPTIONS_STORAGE_KEY_PREFIX}-${
    selectedSetId || "global"
  }`;
  const localScalingStorageKey = `${LOCAL_SCALING_STORAGE_KEY_PREFIX}-${
    selectedSetId || "global"
  }`;

  const presets = useMemo(
    () => [
      {
        id: "last-30-days",
        label: "Last 30 days",
        getRange: (): DateRangeState => ({
          mode: "rolling",
          fixed: { startDate: "", endDate: "" },
          rolling: { unit: "day", last: 30, includeCurrentPeriod: true },
          selectedPresetId: "last-30-days",
        }),
      },
      {
        id: "last-90-days",
        label: "Last 90 days",
        getRange: (): DateRangeState => ({
          mode: "rolling",
          fixed: { startDate: "", endDate: "" },
          rolling: { unit: "day", last: 90, includeCurrentPeriod: true },
          selectedPresetId: "last-90-days",
        }),
      },
      {
        id: "last-6-months",
        label: "Last 6 months",
        getRange: (): DateRangeState => ({
          mode: "rolling",
          fixed: { startDate: "", endDate: "" },
          rolling: { unit: "month", last: 6, includeCurrentPeriod: true },
          selectedPresetId: "last-6-months",
        }),
      },
      {
        id: "last-12-months",
        label: "Last 12 months",
        getRange: (): DateRangeState => ({
          mode: "rolling",
          fixed: { startDate: "", endDate: "" },
          rolling: { unit: "month", last: 12, includeCurrentPeriod: true },
          selectedPresetId: "last-12-months",
        }),
      },
    ],
    [],
  );

  const filteredCustomers = useMemo(
    () =>
      analytics.customers.filter((customer) =>
        isWithinRange(customer.createdAt, dateRangeApplied),
      ),
    [analytics.customers, dateRangeApplied],
  );

  const filteredOrders = useMemo(
    () =>
      analytics.orders.filter((order) =>
        isWithinRange(order.createdAt, dateRangeApplied),
      ),
    [analytics.orders, dateRangeApplied],
  );
  const geocodedOrders = useMemo(
    () =>
      filteredOrders.filter(
        (
          order,
        ): order is typeof order & { latitude: number; longitude: number } =>
          order.latitude != null && order.longitude != null,
      ),
    [filteredOrders],
  );

  const metrics = useMemo(() => {
    const customers = filteredCustomers;
    const orders = geocodedOrders;
    const radiusArea = Math.PI * radiusKm * radiusKm;

    return locations
      .map((location) => {
        const customersWithin = customers.filter((customer) => {
          const distance = haversineKm(
            location.latitude,
            location.longitude,
            customer.latitude,
            customer.longitude,
          );
          return distance <= radiusKm;
        });
        const ordersWithin = orders.filter((order) => {
          const distance = haversineKm(
            location.latitude,
            location.longitude,
            order.latitude,
            order.longitude,
          );
          return distance <= radiusKm;
        });
        const totalRevenue = ordersWithin.reduce((sum, order) => {
          return sum + (order.totalAmount ?? 0);
        }, 0);
        const currencyCode =
          ordersWithin.find((order) => order.currencyCode)?.currencyCode ?? null;
        const customerCount = customersWithin.length || ordersWithin.length;
        const avgValue =
          customerCount > 0 ? totalRevenue / customerCount : 0;
        const density =
          customerCount > 0 ? customerCount / radiusArea : 0;
        return {
          ...location,
          customerCount,
          totalRevenue,
          avgValue,
          density,
          currencyCode,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [filteredCustomers, geocodedOrders, locations, radiusKm]);

  const projectTableData = useMemo(() => {
    return locationSets.map((set) => {
      const orderIds = new Set<string>();
      const customerIds = new Set<string>();
      let totalRevenue = 0;
      for (const loc of set.locations) {
        geocodedOrders.forEach((order) => {
          const distance = haversineKm(
            loc.latitude,
            loc.longitude,
            order.latitude!,
            order.longitude!,
          );
          if (distance <= radiusKm && !orderIds.has(order.id)) {
            orderIds.add(order.id);
            totalRevenue += order.totalAmount ?? 0;
            if (order.customerId) customerIds.add(order.customerId);
          }
        });
        filteredCustomers.forEach((customer) => {
          const distance = haversineKm(
            loc.latitude,
            loc.longitude,
            customer.latitude,
            customer.longitude,
          );
          if (distance <= radiusKm) customerIds.add(customer.id);
        });
      }
      const currencyCode =
        geocodedOrders.find((o) => o.currencyCode)?.currencyCode ?? null;
      return {
        id: set.id,
        name: set.name,
        locationCount: set.locations.length,
        totalRevenue,
        orderCount: orderIds.size,
        customerCount: customerIds.size,
        currencyCode,
      };
    });
  }, [
    locationSets,
    geocodedOrders,
    filteredCustomers,
    radiusKm,
  ]);

  const cityMonthlyKpis = useMemo(() => {
    const bounds = getDateRangeBounds(dateRangeApplied);
    const tz = "UTC";
    const monthsIncluded = bounds
      ? getMonthsIncluded(bounds.start, bounds.end)
      : [];
    const numMonths = Math.max(monthsIncluded.length, 1);

    const grouped = new Map<
      string,
      {
        city: string;
        currencyCode: string | null;
        latitudeSum: number;
        longitudeSum: number;
        geocodedCount: number;
        orders: typeof filteredOrders;
      }
    >();
    filteredOrders.forEach((order) => {
      const originalCity = (order.city ?? "").trim();
      const cityKey = normalizeCityKey(originalCity);
      const current = grouped.get(cityKey);
      if (current) {
        current.orders.push(order);
      } else {
        grouped.set(cityKey, {
          city: toDisplayCity(cityKey, originalCity),
          currencyCode: order.currencyCode ?? null,
          latitudeSum: 0,
          longitudeSum: 0,
          geocodedCount: 0,
          orders: [order],
        });
      }
    });
    grouped.forEach((entry) => {
      entry.orders.forEach((order) => {
        if (order.latitude != null && order.longitude != null) {
          entry.latitudeSum += order.latitude;
          entry.longitudeSum += order.longitude;
          entry.geocodedCount += 1;
        }
        if (order.currencyCode && !entry.currencyCode) {
          entry.currencyCode = order.currencyCode;
        }
      });
    });

    return Array.from(grouped.values()).map((item) => {
      const orders = item.orders;
      if (!bounds || monthsIncluded.length === 0) {
        const totalRevenue = orders.reduce((s, o) => s + (o.totalAmount ?? 0), 0);
        const customerIds = new Set(
          orders.map((o) => o.customerId).filter(Boolean),
        ) as Set<string>;
        return {
          city: item.city,
          totalRevenue,
          totalOrders: orders.length,
          currencyCode: item.currencyCode,
          latitudeSum: item.latitudeSum,
          longitudeSum: item.longitudeSum,
          geocodedCount: item.geocodedCount,
          customerIds,
          revenueMonthlyAverage: totalRevenue / numMonths,
          ordersMonthlyAverage: orders.length / numMonths,
          customersMonthlyAverage: customerIds.size / numMonths,
          latitude:
            item.geocodedCount > 0 ? item.latitudeSum / item.geocodedCount : null,
          longitude:
            item.geocodedCount > 0 ? item.longitudeSum / item.geocodedCount : null,
        };
      }
      const revenueBuckets = bucketByMonth(
        orders,
        (o) => o.createdAt,
        (o) => o.totalAmount ?? 0,
        bounds.start,
        bounds.end,
        tz,
      );
      const orderBuckets = bucketByMonth(
        orders,
        (o) => o.createdAt,
        () => 1,
        bounds.start,
        bounds.end,
        tz,
      );
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
      });
      const uniqueCustomersByMonth = new Map<string, Set<string>>();
      monthsIncluded.forEach((m) => uniqueCustomersByMonth.set(m, new Set()));
      orders.forEach((order) => {
        if (!order.createdAt || !order.customerId) return;
        const date = new Date(order.createdAt);
        const parts = formatter.formatToParts(date);
        const y = parts.find((p) => p.type === "year")?.value ?? "";
        const m = parts.find((p) => p.type === "month")?.value ?? "";
        const key = `${y}-${m}`;
        if (uniqueCustomersByMonth.has(key)) {
          uniqueCustomersByMonth.get(key)!.add(order.customerId!);
        }
      });
      const customerBucketsFinal: Record<string, number> = {};
      uniqueCustomersByMonth.forEach((set, month) => {
        customerBucketsFinal[month] = set.size;
      });

      return {
        city: item.city,
        totalRevenue: orders.reduce((s, o) => s + (o.totalAmount ?? 0), 0),
        totalOrders: orders.length,
        currencyCode: item.currencyCode,
        latitudeSum: item.latitudeSum,
        longitudeSum: item.longitudeSum,
        geocodedCount: item.geocodedCount,
        customerIds: new Set(
          orders.map((o) => o.customerId).filter(Boolean),
        ) as Set<string>,
        revenueMonthlyAverage: monthlyAverageFromBuckets(
          revenueBuckets,
          monthsIncluded,
        ),
        ordersMonthlyAverage: monthlyAverageFromBuckets(
          orderBuckets,
          monthsIncluded,
        ),
        customersMonthlyAverage: monthlyAverageFromBuckets(
          customerBucketsFinal,
          monthsIncluded,
        ),
        latitude:
          item.geocodedCount > 0 ? item.latitudeSum / item.geocodedCount : null,
        longitude:
          item.geocodedCount > 0 ? item.longitudeSum / item.geocodedCount : null,
      };
    });
  }, [filteredOrders, dateRangeApplied]);

  const topCitiesRevenueMonthly = useMemo(
    () =>
      [...cityMonthlyKpis]
        .sort((a, b) => b.revenueMonthlyAverage - a.revenueMonthlyAverage)
        .slice(0, 15),
    [cityMonthlyKpis],
  );

  const topCitiesOrdersMonthly = useMemo(() => {
    return [...cityMonthlyKpis]
      .sort((a, b) => b.ordersMonthlyAverage - a.ordersMonthlyAverage)
      .slice(0, 15);
  }, [cityMonthlyKpis]);

  const topCitiesCustomersMonthly = useMemo(() => {
    return [...cityMonthlyKpis]
      .sort((a, b) => b.customersMonthlyAverage - a.customersMonthlyAverage)
      .slice(0, 15);
  }, [cityMonthlyKpis]);

  const topCitiesByMetric = useMemo(() => {
    if (heatmapWeightApplied === "revenue") return topCitiesRevenueMonthly;
    if (heatmapWeightApplied === "customers") return topCitiesCustomersMonthly;
    return topCitiesOrdersMonthly;
  }, [
    heatmapWeightApplied,
    topCitiesRevenueMonthly,
    topCitiesCustomersMonthly,
    topCitiesOrdersMonthly,
  ]);

  const focusCity = (lat: number | null, lng: number | null) => {
    if (lat == null || lng == null) return;
    overviewMapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!overviewMapInstance.current) return;
    overviewMapInstance.current.panTo({ lat, lng });
    overviewMapInstance.current.setZoom(12);
  };

  const resetToNationalView = () => {
    if (!overviewMapInstance.current) return;
    overviewMapInstance.current.panTo(DEFAULT_OVERVIEW_CENTER);
    overviewMapInstance.current.setZoom(DEFAULT_OVERVIEW_ZOOM);
    setShowNationalViewReset(false);
  };

  const updateLocalScaling = (googleMaps: any) => {
    if (!overviewMapInstance.current || !overviewHeatmapLayer.current) return;
    if (!localScalingApplied) {
      overviewHeatmapLayer.current.set("maxIntensity", null);
      return;
    }
    const bounds = overviewMapInstance.current.getBounds?.();
    if (!bounds) return;
    const visiblePoints = heatmapPoints.filter((point) =>
      bounds.contains(new googleMaps.LatLng(point.lat, point.lng)),
    );
    const dynamicMax = Math.max(5, visiblePoints.length * 0.1);
    overviewHeatmapLayer.current.set("maxIntensity", dynamicMax);
  };

  const heatmapPoints = useMemo(() => {
    if (heatmapWeightApplied === "customers") {
      return filteredCustomers.map((customer) => ({
        lat: customer.latitude,
        lng: customer.longitude,
        weight: 1,
      }));
    }

    if (heatmapWeightApplied === "revenue") {
      return geocodedOrders.map((order) => ({
        lat: order.latitude,
        lng: order.longitude,
        weight: Math.max(order.totalAmount ?? 0, 0),
      }));
    }

    return geocodedOrders.map((order) => ({
      lat: order.latitude,
      lng: order.longitude,
      weight: 1,
    }));
  }, [filteredCustomers, geocodedOrders, heatmapWeightApplied]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(localScalingStorageKey);
    if (saved === "true" || saved === "false") {
      const enabled = saved === "true";
      setLocalScalingApplied(enabled);
      setLocalScalingDraft(enabled);
      return;
    }
    setLocalScalingApplied(true);
    setLocalScalingDraft(true);
  }, [localScalingStorageKey]);

  useEffect(() => {
    if (!overviewMapInstance.current || !overviewHeatmapLayer.current) return;
    const googleMaps = window.google?.maps;
    if (!googleMaps) return;
    updateLocalScaling(googleMaps);
  }, [localScalingApplied, heatmapPoints]);

  useEffect(
    () => () => {
      if (overviewIdleDebounce.current != null) {
        window.clearTimeout(overviewIdleDebounce.current);
      }
      if (overviewIdleListener.current && window.google?.maps?.event?.removeListener) {
        window.google.maps.event.removeListener(overviewIdleListener.current);
        overviewIdleListener.current = null;
      }
      if (overviewZoomListener.current && window.google?.maps?.event?.removeListener) {
        window.google.maps.event.removeListener(overviewZoomListener.current);
        overviewZoomListener.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!mapsApiKey || !mapsMapId) return;
    if (!overviewMapRef.current) return;

    let isMounted = true;

    loadGoogleMaps(mapsApiKey)
      .then(async () => {
        if (!isMounted) return;
        const googleMaps = window.google?.maps;
        if (!googleMaps) {
          setMapsLoadError("Google Maps SDK not available.");
          return;
        }
        setMapsLoadError(null);
        const { Map } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("maps")
          : { Map: googleMaps.Map };
        const { AdvancedMarkerElement } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("marker")
          : { AdvancedMarkerElement: googleMaps.marker?.AdvancedMarkerElement };
        const { HeatmapLayer } = googleMaps.importLibrary
          ? await googleMaps.importLibrary("visualization")
          : { HeatmapLayer: googleMaps.visualization?.HeatmapLayer };
        if (showSelectionMap && selectionMapRef.current && !selectionMapInstance.current) {
          selectionMapInstance.current = new Map(selectionMapRef.current!, {
            center: DEFAULT_OVERVIEW_CENTER,
            zoom: DEFAULT_OVERVIEW_ZOOM,
            mapId: mapsMapId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
          });
          selectionMapInstance.current.addListener(
            "click",
            (event: { latLng: { lat: () => number; lng: () => number } }) => {
              const lat = event.latLng.lat();
              const lng = event.latLng.lng();
              setSelectedPoint({ latitude: lat, longitude: lng });
              if (selectionMarker.current) {
                selectionMarker.current.position = { lat, lng };
              } else if (AdvancedMarkerElement) {
                selectionMarker.current = new AdvancedMarkerElement({
                  map: selectionMapInstance.current,
                  position: { lat, lng },
                });
              }
            },
          );
        }

        if (!overviewMapInstance.current) {
          overviewMapInstance.current = new Map(overviewMapRef.current!, {
            center: DEFAULT_OVERVIEW_CENTER,
            zoom: DEFAULT_OVERVIEW_ZOOM,
            mapId: mapsMapId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
          });
          if (overviewZoomListener.current && googleMaps.event?.removeListener) {
            googleMaps.event.removeListener(overviewZoomListener.current);
          }
          overviewZoomListener.current = overviewMapInstance.current.addListener(
            "zoom_changed",
            () => {
              const zoom = overviewMapInstance.current?.getZoom?.() ?? DEFAULT_OVERVIEW_ZOOM;
              setShowNationalViewReset(zoom > 6);
            },
          );
        }

        overviewMarkers.current.forEach((marker) => (marker.map = null));
        overviewMarkers.current = [];

        metrics.forEach((location, index) => {
          if (!AdvancedMarkerElement) return;
          const medal =
            index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "📍";
          const content = document.createElement("div");
          content.className = styles.mapLabel;
          content.textContent = `${medal} ${location.name}`;
          const marker = new AdvancedMarkerElement({
            map: overviewMapInstance.current,
            position: { lat: location.latitude, lng: location.longitude },
            content,
            title: location.name,
          });
          overviewMarkers.current.push(marker);
        });

        if (overviewHeatmapLayer.current) {
          overviewHeatmapLayer.current.setMap(null);
          overviewHeatmapLayer.current = null;
        }
        if (HeatmapLayer && heatmapPoints.length > 0) {
          const heatData = heatmapPoints.map((point) => ({
            location: new googleMaps.LatLng(point.lat, point.lng),
            weight: point.weight,
          }));
          overviewHeatmapLayer.current = new HeatmapLayer({
            data: heatData,
            dissipating: true,
            radius: 24,
            opacity: 0.7,
            map: overviewMapInstance.current,
          });
          if (overviewIdleListener.current && googleMaps.event?.removeListener) {
            googleMaps.event.removeListener(overviewIdleListener.current);
          }
          if (overviewIdleDebounce.current != null) {
            window.clearTimeout(overviewIdleDebounce.current);
            overviewIdleDebounce.current = null;
          }
          overviewIdleListener.current = overviewMapInstance.current.addListener(
            "idle",
            () => {
              if (overviewIdleDebounce.current != null) {
                window.clearTimeout(overviewIdleDebounce.current);
              }
              overviewIdleDebounce.current = window.setTimeout(() => {
                updateLocalScaling(googleMaps);
              }, 200);
            },
          );
          updateLocalScaling(googleMaps);
        } else {
          if (overviewIdleListener.current && googleMaps.event?.removeListener) {
            googleMaps.event.removeListener(overviewIdleListener.current);
            overviewIdleListener.current = null;
          }
          if (overviewIdleDebounce.current != null) {
            window.clearTimeout(overviewIdleDebounce.current);
            overviewIdleDebounce.current = null;
          }
        }

        if (metrics.length > 0) {
          const bounds = new googleMaps.LatLngBounds();
          metrics.forEach((location) => {
            bounds.extend({ lat: location.latitude, lng: location.longitude });
          });
          overviewMapInstance.current.fitBounds(bounds, {
            top: 48,
            right: 48,
            bottom: 48,
            left: 48,
          });
        }
      })
      .catch((error) => {
        console.error("Failed to load Google Maps", error);
        setMapsLoadError(
          "Google Maps failed to load. Check your API key and billing setup.",
        );
      });

    return () => {
      isMounted = false;
    };
  }, [
    mapsApiKey,
    mapsMapId,
    metrics,
    showSelectionMap,
    heatmapPoints,
    localScalingApplied,
  ]);

  useEffect(() => {
    if (!mapsApiKey || !mapsMapId) return;

    let isMounted = true;

    const setupAutocomplete = async (
      containerRef: { current: HTMLDivElement | null },
      elementRef: { current: any },
      listenerRef: { current: ((event: any) => void) | null },
    ) => {
      if (!containerRef.current) return;
      const googleMaps = window.google?.maps;
      if (!googleMaps) return;
      const { PlaceAutocompleteElement } = googleMaps.importLibrary
        ? await googleMaps.importLibrary("places")
        : { PlaceAutocompleteElement: googleMaps.places?.PlaceAutocompleteElement };
      if (!PlaceAutocompleteElement) return;

      const createHandler = () => async (event: any) => {
        const prediction =
          event?.placePrediction ?? event?.detail?.placePrediction ?? null;
        if (!prediction) return;
        const place = prediction.toPlace();
        await place.fetchFields({
          fields: ["displayName", "formattedAddress", "location", "viewport"],
        });
        const displayName =
          place.displayName || place.formattedAddress || "";
        setLocationName(displayName);
        if (!place.location) return;
        const lat = place.location.lat();
        const lng = place.location.lng();
        setSelectedPoint({ latitude: lat, longitude: lng });
        if (selectionMapInstance.current && selectionMarker.current) {
          selectionMarker.current.position = { lat, lng };
        } else if (
          selectionMapInstance.current &&
          googleMaps.marker?.AdvancedMarkerElement
        ) {
          selectionMarker.current = new googleMaps.marker.AdvancedMarkerElement({
            map: selectionMapInstance.current,
            position: { lat, lng },
          });
        }
        if (selectionMapInstance.current) {
          if (place.viewport) {
            selectionMapInstance.current.fitBounds(place.viewport);
          } else {
            selectionMapInstance.current.setCenter({ lat, lng });
            selectionMapInstance.current.setZoom(15);
          }
        }
      };

      if (elementRef.current) {
        if (!containerRef.current.contains(elementRef.current)) {
          containerRef.current.appendChild(elementRef.current);
        }
        if (!listenerRef.current) {
          const handler = createHandler();
          elementRef.current.addEventListener("gmp-select", handler);
          listenerRef.current = handler;
        }
        return;
      }

      const element = new PlaceAutocompleteElement({});
      const handler = createHandler();
      element.addEventListener("gmp-select", handler);
      containerRef.current.appendChild(element);
      elementRef.current = element;
      listenerRef.current = handler;
    };

    loadGoogleMaps(mapsApiKey)
      .then(async () => {
        if (!isMounted) return;
        await setupAutocomplete(
          newProjectAutocompleteContainerRef,
          newProjectAutocompleteRef,
          newProjectAutocompleteListenerRef,
        );
        await setupAutocomplete(
          loadedProjectAutocompleteContainerRef,
          loadedProjectAutocompleteRef,
          loadedProjectAutocompleteListenerRef,
        );
      })
      .catch((error) => {
        console.error("Failed to load Google Maps Places", error);
        setMapsLoadError(
          "Google Maps Places failed to load. Check your API key and billing setup.",
        );
      });

    return () => {
      isMounted = false;
      const cleanup = (
        elementRef: { current: any },
        listenerRef: { current: ((event: any) => void) | null },
      ) => {
        if (elementRef.current && listenerRef.current) {
          elementRef.current.removeEventListener(
            "gmp-select",
            listenerRef.current,
          );
          listenerRef.current = null;
        }
      };
      cleanup(newProjectAutocompleteRef, newProjectAutocompleteListenerRef);
      cleanup(loadedProjectAutocompleteRef, loadedProjectAutocompleteListenerRef);
    };
  }, [mapsApiKey, mapsMapId, showLoadedProject]);

  const clearAutocompleteInputs = () => {
    const clear = (elementRef: { current: any }) => {
      if (elementRef.current) {
        elementRef.current.value = "";
        elementRef.current.place = null;
      }
      if (elementRef.current?.inputElement) {
        elementRef.current.inputElement.value = "";
      }
    };
    clear(newProjectAutocompleteRef);
    clear(loadedProjectAutocompleteRef);
  };

  const addLocation = (
    name: string,
    point: { latitude: number; longitude: number },
  ) => {
    const formData = new FormData();
    formData.append("intent", "add-location");
    formData.append("name", name.trim());
    formData.append("latitude", String(point.latitude));
    formData.append("longitude", String(point.longitude));
    fetcher.submit(formData, { method: "post" });
    setLocationName("");
    setSelectedPoint(null);
    clearAutocompleteInputs();
    if (selectionMarker.current) {
      selectionMarker.current.map = null;
      selectionMarker.current = null;
    }
  };

  const handleAddLocation = () => {
    if (!selectedPoint || !locationName.trim()) return;
    if (editingSetId) {
      const next: RetailLocation = {
        id: `loc-edit-${Date.now()}`,
        name: locationName.trim(),
        latitude: selectedPoint.latitude,
        longitude: selectedPoint.longitude,
        createdAt: new Date().toISOString(),
      };
      setEditingSetLocations((prev) => [...prev, next]);
      setLocationName("");
      setSelectedPoint(null);
      clearAutocompleteInputs();
      if (selectionMarker.current) {
        selectionMarker.current.map = null;
        selectionMarker.current = null;
      }
      return;
    }
    addLocation(locationName, selectedPoint);
  };

  const handleAddLocationFromMap = () => {
    if (!selectedPoint || !mapLocationName.trim()) return;
    addLocation(mapLocationName, selectedPoint);
    setMapLocationName("");
    setShowSelectionMap(false);
    clearAutocompleteInputs();
  };

  const handleRemoveLocation = (locationId: string) => {
    const formData = new FormData();
    formData.append("intent", "remove-location");
    formData.append("locationId", locationId);
    fetcher.submit(formData, { method: "post" });
  };

  const handleDeleteProject = () => {
    if (!selectedSetId) return;
    const formData = new FormData();
    formData.append("intent", "delete-location-set");
    formData.append("setId", selectedSetId);
    fetcher.submit(formData, { method: "post" });
    setSelectedSetId("");
    setShowLoadedProject(false);
    clearAutocompleteInputs();
  };

  const handleBackToProjects = () => {
    setShowLoadedProject(false);
    const formData = new FormData();
    formData.append("intent", "clear-locations");
    fetcher.submit(formData, { method: "post" });
  };

  const handleStartNewProject = () => {
    const formData = new FormData();
    formData.append("intent", "clear-locations");
    fetcher.submit(formData, { method: "post" });
    setLocationName("");
    setSelectedPoint(null);
    setMapLocationName("");
    clearAutocompleteInputs();
  };

  const handleOpenDateRange = () => {
    setDateRangeDraft(dateRangeApplied);
    setShowCustomDates(false);
  };

  const handleApplyDateRange = () => {
    setDateRangeApplied(dateRangeDraft);
  };

  const handleCancelDateRange = () => {
    setDateRangeDraft(dateRangeApplied);
  };

  const handlePresetSelect = (presetId: string) => {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    setDateRangeDraft(preset.getRange());
  };

  const handleOpenHeatmapOptions = () => {
    setLocalScalingDraft(localScalingApplied);
  };

  const handleCancelHeatmapOptions = () => {
    setLocalScalingDraft(localScalingApplied);
  };

  const handleApplyHeatmapOptions = () => {
    setLocalScalingApplied(localScalingDraft);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        localScalingStorageKey,
        localScalingDraft ? "true" : "false",
      );
    }
  };

  const handleSaveSet = () => {
    if (!setName.trim()) return;
    const formData = new FormData();
    formData.append("intent", "save-location-set");
    formData.append("setName", setName.trim());
    fetcher.submit(formData, { method: "post" });
    setSetName("");
  };

  const handleLoadSet = (setId: string) => {
    if (!setId) return;
    const formData = new FormData();
    formData.append("intent", "load-location-set");
    formData.append("setId", setId);
    fetcher.submit(formData, { method: "post" });
    setShowLoadedProject(true);
  };

  useEffect(() => {
    const data = fetcher.data as { setId?: string } | undefined;
    if (!data?.setId) return;
    setSelectedSetId(data.setId);
    setShowLoadedProject(true);
  }, [fetcher.data]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(heatmapOptionsStorageKey);
    if (saved === "orders" || saved === "revenue" || saved === "customers") {
      setHeatmapWeightApplied(saved);
      return;
    }
    setHeatmapWeightApplied("orders");
  }, [heatmapOptionsStorageKey]);

  useEffect(() => {
    if (!overviewMapInstance.current) return;
    if (!window.google?.maps?.event?.trigger) return;
    window.google.maps.event.trigger(overviewMapInstance.current, "resize");
  }, [isHeatmapExpanded]);

  return (
    <s-page heading="Retail expansion" inlineSize="base">
      <s-modal id="pin-location-modal" heading="Pin location on map">
        <div className={styles.asideColumn}>
          <s-text color="subdued">
            Click the map to select a location.
          </s-text>
          <div ref={selectionMapRef} className={styles.mapCanvas} />
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="pin-location-modal"
              command="--hide"
              onClick={() => setShowSelectionMap(false)}
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              disabled={!selectedPoint}
              commandFor="name-location-modal"
              command="--show"
            >
              Add location
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="name-location-modal" heading="Name location">
        <div className={styles.asideColumn}>
          <s-text-field
            label="Location name"
            value={mapLocationName}
            onChange={(event: Event) =>
              setMapLocationName(
                (event.currentTarget as HTMLInputElement).value,
              )
            }
          />
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="name-location-modal"
              command="--hide"
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              disabled={!selectedPoint || !mapLocationName.trim()}
              commandFor="name-location-modal"
              command="--hide"
              onClick={handleAddLocationFromMap}
            >
              Save
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="add-locations-modal" heading="Add locations">
        <div className={styles.asideColumn}>
          <div className={styles.placeAutocompleteField}>
            <s-text-field
              label="Include new location"
              value={locationName}
              onChange={(event: Event) =>
                setLocationName(
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
            <div
              ref={loadedProjectAutocompleteContainerRef}
              className={styles.placeAutocompleteHost}
              aria-hidden="true"
            />
          </div>
          <div className={styles.asideRowSpace}>
            <s-button
              variant="secondary"
              commandFor="add-locations-modal"
              command="--hide"
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              disabled={!selectedPoint || !locationName.trim()}
              onClick={handleAddLocation}
            >
              Add location
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="new-project-modal" heading="New project">
        <div className={styles.asideColumn}>
          <s-text color="subdued">
            Use search to add locations to a new project.
          </s-text>
          <div className={styles.placeAutocompleteField}>
            <s-text-field
              label="Include new location"
              value={locationName}
              onChange={(event: Event) =>
                setLocationName(
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
            <div
              ref={newProjectAutocompleteContainerRef}
              className={styles.placeAutocompleteHost}
              aria-hidden="true"
            />
          </div>
          <div className={styles.asideRowRight}>
            <s-button
              variant="primary"
              disabled={!selectedPoint || !locationName.trim()}
              onClick={handleAddLocation}
            >
              Add location
            </s-button>
          </div>
          <s-text type="strong">Added locations</s-text>
          {locations.length > 0 ? (
            <div className={styles.tagList}>
              {locations.map((location) => (
                <div key={location.id} className={styles.tagItem}>
                  <span>{location.name}</span>
                  <button
                    type="button"
                    className={styles.tagRemove}
                    aria-label={`Remove ${location.name}`}
                    onClick={() => handleRemoveLocation(location.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <s-text color="subdued">No locations added yet.</s-text>
          )}
          <div className={styles.asideRowRight}>
            <s-button
              variant="primary"
              disabled={locations.length === 0}
              commandFor="save-project-modal"
              command="--show"
              onClick={() => {
                if (storedCityName?.trim()) {
                  setSetName(storedCityName.trim());
                }
              }}
            >
              Save
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="save-project-modal" heading="Save project">
        <div className={styles.asideColumn}>
          <s-text-field
            label="Project name"
            value={setName}
            onChange={(event: Event) =>
              setSetName((event.currentTarget as HTMLInputElement).value)
            }
          />
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="save-project-modal"
              command="--hide"
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              disabled={locations.length === 0 || setName.trim().length === 0}
              commandFor="save-project-modal"
              command="--hide"
              onClick={handleSaveSet}
            >
              Save
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="edit-project-modal" heading="Edit project">
        <div className={styles.asideColumn}>
          <s-text-field
            label="Project name"
            value={editingSetName}
            onChange={(event: Event) =>
              setEditingSetName((event.currentTarget as HTMLInputElement).value)
            }
          />
          <s-text type="strong">Locations</s-text>
          {editingSetLocations.length > 0 ? (
            <div className={styles.tagList}>
              {editingSetLocations.map((location) => (
                <div key={location.id} className={styles.tagItem}>
                  <span>{location.name}</span>
                  <button
                    type="button"
                    className={styles.tagRemove}
                    aria-label={`Remove ${location.name}`}
                    onClick={() =>
                      setEditingSetLocations((prev) =>
                        prev.filter((loc) => loc.id !== location.id),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <s-text color="subdued">No locations.</s-text>
          )}
          <s-link commandFor="add-locations-modal" command="--show">
            Add location
          </s-link>
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="edit-project-modal"
              command="--hide"
              onClick={() => {
                setEditingSetId(null);
                setEditingSetName("");
                setEditingSetLocations([]);
              }}
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              disabled={!editingSetId || !editingSetName.trim()}
              commandFor="edit-project-modal"
              command="--hide"
              onClick={() => {
                if (!editingSetId || !editingSetName.trim()) return;
                const formData = new FormData();
                formData.append("intent", "update-location-set");
                formData.append("setId", editingSetId);
                formData.append("setName", editingSetName.trim());
                formData.append(
                  "locations",
                  JSON.stringify(editingSetLocations),
                );
                fetcher.submit(formData, { method: "post" });
                setEditingSetId(null);
                setEditingSetName("");
                setEditingSetLocations([]);
              }}
            >
              Save
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="delete-project-modal" heading="Delete project">
        <div className={styles.asideColumn}>
          <s-text>
            This will permanently delete the project and remove its locations.
          </s-text>
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="delete-project-modal"
              command="--hide"
            >
              Cancel
            </s-button>
            <s-button
              variant="secondary"
              commandFor="delete-project-modal"
              command="--hide"
              onClick={handleDeleteProject}
              disabled={!selectedSetId}
            >
              Delete
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="date-range-modal" heading="Date range">
        <div className={styles.dateRangeModal}>
          <div className={styles.dateRangeContent}>
            <div>
              <s-text type="strong">Timeframes</s-text>
              <div className={styles.dateRangePresetList}>
                {presets.map((preset) => (
                  <s-button
                    key={preset.id}
                    variant={
                      dateRangeDraft.selectedPresetId === preset.id
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() => handlePresetSelect(preset.id)}
                  >
                    {preset.label}
                  </s-button>
                ))}
                <s-button
                  variant="secondary"
                  onClick={() => setShowCustomDates((prev) => !prev)}
                >
                  Custom dates
                </s-button>
              </div>
            </div>
            {showCustomDates ? (
              <>
                <s-select
                  label="Date setting"
                  value={dateRangeDraft.mode}
                  onChange={(event: Event) => {
                    const mode = (event.currentTarget as HTMLSelectElement).value as
                      | "fixed"
                      | "rolling";
                    setDateRangeDraft((current) => ({
                      ...current,
                      mode,
                      selectedPresetId: null,
                    }));
                  }}
                >
                  <s-option value="fixed">Fixed</s-option>
                  <s-option value="rolling">Rolling</s-option>
                </s-select>
                {dateRangeDraft.mode === "fixed" ? (
                  <div className={styles.dateRangeGrid}>
                    <div className={styles.datePickerField}>
                      <s-text type="strong">Start date</s-text>
                      <s-date-picker
                        type="single"
                        value={dateRangeDraft.fixed.startDate}
                        onChange={(event: Event) =>
                          setDateRangeDraft((current) => ({
                            ...current,
                            fixed: {
                              ...current.fixed,
                              startDate: (event.currentTarget as HTMLInputElement).value,
                            },
                            selectedPresetId: null,
                          }))
                        }
                      />
                    </div>
                    <div className={styles.datePickerField}>
                      <s-text type="strong">End date</s-text>
                      <s-date-picker
                        type="single"
                        value={dateRangeDraft.fixed.endDate}
                        onChange={(event: Event) =>
                          setDateRangeDraft((current) => ({
                            ...current,
                            fixed: {
                              ...current.fixed,
                              endDate: (event.currentTarget as HTMLInputElement).value,
                            },
                            selectedPresetId: null,
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className={styles.dateRangeGrid}>
                    <s-text-field
                      label="Use data from last"
                      value={`${dateRangeDraft.rolling.last}`}
                      onChange={(event: Event) => {
                        const value = Number(
                          (event.currentTarget as HTMLInputElement).value,
                        );
                        setDateRangeDraft((current) => ({
                          ...current,
                          rolling: {
                            ...current.rolling,
                            last: Number.isNaN(value) ? 1 : Math.max(1, value),
                          },
                          selectedPresetId: null,
                        }));
                      }}
                    />
                    <s-select
                      label="Date range"
                      value={dateRangeDraft.rolling.unit}
                      onChange={(event: Event) =>
                        setDateRangeDraft((current) => ({
                          ...current,
                          rolling: {
                            ...current.rolling,
                            unit: (event.currentTarget as HTMLSelectElement)
                              .value as RollingUnit,
                          },
                          selectedPresetId: null,
                        }))
                      }
                    >
                      {[
                        { value: "minute", label: "minutes" },
                        { value: "hour", label: "hours" },
                        { value: "day", label: "days" },
                        { value: "week", label: "weeks" },
                        { value: "month", label: "months" },
                      ].map((unit) => (
                        <s-option key={unit.value} value={unit.value}>
                          {unit.label}
                        </s-option>
                      ))}
                    </s-select>
                  </div>
                )}
              </>
            ) : null}
            <div className={styles.dateRangeToggle}>
              <s-checkbox
                label="Include current period"
                checked={dateRangeDraft.rolling.includeCurrentPeriod}
                onChange={(event: Event) =>
                  setDateRangeDraft((current) => ({
                    ...current,
                    rolling: {
                      ...current.rolling,
                      includeCurrentPeriod: (
                        event.currentTarget as HTMLInputElement
                      ).checked,
                    },
                    selectedPresetId: null,
                  }))
                }
              />
              <s-text color="subdued">
                Includes the current period in rolling ranges.
              </s-text>
            </div>
          </div>
        </div>
        <div className={styles.dateRangeFooter}>
          <s-button
            variant="secondary"
            commandFor="date-range-modal"
            command="--hide"
            onClick={handleCancelDateRange}
          >
            Cancel
          </s-button>
          <s-button
            variant="primary"
            commandFor="date-range-modal"
            command="--hide"
            onClick={handleApplyDateRange}
          >
            Apply
          </s-button>
        </div>
      </s-modal>
      <s-modal id="heatmap-options-modal" heading="Heatmap options">
        <div className={styles.asideColumn}>
          <s-checkbox
            label="Local Intensity"
            checked={localScalingDraft}
            onChange={(event: Event) =>
              setLocalScalingDraft(
                (event.currentTarget as HTMLInputElement).checked,
              )
            }
          />
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="heatmap-options-modal"
              command="--hide"
              onClick={handleCancelHeatmapOptions}
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              commandFor="heatmap-options-modal"
              command="--hide"
              onClick={handleApplyHeatmapOptions}
            >
              Confirm
            </s-button>
          </div>
        </div>
      </s-modal>
      {lastClickedCity ? (
        <s-modal id="top15-city-modal" heading="City">
          <div className={styles.asideColumn}>
            <s-text>{lastClickedCity.city}</s-text>
            <div className={styles.asideRow}>
              <s-button
                variant="primary"
                onClick={() => {
                  focusCity(lastClickedCity.lat, lastClickedCity.lng);
                  setLastClickedCity(null);
                }}
              >
                Close
              </s-button>
            </div>
          </div>
        </s-modal>
      ) : null}
      {!mapsApiKey ? (
        <s-banner tone="warning" heading="Google Maps API key missing">
          Set GOOGLE_MAPS_API_KEY in your environment and restart the dev server
          to enable the map.
        </s-banner>
      ) : null}
      {!mapsMapId ? (
        <s-banner tone="warning" heading="Google Maps Map ID missing">
          Set GOOGLE_MAPS_MAP_ID in your environment to use the map.
        </s-banner>
      ) : null}
      {mapsLoadError ? (
        <s-banner tone="warning" heading="Google Maps error">
          {mapsLoadError}
        </s-banner>
      ) : null}
      {analyticsError ? (
        <s-banner tone="critical" heading="Analytics access issue">
          {analyticsError}
        </s-banner>
      ) : null}
      {analytics.customers.length === 0 && analytics.orders.length === 0 ? (
        <s-banner tone="warning" heading="No geocoded records available">
          Sync your data to load customers or orders with coordinates.
        </s-banner>
      ) : null}

      <div className={isHeatmapExpanded ? styles.fullscreenOverlay : undefined}>
        <div className={isHeatmapExpanded ? styles.fullscreenContent : undefined}>
          {isHeatmapExpanded ? (
            <div className={styles.fullscreenSplitLayout}>
              <div className={styles.fullscreenMapPane}>
                <s-section>
                  <div className={styles.mapCanvasWrap}>
                    <div className={styles.mapOverlayButton} role="group">
                      <s-button
                        variant="secondary"
                        accessibilityLabel="Collapse heatmap"
                        aria-expanded={true}
                        onClick={() => setIsHeatmapExpanded(false)}
                      >
                        [-] Collapse
                      </s-button>
                    </div>
                    {showNationalViewReset ? (
                      <div className={styles.mapResetButton}>
                        <s-button variant="secondary" onClick={resetToNationalView}>
                          Back to National View
                        </s-button>
                      </div>
                    ) : null}
                    <div
                      ref={overviewMapRef}
                      className={`${styles.mapCanvasLarge} ${styles.mapCanvasFullscreen}`}
                    />
                  </div>
                  <div className={styles.rankFooter}>
                    <s-link
                      commandFor="heatmap-options-modal"
                      command="--show"
                      onClick={handleOpenHeatmapOptions}
                    >
                      Heatmap options
                    </s-link>
                  </div>
                </s-section>
                <div className={styles.projectsSectionSpacing}>
                <s-section heading="Expansion projects">
                  {projectTableData.length === 0 ? (
                    <s-text color="subdued">
                      No projects yet. Create one from the sidebar or use New project.
                    </s-text>
                  ) : (
                    <div className={styles.projectsTableWrap}>
                      <table className={styles.projectsTable}>
                        <thead>
                          <tr>
                            <th>Project</th>
                            <th># Locations</th>
                            <th>Revenue</th>
                            <th>Orders</th>
                            <th>Customers</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projectTableData.map((row) => (
                            <tr key={row.id}>
                              <td>
                                <s-link
                                  onClick={() => {
                                    const set = locationSets.find(
                                      (s) => s.id === row.id,
                                    );
                                    if (set) {
                                      setEditingSetId(set.id);
                                      setEditingSetName(set.name);
                                      setEditingSetLocations([...set.locations]);
                                      const el = document.getElementById(
                                        "edit-project-modal",
                                      ) as HTMLElement & { show?: () => void };
                                      el?.show?.();
                                    }
                                  }}
                                >
                                  {row.name}
                                </s-link>
                              </td>
                              <td>{row.locationCount}</td>
                              <td>
                                {formatMoney(row.totalRevenue, row.currencyCode)}
                              </td>
                              <td>{row.orderCount}</td>
                              <td>{row.customerCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </s-section>
                </div>
              </div>
              <div className={styles.fullscreenAssignedPane}>
                <s-section>
                  <div className={styles.topCitiesHeaderRow}>
                    <div className={styles.topCitiesHeaderControls}>
                      <s-select
                        label="Top 15 cities"
                        value={heatmapWeightApplied}
                        aria-label="Top 15 cities data type"
                        onChange={(event: Event) => {
                          const value = (event.currentTarget as HTMLSelectElement)
                            .value as HeatmapWeighting;
                          setHeatmapWeightApplied(value);
                          if (typeof window !== "undefined") {
                            window.localStorage.setItem(heatmapOptionsStorageKey, value);
                          }
                        }}
                      >
                        <s-option value="revenue">Revenue</s-option>
                        <s-option value="orders">Orders</s-option>
                        <s-option value="customers">Customers</s-option>
                      </s-select>
                    </div>
                  </div>
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <s-stack direction="block" gap="small">
                      <div className={styles.rankTable}>
                        {topCitiesByMetric.map((item) => (
                          <div key={item.city} className={styles.rankTableRow}>
                            <span className={styles.rankName} title={item.city}>
                              {item.latitude != null && item.longitude != null ? (
                                <span title={`See heatmap for ${item.city}`}>
                                  <s-link
                                  onClick={() => {
                                    setStoredCityName(item.city);
                                    if (item.latitude != null && item.longitude != null) {
                                      setLastClickedCity({
                                        lat: item.latitude,
                                        lng: item.longitude,
                                        city: item.city,
                                      });
                                    }
                                    focusCity(item.latitude, item.longitude);
                                  }}
                                >
                                    {item.city}
                                  </s-link>
                                </span>
                              ) : (
                                item.city
                              )}
                            </span>
                            <span className={styles.rankValue}>
                              {heatmapWeightApplied === "revenue"
                                ? formatCurrencyCompact(
                                    item.revenueMonthlyAverage,
                                    item.currencyCode,
                                  )
                                : heatmapWeightApplied === "customers"
                                  ? item.customersMonthlyAverage.toFixed(1)
                                  : item.ordersMonthlyAverage.toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className={styles.rankFooter}>
                        <s-text color="subdued">
                          Monthly average (selected timeframe)
                        </s-text>
                      </div>
                    </s-stack>
                  </s-box>
                </s-section>
                {locations.length === 0 ? (
                  <s-section heading="Get started">
                    <s-banner tone="info" heading="Add your first retail location">
                      Use the map to pick a location and compare against your customer
                      distribution.
                    </s-banner>
                  </s-section>
                ) : null}
                <s-section heading="Location comparison">
                  <s-stack direction="block" gap="base">
                    {metrics.map((item) => (
                      <s-box
                        key={item.id}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                      >
                        <s-stack direction="inline" gap="base" justifyContent="space-between">
                          <s-text type="strong">{item.name}</s-text>
                          <s-text>{formatMoney(item.totalRevenue, item.currencyCode)}</s-text>
                        </s-stack>
                        <s-stack direction="inline" gap="base">
                          <s-text color="subdued">
                            Customers: {item.customerCount}
                          </s-text>
                          <s-text color="subdued">
                            Avg value: {formatMoney(item.avgValue, item.currencyCode)}
                          </s-text>
                          <s-text color="subdued">
                            Density: {item.density.toFixed(2)} / km²
                          </s-text>
                        </s-stack>
                      </s-box>
                    ))}
                  </s-stack>
                </s-section>
              </div>
            </div>
          ) : (
            <div className={styles.fullscreenScroll}>
              <s-section>
                <div className={styles.mapCanvasWrap}>
                  <div className={styles.mapOverlayButton} role="group">
                    <s-button
                      variant="secondary"
                      accessibilityLabel="Expand heatmap"
                      aria-expanded={false}
                      onClick={() => setIsHeatmapExpanded(true)}
                    >
                      [+] Expand
                    </s-button>
                  </div>
                  {showNationalViewReset ? (
                    <div className={styles.mapResetButton}>
                      <s-button variant="secondary" onClick={resetToNationalView}>
                        Back to National View
                      </s-button>
                    </div>
                  ) : null}
                  <div
                    ref={overviewMapRef}
                    className={styles.mapCanvasLarge}
                  />
                </div>
                <div className={styles.rankFooter}>
                  <s-link
                    commandFor="heatmap-options-modal"
                    command="--show"
                    onClick={handleOpenHeatmapOptions}
                  >
                    Heatmap options
                  </s-link>
                </div>
              </s-section>
              <div className={styles.projectsSectionSpacing}>
              <s-section heading="Expansion projects">
                {projectTableData.length === 0 ? (
                  <s-text color="subdued">
                    No projects yet. Create one from the sidebar or use New project.
                  </s-text>
                ) : (
                  <div className={styles.projectsTableWrap}>
                    <table className={styles.projectsTable}>
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th># Locations</th>
                          <th>Revenue</th>
                          <th>Orders</th>
                          <th>Customers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectTableData.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <s-link
                                onClick={() => {
                                  const set = locationSets.find(
                                    (s) => s.id === row.id,
                                  );
                                  if (set) {
                                    setEditingSetId(set.id);
                                    setEditingSetName(set.name);
                                    setEditingSetLocations([...set.locations]);
                                    const el = document.getElementById(
                                      "edit-project-modal",
                                    ) as HTMLElement & { show?: () => void };
                                    el?.show?.();
                                  }
                                }}
                              >
                                {row.name}
                              </s-link>
                            </td>
                            <td>{row.locationCount}</td>
                            <td>
                              {formatMoney(row.totalRevenue, row.currencyCode)}
                            </td>
                            <td>{row.orderCount}</td>
                            <td>{row.customerCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </s-section>
              </div>
            </div>
          )}
        </div>
      </div>

      {!isHeatmapExpanded ? (
      <>
      <s-section slot="aside">
        <div className={styles.topCitiesHeaderRow}>
          <div className={styles.topCitiesHeaderControls}>
            <s-select
              label="Top 15 cities"
              value={heatmapWeightApplied}
              aria-label="Top 15 cities data type"
              onChange={(event: Event) => {
                const value = (event.currentTarget as HTMLSelectElement)
                  .value as HeatmapWeighting;
                setHeatmapWeightApplied(value);
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(heatmapOptionsStorageKey, value);
                }
              }}
            >
              <s-option value="revenue">Revenue</s-option>
              <s-option value="orders">Orders</s-option>
              <s-option value="customers">Customers</s-option>
            </s-select>
          </div>
        </div>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <div className={styles.rankTable}>
              {topCitiesByMetric.map((item) => (
                <div key={item.city} className={styles.rankTableRow}>
                  <span className={styles.rankName} title={item.city}>
                    {item.latitude != null && item.longitude != null ? (
                      <span title={`See heatmap for ${item.city}`}>
                        <s-link
                        onClick={() => {
                          setStoredCityName(item.city);
                          if (item.latitude != null && item.longitude != null) {
                            setLastClickedCity({
                              lat: item.latitude,
                              lng: item.longitude,
                              city: item.city,
                            });
                          }
                          focusCity(item.latitude, item.longitude);
                        }}
                      >
                          {item.city}
                        </s-link>
                      </span>
                    ) : (
                      item.city
                    )}
                  </span>
                  <span className={styles.rankValue}>
                    {heatmapWeightApplied === "revenue"
                      ? formatCurrencyCompact(
                          item.revenueMonthlyAverage,
                          item.currencyCode,
                        )
                      : heatmapWeightApplied === "customers"
                        ? item.customersMonthlyAverage.toFixed(1)
                        : item.ordersMonthlyAverage.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
            <div className={styles.rankFooter}>
              <s-text color="subdued">
                Monthly average (selected timeframe)
              </s-text>
            </div>
          </s-stack>
        </s-box>
      </s-section>

      {locations.length === 0 ? (
        <s-section slot="aside" heading="Get started">
          <s-banner tone="info" heading="Add your first retail location">
            Use the map to pick a location and compare against your customer
            distribution.
          </s-banner>
        </s-section>
      ) : null}

      <s-section heading="Location comparison" slot="aside">
        <s-stack direction="block" gap="base">
          {metrics.map((item) => (
            <s-box
              key={item.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack direction="inline" gap="base" justifyContent="space-between">
                <s-text type="strong">{item.name}</s-text>
                <s-text>{formatMoney(item.totalRevenue, item.currencyCode)}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-text color="subdued">
                  Customers: {item.customerCount}
                </s-text>
                <s-text color="subdued">
                  Avg value: {formatMoney(item.avgValue, item.currencyCode)}
                </s-text>
                <s-text color="subdued">
                  Density: {item.density.toFixed(2)} / km²
                </s-text>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
      </>
      ) : null}
    </s-page>
  );
}

const backfillAnalytics = async (
  admin: any,
  current: AnalyticsCache,
  shop: string,
) => {
  // Run sequentially to reduce API cost spikes and avoid throttling.
  const customers = await fetchAllCustomers(admin);
  await sleep(250);
  const orders = await fetchAllOrders(admin);

  const next: AnalyticsCache = {
    customers,
    orders,
    updatedAt: new Date().toISOString(),
  };
  await writeAnalyticsCache(next, shop);
  return next;
};

const fetchAllCustomers = async (admin: any) => {
  const customers: AnalyticsCache["customers"] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const json = await graphqlJsonWithRetry(
      admin,
      `#graphql
        query CustomerGeo($first: Int!, $after: String) {
          customers(first: $first, after: $after) {
            nodes {
              id
              displayName
              createdAt
              defaultAddress {
                latitude
                longitude
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { first: ANALYTICS_PAGE_SIZE, after: cursor },
    );
    const nodes = json.data.customers.nodes as Array<{
      id: string;
      displayName: string | null;
      createdAt: string | null;
      defaultAddress: { latitude: number | null; longitude: number | null } | null;
    }>;
    nodes.forEach((node) => {
      if (!node.defaultAddress) return;
      if (node.defaultAddress.latitude == null) return;
      if (node.defaultAddress.longitude == null) return;
      customers.push({
        id: node.id,
        name: node.displayName,
        latitude: node.defaultAddress.latitude,
        longitude: node.defaultAddress.longitude,
        createdAt: node.createdAt ?? null,
      });
    });
    hasNextPage = json.data.customers.pageInfo.hasNextPage;
    cursor = json.data.customers.pageInfo.endCursor;
  }

  return customers;
};

const fetchAllOrders = async (admin: any) => {
  const orders: AnalyticsCache["orders"] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const json = await graphqlJsonWithRetry(
      admin,
      `#graphql
        query OrdersGeo($first: Int!, $after: String) {
          orders(first: $first, after: $after) {
            nodes {
              id
              name
              createdAt
              customer {
                id
                displayName
              }
              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              shippingAddress {
                city
                latitude
                longitude
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { first: ANALYTICS_PAGE_SIZE, after: cursor },
    );
    const nodes = json.data.orders.nodes as Array<{
      id: string;
      name: string;
      createdAt: string | null;
      customer: { id: string; displayName: string } | null;
      currentTotalPriceSet: {
        shopMoney: { amount: string; currencyCode: string };
      } | null;
      shippingAddress: {
        city: string | null;
        latitude: number | null;
        longitude: number | null;
      } | null;
    }>;

    nodes.forEach((node) => {
      if (!node.shippingAddress?.city?.trim()) return;
      if (
        node.shippingAddress.latitude == null ||
        node.shippingAddress.longitude == null
      )
        return;
      orders.push({
        id: node.id,
        name: node.name,
        customerId: node.customer?.id ?? null,
        customerName: node.customer?.displayName ?? null,
        city: node.shippingAddress.city.trim(),
        latitude: node.shippingAddress.latitude,
        longitude: node.shippingAddress.longitude,
        totalAmount: node.currentTotalPriceSet
          ? Number(node.currentTotalPriceSet.shopMoney.amount)
          : null,
        currencyCode: node.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
        createdAt: node.createdAt ?? null,
      });
    });

    hasNextPage = json.data.orders.pageInfo.hasNextPage;
    cursor = json.data.orders.pageInfo.endCursor;
  }

  return orders;
};

