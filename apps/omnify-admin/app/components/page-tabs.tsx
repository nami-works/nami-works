import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import styles from "./page-tabs.module.css";

/**
 * Off-block page tab strip. Renders OUTSIDE any <s-section>, directly under
 * <s-page>. Standardizes the flat/underline tab idiom across the admin app.
 *
 * Per-tab variants supported:
 *   - In-place tab (button + onClick): caller manages activeKey via useState
 *   - Link tab (to + react-router Link): caller derives activeKey from
 *     pathname; Link inside Outlet-based parent routes (e.g. Merchandising)
 *     or for cross-route navigation (e.g. Settings > Brand)
 *   - Mixed in the same strip is fine — Settings has 3 button tabs +
 *     1 Link tab (Brand)
 *
 * Each tab can carry an optional `badge` (e.g. <s-badge>18</s-badge>).
 * `rightSlot` renders far-right for adjacent controls (freshness chip,
 * ⋯ overflow menu) — example: Affiliates.
 *
 * Per-tab `variant`:
 *   - `"default"` (omit) — regular tab.
 *   - `"in-trail"` — subdued + italic tab with an auto-appended "›" separator
 *     after it. Used when the active tab is a CHILD of this tab — e.g. on
 *     `/app/settings/brand/tone-sources` the `brand` tab is in-trail and
 *     the `tone-of-voice` tab is active. Doubles as a breadcrumb-style
 *     "you came from here" indicator without stacking a separate breadcrumb
 *     row above the tab strip.
 */

type TabBase = {
  key: string;
  label: ReactNode;
  badge?: ReactNode;
  variant?: "default" | "in-trail";
};

type ButtonTab = TabBase & {
  onClick: () => void;
  to?: never;
};

type LinkTab = TabBase & {
  to: string;
  onClick?: never;
};

export type PageTab = ButtonTab | LinkTab;

type Props = {
  activeKey: string;
  tabs: PageTab[];
  rightSlot?: ReactNode;
  ariaLabel?: string;
  /**
   * Set to `true` when the host route renders `<s-section slot="aside">`
   * content. Adds the paired aside-spacer (~55px) so aside's first block
   * aligns with main's first block under the tabs row.
   *
   * Default `false` — without aside content, rendering the spacer would
   * trigger Polaris `<s-page>` to allocate an empty aside column anyway,
   * shrinking the main column width on routes that should be full-width
   * (Affiliates / Merchandising / Settings root / Retail Sales / etc.).
   * Caught post-deploy of PR #66 by Lucas.
   */
  hasAside?: boolean;
};

export function PageTabs({ activeKey, tabs, rightSlot, ariaLabel, hasAside = false }: Props) {
  return (
    <>
      <div className={styles.tabsRow} role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const isInTrail = tab.variant === "in-trail";
        const className = [
          styles.tab,
          isActive ? styles.tabActive : null,
          isInTrail ? styles.tabInTrail : null,
        ]
          .filter(Boolean)
          .join(" ");
        const content = (
          <>
            {tab.label}
            {tab.badge}
          </>
        );

        const tabEl =
          "to" in tab && tab.to !== undefined ? (
            <Link
              key={tab.key}
              to={tab.to}
              className={className}
              role="tab"
              aria-selected={isActive}
            >
              {content}
            </Link>
          ) : (
            <button
              key={tab.key}
              type="button"
              className={className}
              role="tab"
              aria-selected={isActive}
              onClick={"onClick" in tab && tab.onClick ? tab.onClick : undefined}
            >
              {content}
            </button>
          );

        return (
          <Fragment key={tab.key}>
            {tabEl}
            {isInTrail ? (
              <span className={styles.tabTrailChevron} aria-hidden="true">
                ›
              </span>
            ) : null}
          </Fragment>
        );
      })}
        {rightSlot ? <div className={styles.tabsRightGroup}>{rightSlot}</div> : null}
      </div>
      {/* Paired aside-column spacer — only rendered when the host route
          has aside content (via `hasAside` prop). Polaris <s-page>'s aside
          slot is a separate grid cell that doesn't see the tab row above,
          so without this spacer aside content starts at the same Y as the
          tab row's top. With it, aside aligns with main's first block.
          On routes WITHOUT aside content, rendering an empty slot="aside"
          element still triggers Polaris to allocate an aside column —
          shrinking the main region. So we opt-in per-route. */}
      {hasAside ? (
        <div
          slot="aside"
          className={styles.tabsAsideSpacer}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
