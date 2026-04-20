import React from "react";
import styles from "./styles.module.css";

export type DrillDownKey = string | null;

export function renderDelta(delta: number | undefined): React.ReactNode {
  if (delta == null) return null;
  const cls = delta >= 0 ? styles.deltaUp : styles.deltaDown;
  return (
    <span className={cls}>
      {delta >= 0 ? "+" : ""}
      {delta.toFixed(1)}%
    </span>
  );
}

type KpiCardProps = {
  primary: string;
  label: string;
  secondary: React.ReactNode;
  delta?: number;
  drillKey: string;
  activeDrill: DrillDownKey;
  isLoading?: boolean;
  onClick: (key: string) => void;
};

export function KpiCard({
  primary,
  label,
  secondary,
  delta,
  drillKey,
  activeDrill,
  isLoading,
  onClick,
}: KpiCardProps) {
  const isActive = activeDrill === drillKey;
  const boxClass = [
    styles.overviewBox,
    styles.overviewBoxClickable,
    isActive ? styles.overviewBoxActive : "",
    isLoading ? styles.overviewBoxLoading : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={boxClass}
      role="button"
      tabIndex={0}
      onClick={() => onClick(drillKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick(drillKey);
      }}
    >
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <div className={styles.overviewBoxInner}>
          {isLoading && (
            <div className={styles.overviewSpinner}>
              <s-spinner size="base" />
            </div>
          )}
          <span className={styles.overviewPrimary}>
            {primary}
            {renderDelta(delta)}
          </span>
          <span className={styles.overviewLabel}>{label}</span>
          <span className={styles.overviewSecondary}>{secondary}</span>
        </div>
      </s-box>
    </div>
  );
}
