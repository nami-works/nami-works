import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import {
  approveSuggestion,
  auditProductImages,
  bulkGenerate,
  DAILY_DRAIN_LIMIT,
  generateSuggestion,
  getAuditSummary,
  listSuggestions,
  rejectSuggestion,
  updateSuggestionText,
} from "../services/storytelling/alt-text.server";
import styles from "./app.storytelling/styles.module.css";

type FilterKey = "all" | "missing" | "weak" | "approved" | "queued" | "applied";

const VALID_FILTERS: FilterKey[] = [
  "all",
  "missing",
  "weak",
  "approved",
  "queued",
  "applied",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const filterParam = (url.searchParams.get("filter") ?? "missing") as FilterKey;
  const filter = VALID_FILTERS.includes(filterParam) ? filterParam : "missing";
  const shouldRefresh = url.searchParams.get("refresh") === "1";

  console.info(`[alt-text] loader START shop=${shop} filter=${filter}`);

  const summary = await getAuditSummary(shop);
  const needsInitialAudit = summary.total === 0;
  if (needsInitialAudit || shouldRefresh) {
    await auditProductImages({ admin, shop }).catch((err) => {
      console.warn(`[alt-text] audit FAILED shop=${shop}`, err);
    });
  }

  const [rows, freshSummary] = await Promise.all([
    listSuggestions({ shop, filter, limit: 200 }),
    getAuditSummary(shop),
  ]);

  const groupsMap = new Map<
    string,
    {
      productId: string;
      productTitle: string | null;
      rows: Array<{
        id: string;
        imageId: string;
        imageUrl: string;
        currentAlt: string | null;
        detectedState: string;
        suggestion: string | null;
        status: string;
        errorMessage: string | null;
      }>;
    }
  >();
  for (const row of rows) {
    const existing = groupsMap.get(row.productId) ?? {
      productId: row.productId,
      productTitle: row.productTitle,
      rows: [],
    };
    existing.rows.push({
      id: row.id,
      imageId: row.imageId,
      imageUrl: row.imageUrl,
      currentAlt: row.currentAlt,
      detectedState: row.detectedState,
      suggestion: row.suggestion,
      status: row.status,
      errorMessage: row.errorMessage,
    });
    groupsMap.set(row.productId, existing);
  }

  return {
    summary: freshSummary,
    filter,
    groups: Array.from(groupsMap.values()),
    dailyLimit: DAILY_DRAIN_LIMIT,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;
  console.info(`[alt-text] action intent=${intent ?? "?"} shop=${shop}`);

  try {
    if (intent === "auditRefresh") {
      const result = await auditProductImages({ admin, shop });
      return { success: true, intent, ...result };
    }

    if (intent === "generateOne") {
      const suggestionId = formData.get("suggestionId") as string;
      const result = await generateSuggestion({ admin, shop, suggestionId });
      if ("error" in result) return { success: false, error: result.error };
      return { success: true, intent, suggestion: result.suggestion };
    }

    if (intent === "bulkGenerate") {
      const result = await bulkGenerate({
        admin,
        shop,
        filter: "missing_or_weak",
      });
      return { success: true, intent, ...result };
    }

    if (intent === "updateSuggestion") {
      const suggestionId = formData.get("suggestionId") as string;
      const suggestion = formData.get("suggestion") as string;
      await updateSuggestionText({ shop, suggestionId, suggestion });
      return { success: true, intent };
    }

    if (intent === "approve") {
      const suggestionId = formData.get("suggestionId") as string;
      const result = await approveSuggestion({ shop, suggestionId });
      if ("error" in result) return { success: false, error: result.error };
      return { success: true, intent };
    }

    if (intent === "reject") {
      const suggestionId = formData.get("suggestionId") as string;
      await rejectSuggestion({ shop, suggestionId });
      return { success: true, intent };
    }
  } catch (err) {
    console.error(`[alt-text] action FAILED shop=${shop}`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  return { success: false, error: "Unknown intent." };
};

export default function AltTextPage() {
  const { summary, filter, groups, dailyLimit } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useTranslation("storytelling");

  const [editing, setEditing] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!fetcher.data) return;
    if ("success" in fetcher.data && fetcher.data.success) {
      const fetcherIntent =
        "intent" in fetcher.data ? fetcher.data.intent : undefined;
      if (fetcherIntent === "approve") shopify.toast?.show?.(t("altText.toast.approved"));
      if (fetcherIntent === "reject") shopify.toast?.show?.(t("altText.toast.rejected"));
      if (fetcherIntent === "generateOne") shopify.toast?.show?.(t("altText.toast.generated"));
      if (fetcherIntent === "auditRefresh") shopify.toast?.show?.(t("altText.toast.auditRefreshed"));
      if (fetcherIntent === "bulkGenerate") shopify.toast?.show?.(t("altText.toast.bulkStarted"));
    } else if ("error" in fetcher.data && fetcher.data.error) {
      shopify.toast?.show?.(
        t("altText.toast.failed", { message: fetcher.data.error }),
      );
    }
  }, [fetcher.data, shopify, t]);

  const setFilter = (key: FilterKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("filter", key);
    setSearchParams(next);
  };

  const isBulkGenerating =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "bulkGenerate";
  const isRefreshing =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "auditRefresh";

  const progressPct = Math.min(
    100,
    Math.round((summary.appliedToday / dailyLimit) * 100),
  );

  return (
    <>
      <s-section heading={t("altText.auditHeading")}>
        <div className={styles.altSummaryRow}>
          <span className={styles.altSummaryText}>
            {summary.total === 0
              ? t("altText.notAuditedYet")
              : t("altText.summary", {
                  missing: summary.missing + summary.weak,
                  total: summary.total,
                })}
          </span>
          <s-stack direction="inline" gap="base">
            <fetcher.Form method="POST">
              <input type="hidden" name="intent" value="auditRefresh" />
              <s-button
                type="submit"
                variant="tertiary"
                {...(isRefreshing ? { loading: true, disabled: true } : {})}
              >
                {t("altText.refreshAudit")}
              </s-button>
            </fetcher.Form>
            <fetcher.Form method="POST">
              <input type="hidden" name="intent" value="bulkGenerate" />
              <s-button
                type="submit"
                variant="primary"
                {...(isBulkGenerating ? { loading: true, disabled: true } : {})}
              >
                {t("altText.generateForMissing")}
              </s-button>
            </fetcher.Form>
          </s-stack>
        </div>

        <div className={styles.altFilterBar}>
          {VALID_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              className={`${styles.altFilterChip}${filter === key ? ` ${styles.altFilterChipActive}` : ""}`}
              onClick={() => setFilter(key)}
            >
              {t(`altText.filters.${key}`)}
            </button>
          ))}
        </div>

        {groups.length === 0 && summary.total > 0 && (
          <s-paragraph> </s-paragraph>
        )}

        {groups.map((group) => (
          <div key={group.productId} className={styles.altProductGroup}>
            <h3 className={styles.altProductTitle}>
              {group.productTitle ?? group.productId}
            </h3>
            {group.rows.map((row, idx) => {
              const editingValue =
                editing[row.id] ?? row.suggestion ?? "";
              const isGenerating =
                fetcher.state !== "idle" &&
                fetcher.formData?.get("suggestionId") === row.id &&
                fetcher.formData?.get("intent") === "generateOne";
              const statePillClass =
                row.status === "queued"
                  ? styles.altStateQueued
                  : row.status === "applied"
                    ? styles.altStateApplied
                    : row.status === "failed"
                      ? styles.altStateFailed
                      : row.detectedState === "missing"
                        ? styles.altStateMissing
                        : row.detectedState === "weak"
                          ? styles.altStateWeak
                          : styles.altStateOk;
              const stateLabel =
                row.status === "queued"
                  ? t("altText.row.queuedAtPosition", { position: idx + 1 })
                  : row.status === "applied"
                    ? t("altText.row.applied")
                    : row.status === "failed"
                      ? t("altText.row.failed", {
                          message: row.errorMessage ?? "",
                        })
                      : row.detectedState === "missing"
                        ? t("altText.row.noAlt")
                        : row.detectedState === "weak"
                          ? t("altText.row.weak")
                          : t("altText.row.ok");

              return (
                <div key={row.id} className={styles.altImageRow}>
                  <img
                    className={styles.altThumbnail}
                    src={row.imageUrl}
                    alt=""
                  />
                  <div className={styles.altRowBody}>
                    <span className={`${styles.altStatePill} ${statePillClass}`}>
                      {stateLabel}
                    </span>
                    {row.currentAlt && (
                      <span className={styles.altCurrentAlt}>
                        {row.currentAlt}
                      </span>
                    )}
                    {row.suggestion !== null && row.status === "pending" && (
                      <textarea
                        className={styles.altSuggestionTextarea}
                        value={editingValue}
                        onChange={(e) =>
                          setEditing((prev) => ({
                            ...prev,
                            [row.id]: e.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (editingValue !== row.suggestion) {
                            fetcher.submit(
                              {
                                intent: "updateSuggestion",
                                suggestionId: row.id,
                                suggestion: editingValue,
                              },
                              { method: "POST" },
                            );
                          }
                        }}
                      />
                    )}
                    <div className={styles.altRowActions}>
                      {row.status === "pending" && row.suggestion === null && (
                        <fetcher.Form method="POST">
                          <input type="hidden" name="intent" value="generateOne" />
                          <input type="hidden" name="suggestionId" value={row.id} />
                          <s-button
                            type="submit"
                            variant="primary"
                            {...(isGenerating ? { loading: true, disabled: true } : {})}
                          >
                            {t("altText.row.generate")}
                          </s-button>
                        </fetcher.Form>
                      )}
                      {row.status === "pending" && row.suggestion !== null && (
                        <>
                          <fetcher.Form method="POST">
                            <input type="hidden" name="intent" value="reject" />
                            <input type="hidden" name="suggestionId" value={row.id} />
                            <s-button type="submit" variant="tertiary">
                              {t("altText.row.reject")}
                            </s-button>
                          </fetcher.Form>
                          <fetcher.Form method="POST">
                            <input type="hidden" name="intent" value="approve" />
                            <input type="hidden" name="suggestionId" value={row.id} />
                            <s-button type="submit" variant="primary">
                              {t("altText.row.approve")}
                            </s-button>
                          </fetcher.Form>
                        </>
                      )}
                      {row.status === "failed" && (
                        <fetcher.Form method="POST">
                          <input type="hidden" name="intent" value="generateOne" />
                          <input type="hidden" name="suggestionId" value={row.id} />
                          <s-button type="submit" variant="secondary">
                            {t("altText.row.retry")}
                          </s-button>
                        </fetcher.Form>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </s-section>

      <s-section slot="aside" heading={t("altText.cadence.heading")}>
        <p className={styles.altCadenceDescription}>
          {t("altText.cadence.description")}
        </p>
        <div className={styles.altProgressBar}>
          <div
            className={styles.altProgressFill}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className={styles.altCadenceStat}>
          <span className={styles.altCadenceLabel}>
            {t("altText.cadence.todayCount", {
              applied: summary.appliedToday,
              limit: dailyLimit,
            })}
          </span>
        </div>
        <div className={styles.altCadenceStat}>
          <span className={styles.altCadenceLabel}>
            {t("altText.cadence.inQueue", { count: summary.queueRemaining })}
          </span>
        </div>
        <div className={styles.altCadenceStat}>
          <span className={styles.altCadenceLabel}>
            {t("altText.cadence.eta", {
              count: summary.etaDays,
              days: summary.etaDays,
            })}
          </span>
        </div>
        <div className={styles.altCadenceStat}>
          <span className={styles.altCadenceLabel}>
            {t("altText.cadence.nextRun")}
          </span>
        </div>
      </s-section>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
