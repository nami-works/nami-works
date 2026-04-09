import { useState, useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
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
  buildCarrierCallbackUrl,
  createCarrierService,
  deleteCarrierService,
  getCarrierRegistration,
} from "../services/carrier/registration.server";
import { buildAllSampleRatesForShop } from "../services/carrier/sample-rate-db.server";
import type { CarrierServiceConfigData } from "../services/carrier/types";
import {
  CarrierServiceContent,
  type CarrierServiceLoaderData,
} from "./app.carrier-service";
import styles from "./app.settings/styles.module.css";

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

  console.info(`[settings] loader OK shop=${shop} locations=${locations.length}`);

  return {
    locations,
    lalamoveConfigs,
    userLocale,
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "",
    appIdentity,
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
      timeRule: timeLimit && transitTime ? { timeLimit, transitTime: transitTime as any, ...(transitTime === "custom" && Number.isInteger(customDays) ? { customDays } : {}) } : undefined,
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
    userLocale,
    mapsApiKey,
    appIdentity,
    carrierServiceData,
  } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<SettingsTab>("settings");
  const { t } = useTranslation("settings");
  const lalamoveFetcher = useFetcher();
  const [settingsLocationId, setSettingsLocationId] = useState("");
  const locationAddressFieldRef = useRef<HTMLDivElement | null>(null);
  const locationAddressAutocompleteRef = useRef<any>(null);
  const locationAddressInputListenerRef = useRef<((event: Event) => void) | null
    >(null);
  const [lalamoveSettings, setLalamoveSettings] = useState<LalamoveConfig>(
    () => defaultConfig(userLocale ?? "pt_BR"),
  );
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const allTabs: { id: SettingsTab; label: string }[] = [
    { id: "settings", label: t("tabs.locations") },
    { id: "providers", label: t("tabs.providers") },
    { id: "carriers", label: t("tabs.carriers") },
  ];
  const tabs = appIdentity === "omnify"
    ? allTabs.filter((tab) => tab.id !== "carriers")
    : allTabs;

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
        locationAddressAutocompleteRef.current = new Autocomplete(input, {
          fields: ["formatted_address", "name"],
        });
        locationAddressAutocompleteRef.current.addListener(
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

  return (
    <s-page heading={t("pageHeading")} inlineSize="base">
      <s-section>
        <div className={styles.settingsTabsRow}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`${styles.settingsTab}${tab.id === activeTab ? ` ${styles.settingsTabActive}` : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
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
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>{t("locationSettings.title")}</h2>
                <div className={styles.settingsGrid}>
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
              <s-option value="">{t("locationSettings.selectLocation")}</s-option>
              {locations.map((loc: { id: string; name: string }) => (
                <s-option key={loc.id} value={loc.id}>
                  {loc.name}
                </s-option>
              ))}
            </s-select>
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
            <div />
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

            {/* ── Auto-Delivery Schedule ──────────────────────────────── */}
            <div className={styles.settingsSpanFull} style={{ borderTop: "1px solid #e1e3e5", paddingTop: 16, marginTop: 8 }}>
              <s-stack direction="block" gap="base">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

                <div className={styles.settingsGrid}>
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
                  <s-text-field
                    label={t("labels.timezone")}
                    value={lalamoveSettings.timezone ?? ""}
                    {...{ placeholder: Intl.DateTimeFormat().resolvedOptions().timeZone } as Record<string, string>}
                    onChange={(e) =>
                      updateField("timezone", (e.currentTarget as unknown as HTMLInputElement).value)
                    }
                  />
                </div>

                {lalamoveSettings.autoDeliveryEnabled ? (
                  <div className={styles.settingsGrid}>
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
              </s-stack>
            </div>
                </div>
              </s-stack>
            </s-box>
          </div>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-link href="../local-delivery">
              <s-button variant="secondary">
                {settingsSaved ? t("common:button.back") : t("common:button.cancel")}
              </s-button>
            </s-link>
            {lalamoveFetcher.state !== "idle" ? (
              <s-button key="save-loading" variant="primary" loading disabled>
                {t("locationSettings.saveSettings")}
              </s-button>
            ) : !settingsLocationId ? (
              <s-button key="save-disabled" variant="primary" disabled>
                {t("locationSettings.saveSettings")}
              </s-button>
            ) : (
              <s-button key="save-active" variant="primary" onClick={saveLocationSettings}>
                {t("locationSettings.saveSettings")}
              </s-button>
            )}
          </s-stack>
        </s-stack>
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
