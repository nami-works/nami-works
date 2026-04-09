import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import {
  getMainTheme,
  getThemeSettingsAndSchema,
  extractSettingsValues,
  themeIdToNumeric,
} from "../services/merchandising/theme.server";
import {
  scanPromoSettings,
  clearScanCache,
  type PromoScanResult,
} from "../services/merchandising/promo-scanner.server";
import {
  fetchAllActiveDiscounts,
  toPromoScannerFormat,
  type DiscountNode,
} from "../services/merchandising/discounts.server";
import { fetchOrderStats } from "../services/merchandising/order-stats.server";
import {
  computeStats,
  getDateRange,
  type OrderStatsRaw,
  type ComputedStats,
} from "../services/merchandising/order-stats-shared";
import styles from "./app.merchandising/styles.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThemeSettingField {
  key: string;
  label: string;
  value: string;
  type: string;
  section: string;
}

// Known promotional setting keys to surface
const PROMO_SETTING_KEYS = new Set([
  "promotional_bar_pdp_text",
  "free_shipping_min_amount",
  "free_shipping_text",
  "show_promo_bar_progress",
  "promo_bar_min_amount",
  "promo_bar_text",
]);

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  console.info(`[merchandising:overview] loader START shop=${shop}`);

  // ── Theme settings ──────────────────────────────────────────────
  let themeSettings: {
    themeId: string;
    themeNumericId: string;
    themeName: string;
    fields: ThemeSettingField[];
    settingsValues: Record<string, unknown>;
    settingsSchema: { name: string; settings: { id: string; label: string; type: string }[] }[];
  } | null = null;
  let themeScopeError = false;

  try {
    const theme = await getMainTheme(admin);
    if (theme) {
      const { settingsData, settingsSchema } = await getThemeSettingsAndSchema(admin, theme.id);
      if (settingsData) {
        const values = extractSettingsValues(settingsData);
        const fields: ThemeSettingField[] = [];

        for (const section of settingsSchema) {
          for (const setting of section.settings) {
            if (PROMO_SETTING_KEYS.has(setting.id)) {
              fields.push({
                key: setting.id,
                label: setting.label,
                value: String(values[setting.id] ?? ""),
                type: setting.type,
                section: section.name,
              });
            }
          }
        }

        themeSettings = {
          themeId: theme.id,
          themeNumericId: themeIdToNumeric(theme.id),
          themeName: theme.name,
          fields,
          settingsValues: values,
          settingsSchema,
        };
        console.info(`[merchandising:overview] loader → theme="${theme.name}" promoFields=${fields.length}`);
      }
    }
  } catch (err) {
    console.error("[merchandising:overview] loader → theme API failed:", err instanceof Error ? err.message : err);
    themeScopeError = true;
  }

  // ── Active discounts ────────────────────────────────────────────
  let discounts: DiscountNode[] = [];
  let discountError = false;
  try {
    discounts = await fetchAllActiveDiscounts(admin);
  } catch (err) {
    console.error("[merchandising:overview] loader → discount fetch failed:", err instanceof Error ? err.message : err);
    discountError = true;
  }

  // ── Order stats ──────────────────────────────────────────────────
  let orderStats: OrderStatsRaw | null = null;
  let hasOrderScope = true;
  try {
    const { startDate, endDate } = getDateRange(30);
    orderStats = await fetchOrderStats(admin, startDate, endDate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[merchandising:overview] loader → order stats failed:", msg);
    if (msg.includes("access") || msg.includes("scope") || msg.includes("permission")) {
      hasOrderScope = false;
    }
  }

  // ── Promo scan (cached, only if API key present) ────────────────
  const hasAiScan = !!process.env.ANTHROPIC_API_KEY;
  let scanResult: PromoScanResult | null = null;

  if (hasAiScan && themeSettings) {
    try {
      const promoDiscounts = toPromoScannerFormat(discounts);
      scanResult = await scanPromoSettings(
        shop,
        themeSettings.settingsValues,
        themeSettings.settingsSchema,
        "all",
        false,
        promoDiscounts,
      );
    } catch (err) {
      console.error("[merchandising:overview] loader → promo scan failed:", err instanceof Error ? err.message : err);
    }
  }

  console.info(`[merchandising:overview] loader DONE → themeFields=${themeSettings?.fields.length ?? 0} discounts=${discounts.length} scan=${scanResult ? "yes" : "no"} orders=${orderStats?.totalOrders ?? "n/a"}`);

  return {
    shop,
    themeSettings: themeSettings ? {
      themeId: themeSettings.themeId,
      themeNumericId: themeSettings.themeNumericId,
      themeName: themeSettings.themeName,
      fields: themeSettings.fields,
    } : null,
    themeScopeError,
    discounts,
    discountError,
    hasAiScan,
    scanResult,
    orderStats,
    hasOrderScope,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action") as string;
  const shop = session.shop;
  console.info(`[merchandising:overview] action → intent=${intent} shop=${shop}`);

  // ── Fetch order stats for a period ────────────────────────────────
  if (intent === "fetchOrderStats") {
    const period = parseInt(formData.get("period") as string, 10) || 30;
    try {
      const { startDate, endDate } = getDateRange(period);
      const stats = await fetchOrderStats(admin, startDate, endDate);
      console.info(`[merchandising:overview] fetchOrderStats OK period=${period}d orders=${stats.totalOrders}`);
      return { ok: true, intent: "orderStats", orderStats: stats };
    } catch (err) {
      console.error("[merchandising:overview] fetchOrderStats FAILED:", err instanceof Error ? err.message : err);
      return { ok: false, error: "Failed to fetch order stats" };
    }
  }

  // ── Force rescan ─────────────────────────────────────────────────
  if (intent === "scanPromo") {
    try {
      const theme = await getMainTheme(admin);
      if (!theme) return { ok: false, error: "No published theme found" };

      const { settingsData, settingsSchema } = await getThemeSettingsAndSchema(admin, theme.id);
      if (!settingsData) return { ok: false, error: "Could not read theme settings" };

      const values = extractSettingsValues(settingsData);
      const discounts = await fetchAllActiveDiscounts(admin);
      const promoDiscounts = toPromoScannerFormat(discounts);

      clearScanCache(shop);
      const result = await scanPromoSettings(shop, values, settingsSchema, "all", true, promoDiscounts);

      console.info(`[merchandising:overview] scanPromo OK → ${result.fields.length} fields, ${result.conflicts.length} conflicts, ${result.recommendations.length} recs`);
      return { ok: true, intent: "scan", scanResult: result };
    } catch (err) {
      console.error("[merchandising:overview] scanPromo FAILED:", err instanceof Error ? err.message : err);
      return { ok: false, error: "Promotional scan failed" };
    }
  }

  // ── Theme setting update (REST API) ──────────────────────────────
  if (intent === "updateThemeSetting") {
    const themeNumericId = formData.get("themeId") as string;
    const settingKey = formData.get("settingKey") as string;
    const settingValue = formData.get("settingValue") as string;
    const token = session.accessToken!;
    const apiBase = `https://${shop}/admin/api/2026-01`;

    console.info(`[merchandising:overview] updateThemeSetting theme=${themeNumericId} key=${settingKey}`);

    try {
      const getRes = await fetch(
        `${apiBase}/themes/${themeNumericId}/assets.json?asset[key]=${encodeURIComponent("config/settings_data.json")}`,
        { headers: { "X-Shopify-Access-Token": token } },
      );
      if (!getRes.ok) {
        const text = await getRes.text();
        console.error(`[merchandising:overview] updateThemeSetting GET FAILED:`, text);
        return { ok: false, error: `Failed to read theme settings (${getRes.status})` };
      }
      const assetJson = await getRes.json();
      const settingsData = JSON.parse(assetJson.asset.value);

      if (typeof settingsData.current === "object" && settingsData.current !== null) {
        settingsData.current[settingKey] = settingValue;
      } else {
        return { ok: false, error: "Theme settings structure unrecognized" };
      }

      const putRes = await fetch(`${apiBase}/themes/${themeNumericId}/assets.json`, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          asset: { key: "config/settings_data.json", value: JSON.stringify(settingsData) },
        }),
      });

      if (!putRes.ok) {
        const text = await putRes.text();
        console.error(`[merchandising:overview] updateThemeSetting PUT FAILED:`, text);
        return { ok: false, error: `Failed to update theme settings (${putRes.status})` };
      }

      console.info(`[merchandising:overview] updateThemeSetting OK key=${settingKey}`);
      return { ok: true, intent: "themeSetting" };
    } catch (err) {
      console.error(`[merchandising:overview] updateThemeSetting FAILED:`, err instanceof Error ? err.message : err);
      return { ok: false, error: "Failed to update theme setting" };
    }
  }

  console.warn(`[merchandising:overview] action → unknown intent: ${intent}`);
  return { ok: false, error: "Unknown action" };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MerchandisingOverview() {
  const data = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const fetcher = useFetcher();
  const scanFetcher = useFetcher();
  const statsFetcher = useFetcher();

  // Theme setting edit state
  const [editingThemeKey, setEditingThemeKey] = useState<string | null>(null);
  const [editingThemeValue, setEditingThemeValue] = useState("");

  // Stats state
  const [statsPeriod, setStatsPeriod] = useState(30);
  const [includeShipping, setIncludeShipping] = useState(false);
  const [liveOrderStats, setLiveOrderStats] = useState<OrderStatsRaw | null>(null);
  const currentOrderStats = liveOrderStats ?? data.orderStats;

  // Banner
  const [banner, setBanner] = useState<{ tone: "success" | "critical"; message: string } | null>(null);

  // Scan result (can be updated by action)
  const [liveScanResult, setLiveScanResult] = useState<PromoScanResult | null>(null);
  const scanResult = liveScanResult ?? data.scanResult;

  const isSubmitting = fetcher.state !== "idle";
  const isScanning = scanFetcher.state !== "idle";
  const isLoadingStats = statsFetcher.state !== "idle";

  const fetcherData = fetcher.data as { ok: boolean; error?: string; intent?: string } | undefined;

  // Handle theme edit fetcher completion
  const prevFetcherData = useState<typeof fetcherData>(undefined);
  if (fetcherData && fetcherData !== prevFetcherData[0]) {
    prevFetcherData[1](fetcherData);
    if (fetcherData.ok) {
      setBanner({ tone: "success", message: t("theme.settingSaved") });
      setEditingThemeKey(null);
    } else if (fetcherData.error) {
      setBanner({ tone: "critical", message: fetcherData.error });
    }
  }

  // Handle scan fetcher completion
  const scanFetcherData = scanFetcher.data as { ok: boolean; error?: string; scanResult?: PromoScanResult } | undefined;
  const prevScanData = useState<typeof scanFetcherData>(undefined);
  if (scanFetcherData && scanFetcherData !== prevScanData[0]) {
    prevScanData[1](scanFetcherData);
    if (scanFetcherData.ok && scanFetcherData.scanResult) {
      setLiveScanResult(scanFetcherData.scanResult);
      setBanner({ tone: "success", message: t("overview.scanResults") });
    } else if (scanFetcherData.error) {
      setBanner({ tone: "critical", message: scanFetcherData.error });
    }
  }

  // Handle stats fetcher completion
  const statsFetcherData = statsFetcher.data as { ok: boolean; error?: string; orderStats?: OrderStatsRaw } | undefined;
  const prevStatsData = useState<typeof statsFetcherData>(undefined);
  if (statsFetcherData && statsFetcherData !== prevStatsData[0]) {
    prevStatsData[1](statsFetcherData);
    if (statsFetcherData.ok && statsFetcherData.orderStats) {
      setLiveOrderStats(statsFetcherData.orderStats);
    } else if (statsFetcherData.error) {
      setBanner({ tone: "critical", message: statsFetcherData.error });
    }
  }

  // Compute display stats client-side (reacts to includeShipping toggle)
  const computed: ComputedStats | null = currentOrderStats
    ? computeStats(currentOrderStats, includeShipping)
    : null;

  // ---------------------------------------------------------------------------
  // Theme setting edit helpers
  // ---------------------------------------------------------------------------

  const startThemeEdit = useCallback((field: ThemeSettingField) => {
    setEditingThemeKey(field.key);
    setEditingThemeValue(field.value);
  }, []);

  const submitThemeEdit = useCallback(() => {
    if (!editingThemeKey || !data.themeSettings) return;
    fetcher.submit(
      {
        _action: "updateThemeSetting",
        themeId: data.themeSettings.themeNumericId,
        settingKey: editingThemeKey,
        settingValue: editingThemeValue,
      },
      { method: "post" },
    );
  }, [editingThemeKey, editingThemeValue, data.themeSettings, fetcher]);

  const triggerScan = useCallback(() => {
    scanFetcher.submit({ _action: "scanPromo" }, { method: "post" });
  }, [scanFetcher]);

  const loadStats = useCallback((period: number) => {
    setStatsPeriod(period);
    statsFetcher.submit(
      { _action: "fetchOrderStats", period: String(period) },
      { method: "post" },
    );
  }, [statsFetcher]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const themeEditorUrl = data.themeSettings
    ? `https://${data.shop}/admin/themes/${data.themeSettings.themeNumericId}/editor`
    : null;

  return (
    <>
      {banner && (
        <s-banner tone={banner.tone} onDismiss={() => setBanner(null)}>
          {banner.message}
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          {/* ── Discount Performance Stats Card ────────────────────── */}
          {!data.hasOrderScope && (
            <s-banner tone="info">{t("stats.scopeRequired")}</s-banner>
          )}

          {data.hasOrderScope && computed && (
            <div className={styles.locationSettingsBlock}>
              <div className={styles.statsCard}>
                {/* Header */}
                <div className={styles.statsHeader}>
                  <h2 className={styles.modalTitle}>{t("stats.title")}</h2>
                  <select
                    className={styles.statsPeriodSelect}
                    value={String(statsPeriod)}
                    disabled={isLoadingStats}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      loadStats(val);
                    }}
                  >
                    <option value="7">{t("stats.period7")}</option>
                    <option value="30">{t("stats.period30")}</option>
                    <option value="90">{t("stats.period90")}</option>
                  </select>
                </div>

                {/* Stats grid */}
                <div className={styles.statsGrid}>
                  {/* Avg discount rate — Shopify Discounts icon */}
                  <div className={styles.statBox}>
                    <div className={styles.statIconRow}>
                      <span className={styles.statIcon}>
                        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
                          <path d="M2.5 2.5a1 1 0 0 0-1 1v4.586a1 1 0 0 0 .293.707l8.414 8.414a1 1 0 0 0 1.414 0l4.586-4.586a1 1 0 0 0 0-1.414l-8.414-8.414a1 1 0 0 0-.707-.293h-4.586Zm2 3.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
                        </svg>
                      </span>
                    </div>
                    <span className={styles.statPrimary}>{computed.avgDiscountRate}%</span>
                    <span className={styles.statLabel}>{t("stats.avgDiscountRate")}</span>
                  </div>

                  {/* Orders with discounts — Shopify Orders icon */}
                  <div className={styles.statBox}>
                    <div className={styles.statIconRow}>
                      <span className={styles.statIcon}>
                        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M6 2a1 1 0 0 0-1 1v1h-1.5a1.5 1.5 0 0 0-1.5 1.5v11a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-11a1.5 1.5 0 0 0-1.5-1.5h-1.5v-1a1 1 0 0 0-1-1h-8Zm8 2h-8v1h8v-1Zm-8 4.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8Zm0 3a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5Z" />
                        </svg>
                      </span>
                    </div>
                    <span className={styles.statPrimary}>{computed.ordersWithDiscount}</span>
                    <span className={styles.statLabel}>{t("stats.ordersWithDiscount")}</span>
                    <span className={styles.statSecondary}>
                      {t("stats.ordersPercent", { pct: computed.discountPercent, total: computed.totalOrders })}
                    </span>
                  </div>

                  {/* Total discounts given — Dollar/finance icon */}
                  <div className={styles.statBox}>
                    <div className={styles.statIconRow}>
                      <span className={styles.statIcon}>
                        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.5 4.75a.75.75 0 0 0-1.5 0v.38a2.25 2.25 0 0 0 .25 4.48h1.5a.75.75 0 0 1 0 1.5h-2.25a.75.75 0 0 0 0 1.5h1v.62a.75.75 0 0 0 1.5 0v-.38a2.25 2.25 0 0 0-.25-4.48h-1.5a.75.75 0 0 1 0-1.5h2.25a.75.75 0 0 0 0-1.5h-1v-.62Z" />
                        </svg>
                      </span>
                    </div>
                    <span className={styles.statPrimary}>R${computed.totalDiscounts.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                    <span className={styles.statLabel}>{t("stats.totalDiscounts")}</span>
                  </div>

                  {/* AOV with discount — Shopify Cart icon */}
                  <div className={styles.statBox}>
                    <div className={styles.statIconRow}>
                      <span className={styles.statIcon}>
                        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M1 1.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .727.562l.5 2.188h12.773a.75.75 0 0 1 .727.938l-1.75 7a.75.75 0 0 1-.727.562h-9.5a.75.75 0 0 1-.727-.562l-2.523-11h-1a.75.75 0 0 1-.75-.75ZM6.5 17a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm8 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
                        </svg>
                      </span>
                    </div>
                    <span className={styles.statPrimary}>R${computed.aovWithDiscount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                    <span className={styles.statLabel}>{t("stats.aovWithDiscount")}</span>
                    {computed.aovWithoutDiscount > 0 && (
                      <span className={styles.statSecondary}>
                        {t("stats.aovWithout", { amount: computed.aovWithoutDiscount.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer toggle */}
                <div className={styles.statsFooter}>
                  <s-checkbox
                    label={t("stats.includeShipping")}
                    checked={includeShipping || undefined}
                    onChange={(e: Event) => {
                      setIncludeShipping((e.currentTarget as HTMLInputElement).checked);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── AI scan unavailable banner ────────────────────────── */}
          {!data.hasAiScan && (
            <s-banner tone="info">{t("overview.scanUnavailable")}</s-banner>
          )}

          {/* ── Theme settings block ──────────────────────────────── */}
          {data.themeScopeError && (
            <s-banner tone="warning">{t("theme.scopeError")}</s-banner>
          )}

          {data.themeSettings && data.themeSettings.fields.length > 0 && (
            <div className={styles.locationSettingsBlock}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <div className={styles.typeBlockHeader}>
                    <h2 className={styles.modalTitle}>{t("theme.title")}</h2>
                    <div className={styles.entryCardActions}>
                      {themeEditorUrl && (
                        <s-button
                          variant="tertiary"
                          onClick={() => window.open(themeEditorUrl, "_blank")}
                        >
                          {t("theme.openEditor")}
                        </s-button>
                      )}
                      {data.hasAiScan && (
                        isScanning ? (
                          <s-button loading disabled key="scanning">
                            {t("overview.scanning")}
                          </s-button>
                        ) : (
                          <s-button variant="secondary" onClick={triggerScan} key="scan">
                            {t("overview.scanButton")}
                          </s-button>
                        )
                      )}
                    </div>
                  </div>

                  {data.themeSettings.fields.map((field) => (
                    <div key={field.key} className={styles.entryCard}>
                      {editingThemeKey === field.key ? (
                        <div className={styles.editForm}>
                          <div className={styles.editFieldGroup}>
                            <label className={styles.editFieldGroupLabel}>{field.label}</label>
                            {field.type === "checkbox" ? (
                              <s-checkbox
                                checked={editingThemeValue === "true" || undefined}
                                onChange={(e: Event) => {
                                  const checked = (e.currentTarget as HTMLInputElement).checked;
                                  setEditingThemeValue(checked ? "true" : "false");
                                }}
                              />
                            ) : (
                              <s-text-field
                                value={editingThemeValue}
                                onChange={(e: Event) => {
                                  setEditingThemeValue((e.target as HTMLInputElement).value);
                                }}
                              />
                            )}
                          </div>
                          <div className={styles.editActions}>
                            <s-button variant="secondary" onClick={() => setEditingThemeKey(null)}>
                              {t("entry.cancel")}
                            </s-button>
                            {isSubmitting ? (
                              <s-button loading disabled key="saving-theme">
                                {t("entry.saving")}
                              </s-button>
                            ) : (
                              <s-button variant="primary" onClick={submitThemeEdit} key="save-theme">
                                {t("entry.save")}
                              </s-button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={styles.entryCardHeader}>
                            <span className={styles.entryCardTitle}>{field.label}</span>
                            <s-button variant="tertiary" onClick={() => startThemeEdit(field)}>
                              {t("entry.edit")}
                            </s-button>
                          </div>
                          <div className={styles.entryFieldRow}>
                            <span className={styles.entryFieldLabel}>{field.section}</span>
                            <span className={styles.themeSettingValue}>
                              {field.type === "checkbox"
                                ? (field.value === "true" ? "Yes" : "No")
                                : (field.value || "\u2014")}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </s-stack>
              </s-box>
            </div>
          )}

          {/* ── Promo scan results ────────────────────────────────── */}
          {scanResult && scanResult.fields.length > 0 && (
            <div className={styles.locationSettingsBlock}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>{t("overview.scanResults")}</h2>

                  {/* Conflicts */}
                  {scanResult.conflicts.length > 0 && (
                    <>
                      <h3 className={styles.subSectionTitle}>{t("overview.conflicts")}</h3>
                      {scanResult.conflicts.map((conflict, i) => (
                        <div key={i} className={styles.entryCard}>
                          <div className={styles.conflictRow}>
                            <s-badge tone="warning">{t("overview.conflicts")}</s-badge>
                            <span>{conflict.description}</span>
                          </div>
                          {conflict.locations.length > 0 && (
                            <div className={styles.entryFieldRow}>
                              <span className={styles.entryFieldLabel}>Locations</span>
                              <span className={styles.entryFieldValue}>
                                {conflict.locations.join(", ")}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  {/* Recommendations */}
                  {scanResult.recommendations.length > 0 && (
                    <>
                      <h3 className={styles.subSectionTitle}>{t("overview.recommendations")}</h3>
                      {scanResult.recommendations
                        .sort((a, b) => {
                          const order = { high: 0, medium: 1, low: 2 };
                          return order[a.priority] - order[b.priority];
                        })
                        .map((rec, i) => (
                          <div key={i} className={styles.entryCard}>
                            <div className={styles.conflictRow}>
                              <s-badge tone={rec.priority === "high" ? "critical" : rec.priority === "medium" ? "warning" : "info"}>
                                {rec.priority}
                              </s-badge>
                              <span>{rec.description}</span>
                            </div>
                            <div className={styles.entryFieldRow}>
                              <span className={styles.entryFieldLabel}>Action</span>
                              <span className={styles.entryFieldValue}>{rec.action}</span>
                            </div>
                          </div>
                        ))}
                    </>
                  )}

                  {/* Promotional fields */}
                  {scanResult.fields.length > 0 && (
                    <>
                      <h3 className={styles.subSectionTitle}>{t("overview.fields")}</h3>
                      {scanResult.fields.map((field, i) => (
                        <div key={i} className={styles.entryCard}>
                          <div className={styles.entryCardHeader}>
                            <span className={styles.entryCardTitle}>{field.label}</span>
                            <s-badge>{field.section}</s-badge>
                          </div>
                          <div className={styles.entryFieldRow}>
                            <span className={styles.entryFieldLabel}>Purpose</span>
                            <span className={styles.entryFieldValue}>{field.purpose}</span>
                          </div>
                          <div className={styles.entryFieldRow}>
                            <span className={styles.entryFieldLabel}>Value</span>
                            <span className={styles.themeSettingValue}>{field.currentValue || "\u2014"}</span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {scanResult.scannedAt > 0 && (
                    <s-text color="subdued">
                      {t("overview.scannedAt")}: {new Date(scanResult.scannedAt).toLocaleString()}
                    </s-text>
                  )}
                </s-stack>
              </s-box>
            </div>
          )}

          {/* ── Active discounts table ────────────────────────────── */}
          {!data.discountError && (
            <div className={styles.locationSettingsBlock}>
              <s-box padding="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <h2 className={styles.modalTitle}>
                    {t("overview.discountsTitle")}
                    {data.discounts.length > 0 && (
                      <span style={{ fontWeight: 400, fontSize: 14, color: "#6d7175", marginLeft: 8 }}>
                        ({data.discounts.length})
                      </span>
                    )}
                  </h2>

                  {data.discounts.length === 0 ? (
                    <s-text color="subdued">{t("overview.noDiscounts")}</s-text>
                  ) : (
                    <div className={styles.tableContainer}>
                      <table className={styles.table}>
                        <thead>
                          <tr className={styles.tableHeader}>
                            <th>{t("overview.discountName")}</th>
                            <th>{t("overview.discountType")}</th>
                            <th>{t("overview.discountValue")}</th>
                            <th>{t("overview.discountEndsAt")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.discounts.map((d) => {
                            const isAffiliate = d.type === "code" && /^[A-Z]+\d{1,2}$/.test(d.title.toUpperCase());
                            return (
                              <tr key={d.id} className={styles.tableRow}>
                                <td className={styles.tableCell}>{d.title}</td>
                                <td className={styles.tableCell}>
                                  <s-badge tone={d.type === "automatic" ? "info" : undefined}>
                                    {d.type === "automatic" ? t("overview.discountAutomatic") : t("overview.discountCode")}
                                  </s-badge>
                                </td>
                                <td className={styles.tableCell}>
                                  {d.value?.percentage != null
                                    ? `${d.value.percentage}%`
                                    : d.value?.amount != null
                                      ? `R$${d.value.amount}`
                                      : d.mechanism === "bxgy" ? "BxGy"
                                      : d.mechanism === "free_shipping" ? "Free shipping"
                                      : "\u2014"}
                                </td>
                                <td className={styles.tableCell}>
                                  {d.endsAt
                                    ? new Date(d.endsAt).toLocaleDateString()
                                    : isAffiliate
                                      ? <s-text color="subdued">{t("overview.discountPermanent")}</s-text>
                                      : <s-badge tone="warning">{t("overview.discountNoEnd")}</s-badge>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </s-stack>
              </s-box>
            </div>
          )}

          {/* Empty state when no theme settings available */}
          {!data.themeSettings && !data.themeScopeError && data.discounts.length === 0 && (
            <div className={styles.locationSettingsBlock}>
              <s-box padding="base" borderRadius="base">
                <div className={styles.emptyState}>
                  <div className={styles.emptyStateText}>
                    {t("theme.scopeError")}
                  </div>
                </div>
              </s-box>
            </div>
          )}
        </s-stack>
      </s-section>
    </>
  );
}
