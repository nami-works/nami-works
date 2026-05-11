/**
 * Local Delivery Analytics — sub-route at /app/local-delivery/analytics.
 *
 * State machine on `loaderData.kind`:
 *   - "disabled"               → "Enable in Settings" empty state
 *   - "no_ld_usage"            → state #2
 *   - "no_carrier"             → state #3 (teaser if loaderData.teaser, else conservative)
 *   - "auth_failed"            → state #4 (banner + cached data dimmed)
 *   - "partial"                → full view + warning banner with retry button (state #5)
 *   - "full"                   → state #6
 *   - "insufficient_coverage"  → empty state
 *
 * See docs/plans/local-delivery-analytics.md §6.1.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  countLdOrders,
  getHeadlineMetrics,
  getLastSuccessfulHeadline,
  getOrdersForCity,
  getPerCityBreakdown,
  periodToRange,
  computeSpeculativeTeaser,
  type CityRow,
  type DrilldownOrder,
  type HeadlineMetrics,
} from "../services/ld-analytics/queries.server";
import { getActiveCredentialForShop } from "../services/warehouse-carrier/aggregator.server";
import { IntelipostAdapter } from "../services/warehouse-carrier/adapters/intelipost.server";
import { isFraming } from "../services/ld-analytics/pl-math.server";
import { computeAsideData } from "../services/ld-analytics/aside.server";
import styles from "./app.local-delivery.analytics/styles.module.css";

type LoaderResponse =
  | { kind: "disabled" }
  | {
      kind: "no_ld_usage";
      filters: { period: string; locationId: string; cityNorm: string };
    }
  | {
      kind: "no_carrier";
      teaser: { amountSubunits: number; topCity: string; currency: string } | null;
      speculativeSupported: boolean;
      filters: { period: string; locationId: string; cityNorm: string };
    }
  | {
      kind: "auth_failed";
      lastSync: { date: string; metrics: HeadlineMetrics } | null;
      filters: { period: string; locationId: string; cityNorm: string };
    }
  | {
      kind: "insufficient_coverage";
      coveragePercent: number;
      threshold: number;
      filters: { period: string; locationId: string; cityNorm: string };
    }
  | {
      kind: "full" | "partial";
      headline: HeadlineMetrics;
      perCity: CityRow[];
      framing: string;
      threshold: number;
      filters: { period: string; locationId: string; cityNorm: string };
    };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const startedAt = Date.now();
  const url = new URL(request.url);

  // Short-circuit for the LD-page aside fetcher (spec §4). Reuses the
  // existing route to avoid a second route file; returns a small payload
  // shaped for <LdAnalyticsAside>.
  if (url.searchParams.get("aside") === "1") {
    return computeAsideData(shop);
  }

  const period = url.searchParams.get("period") ?? "90d";
  const locationId = url.searchParams.get("location") ?? "all";
  const cityNorm = url.searchParams.get("city") ?? "all";

  console.info(
    `[ld-analytics:loader] loader START shop=${shop} period=${period} location=${locationId} city=${cityNorm}`,
  );
  const filters = { period, locationId, cityNorm };

  const config = await prisma.ldAnalyticsConfig.findUnique({ where: { shop } });

  if (!config?.enabled) {
    console.info(`[ld-analytics:loader] loader OK shop=${shop} kind=disabled`);
    return { kind: "disabled" } satisfies LoaderResponse;
  }

  const range = periodToRange(period);
  const ldOrderCount = await countLdOrders(shop, range);

  if (ldOrderCount === 0) {
    console.info(`[ld-analytics:loader] loader OK shop=${shop} kind=no_ld_usage`);
    return { kind: "no_ld_usage", filters } satisfies LoaderResponse;
  }

  const credential = await getActiveCredentialForShop(shop);
  if (!credential) {
    let teaser = null;
    if (IntelipostAdapter.supportsSpeculativeQuoting) {
      teaser = await computeSpeculativeTeaser(shop, periodToRange("90d"));
    }
    console.info(
      `[ld-analytics:loader] loader OK shop=${shop} kind=no_carrier teaser=${teaser ? "yes" : "no"}`,
    );
    return {
      kind: "no_carrier",
      teaser,
      speculativeSupported: IntelipostAdapter.supportsSpeculativeQuoting,
      filters,
    } satisfies LoaderResponse;
  }

  try {
    const [headline, perCity] = await Promise.all([
      getHeadlineMetrics(shop, range),
      getPerCityBreakdown(shop, range, cityNorm === "all" ? undefined : cityNorm),
    ]);

    const threshold = config.partialDataThresholdPercent;

    if (headline.coveragePercent < threshold) {
      console.info(
        `[ld-analytics:loader] loader OK shop=${shop} kind=insufficient_coverage coverage=${headline.coveragePercent}%`,
      );
      return {
        kind: "insufficient_coverage",
        coveragePercent: headline.coveragePercent,
        threshold,
        filters,
      } satisfies LoaderResponse;
    }

    const kind = headline.coveragePercent < 100 ? "partial" : "full";
    const elapsed = Date.now() - startedAt;
    console.info(
      `[ld-analytics:loader] loader OK shop=${shop} kind=${kind} cities=${perCity.length} coverage=${headline.coveragePercent}% elapsed=${elapsed}ms`,
    );
    return {
      kind,
      headline,
      perCity,
      framing: config.headlineFraming,
      threshold,
      filters,
    } satisfies LoaderResponse;
  } catch (error) {
    console.error(`[ld-analytics:loader] loader FAILED shop=${shop}`, error);
    const lastSyncRaw = await getLastSuccessfulHeadline(shop);
    const lastSync = lastSyncRaw
      ? { date: lastSyncRaw.date.toISOString(), metrics: lastSyncRaw.metrics }
      : null;
    return { kind: "auth_failed", lastSync, filters } satisfies LoaderResponse;
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  console.info(`[ld-analytics:loader] action intent=${intent ?? "?"} shop=${shop}`);

  if (intent === "switch-framing") {
    const framing = String(formData.get("framing") ?? "");
    if (!isFraming(framing)) {
      return { ok: false, error: "invalid_framing" };
    }
    const before = await prisma.ldAnalyticsConfig.findUnique({
      where: { shop },
      select: { headlineFraming: true },
    });
    await prisma.ldAnalyticsConfig.upsert({
      where: { shop },
      create: { shop, headlineFraming: framing },
      update: { headlineFraming: framing },
    });
    console.info(
      `[ld-analytics:framing-change] framing changed shop=${shop} from=${before?.headlineFraming ?? "?"} to=${framing}`,
    );
    return { ok: true, framing };
  }

  if (intent === "save-overrides") {
    const perCityTaxSavings = formData.get("perCityTaxSavingsJson");
    const perLocationWarehouseCost = formData.get("perLocationWarehouseCostJson");
    let perCityParsed: unknown = {};
    let perLocParsed: unknown = {};
    try {
      perCityParsed = perCityTaxSavings ? JSON.parse(String(perCityTaxSavings)) : {};
      perLocParsed = perLocationWarehouseCost
        ? JSON.parse(String(perLocationWarehouseCost))
        : {};
    } catch {
      return { ok: false, error: "invalid_json" };
    }
    await prisma.ldAnalyticsConfig.upsert({
      where: { shop },
      create: {
        shop,
        perCityTaxSavingsJson: perCityParsed as object,
        perLocationWarehouseCostJson: perLocParsed as object,
      },
      update: {
        perCityTaxSavingsJson: perCityParsed as object,
        perLocationWarehouseCostJson: perLocParsed as object,
      },
    });
    return { ok: true };
  }

  if (intent === "load-drilldown") {
    const cityNorm = String(formData.get("cityNorm") ?? "");
    const period = String(formData.get("period") ?? "90d");
    if (!cityNorm) return { ok: false, error: "missing_city" };
    const range = periodToRange(period);
    const orders = await getOrdersForCity(shop, cityNorm, range, 50);
    return {
      ok: true,
      orders: orders.map((o: DrilldownOrder) => ({
        ...o,
        orderDate: o.orderDate.toISOString(),
      })),
    };
  }

  if (intent === "retry-uncovered") {
    // V1 — no actual carrier quoting from this action; the cron handles
    // refreshes. Returning ok lets the UI dismiss the partial-data banner.
    return { ok: true };
  }

  return { ok: false, error: "unknown_intent" };
};

// ────────────────────────────────────────────────────────────
//  Page component
// ────────────────────────────────────────────────────────────

function formatCurrency(amountSubunits: number, currency: string): string {
  const formatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  return formatter.format(amountSubunits / 100);
}

function formatSignedCurrency(amountSubunits: number, currency: string): string {
  const formatted = formatCurrency(Math.abs(amountSubunits), currency);
  return amountSubunits >= 0 ? `+${formatted}` : `-${formatted}`;
}

export default function LocalDeliveryAnalyticsPage() {
  const data = useLoaderData<typeof loader>() as LoaderResponse;
  const { t } = useTranslation("ld-analytics");
  const [searchParams, setSearchParams] = useSearchParams();

  const period =
    "filters" in data && data.filters?.period ? data.filters.period : "90d";

  const setPeriod = (next: string) => {
    const sp = new URLSearchParams(searchParams);
    sp.set("period", next);
    setSearchParams(sp);
  };

  return (
    <s-page
      heading={t("page.title")}
      back-action={
        <Link to="/app/local-delivery" className={styles.backLink}>
          {t("page.backLabel")}
        </Link>
      }
    >
      <s-stack direction="block" gap="base">
        <FilterBar period={period} onPeriodChange={setPeriod} />

        {data.kind === "disabled" && <DisabledState />}
        {data.kind === "no_ld_usage" && <NoLdUsageState />}
        {data.kind === "no_carrier" && (
          <NoCarrierState
            teaser={data.teaser}
            speculativeSupported={data.speculativeSupported}
          />
        )}
        {data.kind === "insufficient_coverage" && (
          <InsufficientCoverageState
            coveragePercent={data.coveragePercent}
            threshold={data.threshold}
          />
        )}
        {data.kind === "auth_failed" && <AuthFailedState lastSync={data.lastSync} />}
        {(data.kind === "full" || data.kind === "partial") && (
          <FullView
            headline={data.headline}
            perCity={data.perCity}
            framing={data.framing}
            partial={data.kind === "partial"}
          />
        )}
      </s-stack>
    </s-page>
  );
}

// ── filter bar ──

function FilterBar({
  period,
  onPeriodChange,
}: {
  period: string;
  onPeriodChange: (next: string) => void;
}) {
  const { t } = useTranslation("ld-analytics");
  return (
    <s-section>
      <div className={styles.filterRow}>
        <div className={styles.filterControl}>
          <span className={styles.filterLabel}>{t("filters.period.label")}</span>
          <s-select
            label={t("filters.period.label")}
            labelAccessibilityVisibility="exclusive"
            value={period}
            onChange={(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              onPeriodChange(v);
            }}
          >
            <s-option value="7d">{t("filters.period.values.7d")}</s-option>
            <s-option value="30d">{t("filters.period.values.30d")}</s-option>
            <s-option value="90d">{t("filters.period.values.90d")}</s-option>
            <s-option value="365d">{t("filters.period.values.365d")}</s-option>
          </s-select>
        </div>
      </div>
    </s-section>
  );
}

// ── empty / error states ──

function DisabledState() {
  const { t } = useTranslation("ld-analytics");
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <h2 className={styles.stateTitle}>{t("states.disabled.title")}</h2>
        <p className={styles.stateBody}>{t("states.disabled.body")}</p>
        <div className={styles.stateActions}>
          <Link to="/app/settings?tab=providers" className={styles.primaryLink}>
            <s-button variant="primary">{t("states.disabled.primaryCta")}</s-button>
          </Link>
        </div>
      </s-stack>
    </s-section>
  );
}

function NoLdUsageState() {
  const { t } = useTranslation("ld-analytics");
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <h2 className={styles.stateTitle}>{t("states.noLdUsage.title")}</h2>
        <p className={styles.stateBody}>{t("states.noLdUsage.body")}</p>
        <div className={styles.stateActions}>
          <Link to="/app/local-delivery" className={styles.primaryLink}>
            <s-button variant="primary">{t("states.noLdUsage.primaryCta")}</s-button>
          </Link>
        </div>
      </s-stack>
    </s-section>
  );
}

function NoCarrierState({
  teaser,
  speculativeSupported,
}: {
  teaser: { amountSubunits: number; topCity: string; currency: string } | null;
  speculativeSupported: boolean;
}) {
  const { t } = useTranslation("ld-analytics");
  const showTeaser = speculativeSupported && teaser;
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        {showTeaser ? (
          <>
            <h2 className={styles.stateTitle}>
              {t("states.noCarrier.title_teaser", {
                amount: formatCurrency(teaser.amountSubunits, teaser.currency),
              })}
            </h2>
            <p className={styles.stateBody}>
              {t("states.noCarrier.body_teaser", {
                city: teaser.topCity,
                plDelta: formatCurrency(teaser.amountSubunits, teaser.currency),
              })}
            </p>
            <p className={styles.stateDisclaimer}>
              {t("states.noCarrier.teaserDisclaimer")}
            </p>
          </>
        ) : (
          <>
            <h2 className={styles.stateTitle}>{t("states.noCarrier.title_conservative")}</h2>
            <p className={styles.stateBody}>{t("states.noCarrier.body_conservative")}</p>
          </>
        )}
        <div className={styles.stateActions}>
          <Link to="/app/settings?tab=providers" className={styles.primaryLink}>
            <s-button variant="primary">{t("states.noCarrier.primaryCta")}</s-button>
          </Link>
        </div>
      </s-stack>
    </s-section>
  );
}

function AuthFailedState({
  lastSync,
}: {
  lastSync: { date: string; metrics: HeadlineMetrics } | null;
}) {
  const { t } = useTranslation("ld-analytics");
  return (
    <>
      <s-banner tone="critical">
        <s-stack direction="block" gap="small">
          <strong>{t("states.authFailed.title")}</strong>
          <span>
            {t("states.authFailed.body", {
              date: lastSync ? new Date(lastSync.date).toLocaleString() : "—",
            })}
          </span>
          <div className={styles.bannerActions}>
            <Link to="/app/settings?tab=providers" className={styles.primaryLink}>
              <s-button variant="primary">{t("states.authFailed.reconnect")}</s-button>
            </Link>
          </div>
        </s-stack>
      </s-banner>
      {lastSync && (
        <div className={styles.dimmed}>
          <FullView
            headline={lastSync.metrics}
            perCity={[]}
            framing="net_cost_delta"
            partial={true}
          />
        </div>
      )}
    </>
  );
}

function InsufficientCoverageState({
  coveragePercent,
  threshold,
}: {
  coveragePercent: number;
  threshold: number;
}) {
  const { t } = useTranslation("ld-analytics");
  const retryFetcher = useFetcher();
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <h2 className={styles.stateTitle}>{t("states.insufficientCoverage.title")}</h2>
        <p className={styles.stateBody}>
          {t("states.insufficientCoverage.body", { threshold })}
        </p>
        <div className={styles.stateActions}>
          <s-button
            variant="primary"
            onClick={() => {
              const fd = new FormData();
              fd.append("intent", "retry-uncovered");
              retryFetcher.submit(fd, { method: "post" });
            }}
            loading={retryFetcher.state !== "idle" || undefined}
          >
            {t("states.insufficientCoverage.retry")}
          </s-button>
        </div>
        <p className={styles.stateDisclaimer}>{`Coverage: ${coveragePercent}%`}</p>
      </s-stack>
    </s-section>
  );
}

// ── full view (state #5 / #6) ──

function FullView({
  headline,
  perCity,
  framing,
  partial,
}: {
  headline: HeadlineMetrics;
  perCity: CityRow[];
  framing: string;
  partial: boolean;
}) {
  const { t } = useTranslation("ld-analytics");
  const framingFetcher = useFetcher<{ ok: boolean; framing?: string }>();
  const drilldownFetcher = useFetcher<{
    ok: boolean;
    orders?: Array<DrilldownOrder & { orderDate: string }>;
  }>();
  const retryFetcher = useFetcher();
  const [activeFraming, setActiveFraming] = useState<string>(framing);
  const [expandedCity, setExpandedCity] = useState<string | null>(null);
  const [drilldownByCity, setDrilldownByCity] = useState<
    Record<string, Array<DrilldownOrder & { orderDate: string }>>
  >({});

  const switchFraming = (next: string) => {
    setActiveFraming(next);
    const fd = new FormData();
    fd.append("intent", "switch-framing");
    fd.append("framing", next);
    framingFetcher.submit(fd, { method: "post" });
  };

  const headlineValue =
    activeFraming === "revenue_retained"
      ? headline.revenueRetained
      : activeFraming === "net_cost_delta"
        ? headline.netCostDelta
        : headline.plImpact;

  const onCityClick = (city: CityRow) => {
    if (expandedCity === city.cityNorm) {
      setExpandedCity(null);
      return;
    }
    setExpandedCity(city.cityNorm);
    if (!drilldownByCity[city.cityNorm]) {
      const fd = new FormData();
      fd.append("intent", "load-drilldown");
      fd.append("cityNorm", city.cityNorm);
      fd.append("period", "90d");
      drilldownFetcher.submit(fd, { method: "post" });
    }
  };

  // Poll fetcher result and copy into state.
  if (
    drilldownFetcher.data?.ok &&
    drilldownFetcher.data.orders &&
    expandedCity &&
    !drilldownByCity[expandedCity]
  ) {
    setDrilldownByCity((prev) => ({
      ...prev,
      [expandedCity]: drilldownFetcher.data!.orders!,
    }));
  }

  const headlineKey =
    activeFraming === "revenue_retained"
      ? "revenue_retained"
      : activeFraming === "net_cost_delta"
        ? "net_cost_delta"
        : "pl_impact";

  return (
    <>
      {partial && (
        <s-banner tone="warning">
          <s-stack direction="block" gap="small">
            <strong>
              {t("states.partial.title", {
                uncovered: headline.ldOrderCount - Math.round((headline.ldOrderCount * headline.coveragePercent) / 100),
                total: headline.ldOrderCount,
                coverage: headline.coveragePercent,
              })}
            </strong>
            <span>
              {t("states.partial.body", {
                covered: Math.round((headline.ldOrderCount * headline.coveragePercent) / 100),
              })}
            </span>
            <div className={styles.bannerActions}>
              <s-button
                variant="primary"
                onClick={() => {
                  const fd = new FormData();
                  fd.append("intent", "retry-uncovered");
                  retryFetcher.submit(fd, { method: "post" });
                }}
                loading={retryFetcher.state !== "idle" || undefined}
              >
                {t("states.partial.retry")}
              </s-button>
            </div>
          </s-stack>
        </s-banner>
      )}

      <s-section>
        <div className={styles.headlineCard}>
          <div className={styles.headlineLabelRow}>
            <span className={styles.headlineLabel}>{t(`headline.${headlineKey}.label`)}</span>
            <button
              type="button"
              className={styles.framingSwitch}
              aria-label={t("headline.switchAriaLabel")}
              title={t("headline.switchPickerTitle")}
              onClick={() => {
                const order = ["pl_impact", "revenue_retained", "net_cost_delta"];
                const idx = order.indexOf(activeFraming);
                const next = order[(idx + 1) % order.length];
                switchFraming(next);
              }}
            >
              ⇅
            </button>
          </div>
          <div className={styles.headlineValue}>
            {formatSignedCurrency(headlineValue, headline.currencyCode)}
          </div>
          <p className={styles.headlineFootnote}>{t(`headline.${headlineKey}.footnote`)}</p>
        </div>

        <div className={styles.supportingRow}>
          <div className={styles.supportingCard}>
            <div className={styles.supportingLabel}>{t("supporting.ldNet.label")}</div>
            <div className={styles.supportingValue}>
              {formatCurrency(headline.ldNet, headline.currencyCode)}
            </div>
            <div className={styles.supportingSubtitle}>
              {t("supporting.ldNet.subtitle", {
                charged: formatCurrency(headline.ldRevenueSubunits, headline.currencyCode),
                tax: formatCurrency(headline.taxSavingsSubunits, headline.currencyCode),
                cost: formatCurrency(headline.ldCarrierCostSubunits, headline.currencyCode),
              })}
            </div>
          </div>
          <div className={styles.supportingCard}>
            <div className={styles.supportingLabel}>{t("supporting.whNet.label")}</div>
            <div className={styles.supportingValue}>
              {formatCurrency(headline.whCounterfactualNet, headline.currencyCode)}
            </div>
            <div className={styles.supportingSubtitle}>
              {t("supporting.whNet.subtitle", {
                rate: formatCurrency(headline.warehouseCustomerRateSubunits, headline.currencyCode),
                cost: formatCurrency(headline.warehouseCounterfactualSubunits, headline.currencyCode),
              })}
            </div>
          </div>
        </div>
      </s-section>

      <s-section heading={t("table.title")}>
        <p className={styles.tableSubtitle}>{t("table.subtitle")}</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("table.headers.city")}</th>
                <th className={styles.tdNumeric}>{t("table.headers.orders")}</th>
                <th className={styles.tdNumeric}>{t("table.headers.ldCharged")}</th>
                <th className={styles.tdNumeric}>{t("table.headers.whRate")}</th>
                <th className={styles.tdNumeric}>{t("table.headers.ldNet")}</th>
                <th className={styles.tdNumeric}>{t("table.headers.whNet")}</th>
                <th className={styles.tdNumeric}>{t("table.headers.plDelta")}</th>
              </tr>
            </thead>
            <tbody>
              {perCity.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.emptyRow}>
                    {t("states.drilldownEmpty")}
                  </td>
                </tr>
              ) : (
                perCity.map((city) => (
                  <CityTableRow
                    key={city.cityNorm}
                    city={city}
                    expanded={expandedCity === city.cityNorm}
                    drilldown={drilldownByCity[city.cityNorm]}
                    drilldownLoading={
                      expandedCity === city.cityNorm && drilldownFetcher.state !== "idle"
                    }
                    onClick={() => onCityClick(city)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </s-section>
    </>
  );
}

function CityTableRow({
  city,
  expanded,
  drilldown,
  drilldownLoading,
  onClick,
}: {
  city: CityRow;
  expanded: boolean;
  drilldown?: Array<DrilldownOrder & { orderDate: string }>;
  drilldownLoading: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation("ld-analytics");
  return (
    <>
      <tr
        className={`${styles.cityRow}${expanded ? ` ${styles.cityRowExpanded}` : ""}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
      >
        <td>{city.cityDisplay}</td>
        <td className={styles.tdNumeric}>{city.orderCount}</td>
        <td className={styles.tdNumeric}>
          {formatCurrency(city.ldRevenueSubunits, "BRL")}
        </td>
        <td className={styles.tdNumeric}>
          {formatCurrency(city.warehouseCustomerRateSubunits, "BRL")}
        </td>
        <td className={styles.tdNumeric}>{formatCurrency(city.ldNet, "BRL")}</td>
        <td className={styles.tdNumeric}>
          {formatCurrency(city.whCounterfactualNet, "BRL")}
        </td>
        <td className={`${styles.tdNumeric} ${city.plDelta >= 0 ? styles.positive : styles.negative}`}>
          {formatSignedCurrency(city.plDelta, "BRL")}
        </td>
      </tr>
      {expanded && (
        <tr className={styles.drilldownRow}>
          <td colSpan={7}>
            {drilldownLoading ? (
              <div className={styles.drilldownLoading}>
                {t("states.drilldownLoading", { n: city.orderCount })}
              </div>
            ) : drilldown && drilldown.length > 0 ? (
              <table className={styles.drilldownTable}>
                <thead>
                  <tr>
                    <th>{t("table.drilldown.headers.order")}</th>
                    <th>{t("table.drilldown.headers.date")}</th>
                    <th className={styles.tdNumeric}>{t("table.drilldown.headers.ldCharged")}</th>
                    <th className={styles.tdNumeric}>{t("table.drilldown.headers.whRate")}</th>
                    <th className={styles.tdNumeric}>{t("table.drilldown.headers.ldCost")}</th>
                    <th className={styles.tdNumeric}>{t("table.drilldown.headers.whCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.map((order) => (
                    <tr key={order.orderId}>
                      <td>
                        {order.orderName}
                        {order.isFreeShipped && (
                          <span className={styles.freeShipBadge}>
                            {t("table.drilldown.freeShipBadge")}
                          </span>
                        )}
                      </td>
                      <td>{new Date(order.orderDate).toLocaleDateString()}</td>
                      <td className={styles.tdNumeric}>
                        {formatCurrency(order.ldRevenueSubunits, "BRL")}
                      </td>
                      <td className={styles.tdNumeric}>
                        {formatCurrency(order.warehouseCustomerRateSubunits, "BRL")}
                      </td>
                      <td className={styles.tdNumeric}>
                        {formatCurrency(order.ldCarrierCostSubunits, "BRL")}
                      </td>
                      <td className={styles.tdNumeric}>
                        {formatCurrency(order.warehouseCounterfactualSubunits, "BRL")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={styles.drilldownEmpty}>{t("states.drilldownEmpty")}</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
