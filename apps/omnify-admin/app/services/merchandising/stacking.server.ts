import type { DiscountNode, CombinesWith } from "./discounts.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "critical" | "warning" | "info";

export interface StackingRisk {
  discountId: string;
  discountTitle: string;
  riskLevel: RiskLevel;
  isAffiliate: boolean;
  combinesWith: CombinesWith;
  details: string[];
  stackableWith: { id: string; title: string; worstCasePct?: number }[];
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectStackingRisks(discounts: DiscountNode[]): StackingRisk[] {
  console.info(`[merchandising:stacking] detectStackingRisks START count=${discounts.length}`);
  const risks: StackingRisk[] = [];

  for (const d of discounts) {
    const details: string[] = [];
    const stackableWith: StackingRisk["stackableWith"] = [];
    const cw = d.combinesWith;
    const isAffiliate = isAffiliateCode(d);

    // Check if it combines with everything
    const combinesAll = cw.orderDiscounts && cw.productDiscounts && cw.shippingDiscounts;
    if (combinesAll) {
      details.push("Combines with all discount types (order, product, shipping)");
    }

    // Find stackable pairs
    for (const other of discounts) {
      if (other.id === d.id) continue;

      const canStack = checkCanStack(d, other);
      if (!canStack) continue;

      // Calculate worst-case if both are percentage-based
      let worstCasePct: number | undefined;
      const dPct = d.value?.percentage;
      const oPct = other.value?.percentage;
      if (dPct != null && oPct != null) {
        worstCasePct = (1 - (1 - dPct / 100) * (1 - oPct / 100)) * 100;
        worstCasePct = Math.round(worstCasePct * 10) / 10;
      }

      stackableWith.push({
        id: other.id,
        title: other.title,
        worstCasePct,
      });

      if (worstCasePct != null) {
        details.push(`Stacks with "${other.title}" \u2192 up to ${worstCasePct}% effective discount`);
      } else {
        details.push(`Stacks with "${other.title}"`);
      }
    }

    // Determine risk level — affiliates are expected to combine, so they're "info"
    let riskLevel: RiskLevel = "info";
    if (stackableWith.length > 0 && !isAffiliate) {
      const maxPct = Math.max(0, ...stackableWith.map((s) => s.worstCasePct ?? 0));
      riskLevel = maxPct > 25 ? "critical" : "warning";
    }

    risks.push({
      discountId: d.id,
      discountTitle: d.title,
      riskLevel,
      isAffiliate,
      combinesWith: cw,
      details,
      stackableWith,
    });
  }

  const criticalCount = risks.filter((r) => r.riskLevel === "critical").length;
  const warningCount = risks.filter((r) => r.riskLevel === "warning").length;
  console.info(`[merchandising:stacking] detectStackingRisks OK critical=${criticalCount} warning=${warningCount} clean=${risks.length - criticalCount - warningCount}`);

  return risks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Affiliate codes follow the NAME10 / NAME15 / NAME20 pattern */
function isAffiliateCode(d: DiscountNode): boolean {
  if (d.type !== "code") return false;
  return /^[A-Z]+\d{1,2}$/i.test(d.title);
}

function checkCanStack(a: DiscountNode, b: DiscountNode): boolean {
  // Both must allow combining with each other's type
  const aIsProduct = a.mechanism === "basic" || a.mechanism === "bxgy";
  const aIsShipping = a.mechanism === "free_shipping";

  const bIsProduct = b.mechanism === "basic" || b.mechanism === "bxgy";
  const bIsShipping = b.mechanism === "free_shipping";

  // Product + Product stacking
  if (aIsProduct && bIsProduct) {
    return a.combinesWith.productDiscounts && b.combinesWith.productDiscounts;
  }

  // Product + Shipping stacking
  if ((aIsProduct && bIsShipping) || (aIsShipping && bIsProduct)) {
    return a.combinesWith.shippingDiscounts && b.combinesWith.shippingDiscounts;
  }

  // Shipping + Shipping (unusual but possible)
  if (aIsShipping && bIsShipping) {
    return a.combinesWith.shippingDiscounts && b.combinesWith.shippingDiscounts;
  }

  // Order discounts
  if (a.combinesWith.orderDiscounts && b.combinesWith.orderDiscounts) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Stale discount detection
// ---------------------------------------------------------------------------

export interface StaleDiscount {
  id: string;
  title: string;
  code: string;
  value: string;
  startsAt: string | null;
  ageDays: number;
  category: "return" | "seasonal" | "one-off" | "affiliate";
}

const SEASONAL_KEYWORDS = [
  "NAMORADOS", "VERAO", "NATAL", "CARNAVAL", "PASCOA", "INVERNO",
  "PRIMAVERA", "MAES", "PAIS", "CONSUMIDOR", "BLACKFRIDAY", "CYBER",
];

export function detectStaleDiscounts(discounts: DiscountNode[], thresholdDays = 90): StaleDiscount[] {
  console.info(`[merchandising:stacking] detectStaleDiscounts START count=${discounts.length} threshold=${thresholdDays}d`);
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const stale: StaleDiscount[] = [];

  for (const d of discounts) {
    // Only code discounts with no end date
    if (d.type !== "code") continue;
    if (d.endsAt) continue;
    if (!d.startsAt) continue;

    const startMs = new Date(d.startsAt).getTime();
    const ageMs = now - startMs;
    if (ageMs < thresholdMs) continue;

    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    const code = d.codes?.[0] ?? d.title;
    const titleUpper = d.title.toUpperCase();

    // Categorize
    let category: StaleDiscount["category"] = "one-off";
    if (titleUpper.startsWith("RETURN") || titleUpper.startsWith("BEAUTYBACK")) {
      category = "return";
    } else if (SEASONAL_KEYWORDS.some((kw) => titleUpper.includes(kw))) {
      category = "seasonal";
    } else if (titleUpper.startsWith("AVULSO")) {
      category = "one-off";
    } else if (/^[A-Z]+\d{1,2}$/.test(titleUpper)) {
      // Pattern like NAME10, NAME15 — affiliate codes
      category = "affiliate";
    }

    let valueStr = "\u2014";
    if (d.value?.percentage != null) {
      valueStr = `${d.value.percentage}%`;
    } else if (d.value?.amount != null) {
      valueStr = `R$${d.value.amount}`;
    }

    stale.push({
      id: d.id,
      title: d.title,
      code,
      value: valueStr,
      startsAt: d.startsAt,
      ageDays,
      category,
    });
  }

  console.info(`[merchandising:stacking] detectStaleDiscounts OK count=${stale.length}`);
  return stale;
}
