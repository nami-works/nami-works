import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import {
  fetchCollectionsWithHealth,
  fetchBadgeCoverage,
  type CollectionHealth,
  type BadgeCoverage,
} from "../services/merchandising/collections.server";
import styles from "./app.merchandising/styles.module.css";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[merchandising:collections] loader START shop=${shop}`);

  let collections: CollectionHealth[] = [];
  let badges: BadgeCoverage[] = [];
  let error: string | null = null;

  try {
    [collections, badges] = await Promise.all([
      fetchCollectionsWithHealth(admin),
      fetchBadgeCoverage(admin),
    ]);
  } catch (err) {
    console.error("[merchandising:collections] loader FAILED:", err instanceof Error ? err.message : err);
    error = "Failed to fetch collection data.";
  }

  // Only show unhealthy collections
  const unhealthy = collections.filter((c) => c.status !== "healthy");

  console.info(`[merchandising:collections] loader DONE → collections=${collections.length} unhealthy=${unhealthy.length} badges=${badges.length}`);

  return { shop, collections: unhealthy, allCollectionCount: collections.length, badges, error };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action") as string;
  console.info(`[merchandising:collections] action → intent=${intent} shop=${session.shop}`);

  if (intent === "deleteCollection") {
    const id = formData.get("collectionId") as string;
    console.info(`[merchandising:collections] deleteCollection id=${id}`);

    const response = await admin.graphql(
      `#graphql
      mutation DeleteCollection($id: ID!) {
        collectionDelete(input: { id: $id }) {
          deletedCollectionId
          userErrors { field message }
        }
      }`,
      { variables: { id } },
    );

    const json = await response.json();
    const errors = json.data?.collectionDelete?.userErrors ?? [];
    if (errors.length > 0) {
      console.error(`[merchandising:collections] deleteCollection FAILED:`, JSON.stringify(errors));
      return { ok: false, error: errors[0].message };
    }
    console.info(`[merchandising:collections] deleteCollection OK id=${id}`);
    return { ok: true, intent: "delete" };
  }

  return { ok: false, error: "Unknown action" };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MerchandisingCollections() {
  const data = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const fetcher = useFetcher();

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "success" | "critical"; message: string } | null>(null);

  const isSubmitting = fetcher.state !== "idle";

  const fetcherData = fetcher.data as { ok: boolean; error?: string; intent?: string } | undefined;
  const prevFetcherData = useState<typeof fetcherData>(undefined);
  if (fetcherData && fetcherData !== prevFetcherData[0]) {
    prevFetcherData[1](fetcherData);
    if (fetcherData.ok) {
      setBanner({ tone: "success", message: t("collections.deleted") });
      setDeleteConfirmId(null);
    } else if (fetcherData.error) {
      setBanner({ tone: "critical", message: fetcherData.error });
    }
  }

  const submitDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    fetcher.submit(
      { _action: "deleteCollection", collectionId: deleteConfirmId },
      { method: "post" },
    );
  }, [deleteConfirmId, fetcher]);

  if (data.error) {
    return (
      <s-section>
        <s-banner tone="critical">{data.error}</s-banner>
      </s-section>
    );
  }

  const assignedCount = data.badges.filter((b) => b.productsAssigned > 0).length;

  return (
    <>
      {banner && (
        <s-banner tone={banner.tone} onDismiss={() => setBanner(null)}>
          {banner.message}
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          {/* ── Collection health ──────────────────────────────────── */}
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>{t("collections.healthTitle")}</h2>

                {data.collections.length === 0 ? (
                  <s-text color="subdued">{t("collections.noIssues")}</s-text>
                ) : (
                  <div className={styles.tableContainer}>
                    <table className={styles.table}>
                      <thead>
                        <tr className={styles.tableHeader}>
                          <th>{t("collections.collection")}</th>
                          <th>{t("collections.productCount")}</th>
                          <th>{t("collections.type")}</th>
                          <th>{t("collections.collectionStatus")}</th>
                          <th>{t("collections.rules")}</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.collections.map((col) => (
                          <tr key={col.id} className={styles.tableRow}>
                            <td className={styles.tableCell}>{col.title}</td>
                            <td className={styles.tableCell}>{col.productCount}</td>
                            <td className={styles.tableCell}>
                              <s-badge tone={col.isAutomated ? "info" : undefined}>
                                {col.isAutomated ? t("collections.automated") : t("collections.manual")}
                              </s-badge>
                            </td>
                            <td className={styles.tableCell}>
                              <s-badge tone={col.status === "empty" ? "critical" : "warning"}>
                                {col.status === "empty" ? t("collections.empty") : t("collections.low")}
                              </s-badge>
                            </td>
                            <td className={styles.tableCell}>
                              {col.rules.length > 0
                                ? col.rules.map((r, i) => (
                                    <span key={i} className={styles.ruleChip}>
                                      {humanizeRule(r.column)} {humanizeRelation(r.relation)} &quot;{r.condition}&quot;
                                    </span>
                                  ))
                                : "\u2014"}
                            </td>
                            <td className={styles.tableCell}>
                              {col.status === "empty" && (
                                <s-button
                                  variant="tertiary"
                                  tone="critical"
                                  onClick={() => {
                                    setDeleteConfirmId(col.id);
                                    document.getElementById("delete-collection-modal")?.setAttribute("open", "");
                                  }}
                                >
                                  {t("collections.deleteCollection")}
                                </s-button>
                              )}
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

          {/* ── Badge assignment audit ─────────────────────────────── */}
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>{t("collections.badgesTitle")}</h2>

                {data.badges.length === 0 ? (
                  <s-text color="subdued">{t("collections.noBadges")}</s-text>
                ) : (
                  <>
                    <s-text color="subdued">
                      {t("collections.coverage", {
                        assigned: assignedCount,
                        total: data.badges.length,
                      })}
                    </s-text>
                    <div className={styles.tableContainer}>
                      <table className={styles.table}>
                        <thead>
                          <tr className={styles.tableHeader}>
                            <th>{t("collections.badge")}</th>
                            <th>{t("collections.productsAssigned")}</th>
                            <th>{t("collections.badgeStatus")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.badges.map((badge) => (
                            <tr key={badge.id} className={styles.tableRow}>
                              <td className={styles.tableCell}>{badge.displayName || badge.handle}</td>
                              <td className={styles.tableCell}>{badge.productsAssigned}</td>
                              <td className={styles.tableCell}>
                                <s-badge tone={badge.productsAssigned > 0 ? "success" : "warning"}>
                                  {badge.productsAssigned > 0 ? t("collections.used") : t("collections.unused")}
                                </s-badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </s-stack>
            </s-box>
          </div>
        </s-stack>
      </s-section>

      {/* ── Delete confirmation modal ────────────────────────────── */}
      <s-modal id="delete-collection-modal" heading={t("collections.deleteCollectionTitle")}>
        <p>{t("collections.deleteCollectionConfirm")}</p>
        <div slot="footer" className={styles.editActions}>
          <s-button
            variant="secondary"
            onClick={() => {
              setDeleteConfirmId(null);
              document.getElementById("delete-collection-modal")?.removeAttribute("open");
            }}
          >
            {t("entry.cancel")}
          </s-button>
          {isSubmitting ? (
            <s-button variant="primary" tone="critical" loading disabled key="deleting">
              {t("entry.deleting")}
            </s-button>
          ) : (
            <s-button
              variant="primary"
              tone="critical"
              key="delete-col"
              onClick={() => {
                submitDelete();
                document.getElementById("delete-collection-modal")?.removeAttribute("open");
              }}
            >
              {t("collections.deleteCollection")}
            </s-button>
          )}
        </div>
      </s-modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeRule(column: string): string {
  const map: Record<string, string> = {
    TAG: "Tag",
    TYPE: "Type",
    TITLE: "Title",
    VENDOR: "Vendor",
    VARIANT_PRICE: "Price",
    VARIANT_COMPARE_AT_PRICE: "Compare-at price",
    VARIANT_WEIGHT: "Weight",
    VARIANT_INVENTORY: "Inventory",
    VARIANT_TITLE: "Variant",
    IS_PRICE_REDUCED: "On sale",
  };
  return map[column] ?? column.toLowerCase().replace(/_/g, " ");
}

function humanizeRelation(relation: string): string {
  const map: Record<string, string> = {
    EQUALS: "=",
    NOT_EQUALS: "\u2260",
    CONTAINS: "contains",
    NOT_CONTAINS: "excludes",
    STARTS_WITH: "starts with",
    ENDS_WITH: "ends with",
    GREATER_THAN: ">",
    LESS_THAN: "<",
    IS_SET: "is set",
    IS_NOT_SET: "is not set",
  };
  return map[relation] ?? relation.toLowerCase().replace(/_/g, " ");
}
