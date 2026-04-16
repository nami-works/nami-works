// Pure analytics helpers — safe to import from client components.
// No Prisma / DB imports; operates on loader-supplied aggregates + projections.

import type { MonthlyAggregateRow, MonthProjection } from "./analytics-queries.server";

export type LocationSnapshot = {
  locationId: string;
  locationName: string;
  mtdRevenue: number;
  mtdOrders: number;
  mtdDiscounts: number;
  mtdZeroDays: number; // zero-revenue days elapsed in dashboardMonth
  pyRevenue: number;
  pyOrders: number;
  pyDiscounts: number;
  pyZeroDays: number; // zero-revenue days across the full pyMonth
  projectedRevenue: number | null;
  projectedOrders: number | null;
  goal: number | null;
};

export type BuildSnapshotInput = {
  locations: { id: string; name: string }[];
  aggregates: MonthlyAggregateRow[];
  projections: Record<string, Record<string, MonthProjection>>;
  goals: Record<string, number>; // locationId → goal for dashboardMonth
  zeroDaysByLocMonth: Record<string, Record<string, number>>; // locationId → month → count
  dashboardMonth: string;
  pyMonth: string;
};

export function buildLocationSnapshots(
  input: BuildSnapshotInput,
): LocationSnapshot[] {
  const {
    locations,
    aggregates,
    projections,
    goals,
    zeroDaysByLocMonth,
    dashboardMonth,
    pyMonth,
  } = input;

  const byLocMonth = new Map<string, MonthlyAggregateRow>();
  for (const row of aggregates) {
    byLocMonth.set(`${row.locationId}__${row.month}`, row);
  }

  return locations.map((loc) => {
    const current = byLocMonth.get(`${loc.id}__${dashboardMonth}`);
    const py = byLocMonth.get(`${loc.id}__${pyMonth}`);
    const proj = projections[loc.id]?.[dashboardMonth] ?? null;

    const mtdRevenue = current?.revenue ?? 0;
    const mtdOrders = current?.orderCount ?? 0;
    let projectedOrders: number | null = null;
    if (proj && proj.yoy != null) {
      if (mtdRevenue > 0 && mtdOrders > 0) {
        projectedOrders = Math.round((proj.yoy / mtdRevenue) * mtdOrders);
      } else if (proj.isProjection === false) {
        projectedOrders = mtdOrders;
      }
    } else if (proj && proj.isProjection === false) {
      projectedOrders = mtdOrders;
    }

    return {
      locationId: loc.id,
      locationName: loc.name,
      mtdRevenue,
      mtdOrders,
      mtdDiscounts: current?.totalDiscounts ?? 0,
      mtdZeroDays: zeroDaysByLocMonth[loc.id]?.[dashboardMonth] ?? 0,
      pyRevenue: py?.revenue ?? 0,
      pyOrders: py?.orderCount ?? 0,
      pyDiscounts: py?.totalDiscounts ?? 0,
      pyZeroDays: zeroDaysByLocMonth[loc.id]?.[pyMonth] ?? 0,
      projectedRevenue: proj?.yoy ?? null,
      projectedOrders,
      goal: goals[loc.id] ?? null,
    };
  });
}

export type AggregateKpi = {
  mtd: number;
  py: number;
  projected: number | null;
  goal: number | null;
};

export function aggregateSnapshots(
  snapshots: LocationSnapshot[],
  kind: "revenue" | "orders" | "aov" | "discounts",
): AggregateKpi {
  let mtdRev = 0;
  let mtdOrd = 0;
  let mtdDisc = 0;
  let pyRev = 0;
  let pyOrd = 0;
  let pyDisc = 0;
  let projRev: number | null = null;
  let projOrd: number | null = null;
  let goalRev = 0;
  let hasAnyGoal = false;

  for (const s of snapshots) {
    mtdRev += s.mtdRevenue;
    mtdOrd += s.mtdOrders;
    mtdDisc += s.mtdDiscounts;
    pyRev += s.pyRevenue;
    pyOrd += s.pyOrders;
    pyDisc += s.pyDiscounts;
    if (s.projectedRevenue != null) {
      projRev = (projRev ?? 0) + s.projectedRevenue;
    }
    if (s.projectedOrders != null) {
      projOrd = (projOrd ?? 0) + s.projectedOrders;
    }
    if (s.goal != null) {
      goalRev += s.goal;
      hasAnyGoal = true;
    }
  }

  if (kind === "revenue") {
    return {
      mtd: mtdRev,
      py: pyRev,
      projected: projRev,
      goal: hasAnyGoal ? goalRev : null,
    };
  }
  if (kind === "orders") {
    const pyAov = pyOrd > 0 ? pyRev / pyOrd : 0;
    const derivedGoal =
      hasAnyGoal && pyAov > 0 ? goalRev / pyAov : null;
    return {
      mtd: mtdOrd,
      py: pyOrd,
      projected: projOrd,
      goal: derivedGoal,
    };
  }
  if (kind === "aov") {
    const mtdAov = mtdOrd > 0 ? mtdRev / mtdOrd : 0;
    const pyAov = pyOrd > 0 ? pyRev / pyOrd : 0;
    const projAov =
      projRev != null && projOrd != null && projOrd > 0
        ? projRev / projOrd
        : null;
    const derivedGoal =
      hasAnyGoal && pyOrd > 0 ? goalRev / pyOrd : null;
    return {
      mtd: mtdAov,
      py: pyAov,
      projected: projAov,
      goal: derivedGoal,
    };
  }
  const mtdGross = mtdRev + mtdDisc;
  const pyGross = pyRev + pyDisc;
  return {
    mtd: mtdGross > 0 ? mtdDisc / mtdGross : 0,
    py: pyGross > 0 ? pyDisc / pyGross : 0,
    projected: null,
    goal: null,
  };
}

/** Stores with 10+ zero-revenue days in either period are treated as closed
 *  and excluded from same-store comparisons. A single quiet day doesn't drop
 *  a location; genuine closures do. */
export const SAME_STORE_ZERO_DAYS_THRESHOLD = 10;

export function sameStoreYoY(snapshots: LocationSnapshot[]): {
  deltaPercent: number | null;
  qualifyingCount: number;
  decliningCount: number;
  currentRevenue: number;
  pyRevenue: number;
} {
  const qualifying = snapshots.filter(
    (s) =>
      s.mtdZeroDays < SAME_STORE_ZERO_DAYS_THRESHOLD &&
      s.pyZeroDays < SAME_STORE_ZERO_DAYS_THRESHOLD &&
      s.pyRevenue > 0,
  );
  if (qualifying.length === 0) {
    return {
      deltaPercent: null,
      qualifyingCount: 0,
      decliningCount: 0,
      currentRevenue: 0,
      pyRevenue: 0,
    };
  }
  const currentRevenue = qualifying.reduce(
    (sum, s) => sum + (s.projectedRevenue ?? s.mtdRevenue),
    0,
  );
  const pyRevenue = qualifying.reduce((sum, s) => sum + s.pyRevenue, 0);
  const deltaPercent =
    pyRevenue > 0 ? ((currentRevenue - pyRevenue) / pyRevenue) * 100 : null;
  const decliningCount = qualifying.filter((s) => {
    const cur = s.projectedRevenue ?? s.mtdRevenue;
    return s.pyRevenue > 0 && cur < s.pyRevenue;
  }).length;
  return {
    deltaPercent,
    qualifyingCount: qualifying.length,
    decliningCount,
    currentRevenue,
    pyRevenue,
  };
}

export function bestVsWorst(snapshots: LocationSnapshot[]): {
  best: { locationId: string; name: string; achievement: number } | null;
  worst: { locationId: string; name: string; achievement: number } | null;
  gapPp: number | null;
} {
  const withAch = snapshots
    .filter((s) => s.goal != null && s.goal > 0 && s.projectedRevenue != null)
    .map((s) => ({
      locationId: s.locationId,
      name: s.locationName,
      achievement: (s.projectedRevenue! / s.goal!) * 100,
    }));
  if (withAch.length === 0) {
    return { best: null, worst: null, gapPp: null };
  }
  if (withAch.length === 1) {
    return { best: withAch[0], worst: null, gapPp: null };
  }
  const sorted = [...withAch].sort((a, b) => b.achievement - a.achievement);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return { best, worst, gapPp: best.achievement - worst.achievement };
}

export function discountRate(
  snapshots: LocationSnapshot[],
  thirteenMonthAggregates?: MonthlyAggregateRow[],
): {
  currentRate: number | null;
  pyRate: number | null;
  deltaPp: number | null;
  thirteenMonthDiscountTotal: number;
} {
  const mtdDisc = snapshots.reduce((sum, s) => sum + s.mtdDiscounts, 0);
  const mtdRev = snapshots.reduce((sum, s) => sum + s.mtdRevenue, 0);
  const mtdGross = mtdRev + mtdDisc;
  const currentRate = mtdGross > 0 ? mtdDisc / mtdGross : null;

  const pyDisc = snapshots.reduce((sum, s) => sum + s.pyDiscounts, 0);
  const pyRev = snapshots.reduce((sum, s) => sum + s.pyRevenue, 0);
  const pyGross = pyRev + pyDisc;
  const pyRate = pyGross > 0 ? pyDisc / pyGross : null;

  const deltaPp =
    currentRate != null && pyRate != null
      ? (currentRate - pyRate) * 100
      : null;

  const thirteenMonthDiscountTotal = (thirteenMonthAggregates ?? []).reduce(
    (sum, row) => sum + (row.totalDiscounts ?? 0),
    0,
  );

  return { currentRate, pyRate, deltaPp, thirteenMonthDiscountTotal };
}
