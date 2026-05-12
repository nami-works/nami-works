/**
 * LD Analytics aside block — sidebar surface for the operational LD page.
 *
 * Renders the headline savings + 90d sparkline + See-more, or the
 * appropriate empty / stale / provocation state per the mockup matrix at
 * inputs/mockups/local-delivery-analytics-aside-v1.html.
 *
 * Data is fetched client-side via useFetcher() so the LD page loader's
 * wall-clock is NOT extended (see spec §4).
 *
 * State 6 (disabled, kind="hidden") returns null — no DOM render.
 */

import { useEffect } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { AsideData, WeeklyPoint } from "../services/ld-analytics/aside.server";
import styles from "./ld-analytics-aside.module.css";

const ASIDE_ENDPOINT = "/app/local-delivery/analytics?aside=1";

export function LdAnalyticsAside() {
  const fetcher = useFetcher<AsideData>();

  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(ASIDE_ENDPOINT);
    }
    // ASSUMPTION: single load on mount is enough for v1. Re-fetch on focus
    // / interval is a later enhancement; the 1h server-side sparkline cache
    // covers most operator sessions anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fetcher.state === "loading" || !fetcher.data) {
    return <Skeleton />;
  }

  const data = fetcher.data;
  switch (data.kind) {
    case "hidden":
      return null;
    case "provocation":
      return <ProvocationCard data={data} />;
    case "conservative_empty":
      return <ConservativeEmptyCard />;
    case "stale":
      return <FullCard data={data} stale />;
    case "full":
      return <FullCard data={data} />;
    default: {
      // Exhaustiveness guard — TS will error if a new kind is added.
      const _exhaustive: never = data;
      void _exhaustive;
      return null;
    }
  }
}

// ────────────────────────────────────────────────────────────
//  State 1 — Skeleton
// ────────────────────────────────────────────────────────────

function Skeleton() {
  const { t } = useTranslation("ld-analytics");
  return (
    <div
      className={`${styles.card} ${styles.skeletonGap}`}
      role="status"
      aria-busy="true"
      aria-label={t("aside.skeletonAriaLabel")}
    >
      <div className={`${styles.skel} ${styles.skelLine} ${styles.skelShort}`} />
      <div className={`${styles.skel} ${styles.skelTall}`} />
      <div className={`${styles.skel} ${styles.skelLine} ${styles.skelShort}`} />
      <div className={`${styles.skel} ${styles.skelSpark}`} />
      <div className={styles.skelButtonRow}>
        <div className={`${styles.skel} ${styles.skelButton}`} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  State 2 + 5 — Full data (+ optional stale footnote)
// ────────────────────────────────────────────────────────────

function FullCard({
  data,
  stale = false,
}: {
  data: Extract<AsideData, { kind: "full" } | { kind: "stale" }>;
  stale?: boolean;
}) {
  const { t } = useTranslation("ld-analytics");
  const navigate = useNavigate();
  const { total, momPercent, sparkline, currency, isNew } = data;

  // 2026-05-12 parity refactor (Lucas): visual at top (sparkline above stat
  // line), title as a real heading (s-section pattern), "New" badge as a real
  // s-badge, period footer subdued at the bottom, See-more as s-button
  // variant=secondary right-aligned. Mirrors the Auto-assign accuracy block
  // shape. Spec: inputs/mockups/ld-stat-blocks-parity-v1.html.
  return (
    <s-section>
      <div className={styles.titleRow}>
        <span className={styles.title}>{t("aside.label")}</span>
        {isNew && <s-badge tone="success">{t("aside.newPill")}</s-badge>}
      </div>
      <Sparkline points={sparkline} />
      <div className={styles.statRow}>
        <span className={styles.value}>{formatSignedCurrencyShort(total, currency)}</span>
        <span className={styles.descriptor}>{t("aside.descriptor")}</span>
      </div>
      <div className={styles.periodFooter}>
        {renderPeriodFooter(momPercent, t)}
      </div>
      {stale && "staleAgeHours" in data && (
        <div className={styles.staleFootnote}>
          {t("aside.staleFootnoteTemplate", {
            age: formatStaleAge(data.staleAgeHours),
            coverage: data.coveragePercent,
          })}
        </div>
      )}
      <div className={styles.ctaRowRight}>
        <s-button
          variant="secondary"
          onClick={() => navigate("/app/local-delivery/analytics")}
        >
          {t("aside.seeMore")}
        </s-button>
      </div>
    </s-section>
  );
}

// ────────────────────────────────────────────────────────────
//  State 3 — Provocation teaser
// ────────────────────────────────────────────────────────────

function ProvocationCard({
  data,
}: {
  data: Extract<AsideData, { kind: "provocation" }>;
}) {
  const { t } = useTranslation("ld-analytics");
  return (
    <div className={`${styles.card} ${styles.provocation}`}>
      <div>
        <div className={styles.label}>{t("aside.labelProvocation")}</div>
        <div className={styles.value}>
          {t("aside.provocationValueTemplate", {
            amount: formatCompactCurrency(data.estimatedMonthlySavings, data.currency),
          })}
        </div>
        <div className={styles.helper}>{t("aside.provocationHelper")}</div>
      </div>
      <div className={styles.ctaRow}>
        <Link to="/app/settings?tab=providers" className={styles.ctaPrimary}>
          {t("aside.provocationConnect")}
        </Link>
        <Link to="/app/settings?tab=providers" className={styles.ctaSecondary}>
          {t("aside.provocationManual")}
        </Link>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  State 4 — Conservative empty
// ────────────────────────────────────────────────────────────

function ConservativeEmptyCard() {
  const { t } = useTranslation("ld-analytics");
  return (
    <div className={styles.card}>
      <div>
        <div className={styles.label}>{t("aside.labelEmpty")}</div>
        <div className={styles.conservativeBody}>{t("aside.conservativeBody")}</div>
      </div>
      <div className={styles.ctaRow}>
        <Link to="/app/settings?tab=providers" className={styles.ctaPrimary}>
          {t("aside.conservativeConnect")}
        </Link>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  Sparkline (inline SVG, no chart library)
// ────────────────────────────────────────────────────────────

function Sparkline({ points }: { points: WeeklyPoint[] }) {
  const { t } = useTranslation("ld-analytics");
  // Compute polyline coords over the 12 buckets. viewBox is 0..200 x 0..28.
  // If all values equal (or only one bucket), render a flat midline.
  const values = points.map((p) => p.valueSubunits);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;

  const pointCount = points.length;
  const polylinePoints = points
    .map((p, i) => {
      const x = pointCount === 1 ? 100 : (i / (pointCount - 1)) * 200;
      // Higher value = lower y (top of SVG). 4px top padding + 4px bottom.
      const y = 26 - ((p.valueSubunits - min) / range) * 22 - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Close polyline into a filled polygon (for the soft area below the line)
  // by appending the right-bottom and left-bottom corners.
  const polygonPoints = `${polylinePoints} 200,28 0,28`;

  return (
    <div className={styles.sparkRow}>
      <svg
        className={styles.spark}
        viewBox="0 0 200 28"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline
          fill="none"
          stroke="#067647"
          strokeWidth="1.5"
          points={polylinePoints}
        />
        <polygon fill="rgba(6, 118, 71, 0.08)" points={polygonPoints} />
      </svg>
      <span className={styles.sparkLabel}>{t("aside.sparkLabel")}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  Formatting helpers
// ────────────────────────────────────────────────────────────

/** "+R$ 8,290" / "-R$ 1,200". Subunits → display unit, signed. */
function formatSignedCurrencyShort(amountSubunits: number, currency: string): string {
  const abs = Math.abs(amountSubunits) / 100;
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(abs);
  return amountSubunits >= 0 ? `+${formatted}` : `-${formatted}`;
}

/** Compact "~R$ 3.2k" style for the provocation teaser. */
function formatCompactCurrency(amountSubunits: number, currency: string): string {
  const v = Math.abs(amountSubunits) / 100;
  const symbol = currency === "BRL" ? "R$" : currency === "USD" ? "$" : currency;
  if (v >= 1_000_000) return `${symbol}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${symbol}${(v / 1_000).toFixed(1)}k`;
  return `${symbol}${Math.round(v)}`;
}

/** "2d", "12h" — coarse stale-age label for the footnote. */
function formatStaleAge(hours: number): string {
  if (hours >= 24) return `${Math.round(hours / 24)}d`;
  return `${hours}h`;
}

/** ±2% threshold per spec §5.2. Renders the period footer with a colored arrow.
 *  Renamed from renderDelta 2026-05-12 — the inline-with-descriptor format
 *  was split into a separate descriptor line and a period footer for parity
 *  with the Auto-assign accuracy block. */
function renderPeriodFooter(
  momPercent: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  const arrow =
    momPercent > 2
      ? t("aside.trendUp")
      : momPercent < -2
        ? t("aside.trendDown")
        : t("aside.trendFlat");
  const arrowClass =
    momPercent > 2
      ? styles.arrowUp
      : momPercent < -2
        ? styles.arrowDown
        : styles.arrowFlat;
  const template = t("aside.periodFooter", {
    trend: "__TREND__",
    percent: Math.abs(momPercent),
  });
  const [before, after] = template.split("__TREND__");
  return (
    <>
      {before}
      <span className={arrowClass}>{arrow}</span>
      {after}
    </>
  );
}
