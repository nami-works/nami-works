import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useFetcher } from "react-router";
import styles from "./styles.module.css";
import { KpiCard, type DrillDownKey } from "./kpi-card";
import { formatCustomerShort } from "../../utils/format-name";
import type {
  AcquisitionState,
  AffiliateDetailStats,
} from "../../affiliates/analytics-queries.server";

// Sortable products table (extracted so the sort state is local and doesn't
// rerender the parent when the user clicks headers).
type ProductRow = AffiliateDetailStats["productMix"][number];
type ProductSortKey = "title" | "quantity" | "revenue" | "shareOfAffiliate" | "orderShare";

function ProductsTable({
  rows,
  fmtNum,
  fmtCurrency,
  fmtPct,
  t,
}: {
  rows: ProductRow[];
  fmtNum: (v: number) => string;
  fmtCurrency: (v: number) => string;
  fmtPct: (v: number) => string;
  t: TFunction;
}) {
  const [sortKey, setSortKey] = useState<ProductSortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: ProductSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  };

  const sortArrow = (key: ProductSortKey) => {
    if (sortKey !== key) return null;
    return <span className={styles.sortArrow}>{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const cmp =
        sortKey === "title"
          ? a.title.localeCompare(b.title)
          : (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  return (
    <div className={styles.tableWrap}>
      <table className={styles.leaderboardTable}>
        <thead>
          <tr>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("title")}
            >
              {t("card.product", "Product")} {sortArrow("title")}
            </th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("quantity")}
            >
              {t("card.quantity", "Qty")} {sortArrow("quantity")}
            </th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("revenue")}
            >
              {t("card.revenue", "Revenue")} {sortArrow("revenue")}
            </th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("shareOfAffiliate")}
            >
              {t("profile.products.share", "% of affiliate rev")}{" "}
              {sortArrow("shareOfAffiliate")}
            </th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("orderShare")}
            >
              {t("profile.products.orderShare", "% of orders")}{" "}
              {sortArrow("orderShare")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr key={`${p.productId ?? i}`}>
              <td className={styles.productCell} title={p.title}>
                {p.title}
              </td>
              <td>{fmtNum(p.quantity)}</td>
              <td>{fmtCurrency(p.revenue)}</td>
              <td>{fmtPct(p.shareOfAffiliate)}</td>
              <td>{fmtPct(p.orderShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ProfileDetailProps = {
  code: string;
  startDate: string;
  endDate: string;
  compStart: string | null;
  compEnd: string | null;
  userLocale: string;
  onBack: () => void;
  fmtCurrency: (v: number) => string;
  fmtNum: (v: number) => string;
  fmtPct: (v: number) => string;
  t: TFunction;
};

export function ProfileDetail({
  code,
  startDate,
  endDate,
  compStart,
  compEnd,
  userLocale,
  onBack,
  fmtCurrency,
  fmtNum,
  fmtPct,
  t,
}: ProfileDetailProps) {
  // Independent fetcher so loading state doesn't collide with the parent's
  // fetch-dashboard-stats fetcher.
  const fetcher = useFetcher<{
    ok?: boolean;
    intent?: string;
    detail?: AffiliateDetailStats;
    error?: string;
  }>();

  const [detail, setDetail] = useState<AffiliateDetailStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDrill, setActiveDrill] = useState<DrillDownKey>(null);

  const loading = fetcher.state !== "idle";

  // Refetch whenever the code or the period/comparison inputs change.
  useEffect(() => {
    if (!code || !startDate || !endDate) return;
    const fd = new FormData();
    fd.append("intent", "fetch-affiliate-detail");
    fd.append("affiliateCode", code);
    fd.append("startDate", startDate);
    fd.append("endDate", endDate);
    if (compStart && compEnd) {
      fd.append("compStart", compStart);
      fd.append("compEnd", compEnd);
    }
    fetcher.submit(fd, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, startDate, endDate, compStart, compEnd]);

  useEffect(() => {
    if (fetcher.data?.intent !== "fetch-affiliate-detail") return;
    if (fetcher.data.ok && fetcher.data.detail) {
      setDetail(fetcher.data.detail);
      setError(null);
    } else if (fetcher.data.error) {
      setError(fetcher.data.error);
    }
  }, [fetcher.data]);

  const handleDrillClick = (key: string) =>
    setActiveDrill((prev) => (prev === key ? null : key));

  const identity = detail?.identity;
  const kpis = detail?.kpis;

  // ─── Drill renderers ────────────────────────────────────────────────

  const renderRevenueDrill = () => {
    if (!detail?.monthlyTrend?.length) {
      return <p className={styles.noData}>{t("drill.noData", "No data")}</p>;
    }
    const max = Math.max(...detail.monthlyTrend.map((m) => m.revenue), 1);
    return (
      <>
        <h3 className={styles.waterfallTitle}>
          {t("profile.drill.revenueTrend", "Monthly revenue")}
        </h3>
        <div className={styles.trendChart}>
          {detail.monthlyTrend.map((m) => {
            const h = (m.revenue / max) * 100;
            return (
              <div key={m.month} className={styles.trendBar}>
                <div
                  className={styles.trendBarFill}
                  style={{
                    height: `${h}%`,
                    background:
                      "linear-gradient(180deg, #5ecece, #88c5d6)",
                  }}
                  title={`${m.month}: ${fmtCurrency(m.revenue)}`}
                />
                <span className={styles.trendBarLabel}>{m.month.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  // Acquisition badge: small colored pill. new=teal, lift=amber, leak=red.
  const renderAcquisitionBadge = (state: AcquisitionState) => {
    // Badge tone and chart segment color share the same Polaris palette so
    // the badge on each row reads as the same cohort as the bar above.
    const tone: "success" | "info" | "critical" =
      state === "new" ? "success" : state === "lift" ? "info" : "critical";
    const label =
      state === "new"
        ? t("profile.customers.badgeNew", "New")
        : state === "lift"
          ? t("profile.customers.badgeLift", "Lift")
          : t("profile.customers.badgeLeak", "Leak");
    return <s-badge tone={tone}>{label}</s-badge>;
  };

  const renderCustomersDrill = () => {
    if (!detail?.customers?.length) {
      return <p className={styles.noData}>{t("drill.noData", "No data")}</p>;
    }
    const fmtDate = (iso: string | null) => {
      if (!iso) return "—";
      const d = new Date(iso);
      return new Intl.DateTimeFormat(userLocale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(d);
    };

    // Stacked bar: share of new / lift / leak across all classified customers.
    const cls = detail.classification;
    const liftCount = detail.customers.filter((c) => c.acquisitionState === "lift").length;
    const leakCountInDrill = detail.customers.filter((c) => c.acquisitionState === "leak").length;
    // preCount includes both lift + leak; use classification for the top-line
    // fractions (uncapped), and derive the lift/leak split from the customer
    // sample (capped at 200).
    const preSampleTotal = liftCount + leakCountInDrill;
    const liftShare =
      preSampleTotal > 0 && cls.preCount > 0
        ? (liftCount / preSampleTotal) * cls.preCount
        : 0;
    const leakShare =
      preSampleTotal > 0 && cls.preCount > 0
        ? (leakCountInDrill / preSampleTotal) * cls.preCount
        : 0;
    const totalForBar = Math.max(cls.newCount + cls.preCount, 1);
    const newPct = (cls.newCount / totalForBar) * 100;
    const liftPct = (liftShare / totalForBar) * 100;
    const leakPct = (leakShare / totalForBar) * 100;

    return (
      <>
        <h3 className={styles.waterfallTitle}>
          {t("profile.drill.classification", "Acquisition breakdown")}
        </h3>
        <div className={styles.stackedBarWrap}>
          <div className={styles.stackedBar}>
            {newPct > 0 && (
              <div
                className={`${styles.stackedSegment} ${styles.segNew}`}
                style={{ width: `${newPct}%` }}
                title={t(
                  "profile.classification.tooltipNew",
                  "New customer (never ordered before this affiliate's coupon). The affiliate brought a fresh customer into the store.",
                )}
              >
                {newPct >= 6 && (
                  <span className={styles.stackedLabel}>
                    {fmtNum(cls.newCount)}
                  </span>
                )}
              </div>
            )}
            {liftPct > 0 && (
              <div
                className={`${styles.stackedSegment} ${styles.segLift}`}
                style={{ width: `${liftPct}%` }}
                title={t(
                  "profile.classification.tooltipLift",
                  "Was already a customer, and is now repeating through this affiliate. The coupon is pulling repeat behaviour above the organic baseline, net win if the uplift covers the discount.",
                )}
              >
                {liftPct >= 6 && (
                  <span className={styles.stackedLabel}>
                    {fmtNum(Math.round(liftShare))}
                  </span>
                )}
              </div>
            )}
            {leakPct > 0 && (
              <div
                className={`${styles.stackedSegment} ${styles.segLeak}`}
                style={{ width: `${leakPct}%` }}
                title={t(
                  "profile.classification.tooltipLeak",
                  "Was already a customer and would likely have repeated anyway. The coupon costs margin without changing behaviour; the discount pays for a purchase the store would have captured regardless.",
                )}
              >
                {leakPct >= 6 && (
                  <span className={styles.stackedLabel}>
                    {fmtNum(Math.round(leakShare))}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className={styles.stackedLegend}>
            <span
              title={t(
                "profile.classification.tooltipNew",
                "New customer (never ordered before this affiliate's coupon). The affiliate brought a fresh customer into the store.",
              )}
            >
              <span className={`${styles.legendDot} ${styles.segNew}`} />
              {t("profile.customers.badgeNew", "New")}
            </span>
            <span
              title={t(
                "profile.classification.tooltipLift",
                "Was already a customer, and is now repeating through this affiliate. The coupon is pulling repeat behaviour above the organic baseline, net win if the uplift covers the discount.",
              )}
            >
              <span className={`${styles.legendDot} ${styles.segLift}`} />
              {t("profile.customers.badgeLift", "Lift")}
            </span>
            <span
              title={t(
                "profile.classification.tooltipLeak",
                "Was already a customer and would likely have repeated anyway. The coupon costs margin without changing behaviour; the discount pays for a purchase the store would have captured regardless.",
              )}
            >
              <span className={`${styles.legendDot} ${styles.segLeak}`} />
              {t("profile.customers.badgeLeak", "Leak")}
            </span>
          </div>
        </div>

        <h3 className={`${styles.waterfallTitle} ${styles.drillSectionHeading}`}>
          {t("profile.drill.customers", "Customers driven by this affiliate")}
        </h3>
        <div className={styles.tableWrap}>
          <table className={styles.leaderboardTable}>
            <thead>
              <tr>
                <th>{t("profile.customers.acquisition", "Type")}</th>
                <th>{t("profile.customers.name", "Name")}</th>
                <th>{t("profile.customers.orders", "Orders")}</th>
                <th>{t("profile.customers.spend", "Spend")}</th>
                <th>{t("profile.customers.first", "First order")}</th>
                <th>{t("profile.customers.last", "Last order")}</th>
                <th>{t("profile.customers.topProduct", "Top product")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.customers.map((c) => (
                <tr key={c.customerId}>
                  <td>{renderAcquisitionBadge(c.acquisitionState)}</td>
                  <td>
                    <div className={styles.profileName}>
                      {formatCustomerShort(
                        c.customerName,
                        t("profile.customers.guest", "Guest"),
                      )}
                    </div>
                  </td>
                  <td>{fmtNum(c.orderCount)}</td>
                  <td>{fmtCurrency(c.totalSpend)}</td>
                  <td className={styles.mutedCell}>{fmtDate(c.firstOrderDate)}</td>
                  <td className={styles.mutedCell}>{fmtDate(c.lastOrderDate)}</td>
                  <td>{c.topProductTitle ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderProductsDrill = () => {
    if (!detail?.productMix?.length) {
      return <p className={styles.noData}>{t("drill.noData", "No data")}</p>;
    }
    return (
      <>
        <h3 className={styles.waterfallTitle}>
          {t("profile.drill.productRanking", "Product ranking")}
        </h3>
        <ProductsTable
          rows={detail.productMix}
          fmtNum={fmtNum}
          fmtCurrency={fmtCurrency}
          fmtPct={fmtPct}
          t={t}
        />
      </>
    );
  };

  // ─── Identity header ────────────────────────────────────────────────

  const identityLine = useMemo(() => {
    if (!identity) return null;
    const parts: string[] = [];
    parts.push(`${identity.commissionPct}% ${t("profile.commission", "commission")}`);
    if (identity.tier) parts.push(`${t("profile.tier", "Tier")}: ${identity.tier}`);
    if (identity.status) parts.push(identity.status);
    return parts.join(" · ");
  }, [identity, t]);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailBackRow}>
        <s-button variant="tertiary" onClick={onBack}>
          ← {t("profile.back", "Back to profiles")}
        </s-button>
      </div>

      {error && <s-banner tone="critical">{error}</s-banner>}

      {/* Diagnostic alert ribbon — fires only on the intersection of high
          leakage AND low loyalty-lift. Never sensational; the copy states
          both numbers so Lucas can decide externally (renegotiate / cut /
          change Shopify code mechanics). */}
      {detail?.classification?.isFlagged && (
        <s-banner tone="warning">
          {detail.classification.flagReason}
        </s-banner>
      )}

      {identity && (
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderName}>{identity.affiliateName}</div>
          {identity.instagram && (
            <a
              className={styles.affiliateHandle}
              href={`https://www.instagram.com/${identity.instagram.replace(/^@/, "")}/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{identity.instagram.replace(/^@/, "")}
            </a>
          )}
          {identityLine && (
            <div className={styles.detailHeaderMeta}>{identityLine}</div>
          )}
        </div>
      )}

      {/* 3×1 KpiCard grid — mirrors Overview tab's pattern */}
      <div className={styles.overviewGrid}>
        <KpiCard
          primary={kpis ? fmtCurrency(kpis.revenue.total) : "--"}
          label={t("profile.kpi.revenue", "Revenue")}
          secondary={
            kpis ? (
              <>
                <span className={styles.kpiSecondaryLine}>
                  {fmtNum(kpis.revenue.orderCount)}{" "}
                  {t("card.orders", "orders")}
                </span>
                <span className={styles.kpiSecondaryLine}>
                  {t("profile.kpi.aovLine", {
                    value: fmtCurrency(kpis.revenue.aov),
                    defaultValue: "AOV {{value}}",
                  })}
                </span>
              </>
            ) : (
              ""
            )
          }
          delta={kpis?.revenue.delta}
          drillKey="revenue"
          activeDrill={activeDrill}
          isLoading={loading}
          onClick={handleDrillClick}
        />
        {activeDrill === "revenue" && (
          <div className={styles.drillDown}>{renderRevenueDrill()}</div>
        )}

        <KpiCard
          primary={
            detail?.classification
              ? `${fmtNum(detail.classification.newCount)} ${t("profile.kpi.newCustomers", "new customers")}`
              : "--"
          }
          label={t("profile.kpi.customers", "Customers")}
          secondary={
            detail?.classification ? (
              <>
                <span className={styles.kpiSecondaryLine}>
                  {t("profile.kpi.vsPreexisting", {
                    count: detail.classification.preCount,
                    defaultValue: "vs. {{count}} preexisting",
                  })}
                </span>
                <span
                  className={
                    detail.classification.loyaltyLiftPct > 0.5
                      ? styles.kpiSecondaryPositive
                      : detail.classification.loyaltyLiftPct < -0.5
                        ? styles.kpiSecondaryNegative
                        : styles.kpiSecondaryLine
                  }
                >
                  {(() => {
                    const lift = detail.classification.loyaltyLiftPct;
                    const absLift = Math.abs(lift).toFixed(1);
                    if (lift > 0.5) {
                      return t("profile.kpi.liftPositive", {
                        pct: absLift,
                        defaultValue:
                          "Customers from this affiliate returned {{pct}}% more than organic",
                      });
                    }
                    if (lift < -0.5) {
                      return t("profile.kpi.liftNegative", {
                        pct: absLift,
                        defaultValue:
                          "Customers from this affiliate returned {{pct}}% less than organic",
                      });
                    }
                    return t(
                      "profile.kpi.liftFlat",
                      "Customers from this affiliate matched organic return rate",
                    );
                  })()}
                </span>
              </>
            ) : (
              ""
            )
          }
          drillKey="customers"
          activeDrill={activeDrill}
          isLoading={loading}
          onClick={handleDrillClick}
        />
        {activeDrill === "customers" && (
          <div className={styles.drillDown}>{renderCustomersDrill()}</div>
        )}

        <KpiCard
          primary={
            kpis
              ? `${fmtNum(kpis.products.distinctSkus)} ${t("profile.kpi.productsLabel", "products")}`
              : "--"
          }
          label={t("profile.kpi.products", "Products")}
          secondary={
            kpis ? (
              <>
                <span className={styles.kpiSecondaryLine}>
                  {t("profile.kpi.avgItemsPerOrder", {
                    n: kpis.products.avgItemsPerOrder.toFixed(1),
                    defaultValue: "avg {{n}} items per order",
                  })}
                </span>
                {kpis.products.topTitle && (
                  <span className={styles.kpiSecondaryLine}>
                    {t("profile.kpi.topLabel", "top")}:{" "}
                    {kpis.products.topTitle} · {fmtPct(kpis.products.topShare)}
                  </span>
                )}
              </>
            ) : (
              ""
            )
          }
          delta={kpis?.products.delta}
          drillKey="products"
          activeDrill={activeDrill}
          isLoading={loading}
          onClick={handleDrillClick}
        />
        {activeDrill === "products" && (
          <div className={styles.drillDown}>{renderProductsDrill()}</div>
        )}
      </div>
    </div>
  );
}
