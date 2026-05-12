import type { ReactNode } from "react";
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
 */

type TabBase = {
  key: string;
  label: ReactNode;
  badge?: ReactNode;
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
        const className = `${styles.tab}${tab.key === activeKey ? ` ${styles.tabActive}` : ""}`;
        const content = (
          <>
            {tab.label}
            {tab.badge}
          </>
        );

        if ("to" in tab && tab.to !== undefined) {
          return (
            <Link
              key={tab.key}
              to={tab.to}
              className={className}
              role="tab"
              aria-selected={tab.key === activeKey}
            >
              {content}
            </Link>
          );
        }

        return (
          <button
            key={tab.key}
            type="button"
            className={className}
            role="tab"
            aria-selected={tab.key === activeKey}
            onClick={tab.onClick}
          >
            {content}
          </button>
        );
      })}
      {rightSlot ? <div className={styles.tabsRightGroup}>{rightSlot}</div> : null}
    </div>
  );
}
