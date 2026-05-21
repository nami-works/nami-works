export interface SmartBadge {
  text: string;
  handle: string;
  type: "dollar" | "percent";
  value: number;
}

/**
 * Compute the most impactful discount badge for a product in a campaign.
 * Compares the absolute % and $ values — the larger number wins.
 * Only the derived value (not the campaign's original rule) is rounded.
 */
export function computeSmartBadge(
  discountType: "percentage" | "fixed",
  discountValue: number,
  originalPrice: number,
): SmartBadge | null {
  if (originalPrice <= 0 || discountValue <= 0) return null;

  let dollarDiscount: number;
  let percentDiscount: number;

  if (discountType === "percentage") {
    percentDiscount = discountValue;
    dollarDiscount = originalPrice * (discountValue / 100);
  } else {
    dollarDiscount = discountValue;
    percentDiscount = (discountValue / originalPrice) * 100;
  }

  const roundedDollar = Math.floor(dollarDiscount);
  const roundedPercent = Math.floor(percentDiscount);

  if (roundedDollar >= roundedPercent) {
    const display = discountType === "fixed" ? discountValue : roundedDollar;
    return {
      text: `R$${display} OFF`,
      handle: `r-${display}-off`,
      type: "dollar",
      value: display,
    };
  } else {
    const display = discountType === "percentage" ? discountValue : roundedPercent;
    return {
      text: `${display}% OFF`,
      handle: `${display}-percent-off`,
      type: "percent",
      value: display,
    };
  }
}
