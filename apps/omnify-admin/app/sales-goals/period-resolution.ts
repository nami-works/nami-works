// Pure period resolution for the Retail goals Dashboard.
// Converts a preset + comparison mode (+ optional custom range) into the
// YYYY-MM-DD date pairs the server queries need.
//
// Mirrors the shape used by Affiliates Overview (app/routes/app.affiliates.tsx)
// but adds month-awareness metadata (`isSingleMonth`, `monthKey`) so the
// Dashboard can suppress goal/projection content for non-month periods.

export type PeriodPreset =
  | "this_month"
  | "last_month"
  | "last_7d"
  | "last_30d"
  | "last_3_months"
  | "custom";

export type ComparisonMode = "none" | "prev_period" | "prev_year";

export type ResolvedPeriod = {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  compareStart: string | null;
  compareEnd: string | null;
  /** True when start+end cover exactly one full calendar month. */
  isSingleMonth: boolean;
  /** YYYY-MM when isSingleMonth; otherwise null. */
  monthKey: string | null;
  /** True when today falls between start and end (inclusive). Gates the projection. */
  includesToday: boolean;
  /** Length of the period in days (inclusive). Used to scale same-store thresholds. */
  periodDays: number;
};

// ─── Local-date helpers (never cross UTC, to avoid day drift) ────────────────

export const toLocalYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const parseLocalYmd = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

const diffDaysInclusive = (startYmd: string, endYmd: string): number => {
  const s = parseLocalYmd(startYmd);
  const e = parseLocalYmd(endYmd);
  return (
    Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
};

const firstOfMonth = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), 1);

const lastOfMonth = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth() + 1, 0);

const monthKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** True when start is the 1st and end is the last day of the same calendar month. */
const rangeCoversSingleMonth = (startYmd: string, endYmd: string): boolean => {
  const s = parseLocalYmd(startYmd);
  const e = parseLocalYmd(endYmd);
  if (s.getFullYear() !== e.getFullYear() || s.getMonth() !== e.getMonth())
    return false;
  if (s.getDate() !== 1) return false;
  const last = lastOfMonth(s);
  return e.getDate() === last.getDate();
};

// ─── Preset → date range ─────────────────────────────────────────────────────

const todayLocal = (today?: Date): Date => {
  const d = today ? new Date(today) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export function getPresetDates(
  preset: PeriodPreset,
  customStart?: string,
  customEnd?: string,
  today?: Date,
): { start: string; end: string } | null {
  const now = todayLocal(today);

  if (preset === "custom") {
    if (!customStart || !customEnd) return null;
    return { start: customStart, end: customEnd };
  }

  if (preset === "this_month") {
    return {
      start: toLocalYmd(firstOfMonth(now)),
      end: toLocalYmd(now),
    };
  }

  if (preset === "last_month") {
    const firstOfThis = firstOfMonth(now);
    const lastOfPrev = new Date(firstOfThis);
    lastOfPrev.setDate(0);
    const firstOfPrev = firstOfMonth(lastOfPrev);
    return {
      start: toLocalYmd(firstOfPrev),
      end: toLocalYmd(lastOfPrev),
    };
  }

  if (preset === "last_7d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { start: toLocalYmd(start), end: toLocalYmd(now) };
  }

  if (preset === "last_30d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    return { start: toLocalYmd(start), end: toLocalYmd(now) };
  }

  // last_3_months = last 3 full calendar months (rolling).
  // Example: April 16 → Jan 1 .. Mar 31.
  const firstOfThis = firstOfMonth(now);
  const lastOfPrev = new Date(firstOfThis);
  lastOfPrev.setDate(0);
  const firstOfThreeAgo = new Date(
    lastOfPrev.getFullYear(),
    lastOfPrev.getMonth() - 2,
    1,
  );
  return {
    start: toLocalYmd(firstOfThreeAgo),
    end: toLocalYmd(lastOfPrev),
  };
}

// ─── Comparison window ───────────────────────────────────────────────────────

export function getComparisonDates(
  mode: ComparisonMode,
  start: string,
  end: string,
): { compStart: string; compEnd: string } | null {
  if (mode === "none") return null;
  const s = parseLocalYmd(start);
  const e = parseLocalYmd(end);
  const rangeDays = Math.round(
    (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (mode === "prev_period") {
    const compEnd = new Date(s);
    compEnd.setDate(compEnd.getDate() - 1);
    const compStart = new Date(compEnd);
    compStart.setDate(compStart.getDate() - rangeDays);
    return {
      compStart: toLocalYmd(compStart),
      compEnd: toLocalYmd(compEnd),
    };
  }

  // prev_year: shift both endpoints back one year (calendar-anchored).
  const compStart = new Date(s);
  compStart.setFullYear(compStart.getFullYear() - 1);
  const compEnd = new Date(e);
  compEnd.setFullYear(compEnd.getFullYear() - 1);
  return {
    compStart: toLocalYmd(compStart),
    compEnd: toLocalYmd(compEnd),
  };
}

// ─── Main resolver ───────────────────────────────────────────────────────────

export function resolvePeriod(
  preset: PeriodPreset,
  mode: ComparisonMode,
  customStart?: string,
  customEnd?: string,
  today?: Date,
): ResolvedPeriod | null {
  const range = getPresetDates(preset, customStart, customEnd, today);
  if (!range) return null;
  const { start, end } = range;

  const comp = getComparisonDates(mode, start, end);

  const isSingleMonth = rangeCoversSingleMonthInclusive(start, end);
  const monthKey = isSingleMonth ? monthKeyOf(parseLocalYmd(start)) : null;

  const now = todayLocal(today);
  const nowYmd = toLocalYmd(now);
  const includesToday = start <= nowYmd && nowYmd <= end;

  return {
    start,
    end,
    compareStart: comp?.compStart ?? null,
    compareEnd: comp?.compEnd ?? null,
    isSingleMonth,
    monthKey,
    includesToday,
    periodDays: diffDaysInclusive(start, end),
  };
}

// `this_month` returns first-of-month..today, which isn't strictly a "full"
// calendar month. Treat it as single-month anyway because the goal/projection
// metaphor applies (current month in progress). Helper splits the two rules.
function rangeCoversSingleMonthInclusive(
  startYmd: string,
  endYmd: string,
): boolean {
  const s = parseLocalYmd(startYmd);
  const e = parseLocalYmd(endYmd);
  if (s.getFullYear() !== e.getFullYear() || s.getMonth() !== e.getMonth())
    return false;
  if (s.getDate() !== 1) return false;
  // Accept either "first..last-of-month" (closed past month) or
  // "first..today-in-this-month" (current month in progress).
  const today = todayLocal();
  const isCurrentMonth =
    s.getFullYear() === today.getFullYear() &&
    s.getMonth() === today.getMonth();
  if (isCurrentMonth) return e.getTime() <= today.getTime();
  return rangeCoversSingleMonth(startYmd, endYmd);
}
