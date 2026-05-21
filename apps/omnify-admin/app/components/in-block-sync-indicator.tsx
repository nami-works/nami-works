import type { ReactNode } from "react";
import styles from "./in-block-sync-indicator.module.css";

/**
 * In-block sync indicator — Option B from
 * inputs/mockups/affiliates-sync-bar-v1.html (approved by Lucas 2026-05-12).
 *
 * Canonical pattern for every background-sync surface in the admin:
 * Affiliates Overview (BixGrow CSV / hourly cron), Retail Sales (sales-
 * goals sync), Footprint Expansion (heatmap recompute), Storytelling >
 * Tone of voice (weekly diff job), Local Delivery (dispatch reconcile),
 * Settings > Brand (tone-sources cron).
 *
 * Renders inside the affected <s-section> (not above the page body),
 * between the section hero and its body filters. The 6px progress bar
 * sits BELOW the status row, in document flow — reads as content, not
 * card chrome.
 *
 * 5 states (state matrix in inputs/mockups/affiliates-sync-bar-v1.html):
 *   - idle (synced recently)
 *   - running (active sync, with progress %)
 *   - done (just finished, fades to idle after ~5min)
 *   - error (sync failed, retry available)
 *   - stale (last sync > expected interval, manual sync available)
 *
 * Consumer derives the state + values from per-feature meta tables
 * (AffiliateSyncMeta, SalesGoalsSyncMeta, etc.). See the mockup notes
 * for the derivation rules.
 */

type SyncStatus = "idle" | "running" | "done" | "error" | "stale";

type Props = {
  status: SyncStatus;
  /** Headline label, e.g. "Fetching orders" / "✓ Synced" / "Sync failed". */
  label: ReactNode;
  /** Main count text, e.g. "57.8K / ~78.3K processed". */
  count?: ReactNode;
  /** Subtle count text shown after main count, e.g. "· 13m elapsed". */
  subtleCount?: ReactNode;
  /** 0-100 progress percentage. Required for `running` and `error` states (paint at fail point). */
  percent?: number;
  /** Action label rendered far-right (e.g. "Refresh" / "Retry" / "Pause"). */
  actionLabel?: ReactNode;
  /** Action callback when the right-side link is clicked. */
  onAction?: () => void;
  /** When true, paints a shimmer animation across the bar fill. Default: true for `running`. */
  animated?: boolean;
};

export function InBlockSyncIndicator({
  status,
  label,
  count,
  subtleCount,
  percent,
  actionLabel,
  onAction,
  animated,
}: Props) {
  // Decide whether the bar renders at all + with which color + animation.
  // - `idle` + `done` + `stale` → no bar, just the status row
  // - `running` → blue bar at `percent`, shimmer (unless caller disabled)
  // - `error` → red bar frozen at `percent` (fail point), no shimmer
  const showBar = status === "running" || status === "error";
  const isError = status === "error";
  const shouldAnimate = animated ?? status === "running";
  const fillPct = Math.max(0, Math.min(100, percent ?? 0));

  const labelClass = [
    styles.label,
    status === "done" ? styles.success : null,
    status === "error" ? styles.error : null,
    status === "stale" ? styles.stale : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.indicator}>
      <div className={styles.statusRow}>
        <span className={labelClass}>{label}</span>
        {count != null ? <span className={styles.count}>{count}</span> : null}
        {subtleCount != null ? (
          <span className={`${styles.count} ${styles.subtle}`}>{subtleCount}</span>
        ) : null}
        {actionLabel != null && onAction != null ? (
          <button type="button" className={styles.action} onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      {showBar ? (
        <div className={styles.bar}>
          <div
            className={[
              styles.fill,
              isError ? styles.error : null,
              shouldAnimate ? styles.animated : null,
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
