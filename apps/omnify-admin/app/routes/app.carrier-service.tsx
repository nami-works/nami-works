import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useMatches, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  deleteShopCredentials,
  getApiKeyDisplayMask,
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
import { TabBar } from "../components/tab-bar";
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

  const registration = await getCarrierRegistration(shop);
  const configRow = await prisma.carrierServiceConfig.findUnique({
    where: { shop },
  });
  const config = configRow?.data as CarrierServiceConfigData | undefined;
  const [credentialStatus, apiKeyDisplayMask] = await Promise.all([
    hasShopCredentials(shop),
    getApiKeyDisplayMask(shop),
  ]);

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
        }).catch((e) => console.warn("Sample rate build failed:", e));
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
      }).catch((e) => console.warn("Sample rate build failed:", e));
      return { ok: true, error: null };
    }

    if (intent === "save-lalamove-credentials") {
      const validated = validateCredentialInput(
        formData.get("apiKey"),
        formData.get("apiSecret"),
      );
      if (!validated.ok) {
        return { ok: false, error: validated.error };
      }
      await saveShopCredentials(shop, validated.apiKey, validated.apiSecret);
      const preferredServiceType =
        String(formData.get("preferredServiceType") ?? "").trim() || "LALAGO";
      const market =
        String(formData.get("market") ?? "").trim().toUpperCase() || "BR";
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
      const configRow = await prisma.carrierServiceConfig.findUnique({
        where: { shop },
      });
      const existing = (configRow?.data ?? {}) as CarrierServiceConfigData;
      const data: CarrierServiceConfigData = {
        ...existing,
        enabledProviders: existing.enabledProviders ?? ["lalamove"],
        lalamovePreferredServiceType: preferredServiceType,
        lalamoveDefaultMarket: market,
        lalamoveSecondaryServiceType: secondaryServiceType,
        lalamoveMaxOrdersPerRoute: maxOrdersPerRoute,
        lalamoveSecondaryMaxOrdersPerRoute: secondaryMaxOrdersPerRoute,
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
  customDays?: number,
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
  const dateStr = byDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Orders placed on ${dateStr} before ${limitLabel} will be promised for delivery by ${dateStr}.`;
}

function zoneSummary(zone: DistanceZone, unit: "km" | "mi"): string {
  const u = unit === "km" ? "km" : "mi";
  const r = zone.radiusKm ?? (zone.radiusMiles ? zone.radiusMiles + " " + u : "");
  const radiusStr =
    typeof r === "number" ? `Up to ${r} ${u}` : (zone.radiusMiles ? `Up to ${zone.radiusMiles} ${u}` : "—");
  if (zone.useCarrierQuote) return `${radiusStr} • Carrier default quotes`;
  const price =
    zone.customPriceSubunits != null
      ? (zone.customPriceSubunits / 100).toFixed(2)
      : "—";
  let s = `${radiusStr} • Custom price = ${price}`;
  if (
    zone.dilateTimeValue != null &&
    zone.dilateTimeValue > 0 &&
    zone.dilateTimeDimension
  ) {
    s += ` • Delivery time dilated by ${zone.dilateTimeValue} ${zone.dilateTimeDimension}`;
  }
  return s;
}

const defaultZone = (): DistanceZone => ({
  name: "Local Delivery",
  radiusKm: 10,
  useCarrierQuote: true,
});

export default function CarrierService() {
  const { shop, registration, config, credentialStatus, apiKeyDisplayMask } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const credentialFetcher = useFetcher<typeof action>();
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
  const [searchParams] = useSearchParams();
  const carrierTab = (searchParams.get("tab") === "providers" ? "providers" : "carriers") as "providers" | "carriers";
  const matches = useMatches();
  const basePath =
    (matches.find((m) => (m as { data?: { basePath?: string } }).data?.basePath !== undefined)
      ?.data as { basePath?: string })?.basePath ?? "";
  const path = (p: string) => `${basePath}${p}`.replace(/\/+/g, "/") || "/";
  const tabs = [
    {
      id: "settings",
      label: "Locations",
      href: "/app/settings",
      icon: <span aria-hidden="true">📍</span>,
    },
    {
      id: "providers",
      label: "Providers",
      href: "/app/carrier-service?tab=providers",
      icon: <span aria-hidden="true">🛵</span>,
    },
    {
      id: "carriers",
      label: "Carriers",
      href: "/app/carrier-service?tab=carriers",
      icon: <span aria-hidden="true">🚚</span>,
    },
  ];

  useEffect(() => {
    if (registration?.active !== undefined) setEnabled(!!registration.active);
  }, [registration?.active]);

  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle") return;
    const data = fetcher.data as { ok?: boolean; error?: string };
    const currentIntent = fetcher.formData?.get("intent");
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
      setCredentialMessage(warning || "Credentials processed successfully.");
      // Auto-close modal and clear sensitive inputs on successful save
      if (credentialFetcher.formData?.get("intent") === "save-lalamove-credentials") {
        setApiModalOpen(false);
        setApiKeyInput("");
        setApiSecretInput("");
      }
      return;
    }
    if (data.error) {
      setCredentialMessage(data.error);
    }
  }, [credentialFetcher.data, credentialFetcher.state, credentialStatus]);

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
    formData.append("apiKey", apiKeyInput);
    formData.append("apiSecret", apiSecretInput);
    formData.append("preferredServiceType", preferredServiceTypeInput);
    formData.append("secondaryServiceType", secondaryServiceTypeInput);
    formData.append("maxOrdersPerRoute", maxOrdersPerRouteInput);
    formData.append("secondaryMaxOrdersPerRoute", secondaryMaxOrdersInput);
    credentialFetcher.submit(formData, { method: "post" });
  };

  const testCredentials = () => {
    setCredentialMessage(null);
    const formData = new FormData();
    formData.append("intent", "test-lalamove-credentials");
    formData.append("apiKey", apiKeyInput);
    formData.append("apiSecret", apiSecretInput);
    formData.append("market", marketInput);
    credentialFetcher.submit(formData, { method: "post" });
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
    <s-page heading="Settings" inlineSize="base">
      <TabBar
        tabs={tabs}
        activeId={carrierTab}
        className={styles.tabsRow}
        tabClassName={styles.tabItem}
        activeTabClassName={styles.tabActive}
        contentClassName={styles.tabContent}
        iconClassName={styles.tabIcon}
        activeIconClassName={styles.tabIconActive}
      />
      <s-section>
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
                <h2 className={styles.modalTitle}>Carrier service</h2>
                <p>
                  {enabled
                    ? "Carrier service is active. Shopify will request shipping rates from your callback when customers reach checkout."
                    : "Enable the carrier service to offer local delivery rates (Lalamove, Loggi, Uber, Rappi) at checkout."}
                </p>
                {enabled && (
                  <s-stack direction="block" gap="base">
                    <p style={{ fontSize: "13px", fontWeight: 600 }}>
                      Add Omnify to your delivery profile:
                    </p>
                    <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#6d7175" }}>
                      <li>Go to Settings &gt; Delivery and pick-up</li>
                      <li>Edit the relevant profile and zone</li>
                      <li>Add rate &gt; Get rates from app &gt; select Omnify Local Delivery</li>
                    </ol>
                    <s-link
                      href={`https://${shop}/admin/settings/shipping`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Delivery settings
                    </s-link>
                  </s-stack>
                )}
                {registration?.callbackUrl && (
                  <p style={{ fontSize: "13px", color: "#6d7175" }}>
                    Callback URL: {registration.callbackUrl}
                  </p>
                )}
                <s-stack direction="inline" gap="base">
                  {enabled ? (
                    <s-button
                      variant="secondary"
                      onClick={disableCarrier}
                      disabled={fetcher.state !== "idle"}
                    >
                      Disable carrier service
                    </s-button>
                  ) : (
                    <s-button
                      variant="primary"
                      onClick={enableCarrier}
                      disabled={fetcher.state !== "idle"}
                    >
                      Enable carrier service
                    </s-button>
                  )}
                </s-stack>
                </s-stack>
              </s-box>
          </div>

          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>Parameters</h2>
            <h3 className={styles.subSectionTitle}>Time of the day</h3>
            <div className={styles.timePhraseRow}>
              <span>Orders placed before</span>
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
              <span>will be delivered</span>
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
                    {opt.label}
                  </s-option>
                ))}
              </s-select>
              {transitTime === "custom" && (
                <s-text-field
                  type="number"
                  value={String(customDays)}
                  onChange={(e) =>
                    setCustomDays(
                      parseInt((e.target as HTMLInputElement).value, 10) || 0,
                    )
                  }
                  min={1}
                />
              )}
            </div>
            <p className={styles.explanatoryText}>
              {getExplanatoryTimeText(timeLimit, transitTime, customDays)}
            </p>
            <h3 className={styles.subSectionTitle}>Delivery zones</h3>
            <div className={styles.stackBlock}>
              <div className={styles.stackInline}>
                <label>
                  <input
                    type="radio"
                    name="distanceMethod"
                    checked={distanceMethod === "postal_codes"}
                    onChange={() => setDistanceMethod("postal_codes")}
                  />
                  Use postal codes
                </label>
                <label>
                  <input
                    type="radio"
                    name="distanceMethod"
                    checked={distanceMethod === "radius"}
                    onChange={() => setDistanceMethod("radius")}
                  />
                  Set a delivery radius
                </label>
              </div>
              {distanceMethod === "radius" && (
                <div className={styles.stackInline}>
                  <span>Measure radius in</span>
                  <label>
                    <input
                      type="radio"
                      name="distanceUnit"
                      checked={distanceUnit === "km"}
                      onChange={() => setDistanceUnit("km")}
                    />
                    km
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="distanceUnit"
                      checked={distanceUnit === "mi"}
                      onChange={() => setDistanceUnit("mi")}
                    />
                    mi
                  </label>
                </div>
              )}
              <ul className={styles.zoneList}>
                {zones.map((zone, i) => (
                  <li key={i} className={styles.zoneItem}>
                    <div className={styles.zoneItemLeft}>
                      <span>{zoneSummary(zone, distanceUnit)}</span>
                      {zone.minOrderPriceSubunits != null &&
                        zone.minOrderPriceSubunits > 0 && (
                          <span style={{ fontSize: "13px", color: "#6d7175" }}>
                            Min. order: {(zone.minOrderPriceSubunits / 100).toFixed(2)}
                          </span>
                        )}
                    </div>
                    <div className={styles.zoneItemRight}>
                      <s-button
                        variant="secondary"
                        onClick={() => openAddZone(i)}
                      >
                        Edit
                      </s-button>
                      <s-button
                        variant="secondary"
                        onClick={() => removeZone(i)}
                        disabled={zones.length <= 1}
                      >
                        Remove
                      </s-button>
                    </div>
                  </li>
                ))}
              </ul>
              <s-button
                variant="secondary"
                className={styles.addZoneBtn}
                onClick={() => openAddZone(zones.length)}
              >
                + Add zone
              </s-button>
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
                <h2 className={styles.modalTitle}>Delivery providers</h2>
            <p>Choose which delivery platforms to request quotes from. The cheapest rate is shown at checkout.</p>
            <div className={styles.providerTable}>
              <div className={styles.providerTableHeader}>
                <span>
                  <input
                    type="checkbox"
                    checked={allConfiguredChecked}
                    onChange={toggleAllConfigured}
                    disabled={configuredProviderIds.length === 0}
                    aria-label="Select all configured providers"
                  />
                </span>
                <span>Provider</span>
                <span>Status</span>
                <span>API key</span>
                <span>{/* no header for Configure column */}</span>
              </div>
              {PROVIDERS.map(({ id, label, available }) => {
                const isConfigured =
                  id === "lalamove" && credentialStatusState.configured;
                const statusOk = available && isConfigured;
                const apiKeyDisplay =
                  id === "lalamove"
                    ? isConfigured
                      ? apiKeyDisplayMask || "Configured"
                      : "—"
                    : "—";
                return (
                  <div key={id} className={styles.providerTableRow}>
                    <span>
                      <input
                        type="checkbox"
                        checked={enabledProviders.includes(id)}
                        onChange={() => toggleProvider(id)}
                        aria-label={`Enable ${label}`}
                      />
                    </span>
                    <span>{label}</span>
                    <span className={styles.providerStatusCell}>
                      <span
                        className={
                          statusOk
                            ? styles.providerStatusOk
                            : styles.providerStatusFail
                        }
                      >
                        {statusOk ? "✓" : "✗"}
                      </span>
                    </span>
                    <span>{apiKeyDisplay}</span>
                    {available ? (
                      <span>
                        <s-link
                          onClick={() => {
                            setCredentialMessage(null);
                            setApiModalOpen(true);
                          }}
                        >
                          {isConfigured
                            ? "Update provider"
                            : "Configure provider"}
                        </s-link>
                      </span>
                    ) : (
                      <span className={styles.providerComingSoon}>
                        Coming soon
                      </span>
                    )}
                  </div>
                );
              })}
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
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {modalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {editingZoneIndex != null && editingZoneIndex < zones.length
                  ? "Edit zone"
                  : "Add zone"}
              </h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className={styles.modalBody}>
              <s-text-field
                label="Zone name"
                value={zoneName}
                onChange={(e) =>
                  setZoneName((e.target as HTMLInputElement).value)
                }
              />
              {distanceMethod === "radius" && (
                <>
                  <s-text-field
                    label={`Delivery radius up to (${distanceUnit})`}
                    value={zoneRadius}
                    onChange={(e) =>
                      setZoneRadius((e.target as HTMLInputElement).value)
                    }
                  />
                </>
              )}
              <s-text-field
                label="Minimum order price"
                value={zoneMinOrder}
                onChange={(e) =>
                  setZoneMinOrder((e.target as HTMLInputElement).value)
                }
              />
              <div>
                <span style={{ display: "block", marginBottom: 8 }}>
                  Delivery price
                </span>
                <div className={styles.deliveryPriceRadioGroup}>
                  <label className={styles.deliveryPriceRadioRow}>
                    <input
                      type="radio"
                      name="zonePrice"
                      checked={zoneUseCarrierQuote}
                      onChange={() => setZoneUseCarrierQuote(true)}
                    />
                    Use carrier quote
                  </label>
                  <label className={styles.deliveryPriceRadioRow}>
                    <input
                      type="radio"
                      name="zonePrice"
                      checked={!zoneUseCarrierQuote}
                      onChange={() => setZoneUseCarrierQuote(false)}
                    />
                    Custom price
                  </label>
                  {!zoneUseCarrierQuote && (
                    <s-text-field
                      label="Custom price"
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
                    Dilate default delivery time by:
                  </label>
                  <s-text-field
                    type="number"
                    value={zoneDilateValue}
                    onChange={(e) =>
                      setZoneDilateValue((e.target as HTMLInputElement).value)
                    }
                    min={0}
                  />
                  <s-select
                    value={zoneDilateDimension}
                    onChange={(e) =>
                      setZoneDilateDimension(
                        (e.target as HTMLSelectElement).value as
                          | "minutes"
                          | "hours"
                          | "days",
                      )
                    }
                  >
                    <s-option value="minutes">minutes</s-option>
                    <s-option value="hours">hours</s-option>
                    <s-option value="days">days</s-option>
                  </s-select>
                </div>
              )}
              <s-text-area
                label="Delivery information"
                value={zoneDeliveryInfo}
                onChange={(e) =>
                  setZoneDeliveryInfo((e.target as HTMLTextAreaElement).value)
                }
                rows={3}
              />
            </div>
            <div className={styles.modalFooter}>
              <s-button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </s-button>
              <s-button variant="primary" onClick={saveZone}>
                Save
              </s-button>
            </div>
          </div>
        </div>
      )}

      {apiModalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Lalamove preferences</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => {
                  setApiModalOpen(false);
                  setCredentialMessage(null);
                  setApiKeyInput("");
                  setApiSecretInput("");
                  setMarketInput("BR");
                }}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.statusText}>
                Secrets are encrypted at rest and never returned to the UI after saving.
              </p>
              <s-text-field
                label="Lalamove API key"
                value={apiKeyInput}
                onChange={(e) =>
                  setApiKeyInput((e.currentTarget as HTMLInputElement).value)
                }
              />
              <s-text-field
                label="Lalamove API secret"
                type="password"
                value={apiSecretInput}
                onChange={(e) =>
                  setApiSecretInput((e.currentTarget as HTMLInputElement).value)
                }
                autoComplete="off"
              />
              <s-text-field
                label="Market"
                value={marketInput}
                onChange={(e) =>
                  setMarketInput(
                    ((e.currentTarget as HTMLInputElement).value as string)
                      .toUpperCase()
                      .trim()
                      .slice(0, 4),
                  )
                }
              />
              <div className={styles.vehicleGrid}>
                <s-select
                  label="Preferred vehicle"
                  value={preferredServiceTypeInput}
                  onChange={(e) =>
                    setPreferredServiceTypeInput(
                      (e.currentTarget as HTMLSelectElement).value,
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
                  label="Max orders/route"
                  type="number"
                  min="1"
                  max="15"
                  value={maxOrdersPerRouteInput}
                  onChange={(e) =>
                    setMaxOrdersPerRouteInput(
                      (e.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
                <s-select
                  label="2nd best option"
                  value={secondaryServiceTypeInput}
                  onChange={(e) =>
                    setSecondaryServiceTypeInput(
                      (e.currentTarget as HTMLSelectElement).value,
                    )
                  }
                >
                  <s-option value="">— none —</s-option>
                  {LALAMOVE_SERVICE_TYPES.map((opt) => (
                    <s-option key={opt.value} value={opt.value}>
                      {opt.label}
                    </s-option>
                  ))}
                </s-select>
                <s-text-field
                  label="Max orders/route"
                  type="number"
                  min="1"
                  max="15"
                  value={secondaryMaxOrdersInput}
                  onChange={(e) =>
                    setSecondaryMaxOrdersInput(
                      (e.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </div>
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
                  setApiKeyInput("");
                  setApiSecretInput("");
                  setMarketInput("BR");
                }}
                disabled={credentialFetcher.state !== "idle"}
              >
                Cancel
              </s-button>
              <s-button
                variant="secondary"
                tone="critical"
                onClick={deleteCredentials}
                disabled={credentialFetcher.state !== "idle"}
              >
                Remove
              </s-button>
              <s-button
                variant="primary"
                onClick={saveCredentials}
                disabled={credentialFetcher.state !== "idle"}
              >
                Save
              </s-button>
              <s-button
                variant="secondary"
                onClick={testCredentials}
                disabled={credentialFetcher.state !== "idle"}
              >
                Verify
              </s-button>
            </div>
          </div>
        </div>
      )}
    </s-page>
  );
}
