export type DiscountMode =
  | "highest"
  | "percent"
  | "dollar"
  | "percent_with_dollar_threshold";

export interface VariantDiscount {
  dollar: number;
  percent: number;
}

export interface ProductDiscount {
  dollar: number;
  percent: number;
  effectiveValue: number;
  effectiveType: "percent" | "dollar";
}

export interface TierInput {
  discountType: "percent" | "dollar";
  startingAt: number;
  metaobjectHandles: string[];
  metaobjectGids: string[];
  sortOrder: number;
}

export function computeVariantDiscount(
  price: number,
  compareAtPrice: number | null,
): VariantDiscount {
  if (compareAtPrice == null || compareAtPrice <= price) {
    return { dollar: 0, percent: 0 };
  }

  const dollar = compareAtPrice - price;
  const percent = (dollar / compareAtPrice) * 100;

  return { dollar, percent };
}

export function resolveProductDiscount(
  variants: Array<{ price: number; compareAtPrice: number | null }>,
  mode: DiscountMode,
  dollarThreshold?: number,
): ProductDiscount {
  let maxDollar = 0;
  let maxPercent = 0;

  for (const variant of variants) {
    const d = computeVariantDiscount(variant.price, variant.compareAtPrice);
    if (d.dollar > maxDollar) maxDollar = d.dollar;
    if (d.percent > maxPercent) maxPercent = d.percent;
  }

  let effectiveValue: number;
  let effectiveType: "percent" | "dollar";

  switch (mode) {
    case "percent":
      effectiveValue = maxPercent;
      effectiveType = "percent";
      break;
    case "dollar":
      effectiveValue = maxDollar;
      effectiveType = "dollar";
      break;
    case "percent_with_dollar_threshold":
      if (dollarThreshold != null && maxDollar >= dollarThreshold) {
        effectiveValue = maxDollar;
        effectiveType = "dollar";
      } else {
        effectiveValue = maxPercent;
        effectiveType = "percent";
      }
      break;
    case "highest":
    default:
      if (maxDollar > maxPercent) {
        effectiveValue = maxDollar;
        effectiveType = "dollar";
      } else {
        effectiveValue = maxPercent;
        effectiveType = "percent";
      }
      break;
  }

  return { dollar: maxDollar, percent: maxPercent, effectiveValue, effectiveType };
}

export function matchTier(
  effectiveValue: number,
  effectiveType: "percent" | "dollar",
  tiers: TierInput[],
): TierInput | null {
  if (effectiveValue <= 0 || tiers.length === 0) return null;

  const matching = tiers
    .filter((t) => t.discountType === effectiveType)
    .sort((a, b) => b.startingAt - a.startingAt);

  for (const tier of matching) {
    if (effectiveValue >= tier.startingAt) {
      return tier;
    }
  }

  return null;
}

/* ── Smart Badge (campaign-aware) ── */

export { computeSmartBadge } from "./smart-badge";
export type { SmartBadge } from "./smart-badge";
