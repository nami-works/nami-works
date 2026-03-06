import { useState, useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { loadGoogleMaps } from "../utils/load-google-maps.client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TabBar } from "../components/tab-bar";
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

  return {
    locations,
    lalamoveConfigs,
    userLocale,
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-lalamove-settings") {
    const locationId = formData.get("locationId");
    if (typeof locationId !== "string" || !locationId) {
      return { ok: false, error: "Location not provided." };
    }
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
      ).catch((e) => console.warn("Sample rate build failed:", e));
    }
    return { ok: true };
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
});

export default function LocationSettings() {
  const {
    locations,
    lalamoveConfigs,
    userLocale,
    mapsApiKey,
  } = useLoaderData<typeof loader>();
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
      ...defaultConfig(userLocale),
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

  const updateField = (field: keyof LalamoveConfig, value: string) => {
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
    lalamoveFetcher.submit(formData, { method: "post" });
  };

  return (
    <s-page heading="Settings" inlineSize="base">
      <TabBar
        tabs={tabs}
        activeId="settings"
        className={styles.tabsRow}
        tabClassName={styles.tabItem}
        activeTabClassName={styles.tabActive}
        contentClassName={styles.tabContent}
        iconClassName={styles.tabIcon}
        activeIconClassName={styles.tabIconActive}
      />
      <s-section>
        <s-stack direction="block" gap="base">
          {saveError && (
            <s-banner tone="critical" onDismiss={() => setSaveError(null)}>
              {saveError}
            </s-banner>
          )}
          {saveSuccess && (
            <s-banner tone="success" onDismiss={() => setSaveSuccess(false)}>
              Location settings saved successfully.
            </s-banner>
          )}
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>Location settings</h2>
                <div className={styles.settingsGrid}>
            <s-select
              label="Location"
              name="settingsLocationId"
              value={settingsLocationId}
              onChange={(event) =>
                setSettingsLocationId(
                  (event.currentTarget as HTMLSelectElement).value,
                )
              }
            >
              <s-option value="">-select a location-</s-option>
              {locations.map((loc: { id: string; name: string }) => (
                <s-option key={loc.id} value={loc.id}>
                  {loc.name}
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Market"
              name="market"
              value={lalamoveSettings.market}
              onChange={(e) =>
                updateField(
                  "market",
                  (e.currentTarget as HTMLSelectElement).value,
                )
              }
            >
              <s-option value="">-select market-</s-option>
              {LALAMOVE_MARKETS.map((opt) => (
                <s-option key={opt.value} value={opt.value}>
                  {opt.label}
                </s-option>
              ))}
            </s-select>
            <s-text-field
              label="City"
              value={lalamoveSettings.city}
              disabled
            />
            <div />
            <s-text-field
              label="Location name"
              value={lalamoveSettings.locationName}
              onChange={(e) =>
                updateField(
                  "locationName",
                  (e.currentTarget as HTMLInputElement).value,
                )
              }
            />
            <s-text-field
              label="Location phone"
              value={lalamoveSettings.locationPhone}
              onChange={(e) =>
                updateField(
                  "locationPhone",
                  (e.currentTarget as HTMLInputElement).value,
                )
              }
            />
            <div ref={locationAddressFieldRef}>
              <s-text-field
                label="Location address"
                value={lalamoveSettings.locationAddress}
                onChange={(e) =>
                  updateField(
                    "locationAddress",
                    (e.currentTarget as HTMLInputElement).value,
                  )
                }
              />
            </div>
            <s-text-field
              label="Location details (store number, etc)"
              value={lalamoveSettings.locationDetails}
              onChange={(e) =>
                updateField(
                  "locationDetails",
                  (e.currentTarget as HTMLInputElement).value,
                )
              }
            />
            <div
              className={`${styles.settingsSpanFull} ${styles.settingsPickupInstructionsWrap}`}
            >
              <s-text-area
                label="Pickup instructions"
                value={lalamoveSettings.pickupInstructions}
                onChange={(e) =>
                  updateField(
                    "pickupInstructions",
                    (e.currentTarget as HTMLTextAreaElement).value,
                  )
                }
                rows={4}
              />
            </div>
            <div className={`${styles.settingsSpanFull} ${styles.settingsHidden}`}>
              <s-select
                label="Preferred service type"
                name="preferredServiceType"
                value={lalamoveSettings.preferredServiceType}
                onChange={(e) =>
                  updateField(
                    "preferredServiceType",
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
            </div>
                </div>
              </s-stack>
            </s-box>
          </div>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-link href="../local-delivery">
              <s-button variant="secondary">
                {settingsSaved ? "Back" : "Cancel"}
              </s-button>
            </s-link>
            <s-button
              variant="primary"
              onClick={saveLocationSettings}
              disabled={
                lalamoveFetcher.state !== "idle" || !settingsLocationId
              }
            >
              Save settings
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
