/**
 * Monthly average KPI helpers per inputs/shopify-help.md.
 * - Timeframe rule: include all calendar months that intersect [start, end].
 * - monthlyAverage = sum(monthlyBuckets[month]) / monthsIncluded.length
 */

export type KpiType = "net_sales" | "orders" | "customers";

export function getMonthsIncluded(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= endMonth) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export function bucketByMonth<T>(
  items: T[],
  getTimestamp: (item: T) => Date | string | null,
  getValue: (item: T) => number,
  start: Date,
  end: Date,
  timeZone: string,
): Record<string, number> {
  const months = getMonthsIncluded(start, end);
  const buckets: Record<string, number> = {};
  months.forEach((m) => {
    buckets[m] = 0;
  });
  const startTime = start.getTime();
  const endTime = end.getTime();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  for (const item of items) {
    const raw = getTimestamp(item);
    if (raw == null) continue;
    const date = typeof raw === "string" ? new Date(raw) : raw;
    if (Number.isNaN(date.getTime())) continue;
    const parts = formatter.formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const key = `${y}-${m}`;
    if (key in buckets) {
      const itemTime = date.getTime();
      if (itemTime >= startTime && itemTime <= endTime) {
        buckets[key] += getValue(item);
      }
    }
  }
  return buckets;
}

export function monthlyAverageFromBuckets(
  monthlyBuckets: Record<string, number>,
  monthsIncluded: string[],
): number {
  if (monthsIncluded.length === 0) return 0;
  const sum = monthsIncluded.reduce((s, m) => s + (monthlyBuckets[m] ?? 0), 0);
  return sum / monthsIncluded.length;
}

export function parseIsoDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateKpiParams(
  kpi: string,
  startStr: string,
  endStr: string,
  tz: string,
): { start: Date; end: Date; error?: string } | null {
  const kpis: KpiType[] = ["net_sales", "orders", "customers"];
  if (!kpis.includes(kpi as KpiType)) {
    return null;
  }
  const start = parseIsoDate(startStr);
  const end = parseIsoDate(endStr);
  if (!start || !end) return null;
  if (start > end) return null;
  if (!isValidTimezone(tz)) return null;
  return { start, end };
}
