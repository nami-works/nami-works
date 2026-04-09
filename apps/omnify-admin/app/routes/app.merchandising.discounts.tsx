import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import { fetchAllActiveDiscounts, type DiscountNode } from "../services/merchandising/discounts.server";
import {
  detectStackingRisks,
  detectStaleDiscounts,
  type StackingRisk,
  type StaleDiscount,
} from "../services/merchandising/stacking.server";
import styles from "./app.merchandising/styles.module.css";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[merchandising:discounts] loader START shop=${shop}`);

  let discounts: DiscountNode[] = [];
  let stackingRisks: StackingRisk[] = [];
  let staleDiscounts: StaleDiscount[] = [];
  let error: string | null = null;

  try {
    discounts = await fetchAllActiveDiscounts(admin);
    stackingRisks = detectStackingRisks(discounts);
    staleDiscounts = detectStaleDiscounts(discounts);
  } catch (err) {
    console.error("[merchandising:discounts] loader FAILED:", err instanceof Error ? err.message : err);
    error = "Failed to fetch discount data.";
  }

  console.info(`[merchandising:discounts] loader DONE → discounts=${discounts.length} risks=${stackingRisks.length} stale=${staleDiscounts.length}`);

  return { shop, discounts, stackingRisks, staleDiscounts, error };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action") as string;
  console.info(`[merchandising:discounts] action → intent=${intent} shop=${session.shop}`);

  if (intent === "expireDiscounts") {
    const idsJson = formData.get("ids") as string;
    let ids: string[];
    try {
      ids = JSON.parse(idsJson);
    } catch {
      return { ok: false, error: "Invalid discount IDs" };
    }

    console.info(`[merchandising:discounts] expireDiscounts count=${ids.length}`);
    const now = new Date().toISOString();
    let succeeded = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        const response = await admin.graphql(
          `#graphql
          mutation ExpireDiscount($id: ID!, $endsAt: DateTime!) {
            discountCodeBasicUpdate(id: $id, basicCodeDiscount: { endsAt: $endsAt }) {
              userErrors { field message }
            }
          }`,
          { variables: { id, endsAt: now } },
        );
        const json = await response.json();
        const errors = json.data?.discountCodeBasicUpdate?.userErrors ?? [];
        if (errors.length > 0) {
          console.warn(`[merchandising:discounts] expireDiscount SKIP id=${id}: ${errors[0].message}`);
          failed++;
        } else {
          succeeded++;
        }
      } catch (err) {
        console.error(`[merchandising:discounts] expireDiscount FAILED id=${id}:`, err instanceof Error ? err.message : err);
        failed++;
      }
    }

    console.info(`[merchandising:discounts] expireDiscounts DONE succeeded=${succeeded} failed=${failed}`);
    return { ok: true, intent: "expire", succeeded, failed };
  }

  return { ok: false, error: "Unknown action" };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MerchandisingDiscounts() {
  const data = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const fetcher = useFetcher();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hideAffiliates, setHideAffiliates] = useState(true);
  const [selectedStaleIds, setSelectedStaleIds] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<{ tone: "success" | "critical"; message: string } | null>(null);

  const isExpiring = fetcher.state !== "idle";

  // Handle fetcher completion
  const fetcherData = fetcher.data as { ok: boolean; error?: string; succeeded?: number; failed?: number } | undefined;
  const prevFetcherData = useState<typeof fetcherData>(undefined);
  if (fetcherData && fetcherData !== prevFetcherData[0]) {
    prevFetcherData[1](fetcherData);
    if (fetcherData.ok) {
      setBanner({ tone: "success", message: t("discounts.expired") });
      setSelectedStaleIds(new Set());
    } else if (fetcherData.error) {
      setBanner({ tone: "critical", message: fetcherData.error });
    }
  }

  const toggleStaleId = useCallback((id: string) => {
    setSelectedStaleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const submitExpire = useCallback(() => {
    if (selectedStaleIds.size === 0) return;
    fetcher.submit(
      { _action: "expireDiscounts", ids: JSON.stringify([...selectedStaleIds]) },
      { method: "post" },
    );
  }, [selectedStaleIds, fetcher]);

  if (data.error) {
    return (
      <s-section>
        <s-banner tone="critical">{data.error}</s-banner>
      </s-section>
    );
  }

  // Filter stacking risks (hide affiliates by default)
  const filteredRisks = hideAffiliates
    ? data.stackingRisks.filter((r) => !r.isAffiliate)
    : data.stackingRisks;

  // Group stale discounts by category
  const staleByCategory = groupBy(data.staleDiscounts, (d) => d.category);
  const categoryOrder: StaleDiscount["category"][] = ["return", "seasonal", "one-off", "affiliate"];

  return (
    <>
      {banner && (
        <s-banner tone={banner.tone} onDismiss={() => setBanner(null)}>
          {banner.message}
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          {/* ── Stacking detector ─────────────────────────────────── */}
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <div className={styles.typeBlockHeader}>
                  <h2 className={styles.modalTitle}>
                    {t("discounts.stackingTitle")}
                    {data.stackingRisks.length > 0 && (
                      <span style={{ fontWeight: 400, fontSize: 14, color: "#6d7175", marginLeft: 8 }}>
                        ({filteredRisks.length})
                      </span>
                    )}
                  </h2>
                  {data.stackingRisks.some((r) => r.isAffiliate) && (
                    <s-button
                      variant="tertiary"
                      onClick={() => setHideAffiliates((prev) => !prev)}
                    >
                      {hideAffiliates ? t("discounts.showAll") : t("discounts.hideAffiliates")}
                    </s-button>
                  )}
                </div>

                {filteredRisks.length === 0 ? (
                  <s-text color="subdued">{t("discounts.noDiscounts")}</s-text>
                ) : (
                  <div className={styles.tableContainer}>
                    <table className={styles.table}>
                      <thead>
                        <tr className={styles.tableHeader}>
                          <th>{t("discounts.name")}</th>
                          <th>{t("discounts.type")}</th>
                          <th>{t("discounts.value")}</th>
                          <th>{t("discounts.combines")}</th>
                          <th>{t("discounts.targets")}</th>
                          <th>{t("discounts.risk")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRisks
                          .sort((a, b) => riskOrder(a.riskLevel) - riskOrder(b.riskLevel))
                          .map((risk) => {
                            const discount = data.discounts.find((d) => d.id === risk.discountId);
                            if (!discount) return null;
                            const isExpanded = expandedId === risk.discountId;

                            return (
                              <StackingRow
                                key={risk.discountId}
                                risk={risk}
                                discount={discount}
                                isExpanded={isExpanded}
                                onToggle={() => setExpandedId(isExpanded ? null : risk.discountId)}
                                t={t}
                              />
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </s-stack>
            </s-box>
          </div>

          {/* ── Stale discount cleanup ────────────────────────────── */}
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <div className={styles.typeBlockHeader}>
                  <h2 className={styles.modalTitle}>{t("discounts.staleTitle")}</h2>
                  {data.staleDiscounts.length > 0 && (
                    <div className={styles.editActions}>
                      {isExpiring ? (
                        <s-button loading disabled key="expiring">
                          {t("discounts.expiring")}
                        </s-button>
                      ) : (
                        <s-button
                          variant="primary"
                          tone="critical"
                          disabled={selectedStaleIds.size === 0 || undefined}
                          key="expire"
                          onClick={submitExpire}
                        >
                          {t("discounts.expireSelected")} ({selectedStaleIds.size})
                        </s-button>
                      )}
                    </div>
                  )}
                </div>

                {data.staleDiscounts.length === 0 ? (
                  <s-text color="subdued">{t("discounts.noStale")}</s-text>
                ) : (
                  categoryOrder.map((cat) => {
                    const items = staleByCategory[cat];
                    if (!items || items.length === 0) return null;

                    const categoryLabel =
                      cat === "return" ? t("discounts.categoryReturn")
                      : cat === "seasonal" ? t("discounts.categorySeasonal")
                      : cat === "one-off" ? t("discounts.categoryOneOff")
                      : t("discounts.categoryAffiliate");

                    return (
                      <div key={cat}>
                        <h3 className={styles.subSectionTitle}>
                          {categoryLabel} ({items.length})
                        </h3>
                        <div className={styles.tableContainer}>
                          <table className={styles.table}>
                            <thead>
                              <tr className={styles.tableHeader}>
                                <th className={styles.checkboxCell}></th>
                                <th>{t("discounts.code")}</th>
                                <th>{t("discounts.value")}</th>
                                <th>{t("discounts.created")}</th>
                                <th>{t("discounts.age")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((item) => (
                                <tr key={item.id} className={styles.tableRow}>
                                  <td className={styles.checkboxCell}>
                                    {cat !== "affiliate" && (
                                      <input
                                        type="checkbox"
                                        checked={selectedStaleIds.has(item.id)}
                                        onChange={() => toggleStaleId(item.id)}
                                      />
                                    )}
                                  </td>
                                  <td className={styles.tableCell}>{item.code}</td>
                                  <td className={styles.tableCell}>{item.value}</td>
                                  <td className={styles.tableCell}>
                                    {item.startsAt ? new Date(item.startsAt).toLocaleDateString() : "\u2014"}
                                  </td>
                                  <td className={styles.tableCell}>
                                    {item.ageDays} {t("discounts.days")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })
                )}
              </s-stack>
            </s-box>
          </div>
        </s-stack>
      </s-section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StackingRow({
  risk,
  discount,
  isExpanded,
  onToggle,
  t,
}: {
  risk: StackingRisk;
  discount: DiscountNode;
  isExpanded: boolean;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  const cw = risk.combinesWith;
  return (
    <>
      <tr className={styles.tableRow} onClick={onToggle} style={{ cursor: risk.details.length > 0 ? "pointer" : "default" }}>
        <td className={styles.tableCell}>{discount.title}</td>
        <td className={styles.tableCell}>
          <s-badge tone={discount.type === "automatic" ? "info" : undefined}>
            {discount.type}
          </s-badge>
        </td>
        <td className={styles.tableCell}>
          {discount.value?.percentage != null
            ? `${discount.value.percentage}%`
            : discount.value?.amount != null
              ? `R$${discount.value.amount}`
              : discount.mechanism}
        </td>
        <td className={styles.tableCell}>
          <div className={styles.combinesIcons}>
            <span className={`${styles.combinesIcon} ${cw.orderDiscounts ? styles.combinesIconActive : styles.combinesIconInactive}`} title={t("discounts.combinesOrder")}>O</span>
            <span className={`${styles.combinesIcon} ${cw.productDiscounts ? styles.combinesIconActive : styles.combinesIconInactive}`} title={t("discounts.combinesProduct")}>P</span>
            <span className={`${styles.combinesIcon} ${cw.shippingDiscounts ? styles.combinesIconActive : styles.combinesIconInactive}`} title={t("discounts.combinesShipping")}>S</span>
          </div>
        </td>
        <td className={styles.tableCell}>{discount.targets}</td>
        <td className={styles.tableCell}>
          <s-badge tone={risk.riskLevel === "critical" ? "critical" : risk.riskLevel === "warning" ? "warning" : "info"}>
            {risk.riskLevel === "critical" ? t("discounts.riskCritical")
              : risk.riskLevel === "warning" ? t("discounts.riskWarning")
              : t("discounts.riskClean")}
          </s-badge>
        </td>
      </tr>
      {isExpanded && risk.details.length > 0 && (
        <tr>
          <td colSpan={6} className={styles.tableCell}>
            <div className={styles.detailPanel}>
              <strong>{t("discounts.stackingDetail")}</strong>
              <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
                {risk.details.map((detail, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{detail}</li>
                ))}
              </ul>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function riskOrder(level: string): number {
  return level === "critical" ? 0 : level === "warning" ? 1 : 2;
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!groups[k]) groups[k] = [];
    groups[k].push(item);
  }
  return groups;
}
