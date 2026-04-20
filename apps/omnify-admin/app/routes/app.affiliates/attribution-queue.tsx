import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { TFunction } from "i18next";
import styles from "./styles.module.css";
import type {
  AttributionQueueRow,
  AttributionQueueSnapshot,
  AttributionTabLoaderData,
  ForgottenClaim,
} from "../../affiliates/attribution.server";

type Props = {
  shop: string;
  meta: AttributionTabLoaderData;
  userLocale: string;
  t: TFunction<"affiliates">;
};

type FetchOk = {
  ok: true;
  intent: "attribution-fetch-queue";
  snapshot: AttributionQueueSnapshot;
  forgotten: ForgottenClaim[];
  tabMeta: AttributionTabLoaderData;
};
type FetchErr = {
  ok: false;
  intent: "attribution-fetch-queue";
  error: string;
};
type ClaimOk = {
  ok: true;
  intent: "attribution-claim-order";
  claimId: string;
  alreadyExisted: boolean;
  orderName: string;
};
type UnclaimOk = {
  ok: true;
  intent: "attribution-unclaim-order";
  deleted: boolean;
  orderName: string;
};
type ImportOk = {
  ok: true;
  intent: "attribution-import-pedidos-csv";
  result: {
    importId: string;
    rowCount: number;
    maxOrderDate: string | null;
    claimsConfirmedNow: number;
    unmatchedOrderNamesCount: number;
  };
  tabMeta: AttributionTabLoaderData;
};

const LOOKBACK_OPTIONS: Array<{ value: number; tKey: string; fallback: string }> = [
  { value: 30, tKey: "attributionQueue.lookback30", fallback: "30 days" },
  { value: 90, tKey: "attributionQueue.lookback90", fallback: "90 days" },
  { value: 180, tKey: "attributionQueue.lookback180", fallback: "180 days" },
  { value: 365, tKey: "attributionQueue.lookback365", fallback: "1 year" },
];

function shopSlug(shop: string): string {
  return shop.replace(/\.myshopify\.com$/, "");
}

function adminOrderUrl(shop: string, orderGid: string): string {
  const id = orderGid.split("/").pop() ?? "";
  return `https://admin.shopify.com/store/${shopSlug(shop)}/orders/${id}`;
}

function fmtBRL(value: number, locale: string): string {
  try {
    return value.toLocaleString(locale, {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `R$ ${value.toFixed(2)}`;
  }
}

function fmtDateShort(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function searchBlob(row: AttributionQueueRow): string {
  return [
    row.orderName,
    row.primaryCoupon,
    row.matchedProfile?.affiliateName ?? "",
    row.matchedProfile?.email ?? "",
    row.locationLabel ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

type CopyBtnProps = { text: string; label: string; t: TFunction<"affiliates"> };

function CopyBtn({ text, label, t }: CopyBtnProps) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`${styles.attributionCopyBtn}${copied ? ` ${styles.attributionCopyBtnCopied}` : ""}`}
      title={copied ? t("attributionQueue.row.copied") : t("attributionQueue.row.copyTooltip")}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore
        }
      }}
    >
      {label}
    </button>
  );
}

export function AttributionQueue({ shop, meta, userLocale, t }: Props) {
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const [search, setSearch] = useState("");
  const [snapshot, setSnapshot] = useState<AttributionQueueSnapshot | null>(null);
  const [forgotten, setForgotten] = useState<ForgottenClaim[]>([]);
  const [currentMeta, setCurrentMeta] = useState<AttributionTabLoaderData>(meta);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [importToast, setImportToast] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Per-order optimistic claim state. Orders override snapshot classification.
  // Value: "claimed" or "unclaimed" (removed from snapshot back to pending).
  const [optimisticClaims, setOptimisticClaims] = useState<
    Record<string, "claimed" | "unclaimed">
  >({});

  const fetchFetcher = useFetcher<FetchOk | FetchErr>();
  const rowFetcher = useFetcher<ClaimOk | UnclaimOk | { ok: false; error: string }>();
  const importFetcher = useFetcher<ImportOk | { ok: false; error: string }>();
  const pedidosInputRef = useRef<HTMLInputElement | null>(null);

  const isFetching = fetchFetcher.state !== "idle";
  const isImporting = importFetcher.state !== "idle";

  // Response handlers
  useEffect(() => {
    const d = fetchFetcher.data;
    if (!d) return;
    if (d.ok) {
      setSnapshot(d.snapshot);
      setForgotten(d.forgotten);
      setCurrentMeta(d.tabMeta);
      setFetchError(null);
      setOptimisticClaims({}); // server state is now authoritative
    } else {
      setFetchError(d.error);
    }
  }, [fetchFetcher.data]);

  useEffect(() => {
    const d = importFetcher.data;
    if (!d) return;
    if (d.ok) {
      setCurrentMeta(d.tabMeta);
      setImportError(null);
      const r = d.result;
      const msg = r.maxOrderDate
        ? t("attributionQueue.import.successWithDate", {
            rows: r.rowCount,
            date: fmtDateShort(r.maxOrderDate, userLocale),
            confirmed: r.claimsConfirmedNow,
          })
        : t("attributionQueue.import.success", {
            rows: r.rowCount,
            confirmed: r.claimsConfirmedNow,
          });
      setImportToast(msg);
      setTimeout(() => setImportToast(null), 6000);
    } else {
      setImportError(
        t("attributionQueue.import.error", { error: d.error ?? "?" }),
      );
    }
  }, [importFetcher.data, t, userLocale]);

  useEffect(() => {
    const d = rowFetcher.data;
    if (!d || d.ok) return;
    // Rollback optimistic on failure — refetch to get authoritative state.
    // Crude but correct. Row-level optimistic toggle is already shown, user
    // will see the revert on next refresh.
    console.error("[attribution] row action failed:", d);
  }, [rowFetcher.data]);

  const handleRefresh = () => {
    const fd = new FormData();
    fd.append("intent", "attribution-fetch-queue");
    fd.append("lookbackDays", String(lookbackDays));
    fetchFetcher.submit(fd, { method: "post" });
  };

  const handleMark = (row: AttributionQueueRow) => {
    setOptimisticClaims((prev) => ({ ...prev, [row.orderName]: "claimed" }));
    const fd = new FormData();
    fd.append("intent", "attribution-claim-order");
    fd.append("orderName", row.orderName);
    fd.append("orderGid", row.orderGid);
    fd.append("couponCode", row.primaryCoupon);
    if (row.matchedProfile?.code)
      fd.append("affiliateCode", row.matchedProfile.code);
    if (row.matchedProfile?.email)
      fd.append("affiliateEmail", row.matchedProfile.email);
    fd.append("subtotal", String(row.subtotal));
    fd.append("currencyCode", row.currencyCode);
    fd.append("sourceName", row.sourceName);
    fd.append("orderDate", row.orderDate);
    rowFetcher.submit(fd, { method: "post" });
  };

  const handleUnmark = (orderName: string) => {
    setOptimisticClaims((prev) => ({ ...prev, [orderName]: "unclaimed" }));
    const fd = new FormData();
    fd.append("intent", "attribution-unclaim-order");
    fd.append("orderName", orderName);
    rowFetcher.submit(fd, { method: "post" });
  };

  const handlePedidosUploadClick = () => {
    pedidosInputRef.current?.click();
  };

  const handlePedidosFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const fd = new FormData();
      fd.append("intent", "attribution-import-pedidos-csv");
      fd.append("csvText", text);
      fd.append("fileName", file.name);
      importFetcher.submit(fd, { method: "post" });
    };
    reader.readAsText(file);
  };

  // Apply optimistic claims to snapshot rows.
  const effectiveRows = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.rows.map((r) => {
      const override = optimisticClaims[r.orderName];
      if (!override) return r;
      if (override === "claimed" && r.classification !== "claimed") {
        return { ...r, classification: "claimed" as const };
      }
      if (override === "unclaimed" && r.classification === "claimed") {
        return { ...r, classification: "pending" as const };
      }
      return r;
    });
  }, [snapshot, optimisticClaims]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return effectiveRows;
    return effectiveRows.filter((r) => searchBlob(r).includes(q));
  }, [effectiveRows, search]);

  const pending = filteredRows.filter((r) => r.classification === "pending");
  const claimed = filteredRows.filter((r) => r.classification === "claimed");
  const unknown = filteredRows.filter((r) => r.classification === "unknown");

  const pendingTotal = pending.reduce((sum, r) => sum + r.subtotal, 0);

  const warnings: string[] = [];
  if (!currentMeta.lastPedidosImport) {
    warnings.push(t("attributionQueue.warning.pedidosMissing"));
  } else if ((currentMeta.lastPedidosImport.ageDays ?? 0) > 7) {
    warnings.push(
      t("attributionQueue.warning.pedidosStale", {
        days: currentMeta.lastPedidosImport.ageDays,
        date: fmtDateShort(
          currentMeta.lastPedidosImport.importedAt,
          userLocale,
        ),
      }),
    );
  }
  if (snapshot && snapshot.stats.unknown > 0) {
    warnings.push(
      t("attributionQueue.warning.unknownCoupons", {
        count: snapshot.stats.unknown,
      }),
    );
  }

  return (
    <div className={styles.attributionSection}>
      <div className={styles.attributionHeader}>
        <s-text>
          {t(
            "attributionQueue.subtitle",
            "Orders from non-BixGrow channels (IGLU POS, WhatsApp) that need manual entry in BixGrow",
          )}
        </s-text>
      </div>

      {/* Controls row */}
      <div className={styles.attributionControls}>
        <input
          type="text"
          className={styles.attributionSearch}
          placeholder={t(
            "attributionQueue.searchPlaceholder",
            "Search order, coupon, affiliate…",
          )}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className={styles.attributionLookbackLabel}>
          <span>{t("attributionQueue.lookbackLabel", "Look back")}</span>
          <select
            className={styles.attributionLookbackSelect}
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value))}
          >
            {LOOKBACK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.tKey, o.fallback)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.attributionActionsRight}>
          {isFetching ? (
            <s-button variant="primary" disabled key="refresh-disabled">
              {t("attributionQueue.refreshing", "Scanning Shopify…")}
            </s-button>
          ) : (
            <s-button variant="primary" key="refresh-active" onClick={handleRefresh}>
              {t("attributionQueue.refresh", "Refresh queue")}
            </s-button>
          )}
          {isImporting ? (
            <s-button variant="secondary" disabled key="upload-disabled">
              {t("attributionQueue.refreshing", "…")}
            </s-button>
          ) : (
            <s-button
              variant="secondary"
              key="upload-active"
              onClick={handlePedidosUploadClick}
            >
              {t("attributionQueue.uploadPedidos", "Upload pedidos.csv")}
            </s-button>
          )}
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className={styles.attributionWarnBanner}>
          <strong>⚠</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {importToast && (
        <div className={styles.attributionSuccessBanner}>{importToast}</div>
      )}
      {importError && (
        <div className={styles.attributionErrorBanner}>{importError}</div>
      )}
      {fetchError && (
        <div className={styles.attributionErrorBanner}>
          {t("attributionQueue.fetch.error", { error: fetchError })}
        </div>
      )}

      {/* Empty state (no fetch yet) */}
      {!snapshot && !isFetching && (
        <div className={styles.attributionEmptyState}>
          <s-text>
            {t(
              "attributionQueue.empty.noFetchYet",
              "Click Refresh queue to scan Shopify for IGLU orders missing from BixGrow.",
            )}
          </s-text>
        </div>
      )}

      {snapshot && (
        <div className={styles.attributionFetchSummary}>
          {t("attributionQueue.fetch.success", {
            scanned: snapshot.scannedCount,
            pending: snapshot.stats.pending,
            claimed: snapshot.stats.claimed,
            unknown: snapshot.stats.unknown,
          })}
          {" · "}
          {fmtDateShort(snapshot.fetchedAt, userLocale)}
        </div>
      )}

      {/* Forgotten section (always from loader, independent of snapshot) */}
      {forgotten.length > 0 && (
        <div
          className={`${styles.attributionSubSection} ${styles.attributionForgottenSection}`}
        >
          <h3 className={styles.attributionSectionHeading}>
            ⚠ {t("attributionQueue.section.forgotten", "Forgotten")} ({forgotten.length})
          </h3>
          <table className={styles.attributionTable}>
            <thead>
              <tr>
                <th>{t("attributionQueue.column.claimedAt", "Claimed")}</th>
                <th>{t("attributionQueue.column.order", "Order")}</th>
                <th>{t("attributionQueue.column.subtotal", "Subtotal")}</th>
                <th>{t("attributionQueue.column.coupon", "Coupon")}</th>
                <th>{t("attributionQueue.column.email", "Email")}</th>
                <th aria-label="action" />
              </tr>
            </thead>
            <tbody>
              {forgotten.map((f) => (
                <tr key={f.id} className={styles.attributionRowForgotten}>
                  <td className={styles.attributionDate}>
                    {t("attributionQueue.row.claimedDaysAgo", {
                      count: f.daysSince,
                    })}
                  </td>
                  <td>
                    <CopyBtn text={`#${f.orderName}`} label={`#${f.orderName}`} t={t} />
                  </td>
                  <td className={styles.attributionNum}>
                    {f.subtotal != null ? fmtBRL(f.subtotal, userLocale) : "—"}
                  </td>
                  <td>
                    <code>{f.couponCode}</code>
                  </td>
                  <td>
                    {f.affiliateEmail ? (
                      <CopyBtn
                        text={f.affiliateEmail}
                        label={f.affiliateEmail}
                        t={t}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {f.orderGid && (
                      <a
                        className={styles.attributionExtLink}
                        href={adminOrderUrl(shop, f.orderGid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t("attributionQueue.row.openInAdmin", "Open in Shopify admin")}
                      >
                        ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pending section */}
      {snapshot && (
        <div className={styles.attributionSubSection}>
          <h3 className={styles.attributionSectionHeading}>
            {t("attributionQueue.section.pending", "Pending attributions")} ({pending.length})
            {pending.length > 0 && (
              <span className={styles.attributionTotalPill}>
                {fmtBRL(pendingTotal, userLocale)}
              </span>
            )}
          </h3>
          {pending.length === 0 ? (
            <div className={styles.attributionEmptyState}>
              <s-text>
                {t(
                  "attributionQueue.empty.nothingPending",
                  "Nothing to do — every eligible order is already in BixGrow.",
                )}
              </s-text>
            </div>
          ) : (
            <QueueTable
              rows={pending}
              shop={shop}
              userLocale={userLocale}
              onToggle={handleMark}
              checked={false}
              t={t}
            />
          )}
        </div>
      )}

      {/* Claimed section */}
      {snapshot && claimed.length > 0 && (
        <div className={styles.attributionSubSection}>
          <h3 className={styles.attributionSectionHeading}>
            {t("attributionQueue.section.claimed", "Claimed, waiting for BixGrow confirmation")} ({claimed.length})
          </h3>
          <QueueTable
            rows={claimed}
            shop={shop}
            userLocale={userLocale}
            onToggle={(row) => handleUnmark(row.orderName)}
            checked={true}
            t={t}
          />
        </div>
      )}

      {/* Unknown coupons section */}
      {snapshot && unknown.length > 0 && (
        <details className={styles.attributionSubSection}>
          <summary className={styles.attributionSectionHeading}>
            {t("attributionQueue.section.unknown", "Unknown coupon codes")} ({unknown.length})
          </summary>
          <p className={styles.attributionHelp}>
            {t(
              "attributionQueue.section.unknownHelp",
              "Orders whose coupon isn't in the affiliate list.",
            )}
          </p>
          <table className={styles.attributionTable}>
            <thead>
              <tr>
                <th>{t("attributionQueue.column.date", "Date")}</th>
                <th>{t("attributionQueue.column.order", "Order")}</th>
                <th>{t("attributionQueue.column.subtotal", "Subtotal")}</th>
                <th>{t("attributionQueue.column.coupon", "Coupon")}</th>
                <th>{t("attributionQueue.column.location", "Location")}</th>
                <th aria-label="action" />
              </tr>
            </thead>
            <tbody>
              {unknown.map((r) => (
                <tr key={r.orderGid}>
                  <td className={styles.attributionDate}>
                    {fmtDateShort(r.orderDate, userLocale)}
                  </td>
                  <td>
                    <CopyBtn text={`#${r.orderName}`} label={`#${r.orderName}`} t={t} />
                  </td>
                  <td className={styles.attributionNum}>
                    {fmtBRL(r.subtotal, userLocale)}
                  </td>
                  <td>
                    <CopyBtn
                      text={r.primaryCoupon}
                      label={r.primaryCoupon}
                      t={t}
                    />
                  </td>
                  <td className={styles.attributionDim}>
                    {r.locationLabel ?? "—"}
                  </td>
                  <td>
                    <a
                      className={styles.attributionExtLink}
                      href={adminOrderUrl(shop, r.orderGid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("attributionQueue.row.openInAdmin", "Open in Shopify admin")}
                    >
                      ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <input
        ref={pedidosInputRef}
        type="file"
        accept=".csv"
        onChange={handlePedidosFileChange}
        className={styles.hiddenFileInput}
      />
    </div>
  );
}

type TableProps = {
  rows: AttributionQueueRow[];
  shop: string;
  userLocale: string;
  onToggle: (row: AttributionQueueRow) => void;
  checked: boolean;
  t: TFunction<"affiliates">;
};

function QueueTable({ rows, shop, userLocale, onToggle, checked, t }: TableProps) {
  return (
    <table className={styles.attributionTable}>
      <thead>
        <tr>
          <th style={{ width: "28px" }} aria-label="done" />
          <th>{t("attributionQueue.column.date", "Date")}</th>
          <th>{t("attributionQueue.column.order", "Order")}</th>
          <th>{t("attributionQueue.column.subtotal", "Subtotal")}</th>
          <th>{t("attributionQueue.column.coupon", "Coupon")}</th>
          <th>{t("attributionQueue.column.affiliate", "Affiliate")}</th>
          <th>{t("attributionQueue.column.email", "Email")}</th>
          <th>{t("attributionQueue.column.location", "Location")}</th>
          <th aria-label="action" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.orderGid}
            className={checked ? styles.attributionRowClaimed : undefined}
          >
            <td>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(r)}
                aria-label={
                  checked
                    ? t("attributionQueue.row.unmark", "Unmark")
                    : t("attributionQueue.row.markProcessed", "Mark processed")
                }
              />
            </td>
            <td className={styles.attributionDate}>
              {fmtDateShort(r.orderDate, userLocale)}
            </td>
            <td>
              <CopyBtn text={`#${r.orderName}`} label={`#${r.orderName}`} t={t} />
            </td>
            <td className={styles.attributionNum}>
              {fmtBRL(r.subtotal, userLocale)}
            </td>
            <td>
              <code>{r.primaryCoupon}</code>
            </td>
            <td>{r.matchedProfile?.affiliateName ?? "—"}</td>
            <td>
              {r.matchedProfile?.email ? (
                <CopyBtn
                  text={r.matchedProfile.email}
                  label={r.matchedProfile.email}
                  t={t}
                />
              ) : (
                "—"
              )}
            </td>
            <td className={styles.attributionDim}>{r.locationLabel ?? "—"}</td>
            <td>
              <a
                className={styles.attributionExtLink}
                href={adminOrderUrl(shop, r.orderGid)}
                target="_blank"
                rel="noopener noreferrer"
                title={t("attributionQueue.row.openInAdmin", "Open in Shopify admin")}
              >
                ↗
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
