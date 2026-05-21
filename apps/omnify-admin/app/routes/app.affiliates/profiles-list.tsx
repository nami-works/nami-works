import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import styles from "./styles.module.css";
import type { AffiliateProfile } from "../../affiliates/storage.server";

/**
 * Client-side CSV export. Escapes commas, quotes, and newlines per RFC 4180.
 * Triggers a browser download via a Blob + anchor click.
 */
function downloadCsv(filename: string, rows: string[][]) {
  const escape = (cell: string) => {
    if (/[",\n]/.test(cell)) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Matches the extended shape added to AffiliateOverviewStats.leaderboard.
export type LeaderboardRow = {
  code: string;
  affiliateName: string;
  revenue: number;
  orders: number;
  commission: number;
  customers: number;
  repeatPct: number;
  aov: number;
  topProductTitle: string | null;
  topProductShare: number;
  instagram: string | null;
  tiktok: string | null;
};

// Enriched row: a leaderboard row (if the affiliate had activity in the
// period) merged with profile metadata (handle, tier, status).
type EnrichedRow = LeaderboardRow & {
  handle: string | null;
  tier: string;
  status: string;
};

type SortKey =
  | "name"
  | "revenue"
  | "customers"
  | "repeatPct"
  | "aov"
  | "topProduct";

const QUARTILE_MIN_ROWS = 8;

function computeQuartileSets<T>(
  rows: T[],
  getValue: (r: T) => number,
): { topSet: Set<T>; bottomSet: Set<T> } {
  if (rows.length < QUARTILE_MIN_ROWS) {
    return { topSet: new Set(), bottomSet: new Set() };
  }
  const sorted = [...rows].sort((a, b) => getValue(b) - getValue(a));
  const q1Cutoff = Math.max(1, Math.floor(sorted.length * 0.25));
  const q4Cutoff = Math.max(1, Math.floor(sorted.length * 0.25));
  const topSet = new Set(sorted.slice(0, q1Cutoff));
  const bottomSet = new Set(sorted.slice(sorted.length - q4Cutoff));
  return { topSet, bottomSet };
}

type ProfilesListProps = {
  leaderboard: LeaderboardRow[];
  profiles: Array<AffiliateProfile & { handle: string | null }>;
  onRowClick: (code: string) => void;
  fmtCurrency: (v: number) => string;
  fmtNum: (v: number) => string;
  fmtPct: (v: number) => string;
  t: TFunction;
};

export function ProfilesList({
  leaderboard,
  profiles,
  onRowClick,
  fmtCurrency,
  fmtNum,
  fmtPct,
  t,
}: ProfilesListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Merge leaderboard data with profile metadata. Every profile appears
  // even if they have no activity in the period (they render at the bottom).
  const rows: EnrichedRow[] = useMemo(() => {
    const byCode = new Map<string, LeaderboardRow>();
    for (const r of leaderboard) byCode.set(r.code.toLowerCase(), r);
    return profiles.map((p) => {
      const lb = byCode.get(p.code.toLowerCase());
      return {
        code: p.code,
        affiliateName: p.affiliateName,
        revenue: lb?.revenue ?? 0,
        orders: lb?.orders ?? 0,
        commission: lb?.commission ?? 0,
        customers: lb?.customers ?? 0,
        repeatPct: lb?.repeatPct ?? 0,
        aov: lb?.aov ?? 0,
        topProductTitle: lb?.topProductTitle ?? null,
        topProductShare: lb?.topProductShare ?? 0,
        instagram: p.instagram,
        tiktok: p.tiktok,
        handle: p.handle,
        tier: p.tier,
        status: p.status,
      };
    });
  }, [leaderboard, profiles]);

  // Quartile sets are always computed across the full list (not the sorted
  // slice), so bands don't flicker when re-sorting.
  const revQuartiles = useMemo(
    () => computeQuartileSets(rows, (r) => r.revenue),
    [rows],
  );
  const repeatQuartiles = useMemo(
    () => computeQuartileSets(rows, (r) => r.repeatPct),
    [rows],
  );
  const aovQuartiles = useMemo(
    () => computeQuartileSets(rows, (r) => r.aov),
    [rows],
  );
  const custQuartiles = useMemo(
    () => computeQuartileSets(rows, (r) => r.customers),
    [rows],
  );

  const sorted = useMemo(() => {
    const copy = [...rows];
    const cmp = (a: EnrichedRow, b: EnrichedRow): number => {
      switch (sortKey) {
        case "name":
          return a.affiliateName.localeCompare(b.affiliateName);
        case "revenue":
          return a.revenue - b.revenue;
        case "customers":
          return a.customers - b.customers;
        case "repeatPct":
          return a.repeatPct - b.repeatPct;
        case "aov":
          return a.aov - b.aov;
        case "topProduct":
          return (a.topProductShare ?? 0) - (b.topProductShare ?? 0);
      }
    };
    copy.sort((a, b) => {
      const c = cmp(a, b);
      return sortDir === "asc" ? c : -c;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return null;
    // Non-breaking space keeps the arrow glued to the last word of the label
    // so the arrow never wraps to its own line when the header is narrow.
    return (
      <span className={styles.sortArrow}>
        {"\u00A0"}
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  const cellClass = (
    row: EnrichedRow,
    q: { topSet: Set<EnrichedRow>; bottomSet: Set<EnrichedRow> },
  ) => {
    if (q.topSet.has(row)) return styles.quartileTop;
    if (q.bottomSet.has(row)) return styles.quartileBottom;
    return undefined;
  };

  if (profiles.length === 0) {
    return (
      <div className={styles.noData}>
        <s-text>
          {t(
            "profiles.emptyMessage",
            "No affiliate profiles yet. Import a BixGrow CSV to get started.",
          )}
        </s-text>
      </div>
    );
  }

  const handleExport = () => {
    const header = [
      "Name",
      "Code",
      "Handle",
      "Revenue",
      "Orders",
      "Commission",
      "Customers",
      "Repeat %",
      "AOV",
      "Top product",
      "Top product share %",
      "Tier",
      "Status",
    ];
    const body = sorted.map((r) => [
      r.affiliateName,
      r.code,
      r.handle ?? "",
      r.revenue.toFixed(2),
      r.orders.toString(),
      r.commission.toFixed(2),
      r.customers.toString(),
      r.repeatPct.toFixed(1),
      r.aov.toFixed(2),
      r.topProductTitle ?? "",
      r.topProductShare.toFixed(1),
      r.tier,
      r.status,
    ]);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`affiliates-${date}.csv`, [header, ...body]);
  };

  return (
    <>
      <div className={styles.listToolbar}>
        <s-button variant="secondary" onClick={handleExport}>
          {t("profile.exportCsv", "Export CSV")}
        </s-button>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.leaderboardTable}>
        <thead>
          <tr>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("name")}
            >
              {t("profile.name", "Name")}{sortArrow("name")}
            </th>
            <th>{t("profile.code", "Code")}</th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("revenue")}
            >
              {t("card.revenue", "Revenue")}{sortArrow("revenue")}
            </th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("customers")}
            >
              {t("card.customers", "Customers")}{sortArrow("customers")}
            </th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("repeatPct")}
            >
              {t("card.repeatRate", "Repeat %")}{sortArrow("repeatPct")}
            </th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("aov")}
            >
              {t("card.aov", "AOV")}{sortArrow("aov")}
            </th>
            <th
              className={styles.sortable}
              onClick={() => toggleSort("topProduct")}
            >
              {t("profile.topProduct", "Top product")}{sortArrow("topProduct")}
            </th>
            <th>{t("profile.status", "Status")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.code}
              className={styles.clickableRow}
              onClick={() => onRowClick(row.code)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onRowClick(row.code);
              }}
            >
              <td>
                <div className={styles.profileName}>{row.affiliateName}</div>
                {row.handle && (
                  <span className={styles.affiliateHandle}>@{row.handle}</span>
                )}
              </td>
              <td>{row.code}</td>
              <td className={cellClass(row, revQuartiles)}>
                {fmtCurrency(row.revenue)}
              </td>
              <td className={cellClass(row, custQuartiles)}>
                {fmtNum(row.customers)}
              </td>
              <td className={cellClass(row, repeatQuartiles)}>
                {fmtPct(row.repeatPct)}
              </td>
              <td className={cellClass(row, aovQuartiles)}>
                {fmtCurrency(row.aov)}
              </td>
              <td>
                {row.topProductTitle ? (
                  <>
                    <span className={styles.topProductTitle}>
                      {row.topProductTitle}
                    </span>
                    {row.topProductShare > 0 && (
                      <span className={styles.topProductShare}>
                        {" "}
                        · {fmtPct(row.topProductShare)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className={styles.noData}>—</span>
                )}
              </td>
              <td>
                <s-badge
                  tone={
                    row.status === "active"
                      ? "success"
                      : row.status === "paused"
                        ? "warning"
                        : "critical"
                  }
                >
                  {row.status}
                </s-badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
