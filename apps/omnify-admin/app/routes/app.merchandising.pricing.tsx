import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import {
  fetchActiveProductsWithPricing,
  computePricingHealth,
  type PricingHealthSummary,
  type AlignmentStatus,
} from "../services/merchandising/products.server";
import styles from "./app.merchandising/styles.module.css";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[merchandising:pricing] loader START shop=${shop}`);

  let health: PricingHealthSummary | null = null;
  let error: string | null = null;

  try {
    const products = await fetchActiveProductsWithPricing(admin);
    health = computePricingHealth(products);
  } catch (err) {
    console.error("[merchandising:pricing] loader FAILED:", err instanceof Error ? err.message : err);
    error = "Failed to fetch product pricing data.";
  }

  console.info(`[merchandising:pricing] loader DONE`);
  return { shop, health, error };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type FilterValue = "all" | AlignmentStatus;

export default function MerchandisingPricing() {
  const data = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const [filter, setFilter] = useState<FilterValue>("all");

  if (data.error) {
    return (
      <s-section>
        <s-banner tone="critical">{data.error}</s-banner>
      </s-section>
    );
  }

  const health = data.health;
  if (!health || health.products.length === 0) {
    return (
      <s-section>
        <s-text color="subdued">{t("pricing.noProducts")}</s-text>
      </s-section>
    );
  }

  const filteredProducts = filter === "all"
    ? health.products
    : health.products.filter((p) => p.status === filter);

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        {/* ── Oversold banner ──────────────────────────────────────── */}
        {health.oversold.length > 0 && (
          <s-banner tone="critical">
            {t("pricing.oversoldBanner", { count: health.oversold.length })}
          </s-banner>
        )}

        {/* ── Price-campaign alignment ─────────────────────────────── */}
        <div className={styles.locationSettingsBlock}>
          <s-box padding="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <h2 className={styles.modalTitle}>{t("pricing.alignmentTitle")}</h2>

              {/* Summary */}
              <div className={styles.summaryCard}>
                {health.campaignTarget != null && (
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>Target</span>
                    <span className={styles.summaryValue}>{health.campaignTarget}%</span>
                  </div>
                )}
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>{t("pricing.aligned")}</span>
                  <span className={styles.summaryValue}>{health.aligned}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>{t("pricing.deeper")}</span>
                  <span className={styles.summaryValue}>{health.deeper}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>{t("pricing.shallower")}</span>
                  <span className={styles.summaryValue}>{health.shallower}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>{t("pricing.notOnSale")}</span>
                  <span className={styles.summaryValue} style={{ color: "#6d7175" }}>{health.notOnSale}</span>
                </div>
              </div>

              {/* Filter — compact inline */}
              <div className={styles.filterRow}>
                <s-select
                  value={filter}
                  onChange={(e: Event) => setFilter((e.currentTarget as HTMLSelectElement).value as FilterValue)}
                >
                  <s-option value="all">{t("pricing.filterAll")} ({health.products.length})</s-option>
                  <s-option value="aligned">{t("pricing.aligned")} ({health.aligned})</s-option>
                  <s-option value="deeper">{t("pricing.deeper")} ({health.deeper})</s-option>
                  <s-option value="shallower">{t("pricing.shallower")} ({health.shallower})</s-option>
                  <s-option value="not_on_sale">{t("pricing.notOnSale")} ({health.notOnSale})</s-option>
                  <s-option value="launch">{t("pricing.launch")}</s-option>
                </s-select>
              </div>

              {/* Table */}
              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr className={styles.tableHeader}>
                      <th>{t("pricing.product")}</th>
                      <th>{t("pricing.price")}</th>
                      <th>{t("pricing.compareAt")}</th>
                      <th>{t("pricing.effectivePct")}</th>
                      <th>{t("pricing.status")}</th>
                      <th>{t("pricing.tags")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((result) => {
                      const variant = result.product.variants[0];
                      return (
                        <tr key={result.product.id} className={styles.tableRow}>
                          <td className={styles.tableCell}>{result.product.title}</td>
                          <td className={styles.tableCell}>
                            {variant ? `R$${variant.price}` : "\u2014"}
                          </td>
                          <td className={styles.tableCell}>
                            {variant?.compareAtPrice ? `R$${variant.compareAtPrice}` : "\u2014"}
                          </td>
                          <td className={styles.tableCell}>
                            {result.effectivePct != null ? `${result.effectivePct}%` : "\u2014"}
                          </td>
                          <td className={styles.tableCell}>
                            <s-badge tone={statusTone(result.status)}>
                              {t(`pricing.${result.status === "not_on_sale" ? "notOnSale" : result.status}`)}
                            </s-badge>
                          </td>
                          <td className={styles.tableCell}>
                            {result.product.tags.slice(0, 3).join(", ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </s-stack>
          </s-box>
        </div>

        {/* ── Inventory alerts ─────────────────────────────────────── */}
        <div className={styles.locationSettingsBlock}>
          <s-box padding="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <h2 className={styles.modalTitle}>{t("pricing.inventoryTitle")}</h2>

              {health.oversold.length === 0 && health.outOfStock.length === 0 ? (
                <s-text color="subdued">{t("pricing.noInventoryIssues")}</s-text>
              ) : (
                <div className={styles.tableContainer}>
                  <table className={styles.table}>
                    <thead>
                      <tr className={styles.tableHeader}>
                        <th>{t("pricing.product")}</th>
                        <th>{t("pricing.variant")}</th>
                        <th>{t("pricing.sku")}</th>
                        <th>{t("pricing.inventory")}</th>
                        <th>{t("pricing.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.oversold.map(({ product, variant }, i) => (
                        <tr key={`oversold-${i}`} className={styles.tableRow}>
                          <td className={styles.tableCell}>{product.title}</td>
                          <td className={styles.tableCell}>{variant.title}</td>
                          <td className={styles.tableCell}>{variant.sku || "\u2014"}</td>
                          <td className={styles.tableCell}>{variant.inventoryQuantity}</td>
                          <td className={styles.tableCell}>
                            <s-badge tone="critical">{t("pricing.oversold")}</s-badge>
                          </td>
                        </tr>
                      ))}
                      {health.outOfStock.map(({ product, variant }, i) => (
                        <tr key={`oos-${i}`} className={styles.tableRow}>
                          <td className={styles.tableCell}>{product.title}</td>
                          <td className={styles.tableCell}>{variant.title}</td>
                          <td className={styles.tableCell}>{variant.sku || "\u2014"}</td>
                          <td className={styles.tableCell}>0</td>
                          <td className={styles.tableCell}>
                            <s-badge tone="warning">{t("pricing.outOfStock")}</s-badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </s-stack>
          </s-box>
        </div>
      </s-stack>
    </s-section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusTone(status: AlignmentStatus): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "aligned": return "success";
    case "deeper": return "warning";
    case "shallower": return "warning";
    case "not_on_sale": return undefined;
    case "launch": return "info";
  }
}
