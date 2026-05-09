import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useFetcher,
  useLocation,
  useSearchParams,
  useRevalidator,
} from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  deleteShopCredentials,
  getApiKeyDisplayMask,
  getRuntimeCredentialsForShop,
  hasShopCredentials,
  markCredentialsValidated,
  saveShopCredentials,
  validateCredentialInput,
} from "../services/lalamove-credentials.server";
import {
  probeLalamoveCredentials,
  sanitizeLalamoveErrorMessage,
} from "../services/lalamove.server";
import {
  buildCarrierCallbackUrl,
  createCarrierService,
  deleteCarrierService,
  getCarrierRegistration,
} from "../services/carrier/registration.server";
import { buildAllSampleRatesForShop } from "../services/carrier/sample-rate-db.server";
import type {
  CarrierServiceConfigData,
  DistanceZone,
  TimeRule,
} from "../services/carrier/types";
import styles from "./app.carrier-service/styles.module.css";

const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const h = i < 10 ? `0${i}` : String(i);
  return { value: `${h}:00`, label: `${h}:00` };
});

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

const TRANSIT_OPTIONS: Array<{
  value: TimeRule["transitTime"];
  label: string;
}> = [
  { value: "same_day", label: "On the same day" },
  { value: "next_day", label: "On the next day" },
  { value: "2_days", label: "In 2 days" },
  { value: "3_days", label: "In 3 days" },
  { value: "custom", label: "Custom" },
];

const credentialValidationThrottleByShop = new Map<string, number>();

const PROVIDERS = [
  { id: "lalamove" as const, label: "Lalamove", available: true },
  { id: "loggi" as const, label: "Loggi", available: false },
  { id: "uber" as const, label: "Uber", available: false },
  { id: "rappi" as const, label: "Rappi", available: false },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  console.info(`[carrier-service] loader START shop=${shop}`);

  const registration = await getCarrierRegistration(shop);
  const configRow = await prisma.carrierServiceConfig.findUnique({
    where: { shop },
  });
  const config = configRow?.data as CarrierServiceConfigData | undefined;
  const [credentialStatus, apiKeyDisplayMask] = await Promise.all([
    hasShopCredentials(shop),
    getApiKeyDisplayMask(shop),
  ]);

  // Load configured markets from location settings for special requests discovery
  const locationConfigs = await prisma.lalamoveLocationConfig.findMany({
    where: { shop },
    select: { data: true },
  });
  const configuredMarkets = [
    ...new Set(
      locationConfigs
        .map((lc) => (lc.data as { market?: string })?.market)
        .filter((m): m is string => Boolean(m)),
    ),
  ];

  return {
    shop,
    registration: registration
      ? {
          active: registration.active,
          carrierServiceId: registration.carrierServiceId,
          callbackUrl: registration.callbackUrl,
        }
      : null,
    config: config ?? undefined,
    credentialStatus,
    apiKeyDisplayMask,
    configuredMarkets,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "enable-carrier") {
      const appUrl =
        process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
      const callbackUrl = buildCarrierCallbackUrl(appUrl, shop);
      const result = await createCarrierService(admin, shop, callbackUrl);
      if (result.ok) {
        const configRow = await prisma.carrierServiceConfig.findUnique({
          where: { shop },
        });
        const config = configRow?.data as CarrierServiceConfigData | undefined;
        buildAllSampleRatesForShop(admin, shop, config ?? null, {
          googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim(),
        }).catch((e) => console.warn("[local-delivery] sample-rate build failed:", e));
      }
      return result.ok
        ? { ok: true, error: null }
        : { ok: false, error: result.error };
    }

    if (intent === "disable-carrier") {
      const result = await deleteCarrierService(admin, shop);
      return result.ok
        ? { ok: true, error: null }
        : { ok: false, error: result.error };
    }

    if (intent === "save-config") {
      const enabledProvidersRaw = formData.get("enabledProviders");
      const enabledProviders = enabledProvidersRaw
        ? (JSON.parse(String(enabledProvidersRaw)) as CarrierServiceConfigData["enabledProviders"])
        : (["lalamove"] as CarrierServiceConfigData["enabledProviders"]);
      const timeLimit = formData.get("timeLimit") as string | null;
      const transitTime = formData.get("transitTime") as TimeRule["transitTime"] | null;
      const customDaysRaw = formData.get("customDays");
      const customDays = customDaysRaw
        ? parseInt(String(customDaysRaw), 10)
        : undefined;
      const distanceZonesRaw = formData.get("distanceZones");
      const distanceZones = distanceZonesRaw
        ? (JSON.parse(String(distanceZonesRaw)) as DistanceZone[])
        : [];
      const distanceMethod = (formData.get("distanceMethod") as "postal_codes" | "radius") ?? "radius";
      const distanceUnit = (formData.get("distanceUnit") as "km" | "mi") ?? "km";

      const configRow = await prisma.carrierServiceConfig.findUnique({
        where: { shop },
      });
      const existing = (configRow?.data ?? {}) as CarrierServiceConfigData;
      const data: CarrierServiceConfigData = {
        ...existing,
        enabledProviders,
        timeRule:
          timeLimit && transitTime
            ? {
                timeLimit,
                transitTime,
                ...(transitTime === "custom" && Number.isInteger(customDays)
                  ? { customDays }
                  : {}),
              }
            : undefined,
        distanceZones: distanceZones.length ? distanceZones : undefined,
        distanceMethod,
        distanceUnit,
      };

      await prisma.carrierServiceConfig.upsert({
        where: { shop },
        create: { shop, data },
        update: { data },
      });
      buildAllSampleRatesForShop(admin, shop, data, {
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim(),
      }).catch((e) => console.warn("[local-delivery] sample-rate build failed:", e));
      return { ok: true, error: null };
    }

    if (intent === "save-lalamove-credentials") {
      const rawApiKey = String(formData.get("apiKey") ?? "").trim();
      const rawApiSecret = String(formData.get("apiSecret") ?? "").trim();
      const hasExisting = await hasShopCredentials(shop);

      // If user provided new credentials, validate and save them
      if (rawApiKey && rawApiSecret) {
        const validated = validateCredentialInput(rawApiKey, rawApiSecret);
        if (!validated.ok) {
          return { ok: false, error: validated.error };
        }
        await saveShopCredentials(shop, validated.apiKey, validated.apiSecret);
      } else if (!hasExisting.configured) {
        // No existing credentials and none provided — error
        return { ok: false, error: "API key and secret are required." };
      }
      // Save market to config
      const market =
        String(formData.get("market") ?? "").trim().toUpperCase() || "BR";
      const configRow = await prisma.carrierServiceConfig.findUnique({
        where: { shop },
      });
      const existing = (configRow?.data ?? {}) as CarrierServiceConfigData;
      const data: CarrierServiceConfigData = {
        ...existing,
        enabledProviders: existing.enabledProviders ?? ["lalamove"],
        lalamoveDefaultMarket: market,
      };
      await prisma.carrierServiceConfig.upsert({
        where: { shop },
        create: { shop, data },
        update: { data },
      });
      return {
        ok: true,
        credentialStatus: await hasShopCredentials(shop),
      };
    }

    if (intent === "save-lalamove-preferences") {
      const preferredServiceType =
        String(formData.get("preferredServiceType") ?? "").trim() || "LALAGO";
      const secondaryServiceType =
        String(formData.get("secondaryServiceType") ?? "").trim() || undefined;
      const maxOrdersPerRoute = Math.min(
        15,
        Math.max(1, parseInt(String(formData.get("maxOrdersPerRoute") ?? "10"), 10) || 10),
      );
      const secondaryMaxOrdersPerRoute = Math.min(
        15,
        Math.max(1, parseInt(String(formData.get("secondaryMaxOrdersPerRoute") ?? "10"), 10) || 10),
      );
      const lalamoveSpecialRequestsRaw = formData.get("lalamoveSpecialRequests");
      const incomingSpecialRequests = lalamoveSpecialRequestsRaw
        ? (JSON.parse(String(lalamoveSpecialRequestsRaw)) as Record<string, string[]>)
        : undefined;
      const configRow = await prisma.carrierServiceConfig.findUnique({
        where: { shop },
      });
      const existing = (configRow?.data ?? {}) as CarrierServiceConfigData;
      const data: CarrierServiceConfigData = {
        ...existing,
        lalamovePreferredServiceType: preferredServiceType,
        lalamoveSecondaryServiceType: secondaryServiceType,
        lalamoveMaxOrdersPerRoute: maxOrdersPerRoute,
        lalamoveSecondaryMaxOrdersPerRoute: secondaryMaxOrdersPerRoute,
        lalamoveSpecialRequests: incomingSpecialRequests ?? existing.lalamoveSpecialRequests,
      };
      await prisma.carrierServiceConfig.upsert({
        where: { shop },
        create: { shop, data },
        update: { data },
      });
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

    if (intent === "save-special-requests") {
      const market = String(formData.get("market") ?? "").trim();
      const selectedKeys = formData.getAll("selectedKeys") as string[];
      if (!market) return { ok: false, error: "Market not provided." };
      const configRow = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
      const existing = (configRow?.data ?? {}) as CarrierServiceConfigData;
      const currentMap: Record<string, string[]> = { ...(existing.lalamoveSpecialRequests ?? {}) };
      currentMap[market] = selectedKeys;
      const data: CarrierServiceConfigData = { ...existing, lalamoveSpecialRequests: currentMap };
      await prisma.carrierServiceConfig.upsert({
        where: { shop },
        create: { shop, data },
        update: { data },
      });
      return { ok: true, intent };
    }

    if (intent === "delete-lalamove-credentials") {
      await deleteShopCredentials(shop);
      return {
        ok: true,
        credentialStatus: await hasShopCredentials(shop),
      };
    }

    if (intent === "test-lalamove-credentials") {
      const now = Date.now();
      const last = credentialValidationThrottleByShop.get(shop) ?? 0;
      if (now - last < 3000) {
        return { ok: false, error: "Please wait a moment before testing again." };
      }
      credentialValidationThrottleByShop.set(shop, now);

      const validated = validateCredentialInput(
        formData.get("apiKey"),
        formData.get("apiSecret"),
      );
      if (!validated.ok) {
        return { ok: false, error: validated.error };
      }
      const market =
        String(formData.get("market") ?? "").trim().toUpperCase() || "BR";
      const probe = await probeLalamoveCredentials(market, {
        apiKey: validated.apiKey,
        apiSecret: validated.apiSecret,
      });
      if (!probe.ok) {
        return { ok: false, error: probe.error, details: probe.details ?? null };
      }
      await markCredentialsValidated(shop);
      return {
        ok: true,
        details: probe.details ?? null,
        credentialStatus: await hasShopCredentials(shop),
      };
    }

    return { ok: false, error: "Unknown intent." };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Unexpected error.";
    return {
      ok: false,
      error: sanitizeLalamoveErrorMessage(raw),
    };
  }
};

function formatTimeLabel(value: string): string {
  const [h, m] = value.split(":");
  const hour = parseInt(h ?? "0", 10);
  if (hour === 0) return "12:00 AM";
  if (hour === 12) return "12:00 PM";
  if (hour < 12) return `${hour}:${m ?? "00"} AM`;
  return `${hour - 12}:${m ?? "00"} PM`;
}

function getExplanatoryTimeText(
  timeLimit: string,
  transitTime: TimeRule["transitTime"],
  customDays: number | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const today = new Date();
  const limitLabel = formatTimeLabel(timeLimit);
  let byDate: Date;
  switch (transitTime) {
    case "same_day":
      byDate = today;
      break;
    case "next_day":
      byDate = new Date(today);
      byDate.setDate(byDate.getDate() + 1);
      break;
    case "2_days":
      byDate = new Date(today);
      byDate.setDate(byDate.getDate() + 2);
      break;
    case "3_days":
      byDate = new Date(today);
      byDate.setDate(byDate.getDate() + 3);
      break;
    case "custom":
      byDate = new Date(today);
      byDate.setDate(byDate.getDate() + (customDays ?? 0));
      break;
    default:
      byDate = today;
  }
  const dateStr = byDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return t("parameters.explanatoryTime.text", { date: dateStr, time: limitLabel });
}

function zoneSummary(zone: DistanceZone, unit: "km" | "mi", t: (key: string, opts?: Record<string, unknown>) => string): string {
  const u = unit === "km" ? "km" : "mi";
  const r = zone.radiusKm ?? (zone.radiusMiles ? zone.radiusMiles + " " + u : "");
  const radiusStr =
    typeof r === "number" ? t("zoneSummary.upTo", { value: r, unit: u }) : (zone.radiusMiles ? t("zoneSummary.upTo", { value: zone.radiusMiles, unit: u }) : "—");
  if (zone.useCarrierQuote) return `${radiusStr} • ${t("zoneSummary.carrierDefault")}`;
  const price =
    zone.customPriceSubunits != null
      ? (zone.customPriceSubunits / 100).toFixed(2)
      : "—";
  let s = `${radiusStr} • ${t("zoneSummary.customPrice", { price })}`;
  if (
    zone.dilateTimeValue != null &&
    zone.dilateTimeValue > 0 &&
    zone.dilateTimeDimension
  ) {
    s += ` • ${t("zoneSummary.timeDilated", { value: zone.dilateTimeValue, dimension: zone.dilateTimeDimension })}`;
  }
  return s;
}

const defaultZone = (): DistanceZone => ({
  name: "Local Delivery",
  radiusKm: 10,
  useCarrierQuote: true,
});

const WAIT_TIME_KEY_PREFIX = "WAITING_TIME_";
const THERMAL_BAG_PATTERN = /thermal.?bag/i;
const RETURN_TRIP_PATTERN = /return.?trip/i;

/**
 * Parse a Lalamove wait-time special request key (e.g. "WAITING_TIME_030MIN")
 * into its numeric duration so we can sort ascending and look up a clean i18n
 * label instead of displaying Lalamove's mixed-language description.
 */
const parseWaitTimeKey = (name: string): { minutes: number } | null => {
  const match = name.match(/^WAITING_TIME_0*(\d+)MIN$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return { minutes };
};

export type CarrierServiceLoaderData = {
  shop: string;
  registration: {
    active: boolean;
    carrierServiceId: string;
    callbackUrl: string;
  } | null;
  config: CarrierServiceConfigData | undefined;
  credentialStatus: { configured: boolean; lastValidatedAt: string | null };
  apiKeyDisplayMask: string;
  configuredMarkets: string[];
};

export function CarrierServiceContent({
  data,
  activeTab: carrierTabProp,
}: {
  data: CarrierServiceLoaderData;
  activeTab: "providers" | "carriers";
}) {
  const { shop, registration, config, credentialStatus, apiKeyDisplayMask, configuredMarkets } = data;
  const fetcher = useFetcher();
  const credentialFetcher = useFetcher<typeof action>();
  const prefFetcher = useFetcher<typeof action>();
  const specialRequestsFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [specialRequestsByMarket, setSpecialRequestsByMarket] = useState<
    Record<string, Array<{ name: string; description: string }>>
  >({});
  const [selectedSpecialRequests, setSelectedSpecialRequests] = useState<Record<string, Set<string>>>(
    () => {
      const saved = config?.lalamoveSpecialRequests ?? {};
      const result: Record<string, Set<string>> = {};
      for (const [m, keys] of Object.entries(saved)) {
        result[m] = new Set(keys);
      }
      return result;
    },
  );
  const [enabled, setEnabled] = useState(!!registration?.active);
  const [enabledProviders, setEnabledProviders] = useState<string[]>(
    config?.enabledProviders ?? ["lalamove"],
  );
  const [timeLimit, setTimeLimit] = useState(config?.timeRule?.timeLimit ?? "16:00");
  const [transitTime, setTransitTime] = useState<TimeRule["transitTime"]>(
    config?.timeRule?.transitTime ?? "same_day",
  );
  const [customDays, setCustomDays] = useState(
    config?.timeRule?.customDays ?? 2,
  );
  const [distanceMethod, setDistanceMethod] = useState<"postal_codes" | "radius">(
    config?.distanceMethod ?? "radius",
  );
  const [distanceUnit, setDistanceUnit] = useState<"km" | "mi">(
    config?.distanceUnit ?? "km",
  );
  const [zones, setZones] = useState<DistanceZone[]>(
    config?.distanceZones?.length ? config.distanceZones : [defaultZone()],
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingZoneIndex, setEditingZoneIndex] = useState<number | null>(null);
  const [zoneName, setZoneName] = useState("Local Delivery");
  const [zoneRadius, setZoneRadius] = useState("10");
  const [zoneMinOrder, setZoneMinOrder] = useState("");
  const [zoneUseCarrierQuote, setZoneUseCarrierQuote] = useState(true);
  const [zoneCustomPrice, setZoneCustomPrice] = useState("");
  const [zoneDilateValue, setZoneDilateValue] = useState("");
  const [zoneDilateDimension, setZoneDilateDimension] = useState<
    "minutes" | "hours" | "days"
  >("days");
  const [zoneDeliveryInfo, setZoneDeliveryInfo] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [prefModalOpen, setPrefModalOpen] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [moreExpanded, setMoreExpanded] = useState(false);

  useEffect(() => {
    if (!moreExpanded) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreExpanded(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [moreExpanded]);
  const [credentialsUnlocked, setCredentialsUnlocked] = useState(false);
  const [prefMessage, setPrefMessage] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiSecretInput, setApiSecretInput] = useState("");
  const [marketInput, setMarketInput] = useState(
    config?.lalamoveDefaultMarket ?? "BR",
  );
  const [preferredServiceTypeInput, setPreferredServiceTypeInput] = useState(
    config?.lalamovePreferredServiceType ?? "LALAGO",
  );
  const [secondaryServiceTypeInput, setSecondaryServiceTypeInput] = useState(
    config?.lalamoveSecondaryServiceType ?? "",
  );
  const [maxOrdersPerRouteInput, setMaxOrdersPerRouteInput] = useState(
    String(config?.lalamoveMaxOrdersPerRoute ?? 10),
  );
  const [secondaryMaxOrdersInput, setSecondaryMaxOrdersInput] = useState(
    String(config?.lalamoveSecondaryMaxOrdersPerRoute ?? 10),
  );
  const [credentialStatusState, setCredentialStatusState] = useState(
    credentialStatus,
  );
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null);
  const { t } = useTranslation("carrier-service");
  const carrierTab = carrierTabProp;

  const transitKeyMap: Record<TimeRule["transitTime"], string> = {
    same_day: "parameters.onTheSameDay",
    next_day: "parameters.onTheNextDay",
    "2_days": "parameters.in2Days",
    "3_days": "parameters.in3Days",
    custom: "parameters.custom",
  };

  useEffect(() => {
    if (registration?.active !== undefined) setEnabled(!!registration.active);
  }, [registration?.active]);

  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle") return;
    const data = fetcher.data as { ok?: boolean; error?: string };
    const currentIntent = (fetcher.formData as FormData | undefined)?.get("intent");
    if (data.ok) {
      setActionError(null);
      if (currentIntent === "enable-carrier") setEnabled(true);
      if (currentIntent === "disable-carrier") setEnabled(false);
    } else if (data.error) {
      setActionError(data.error);
    }
  }, [fetcher.data, fetcher.state, fetcher.formData]);

  useEffect(() => {
    setPreferredServiceTypeInput(config?.lalamovePreferredServiceType ?? "LALAGO");
    setSecondaryServiceTypeInput(config?.lalamoveSecondaryServiceType ?? "");
    setMaxOrdersPerRouteInput(String(config?.lalamoveMaxOrdersPerRoute ?? 10));
    setSecondaryMaxOrdersInput(String(config?.lalamoveSecondaryMaxOrdersPerRoute ?? 10));
  }, [config?.lalamovePreferredServiceType, config?.lalamoveSecondaryServiceType, config?.lalamoveMaxOrdersPerRoute, config?.lalamoveSecondaryMaxOrdersPerRoute]);

  useEffect(() => {
    if (!credentialFetcher.data || credentialFetcher.state !== "idle") return;
    const data = credentialFetcher.data as {
      ok?: boolean;
      error?: string;
      details?: { warning?: string } | null;
      credentialStatus?: typeof credentialStatus;
    };
    if (data.ok) {
      setCredentialStatusState((prev) => data.credentialStatus ?? prev);
      const warning =
        data.details && "warning" in data.details ? data.details.warning : "";
      setCredentialMessage(warning || t("lalamoveModal.credentialsSaved"));
      // Auto-close modal with delay after showing success message
      if ((credentialFetcher.formData as FormData | undefined)?.get("intent") === "save-lalamove-credentials") {
        setTimeout(() => {
          setApiModalOpen(false);
          setCredentialMessage(null);
          setApiKeyInput("");
          setApiSecretInput("");
        }, 2000);
      }
      return;
    }
    if (data.error) {
      setCredentialMessage(data.error);
    }
  }, [credentialFetcher.data, credentialFetcher.state, credentialStatus]);

  useEffect(() => {
    if (!specialRequestsFetcher.data || specialRequestsFetcher.state !== "idle") return;
    const data = specialRequestsFetcher.data as {
      ok?: boolean;
      intent?: string;
      specialRequestsByMarket?: Record<string, Array<{ name: string; description: string }>>;
    };
    if (data.intent === "fetch-special-requests" && data.ok && data.specialRequestsByMarket) {
      setSpecialRequestsByMarket(data.specialRequestsByMarket);
    }
  }, [specialRequestsFetcher.data, specialRequestsFetcher.state]);

  useEffect(() => {
    if (!prefFetcher.data || prefFetcher.state !== "idle") return;
    const data = prefFetcher.data as { ok?: boolean; error?: string; intent?: string };
    if (data.intent === "save-lalamove-preferences") {
      if (data.ok) {
        setPrefMessage(null);
        setPrefModalOpen(false);
        revalidator.revalidate();
      } else if (data.error) {
        setPrefMessage(data.error);
      }
    }
  }, [prefFetcher.data, prefFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const modalOpen = apiModalOpen || prefModalOpen;
    if (!modalOpen || !credentialStatusState.configured || configuredMarkets.length === 0) return;
    const formData = new FormData();
    formData.append("intent", "fetch-special-requests");
    configuredMarkets.forEach((m) => formData.append("market", m));
    formData.append("serviceType", preferredServiceTypeInput);
    specialRequestsFetcher.submit(formData, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiModalOpen, prefModalOpen]);

  const openAddZone = (index: number | null) => {
    setEditingZoneIndex(index);
    if (index != null && zones[index]) {
      const z = zones[index];
      setZoneName(z.name);
      setZoneRadius(String(z.radiusKm ?? z.radiusMiles ?? "10"));
      setZoneMinOrder(
        z.minOrderPriceSubunits != null
          ? String(z.minOrderPriceSubunits / 100)
          : "",
      );
      setZoneUseCarrierQuote(z.useCarrierQuote);
      setZoneCustomPrice(
        z.customPriceSubunits != null
          ? String(z.customPriceSubunits / 100)
          : "",
      );
      setZoneDilateValue(
        z.dilateTimeValue != null ? String(z.dilateTimeValue) : "",
      );
      setZoneDilateDimension(z.dilateTimeDimension ?? "days");
      setZoneDeliveryInfo("");
    } else {
      setZoneName("Local Delivery");
      setZoneRadius("10");
      setZoneMinOrder("");
      setZoneUseCarrierQuote(true);
      setZoneCustomPrice("");
      setZoneDilateValue("");
      setZoneDilateDimension("days");
      setZoneDeliveryInfo("");
    }
    setModalOpen(true);
  };

  const saveZone = () => {
    const radiusNum = parseFloat(zoneRadius.replace(",", "."));
    const minOrderSubunits = zoneMinOrder
      ? Math.round(parseFloat(zoneMinOrder.replace(",", ".")) * 100)
      : undefined;
    const customSubunits = zoneCustomPrice
      ? Math.round(parseFloat(zoneCustomPrice.replace(",", ".")) * 100)
      : undefined;
    const dilateVal =
      zoneDilateValue !== ""
        ? parseInt(zoneDilateValue, 10)
        : undefined;

    const newZone: DistanceZone = {
      name: zoneName,
      radiusKm: distanceUnit === "km" ? radiusNum : undefined,
      radiusMiles: distanceUnit === "mi" ? radiusNum : undefined,
      minOrderPriceSubunits: minOrderSubunits,
      useCarrierQuote: zoneUseCarrierQuote,
      customPriceSubunits: zoneUseCarrierQuote ? undefined : customSubunits,
      dilateTimeValue: dilateVal,
      dilateTimeDimension:
        dilateVal != null && dilateVal > 0 ? zoneDilateDimension : undefined,
    };

    if (editingZoneIndex != null && editingZoneIndex >= 0 && editingZoneIndex < zones.length) {
      setZones((prev) => {
        const next = [...prev];
        next[editingZoneIndex!] = newZone;
        return next;
      });
    } else {
      setZones((prev) => [...prev, newZone]);
    }
    setModalOpen(false);
    setEditingZoneIndex(null);
  };

  const removeZone = (index: number) => {
    setZones((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleProvider = (id: string) => {
    setEnabledProviders((prev) =>
      prev.includes(id)
        ? prev.filter((p) => p !== id)
        : [...prev, id],
    );
  };

  const configuredProviderIds = PROVIDERS
    .filter(({ id }) => id === "lalamove" && credentialStatusState.configured)
    .map(({ id }) => id);

  const allConfiguredChecked =
    configuredProviderIds.length > 0 &&
    configuredProviderIds.every((id) => enabledProviders.includes(id));

  const toggleAllConfigured = () => {
    if (allConfiguredChecked) {
      setEnabledProviders((prev) =>
        prev.filter((id) => !(configuredProviderIds as string[]).includes(id)),
      );
    } else {
      setEnabledProviders((prev) =>
        Array.from(new Set([...prev, ...configuredProviderIds])),
      );
    }
  };

  const saveConfig = () => {
    setActionError(null);
    const formData = new FormData();
    formData.append("intent", "save-config");
    formData.append("enabledProviders", JSON.stringify(enabledProviders));
    formData.append("timeLimit", timeLimit);
    formData.append("transitTime", transitTime);
    if (transitTime === "custom") {
      formData.append("customDays", String(customDays));
    }
    formData.append("distanceZones", JSON.stringify(zones));
    formData.append("distanceMethod", distanceMethod);
    formData.append("distanceUnit", distanceUnit);
    fetcher.submit(formData, { method: "post" });
  };

  const enableCarrier = () => {
    setActionError(null);
    const formData = new FormData();
    formData.append("intent", "enable-carrier");
    fetcher.submit(formData, { method: "post" });
  };

  const disableCarrier = () => {
    setActionError(null);
    const formData = new FormData();
    formData.append("intent", "disable-carrier");
    fetcher.submit(formData, { method: "post" });
  };

  const saveCredentials = () => {
    setCredentialMessage(null);
    const formData = new FormData();
    formData.append("intent", "save-lalamove-credentials");
    formData.append("apiKey", credentialsUnlocked ? apiKeyInput : "");
    formData.append("apiSecret", credentialsUnlocked ? apiSecretInput : "");
    formData.append("market", marketInput);
    credentialFetcher.submit(formData, { method: "post" });
  };

  const savePreferences = () => {
    setPrefMessage(null);
    const formData = new FormData();
    formData.append("intent", "save-lalamove-preferences");
    formData.append("preferredServiceType", preferredServiceTypeInput);
    formData.append("secondaryServiceType", secondaryServiceTypeInput);
    formData.append("maxOrdersPerRoute", maxOrdersPerRouteInput);
    formData.append("secondaryMaxOrdersPerRoute", secondaryMaxOrdersInput);
    const specialRequestsToSave: Record<string, string[]> = {};
    for (const [m, selected] of Object.entries(selectedSpecialRequests)) {
      specialRequestsToSave[m] = Array.from(selected);
    }
    formData.append("lalamoveSpecialRequests", JSON.stringify(specialRequestsToSave));
    prefFetcher.submit(formData, { method: "post" });
  };



  const deleteCredentials = () => {
    setCredentialMessage(null);
    const formData = new FormData();
    formData.append("intent", "delete-lalamove-credentials");
    credentialFetcher.submit(formData, { method: "post" });
    setApiKeyInput("");
    setApiSecretInput("");
  };

  const isFirstZone = editingZoneIndex === null || editingZoneIndex >= zones.length;
  const credentialActionOk =
    credentialFetcher.data &&
    typeof credentialFetcher.data === "object" &&
    "ok" in credentialFetcher.data &&
    credentialFetcher.data.ok;

  return (
    <>
        <s-stack direction="block" gap="base">
          {actionError && (
            <s-banner tone="critical" onDismiss={() => setActionError(null)}>
              {actionError}
            </s-banner>
          )}

          {carrierTab === "carriers" && (
            <>
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>{t("carrier.title")}</h2>
                <p>
                  {enabled
                    ? t("carrier.activeDescription")
                    : t("carrier.inactiveDescription")}
                </p>
                {enabled && (
                  <s-stack direction="block" gap="base">
                    <p style={{ fontSize: "13px", fontWeight: 600 }}>
                      {t("carrier.addToProfile")}
                    </p>
                    <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#6d7175" }}>
                      <li>{t("carrier.step1")}</li>
                      <li>{t("carrier.step2")}</li>
                      <li>{t("carrier.step3")}</li>
                    </ol>
                    <s-link
                      href={`https://${shop}/admin/settings/shipping`}
                      target="_blank"
                    >
                      {t("carrier.openSettings")}
                    </s-link>
                  </s-stack>
                )}
                {registration?.callbackUrl && (
                  <p style={{ fontSize: "13px", color: "#6d7175" }}>
                    {t("carrier.callbackUrl")} {registration.callbackUrl}
                  </p>
                )}
                <s-stack direction="inline" gap="base">
                  {enabled ? (
                    <s-button
                      variant="secondary"
                      onClick={disableCarrier}
                      disabled={fetcher.state !== "idle"}
                    >
                      {t("carrier.disableCarrier")}
                    </s-button>
                  ) : (
                    <s-button
                      variant="primary"
                      onClick={enableCarrier}
                      disabled={fetcher.state !== "idle"}
                    >
                      {t("carrier.enableCarrier")}
                    </s-button>
                  )}
                </s-stack>
                </s-stack>
              </s-box>
          </div>

          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>{t("parameters.title")}</h2>
            <h3 className={styles.subSectionTitle}>{t("parameters.timeOfDay")}</h3>
            <div className={styles.timePhraseRow}>
              <span>{t("parameters.ordersPlacedBefore")}</span>
              <s-select
                value={timeLimit}
                onChange={(e) =>
                  setTimeLimit((e.target as HTMLSelectElement).value)
                }
              >
                {TIME_OPTIONS.map((opt) => (
                  <s-option key={opt.value} value={opt.value}>
                    {opt.label}
                  </s-option>
                ))}
              </s-select>
              <span>{t("parameters.willBeDelivered")}</span>
              <s-select
                value={transitTime}
                onChange={(e) =>
                  setTransitTime(
                    (e.target as HTMLSelectElement).value as TimeRule["transitTime"],
                  )
                }
              >
                {TRANSIT_OPTIONS.map((opt) => (
                  <s-option key={opt.value} value={opt.value}>
                    {t(transitKeyMap[opt.value])}
                  </s-option>
                ))}
              </s-select>
              {transitTime === "custom" && (
                <s-text-field
                  value={String(customDays)}
                  onChange={(e) =>
                    setCustomDays(
                      parseInt((e.target as HTMLInputElement).value, 10) || 0,
                    )
                  }
                />
              )}
            </div>
            <p className={styles.explanatoryText}>
              {getExplanatoryTimeText(timeLimit, transitTime, customDays, t)}
            </p>
            <h3 className={styles.subSectionTitle}>{t("parameters.deliveryZones")}</h3>
            <div className={styles.stackBlock}>
              <div className={styles.stackInline}>
                <label>
                  <input
                    type="radio"
                    name="distanceMethod"
                    checked={distanceMethod === "postal_codes"}
                    onChange={() => setDistanceMethod("postal_codes")}
                  />
                  {t("parameters.usePostalCodes")}
                </label>
                <label>
                  <input
                    type="radio"
                    name="distanceMethod"
                    checked={distanceMethod === "radius"}
                    onChange={() => setDistanceMethod("radius")}
                  />
                  {t("parameters.setRadius")}
                </label>
              </div>
              {distanceMethod === "radius" && (
                <div className={styles.stackInline}>
                  <span>{t("parameters.measureRadiusIn")}</span>
                  <label>
                    <input
                      type="radio"
                      name="distanceUnit"
                      checked={distanceUnit === "km"}
                      onChange={() => setDistanceUnit("km")}
                    />
                    {t("distanceMethod.kmLabel")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="distanceUnit"
                      checked={distanceUnit === "mi"}
                      onChange={() => setDistanceUnit("mi")}
                    />
                    {t("distanceMethod.miLabel")}
                  </label>
                </div>
              )}
              <ul className={styles.zoneList}>
                {zones.map((zone, i) => (
                  <li key={i} className={styles.zoneItem}>
                    <div className={styles.zoneItemLeft}>
                      <span>{zoneSummary(zone, distanceUnit, t)}</span>
                      {zone.minOrderPriceSubunits != null &&
                        zone.minOrderPriceSubunits > 0 && (
                          <span style={{ fontSize: "13px", color: "#6d7175" }}>
                            {t("parameters.minOrder")} {(zone.minOrderPriceSubunits / 100).toFixed(2)}
                          </span>
                        )}
                    </div>
                    <div className={styles.zoneItemRight}>
                      <s-button
                        variant="secondary"
                        onClick={() => openAddZone(i)}
                      >
                        {t("edit")}
                      </s-button>
                      <s-button
                        variant="secondary"
                        onClick={() => removeZone(i)}
                        disabled={zones.length <= 1}
                      >
                        {t("remove")}
                      </s-button>
                    </div>
                  </li>
                ))}
              </ul>
              <span className={styles.addZoneBtn}>
              <s-button
                variant="secondary"
                onClick={() => openAddZone(zones.length)}
              >
                {t("parameters.addZone")}
              </s-button>
              </span>
            </div>
              </s-stack>
            </s-box>
          </div>
            </>
          )}

          {carrierTab === "providers" && (
            <>
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>{t("providers.title")}</h2>
            <s-banner>{t("providers.description")}</s-banner>
            <div className={styles.providerTableWrap}>
            <div className={styles.providerTable}>
              <div className={styles.providerTableHeader}>
                <span>
                  <input
                    type="checkbox"
                    checked={allConfiguredChecked}
                    onChange={toggleAllConfigured}
                    disabled={configuredProviderIds.length === 0}
                    aria-label={t("providers.selectAll")}
                  />
                </span>
                <span>{t("providers.tableProvider")}</span>
                <span style={{ textAlign: "center" }}>{t("providers.tableStatus")}</span>
                <span style={{ textAlign: "center" }}>{t("providers.tableCredentials")}</span>
                <span>{t("providers.tablePreferences")}</span>
                <span></span>
              </div>
              {PROVIDERS.map(({ id, label, available }) => {
                const isConfigured =
                  id === "lalamove" && credentialStatusState.configured;
                const statusOk = available && isConfigured;
                const hasPrefs = Boolean(config?.lalamovePreferredServiceType);
                const moreParts: string[] = [];
                if (id === "lalamove") {
                  if (config?.lalamoveSecondaryServiceType) {
                    moreParts.push(`Vehicle 2nd option: ${config.lalamoveSecondaryServiceType}`);
                  }
                  if (config?.lalamoveSecondaryMaxOrdersPerRoute) {
                    moreParts.push(`Max orders/route: ${config.lalamoveSecondaryMaxOrdersPerRoute}`);
                  }
                  const srKeys = Object.values(config?.lalamoveSpecialRequests ?? {}).flat();
                  if (srKeys.length > 0) moreParts.push(srKeys.join(" · "));
                }
                const moreLabel = moreParts.join(" | ");
                return (
                  <div key={id} className={styles.providerTableRow}>
                    <span>
                      <input
                        type="checkbox"
                        checked={enabledProviders.includes(id)}
                        onChange={() => toggleProvider(id)}
                        disabled={!available || !isConfigured}
                        aria-label={t("providers.enableProvider", { label })}
                      />
                    </span>
                    <span>{label}</span>
                    <span className={styles.providerStatusCell}>
                      {!available ? (
                        <span className={styles.providerComingSoon}>
                          {t("providers.comingSoon")}
                        </span>
                      ) : statusOk ? (
                        <span className={styles.providerStatusOk}>✓</span>
                      ) : (
                        <span className={styles.providerStatusUnknown}>?</span>
                      )}
                    </span>
                    <span className={styles.providerCredentialsCell}>
                      {!available ? (
                        <span>—</span>
                      ) : isConfigured ? (
                        <s-link
                          onClick={() => {
                            setCredentialMessage(null);
                            setCredentialsUnlocked(false);
                            setApiKeyInput("");
                            setApiSecretInput("");
                            setApiModalOpen(true);
                          }}
                        >
                          {apiKeyDisplayMask || "****"}
                        </s-link>
                      ) : (
                        <s-link
                          onClick={() => {
                            setCredentialMessage(null);
                            setCredentialsUnlocked(true);
                            setApiKeyInput("");
                            setApiSecretInput("");
                            setApiModalOpen(true);
                          }}
                        >
                          {t("providers.addCredentials")}
                        </s-link>
                      )}
                    </span>
                    <span className={styles.providerPreferencesCell}>
                      {id === "lalamove" && available ? (
                        <>
                          {config?.lalamovePreferredServiceType && (
                            <s-badge tone="neutral">
                              {`Vehicle: ${config.lalamovePreferredServiceType}`}
                            </s-badge>
                          )}
                          {config?.lalamoveMaxOrdersPerRoute && (
                            <s-badge tone="neutral">
                              {`Max orders/route: ${config.lalamoveMaxOrdersPerRoute}`}
                            </s-badge>
                          )}
                          {moreLabel && (
                            <span
                              ref={moreRef}
                              className={`${styles.prefMoreWrapper} ${moreExpanded ? styles.prefMoreExpanded : ""}`}
                              onClick={() => setMoreExpanded((v) => !v)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setMoreExpanded((v) => !v);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <span className={styles.prefMoreDots}>…</span>
                              <span className={styles.prefMoreTooltip}>{moreLabel}</span>
                            </span>
                          )}
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </span>
                    <span className={styles.providerActionCell}>
                      {id === "lalamove" && available && (
                        <span
                          className={styles.providerCogButton}
                          onClick={() => {
                            setPrefMessage(null);
                            setPrefModalOpen(true);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setPrefMessage(null);
                              setPrefModalOpen(true);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          title={hasPrefs
                            ? t("providers.updatePreferences")
                            : t("providers.definePreferences")}
                        >
                          ⚙️
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            </div>
              </s-stack>
            </s-box>
          </div>
            </>
          )}

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button
              variant="primary"
              onClick={saveConfig}
              disabled={fetcher.state !== "idle"}
            >
              {t("save")}
            </s-button>
          </s-stack>
        </s-stack>

      {modalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {editingZoneIndex != null && editingZoneIndex < zones.length
                  ? t("zoneModal.editZone")
                  : t("zoneModal.addZone")}
              </h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setModalOpen(false)}
                aria-label={t("close")}
              >
                &times;
              </button>
            </div>
            <div className={styles.modalBody}>
              <s-text-field
                label={t("zoneModal.zoneName")}
                value={zoneName}
                onChange={(e) =>
                  setZoneName((e.target as HTMLInputElement).value)
                }
              />
              {distanceMethod === "radius" && (
                <>
                  <s-text-field
                    label={t("zoneModal.radiusLabel", { unit: distanceUnit })}
                    value={zoneRadius}
                    onChange={(e) =>
                      setZoneRadius((e.target as HTMLInputElement).value)
                    }
                  />
                </>
              )}
              <s-text-field
                label={t("zoneModal.minOrderPrice")}
                value={zoneMinOrder}
                onChange={(e) =>
                  setZoneMinOrder((e.target as HTMLInputElement).value)
                }
              />
              <div>
                <span style={{ display: "block", marginBottom: 8 }}>
                  {t("zoneModal.deliveryPrice")}
                </span>
                <div className={styles.deliveryPriceRadioGroup}>
                  <label className={styles.deliveryPriceRadioRow}>
                    <input
                      type="radio"
                      name="zonePrice"
                      checked={zoneUseCarrierQuote}
                      onChange={() => setZoneUseCarrierQuote(true)}
                    />
                    {t("zoneModal.useCarrierQuote")}
                  </label>
                  <label className={styles.deliveryPriceRadioRow}>
                    <input
                      type="radio"
                      name="zonePrice"
                      checked={!zoneUseCarrierQuote}
                      onChange={() => setZoneUseCarrierQuote(false)}
                    />
                    {t("zoneModal.customPrice")}
                  </label>
                  {!zoneUseCarrierQuote && (
                    <s-text-field
                      label={t("zoneModal.customPrice")}
                      value={zoneCustomPrice}
                      onChange={(e) =>
                        setZoneCustomPrice((e.target as HTMLInputElement).value)
                      }
                    />
                  )}
                </div>
              </div>
              {!isFirstZone && (
                <div className={styles.dilateRow}>
                  <label>
                    <input
                      type="checkbox"
                      checked={zoneDilateValue !== "" && parseInt(zoneDilateValue, 10) > 0}
                      onChange={(e) => {
                        if (!e.target.checked) setZoneDilateValue("");
                      }}
                    />
                    {t("zoneModal.dilateLabel")}
                  </label>
                  <s-text-field
                    value={zoneDilateValue}
                    onChange={(e) =>
                      setZoneDilateValue((e.currentTarget as unknown as HTMLInputElement).value)
                    }
                  />
                  <s-select
                    value={zoneDilateDimension}
                    onChange={(e) =>
                      setZoneDilateDimension(
                        (e.currentTarget as unknown as HTMLSelectElement).value as
                          | "minutes"
                          | "hours"
                          | "days",
                      )
                    }
                  >
                    <s-option value="minutes">{t("zoneModal.dilateMinutes")}</s-option>
                    <s-option value="hours">{t("zoneModal.dilateHours")}</s-option>
                    <s-option value="days">{t("zoneModal.dilateDays")}</s-option>
                  </s-select>
                </div>
              )}
              <s-text-area
                label={t("zoneModal.deliveryInfo")}
                value={zoneDeliveryInfo}
                onChange={(e) =>
                  setZoneDeliveryInfo((e.target as HTMLTextAreaElement).value)
                }
                rows={3}
              />
            </div>
            <div className={styles.modalFooter}>
              <s-button variant="secondary" onClick={() => setModalOpen(false)}>
                {t("zoneModal.cancel")}
              </s-button>
              <s-button variant="primary" onClick={saveZone}>
                {t("zoneModal.save")}
              </s-button>
            </div>
          </div>
        </div>
      )}

      {apiModalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{t("lalamoveModal.credentialsTitle")}</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => {
                  setApiModalOpen(false);
                  setCredentialMessage(null);
                  setCredentialsUnlocked(false);
                  setApiKeyInput("");
                  setApiSecretInput("");
                }}
                aria-label={t("close")}
              >
                &times;
              </button>
            </div>
            <div className={styles.modalBody}>
              {credentialStatusState.configured && !credentialsUnlocked ? (
                <>
                  <s-text-field
                    label={t("lalamoveModal.apiKey")}
                    value={apiKeyDisplayMask || "****"}
                    disabled
                  />
                  <s-text-field
                    label={t("lalamoveModal.apiSecret")}
                    value="***********"
                    disabled
                  />
                </>
              ) : (
                <>
                  <s-text-field
                    label={t("lalamoveModal.apiKey")}
                    value={apiKeyInput}
                    onChange={(e) =>
                      setApiKeyInput((e.currentTarget as unknown as HTMLInputElement).value)
                    }
                  />
                  <s-text-field
                    label={t("lalamoveModal.apiSecret")}
                    value={apiSecretInput}
                    onChange={(e) =>
                      setApiSecretInput((e.currentTarget as unknown as HTMLInputElement).value)
                    }
                    autocomplete="off"
                  />
                </>
              )}
              <s-text-field
                label={t("lalamoveModal.market")}
                value={marketInput}
                onChange={(e) =>
                  setMarketInput(
                    ((e.currentTarget as unknown as HTMLInputElement).value as string)
                      .toUpperCase()
                      .trim()
                      .slice(0, 4),
                  )
                }
              />
              {credentialMessage ? (
                <s-banner
                  tone={credentialActionOk ? "info" : "critical"}
                  onDismiss={() => setCredentialMessage(null)}
                >
                  {credentialMessage}
                </s-banner>
              ) : null}
            </div>
            <div className={styles.modalFooter}>
              <s-button
                variant="secondary"
                onClick={() => {
                  setApiModalOpen(false);
                  setCredentialMessage(null);
                  setCredentialsUnlocked(false);
                  setApiKeyInput("");
                  setApiSecretInput("");
                }}
                disabled={credentialFetcher.state !== "idle"}
              >
                {t("lalamoveModal.cancel")}
              </s-button>
              {credentialStatusState.configured && !credentialsUnlocked && (
                <s-button
                  variant="secondary"
                  onClick={() => {
                    setCredentialsUnlocked(true);
                    setApiKeyInput("");
                    setApiSecretInput("");
                  }}
                  disabled={credentialFetcher.state !== "idle"}
                >
                  {t("lalamoveModal.editCredentials")}
                </s-button>
              )}
              {credentialStatusState.configured && (
                <s-button
                  variant="secondary"
                  tone="critical"
                  onClick={deleteCredentials}
                  disabled={credentialFetcher.state !== "idle"}
                >
                  {t("lalamoveModal.remove")}
                </s-button>
              )}
              <s-button
                variant="primary"
                onClick={saveCredentials}
                disabled={
                  credentialFetcher.state !== "idle" ||
                  (credentialsUnlocked && (!apiKeyInput.trim() || !apiSecretInput.trim()))
                }
              >
                {t("lalamoveModal.save")}
              </s-button>
            </div>
          </div>
        </div>
      )}

      {prefModalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{t("lalamoveModal.preferencesTitle")}</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => {
                  setPrefModalOpen(false);
                  setPrefMessage(null);
                }}
                aria-label={t("close")}
              >
                &times;
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.vehicleGrid}>
                <s-select
                  label={t("lalamoveModal.preferredVehicle")}
                  value={preferredServiceTypeInput}
                  onChange={(e) =>
                    setPreferredServiceTypeInput(
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
                <s-text-field
                  label={t("lalamoveModal.maxOrdersRoute")}
                  value={maxOrdersPerRouteInput}
                  onChange={(e) =>
                    setMaxOrdersPerRouteInput(
                      (e.currentTarget as unknown as HTMLInputElement).value,
                    )
                  }
                />
                <s-select
                  label={t("lalamoveModal.secondBestOption")}
                  value={secondaryServiceTypeInput}
                  onChange={(e) =>
                    setSecondaryServiceTypeInput(
                      (e.currentTarget as unknown as HTMLSelectElement).value,
                    )
                  }
                >
                  <s-option value="">{t("lalamoveModal.none")}</s-option>
                  {LALAMOVE_SERVICE_TYPES.map((opt) => (
                    <s-option key={opt.value} value={opt.value}>
                      {opt.label}
                    </s-option>
                  ))}
                </s-select>
                <s-text-field
                  label={t("lalamoveModal.maxOrdersRoute")}
                  value={secondaryMaxOrdersInput}
                  onChange={(e) =>
                    setSecondaryMaxOrdersInput(
                      (e.currentTarget as unknown as HTMLInputElement).value,
                    )
                  }
                />
              </div>
              {configuredMarkets.length > 0 && credentialStatusState.configured && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    {t("lalamoveModal.specialRequestsHeading")}
                  </p>
                  {specialRequestsFetcher.state !== "idle" ? (
                    <p style={{ fontSize: 13, color: "#6d7175" }}>{t("lalamoveModal.specialRequestsLoading")}</p>
                  ) : (
                    configuredMarkets.map((market) => {
                      const requests = specialRequestsByMarket[market] ?? [];
                      if (!requests.length) return null;
                      const thermalBagReqs = requests.filter((sr) =>
                        THERMAL_BAG_PATTERN.test(sr.description || sr.name),
                      );
                      // Group wait-time options by key prefix (not regex on the
                      // description), so mixed-language labels like "1 hr" don't
                      // fall through to `otherReqs`. Sort ascending by minutes.
                      const waitTimeReqs = requests
                        .map((sr) => {
                          if (!sr.name.startsWith(WAIT_TIME_KEY_PREFIX)) return null;
                          const parsed = parseWaitTimeKey(sr.name);
                          if (!parsed) return null;
                          return { sr, minutes: parsed.minutes };
                        })
                        .filter((x): x is { sr: typeof requests[number]; minutes: number } => x !== null)
                        .sort((a, b) => a.minutes - b.minutes);
                      const returnTripReqs = requests.filter((sr) =>
                        RETURN_TRIP_PATTERN.test(sr.description || sr.name),
                      );
                      const otherReqs = requests.filter(
                        (sr) =>
                          !THERMAL_BAG_PATTERN.test(sr.description || sr.name) &&
                          !sr.name.startsWith(WAIT_TIME_KEY_PREFIX) &&
                          !RETURN_TRIP_PATTERN.test(sr.description || sr.name),
                      );
                      const waitTimeEnabled = waitTimeReqs.some(
                        ({ sr }) => selectedSpecialRequests[market]?.has(sr.name),
                      );
                      const toggleSR = (srName: string, checked: boolean) => {
                        setSelectedSpecialRequests((prev) => {
                          const next = { ...prev };
                          const set = new Set(prev[market] ?? []);
                          if (checked) set.add(srName);
                          else set.delete(srName);
                          next[market] = set;
                          return next;
                        });
                      };
                      const toggleWaitTime = (checked: boolean) => {
                        setSelectedSpecialRequests((prev) => {
                          const next = { ...prev };
                          const set = new Set(prev[market] ?? []);
                          if (!checked) {
                            waitTimeReqs.forEach(({ sr }) => set.delete(sr.name));
                          }
                          next[market] = set;
                          return next;
                        });
                      };
                      const labelForWaitTime = (minutes: number): string => {
                        // Try explicit i18n key first (e.g. 30 → "Até 30 minutos").
                        // Fall back to the generic "Até X min" interpolation for
                        // any Lalamove key we haven't listed explicitly.
                        const key = `lalamoveModal.waitTimeOption.${minutes}`;
                        const translated = t(key, { defaultValue: "" });
                        if (translated) return translated;
                        return t("lalamoveModal.waitTimeOption.generic", { minutes });
                      };
                      return (
                        <div key={market}>
                          {configuredMarkets.length > 1 && (
                            <p style={{ fontSize: 12, color: "#6d7175", marginBottom: 4 }}>{market}</p>
                          )}
                          {thermalBagReqs.map((sr) => {
                            const checked = selectedSpecialRequests[market]?.has(sr.name) ?? false;
                            return (
                              <div
                                key={sr.name}
                                className={styles.checkboxToggle}
                                onClick={() => toggleSR(sr.name, !checked)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleSR(sr.name, !checked);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                              >
                                <s-checkbox
                                  checked={checked || undefined}
                                  onChange={() => toggleSR(sr.name, !checked)}
                                />
                                {sr.description || sr.name}
                              </div>
                            );
                          })}
                          {waitTimeReqs.length > 0 && (
                            <div>
                              <div
                                className={styles.checkboxToggle}
                                onClick={() => toggleWaitTime(!waitTimeEnabled)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleWaitTime(!waitTimeEnabled);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                              >
                                <s-checkbox
                                  checked={waitTimeEnabled || undefined}
                                  onChange={() => toggleWaitTime(!waitTimeEnabled)}
                                />
                                {t("lalamoveModal.waitTime")}
                              </div>
                              {waitTimeEnabled && (
                                <div className={styles.waitTimeOptions}>
                                  {waitTimeReqs.map(({ sr, minutes }) => {
                                    const checked = selectedSpecialRequests[market]?.has(sr.name) ?? false;
                                    return (
                                      <div
                                        key={sr.name}
                                        className={styles.checkboxToggle}
                                        onClick={() => toggleSR(sr.name, !checked)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            toggleSR(sr.name, !checked);
                                          }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                      >
                                        <s-checkbox
                                          checked={checked || undefined}
                                          onChange={() => toggleSR(sr.name, !checked)}
                                        />
                                        {labelForWaitTime(minutes)}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                          {returnTripReqs.map((sr) => {
                            const checked = selectedSpecialRequests[market]?.has(sr.name) ?? false;
                            return (
                              <div
                                key={sr.name}
                                className={styles.checkboxToggle}
                                onClick={() => toggleSR(sr.name, !checked)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleSR(sr.name, !checked);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                              >
                                <s-checkbox
                                  checked={checked || undefined}
                                  onChange={() => toggleSR(sr.name, !checked)}
                                />
                                {sr.description || sr.name}
                              </div>
                            );
                          })}
                          {otherReqs.map((sr) => {
                            const checked = selectedSpecialRequests[market]?.has(sr.name) ?? false;
                            return (
                              <div
                                key={sr.name}
                                className={styles.checkboxToggle}
                                onClick={() => toggleSR(sr.name, !checked)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleSR(sr.name, !checked);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                              >
                                <s-checkbox
                                  checked={checked || undefined}
                                  onChange={() => toggleSR(sr.name, !checked)}
                                />
                                {sr.description || sr.name}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
              {prefMessage ? (
                <s-banner tone="critical" onDismiss={() => setPrefMessage(null)}>
                  {prefMessage}
                </s-banner>
              ) : null}
            </div>
            <div className={styles.modalFooter}>
              <s-button
                variant="secondary"
                onClick={() => {
                  setPrefModalOpen(false);
                  setPrefMessage(null);
                }}
                disabled={prefFetcher.state !== "idle"}
              >
                {t("lalamoveModal.cancel")}
              </s-button>
              <s-button
                variant="primary"
                onClick={savePreferences}
                disabled={prefFetcher.state !== "idle"}
              >
                {t("lalamoveModal.save")}
              </s-button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function CarrierServiceRoute() {
  const data = useLoaderData<typeof loader>() as CarrierServiceLoaderData;
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const isProvidersPath = location.pathname.includes("/providers");
  const activeTab = (tabParam === "providers" || isProvidersPath
    ? "providers"
    : "carriers") as "providers" | "carriers";

  return (
    <s-page heading="Carrier Service" inlineSize="base">
      <s-section>
        <CarrierServiceContent data={data} activeTab={activeTab} />
      </s-section>
    </s-page>
  );
}
