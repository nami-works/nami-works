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
import styles from "./app.retail-footprint/styles.module.css";
import {
  deleteProposal,
  readLocationSets,
  readLocations,
  readProposals,
  readStatsConfig,
  resetStatsConfig,
  upsertProposal,
  writeLocationSets,
  writeLocations,
  writeStatsConfig,
} from "../retail-footprint/storage.server";
import type {
  CustomerGeo,
  OrderGeo,
  LocationProposal,
  LocationSet,
  RetailLocation,
  StatsConfig,
} from "../retail-footprint/storage.server";
import {
  getHeatmapBuckets,
  getCityRankings,
  getProjectRadiusStats,
  upsertRetailOrders,
  upsertRetailCustomers,
  rebuildCityAggregates,
  rebuildHeatmapBuckets,
  readSyncMeta,
  writeSyncMeta,
  writeSyncProgress,
} from "../retail-footprint/analytics-queries.server";
import type {
  HeatmapBucket,
  CityRanking,
  LocationWithStats,
  SyncMeta,
} from "../retail-footprint/analytics-queries.server";
import {
  classifyLocations,
  computeOverviewStats,
} from "../retail-footprint/overview-stats.server";
import type { OverviewStats } from "../retail-footprint/overview-stats.server";

/** Client-safe copy — avoids importing the .server module into client code. */
const KM_PER_MI = 1.60934;

const DEFAULT_STATS_CONFIG: StatsConfig = {
  showNeighborhood: true,
  radii: [
    { value: 5, enabled: true },
    { value: 10, enabled: true },
    { value: 15, enabled: true },
    { value: 20, enabled: true },
  ],
  customRadiusKm: null,
  radiusUnit: "km",
  qualitative: {
    predominantAudience: true,
    tenantMix: true,
    subjectiveFit: true,
    customCriteria: null,
  },
};
// KPI utilities kept for server-side aggregates in analytics-queries.server.ts

type LoaderData = {
  locations: RetailLocation[];
  locationSets: LocationSet[];
  heatmapBuckets: HeatmapBucket[];
  cityRankings: CityRanking[];
  syncStatus: "idle" | "running" | "failed";
  syncError: string | null;
  syncWarning: string | null;
  syncPhase: string | null;
  syncProgressCount: number | null;
  syncStartedAt: string | null;
  syncTotalCustomers: number | null;
  syncTotalOrders: number | null;
  syncLastSyncedAt: string | null;
  mapsApiKey: string;
  mapsMapId: string;
  userLocale: string;
  proposals: LocationProposal[];
  statsConfig: StatsConfig;
};

type RollingUnit = "minute" | "hour" | "day" | "week" | "month";

type DateRangeState = {
  mode: "fixed" | "rolling";
  fixed: { startDate: string; endDate: string };
  rolling: { unit: RollingUnit; last: number; includeCurrentPeriod: boolean };
  selectedPresetId?: string | null;
};

type HeatmapWeighting = "orders" | "revenue" | "customers";
type MapStyleOption = "dark" | "grayscale" | "light";
type HeatmapIntensity = "national" | "regional" | "local";

const DEFAULT_RADIUS_KM = 10;
const MAPS_SCRIPT_ID = "google-maps-sdk";
const ANALYTICS_PAGE_SIZE = 250;
const MAX_THROTTLE_RETRIES = 5;
const HEATMAP_OPTIONS_STORAGE_KEY_PREFIX = "retail-footprint-heatmap-options";
const DEFAULT_OVERVIEW_CENTER = { lat: -15.793889, lng: -47.882778 };
const DEFAULT_OVERVIEW_ZOOM = 4;
const LOCAL_SCALING_STORAGE_KEY_PREFIX = "retail-footprint-local-scaling";
const MAP_STYLE_STORAGE_KEY = "retail-footprint-map-style";
const HEATMAP_INTENSITY_STORAGE_KEY = "retail-footprint-heatmap-intensity";

type MapTypeStyle = { featureType?: string; elementType?: string; stylers: Record<string, string | number>[] };
const MAP_STYLES: Record<string, MapTypeStyle[]> = {
  light: [],
  grayscale: [{ featureType: "all", stylers: [{ saturation: -100 }] }],
  dark: [
    { elementType: "geometry", stylers: [{ color: "#212121" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
    { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
    { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#181818" }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { featureType: "poi.park", elementType: "labels.text.stroke", stylers: [{ color: "#1b1b1b" }] },
    { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#373737" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
    { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#4e4e4e" }] },
    { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] },
  ],
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
          console.warn(`[retail-footprint] GraphQL throttled attempt=${attempt}/${MAX_THROTTLE_RETRIES} — retrying in ${300 * 2 ** (attempt - 1)}ms`);
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
        console.warn(`[retail-footprint] GraphQL throttled (catch) attempt=${attempt}/${MAX_THROTTLE_RETRIES} — retrying in ${300 * 2 ** (attempt - 1)}ms`);
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
      if (window.google?.maps) {
        resolve();
        return;
      }
      existingScript.addEventListener("load", () => resolve());
      existingScript.addEventListener("error", () => {
        existingScript.remove();
        mapsLoader = null;
        reject(new Error("Google Maps failed to load"));
      });
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
    script.addEventListener("error", () => {
      script.remove();
      mapsLoader = null;
      reject(new Error("Google Maps failed to load"));
    });
    document.head.appendChild(script);
  });

  return mapsLoader;
};

const formatCurrencyCompact = (amount: number, currencyCode: string | null, userLocale: string) => {
  if (!currencyCode) return "--";
  const locale = userLocale.replace("_", "-");
  const formatted = amount.toLocaleString(locale, {
    maximumFractionDigits: 0,
  });
  return currencyCode === "BRL" ? `R$${formatted}` : `${currencyCode} ${formatted}`;
};

const formatCurrencyAbbrev = (amount: number, currencyCode: string | null) => {
  if (!currencyCode) return "--";
  const prefix = currencyCode === "BRL" ? "R$" : `${currencyCode} `;
  if (amount >= 1_000_000) return `${prefix}${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${prefix}${(amount / 1_000).toFixed(0)}k`;
  return `${prefix}${amount.toFixed(0)}`;
};

const formatRangeSummary = (range: DateRangeState) => {
  if (range.mode === "rolling") {
    const unitLabel = range.rolling.last === 1 ? range.rolling.unit : `${range.rolling.unit}s`;
    return `Last ${range.rolling.last} ${unitLabel}`;
  }
  return `${range.fixed.startDate} - ${range.fixed.endDate}`;
};

const FIT_BADGE_CLASSES: Record<number, string> = {
  1: "fitBadge1",
  2: "fitBadge2",
  3: "fitBadge3",
  4: "fitBadge4",
  5: "fitBadge5",
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

// ---------------------------------------------------------------------------
// Analytics data-fetching helpers (must be declared before loader)
// ---------------------------------------------------------------------------

const fetchAllCustomers = async (admin: any, shop: string, since?: string) => {
  const customers: CustomerGeo[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let pageCount = 0;
  const phaseStart = Date.now();
  const queryFilter = since ? `updated_at:>'${since}'` : null;
  console.info(`[retail-footprint:sync] fetchAllCustomers START shop=${shop} since=${since ?? "all"}`);

  while (hasNextPage) {
    const json = await graphqlJsonWithRetry(
      admin,
      `#graphql
        query CustomerGeo($first: Int!, $after: String, $query: String) {
          customers(first: $first, after: $after, query: $query) {
            nodes {
              id
              displayName
              createdAt
              defaultAddress {
                latitude
                longitude
                city
                provinceCode
                countryCode
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { first: ANALYTICS_PAGE_SIZE, after: cursor, query: queryFilter },
    );
    const nodes = json.data.customers.nodes as Array<{
      id: string;
      displayName: string | null;
      createdAt: string | null;
      defaultAddress: {
        latitude: number | null;
        longitude: number | null;
        city: string | null;
        provinceCode: string | null;
        countryCode: string | null;
      } | null;
    }>;
    const pageBatch: typeof customers = [];
    nodes.forEach((node) => {
      if (!node.defaultAddress) return;
      const hasCoords = node.defaultAddress.latitude != null && node.defaultAddress.longitude != null;
      const hasCity = !!node.defaultAddress.city?.trim();
      if (!hasCoords && !hasCity) return;
      pageBatch.push({
        id: node.id,
        name: node.displayName,
        latitude: node.defaultAddress.latitude ?? null,
        longitude: node.defaultAddress.longitude ?? null,
        city: node.defaultAddress.city?.trim() ?? null,
        createdAt: node.createdAt ?? null,
      });
    });
    customers.push(...pageBatch);

    // Dual-write: upsert into normalized RetailCustomer table
    if (pageBatch.length > 0) {
      const upsertStart = Date.now();
      await upsertRetailCustomers(shop, pageBatch.map((c) => ({
        id: c.id,
        city: c.city ?? null,
        latitude: c.latitude,
        longitude: c.longitude,
        createdAt: c.createdAt,
      }))).catch((err) => {
        console.warn(`[retail-footprint:sync] upsertRetailCustomers page SKIP shop=${shop} page=${pageCount}`, err);
      });
      console.info(`[retail-footprint:sync] upsertRetailCustomers page=${pageCount} rows=${pageBatch.length} durationMs=${Date.now() - upsertStart} shop=${shop}`);
    }

    hasNextPage = json.data.customers.pageInfo.hasNextPage;
    cursor = json.data.customers.pageInfo.endCursor;
    pageCount++;
    const elapsed = ((Date.now() - phaseStart) / 1000).toFixed(1);
    console.info(`[retail-footprint:sync] fetchAllCustomers page=${pageCount} pageNodes=${nodes.length} accepted=${pageBatch.length} total=${customers.length} hasNextPage=${hasNextPage} elapsed=${elapsed}s shop=${shop}`);
    if (pageCount % 3 === 0) {
      await writeSyncProgress(shop, "customers", customers.length);
    }
  }

  const totalSec = ((Date.now() - phaseStart) / 1000).toFixed(1);
  console.info(`[retail-footprint:sync] fetchAllCustomers DONE shop=${shop} total=${customers.length} pages=${pageCount} duration=${totalSec}s`);
  return customers;
};

const fetchAllOrders = async (admin: any, shop: string, since?: string) => {
  const orders: OrderGeo[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let pageCount = 0;
  const phaseStart = Date.now();
  const queryFilter = since ? `updated_at:>'${since}'` : null;
  console.info(`[retail-footprint:sync] fetchAllOrders START shop=${shop} since=${since ?? "all"}`);

  while (hasNextPage) {
    const json = await graphqlJsonWithRetry(
      admin,
      `#graphql
        query OrdersGeo($first: Int!, $after: String, $query: String) {
          orders(first: $first, after: $after, query: $query) {
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
                provinceCode
                countryCode
              }
              fulfillmentOrders(first: 1) {
                nodes {
                  assignedLocation {
                    location { id }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { first: ANALYTICS_PAGE_SIZE, after: cursor, query: queryFilter },
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
        provinceCode: string | null;
        countryCode: string | null;
      } | null;
      fulfillmentOrders?: {
        nodes: Array<{
          assignedLocation: {
            location: { id: string } | null;
          };
        }>;
      } | null;
    }>;

    const pageBatch: typeof orders = [];
    nodes.forEach((node) => {
      if (!node.shippingAddress?.city?.trim()) return;
      const fulfillmentLocationId = node.fulfillmentOrders?.nodes?.[0]
        ?.assignedLocation?.location?.id ?? null;
      pageBatch.push({
        id: node.id,
        name: node.name,
        customerId: node.customer?.id ?? null,
        customerName: node.customer?.displayName ?? null,
        city: node.shippingAddress.city.trim(),
        province: node.shippingAddress.provinceCode ?? null,
        country: node.shippingAddress.countryCode ?? null,
        latitude: node.shippingAddress.latitude ?? null,
        longitude: node.shippingAddress.longitude ?? null,
        totalAmount: node.currentTotalPriceSet
          ? Number(node.currentTotalPriceSet.shopMoney.amount)
          : null,
        currencyCode: node.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
        createdAt: node.createdAt ?? null,
        fulfillmentLocationId,
      });
    });
    orders.push(...pageBatch);

    // Dual-write: upsert into normalized RetailOrder table
    if (pageBatch.length > 0) {
      const upsertStart = Date.now();
      await upsertRetailOrders(
        shop,
        pageBatch.map((o) => ({
          id: o.id,
          customerId: o.customerId,
          city: o.city,
          latitude: o.latitude,
          longitude: o.longitude,
          totalAmount: o.totalAmount,
          currencyCode: o.currencyCode,
          createdAt: o.createdAt,
          fulfillmentLocationId: o.fulfillmentLocationId,
        })),
      ).catch((err) => {
        console.warn(`[retail-footprint:sync] upsertRetailOrders page SKIP shop=${shop} page=${pageCount}`, err);
      });
      console.info(`[retail-footprint:sync] upsertRetailOrders page=${pageCount} rows=${pageBatch.length} durationMs=${Date.now() - upsertStart} shop=${shop}`);
    }

    hasNextPage = json.data.orders.pageInfo.hasNextPage;
    cursor = json.data.orders.pageInfo.endCursor;
    pageCount++;
    const elapsed = ((Date.now() - phaseStart) / 1000).toFixed(1);
    console.info(`[retail-footprint:sync] fetchAllOrders page=${pageCount} pageNodes=${nodes.length} accepted=${pageBatch.length} total=${orders.length} hasNextPage=${hasNextPage} elapsed=${elapsed}s shop=${shop}`);
    if (pageCount % 3 === 0) {
      await writeSyncProgress(shop, "orders", orders.length);
    }
  }

  const totalSec = ((Date.now() - phaseStart) / 1000).toFixed(1);
  console.info(`[retail-footprint:sync] fetchAllOrders DONE shop=${shop} total=${orders.length} pages=${pageCount} duration=${totalSec}s`);
  return orders;
};

const backfillAnalytics = async (
  admin: any,
  shop: string,
  fullResync = false,
) => {
  const syncStart = Date.now();
  const meta = await readSyncMeta(shop);
  const since = (!fullResync && meta.lastSyncedAt) ? meta.lastSyncedAt : undefined;
  const mode = since ? "incremental" : "full";
  console.info(`[retail-footprint:sync] ═══ backfillAnalytics START shop=${shop} mode=${mode} since=${since ?? "all"} ═══`);

  // Phase 1: Customers
  await writeSyncMeta(shop, "running", { phase: "customers" });
  const customers = await fetchAllCustomers(admin, shop, since);

  // Phase 2: Orders
  await writeSyncMeta(shop, "running", { phase: "orders" });
  await sleep(250);
  const orders = await fetchAllOrders(admin, shop, since);

  // Rebuild pre-computed aggregates from the normalized tables
  await writeSyncMeta(shop, "running", { phase: "aggregating" });
  const aggStart = Date.now();
  await rebuildCityAggregates(shop);
  await rebuildHeatmapBuckets(shop);
  console.info(`[retail-footprint:sync] aggregates DONE shop=${shop} durationMs=${Date.now() - aggStart}`);

  await writeSyncMeta(shop, "idle", {
    totalOrders: orders.length,
    totalCustomers: customers.length,
  });

  const totalSec = ((Date.now() - syncStart) / 1000).toFixed(1);
  console.info(`[retail-footprint:sync] ═══ backfillAnalytics DONE shop=${shop} customers=${customers.length} orders=${orders.length} totalDuration=${totalSec}s ═══`);
  return { customers: customers.length, orders: orders.length };
};

// ---------------------------------------------------------------------------

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const userLocale = normalizeLocale((session as any).locale);

  const [locations, locationSets, heatmapBuckets, cityRankings, proposals, statsConfig, syncMeta] = await Promise.all([
    readLocations(shop),
    readLocationSets(shop),
    getHeatmapBuckets(shop),
    getCityRankings(shop),
    readProposals(shop),
    readStatsConfig(shop),
    readSyncMeta(shop),
  ]);

  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
  const mapsMapId = process.env.GOOGLE_MAPS_MAP_ID?.trim() || "";

  // If sync failed but existing data is available, downgrade to idle so the UI stays functional
  const hasExistingData = heatmapBuckets.length > 0 || (syncMeta.totalOrders != null && syncMeta.totalOrders > 0);
  const effectiveStatus = syncMeta.status === "failed" && hasExistingData ? "idle" : syncMeta.status;
  const syncWarning = syncMeta.status === "failed" && hasExistingData ? (syncMeta.errorMessage ?? null) : null;

  console.info(`[retail-footprint] loader shop=${shop} syncStatus=${syncMeta.status}→${effectiveStatus} heatmapBuckets=${heatmapBuckets.length} cityRankings=${cityRankings.length} lastSynced=${syncMeta.lastSyncedAt ?? "?"}`);

  return {
    locations,
    locationSets,
    heatmapBuckets,
    cityRankings,
    syncStatus: effectiveStatus,
    syncError: effectiveStatus === "failed" ? (syncMeta.errorMessage ?? null) : null,
    syncWarning,
    syncPhase: syncMeta.phase,
    syncProgressCount: syncMeta.progressCount,
    syncStartedAt: syncMeta.startedAt,
    syncTotalCustomers: syncMeta.totalCustomers,
    syncTotalOrders: syncMeta.totalOrders,
    syncLastSyncedAt: syncMeta.lastSyncedAt,
    mapsApiKey,
    mapsMapId,
    userLocale,
    proposals,
    statsConfig,
  };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  console.info(`[retail-footprint] action intent=${intent ?? "?"} shop=${shop}`);

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
    const locationsJson = formData.get("locations");
    let locationsToSave: RetailLocation[];
    if (locationsJson && typeof locationsJson === "string") {
      try {
        locationsToSave = JSON.parse(locationsJson) as RetailLocation[];
      } catch {
        return { ok: false, error: "Invalid locations payload." };
      }
    } else {
      locationsToSave = await readLocations(shop);
    }
    const sets = await readLocationSets(shop);
    const clientSetId = String(formData.get("setId") || "").trim();
    const nextSet: LocationSet = {
      id: clientSetId || `set-${Date.now()}`,
      name: setName,
      locations: locationsToSave,
      createdAt: new Date().toISOString(),
    };
    await writeLocationSets([...sets, nextSet], shop);
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
    const setId = String(formData.get("setId") || "").trim();
    if (!setId) return { ok: false, error: "Missing setId." };
    const sets = await readLocationSets(shop);
    const next = sets.filter((s) => s.id !== setId);
    await writeLocationSets(next, shop);
    console.info(`[retail-footprint] delete-location-set OK shop=${shop} setId=${setId}`);
    return { ok: true };
  }

  if (intent === "update-location-fit") {
    const setId = String(formData.get("setId") || "");
    const locationId = String(formData.get("locationId") || "");
    const tenantMixFitRaw = formData.get("tenantMixFit");
    const subjectiveFitRaw = formData.get("subjectiveFit");
    const predominantAudienceRaw = formData.get("predominantAudience");
    const sets = await readLocationSets(shop);
    const idx = sets.findIndex((s) => s.id === setId);
    if (idx < 0) return { ok: false, error: "Project not found." };
    const next = [...sets];
    next[idx] = {
      ...next[idx],
      locations: next[idx].locations.map((loc) => {
        if (loc.id !== locationId) return loc;
        return {
          ...loc,
          ...(tenantMixFitRaw != null ? { tenantMixFit: Number(tenantMixFitRaw) } : {}),
          ...(subjectiveFitRaw != null ? { subjectiveFit: Number(subjectiveFitRaw) } : {}),
          ...(predominantAudienceRaw != null ? { predominantAudience: (predominantAudienceRaw as string || null) as RetailLocation["predominantAudience"] } : {}),
        };
      }),
    };
    await writeLocationSets(next, shop);
    return { ok: true };
  }

  if (intent === "sync-analytics") {
    const fullResync = formData.get("fullResync") === "true";
    console.info(`[retail-footprint] sync-analytics START shop=${shop} fullResync=${fullResync}`);
    await writeSyncMeta(shop, "running");
    backfillAnalytics(admin, shop, fullResync)
      .catch((err: unknown) => {
        const msg = String((err as Error)?.message ?? err);
        console.error(`[retail-footprint] sync-analytics backfill FAILED shop=${shop}`, err);
        const userMsg = msg.includes("not approved")
          ? "This app needs protected customer data approval. Remove sensitive fields or request access in the Partner Dashboard."
          : msg;
        writeSyncMeta(shop, "failed", { errorMessage: userMsg });
      });
    return { ok: true, intent: "sync-analytics", syncStatus: "running" };
  }

  if (intent === "refresh-rankings") {
    const startMonth = String(formData.get("startMonth") || "") || undefined;
    const endMonth = String(formData.get("endMonth") || "") || undefined;
    console.info(`[retail-footprint] refresh-rankings shop=${shop} startMonth=${startMonth ?? "?"} endMonth=${endMonth ?? "?"}`);
    const cityRankings = await getCityRankings(shop, startMonth, endMonth);
    return { ok: true, intent: "refresh-rankings", cityRankings };
  }

  if (intent === "load-project-stats") {
    const setId = String(formData.get("setId") || "").trim();
    const radiiJson = String(formData.get("radii") || "[]");
    const startMonth = String(formData.get("startMonth") || "") || undefined;
    const endMonth = String(formData.get("endMonth") || "") || undefined;
    const sets = await readLocationSets(shop);
    const set = sets.find((s) => s.id === setId);
    if (!set) return { ok: false, error: "Project not found." };
    const radii = JSON.parse(radiiJson) as number[];
    // Convert months to date range for order filtering
    let dateRange: { start: Date; end: Date } | undefined;
    if (startMonth) {
      const start = new Date(`${startMonth}-01T00:00:00Z`);
      const endDate = endMonth ? new Date(`${endMonth}-01T00:00:00Z`) : new Date();
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(endDate.getDate() - 1);
      dateRange = { start, end: endDate };
    }
    console.info(`[retail-footprint] load-project-stats shop=${shop} setId=${setId} locations=${set.locations.length} radii=${radii.join(",")}`);
    const [projectStats, projectStatsConfig] = await Promise.all([
      getProjectRadiusStats(
        shop,
        set.locations.map((loc) => ({ id: loc.id, name: loc.name, latitude: loc.latitude, longitude: loc.longitude })),
        radii,
        dateRange,
      ),
      readStatsConfig(shop, setId),
    ]);
    return { ok: true, intent: "load-project-stats", projectStats, projectStatsConfig };
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const mpFormData = await request.formData();
    const mpIntent = String(mpFormData.get("intent") || "");

    if (mpIntent === "save-proposal") {
      const locationSetId = String(mpFormData.get("locationSetId") || "").trim();
      const locationId = String(mpFormData.get("locationId") || "").trim();
      const proposalId = String(mpFormData.get("proposalId") || "").trim() || undefined;
      const leasingRaw = mpFormData.get("leasingValue");
      const leasingValue = leasingRaw ? Number(leasingRaw) : null;
      const currency = String(mpFormData.get("currency") || "").trim() || null;
      const notes = String(mpFormData.get("notes") || "").trim() || null;

      if (!locationSetId || !locationId) {
        return { ok: false, error: "Missing locationSetId or locationId." };
      }

      const file = mpFormData.get("file") as File | null;
      let fileData: Buffer | null = null;
      let fileName: string | null = null;
      let fileType: string | null = null;
      let fileSize: number | null = null;

      if (file && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer();
        fileData = Buffer.from(arrayBuffer);
        fileName = file.name || "attachment";
        fileType = file.type || "application/octet-stream";
        fileSize = file.size;
      }

      const saved = await upsertProposal(shop, {
        id: proposalId,
        locationSetId,
        locationId,
        leasingValue: leasingValue !== null && !Number.isNaN(leasingValue) ? leasingValue : null,
        currency,
        notes,
        ...(fileData !== null ? { fileName, fileType, fileSize, fileData } : {}),
      });
      return { ok: true, proposal: saved };
    }
  }

  if (intent === "delete-proposal") {
    const proposalId = String(formData.get("proposalId") || "").trim();
    if (!proposalId) return { ok: false, error: "Missing proposalId." };
    await deleteProposal(shop, proposalId);
    return { ok: true };
  }

  if (intent === "save-stats-config") {
    const setId = String(formData.get("setId") || "") || null;
    const configJson = String(formData.get("config") || "");
    try {
      const config = JSON.parse(configJson) as StatsConfig;
      await writeStatsConfig(shop, setId, config);
      return { ok: true };
    } catch {
      return { ok: false, error: "Invalid stats config." };
    }
  }

  if (intent === "reset-stats-config") {
    const setId = String(formData.get("setId") || "") || null;
    await resetStatsConfig(shop, setId);
    return { ok: true };
  }

  if (intent === "fetch-overview-stats") {
    const period = parseInt(String(formData.get("period") || "365"), 10);
    try {
      const locationsResponse = await admin.graphql(
        `#graphql
        query LocationsForOverview {
          locations(first: 50) {
            nodes {
              id
              name
              address { city }
              localPickupSettingsV2 { instructions }
            }
          }
        }`,
      );
      const locationsJson = await locationsResponse.json();
      const rawLocations = locationsJson.data?.locations?.nodes ?? [];

      const classified = classifyLocations(rawLocations);
      const overviewStats = await computeOverviewStats(shop, period, classified);

      console.info(`[retail-footprint:overview] stats OK shop=${shop} period=${period}d`);
      return { ok: true, intent: "fetch-overview-stats", overviewStats };
    } catch (err) {
      console.error("[retail-footprint:overview] stats FAILED", err);
      return { ok: false, intent: "fetch-overview-stats", error: "Failed to compute overview stats" };
    }
  }

  return { ok: false, error: "Unknown action." };
};

export default function RetailLocatorRoute() {
  const {
    locations,
    locationSets: loaderLocationSets,
    heatmapBuckets: loaderHeatmapBuckets,
    cityRankings: loaderCityRankings,
    syncStatus,
    syncError,
    syncWarning,
    syncPhase,
    syncProgressCount,
    syncStartedAt,
    syncTotalCustomers,
    syncTotalOrders,
    syncLastSyncedAt,
    mapsApiKey,
    mapsMapId,
    userLocale,
    proposals,
    statsConfig: loaderStatsConfig,
  } =
    useLoaderData<typeof loader>();
  const { t } = useTranslation("retail-expansion");
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  // After submitting sync-analytics, trigger one revalidation to get "running" state
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      (fetcher.data as any)?.intent === "sync-analytics" &&
      (fetcher.data as any)?.ok === true
    ) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data]);
  // Poll every 5s while a backfill is running
  useEffect(() => {
    if (syncStatus !== "running") return;
    const timer = setInterval(() => {
      revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [syncStatus]);

  // Auto-incremental sync: if data is stale (> 6h), trigger background sync on mount
  const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours
  useEffect(() => {
    if (syncStatus !== "idle") return;
    if (!syncLastSyncedAt) return; // no previous sync — don't auto-trigger (user should do first sync manually)
    const elapsed = Date.now() - new Date(syncLastSyncedAt).getTime();
    if (elapsed > STALE_THRESHOLD_MS) {
      console.info(`[retail-footprint] auto-sync: data stale (${Math.round(elapsed / 3600000)}h), triggering incremental sync`);
      fetcher.submit({ intent: "sync-analytics" }, { method: "post" });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [localLocationSets, setLocalLocationSets] = useState<LocationSet[]>(loaderLocationSets);
  useEffect(() => { setLocalLocationSets(loaderLocationSets); }, [loaderLocationSets]);
  const [statsConfigApplied, setStatsConfigApplied] = useState<StatsConfig>(loaderStatsConfig);
  const [statsConfigDraft, setStatsConfigDraft] = useState<StatsConfig>(loaderStatsConfig);
  useEffect(() => { setStatsConfigApplied(loaderStatsConfig); }, [loaderStatsConfig]);
  const locationSets = localLocationSets;
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [locationName, setLocationName] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<{
    latitude: number;
    longitude: number;
    city?: string | null;
    province?: string | null;
    neighborhood?: string | null;
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
  const handleAddLocationRef = useRef<(n: string, p: { latitude: number; longitude: number; city: string | null; province?: string | null; neighborhood: string | null }) => void>(() => {});
  const [mapsLoadError, setMapsLoadError] = useState<string | null>(null);
  const [setName, setSetName] = useState("");
  const [showSelectionMap, setShowSelectionMap] = useState(false);
  const [mapLocationName, setMapLocationName] = useState("");
  const [isHeatmapExpanded, setIsHeatmapExpanded] = useState(false);
  const [citiesCollapsed, setCitiesCollapsed] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pendingLocations, setPendingLocations] = useState<RetailLocation[]>([]);
  const [showNationalViewReset, setShowNationalViewReset] = useState(false);

  // ── Overview stats strip ──────────────────────────────────────────────────
  const overviewFetcher = useFetcher();
  const [overviewPeriod, setOverviewPeriod] = useState(365);
  const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
  const isLoadingOverview = overviewFetcher.state !== "idle";

  useEffect(() => {
    if (syncStatus === "idle" && syncTotalOrders && syncTotalOrders > 0) {
      overviewFetcher.submit(
        { intent: "fetch-overview-stats", period: String(overviewPeriod) },
        { method: "POST" },
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const data = overviewFetcher.data as { ok: boolean; intent?: string; overviewStats?: OverviewStats } | undefined;
    if (data?.ok && data?.intent === "fetch-overview-stats" && data?.overviewStats) {
      setOverviewStats(data.overviewStats);
    }
  }, [overviewFetcher.data]);

  const [row1DrillDown, setRow1DrillDown] = useState<"revenue" | "orders" | "customers" | null>(null);
  const [row3DrillDown, setRow3DrillDown] = useState<"pareto" | "channel" | "projection" | null>(null);
  const [monthlyAvg, setMonthlyAvg] = useState(false);

  const monthsInPeriod = Math.max(1, Math.round(overviewPeriod / 30));
  const applyAvg = (value: number) => monthlyAvg ? Math.round(value / monthsInPeriod) : value;

  const handleRow1CardClick = (metric: "revenue" | "orders" | "customers") => {
    setRow1DrillDown((prev) => (prev === metric ? null : metric));
    setRow3DrillDown(null);
  };
  const handleRow3CardClick = (card: "pareto" | "channel" | "projection") => {
    setRow3DrillDown((prev) => (prev === card ? null : card));
    setRow1DrillDown(null);
  };

  const handleOverviewPeriodChange = (newPeriod: number) => {
    setOverviewPeriod(newPeriod);
    overviewFetcher.submit(
      { intent: "fetch-overview-stats", period: String(newPeriod) },
      { method: "POST" },
    );
  };

  const formatNumberCompact = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  const [deleteConfirmSetId, setDeleteConfirmSetId] = useState<string | null>(null);
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
  const [mapStyleDraft, setMapStyleDraft] = useState<MapStyleOption>("light");
  const [mapStyleApplied, setMapStyleApplied] = useState<MapStyleOption>("light");
  const [intensityDraft, setIntensityDraft] = useState<HeatmapIntensity>("local");
  const [intensityApplied, setIntensityApplied] = useState<HeatmapIntensity>("local");
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

  const [activeProposalLocationSetId, setActiveProposalLocationSetId] = useState<string | null>(null);
  const [activeProposalLocationId, setActiveProposalLocationId] = useState<string | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [proposalLeasingValue, setProposalLeasingValue] = useState("");
  const [proposalCurrency, setProposalCurrency] = useState("BRL");
  const [proposalNotes, setProposalNotes] = useState("");
  const proposalFileRef = useRef<HTMLInputElement | null>(null);

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
        label: t("dateRange.lastRange", { count: 30, unit: t("dateRange.units.days") }),
        getRange: (): DateRangeState => ({
          mode: "rolling",
          fixed: { startDate: "", endDate: "" },
          rolling: { unit: "day", last: 30, includeCurrentPeriod: true },
          selectedPresetId: "last-30-days",
        }),
      },
      {
        id: "last-90-days",
        label: t("dateRange.lastRange", { count: 90, unit: t("dateRange.units.days") }),
        getRange: (): DateRangeState => ({
          mode: "rolling",
          fixed: { startDate: "", endDate: "" },
          rolling: { unit: "day", last: 90, includeCurrentPeriod: true },
          selectedPresetId: "last-90-days",
        }),
      },
      {
        id: "last-6-months",
        label: t("dateRange.lastRange", { count: 6, unit: t("dateRange.units.months") }),
        getRange: (): DateRangeState => ({
          mode: "rolling",
          fixed: { startDate: "", endDate: "" },
          rolling: { unit: "month", last: 6, includeCurrentPeriod: true },
          selectedPresetId: "last-6-months",
        }),
      },
      {
        id: "last-12-months",
        label: t("dateRange.lastRange", { count: 12, unit: t("dateRange.units.months") }),
        getRange: (): DateRangeState => ({
          mode: "rolling",
          fixed: { startDate: "", endDate: "" },
          rolling: { unit: "month", last: 12, includeCurrentPeriod: true },
          selectedPresetId: "last-12-months",
        }),
      },
    ],
    [t],
  );

  // ── City rankings: use loader data, updated by date-range fetcher ──
  const rankingsFetcher = useFetcher();
  const [cityRankings, setCityRankings] = useState<CityRanking[]>(loaderCityRankings);
  useEffect(() => { setCityRankings(loaderCityRankings); }, [loaderCityRankings]);

  // Build canonical city name lookup from cityRankings (same source as legacy bar chart)
  const cityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of cityRankings) {
      map.set(r.cityNorm, r.city);
    }
    return map;
  }, [cityRankings]);
  const canonCity = (cityDisplay: string, cityNorm?: string): string => {
    if (cityNorm && cityNameMap.has(cityNorm)) return cityNameMap.get(cityNorm)!;
    for (const [, display] of cityNameMap) {
      if (display.toLowerCase() === cityDisplay.toLowerCase()) return display;
    }
    return cityDisplay;
  };
  useEffect(() => {
    if (rankingsFetcher.state === "idle" && (rankingsFetcher.data as any)?.intent === "refresh-rankings") {
      setCityRankings((rankingsFetcher.data as any).cityRankings ?? []);
    }
  }, [rankingsFetcher.state, rankingsFetcher.data]);

  // ── Project stats: loaded on-demand via fetcher ──
  const projectStatsFetcher = useFetcher();
  const [projectStats, setProjectStats] = useState<LocationWithStats[]>([]);
  useEffect(() => {
    if (projectStatsFetcher.state === "idle" && (projectStatsFetcher.data as any)?.intent === "load-project-stats") {
      setProjectStats((projectStatsFetcher.data as any).projectStats ?? []);
      // Apply per-project stats config if available
      const cfg = (projectStatsFetcher.data as any).projectStatsConfig as StatsConfig | undefined;
      if (cfg) {
        setStatsConfigApplied(cfg);
        setStatsConfigDraft(cfg);
      }
    }
  }, [projectStatsFetcher.state, projectStatsFetcher.data]);

  // ── Date range → months for server queries ──
  const getMonthRange = (range: DateRangeState) => {
    const bounds = getDateRangeBounds(range);
    if (!bounds) return { startMonth: undefined, endMonth: undefined };
    const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { startMonth: fmt(bounds.start), endMonth: fmt(bounds.end) };
  };

  // ── Date range debounced refresh ──
  const dateRangeDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (dateRangeDebounceRef.current != null) window.clearTimeout(dateRangeDebounceRef.current);
    dateRangeDebounceRef.current = window.setTimeout(() => {
      const { startMonth, endMonth } = getMonthRange(dateRangeApplied);
      const fd = new FormData();
      fd.append("intent", "refresh-rankings");
      if (startMonth) fd.append("startMonth", startMonth);
      if (endMonth) fd.append("endMonth", endMonth);
      rankingsFetcher.submit(fd, { method: "post" });
    }, 300);
    return () => { if (dateRangeDebounceRef.current != null) window.clearTimeout(dateRangeDebounceRef.current); };
  }, [dateRangeApplied]);

  // ── Top cities: sorted view of server-provided cityRankings ──
  const topCitiesByMetric = useMemo(() => {
    const sorted = [...cityRankings];
    if (heatmapWeightApplied === "revenue") {
      sorted.sort((a, b) => b.revenueMonthlyAverage - a.revenueMonthlyAverage);
    } else if (heatmapWeightApplied === "customers") {
      sorted.sort((a, b) => b.customersMonthlyAverage - a.customersMonthlyAverage);
    } else {
      sorted.sort((a, b) => b.ordersMonthlyAverage - a.ordersMonthlyAverage);
    }
    return sorted.slice(0, 10);
  }, [cityRankings, heatmapWeightApplied]);

  // ── Loaded radii from stats config ──
  const loadedRadii = useMemo(() => {
    const all = statsConfigApplied.radii
      .filter((r) => r.enabled)
      .map((r) => ({ value: r.value, isCustom: false }));
    // Legacy: merge customRadiusKm if present (backward compat)
    if (statsConfigApplied.customRadiusKm != null) {
      const cv = statsConfigApplied.customRadiusKm;
      const existing = all.find((r) => r.value === cv);
      if (existing) {
        existing.isCustom = true;
      } else {
        all.push({ value: cv, isCustom: true });
      }
    }
    all.sort((a, b) => a.value - b.value);
    return all;
  }, [statsConfigApplied]);

  const radiusUnit = statsConfigApplied.radiusUnit ?? "km";
  const formatRadiusLabel = (km: number) => {
    if (radiusUnit === "mi") return `${+(km / KM_PER_MI).toFixed(1)} mi`;
    return `${km}km`;
  };

  // ── Loaded project metrics: merge server stats with location metadata ──
  const loadedProjectMetrics = useMemo(() => {
    if (!loadedProjectId) return [];
    const set = locationSets.find((s) => s.id === loadedProjectId);
    if (!set) return [];
    return set.locations.map((location) => {
      const serverLoc = projectStats.find((ps) => ps.locationId === location.id);
      const stats = loadedRadii.map((r) => {
        const serverStat = serverLoc?.stats.find((s) => s.radius === r.value);
        return {
          radius: r.value,
          isCustom: r.isCustom,
          revenue: serverStat?.revenue ?? 0,
          customers: serverStat?.customers ?? 0,
          orders: serverStat?.orders ?? 0,
          currencyCode: serverStat?.currencyCode ?? null,
        };
      });
      return {
        ...location,
        stats,
        currencyCode: stats.find((s) => s.currencyCode)?.currencyCode ?? null,
      };
    });
  }, [loadedProjectId, locationSets, projectStats, loadedRadii]);

  const sortedLoadedMetrics = useMemo(() => {
    if (!sortColumn || loadedProjectMetrics.length === 0) return loadedProjectMetrics;
    if (sortColumn === "predominantAudience") {
      const order: Record<string, number> = { A: 3, B: 2, C: 1, "N/A": 0 };
      return [...loadedProjectMetrics].sort((a, b) => {
        const aVal = order[a.predominantAudience ?? ""] ?? -1;
        const bVal = order[b.predominantAudience ?? ""] ?? -1;
        return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
      });
    }
    if (sortColumn === "tenantMixFit" || sortColumn === "subjectiveFit") {
      const key = sortColumn as "tenantMixFit" | "subjectiveFit";
      return [...loadedProjectMetrics].sort((a, b) => {
        const aVal = a[key] ?? 0;
        const bVal = b[key] ?? 0;
        return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
      });
    }
    const parts = sortColumn.split("-");
    const radiusKey = parts[0];
    const metric = parts.slice(1).join("-");
    const radiusValue = radiusKey === "custom" ? statsConfigApplied.customRadiusKm : Number(radiusKey);
    if (radiusValue == null) return loadedProjectMetrics;
    return [...loadedProjectMetrics].sort((a, b) => {
      const aStat = a.stats.find((s) => s.radius === radiusValue);
      const bStat = b.stats.find((s) => s.radius === radiusValue);
      const aVal = aStat ? (aStat as unknown as Record<string, number>)[metric] ?? 0 : 0;
      const bVal = bStat ? (bStat as unknown as Record<string, number>)[metric] ?? 0 : 0;
      return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [loadedProjectMetrics, sortColumn, sortDirection, statsConfigApplied.customRadiusKm]);

  // ── Project table data: lightweight summary from cityRankings ──
  const projectTableData = useMemo(() => {
    return locationSets.map((set) => {
      // Use first city ranking's currency as fallback
      const currencyCode = cityRankings.find((c) => c.currencyCode)?.currencyCode ?? null;
      return {
        id: set.id,
        name: set.name,
        locationCount: set.locations.length,
        revenueMonthlyAverage: 0,
        ordersMonthlyAverage: 0,
        customersMonthlyAverage: 0,
        currencyCode,
      };
    });
  }, [locationSets, cityRankings]);

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
    if (intensityApplied === "national") {
      overviewHeatmapLayer.current.set("maxIntensity", null);
      return;
    }
    const bounds = overviewMapInstance.current.getBounds?.();
    if (!bounds) return;
    const visiblePoints = heatmapPoints.filter((point) =>
      bounds.contains(new googleMaps.LatLng(point.lat, point.lng)),
    );
    const multiplier = intensityApplied === "regional" ? 0.3 : 0.1;
    const dynamicMax = Math.max(5, visiblePoints.length * multiplier);
    overviewHeatmapLayer.current.set("maxIntensity", dynamicMax);
  };

  // ── Heatmap points: derived from pre-computed buckets ──
  const heatmapPoints = useMemo(() => {
    return loaderHeatmapBuckets.map((bucket) => ({
      lat: bucket.lat3,
      lng: bucket.lng3,
      weight:
        heatmapWeightApplied === "revenue"
          ? Math.max(bucket.revenueSum, 0)
          : heatmapWeightApplied === "customers"
            ? bucket.customerCount
            : bucket.orderCount,
    }));
  }, [loaderHeatmapBuckets, heatmapWeightApplied]);

  // ── Helper to fetch project stats from server ──
  const fetchProjectStats = (setId: string) => {
    const radii = loadedRadii.map((r) => r.value);
    const { startMonth, endMonth } = getMonthRange(dateRangeApplied);
    const fd = new FormData();
    fd.append("intent", "load-project-stats");
    fd.append("setId", setId);
    fd.append("radii", JSON.stringify(radii));
    if (startMonth) fd.append("startMonth", startMonth);
    if (endMonth) fd.append("endMonth", endMonth);
    projectStatsFetcher.submit(fd, { method: "post" });
  };

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
    if (typeof window === "undefined") return;
    const savedStyle = window.localStorage.getItem(MAP_STYLE_STORAGE_KEY);
    if (savedStyle === "dark" || savedStyle === "grayscale" || savedStyle === "light") {
      setMapStyleApplied(savedStyle);
      setMapStyleDraft(savedStyle);
    }
    const savedIntensity = window.localStorage.getItem(HEATMAP_INTENSITY_STORAGE_KEY);
    if (savedIntensity === "national" || savedIntensity === "regional" || savedIntensity === "local") {
      setIntensityApplied(savedIntensity);
      setIntensityDraft(savedIntensity);
    }
  }, []);

  // Reset sort when loaded project changes
  useEffect(() => {
    setSortColumn(null);
    setSortDirection("desc");
  }, [loadedProjectId]);

  useEffect(() => {
    if (deleteConfirmSetId) {
      const modal = document.getElementById("delete-project-confirm-modal");
      (modal as HTMLElement & { showOverlay?: () => void })?.showOverlay?.();
    }
  }, [deleteConfirmSetId]);

  useEffect(() => {
    if (!overviewMapInstance.current || !overviewHeatmapLayer.current) return;
    const googleMaps = window.google?.maps;
    if (!googleMaps) return;
    updateLocalScaling(googleMaps);
  }, [localScalingApplied, intensityApplied, heatmapPoints]);

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

        // Show markers only for loaded project locations (standalone locations are not rendered)
        const markersSource = loadedProjectId && sortedLoadedMetrics.length > 0
          ? sortedLoadedMetrics.map((loc, idx) => ({
              name: loc.name,
              latitude: loc.latitude,
              longitude: loc.longitude,
              medal: idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "📍",
            }))
          : [];

        markersSource.forEach((location) => {
          if (!AdvancedMarkerElement) return;
          const content = document.createElement("div");
          content.className = styles.mapLabel;
          content.textContent = `${location.medal} ${location.name}`;
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

        // Fit map bounds: loaded project locations, or all metrics
        if (loadedProjectId) {
          const loadedSet = locationSets.find((s) => s.id === loadedProjectId);
          if (loadedSet && loadedSet.locations.length > 0) {
            const bounds = new googleMaps.LatLngBounds();
            loadedSet.locations.forEach((loc) => {
              bounds.extend({ lat: loc.latitude, lng: loc.longitude });
            });
            overviewMapInstance.current.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
          }
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
    showSelectionMap,
    heatmapPoints,
    localScalingApplied,
    loadedProjectId,
    sortedLoadedMetrics,
    locationSets,
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
          fields: ["displayName", "formattedAddress", "location", "viewport", "addressComponents"],
        });
        const displayName =
          place.displayName || place.formattedAddress || "";
        setLocationName(displayName);
        if (!place.location) return;
        const lat = place.location.lat();
        const lng = place.location.lng();
        const cityComponent = (place.addressComponents as any[])?.find(
          (c: any) => c.types?.includes("locality") || c.types?.includes("administrative_area_level_2"),
        );
        const city = cityComponent?.longText ?? cityComponent?.shortText ?? null;
        const provinceComponent = (place.addressComponents as any[])?.find(
          (c: any) => c.types?.includes("administrative_area_level_1"),
        );
        const province = provinceComponent?.longText ?? provinceComponent?.shortText ?? null;
        const neighborhoodComponent = (place.addressComponents as any[])?.find(
          (c: any) => c.types?.includes("sublocality") || c.types?.includes("sublocality_level_1") || c.types?.includes("neighborhood"),
        );
        const neighborhood = neighborhoodComponent?.longText ?? neighborhoodComponent?.shortText ?? null;
        setSelectedPoint({ latitude: lat, longitude: lng, city, province, neighborhood });
        handleAddLocationRef.current(displayName, { latitude: lat, longitude: lng, city, province, neighborhood });
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
  }, [mapsApiKey, mapsMapId]);

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

  const handleAddLocation = (
    overrideName?: string,
    overridePoint?: { latitude: number; longitude: number; city: string | null; province?: string | null; neighborhood: string | null },
  ) => {
    const name = overrideName ?? locationName;
    const point = overridePoint ?? selectedPoint;
    if (!point || !name.trim()) return;
    const next: RetailLocation = {
      id: `loc-${Date.now()}`,
      name: name.trim(),
      latitude: point.latitude,
      longitude: point.longitude,
      city: point.city ?? null,
      province: point.province ?? null,
      neighborhood: point.neighborhood ?? null,
      createdAt: new Date().toISOString(),
    };
    if (editingSetId) {
      setEditingSetLocations((prev) => [...prev, next]);
    } else {
      setPendingLocations((prev) => [...prev, next]);
    }
    setLocationName("");
    setSelectedPoint(null);
    clearAutocompleteInputs();
    if (selectionMarker.current) {
      selectionMarker.current.map = null;
      selectionMarker.current = null;
    }
  };
  handleAddLocationRef.current = (n, p) => handleAddLocation(n, p);

  const handleAddLocationFromMap = () => {
    if (!selectedPoint || !mapLocationName.trim()) return;
    const next: RetailLocation = {
      id: `loc-${Date.now()}`,
      name: mapLocationName.trim(),
      latitude: selectedPoint.latitude,
      longitude: selectedPoint.longitude,
      city: selectedPoint.city ?? null,
      province: selectedPoint.province ?? null,
      neighborhood: selectedPoint.neighborhood ?? null,
      createdAt: new Date().toISOString(),
    };
    if (editingSetId) {
      setEditingSetLocations((prev) => [...prev, next]);
    } else {
      setPendingLocations((prev) => [...prev, next]);
    }
    setMapLocationName("");
    setShowSelectionMap(false);
    clearAutocompleteInputs();
    if (selectionMarker.current) {
      selectionMarker.current.map = null;
      selectionMarker.current = null;
    }
  };


  const handleStartNewProject = () => {
    setPendingLocations([]);
    setLocationName("");
    setSelectedPoint(null);
    setMapLocationName("");
    clearAutocompleteInputs();
  };

  const handleOpenCustomizeStats = () => {
    setStatsConfigDraft({ ...statsConfigApplied });
  };

  const handleCancelCustomizeStats = () => {
    setStatsConfigDraft({ ...statsConfigApplied });
  };

  const handleSaveCustomizeStats = () => {
    // Sort radii by value ascending so columns display in order
    const sorted = { ...statsConfigDraft, radii: [...statsConfigDraft.radii].sort((a, b) => a.value - b.value) };
    setStatsConfigApplied(sorted);
    setStatsConfigDraft(sorted);
    const fd = new FormData();
    fd.append("intent", "save-stats-config");
    fd.append("setId", loadedProjectId ?? "");
    fd.append("config", JSON.stringify(sorted));
    fetcher.submit(fd, { method: "post" });
    const modal = document.getElementById("customize-stats-modal") as HTMLElement | null;
    modal?.removeAttribute("open");
    // Re-fetch project stats with updated radii
    if (loadedProjectId) {
      // Use sorted radii for the fetch (loadedRadii memo hasn't updated yet)
      const radii = sorted.radii.filter((r) => r.enabled).map((r) => r.value);
      if (sorted.customRadiusKm != null && !radii.includes(sorted.customRadiusKm)) {
        radii.push(sorted.customRadiusKm);
      }
      radii.sort((a, b) => a - b);
      const { startMonth, endMonth } = getMonthRange(dateRangeApplied);
      const statsFd = new FormData();
      statsFd.append("intent", "load-project-stats");
      statsFd.append("setId", loadedProjectId);
      statsFd.append("radii", JSON.stringify(radii));
      if (startMonth) statsFd.append("startMonth", startMonth);
      if (endMonth) statsFd.append("endMonth", endMonth);
      projectStatsFetcher.submit(statsFd, { method: "post" });
    }
  };

  const handleResetCustomizeStats = () => {
    setStatsConfigDraft({ ...DEFAULT_STATS_CONFIG });
  };

  const statsConfigChanged = JSON.stringify(statsConfigDraft) !== JSON.stringify(statsConfigApplied);

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
    setMapStyleDraft(mapStyleApplied);
    setIntensityDraft(intensityApplied);
  };

  const handleCancelHeatmapOptions = () => {
    setMapStyleDraft(mapStyleApplied);
    setIntensityDraft(intensityApplied);
  };

  const handleApplyHeatmapOptions = () => {
    setMapStyleApplied(mapStyleDraft);
    setIntensityApplied(intensityDraft);
    // Map intensity to localScaling boolean for the existing heatmap logic
    const isLocal = intensityDraft === "local";
    setLocalScalingApplied(isLocal);
    setLocalScalingDraft(isLocal);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(localScalingStorageKey, isLocal ? "true" : "false");
      window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, mapStyleDraft);
      window.localStorage.setItem(HEATMAP_INTENSITY_STORAGE_KEY, intensityDraft);
    }
  };

  const handleSaveSet = () => {
    if (!setName.trim() || pendingLocations.length === 0) return;
    const newSetId = `set-${Date.now()}`;
    const newSet: LocationSet = {
      id: newSetId,
      name: setName.trim(),
      locations: [...pendingLocations],
      createdAt: new Date().toISOString(),
    };
    const formData = new FormData();
    formData.append("intent", "save-location-set");
    formData.append("setId", newSetId);
    formData.append("setName", setName.trim());
    formData.append("locations", JSON.stringify(pendingLocations));
    fetcher.submit(formData, { method: "post" });
    // Optimistically add to sidebar
    setLocalLocationSets((prev) => [...prev, newSet]);
    // Auto-load the newly created project in focused layout
    setLoadedProjectId(newSetId);
    fetchProjectStats(newSetId);
    setIsHeatmapExpanded(true);
    setCitiesCollapsed(true);
    setProjectsCollapsed(true);
    setSetName("");
    setPendingLocations([]);
  };

  useEffect(() => {
    const data = fetcher.data as { setId?: string } | undefined;
    if (!data?.setId) return;
    setSelectedSetId(data.setId);
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

  // Apply map style (light / grayscale / dark) to both map instances
  useEffect(() => {
    const styles = MAP_STYLES[mapStyleApplied] ?? [];
    if (overviewMapInstance.current) {
      (overviewMapInstance.current as any).setOptions({ styles });
    }
    if (selectionMapInstance.current) {
      (selectionMapInstance.current as any).setOptions({ styles });
    }
  }, [mapStyleApplied]);

  // Draw radius circles on map when a project is expanded
  useEffect(() => {
    if (!expandedProjectId || !overviewMapInstance.current) return;
    if (!window.google?.maps?.Circle) return;
    const set = locationSets.find((s) => s.id === expandedProjectId);
    if (!set) return;
    const circles: any[] = [];
    set.locations.forEach((loc) => {
      const circle = new (window as any).google.maps.Circle({
        map: overviewMapInstance.current,
        center: { lat: loc.latitude, lng: loc.longitude },
        radius: radiusKm * 1000,
        strokeColor: "#008060",
        strokeOpacity: 0.6,
        strokeWeight: 2,
        fillColor: "#008060",
        fillOpacity: 0.08,
      });
      circles.push(circle);
    });
    return () => circles.forEach((c) => c.setMap(null));
  }, [expandedProjectId, locationSets, radiusKm]);

  // Zoom map to loaded project's locations
  useEffect(() => {
    if (!loadedProjectId || !overviewMapInstance.current) return;
    const googleMaps = window.google?.maps;
    if (!googleMaps) return;
    const set = locationSets.find((s) => s.id === loadedProjectId);
    if (!set || set.locations.length === 0) return;
    const bounds = new googleMaps.LatLngBounds();
    set.locations.forEach((loc) => {
      bounds.extend({ lat: loc.latitude, lng: loc.longitude });
    });
    overviewMapInstance.current.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
  }, [loadedProjectId, locationSets]);

  return (
    <s-page heading={t("pageHeading")}>
      <s-modal id="proposal-modal" heading={activeProposalId ? t("proposals.editHeading") : t("proposals.addHeading")}>
        <div className={styles.asideColumn}>
          <s-text-field
            label={t("proposals.leasingValue")}
            value={proposalLeasingValue}
            onChange={(event: Event) =>
              setProposalLeasingValue((event.currentTarget as HTMLInputElement).value)
            }
          />
          <s-select
            label={t("proposals.currency")}
            value={proposalCurrency}
            onChange={(event: Event) =>
              setProposalCurrency((event.currentTarget as HTMLSelectElement).value)
            }
          >
            <s-option value="BRL">BRL</s-option>
            <s-option value="USD">USD</s-option>
            <s-option value="EUR">EUR</s-option>
            <s-option value="GBP">GBP</s-option>
            <s-option value="MXN">MXN</s-option>
            <s-option value="ARS">ARS</s-option>
            <s-option value="CLP">CLP</s-option>
            <s-option value="COP">COP</s-option>
            <s-option value="PEN">PEN</s-option>
          </s-select>
          <div>
            <label style={{ fontSize: "13px", color: "#6d7175", display: "block", marginBottom: "4px" }}>{t("proposals.notes")}</label>
            <textarea
              value={proposalNotes}
              onChange={(e) => setProposalNotes(e.currentTarget.value)}
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", fontFamily: "inherit", resize: "vertical" }}
            />
          </div>
          <div>
            <s-text type="strong">{t("proposals.attachment")}</s-text>
            {activeProposalId ? (() => {
              const existing = proposals.find((p) => p.id === activeProposalId);
              return existing?.fileName ? (
                <div style={{ marginTop: "4px", marginBottom: "8px" }}>
                  <s-text color="subdued">{t("proposals.currentFile")}: </s-text>
                  <a
                    href={`/app/api/retail-proposal-file/${activeProposalId}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "13px", color: "#008060" }}
                  >
                    {existing.fileName}
                  </a>
                </div>
              ) : null;
            })() : null}
            <input
              ref={proposalFileRef}
              type="file"
              accept=".pdf,.pptx,.ppt,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.doc"
              style={{ display: "block", marginTop: "8px", fontSize: "13px" }}
            />
          </div>
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="proposal-modal"
              command="--hide"
              onClick={() => {
                setActiveProposalId(null);
                setActiveProposalLocationId(null);
                setActiveProposalLocationSetId(null);
                setProposalLeasingValue("");
                setProposalCurrency("BRL");
                setProposalNotes("");
                if (proposalFileRef.current) proposalFileRef.current.value = "";
              }}
            >
              {t("common:button.cancel")}
            </s-button>
            {activeProposalId ? (
              <s-button
                variant="secondary"
                onClick={() => {
                  if (!activeProposalId) return;
                  const fd = new FormData();
                  fd.append("intent", "delete-proposal");
                  fd.append("proposalId", activeProposalId);
                  fetcher.submit(fd, { method: "post" });
                  const el = document.getElementById("proposal-modal") as HTMLElement & { hide?: () => void };
                  el?.hide?.();
                  setActiveProposalId(null);
                  setActiveProposalLocationId(null);
                  setActiveProposalLocationSetId(null);
                }}
              >
                {t("common:button.delete")}
              </s-button>
            ) : null}
            <s-button
              variant="primary"
              onClick={() => {
                if (!activeProposalLocationSetId || !activeProposalLocationId) return;
                const fd = new FormData();
                fd.append("intent", "save-proposal");
                fd.append("locationSetId", activeProposalLocationSetId);
                fd.append("locationId", activeProposalLocationId);
                if (activeProposalId) fd.append("proposalId", activeProposalId);
                if (proposalLeasingValue) fd.append("leasingValue", proposalLeasingValue);
                fd.append("currency", proposalCurrency);
                fd.append("notes", proposalNotes);
                const file = proposalFileRef.current?.files?.[0];
                if (file) fd.append("file", file);
                fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
                const el = document.getElementById("proposal-modal") as HTMLElement & { hide?: () => void };
                el?.hide?.();
                setActiveProposalId(null);
                setActiveProposalLocationId(null);
                setActiveProposalLocationSetId(null);
                setProposalLeasingValue("");
                setProposalCurrency("BRL");
                setProposalNotes("");
                if (proposalFileRef.current) proposalFileRef.current.value = "";
              }}
            >
              {t("common:button.save")}
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="pin-location-modal" heading={t("modals.pinLocation")}>
        <div className={styles.asideColumn}>
          <s-text color="subdued">
            {t("modals.pinDescription")}
          </s-text>
          <div ref={selectionMapRef} className={styles.mapCanvas} />
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="pin-location-modal"
              command="--hide"
              onClick={() => setShowSelectionMap(false)}
            >
              {t("common:button.cancel")}
            </s-button>
            <s-button
              variant="primary"
              disabled={!selectedPoint}
              commandFor="name-location-modal"
              command="--show"
            >
              {t("map.addLocations")}
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="name-location-modal" heading={t("modals.nameLocation")}>
        <div className={styles.asideColumn}>
          <s-text-field
            label={t("modals.locationName")}
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
              {t("common:button.cancel")}
            </s-button>
            <s-button
              variant="primary"
              disabled={!selectedPoint || !mapLocationName.trim()}
              commandFor="name-location-modal"
              command="--hide"
              onClick={handleAddLocationFromMap}
            >
              {t("common:button.save")}
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="add-locations-modal" heading={t("modals.addLocations")}>
        <div className={styles.asideColumn}>
          <div className={styles.placeAutocompleteField}>
            <label className={styles.autocompleteLabel}>
              {t("modals.includeNewLocation")}
            </label>
            <div
              ref={loadedProjectAutocompleteContainerRef}
              className={styles.placeAutocompleteHost}
            />
          </div>
          <div className={styles.asideRowSpace}>
            <s-button
              variant="secondary"
              commandFor="add-locations-modal"
              command="--hide"
            >
              {t("common:button.cancel")}
            </s-button>
            <s-button
              variant="primary"
              disabled={!selectedPoint || !locationName.trim() || fetcher.state !== "idle"}
              onClick={() => handleAddLocation()}
            >
              {fetcher.state !== "idle" ? t("common:button.loading") : t("map.addLocations")}
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="new-project-modal" heading={t("modals.newProject")}>
        <div className={styles.asideColumn}>
          <s-text color="subdued">
            {t("modals.newProjectDescription")}
          </s-text>
          <div className={styles.placeAutocompleteField}>
            <label className={styles.autocompleteLabel}>
              {t("modals.includeNewLocation")}
            </label>
            <div
              ref={newProjectAutocompleteContainerRef}
              className={styles.placeAutocompleteHost}
            />
          </div>
          <s-text type="strong">{t("modals.addedLocations")}</s-text>
          {pendingLocations.length > 0 ? (
            <div className={styles.tagList}>
              {pendingLocations.map((location) => (
                <div key={location.id} className={styles.tagItem}>
                  <span>{location.name}</span>
                  <button
                    type="button"
                    className={styles.tagRemove}
                    aria-label={`Remove ${location.name}`}
                    onClick={() => setPendingLocations((prev) => prev.filter((loc) => loc.id !== location.id))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <s-text color="subdued">{t("modals.noLocationsAdded")}</s-text>
          )}
          <div className={styles.asideRowRight}>
            {fetcher.state !== "idle" ? (
              <s-button key="save-loading" variant="primary" loading disabled>
                {t("common:button.loading")}
              </s-button>
            ) : (
              <s-button
                key="save-idle"
                variant="primary"
                disabled={pendingLocations.length === 0}
                commandFor="save-project-modal"
                command="--show"
                onClick={() => {
                  // Smart pre-fill: single city → city, multi-city single province → province, else city1 x city2 x ...
                  const cities = [...new Set(pendingLocations.map((l) => l.city).filter(Boolean))] as string[];
                  const provinces = [...new Set(pendingLocations.map((l) => l.province).filter(Boolean))] as string[];
                  if (cities.length === 1) {
                    setSetName(cities[0]);
                  } else if (cities.length > 1 && provinces.length === 1) {
                    setSetName(provinces[0]);
                  } else if (cities.length > 1) {
                    setSetName(cities.join(" x "));
                  }
                }}
              >
                {t("common:button.save")}
              </s-button>
            )}
          </div>
        </div>
      </s-modal>
      <s-modal id="save-project-modal" heading={t("modals.saveProject")}>
        <div className={styles.asideColumn}>
          <s-text-field
            label={t("modals.projectName")}
            value={setName}
            onInput={(event: Event) =>
              setSetName((event.currentTarget as HTMLInputElement).value)
            }
          />
          <div className={styles.asideRow}>
            <s-button
              variant="secondary"
              commandFor="save-project-modal"
              command="--hide"
            >
              {t("common:button.cancel")}
            </s-button>
            <s-button
              variant="primary"
              disabled={pendingLocations.length === 0 || setName.trim().length === 0}
              commandFor="save-project-modal"
              command="--hide"
              onClick={handleSaveSet}
            >
              {t("common:button.save")}
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="edit-project-modal" heading={editingSetName ? `${t("projects.edit")} ${editingSetName}` : t("modals.editProject")}>
        <div className={styles.asideColumn}>
          <s-text-field
            label={t("modals.projectName")}
            value={editingSetName}
            onChange={(event: Event) =>
              setEditingSetName((event.currentTarget as HTMLInputElement).value)
            }
          />
          <div className={styles.placeAutocompleteField}>
            <label className={styles.autocompleteLabel}>
              {t("modals.includeNewLocation")}
            </label>
            <div
              ref={loadedProjectAutocompleteContainerRef}
              className={styles.placeAutocompleteHost}
            />
          </div>
          <s-text type="strong">{t("modals.addedLocations")}</s-text>
          {editingSetLocations.length > 0 ? (
            <div className={styles.badgeList}>
              {editingSetLocations.map((location) => (
                <span key={location.id} className={styles.badge}>
                  <span className={styles.badgeLabel}>{location.name}</span>
                  <span
                    className={styles.badgeRemove}
                    onClick={() =>
                      setEditingSetLocations((prev) =>
                        prev.filter((loc) => loc.id !== location.id),
                      )
                    }
                  >
                    ×
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <s-text color="subdued">{t("modals.noLocations")}</s-text>
          )}
          <div className={styles.modalFooterSplit}>
            <s-button
              variant="secondary"
              tone="critical"
              onClick={() => {
                const idToDelete = editingSetId;
                document.getElementById("edit-project-modal")?.removeAttribute("open");
                setEditingSetId(null);
                setEditingSetName("");
                setEditingSetLocations([]);
                if (idToDelete) setDeleteConfirmSetId(idToDelete);
              }}
            >
              {t("modals.deleteProject")}
            </s-button>
            <div className={styles.asideRowRight}>
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
                {t("common:button.cancel")}
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
                  setLocalLocationSets((prev) =>
                    prev.map((s) =>
                      s.id === editingSetId
                        ? { ...s, name: editingSetName.trim(), locations: editingSetLocations }
                        : s,
                    ),
                  );
                  setEditingSetId(null);
                  setEditingSetName("");
                  setEditingSetLocations([]);
                }}
              >
                {t("common:button.save")}
              </s-button>
            </div>
          </div>
        </div>
      </s-modal>
      {deleteConfirmSetId ? (
        <s-modal id="delete-project-confirm-modal" heading={t("modals.deleteProject")}>
          <s-stack direction="block" gap="base">
            <s-text>{t("modals.deleteConfirm")}</s-text>
            <div className={styles.asideRowRight}>
              <s-button
                variant="secondary"
                commandFor="delete-project-confirm-modal"
                command="--hide"
                onClick={() => setDeleteConfirmSetId(null)}
              >
                {t("common:button.cancel")}
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                commandFor="delete-project-confirm-modal"
                command="--hide"
                onClick={() => {
                  const deletedId = deleteConfirmSetId;
                  const fd = new FormData();
                  fd.append("intent", "delete-location-set");
                  fd.append("setId", deletedId);
                  fetcher.submit(fd, { method: "post" });
                  setLocalLocationSets((prev) => prev.filter((s) => s.id !== deletedId));
                  if (loadedProjectId === deletedId) setLoadedProjectId(null);
                  if (expandedProjectId === deletedId) setExpandedProjectId(null);
                  setDeleteConfirmSetId(null);
                  setEditingSetId(null);
                  setEditingSetName("");
                  setEditingSetLocations([]);
                }}
              >
                {t("modals.deleteProject")}
              </s-button>
            </div>
          </s-stack>
        </s-modal>
      ) : null}
      <s-modal id="customize-stats-modal" heading={t("projects.customizeStatsHeading")}>
        <div className={styles.customizeStatsModal}>
          <div className={styles.heatmapModalColumns}>
            {/* Column 1: Radii */}
            <div>
              <s-stack direction="block" gap="base">
                <s-text type="strong">{t("projects.radiiHeader")}</s-text>
                <s-select
                  value={statsConfigDraft.radiusUnit ?? "km"}
                  onChange={(e: Event) => {
                    const unit = (e.currentTarget as HTMLSelectElement).value as "km" | "mi";
                    setStatsConfigDraft((prev) => ({ ...prev, radiusUnit: unit }));
                  }}
                >
                  <s-option value="km">km</s-option>
                  <s-option value="mi">mi</s-option>
                </s-select>
                {(() => {
                  const unit = statsConfigDraft.radiusUnit ?? "km";
                  const toDisplay = (km: number) => unit === "mi" ? +(km / KM_PER_MI).toFixed(2) : km;
                  const toKm = (display: number) => unit === "mi" ? +(display * KM_PER_MI).toFixed(2) : display;
                  const padded = statsConfigDraft.radii.length >= 4
                    ? statsConfigDraft.radii
                    : [...statsConfigDraft.radii, ...Array.from({ length: 4 - statsConfigDraft.radii.length }, (_, k) => ({ value: (statsConfigDraft.radii.at(-1)?.value ?? 15) + 5 * (k + 1), enabled: true }))];
                  return padded.slice(0, 4).map((r, i) => {
                    const displayVal = toDisplay(r.value);
                    return (
                      <div key={i} className={styles.radiusStepperRow}>
                        <s-checkbox
                          checked={r.enabled || undefined}
                          onChange={(e: Event) => {
                            const checked = (e.currentTarget as HTMLInputElement).checked;
                            setStatsConfigDraft((prev) => ({
                              ...prev,
                              radii: prev.radii.map((rd, idx) => idx === i ? { ...rd, enabled: checked } : rd),
                            }));
                          }}
                        />
                        <div className={styles.radiusInputWrap}>
                          <button
                            type="button"
                            className={styles.radiusStepBtn}
                            onClick={() => setStatsConfigDraft((prev) => {
                              const next = [...prev.radii];
                              const minKm = i === 0 ? 0 : next[i - 1].value + 0.01;
                              next[i] = { ...next[i], value: Math.max(+minKm.toFixed(2), +(next[i].value - toKm(1)).toFixed(2)) };
                              return { ...prev, radii: next };
                            })}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={i === 0 ? 0 : +(toDisplay(padded[i - 1].value) + 0.01).toFixed(2)}
                            step={0.01}
                            value={+displayVal.toFixed(2)}
                            className={styles.radiusInput}
                            onChange={(e) => {
                              const val = Number(e.currentTarget.value);
                              if (Number.isNaN(val) || val < 0) return;
                              const km = toKm(val);
                              setStatsConfigDraft((prev) => {
                                const next = [...prev.radii];
                                next[i] = { ...next[i], value: +km.toFixed(2) };
                                return { ...prev, radii: next };
                              });
                            }}
                          />
                          <button
                            type="button"
                            className={styles.radiusStepBtn}
                            onClick={() => setStatsConfigDraft((prev) => {
                              const next = [...prev.radii];
                              next[i] = { ...next[i], value: +(next[i].value + toKm(1)).toFixed(2) };
                              return { ...prev, radii: next };
                            })}
                          >
                            +
                          </button>
                        </div>
                        <span className={styles.radiusUnitLabel}>{unit}</span>
                      </div>
                    );
                  });
                })()}
              </s-stack>
            </div>
            {/* Column 2: Qualitative */}
            <div>
              <s-stack direction="block" gap="base">
                <s-text type="strong">{t("projects.qualitativeCriteria")}</s-text>
                <s-checkbox
                  label={t("projects.tenantMixFit")}
                  checked={statsConfigDraft.qualitative.tenantMix || undefined}
                  onChange={(e: Event) => {
                    const checked = (e.currentTarget as HTMLInputElement).checked;
                    setStatsConfigDraft((prev) => ({
                      ...prev,
                      qualitative: { ...prev.qualitative, tenantMix: checked },
                    }));
                  }}
                />
                <s-checkbox
                  label={t("projects.subjectiveFit")}
                  checked={statsConfigDraft.qualitative.subjectiveFit || undefined}
                  onChange={(e: Event) => {
                    const checked = (e.currentTarget as HTMLInputElement).checked;
                    setStatsConfigDraft((prev) => ({
                      ...prev,
                      qualitative: { ...prev.qualitative, subjectiveFit: checked },
                    }));
                  }}
                />
                <s-checkbox
                  label={t("projects.predominantAudience")}
                  checked={statsConfigDraft.qualitative.predominantAudience || undefined}
                  onChange={(e: Event) => {
                    const checked = (e.currentTarget as HTMLInputElement).checked;
                    setStatsConfigDraft((prev) => ({
                      ...prev,
                      qualitative: { ...prev.qualitative, predominantAudience: checked },
                    }));
                  }}
                />
              </s-stack>
            </div>
          </div>
          <div className={styles.customizeStatsFooter}>
            <div className={styles.asideRowRight}>
              <s-button
                variant="secondary"
                commandFor="customize-stats-modal"
                command="--hide"
                onClick={handleCancelCustomizeStats}
              >
                {t("common:button.cancel")}
              </s-button>
              <s-button
                variant="secondary"
                onClick={handleResetCustomizeStats}
              >
                {t("projects.resetStats")}
              </s-button>
              {statsConfigChanged ? (
                <s-button
                  key="save-enabled"
                  variant="primary"
                  onClick={handleSaveCustomizeStats}
                >
                  {t("common:button.save")}
                </s-button>
              ) : (
                <s-button key="save-disabled" variant="primary" disabled>
                  {t("common:button.save")}
                </s-button>
              )}
            </div>
          </div>
        </div>
      </s-modal>
      <s-modal id="date-range-modal" heading={t("modals.dateRange")}>
        <div className={styles.dateRangeModal}>
          <div className={styles.dateRangeContent}>
            <div>
              <s-text type="strong">{t("dateRange.timeframes")}</s-text>
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
                  {t("dateRange.custom")}
                </s-button>
              </div>
            </div>
            {showCustomDates ? (
              <>
                <s-select
                  label={t("dateRange.dateSetting")}
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
                  <s-option value="fixed">{t("dateRange.fixedRange")}</s-option>
                  <s-option value="rolling">{t("dateRange.rollingWindow")}</s-option>
                </s-select>
                {dateRangeDraft.mode === "fixed" ? (
                  <div className={styles.dateRangeGrid}>
                    <div className={styles.datePickerField}>
                      <s-text type="strong">{t("dateRange.startDate")}</s-text>
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
                      <s-text type="strong">{t("dateRange.endDate")}</s-text>
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
                      label={t("dateRange.useDataFromLast")}
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
                      label={t("dateRange.dateRangeLabel")}
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
                      {(["minute", "hour", "day", "week", "month"] as const).map((unit) => (
                        <s-option key={unit} value={unit}>
                          {t(`dateRange.units.${unit}s`)}
                        </s-option>
                      ))}
                    </s-select>
                  </div>
                )}
              </>
            ) : null}
            <div className={styles.dateRangeToggle}>
              <s-checkbox
                label={t("dateRange.includeCurrentPeriod")}
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
                {t("dateRange.includeCurrentPeriodDescription")}
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
            {t("common:button.cancel")}
          </s-button>
          <s-button
            variant="primary"
            commandFor="date-range-modal"
            command="--hide"
            onClick={handleApplyDateRange}
          >
            {t("dateRange.apply")}
          </s-button>
        </div>
      </s-modal>
      <s-modal id="heatmap-options-modal" heading={t("modals.heatmapOptions")}>
        <div className={styles.heatmapModalContent}>
          <s-stack direction="block" gap="base">
            <div className={styles.heatmapModalColumns}>
              <div>
                <s-text type="strong">{t("modals.mapStyleLabel")}</s-text>
                <s-choice-list
                  label=""
                  values={[mapStyleDraft]}
                  onChange={(event: Event) => {
                    const target = event.currentTarget as { values?: string[] } | null;
                    const value = target?.values?.[0];
                    if (value === "dark" || value === "grayscale" || value === "light") {
                      setMapStyleDraft(value);
                    }
                  }}
                >
                  <s-choice value="dark">{t("modals.mapStyleDark")}</s-choice>
                  <s-choice value="grayscale">{t("modals.mapStyleGreyscale")}</s-choice>
                  <s-choice value="light">{t("modals.mapStyleLight")}</s-choice>
                </s-choice-list>
              </div>
              <div>
                <s-text type="strong">{t("modals.heatmapIntensityLabel")}</s-text>
                <s-choice-list
                  label=""
                  values={[intensityDraft]}
                  onChange={(event: Event) => {
                    const target = event.currentTarget as { values?: string[] } | null;
                    const value = target?.values?.[0];
                    if (value === "national" || value === "regional" || value === "local") {
                      setIntensityDraft(value);
                    }
                  }}
                >
                  <s-choice value="national">{t("modals.intensityNational")}</s-choice>
                  <s-choice value="regional">{t("modals.intensityRegional")}</s-choice>
                  <s-choice value="local">{t("modals.intensityLocal")}</s-choice>
                </s-choice-list>
              </div>
            </div>
            <div className={styles.asideRowRight}>
              <s-button
                variant="secondary"
                commandFor="heatmap-options-modal"
                command="--hide"
                onClick={handleCancelHeatmapOptions}
              >
                {t("common:button.cancel")}
              </s-button>
              <s-button
                variant="primary"
                commandFor="heatmap-options-modal"
                command="--hide"
                onClick={handleApplyHeatmapOptions}
              >
                {t("common:button.confirm")}
              </s-button>
            </div>
          </s-stack>
        </div>
      </s-modal>
      {lastClickedCity ? (
        <s-modal id="top15-city-modal" heading={t("modals.city")}>
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
                {t("common:button.close")}
              </s-button>
            </div>
          </div>
        </s-modal>
      ) : null}
      {!mapsApiKey ? (
        <s-banner tone="warning" heading={t("banners.mapsKeyMissing")}>
          {t("banners.mapsKeyDescription")}
        </s-banner>
      ) : null}
      {!mapsMapId ? (
        <s-banner tone="warning" heading={t("banners.mapsMapIdMissing")}>
          {t("banners.mapsMapIdDescription")}
        </s-banner>
      ) : null}
      {mapsLoadError ? (
        <s-banner tone="warning" heading={t("banners.mapsError")}>
          {mapsLoadError}
        </s-banner>
      ) : null}
      {syncStatus === "running" ? (() => {
        const completedRecords = syncPhase === "orders"
          ? (syncTotalCustomers ?? 0) + (syncProgressCount ?? 0)
          : (syncProgressCount ?? 0);
        const totalEstimate = syncTotalCustomers !== null && syncTotalOrders !== null
          ? syncTotalCustomers + syncTotalOrders
          : null;
        const progressPct = totalEstimate && totalEstimate > 0 && completedRecords > 0
          ? Math.min(98, Math.round((completedRecords / totalEstimate) * 100))
          : null;
        const elapsedMs = syncStartedAt ? Date.now() - new Date(syncStartedAt).getTime() : null;
        const ratePerMs = elapsedMs && elapsedMs > 5000 && completedRecords > 0
          ? completedRecords / elapsedMs
          : null;
        const etaMin = ratePerMs && totalEstimate && totalEstimate > completedRecords
          ? Math.ceil((totalEstimate - completedRecords) / ratePerMs / 60000)
          : null;
        return (
          <s-banner tone="warning" heading={t("banners.analyticsBuildInProgress")}>
            <div>{t("banners.analyticsBuildDescription")}</div>
            <div className={styles.syncProgressRow}>
              <span className={styles.syncProgressPhaseLabel}>
                {syncPhase === "customers"
                  ? t("banners.phaseCustomers")
                  : syncPhase === "orders"
                  ? t("banners.phaseOrders")
                  : t("banners.phaseStarting")}
              </span>
              {progressPct !== null && (
                <span className={styles.syncProgressPct}>{progressPct}%</span>
              )}
            </div>
            <div className={styles.syncProgressBarBg}>
              {progressPct !== null ? (
                <div
                  className={styles.syncProgressBarFill}
                  style={{ width: `${progressPct}%` }}
                />
              ) : (
                <div className={styles.syncProgressBarFill} />
              )}
            </div>
            <div className={styles.syncProgressMeta}>
              {syncProgressCount != null && (
                <span>{t("banners.progressRecords", { count: completedRecords })}</span>
              )}
              {etaMin !== null && (
                <span>{t("banners.progressEta", { minutes: etaMin })}</span>
              )}
            </div>
            <style>{`@keyframes omnify-holo-bar { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }`}</style>
          </s-banner>
        );
      })() : syncStatus === "failed" ? (
        <s-banner tone="critical" heading={t("banners.analyticsIssue")}>
          {syncError}
          <div style={{ marginTop: 8 }}>
            <s-button
              variant="secondary"
              onClick={() => fetcher.submit({ intent: "sync-analytics" }, { method: "post" })}
            >
              Retry sync
            </s-button>
          </div>
        </s-banner>
      ) : null}
      {syncStatus === "idle" && loaderHeatmapBuckets.length === 0 && cityRankings.length === 0 && !syncTotalOrders ? (
        <s-banner tone="critical" heading={t("banners.noGeocodedRecords")}>
          {t("banners.noGeocodedDescription")}
        </s-banner>
      ) : null}

      {/* Sync warning (non-blocking — last sync failed but data exists) */}
      {syncWarning && syncStatus === "idle" && (
        <s-banner tone="warning" heading="Last sync encountered an issue" dismissible>
          {syncWarning}. Data shown may be slightly outdated.
        </s-banner>
      )}

      {/* ── Overview Stats Strip ── */}
      {syncStatus === "idle" && syncTotalOrders && syncTotalOrders > 0 && !isHeatmapExpanded && (
        <div className={styles.overviewStrip}>
          <div className={styles.overviewHeader}>
            <h2 className={styles.overviewHeading}>{t("overview.heading")}</h2>
            <div className={styles.overviewControls}>
              <div className={styles.overviewToggle} onClick={() => setMonthlyAvg((prev) => !prev)} role="button">
                <s-checkbox
                  checked={monthlyAvg || undefined}
                  onChange={() => setMonthlyAvg((prev) => !prev)}
                />
                <span>{t("overview.monthlyAvg")}</span>
              </div>
            <select
              className={styles.overviewPeriodSelect}
              value={String(overviewPeriod)}
              disabled={isLoadingOverview}
              onChange={(e) => handleOverviewPeriodChange(Number(e.target.value))}
            >
              <option value="30">{t("overview.last30")}</option>
              <option value="90">{t("overview.last90")}</option>
              <option value="365">{t("overview.last12m")}</option>
              <option value="730">{t("overview.last24m")}</option>
            </select>
            </div>
          </div>
          <div className={styles.overviewSyncRow}>
            <span className={styles.overviewSyncText}>
              {syncLastSyncedAt
                ? t("top15.lastUpdated", { date: new Date(syncLastSyncedAt).toLocaleDateString(userLocale) })
                : ""}
            </span>
            <span
              className={styles.overviewSyncLink}
              role="button"
              tabIndex={0}
              onClick={() => fetcher.submit({ intent: "sync-analytics" }, { method: "post" })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fetcher.submit({ intent: "sync-analytics" }, { method: "post" }); }}
            >
              Sync
            </span>
          </div>

          {/* ── Row 1: Online reach (3 clickable cards) ── */}
          <div className={`${styles.overviewRowLabel} ${styles.overviewRowLabelFirst}`}>
            {overviewStats
              ? t("overview.onlineReach", { cities: overviewStats.citiesReached })
              : t("overview.onlineReachDefault")}
          </div>
          <div className={styles.overviewGrid}>
            {/* Card 1: Revenue */}
            <div
              className={`${styles.overviewBox} ${styles.overviewBoxClickable}${row1DrillDown === "revenue" ? ` ${styles.overviewBoxActive}` : ""}${isLoadingOverview ? ` ${styles.overviewBoxLoading}` : ""}`}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleRow1CardClick("revenue"); }}
              onClick={() => handleRow1CardClick("revenue")}
            >
              <div className={styles.overviewIconRow}>
                <span className={styles.overviewIcon}>
                  <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.5 4.75a.75.75 0 0 0-1.5 0v.38a2.25 2.25 0 0 0 .25 4.48h1.5a.75.75 0 0 1 0 1.5h-2.25a.75.75 0 0 0 0 1.5h1v.62a.75.75 0 0 0 1.5 0v-.38a2.25 2.25 0 0 0-.25-4.48h-1.5a.75.75 0 0 1 0-1.5h2.25a.75.75 0 0 0 0-1.5h-1v-.62Z" />
                  </svg>
                </span>
              </div>
              <span className={styles.overviewPrimary}>
                {overviewStats ? formatCurrencyAbbrev(applyAvg(overviewStats.totalRevenue), overviewStats.currencyCode) : "--"}
              </span>
              <span className={styles.overviewLabel}>{t("overview.revenue")}</span>
            </div>

            {/* Card 2: Orders (with AOV) */}
            <div
              className={`${styles.overviewBox} ${styles.overviewBoxClickable}${row1DrillDown === "orders" ? ` ${styles.overviewBoxActive}` : ""}${isLoadingOverview ? ` ${styles.overviewBoxLoading}` : ""}`}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleRow1CardClick("orders"); }}
              onClick={() => handleRow1CardClick("orders")}
            >
              <div className={styles.overviewIconRow}>
                <span className={styles.overviewIcon}>
                  <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M6 2a1 1 0 0 0-1 1v1h-1.5a1.5 1.5 0 0 0-1.5 1.5v11a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-11a1.5 1.5 0 0 0-1.5-1.5h-1.5v-1a1 1 0 0 0-1-1h-8Zm8 2h-8v1h8v-1Zm-8 4.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8Zm0 3a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5Z" />
                  </svg>
                </span>
              </div>
              <span className={styles.overviewPrimary}>
                {overviewStats ? applyAvg(overviewStats.totalOrders).toLocaleString("pt-BR") : "--"}
              </span>
              <span className={styles.overviewLabel}>
                {overviewStats && overviewStats.totalOrders > 0
                  ? t("overview.ordersAov", { aov: formatCurrencyAbbrev(Math.round(overviewStats.totalRevenue / overviewStats.totalOrders), overviewStats.currencyCode) })
                  : t("overview.ordersAov", { aov: "--" })}
              </span>
            </div>

            {/* Card 3: Customers */}
            <div
              className={`${styles.overviewBox} ${styles.overviewBoxClickable}${row1DrillDown === "customers" ? ` ${styles.overviewBoxActive}` : ""}${isLoadingOverview ? ` ${styles.overviewBoxLoading}` : ""}`}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleRow1CardClick("customers"); }}
              onClick={() => handleRow1CardClick("customers")}
            >
              <div className={styles.overviewIconRow}>
                <span className={styles.overviewIcon}>
                  <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
                    <path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 6.5a6 6 0 0 1 12 0 .5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z" />
                  </svg>
                </span>
              </div>
              <span className={styles.overviewPrimary}>
                {overviewStats ? overviewStats.totalCustomers.toLocaleString("pt-BR") : "--"}
              </span>
              <span className={styles.overviewLabel}>{t("overview.customers")}</span>
            </div>
          </div>

          {/* ── Row 2: Vertical bar chart drill-down (hidden by default) ── */}
          {row1DrillDown && overviewStats?.topCities && overviewStats.topCities.length > 0 && (() => {
            const sortedCities = [...overviewStats.topCities].sort((a, b) => b[row1DrillDown] - a[row1DrillDown]);
            const maxRaw = sortedCities[0][row1DrillDown];
            const maxValue = row1DrillDown === "customers" ? maxRaw : applyAvg(maxRaw);
            return (
            <div className={styles.drillDown}>
              <div className={styles.vbarChart}>
                {sortedCities.map((city, idx) => {
                  const raw = city[row1DrillDown];
                  const value = row1DrillDown === "customers" ? raw : applyAvg(raw);
                  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
                  const label = row1DrillDown === "revenue"
                    ? formatCurrencyAbbrev(value, overviewStats.currencyCode)
                    : formatNumberCompact(value);
                  return (
                    <div key={city.cityDisplay} className={styles.vbarColumn} style={{ order: idx }}>
                      <div className={styles.vbarBarArea}>
                        <span className={styles.vbarValue}>{label}</span>
                        <div className={styles.vbarBar} style={{ height: `${pct}%` }} />
                      </div>
                      <span className={styles.vbarLabel}>{canonCity(city.cityDisplay, city.cityNorm)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* ── Row 3: Footprint breakdown (3 clickable cards) ── */}
          <div className={styles.overviewRowLabel}>
            {t("overview.footprintBreakdown")}
          </div>
          <div className={styles.overviewGrid}>
            {/* Card 1: Pareto / Top cities */}
            <div
              className={`${styles.overviewBox} ${styles.overviewBoxClickable}${row3DrillDown === "pareto" ? ` ${styles.overviewBoxActive}` : ""}${isLoadingOverview ? ` ${styles.overviewBoxLoading}` : ""}`}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleRow3CardClick("pareto"); }}
              onClick={() => handleRow3CardClick("pareto")}
            >
              <span className={styles.overviewPrimary}>
                {overviewStats ? t("overview.paretoTitle", { count: overviewStats.pareto.cityCount }) : "--"}
              </span>
              <span className={styles.overviewLabel}>
                {overviewStats ? t("overview.paretoSubtitle", { revPct: overviewStats.pareto.revenuePercent, custPct: overviewStats.pareto.customerPercent }) : ""}
              </span>
            </div>

            {/* Card 2: Channel Mix */}
            <div
              className={`${styles.overviewBox} ${styles.overviewBoxClickable}${row3DrillDown === "channel" ? ` ${styles.overviewBoxActive}` : ""}${isLoadingOverview ? ` ${styles.overviewBoxLoading}` : ""}`}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleRow3CardClick("channel"); }}
              onClick={() => handleRow3CardClick("channel")}
            >
              {overviewStats?.channelMix ? (
                <>
                  <span className={styles.overviewPrimary}>{overviewStats.channelMix.storePercent}%</span>
                  <span className={styles.overviewLabel}>{t("overview.channelStore")}</span>
                </>
              ) : (
                <>
                  <span className={styles.overviewPrimary}>--</span>
                  <span className={styles.overviewSecondary}>{t("overview.channelNoData")}</span>
                </>
              )}
            </div>

            {/* Card 3: Projection / Untapped growth */}
            <div
              className={`${styles.overviewBox} ${styles.overviewBoxClickable}${row3DrillDown === "projection" ? ` ${styles.overviewBoxActive}` : ""}${isLoadingOverview ? ` ${styles.overviewBoxLoading}` : ""}`}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleRow3CardClick("projection"); }}
              onClick={() => handleRow3CardClick("projection")}
            >
              {overviewStats?.projection ? (
                <>
                  <span className={styles.overviewPrimary}>
                    {formatCurrencyAbbrev(overviewStats.projection.estimatedRevenue, overviewStats.currencyCode)}
                  </span>
                  <span className={styles.overviewLabel}>{t("overview.projectionLabel")}</span>
                  <span className={styles.overviewSecondary}>
                    {overviewStats.expansionGap
                      ? t("overview.projectionSubtitle", { customers: formatNumberCompact(overviewStats.expansionGap.customersWithoutAccess) })
                      : ""}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.overviewPrimary}>--</span>
                  <span className={styles.overviewLabel}>{t("overview.projectionLabel")}</span>
                </>
              )}
            </div>
          </div>

          {/* ── Row 4.1: Stacked bar chart (Pareto drill-down) ── */}
          {row3DrillDown === "pareto" && overviewStats?.cityRevenueSplit && overviewStats.cityRevenueSplit.length > 0 && (
            <div className={styles.drillDown}>
              <div className={styles.vbarChart}>
                {overviewStats.cityRevenueSplit.map((city) => {
                  const adjTotal = applyAvg(city.totalRevenue);
                  const adjStore = applyAvg(city.storeRevenue);
                  const adjOnline = adjTotal - adjStore;
                  const maxVal = applyAvg(overviewStats.cityRevenueSplit![0].totalRevenue);
                  const totalPct = maxVal > 0 ? (adjTotal / maxVal) * 100 : 0;
                  const storeFraction = adjTotal > 0 ? adjStore / adjTotal : 0;
                  const onlineFraction = 1 - storeFraction;
                  // Estimate pixel height per pile (bar area = 160px)
                  const barPx = totalPct / 100 * 160;
                  const storePx = barPx * storeFraction;
                  const onlinePx = barPx * onlineFraction;
                  const MIN_LABEL_PX = 14;
                  return (
                    <div key={city.cityDisplay} className={styles.vbarColumn}>
                      <div className={styles.vbarBarArea}>
                        {/* External labels for piles too small to contain text — rendered ABOVE the bar */}
                        {storeFraction > 0 && storePx < MIN_LABEL_PX && (
                          <span className={styles.vbarPileLabelExternal}>{formatCurrencyAbbrev(adjStore, overviewStats.currencyCode)}</span>
                        )}
                        {onlinePx < MIN_LABEL_PX && (
                          <span className={styles.vbarPileLabelExternal}>{formatCurrencyAbbrev(adjOnline, overviewStats.currencyCode)}</span>
                        )}
                        <div className={styles.vbarStacked} style={{ height: `${totalPct}%` }}>
                          {storeFraction > 0 && (
                            <div className={styles.vbarStackStore} style={{ height: `${storeFraction * 100}%` }}>
                              {storePx >= MIN_LABEL_PX ? (
                                <>
                                  <span className={styles.vbarPileLabel}>{formatCurrencyAbbrev(adjStore, overviewStats.currencyCode)}</span>
                                  <span className={styles.vbarPileHover}>{city.storePct}%</span>
                                </>
                              ) : null}
                            </div>
                          )}
                          <div className={styles.vbarStackOnline} style={{ height: `${onlineFraction * 100}%` }}>
                            {onlinePx >= MIN_LABEL_PX ? (
                              <>
                                <span className={styles.vbarPileLabel}>{formatCurrencyAbbrev(adjOnline, overviewStats.currencyCode)}</span>
                                <span className={styles.vbarPileHover}>{100 - city.storePct}%</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <span className={styles.vbarLabel}>{canonCity(city.cityDisplay, city.cityNorm)}</span>
                    </div>
                  );
                })}
              </div>
              <div className={styles.chartLegend}>
                <span><span className={styles.legendDot} style={{ background: "#5ecece" }} />Warehouse</span>
                <span><span className={styles.legendDot} style={{ background: "#d4a8d4" }} />Store</span>
              </div>
            </div>
          )}

          {/* ── Row 4.2: Donut charts (Channel mix drill-down) ── */}
          {row3DrillDown === "channel" && overviewStats?.cityFulfillmentSplit && overviewStats.cityFulfillmentSplit.length > 0 && (
            <div className={styles.drillDown}>
              <div className={`${styles.donutContainer}${overviewStats.cityFulfillmentSplit.length > 3 ? ` ${styles.donutContainerScrollable}` : ""}`}>
                {overviewStats.cityFulfillmentSplit.map((city) => {
                  const circumference = 2 * Math.PI * 40;
                  const storeArc = (city.storePct / 100) * circumference;
                  const whPct = 100 - city.storePct;
                  return (
                    <div key={city.cityDisplay} className={styles.donutCard}>
                      <span className={styles.donutLabel}>{canonCity(city.cityDisplay, city.cityNorm)}</span>
                      <div className={styles.donutSvgWrap}>
                        <svg className={styles.donutSvg} viewBox="0 0 100 100">
                          <circle className={styles.donutSlice} cx="50" cy="50" r="40" fill="none" strokeWidth="18" stroke="#5ecece"
                            onMouseEnter={(e) => {
                              const wrap = (e.currentTarget.parentElement?.parentElement as HTMLElement);
                              wrap?.querySelector(`.${styles.donutBadgeWarehouse}`)?.classList.add(styles.donutBadgeVisible);
                            }}
                            onMouseLeave={(e) => {
                              const wrap = (e.currentTarget.parentElement?.parentElement as HTMLElement);
                              wrap?.querySelector(`.${styles.donutBadgeWarehouse}`)?.classList.remove(styles.donutBadgeVisible);
                            }}
                          />
                          <circle className={styles.donutSlice} cx="50" cy="50" r="40" fill="none" strokeWidth="18" stroke="#d4a8d4"
                            strokeDasharray={`${storeArc} ${circumference}`}
                            onMouseEnter={(e) => {
                              const wrap = (e.currentTarget.parentElement?.parentElement as HTMLElement);
                              wrap?.querySelector(`.${styles.donutBadgeStore}`)?.classList.add(styles.donutBadgeVisible);
                            }}
                            onMouseLeave={(e) => {
                              const wrap = (e.currentTarget.parentElement?.parentElement as HTMLElement);
                              wrap?.querySelector(`.${styles.donutBadgeStore}`)?.classList.remove(styles.donutBadgeVisible);
                            }}
                          />
                        </svg>
                        {/* Default labels: percentages (always visible) */}
                        <span className={`${styles.donutBadgeDefault} ${styles.donutBadgeStore}`}>
                          {city.storePct}%
                        </span>
                        <span className={`${styles.donutBadgeDefault} ${styles.donutBadgeWarehouse}`}>
                          {whPct}%
                        </span>
                        {/* Hover labels: order counts (hidden by default) */}
                        <span className={`${styles.donutBadge} ${styles.donutBadgeStore}`}>
                          {formatNumberCompact(city.storeOrders)} orders
                        </span>
                        <span className={`${styles.donutBadge} ${styles.donutBadgeWarehouse}`}>
                          {formatNumberCompact(city.warehouseOrders)} orders
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={styles.chartLegend}>
                <span><span className={styles.legendDot} style={{ background: "#d4a8d4" }} />Store</span>
                <span><span className={styles.legendDot} style={{ background: "#5ecece" }} />Warehouse</span>
              </div>
            </div>
          )}

          {/* ── Row 4.3: Gap cities table (Projection drill-down) ── */}
          {row3DrillDown === "projection" && overviewStats?.gapCityDetails && overviewStats.gapCityDetails.length > 0 && (
            <div className={styles.drillDown}>
              <table className={styles.gapTable}>
                <thead>
                  <tr>
                    <th>{t("overview.tableCity")}</th>
                    <th>{t("overview.tableRevenue")}</th>
                    <th>{t("overview.tableCustomers")}</th>
                    <th>{t("overview.tableOrders")}</th>
                    <th>{t("overview.tableMalls")}</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewStats.gapCityDetails.map((city) => {
                    const maxRev = overviewStats.gapCityDetails![0].revenue;
                    const barPct = maxRev > 0 ? (city.revenue / maxRev) * 100 : 0;
                    return (
                      <tr key={city.cityDisplay}>
                        <td>{canonCity(city.cityDisplay, city.cityNorm)}</td>
                        <td className={styles.gapRevenueCell}>
                          <div className={styles.gapRevenueBar} style={{ width: `${barPct}%` }} />
                          <span className={styles.gapRevenueText}>
                            {formatCurrencyAbbrev(city.revenue, overviewStats.currencyCode)}
                          </span>
                        </td>
                        <td>{formatNumberCompact(city.customers)}</td>
                        <td>{formatNumberCompact(city.orders)}</td>
                        <td style={{ color: "#8c9196", fontStyle: "italic" }}>
                          {t("overview.mallsPlaceholder")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Map + Aside layout (single map DOM, CSS-toggled fullscreen) ── */}
      <div className={isHeatmapExpanded ? styles.fullscreenOverlay : undefined}>
        <div className={isHeatmapExpanded ? styles.fullscreenContent : undefined}>
          <div className={isHeatmapExpanded ? styles.fullscreenSplitLayout : styles.campaignLayout}>
            <div className={isHeatmapExpanded ? styles.fullscreenMapPane : styles.campaignMain}>
              <s-section>
                <div className={styles.mapCanvasWrap}>
                  <div className={styles.mapOverlayButton} role="group">
                    {showNationalViewReset ? (
                      <s-button variant="secondary" onClick={resetToNationalView}>
                        {t("map.backToNationalView")}
                      </s-button>
                    ) : null}
                    <s-button
                      variant="secondary"
                      accessibilityLabel={isHeatmapExpanded ? t("map.collapse") : t("map.expand")}
                      aria-expanded={isHeatmapExpanded}
                      onClick={() => setIsHeatmapExpanded((prev) => !prev)}
                    >
                      {isHeatmapExpanded ? t("map.collapse") : t("map.expand")}
                    </s-button>
                  </div>
                  <div
                    ref={overviewMapRef}
                    className={`${styles.mapCanvasLarge} ${isHeatmapExpanded ? styles.mapCanvasFullscreen : ""}`}
                  />
                </div>
                <div className={styles.mapFooterRow}>
                  <s-link
                    commandFor="heatmap-options-modal"
                    command="--show"
                    onClick={handleOpenHeatmapOptions}
                  >
                    {t("map.heatmapOptions")}
                  </s-link>
                </div>
              </s-section>
              {/* ── Loaded project table (in main column, below heatmap) ── */}
              {loadedProjectId ? (() => {
                const loadedRow = projectTableData.find((r) => r.id === loadedProjectId);
                const loadedSet = locationSets.find((s) => s.id === loadedProjectId);
                if (!loadedRow || !loadedSet) return null;
                const isLoadingStats = projectStatsFetcher.state !== "idle";
                const hasAnyNeighborhood = statsConfigApplied.showNeighborhood && loadedSet.locations.some((loc) => !!loc.neighborhood);
                const handleSort = (colKey: string) => {
                  if (sortColumn === colKey) {
                    setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
                  } else {
                    setSortColumn(colKey);
                    setSortDirection("desc");
                  }
                };
                const renderSortArrow = (colKey: string) => {
                  if (sortColumn !== colKey) return null;
                  return <span className={styles.sortArrow}>{sortDirection === "desc" ? "▼" : "▲"}</span>;
                };
                return (
                  <s-section>
                    <s-box padding="base">
                    <div className={styles.loadedProjectHeader}>
                      <span className={styles.cardBadge}>{loadedRow.name}</span>
                      <div className={styles.loadedProjectControls}>
                        <s-link
                          commandFor="customize-stats-modal"
                          command="--show"
                          onClick={handleOpenCustomizeStats}
                        >
                          {t("projects.customizeStats")}
                        </s-link>
                        <button
                          className={styles.closeProjectButton}
                          onClick={() => {
                            setLoadedProjectId(null);
                            setIsHeatmapExpanded(false);
                            setCitiesCollapsed(false);
                            setProjectsCollapsed(false);
                            setProjectStats([]);
                            resetToNationalView();
                          }}
                          aria-label={t("overview.closeProject")}
                        >
                          <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
                            <path d="M6.707 5.293a1 1 0 0 0-1.414 1.414l3.293 3.293-3.293 3.293a1 1 0 1 0 1.414 1.414l3.293-3.293 3.293 3.293a1 1 0 0 0 1.414-1.414l-3.293-3.293 3.293-3.293a1 1 0 0 0-1.414-1.414l-3.293 3.293-3.293-3.293Z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className={styles.locationTableWrap} style={{ position: "relative" }}>
                      {isLoadingStats && (
                        <div className={styles.statsSpinnerOverlay}>
                          <s-spinner size="large" />
                        </div>
                      )}
                      <table className={styles.locationTable} style={isLoadingStats ? { opacity: 0.4, pointerEvents: "none" } : undefined}>
                        <thead>
                          <tr>
                            <th rowSpan={2}>{t("projects.locationName")}</th>
                            {hasAnyNeighborhood && <th rowSpan={2}>{t("projects.neighborhood")}</th>}
                            {loadedRadii.map((r) => (
                              <th key={r.value} colSpan={3} className={`${styles.columnGroupHeader} ${styles.columnGroupFirst}`}>
                                {formatRadiusLabel(r.value)}
                              </th>
                            ))}
                            {statsConfigApplied.qualitative.tenantMix && (
                              <th rowSpan={2} className={`${styles.sortableHeader} ${styles.qualitativeHeader}`} onClick={() => handleSort("tenantMixFit")}>
                                {t("projects.tenantMixFit")}{renderSortArrow("tenantMixFit")}
                              </th>
                            )}
                            {statsConfigApplied.qualitative.subjectiveFit && (
                              <th rowSpan={2} className={`${styles.sortableHeader} ${styles.qualitativeHeader}`} onClick={() => handleSort("subjectiveFit")}>
                                {t("projects.subjectiveFit")}{renderSortArrow("subjectiveFit")}
                              </th>
                            )}
                            {statsConfigApplied.qualitative.predominantAudience && (
                              <th rowSpan={2} className={`${styles.sortableHeader} ${styles.qualitativeHeader}`} onClick={() => handleSort("predominantAudience")}>
                                {t("projects.predominantAudience")}{renderSortArrow("predominantAudience")}
                              </th>
                            )}
                          </tr>
                          <tr>
                            {loadedRadii.map((r) => {
                              const rKey = r.isCustom ? "custom" : String(r.value);
                              return (
                                <React.Fragment key={r.value}>
                                  <th
                                    className={`${styles.sortableHeader} ${styles.columnGroupFirst}`}
                                    onClick={() => handleSort(`${rKey}-revenue`)}
                                  >
                                    {t("top15.revenue")}{renderSortArrow(`${rKey}-revenue`)}
                                  </th>
                                  <th
                                    className={styles.sortableHeader}
                                    onClick={() => handleSort(`${rKey}-customers`)}
                                  >
                                    {t("top15.customers")}{renderSortArrow(`${rKey}-customers`)}
                                  </th>
                                  <th
                                    className={styles.sortableHeader}
                                    onClick={() => handleSort(`${rKey}-orders`)}
                                  >
                                    {t("top15.orders")}{renderSortArrow(`${rKey}-orders`)}
                                  </th>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedLoadedMetrics.map((loc) => (
                            <tr key={loc.id}>
                              <td><s-text type="strong">{loc.name}</s-text></td>
                              {hasAnyNeighborhood && <td>{loc.neighborhood ?? "—"}</td>}
                              {loc.stats.map((s) => (
                                <React.Fragment key={s.radius}>
                                  <td className={styles.columnGroupFirst}>{formatCurrencyCompact(s.revenue, s.currencyCode, userLocale)}</td>
                                  <td>{s.customers}</td>
                                  <td>{s.orders}</td>
                                </React.Fragment>
                              ))}
                              {statsConfigApplied.qualitative.tenantMix && (
                              <td>
                                  <s-select
                                    value={String(loc.tenantMixFit ?? "")}
                                    onChange={(e: Event) => {
                                      const val = Number((e.currentTarget as HTMLSelectElement).value);
                                      const fd = new FormData();
                                      fd.append("intent", "update-location-fit");
                                      fd.append("setId", loadedProjectId!);
                                      fd.append("locationId", loc.id);
                                      fd.append("tenantMixFit", String(val || 0));
                                      fetcher.submit(fd, { method: "post" });
                                    }}
                                  >
                                    <s-option value="">—</s-option>
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <s-option key={n} value={String(n)}>{n}</s-option>
                                    ))}
                                  </s-select>
                              </td>
                              )}
                              {statsConfigApplied.qualitative.subjectiveFit && (
                              <td>
                                  <s-select
                                    value={String(loc.subjectiveFit ?? "")}
                                    onChange={(e: Event) => {
                                      const val = Number((e.currentTarget as HTMLSelectElement).value);
                                      const fd = new FormData();
                                      fd.append("intent", "update-location-fit");
                                      fd.append("setId", loadedProjectId!);
                                      fd.append("locationId", loc.id);
                                      fd.append("subjectiveFit", String(val || 0));
                                      fetcher.submit(fd, { method: "post" });
                                    }}
                                  >
                                    <s-option value="">—</s-option>
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <s-option key={n} value={String(n)}>{n}</s-option>
                                    ))}
                                  </s-select>
                              </td>
                              )}
                              {statsConfigApplied.qualitative.predominantAudience && (
                              <td>
                                  <s-select
                                    value={loc.predominantAudience ?? ""}
                                    onChange={(e: Event) => {
                                      const val = (e.currentTarget as HTMLSelectElement).value;
                                      const fd = new FormData();
                                      fd.append("intent", "update-location-fit");
                                      fd.append("setId", loadedProjectId!);
                                      fd.append("locationId", loc.id);
                                      fd.append("predominantAudience", val);
                                      fetcher.submit(fd, { method: "post" });
                                    }}
                                  >
                                    <s-option value="">—</s-option>
                                    <s-option value="A">A</s-option>
                                    <s-option value="B">B</s-option>
                                    <s-option value="C">C</s-option>
                                    <s-option value="N/A">N/A</s-option>
                                  </s-select>
                              </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </s-box>
                  </s-section>
                );
              })() : null}
            </div>
            {/* Aside only shown in fullscreen expanded mode */}
            {isHeatmapExpanded && (
              <div className={styles.fullscreenAssignedPane}>
                <div className={styles.collapsibleSectionWrap}>
                <s-section heading={t("projects.heading")}>
                  {projectTableData.length === 0 ? (
                    <s-text color="subdued">{t("projects.noProjectsCreate")}</s-text>
                  ) : projectsCollapsed ? (
                    <>
                      {loadedProjectId && (() => {
                        const row = projectTableData.find((r) => r.id === loadedProjectId);
                        const set = locationSets.find((s) => s.id === loadedProjectId);
                        if (!row || !set) return null;
                        return (
                          <s-box padding="base" borderWidth="base" borderRadius="base">
                            <div className={styles.cardHeader}>
                              <span className={styles.cardBadge}>{row.name}</span>
                              <s-button
                                variant="secondary"
                                tone="critical"
                                onClick={() => setDeleteConfirmSetId(set.id)}
                              >
                                {t("modals.deleteProject")}
                              </s-button>
                            </div>
                            <div className={styles.cardInfo}>
                              <s-text color="subdued">
                                {row.locationCount} {t("projects.locations")}
                              </s-text>
                            </div>
                            <div className={styles.cardActions}>
                              <s-button
                                variant="secondary"
                                commandFor="edit-project-modal"
                                command="--show"
                                onClick={() => {
                                  setEditingSetId(set.id);
                                  setEditingSetName(set.name);
                                  setEditingSetLocations([...set.locations]);
                                }}
                              >
                                {t("projects.edit")}
                              </s-button>
                            </div>
                          </s-box>
                        );
                      })()}
                    </>
                  ) : (
                    <s-stack direction="block" gap="large">
                      <div className={styles.asideRowRight}>
                        <s-button
                          variant="primary"
                          commandFor="new-project-modal"
                          command="--show"
                          onClick={handleStartNewProject}
                        >
                          {t("projects.newProject")}
                        </s-button>
                      </div>
                      {projectTableData.map((row) => {
                        const set = locationSets.find((s) => s.id === row.id);
                        return (
                          <s-box key={row.id} padding="base" borderWidth="base" borderRadius="base">
                            <div className={styles.cardHeader}>
                              <span className={styles.cardBadge}>{row.name}</span>
                              <s-button
                                variant="secondary"
                                tone="critical"
                                onClick={() => setDeleteConfirmSetId(row.id)}
                              >
                                {t("modals.deleteProject")}
                              </s-button>
                            </div>
                            <div className={styles.cardInfo}>
                              <s-text color="subdued">
                                {row.locationCount} {t("projects.locations")}
                              </s-text>
                            </div>
                            <div className={styles.cardActions}>
                              <s-button
                                variant="secondary"
                                commandFor="edit-project-modal"
                                command="--show"
                                onClick={() => {
                                  if (set) {
                                    setEditingSetId(set.id);
                                    setEditingSetName(set.name);
                                    setEditingSetLocations([...set.locations]);
                                  }
                                }}
                              >
                                {t("projects.edit")}
                              </s-button>
                              <s-button
                                variant="primary"
                                onClick={() => {
                                  setLoadedProjectId(row.id);
                                  fetchProjectStats(row.id);
                                  setIsHeatmapExpanded(true);
                                  setCitiesCollapsed(true);
                                  setProjectsCollapsed(true);
                                }}
                              >
                                {t("projects.load")}
                              </s-button>
                            </div>
                          </s-box>
                        );
                      })}
                    </s-stack>
                  )}
                  <div
                    className={`${styles.collapseChevron}${projectsCollapsed ? ` ${styles.collapsed}` : ""}`}
                    onClick={() => setProjectsCollapsed((prev) => !prev)}
                    role="button"
                    aria-label="Toggle expansion projects"
                  >
                    <span className={styles.chevronIcon}>›</span>
                  </div>
                </s-section>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Expansion Projects (full-width below heatmap) ── */}
      {!isHeatmapExpanded && (
        <div className={styles.projectsFullWidth}>
          <s-section heading={t("projects.heading")}>
            {projectTableData.length === 0 ? (
              <s-text color="subdued">{t("projects.noProjectsCreate")}</s-text>
            ) : (
              <>
                <div className={styles.projectsGridHeader}>
                  <s-button
                    variant="primary"
                    commandFor="new-project-modal"
                    command="--show"
                    onClick={handleStartNewProject}
                  >
                    {t("projects.newProject")}
                  </s-button>
                </div>
                <div className={styles.projectsGrid}>
                  {projectTableData.map((row) => {
                    const set = locationSets.find((s) => s.id === row.id);
                    return (
                      <s-box key={row.id} padding="base" borderWidth="base" borderRadius="base">
                        <div className={styles.cardHeader}>
                          <span className={styles.cardBadge}>{row.name}</span>
                          <s-button
                            variant="secondary"
                            tone="critical"
                            onClick={() => setDeleteConfirmSetId(row.id)}
                          >
                            {t("modals.deleteProject")}
                          </s-button>
                        </div>
                        <div className={styles.cardInfo}>
                          <s-text color="subdued">
                            {row.locationCount} {t("projects.locations")}
                          </s-text>
                        </div>
                        <div className={styles.cardActions}>
                          <s-button
                            variant="secondary"
                            commandFor="edit-project-modal"
                            command="--show"
                            onClick={() => {
                              if (set) {
                                setEditingSetId(set.id);
                                setEditingSetName(set.name);
                                setEditingSetLocations([...set.locations]);
                              }
                            }}
                          >
                            {t("projects.edit")}
                          </s-button>
                          <s-button
                            variant="primary"
                            onClick={() => {
                              setLoadedProjectId(row.id);
                              fetchProjectStats(row.id);
                              setIsHeatmapExpanded(true);
                              setCitiesCollapsed(true);
                              setProjectsCollapsed(true);
                            }}
                          >
                            {t("projects.load")}
                          </s-button>
                        </div>
                      </s-box>
                    );
                  })}
                </div>
              </>
            )}
          </s-section>
        </div>
      )}
    </s-page>
  );
}

