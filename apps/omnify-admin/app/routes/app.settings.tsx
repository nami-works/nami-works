import { useState, useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { PageTabs, type PageTab } from "../components/page-tabs";
import { useTranslation } from "react-i18next";
import { loadGoogleMaps } from "../utils/load-google-maps.client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppIdentity } from "../utils/app-identity.server";
import {
  deleteShopCredentials,
  getApiKeyDisplayMask,
  hasShopCredentials,
  saveShopCredentials,
  validateCredentialInput,
  markCredentialsValidated,
  getRuntimeCredentialsForShop,
} from "../services/lalamove-credentials.server";
import { probeLalamoveCredentials } from "../services/lalamove.server";
import {
  saveCredentials as saveIntelipostCredentials,
  deleteCredentials as deleteIntelipostCredentials,
  getStatus as getIntelipostStatus,
  validate as validateIntelipostCredentials,
  validateInput as validateIntelipostInput,
  type IntelipostCredentialStatus,
} from "../services/ld-analytics/intelipost-credentials.server";
import {
  buildCarrierCallbackUrl,
  createCarrierService,
  deleteCarrierService,
  getCarrierRegistration,
} from "../services/carrier/registration.server";
import { buildAllSampleRatesForShop } from "../services/carrier/sample-rate-db.server";
import type { CarrierServiceConfigData, TimeRule } from "../services/carrier/types";
import {
  CarrierServiceContent,
  type CarrierServiceLoaderData,
} from "./app.carrier-service";
import styles from "./app.settings/styles.module.css";
import { MultiSelectInput } from "../components/multi-select-input";

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
  /** Pickup location latitude — stored for auto-routing background service. */
  pickupLat?: number | null;
  /** Pickup location longitude — stored for auto-routing background service. */
  pickupLng?: number | null;
  // Fulfillment details
  deliveryPromiseDays?: number | null;
  orderCutoffTime?: string | null;
  timezone?: string | null;
  // Auto-delivery schedule
  autoDeliveryEnabled?: boolean | null;
  autoAssignDelayMinutes?: number | null;
  autoDispatchTime?: string | null;
  retryCutoffTime?: string | null;
};

const LALAMOVE_MARKETS = [
  { value: "JP", label: "Japan" },
  { value: "BR", label: "Brasil" },
  { value: "HK", label: "Hong Kong SAR" },
  { value: "ID", label: "Indonesia" },
  { value: "MY", label: "Malaysia" },
  { value: "MX", label: "Mexico" },
  { value: "PH", label: "Philippines" },
  { value: "SG", label: "Singapore" },
  { value: "TW", label: "Taiwan Region" },
  { value: "TH", label: "Thailand" },
  { value: "VN", label: "Vietnam" },
];

// Retail sales per-location configuration (mirrors shape used by /app/retail-sales
// and the salesGoalsLocationConfig Prisma table). Writes round-trip through the
// Retail sales route's existing `save-location-config` action intent.
type RetailGoalsLocationConfig = {
  enabled: boolean;
  orderSources: { enabled: boolean; sources: string[] };
  tags: { enabled: boolean; tags: string[] };
};

const DEFAULT_RETAIL_GOALS_CONFIG: RetailGoalsLocationConfig = {
  enabled: true,
  orderSources: { enabled: false, sources: [] },
  tags: { enabled: false, tags: [] },
};

const RETAIL_GOALS_DEFAULT_ORDER_SOURCES = ["Point of Sale", "IGLU POS"];

// Backward-compat with the older sales-goals schema that used `salesChannels`.
function normalizeRetailGoalsConfig(raw: unknown): RetailGoalsLocationConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const orderSources = (r.orderSources ?? r.salesChannels ?? {}) as {
    enabled?: boolean;
    sources?: string[];
    channels?: string[];
  };
  const tags = (r.tags ?? {}) as { enabled?: boolean; tags?: string[] };
  return {
    enabled: r.enabled !== false,
    orderSources: {
      enabled: orderSources.enabled === true,
      sources: Array.isArray(orderSources.sources)
        ? orderSources.sources
        : Array.isArray(orderSources.channels)
          ? orderSources.channels
          : [],
    },
    tags: {
      enabled: tags.enabled === true,
      tags: Array.isArray(tags.tags) ? tags.tags : [],
    },
  };
}

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const userLocale =
    typeof (session as { locale?: string }).locale === "string" &&
    (session as { locale?: string }).locale?.length
      ? (session as { locale?: string }).locale
      : "pt_BR";

  console.info(`[settings] loader START shop=${shop}`);
  const locationsResponse = await admin.graphql(
    `#graphql
      query LocationsForSettings {
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
            }
          }
        }
      }`,
  );
  const locationsJson = await locationsResponse.json();
  const locations = locationsJson.data?.locations?.nodes ?? [];

  const rows = await prisma.lalamoveLocationConfig.findMany({
    where: { shop },
  });
  const lalamoveConfigs = rows.reduce<Record<string, LalamoveConfig>>(
    (acc, row) => {
      acc[row.locationId] = row.data as LalamoveConfig;
      return acc;
    },
    {},
  );

  // Retail sales per-location configs (migrated from old Sales Goals > Settings tab).
  // Read-only here; writes route through /app/retail-sales with save-location-config intent.
  const retailGoalsRows = await prisma.salesGoalsLocationConfig.findMany({
    where: { shop },
  });
  const retailGoalsConfigs = retailGoalsRows.reduce<
    Record<string, RetailGoalsLocationConfig>
  >((acc, row) => {
    acc[row.locationId] = normalizeRetailGoalsConfig(row.data);
    return acc;
  }, {});
  const tagSuggestions = new Set<string>();
  for (const row of retailGoalsRows) {
    const cfg = normalizeRetailGoalsConfig(row.data);
    cfg.tags.tags.forEach((t) => tagSuggestions.add(t));
  }

  const appIdentity = getAppIdentity();

  // Carrier service data
  const registration = await getCarrierRegistration(shop);
  const configRow = await prisma.carrierServiceConfig.findUnique({
    where: { shop },
  });
  const carrierConfig = configRow?.data as CarrierServiceConfigData | undefined;
  const [credentialStatus, apiKeyDisplayMask] = await Promise.all([
    hasShopCredentials(shop),
    getApiKeyDisplayMask(shop),
  ]);
  const configuredMarkets = [
    ...new Set(
      rows
        .map((lc) => (lc.data as { market?: string })?.market)
        .filter((m): m is string => Boolean(m)),
    ),
  ];

  // Local Delivery analytics opt-in + Intelipost credential status.
  const ldAnalyticsConfigRow = await prisma.ldAnalyticsConfig.findUnique({
    where: { shop },
    select: { enabled: true },
  });
  const intelipostStatus = await getIntelipostStatus(shop);
  const ldAnalyticsData = {
    enabled: ldAnalyticsConfigRow?.enabled ?? false,
    intelipostStatus,
  };

  console.info(`[settings] loader OK shop=${shop} locations=${locations.length}`);

  return {
    locations,
    lalamoveConfigs,
    retailGoalsConfigs,
    retailGoalsTagSuggestions: Array.from(tagSuggestions).sort(),
    retailGoalsOrderSources: RETAIL_GOALS_DEFAULT_ORDER_SOURCES,
    userLocale,
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "",
    appIdentity,
    ldAnalyticsData,
    carrierServiceData: {
      shop,
      registration: registration
        ? {
            active: registration.active,
            carrierServiceId: registration.carrierServiceId,
            callbackUrl: registration.callbackUrl,
          }
        : null,
      config: carrierConfig ?? undefined,
      credentialStatus,
      apiKeyDisplayMask,
      configuredMarkets,
    } satisfies CarrierServiceLoaderData,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  console.info(`[settings] action intent=${intent ?? "?"} shop=${shop}`);

  if (intent === "save-lalamove-settings") {
    const locationId = formData.get("locationId");
    if (typeof locationId !== "string" || !locationId) {
      return { ok: false, error: "Location not provided." };
    }
    console.info(`[settings] save-lalamove-settings START shop=${shop} locationId=${locationId}`);
    const existing = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId } },
    });
    const isNewLocation = !existing;

    // Fetch Shopify location coordinates to store alongside config for auto-routing
    let pickupLat: number | null = null;
    let pickupLng: number | null = null;
    try {
      const locRes = await admin.graphql(
        `#graphql
          query SettingsLocationCoords($id: ID!) {
            location(id: $id) {
              address { latitude longitude }
            }
          }`,
        { variables: { id: locationId } },
      );
      const locJson = await locRes.json();
      const locAddr = locJson?.data?.location?.address as {
        latitude?: number | null;
        longitude?: number | null;
      } | null;
      if (locAddr?.latitude != null) pickupLat = locAddr.latitude;
      if (locAddr?.longitude != null) pickupLng = locAddr.longitude;
    } catch (e) {
      console.warn("Could not fetch location coordinates for settings save:", e);
    }

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
      pickupLat,
      pickupLng,
      // Fulfillment details
      deliveryPromiseDays: parseInt(String(formData.get("deliveryPromiseDays") ?? ""), 10) || null,
      orderCutoffTime: String(formData.get("orderCutoffTime") ?? "").trim() || null,
      timezone: String(formData.get("timezone") ?? "").trim() || null,
      // Auto-delivery schedule
      autoDeliveryEnabled: formData.get("autoDeliveryEnabled") === "true",
      autoAssignDelayMinutes: parseInt(String(formData.get("autoAssignDelayMinutes") ?? "15"), 10) || 15,
      autoDispatchTime: String(formData.get("autoDispatchTime") ?? "").trim() || null,
      retryCutoffTime: String(formData.get("retryCutoffTime") ?? "").trim() || null,
    };
    await prisma.lalamoveLocationConfig.upsert({
      where: { shop_locationId: { shop, locationId } },
      update: { data },
      create: { shop, locationId, data },
    });

    if (isNewLocation && data.locationAddress?.trim()) {
      const {
        getMaxZoneRadiusKm,
        buildSampleRatesForLocationWithOrders,
      } = await import("../services/carrier/sample-rate-db.server");
      const configRow = await prisma.carrierServiceConfig.findUnique({
        where: { shop },
      });
      const carrierConfig = configRow?.data as
        | import("../services/carrier/types").CarrierServiceConfigData
        | undefined;
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
      ).catch((e) => console.warn(`[settings] sample-rate-build FAILED shop=${shop}`, e));
    }
    console.info(`[settings] save-lalamove-settings OK shop=${shop} locationId=${locationId} market=${data.market}`);
    return { ok: true };
  }

  // --- Carrier service intents ---

  if (intent === "enable-carrier") {
    const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    const callbackUrl = buildCarrierCallbackUrl(appUrl, shop);
    const result = await createCarrierService(admin, shop, callbackUrl);
    if (result.ok) {
      const cfgRow = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
      const cfg = cfgRow?.data as CarrierServiceConfigData | undefined;
      buildAllSampleRatesForShop(admin, shop, cfg ?? null, {
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim(),
      }).catch((e) => console.warn("[settings] sample-rate build failed:", e));
    }
    return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
  }

  if (intent === "disable-carrier") {
    const result = await deleteCarrierService(admin, shop);
    return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
  }

  if (intent === "save-config") {
    const enabledProvidersRaw = formData.get("enabledProviders");
    const enabledProviders = enabledProvidersRaw
      ? (JSON.parse(String(enabledProvidersRaw)) as CarrierServiceConfigData["enabledProviders"])
      : (["lalamove"] as CarrierServiceConfigData["enabledProviders"]);
    const timeLimit = formData.get("timeLimit") as string | null;
    const transitTime = formData.get("transitTime") as string | null;
    const customDaysRaw = formData.get("customDays");
    const customDays = customDaysRaw ? parseInt(String(customDaysRaw), 10) : undefined;
    const distanceZonesRaw = formData.get("distanceZones");
    const distanceZones = distanceZonesRaw ? JSON.parse(String(distanceZonesRaw)) : [];
    const distanceMethod = (formData.get("distanceMethod") as "postal_codes" | "radius") ?? "radius";
    const distanceUnit = (formData.get("distanceUnit") as "km" | "mi") ?? "km";
    const cfgRow = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
    const existing = (cfgRow?.data ?? {}) as CarrierServiceConfigData;
    const data: CarrierServiceConfigData = {
      ...existing,
      enabledProviders,
      timeRule: timeLimit && transitTime ? { timeLimit, transitTime: transitTime as TimeRule["transitTime"], ...(transitTime === "custom" && Number.isInteger(customDays) ? { customDays } : {}) } : undefined,
      distanceZones: distanceZones.length ? distanceZones : undefined,
      distanceMethod,
      distanceUnit,
    };
    await prisma.carrierServiceConfig.upsert({ where: { shop }, create: { shop, data }, update: { data } });
    buildAllSampleRatesForShop(admin, shop, data, {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim(),
    }).catch((e) => console.warn("[settings] sample-rate build failed:", e));
    return { ok: true, error: null };
  }

  if (intent === "save-lalamove-credentials") {
    const rawApiKey = String(formData.get("apiKey") ?? "").trim();
    const rawApiSecret = String(formData.get("apiSecret") ?? "").trim();
    const hasExisting = await hasShopCredentials(shop);
    if (rawApiKey && rawApiSecret) {
      const validated = validateCredentialInput(rawApiKey, rawApiSecret);
      if (!validated.ok) return { ok: false, error: validated.error };
      await saveShopCredentials(shop, validated.apiKey, validated.apiSecret);
    } else if (!hasExisting.configured) {
      return { ok: false, error: "API key and secret are required." };
    }
    const market = String(formData.get("market") ?? "").trim().toUpperCase() || "BR";
    const cfgRow = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
    const existing = (cfgRow?.data ?? {}) as CarrierServiceConfigData;
    const data: CarrierServiceConfigData = { ...existing, enabledProviders: existing.enabledProviders ?? ["lalamove"], lalamoveDefaultMarket: market };
    await prisma.carrierServiceConfig.upsert({ where: { shop }, create: { shop, data }, update: { data } });
    return { ok: true, credentialStatus: await hasShopCredentials(shop) };
  }

  if (intent === "save-lalamove-preferences") {
    const preferredServiceType = String(formData.get("preferredServiceType") ?? "").trim() || "LALAGO";
    const secondaryServiceType = String(formData.get("secondaryServiceType") ?? "").trim() || undefined;
    const maxOrdersPerRoute = Math.min(15, Math.max(1, parseInt(String(formData.get("maxOrdersPerRoute") ?? "10"), 10) || 10));
    const secondaryMaxOrdersPerRoute = Math.min(15, Math.max(1, parseInt(String(formData.get("secondaryMaxOrdersPerRoute") ?? "10"), 10) || 10));
    const lalamoveSpecialRequestsRaw = formData.get("lalamoveSpecialRequests");
    const incomingSpecialRequests = lalamoveSpecialRequestsRaw ? JSON.parse(String(lalamoveSpecialRequestsRaw)) : undefined;
    const cfgRow = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
    const existing = (cfgRow?.data ?? {}) as CarrierServiceConfigData;
    const data: CarrierServiceConfigData = {
      ...existing,
      lalamovePreferredServiceType: preferredServiceType,
      lalamoveSecondaryServiceType: secondaryServiceType,
      lalamoveMaxOrdersPerRoute: maxOrdersPerRoute,
      lalamoveSecondaryMaxOrdersPerRoute: secondaryMaxOrdersPerRoute,
      lalamoveSpecialRequests: incomingSpecialRequests ?? existing.lalamoveSpecialRequests,
    };
    await prisma.carrierServiceConfig.upsert({ where: { shop }, create: { shop, data }, update: { data } });
    return { ok: true, intent };
  }

  if (intent === "fetch-special-requests") {
    const markets = formData.getAll("market") as string[];
    const serviceType = String(formData.get("serviceType") ?? "").trim();
    if (!markets.length) return { ok: false, error: "Market not provided.", intent };
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) return { ok: false, error: "Missing credentials.", intent };
    try {
      const { getLalamoveCityInfo } = await import("../services/lalamove.server");
      const specialRequestsByMarket: Record<string, Array<{ name: string; description: string }>> = {};
      for (const market of markets) {
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
        specialRequestsByMarket[market] = srs;
      }
      return { ok: true, intent, specialRequestsByMarket };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch city info.";
      return { ok: false, error: msg, intent, specialRequestsByMarket: {} };
    }
  }

  if (intent === "delete-lalamove-credentials") {
    await deleteShopCredentials(shop);
    return { ok: true, credentialStatus: await hasShopCredentials(shop) };
  }

  if (intent === "test-lalamove-credentials") {
    const validated = validateCredentialInput(formData.get("apiKey"), formData.get("apiSecret"));
    if (!validated.ok) return { ok: false, error: validated.error };
    const market = String(formData.get("market") ?? "").trim().toUpperCase() || "BR";
    const probe = await probeLalamoveCredentials(market, { apiKey: validated.apiKey, apiSecret: validated.apiSecret });
    if (!probe.ok) return { ok: false, error: probe.error, details: probe.details ?? null };
    await markCredentialsValidated(shop);
    return { ok: true, details: probe.details ?? null, credentialStatus: await hasShopCredentials(shop) };
  }

  if (intent === "set-ld-analytics-enabled") {
    const enabled = formData.get("enabled") === "true";
    console.info(
      `[ld-analytics:settings] set-ld-analytics-enabled START shop=${shop} enabled=${enabled}`,
    );
    await prisma.ldAnalyticsConfig.upsert({
      where: { shop },
      create: { shop, enabled },
      update: { enabled },
    });
    console.info(`[ld-analytics:settings] set-ld-analytics-enabled OK shop=${shop} enabled=${enabled}`);
    return { ok: true, intent, enabled };
  }

  if (intent === "save-warehouse-credential") {
    const provider = String(formData.get("provider") ?? "").trim();
    if (provider !== "intelipost") {
      return { ok: false, intent, error: "unsupported_provider" };
    }
    const validated = validateIntelipostInput(
      formData.get("apiKey"),
      formData.get("apiEndpoint"),
    );
    if (!validated.ok) {
      return { ok: false, intent, error: validated.reason };
    }
    await saveIntelipostCredentials(shop, {
      apiKey: validated.apiKey,
      apiEndpoint: validated.apiEndpoint,
    });
    const validation = await validateIntelipostCredentials(shop);
    return {
      ok: validation.ok,
      intent,
      validated: validation.ok,
      error: validation.ok ? null : validation.reason,
      intelipostStatus: await getIntelipostStatus(shop),
    };
  }

  if (intent === "delete-warehouse-credential") {
    const provider = String(formData.get("provider") ?? "").trim();
    if (provider !== "intelipost") {
      return { ok: false, intent, error: "unsupported_provider" };
    }
    await deleteIntelipostCredentials(shop);
    return { ok: true, intent, intelipostStatus: await getIntelipostStatus(shop) };
  }

  return { ok: false, error: "Unknown intent." };
};

const defaultConfig = (userLocale: string): LalamoveConfig => ({
  market: "",
  city: "",
  language: userLocale,
  preferredServiceType: "LALAGO",
  locationName: "",
  locationPhone: "",
  locationAddress: "",
  locationDetails: "",
  pickupInstructions: "",
  // Auto-delivery defaults
  deliveryPromiseDays: 0,
  orderCutoffTime: "12:00",
  timezone: "",
  autoDeliveryEnabled: false,
  autoAssignDelayMinutes: 15,
  autoDispatchTime: "14:30",
  retryCutoffTime: "17:30",
});

type SettingsTab = "settings" | "providers" | "carriers";

export default function LocationSettings() {
  const {
    locations,
    lalamoveConfigs,
    retailGoalsConfigs,
    retailGoalsTagSuggestions,
    retailGoalsOrderSources,
    userLocale,
    mapsApiKey,
    appIdentity,
    carrierServiceData,
    ldAnalyticsData,
  } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<SettingsTab>("settings");
  const { t } = useTranslation("settings");
  const lalamoveFetcher = useFetcher();
  const retailGoalsFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const retailGoalsToggleFetcher = useFetcher<{ ok: boolean }>();
  const [settingsLocationId, setSettingsLocationId] = useState("");
  const [showDisabledLocations, setShowDisabledLocations] = useState(false);
  const [isDeliveryDetailsCollapsed, setIsDeliveryDetailsCollapsed] =
    useState(false);
  const [retailGoalsDraft, setRetailGoalsDraft] =
    useState<RetailGoalsLocationConfig>(DEFAULT_RETAIL_GOALS_CONFIG);
  const [retailGoalsSaved, setRetailGoalsSaved] = useState(false);
  const locationAddressFieldRef = useRef<HTMLDivElement | null>(null);
  // Google Maps Places Autocomplete instance — minimal inline type covering
  // the methods + Place fields we actually read (avoids depending on
  // @types/google.maps globals).
  type PlaceResult = { formatted_address?: string; name?: string };
  type PlacesAutocomplete = {
    addListener: (event: string, handler: () => void) => void;
    getPlace?: () => PlaceResult | undefined;
  };
  const locationAddressAutocompleteRef = useRef<PlacesAutocomplete | null>(null);
  const locationAddressInputListenerRef = useRef<((event: Event) => void) | null
    >(null);
  const [lalamoveSettings, setLalamoveSettings] = useState<LalamoveConfig>(
    () => defaultConfig(userLocale ?? "pt_BR"),
  );
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Allow other routes (e.g. Local Delivery's "Settings" action) to deep-link
  // into Settings with a location pre-selected via ?locationId=<id>. Runs once
  // per mount; ignores "all" sentinel and unknown ids.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const param = new URLSearchParams(window.location.search).get("locationId");
    if (!param || param === "all") return;
    const exists = locations.some((loc: { id: string }) => loc.id === param);
    if (exists) setSettingsLocationId(param);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTabs: { id: SettingsTab; label: string }[] = [
    { id: "settings", label: t("tabs.locations") },
    { id: "providers", label: t("tabs.providers") },
    { id: "carriers", label: t("tabs.carriers") },
  ];
  const tabs = appIdentity === "omnify"
    ? allTabs.filter((tab) => tab.id !== "carriers")
    : allTabs;

  // Sync Retail goals draft + feedback state when the selected location changes.
  useEffect(() => {
    setRetailGoalsSaved(false);
    if (!settingsLocationId) {
      setRetailGoalsDraft(DEFAULT_RETAIL_GOALS_CONFIG);
      return;
    }
    setRetailGoalsDraft(
      retailGoalsConfigs[settingsLocationId] ?? DEFAULT_RETAIL_GOALS_CONFIG,
    );
  }, [settingsLocationId, retailGoalsConfigs]);

  // Surface Retail goals save feedback.
  useEffect(() => {
    if (!retailGoalsFetcher.data) return;
    if (retailGoalsFetcher.data.ok) setRetailGoalsSaved(true);
  }, [retailGoalsFetcher.data]);

  useEffect(() => {
    setSaveSuccess(false);
    if (!settingsLocationId) {
      setLalamoveSettings(defaultConfig(userLocale ?? "pt_BR"));
      return;
    }
    const config = lalamoveConfigs[settingsLocationId];
    const loc = locations.find(
      (l: { id: string }) => l.id === settingsLocationId,
    );
    const address = loc?.address;
    const locationAddress =
      config?.locationAddress ??
      (address
        ? [address.address1, address.city, address.province, address.country]
            .filter(Boolean)
            .join(", ")
        : "") ??
      "";
    setLalamoveSettings({
      ...defaultConfig(userLocale ?? "pt_BR"),
      ...config,
      market: config?.market ?? address?.countryCode ?? "",
      city: config?.city ?? address?.city ?? "",
      locationName: config?.locationName ?? loc?.name ?? "",
      locationPhone: config?.locationPhone ?? address?.phone ?? "",
      locationAddress,
      locationDetails: config?.locationDetails ?? address?.address2 ?? "",
      pickupInstructions: config?.pickupInstructions ?? "",
    });
  }, [settingsLocationId, lalamoveConfigs, locations, userLocale]);

  useEffect(() => {
    if (!lalamoveFetcher.data || lalamoveFetcher.data === undefined) return;
    const data = lalamoveFetcher.data as { ok?: boolean; error?: string };
    if (data.ok) {
      setSaveError(null);
      setSettingsSaved(true);
      setSaveSuccess(true);
    } else if (data.error) {
      setSaveError(data.error);
    }
  }, [lalamoveFetcher.data]);

  useEffect(() => {
    if (!mapsApiKey) return;
    let isMounted = true;

    const setupAutocomplete = async () => {
      if (!locationAddressFieldRef.current) return;
      const googleMaps = window.google?.maps;
      if (!googleMaps) return;
      const { Autocomplete } = googleMaps.importLibrary
        ? await googleMaps.importLibrary("places")
        : { Autocomplete: googleMaps.places?.Autocomplete };
      if (!Autocomplete) return;

      const input =
        locationAddressFieldRef.current.querySelector("input") ||
        locationAddressFieldRef.current.shadowRoot?.querySelector("input");
      if (!input) return;

      input.value = lalamoveSettings.locationAddress || "";

      if (!locationAddressInputListenerRef.current) {
        const inputHandler = (event: Event) => {
          const target = event.currentTarget as HTMLInputElement | null;
          if (!target) return;
          setSettingsSaved(false);
          setLalamoveSettings((c) => ({ ...c, locationAddress: target.value }));
        };
        input.addEventListener("input", inputHandler);
        locationAddressInputListenerRef.current = inputHandler;
      }

      if (!locationAddressAutocompleteRef.current) {
        const autocomplete: PlacesAutocomplete = new Autocomplete(input, {
          fields: ["formatted_address", "name"],
        });
        locationAddressAutocompleteRef.current = autocomplete;
        autocomplete.addListener(
          "place_changed",
          () => {
            const place = locationAddressAutocompleteRef.current?.getPlace?.();
            const formatted =
              place?.formatted_address ||
              place?.name ||
              "";
            if (!formatted) return;
            setSettingsSaved(false);
            setLalamoveSettings((c) => ({ ...c, locationAddress: formatted }));
          },
        );
      }
    };

    loadGoogleMaps(mapsApiKey)
      .then(async () => {
        if (!isMounted) return;
        await setupAutocomplete();
      })
      .catch((error) => {
        console.error("Failed to load Google Maps Places for address field", error);
      });

    return () => {
      isMounted = false;
      const input =
        locationAddressFieldRef.current?.querySelector("input") ||
        locationAddressFieldRef.current?.shadowRoot?.querySelector("input");
      if (input && locationAddressInputListenerRef.current) {
        input.removeEventListener("input", locationAddressInputListenerRef.current);
        locationAddressInputListenerRef.current = null;
      }
    };
  }, [mapsApiKey, lalamoveSettings.locationAddress]);

  const updateField = (field: keyof LalamoveConfig, value: string | boolean | number) => {
    setSettingsSaved(false);
    setSaveSuccess(false);
    setLalamoveSettings((c) => ({ ...c, [field]: value }));
  };

  // ─── Retail goals helpers ─────────────────────────────────────────
  const patchRetailGoals = (
    patch: (prev: RetailGoalsLocationConfig) => RetailGoalsLocationConfig,
  ) => {
    setRetailGoalsSaved(false);
    setRetailGoalsDraft((prev) => patch(prev));
  };

  const saveRetailGoals = () => {
    if (!settingsLocationId) return;
    const fd = new FormData();
    fd.append("intent", "save-location-config");
    fd.append("locationId", settingsLocationId);
    fd.append("config", JSON.stringify(retailGoalsDraft));
    retailGoalsFetcher.submit(fd, {
      method: "post",
      action: "/app/retail-sales",
    });
  };

  const toggleRetailGoalsInclude = (nextEnabled: boolean) => {
    if (!settingsLocationId) return;
    const next: RetailGoalsLocationConfig = {
      ...retailGoalsDraft,
      enabled: nextEnabled,
    };
    setRetailGoalsDraft(next);
    setRetailGoalsSaved(false);
    const fd = new FormData();
    fd.append("intent", "save-location-config");
    fd.append("locationId", settingsLocationId);
    fd.append("config", JSON.stringify(next));
    retailGoalsToggleFetcher.submit(fd, {
      method: "post",
      action: "/app/retail-sales",
    });
  };

  // Location list filtered by the Show disabled toggle (if off, hide locations
  // currently excluded from Retail goals; Lalamove-only locations still show).
  const visibleLocations = showDisabledLocations
    ? locations
    : locations.filter((loc: { id: string }) => {
        const cfg = retailGoalsConfigs[loc.id];
        // If no Retail goals config yet, the location is effectively enabled
        // (default state). Only hide when explicitly disabled.
        if (!cfg) return true;
        return cfg.enabled !== false;
      });

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
    // Auto-delivery schedule
    formData.append("deliveryPromiseDays", String(lalamoveSettings.deliveryPromiseDays ?? ""));
    formData.append("orderCutoffTime", lalamoveSettings.orderCutoffTime ?? "");
    formData.append("timezone", lalamoveSettings.timezone ?? "");
    formData.append("autoDeliveryEnabled", String(lalamoveSettings.autoDeliveryEnabled ?? false));
    formData.append("autoAssignDelayMinutes", String(lalamoveSettings.autoAssignDelayMinutes ?? 15));
    formData.append("autoDispatchTime", lalamoveSettings.autoDispatchTime ?? "");
    formData.append("retryCutoffTime", lalamoveSettings.retryCutoffTime ?? "");
    lalamoveFetcher.submit(formData, { method: "post" });
  };

  // Off-block tab strip via shared <PageTabs>. Settings in-place tabs +
  // Brand as a Link tab to the sibling sub-route (`/app/settings/brand`).
  const settingsPageTabs: PageTab[] = [
    ...tabs.map((tab): PageTab => ({
      key: tab.id,
      label: tab.label,
      onClick: () => setActiveTab(tab.id),
    })),
    {
      key: "brand",
      label: t("tabs.brand", { defaultValue: "Brand" }),
      to: "/app/settings/brand",
    },
  ];

  return (
    <s-page heading={t("pageHeading")} inlineSize="base">
      <PageTabs
        activeKey={activeTab}
        tabs={settingsPageTabs}
        ariaLabel={t("pageHeading") as string}
      />
      <s-section>
        {activeTab === "settings" && (
        <s-stack direction="block" gap="base">
          {saveError && (
            <s-banner tone="critical" onDismiss={() => setSaveError(null)}>
              {saveError}
            </s-banner>
          )}
          {saveSuccess && (
            <s-banner tone="success" onDismiss={() => setSaveSuccess(false)}>
              {t("locationSettings.savedSuccess")}
            </s-banner>
          )}

          {/* ── Location selector + Show disabled toggle ───────────── */}
          <div className={styles.selectorRow}>
            <div className={styles.selectorField}>
              <s-select
                label={t("labels.location")}
                name="settingsLocationId"
                value={settingsLocationId}
                onChange={(event) =>
                  setSettingsLocationId(
                    (event.currentTarget as unknown as HTMLSelectElement).value,
                  )
                }
              >
                <s-option value="">
                  {t("locationSettings.selectLocation")}
                </s-option>
                {visibleLocations.map((loc: { id: string; name: string }) => {
                  const cfg = retailGoalsConfigs[loc.id];
                  const isDisabled = cfg && cfg.enabled === false;
                  return (
                    <s-option key={loc.id} value={loc.id}>
                      {isDisabled ? `${loc.name} (disabled)` : loc.name}
                    </s-option>
                  );
                })}
              </s-select>
            </div>
            <div
              className={styles.showDisabledToggle}
              onClick={() => setShowDisabledLocations((prev) => !prev)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <s-checkbox
                checked={showDisabledLocations || undefined}
                onChange={() => setShowDisabledLocations((prev) => !prev)}
              />
              {t("locationSettings.showDisabled")}
            </div>
          </div>

          {/* ── Delivery details (collapsible) ──────────────────────── */}
          <div className={styles.collapsibleSectionWrap}>
            <s-section>
              <div className={styles.sectionHeaderRow}>
                <h2 className={styles.sectionHeaderTitle}>
                  {t("locationSettings.title")}
                </h2>
              </div>
              {!isDeliveryDetailsCollapsed && (
                <s-stack direction="block" gap="base">
                  <div className={styles.settingsGrid}>
            <div className={`${styles.settingsSpanFull} ${styles.settingsGridThree}`}>
              <s-select
                label={t("labels.market")}
                name="market"
                value={lalamoveSettings.market}
                onChange={(e) =>
                  updateField(
                    "market",
                    (e.currentTarget as unknown as HTMLSelectElement).value,
                  )
                }
              >
                <s-option value="">{t("locationSettings.selectMarket")}</s-option>
                {LALAMOVE_MARKETS.map((opt) => (
                  <s-option key={opt.value} value={opt.value}>
                    {opt.label}
                  </s-option>
                ))}
              </s-select>
              <s-text-field
                label={t("labels.city")}
                value={lalamoveSettings.city}
                disabled
              />
              <s-text-field
                label={t("labels.timezone")}
                value={lalamoveSettings.timezone ?? ""}
                {...{ placeholder: Intl.DateTimeFormat().resolvedOptions().timeZone } as Record<string, string>}
                onChange={(e) =>
                  updateField("timezone", (e.currentTarget as unknown as HTMLInputElement).value)
                }
              />
            </div>
            <s-text-field
              label={t("labels.locationName")}
              value={lalamoveSettings.locationName}
              onChange={(e) =>
                updateField(
                  "locationName",
                  (e.currentTarget as unknown as HTMLInputElement).value,
                )
              }
            />
            <s-text-field
              label={t("labels.locationPhone")}
              value={lalamoveSettings.locationPhone}
              onChange={(e) =>
                updateField(
                  "locationPhone",
                  (e.currentTarget as unknown as HTMLInputElement).value,
                )
              }
            />
            <div ref={locationAddressFieldRef}>
              <s-text-field
                label={t("labels.locationAddress")}
                value={lalamoveSettings.locationAddress}
                onChange={(e) =>
                  updateField(
                    "locationAddress",
                    (e.currentTarget as unknown as HTMLInputElement).value,
                  )
                }
              />
            </div>
            <s-text-field
              label={t("labels.locationDetails")}
              value={lalamoveSettings.locationDetails}
              onChange={(e) =>
                updateField(
                  "locationDetails",
                  (e.currentTarget as unknown as HTMLInputElement).value,
                )
              }
            />
            <div
              className={`${styles.settingsSpanFull} ${styles.settingsPickupInstructionsWrap}`}
            >
              <s-text-area
                label={t("labels.pickupInstructions")}
                value={lalamoveSettings.pickupInstructions}
                onChange={(e) =>
                  updateField(
                    "pickupInstructions",
                    (e.currentTarget as unknown as HTMLTextAreaElement).value,
                  )
                }
                rows={4}
              />
            </div>
            <div className={`${styles.settingsSpanFull} ${styles.settingsHidden}`}>
              <s-select
                label={t("labels.preferredServiceType")}
                name="preferredServiceType"
                value={lalamoveSettings.preferredServiceType}
                onChange={(e) =>
                  updateField(
                    "preferredServiceType",
                    (e.currentTarget as unknown as HTMLSelectElement).value,
                  )
                }
              >
                {LALAMOVE_SERVICE_TYPES.map((opt) => (
                  <s-option key={opt.value} value={opt.value}>
                    {opt.label}
                  </s-option>
                ))}
              </s-select>
            </div>

            {/* Delivery promise + cutoff — peer settings (no longer nested under
                the auto-delivery toggle, no divider above). */}
            <s-select
              label={t("labels.deliveryPromiseDays")}
              value={String(lalamoveSettings.deliveryPromiseDays ?? 0)}
              onChange={(e) =>
                updateField(
                  "deliveryPromiseDays",
                  parseInt((e.currentTarget as unknown as HTMLSelectElement).value, 10),
                )
              }
            >
              <s-option value="0">{t("labels.sameDay")}</s-option>
              <s-option value="1">{t("labels.nextDay")}</s-option>
              <s-option value="2">{t("labels.dayPlus2")}</s-option>
              <s-option value="3">{t("labels.dayPlus3")}</s-option>
            </s-select>
            <s-text-field
              label={t("labels.orderCutoffTime")}
              {...{ type: "time" } as Record<string, string>}
              value={lalamoveSettings.orderCutoffTime ?? "12:00"}
              onChange={(e) =>
                updateField("orderCutoffTime", (e.currentTarget as unknown as HTMLInputElement).value)
              }
            />

            {/* Enable automatic delivery — peer setting placed below promise+cutoff. */}
            <div
              className={styles.settingsSpanFull}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <s-checkbox
                checked={lalamoveSettings.autoDeliveryEnabled ?? false}
                onChange={(e) =>
                  updateField(
                    "autoDeliveryEnabled",
                    (e.currentTarget as unknown as HTMLInputElement).checked,
                  )
                }
              />
              <s-text type="strong">{t("labels.autoDeliveryEnabled")}</s-text>
            </div>

            {lalamoveSettings.autoDeliveryEnabled ? (
              <div className={`${styles.settingsSpanFull} ${styles.settingsGridThree}`}>
                <s-text-field
                  label={t("labels.autoAssignDelayMinutes")}
                  {...{ type: "number", min: "0", max: "120" } as Record<string, string>}
                  value={String(lalamoveSettings.autoAssignDelayMinutes ?? 15)}
                  onChange={(e) =>
                    updateField(
                      "autoAssignDelayMinutes",
                      parseInt((e.currentTarget as unknown as HTMLInputElement).value, 10) || 15,
                    )
                  }
                />
                <s-text-field
                  label={t("labels.autoDispatchTime")}
                  {...{ type: "time" } as Record<string, string>}
                  value={lalamoveSettings.autoDispatchTime ?? "14:30"}
                  onChange={(e) =>
                    updateField("autoDispatchTime", (e.currentTarget as unknown as HTMLInputElement).value)
                  }
                />
                <s-text-field
                  label={t("labels.retryCutoffTime")}
                  {...{ type: "time" } as Record<string, string>}
                  value={lalamoveSettings.retryCutoffTime ?? "17:30"}
                  onChange={(e) =>
                    updateField("retryCutoffTime", (e.currentTarget as unknown as HTMLInputElement).value)
                  }
                />
              </div>
            ) : null}
                  </div>

                  {/* Per-section Save: Delivery details */}
                  <div className={styles.saveRow}>
                    {settingsSaved && saveSuccess ? (
                      <span className={styles.savedHint}>
                        {t("status.saved", { ns: "common" })}
                      </span>
                    ) : null}
                    {lalamoveFetcher.state !== "idle" ? (
                      <s-button
                        key="dd-save-loading"
                        variant="primary"
                        loading
                        disabled
                      >
                        {t("locationSettings.saveSettings")}
                      </s-button>
                    ) : !settingsLocationId ? (
                      <s-button
                        key="dd-save-disabled"
                        variant="primary"
                        disabled
                      >
                        {t("locationSettings.saveSettings")}
                      </s-button>
                    ) : (
                      <s-button
                        key="dd-save-active"
                        variant="primary"
                        onClick={saveLocationSettings}
                      >
                        {t("locationSettings.saveSettings")}
                      </s-button>
                    )}
                  </div>
                </s-stack>
              )}
              <div
                className={`${styles.collapseChevron}${isDeliveryDetailsCollapsed ? ` ${styles.collapsed}` : ""}`}
                onClick={() => setIsDeliveryDetailsCollapsed((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsDeliveryDetailsCollapsed((prev) => !prev);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Toggle Delivery details section"
              >
                <span className={styles.chevronIcon}>›</span>
              </div>
              {/* Section terminator — visible whether collapsed or expanded. */}
              <div className={styles.sectionTerminator} />
            </s-section>
          </div>

          {/* ── Retail goals (collapsible via header toggle) ───────── */}
          {settingsLocationId ? (
            <div className={styles.collapsibleSectionWrap}>
              <s-section>
                <div className={styles.sectionHeaderRow}>
                  <h2 className={styles.sectionHeaderTitle}>
                    {t("retailSales.title")}
                  </h2>
                  <div
                    className={styles.headerToggle}
                    onClick={() =>
                      toggleRetailGoalsInclude(!retailGoalsDraft.enabled)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).click();
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <s-checkbox
                      checked={retailGoalsDraft.enabled || undefined}
                      onChange={() =>
                        toggleRetailGoalsInclude(!retailGoalsDraft.enabled)
                      }
                    />
                    {retailGoalsDraft.enabled
                      ? t("retailSales.includeToggleOn")
                      : t("retailSales.includeToggleOff")}
                  </div>
                </div>

                {retailGoalsDraft.enabled ? (
                  <s-stack direction="block" gap="base">
                    <span className={styles.filterHint}>
                      {t("retailSales.subtitle")}
                    </span>

                    {/* Order sources filter block */}
                    <div className={styles.filterBlock}>
                      <div className={styles.filterHeaderRow}>
                        <span className={styles.filterLabel}>
                          {t("retailSales.orderSources")}
                        </span>
                        <s-checkbox
                          checked={
                            retailGoalsDraft.orderSources.enabled || undefined
                          }
                          onChange={(e: Event) =>
                            patchRetailGoals((prev) => ({
                              ...prev,
                              orderSources: {
                                ...prev.orderSources,
                                enabled:
                                  (
                                    e.currentTarget as HTMLInputElement | null
                                  )?.checked ?? false,
                              },
                            }))
                          }
                        />
                      </div>
                      <MultiSelectInput
                        value={retailGoalsDraft.orderSources.sources}
                        suggestions={retailGoalsOrderSources}
                        disabled={!retailGoalsDraft.orderSources.enabled}
                        placeholder={t("retailSales.searchOrderSources")}
                        onChange={(next) =>
                          patchRetailGoals((prev) => ({
                            ...prev,
                            orderSources: { ...prev.orderSources, sources: next },
                          }))
                        }
                      />
                      <span className={styles.filterHint}>
                        {t("retailSales.orderSourcesHint")}
                      </span>
                    </div>

                    {/* Required tags filter block */}
                    <div className={styles.filterBlock}>
                      <div className={styles.filterHeaderRow}>
                        <span className={styles.filterLabel}>
                          {t("retailSales.tags")}
                        </span>
                        <s-checkbox
                          checked={retailGoalsDraft.tags.enabled || undefined}
                          onChange={(e: Event) =>
                            patchRetailGoals((prev) => ({
                              ...prev,
                              tags: {
                                ...prev.tags,
                                enabled:
                                  (
                                    e.currentTarget as HTMLInputElement | null
                                  )?.checked ?? false,
                              },
                            }))
                          }
                        />
                      </div>
                      <MultiSelectInput
                        value={retailGoalsDraft.tags.tags}
                        suggestions={retailGoalsTagSuggestions}
                        disabled={!retailGoalsDraft.tags.enabled}
                        placeholder={t("retailSales.searchTags")}
                        onChange={(next) =>
                          patchRetailGoals((prev) => ({
                            ...prev,
                            tags: { ...prev.tags, tags: next },
                          }))
                        }
                      />
                      <span className={styles.filterHint}>
                        {t("retailSales.tagsHint")}
                      </span>
                    </div>

                    {/* Per-section Save: Retail goals */}
                    <div className={styles.saveRow}>
                      {retailGoalsSaved ? (
                        <span className={styles.savedHint}>
                          {t("status.saved", { ns: "common" })}
                        </span>
                      ) : null}
                      {retailGoalsFetcher.state !== "idle" ? (
                        <s-button
                          key="rg-save-loading"
                          variant="primary"
                          loading
                          disabled
                        >
                          {t("retailSales.saveRetailSales")}
                        </s-button>
                      ) : (
                        <s-button
                          key="rg-save-active"
                          variant="primary"
                          onClick={saveRetailGoals}
                        >
                          {t("retailSales.saveRetailSales")}
                        </s-button>
                      )}
                    </div>
                  </s-stack>
                ) : (
                  <span className={styles.collapsedHint}>
                    {t("retailSales.collapsedHint")}
                  </span>
                )}
                {/* Section terminator — visible whether collapsed or expanded. */}
                <div className={styles.sectionTerminator} />
              </s-section>
            </div>
          ) : null}
        </s-stack>
        )}

        {activeTab === "providers" && (
          <LdAnalyticsSettingsBlock data={ldAnalyticsData} />
        )}

        {(activeTab === "providers" || activeTab === "carriers") && (
          <CarrierServiceContent
            data={carrierServiceData}
            activeTab={activeTab}
          />
        )}
      </s-section>
    </s-page>
  );
}

// ────────────────────────────────────────────────────────────
// Local Delivery Analytics — Settings block (providers tab)
// ────────────────────────────────────────────────────────────
type LdAnalyticsSettingsData = {
  enabled: boolean;
  intelipostStatus: IntelipostCredentialStatus;
};

function LdAnalyticsSettingsBlock({ data }: { data: LdAnalyticsSettingsData }) {
  const { t } = useTranslation("ld-analytics");
  const toggleFetcher = useFetcher<{ ok: boolean; enabled?: boolean }>();
  const credFetcher = useFetcher<{
    ok: boolean;
    intent?: string;
    validated?: boolean;
    error?: string | null;
    intelipostStatus?: IntelipostCredentialStatus;
  }>();
  const [apiKey, setApiKey] = useState("");
  const [apiEndpoint, setApiEndpoint] = useState(data.intelipostStatus.apiEndpoint ?? "");

  const isEnabled = toggleFetcher.formData
    ? toggleFetcher.formData.get("enabled") === "true"
    : data.enabled;

  const status = credFetcher.data?.intelipostStatus ?? data.intelipostStatus;
  const isSaving = credFetcher.state !== "idle";
  const lastError = credFetcher.data && !credFetcher.data.ok ? credFetcher.data.error : null;
  const validatedJustNow =
    credFetcher.data?.intent === "save-warehouse-credential" && credFetcher.data?.validated === true;

  const onToggle = (next: boolean) => {
    const fd = new FormData();
    fd.append("intent", "set-ld-analytics-enabled");
    fd.append("enabled", next ? "true" : "false");
    toggleFetcher.submit(fd, { method: "post" });
  };

  const onSave = () => {
    const fd = new FormData();
    fd.append("intent", "save-warehouse-credential");
    fd.append("provider", "intelipost");
    fd.append("apiKey", apiKey);
    if (apiEndpoint.trim()) fd.append("apiEndpoint", apiEndpoint.trim());
    credFetcher.submit(fd, { method: "post" });
    setApiKey("");
  };

  const onDelete = () => {
    const fd = new FormData();
    fd.append("intent", "delete-warehouse-credential");
    fd.append("provider", "intelipost");
    credFetcher.submit(fd, { method: "post" });
  };

  return (
    <s-stack direction="block" gap="base">
      <s-section heading={t("settings.title")}>
        <s-stack direction="block" gap="base">
          <div
            className={styles.checkboxToggle ?? ""}
            onClick={() => onToggle(!isEnabled)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle(!isEnabled);
              }
            }}
            role="button"
            tabIndex={0}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
          >
            <s-checkbox
              checked={isEnabled || undefined}
              onChange={() => onToggle(!isEnabled)}
            />
            <div>
              <div style={{ fontWeight: 500 }}>{t("settings.enable.label")}</div>
              <div style={{ color: "#6d7175", fontSize: 13 }}>
                {t("settings.enable.description")}
              </div>
            </div>
          </div>

          {isEnabled && (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                  {t("settings.credential.title")}
                </h3>
                <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <s-text-field
                      label={t("settings.credential.intelipost.apiKeyLabel")}
                      value={apiKey}
                      onChange={(e: Event) => {
                        setApiKey((e.target as HTMLInputElement).value);
                      }}
                      placeholder={status.configured ? status.apiKeyMask : ""}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <s-text-field
                      label={t("settings.credential.intelipost.endpointLabel")}
                      value={apiEndpoint}
                      onChange={(e: Event) => {
                        setApiEndpoint((e.target as HTMLInputElement).value);
                      }}
                      placeholder={t("settings.credential.intelipost.endpointPlaceholder")}
                    />
                  </div>
                </div>

                {status.configured && (
                  <div style={{ fontSize: 12, color: "#6d7175" }}>
                    {t("settings.credential.configured")}
                    {status.lastValidatedAt
                      ? ` · ${t("settings.credential.lastValidated", { date: new Date(status.lastValidatedAt).toLocaleString() })}`
                      : ""}
                  </div>
                )}

                {validatedJustNow && (
                  <s-banner tone="success">{t("settings.credential.validateOk")}</s-banner>
                )}
                {lastError && (
                  <s-banner tone="critical">
                    {t("settings.credential.validateFailed", { reason: lastError })}
                  </s-banner>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: status.configured ? "space-between" : "flex-end",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  {status.configured ? (
                    <s-button
                      variant="secondary"
                      tone="critical"
                      onClick={onDelete}
                    >
                      {t("settings.credential.delete")}
                    </s-button>
                  ) : null}
                  <s-button
                    variant="primary"
                    onClick={onSave}
                    loading={isSaving || undefined}
                    disabled={!apiKey || isSaving || undefined}
                  >
                    {t("settings.credential.save")}
                  </s-button>
                </div>
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>
    </s-stack>
  );
}
