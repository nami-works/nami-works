import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getNavItems, type NavItem } from "../utils/app-identity.server";
import styles from "./app._index/styles.module.css";

// ─── Types the component renders against ────────────────────────────────────
type SetupStepKey = "install" | "lalamove" | "locations" | "customerSync";
type SetupStep = {
  key: SetupStepKey;
  status: "done" | "todo";
  href: string;
};
type SetupState = {
  steps: SetupStep[];
  totalDone: number;
  total: number;
  complete: boolean;
};

type MetricCardData =
  | { kind: "ld"; ordersToday: number; routesToday: number }
  | { kind: "retail"; mtdRevenue: number; currency: string; locationsOnTrack: number; totalLocations: number }
  | { kind: "footprint"; customerCount: number; topCity: string | null }
  | { kind: "affiliates"; last30dRevenue: number; currency: string; activeCodes: number; unmappedCount: number };

type MetricCardKey = "localDelivery" | "retailSales" | "footprintExpansion" | "affiliates";
type MetricCard = {
  key: MetricCardKey;
  href: string;
  icon: SIconType;
  data: MetricCardData | null; // null = empty state
};

type JumpCard = {
  key: string;
  href: string;
  icon: SIconType;
};

type LoaderData = {
  setup: SetupState;
  metrics: MetricCard[];
  jumpCards: JumpCard[];
};

// ─── Setup-state probes ─────────────────────────────────────────────────────
async function getSetupState(shop: string): Promise<SetupState> {
  const [credential, locationConfigCount, retailSync] = await Promise.all([
    prisma.lalamoveShopCredential.findUnique({ where: { shop } }).catch(() => null),
    prisma.lalamoveLocationConfig.count({ where: { shop } }).catch(() => 0),
    prisma.retailSyncMeta.findUnique({ where: { shop } }).catch(() => null),
  ]);

  const steps: SetupStep[] = [
    { key: "install", status: "done", href: "/app" },
    {
      key: "lalamove",
      status: credential ? "done" : "todo",
      href: "/app/settings?tab=providers",
    },
    {
      key: "locations",
      status: locationConfigCount > 0 ? "done" : "todo",
      href: "/app/settings",
    },
    {
      key: "customerSync",
      status: retailSync?.lastSyncedAt ? "done" : "todo",
      href: "/app/footprint-expansion",
    },
  ];
  const totalDone = steps.filter((s) => s.status === "done").length;
  return {
    steps,
    totalDone,
    total: steps.length,
    complete: totalDone === steps.length,
  };
}

// ─── Metric probes (each defensive — failure returns null = empty state) ────
async function getLdToday(shop: string): Promise<MetricCardData | null> {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [openRoutes, dispatchedToday] = await Promise.all([
      prisma.pendingDeliveryRoute.count({
        where: { shop, status: "open" },
      }),
      prisma.lalamoveDispatchJob.count({
        where: { shop, requestedAt: { gte: startOfDay } },
      }),
    ]);
    if (openRoutes === 0 && dispatchedToday === 0) return null;
    return { kind: "ld", ordersToday: openRoutes, routesToday: dispatchedToday };
  } catch {
    return null;
  }
}

async function getRetailMtd(shop: string): Promise<MetricCardData | null> {
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthlyRows = await prisma.salesOrderMonthly.findMany({
      where: { shop, month },
    });
    if (monthlyRows.length === 0) return null;
    const mtdRevenue = monthlyRows.reduce((sum, r) => sum + r.revenue, 0);
    const currency = monthlyRows.find((r) => r.currencyCode)?.currencyCode ?? "BRL";
    return {
      kind: "retail",
      mtdRevenue,
      currency,
      locationsOnTrack: monthlyRows.length,
      totalLocations: monthlyRows.length,
    };
  } catch {
    return null;
  }
}

async function getFootprintLifetime(shop: string): Promise<MetricCardData | null> {
  try {
    const [customerCount, topCityRow] = await Promise.all([
      prisma.retailCustomer.count({ where: { shop } }),
      prisma.retailCityMonthly.groupBy({
        by: ["cityDisplay"],
        where: { shop },
        _sum: { orderCount: true },
        orderBy: { _sum: { orderCount: "desc" } },
        take: 1,
      }),
    ]);
    if (customerCount === 0) return null;
    return {
      kind: "footprint",
      customerCount,
      topCity: topCityRow[0]?.cityDisplay ?? null,
    };
  } catch {
    return null;
  }
}

async function getAffiliatesLast30d(shop: string): Promise<MetricCardData | null> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [orderAgg, activeCodes, unmappedCodes] = await Promise.all([
      prisma.affiliateOrder.aggregate({
        _sum: { totalAmount: true },
        where: { shop, orderDate: { gte: since } },
      }),
      prisma.affiliateCode.count({ where: { shop, programId: { not: null } } }),
      prisma.affiliateCode.count({
        where: { shop, programId: { not: null }, profileId: null },
      }),
    ]);
    if (activeCodes === 0) return null;
    const last30dRevenue = orderAgg._sum.totalAmount ?? 0;
    return {
      kind: "affiliates",
      last30dRevenue,
      currency: "BRL",
      activeCodes,
      unmappedCount: unmappedCodes,
    };
  } catch {
    return null;
  }
}

// ─── Static config: which features get a metric card vs only a jump card ────
// `as const` narrows icon strings to their literal types so they satisfy
// `<s-icon type="...">` (which expects the Polaris IconType union, not string).
const METRIC_CONFIG = {
  localDelivery: { href: "/app/local-delivery", icon: "delivery" },
  retailSales: { href: "/app/retail-sales", icon: "chart-histogram-growth" },
  footprintExpansion: { href: "/app/footprint-expansion", icon: "location" },
  affiliates: { href: "/app/affiliates", icon: "affiliate" },
} as const;

const JUMP_ICONS = {
  "/app/local-delivery": "delivery",
  "/app/retail-sales": "chart-histogram-growth",
  "/app/footprint-expansion": "location",
  "/app/affiliates": "affiliate",
  "/app/merchandising": "discount",
  "/app/storytelling": "blog",
  "/app/settings": "settings",
  "/app": "apps",
} as const;

type SIconType = (typeof METRIC_CONFIG)[keyof typeof METRIC_CONFIG]["icon"]
  | (typeof JUMP_ICONS)[keyof typeof JUMP_ICONS];

// ─── Loader ────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const navItems = getNavItems();
  const navHrefs = new Set(navItems.map((n: NavItem) => n.href));

  const [setup, ld, retail, footprint, affiliates] = await Promise.all([
    getSetupState(shop),
    navHrefs.has(METRIC_CONFIG.localDelivery.href) ? getLdToday(shop) : Promise.resolve(null),
    navHrefs.has(METRIC_CONFIG.retailSales.href) ? getRetailMtd(shop) : Promise.resolve(null),
    navHrefs.has(METRIC_CONFIG.footprintExpansion.href) ? getFootprintLifetime(shop) : Promise.resolve(null),
    navHrefs.has(METRIC_CONFIG.affiliates.href) ? getAffiliatesLast30d(shop) : Promise.resolve(null),
  ]);

  const metrics: MetricCard[] = (["localDelivery", "retailSales", "footprintExpansion", "affiliates"] as const)
    .filter((key) => navHrefs.has(METRIC_CONFIG[key].href))
    .map((key) => ({
      key,
      href: METRIC_CONFIG[key].href,
      icon: METRIC_CONFIG[key].icon,
      data:
        key === "localDelivery" ? ld :
        key === "retailSales" ? retail :
        key === "footprintExpansion" ? footprint :
        affiliates,
    }));

  const jumpCards: JumpCard[] = navItems
    .filter((n) => n.href !== "/app") // exclude Extras
    .map((n) => ({
      key: n.labelKey.split(":")[1]?.split(".")[1] ?? n.href,
      href: n.href,
      icon: (JUMP_ICONS as Record<string, SIconType>)[n.href] ?? "apps",
    }));

  console.info(
    `[home] loader OK shop=${shop} setupDone=${setup.totalDone}/${setup.total} metrics=${metrics.length} jumps=${jumpCards.length}`,
  );

  const data: LoaderData = { setup, metrics, jumpCards };
  return data;
};

// ─── Formatters ────────────────────────────────────────────────────────────
function formatCompactCurrency(value: number, currency: string): string {
  const symbol = currency === "BRL" ? "R$" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${symbol}${(value / 1_000).toFixed(1)}k`;
  return `${symbol}${Math.round(value).toLocaleString("en-US")}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const { t } = useTranslation("home");
  const { setup, metrics, jumpCards } = useLoaderData<typeof loader>();

  return (
    <s-page heading={t("pageHeading")}>
      <p className={styles.subheading}>{t("subheading")}</p>

      {/* 1. Setup guide — visible only when incomplete */}
      {!setup.complete ? <SetupGuide setup={setup} /> : null}

      {/* 2. Activity overview */}
      {metrics.length > 0 ? (
        <>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{t("sections.activityOverview")}</h2>
          </div>
          <div className={styles.metricsRow}>
            {metrics.map((metric) => (
              <MetricCardView key={metric.key} card={metric} />
            ))}
          </div>
        </>
      ) : null}

      {/* 3. Jump back in */}
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          {setup.complete ? t("sections.jumpBackIn") : t("sections.jumpIn")}
        </h2>
      </div>
      <div className={styles.jumpGrid}>
        {jumpCards.map((card) => (
          <Link key={card.href} to={card.href} className={styles.jumpCard}>
            <span className={styles.jumpIcon}>
              <s-icon type={card.icon} />
            </span>
            <span className={styles.jumpBody}>
              <span className={styles.jumpTitle}>{t(`jumpCards.${card.key}.title`, t(`cards.${card.key}.title`, card.key))}</span>
              <span className={styles.jumpSub}>{t(`jumpCards.${card.key}.sub`, t(`cards.${card.key}.description`, ""))}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* 4. Footer help */}
      <div className={styles.footerHelp}>
        <span>{t("footer.heading")}</span>
        <span className={styles.footerLinks}>
          <a href="https://cpg-labs.io/docs" target="_top" rel="noreferrer">{t("footer.docs")}</a>
          <a href="mailto:support@cpg-labs.io">{t("footer.support")}</a>
          <a href="https://cpg-labs.io/changelog" target="_top" rel="noreferrer">{t("footer.changelog")}</a>
        </span>
      </div>
    </s-page>
  );
}

// ─── Setup guide ───────────────────────────────────────────────────────────
function SetupGuide({ setup }: { setup: SetupState }) {
  const { t } = useTranslation("home");
  const progressPct = Math.round((setup.totalDone / setup.total) * 100);

  return (
    <div className={styles.setupGuide}>
      <div className={styles.setupGuideHeader}>
        <div>
          <h2 className={styles.setupGuideTitle}>{t("setup.title")}</h2>
          <p className={styles.setupGuideSub}>{t("setup.subtitle")}</p>
        </div>
        <span className={styles.setupGuideProgress}>
          {t("setup.progress", { done: setup.totalDone, total: setup.total })}
        </span>
      </div>
      <div className={styles.setupProgressBar}>
        <span
          className={styles.setupProgressBarFill}
          style={{ width: `${progressPct}%` }}
          aria-hidden="true"
        />
      </div>
      <ol className={styles.setupSteps}>
        {setup.steps.map((step, idx) => {
          const isDone = step.status === "done";
          const isActive = !isDone && idx === setup.steps.findIndex((s) => s.status === "todo");
          return (
            <li key={step.key} className={styles.setupStep}>
              <span
                className={`${styles.stepIcon} ${isDone ? styles.stepIconDone : isActive ? styles.stepIconActive : styles.stepIconTodo}`}
                aria-hidden="true"
              >
                {isDone ? "✓" : idx + 1}
              </span>
              <span className={styles.stepBody}>
                <span className={`${styles.stepTitle} ${isDone ? styles.stepTitleDone : ""}`}>
                  {t(`setup.steps.${step.key}.title`)}
                </span>
                <span className={styles.stepDesc}>{t(`setup.steps.${step.key}.desc`)}</span>
              </span>
              {!isDone ? (
                <Link to={step.href} className={styles.stepCta}>
                  {t(`setup.steps.${step.key}.cta`)}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Metric card ───────────────────────────────────────────────────────────
function MetricCardView({ card }: { card: MetricCard }) {
  const { t } = useTranslation("home");
  return (
    <Link to={card.href} className={styles.metricCard}>
      <span className={styles.metricLabel}>
        <span className={styles.metricLabelLeft}>
          <s-icon type={card.icon} />
          <span>{t(`metrics.${card.key}.label`)}</span>
        </span>
        <span className={styles.metricRange}>{t(`metrics.${card.key}.range`)}</span>
      </span>
      {card.data === null ? (
        <span className={styles.metricEmpty}>
          <strong>{t(`metrics.${card.key}.emptyTitle`)}</strong>
          <span>{t(`metrics.${card.key}.emptyDesc`)}</span>
        </span>
      ) : (
        <MetricBody data={card.data} />
      )}
      <span className={styles.metricFooter}>
        <span className={styles.metricLink}>{t(`metrics.${card.key}.cta`)} →</span>
      </span>
    </Link>
  );
}

function MetricBody({ data }: { data: MetricCardData }) {
  const { t } = useTranslation("home");
  switch (data.kind) {
    case "ld":
      return (
        <>
          <span className={styles.metricValue}>{formatCount(data.ordersToday)}</span>
          <span className={styles.metricSecondary}>
            {t("metrics.localDelivery.subPending")}
            <br />
            {t("metrics.localDelivery.subDispatched", { n: data.routesToday })}
          </span>
        </>
      );
    case "retail":
      return (
        <>
          <span className={styles.metricValue}>{formatCompactCurrency(data.mtdRevenue, data.currency)}</span>
          <span className={styles.metricSecondary}>
            {t("metrics.retailSales.subRevenue")}
            <br />
            {t("metrics.retailSales.subLocations", { n: data.totalLocations })}
          </span>
        </>
      );
    case "footprint":
      return (
        <>
          <span className={styles.metricValue}>{formatCount(data.customerCount)}</span>
          <span className={styles.metricSecondary}>
            {t("metrics.footprintExpansion.subCustomers")}
            {data.topCity ? (
              <>
                <br />
                {t("metrics.footprintExpansion.subTopCity", { city: data.topCity })}
              </>
            ) : null}
          </span>
        </>
      );
    case "affiliates":
      return (
        <>
          <span className={styles.metricValue}>{formatCompactCurrency(data.last30dRevenue, data.currency)}</span>
          <span className={styles.metricSecondary}>
            {t("metrics.affiliates.subAttributed", { n: data.activeCodes })}
            {data.unmappedCount > 0 ? (
              <>
                <br />
                <span className={styles.metricNeg}>
                  {t("metrics.affiliates.subUnmapped", { n: data.unmappedCount })}
                </span>
              </>
            ) : null}
          </span>
        </>
      );
  }
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
