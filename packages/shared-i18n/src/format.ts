/**
 * Locale-aware formatting utilities.
 */

export function formatCurrency(
  amount: number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(date));
}

export function formatMonthLabel(monthStr: string, locale: string): string {
  const [year, month] = monthStr.split("-");
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}
