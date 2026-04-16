/**
 * Locale-aware formatting utilities.
 * Replace hardcoded locale strings (e.g. "pt-BR", "en-US")
 * with the session locale passed through loader data.
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

function currencyPrefix(currency: string): string {
  if (currency === "BRL") return "R$";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return `${currency} `;
}

/**
 * Compact currency formatter. R$1.2k / R$1.2M for large values; full
 * locale-aware currency for small values. Negatives are preserved.
 */
export function formatCurrencyCompact(
  value: number,
  currency: string,
  locale: string,
): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const prefix = currencyPrefix(currency);
  if (abs >= 1_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${prefix}${(abs / 1_000).toFixed(1)}k`;
  }
  return formatCurrency(value, currency, locale);
}

/** Compact number formatter: 12.5M / 1.2K / rounded integer for small values. */
export function formatNumberCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}
