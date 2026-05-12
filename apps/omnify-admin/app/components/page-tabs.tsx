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
};

export function PageTabs({ activeKey, tabs, rightSlot, ariaLabel }: Props) {
  return (
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
  );
}
