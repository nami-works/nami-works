/**
 * Local Delivery Analytics — P&L math (pure functions, no I/O).
 *
 * Three framings exposed via `frame()`:
 *   - "pl_impact"        (default) — full shipping P&L delta vs warehouse counterfactual.
 *   - "revenue_retained" — what we kept on customer-charged shipping vs WH rate.
 *   - "net_cost_delta"   — LD carrier cost minus WH carrier cost (negative = saving).
 *
 * Edge cases:
 *   - Free-ship orders: `ldRevenueSubunits === 0` is valid; LD carrier cost still applies.
 *   - Free-ship counterfactual: `warehouseCustomerRateSubunits` reflects what the customer
 *     WOULD have paid had the merchant not granted free-ship — NOT post-discount paid amount.
 *
 * See docs/plans/local-delivery-analytics.md §5.1.
 */

export type OrderInputs = {
  /** Customer-charged for LD shipping (R$ in cents). 0 for free-ship orders. */
  ldRevenueSubunits: number;
  /** What the merchant paid Lalamove for the LD route (R$ in cents). */
  ldCarrierCostSubunits: number;
  /** What the merchant WOULD have paid the warehouse carrier (Intelipost) for the same order. */
  warehouseCounterfactualSubunits: number;
  /** What the customer WOULD have been charged for warehouse shipping (un-discounted). */
  warehouseCustomerRateSubunits: number;
  /** Tax savings (BR ICMS, etc.) attributable to the LD shipment. */
  taxSavingsSubunits: number;
};

export type Framing = "pl_impact" | "revenue_retained" | "net_cost_delta";

export const FRAMINGS: ReadonlyArray<Framing> = [
  "pl_impact",
  "revenue_retained",
  "net_cost_delta",
];

export function isFraming(value: unknown): value is Framing {
  return value === "pl_impact" || value === "revenue_retained" || value === "net_cost_delta";
}

/**
 * Net result of LD vs warehouse counterfactual, including tax savings.
 *
 *   ldNet = ldRevenue + taxSavings - ldCarrierCost
 *   whNet = whCustomerRate - whCarrierCost
 *   plImpact = ldNet - whNet
 *
 * Positive = LD ahead. Negative = warehouse would have been better.
 */
export function plImpact(o: OrderInputs): number {
  const ldNet = o.ldRevenueSubunits + o.taxSavingsSubunits - o.ldCarrierCostSubunits;
  const whNet = o.warehouseCustomerRateSubunits - o.warehouseCounterfactualSubunits;
  return ldNet - whNet;
}

/**
 * How much customer-charged revenue we kept by not pricing LD at the WH rate.
 * Positive = LD discounted vs WH (we charged the customer less). Negative = LD priced higher.
 */
export function revenueRetained(o: OrderInputs): number {
  return o.warehouseCustomerRateSubunits - o.ldRevenueSubunits;
}

/**
 * LD carrier cost minus warehouse counterfactual cost.
 * Negative = saving (LD was cheaper to operate). Positive = LD cost more.
 */
export function netCostDelta(o: OrderInputs): number {
  return o.ldCarrierCostSubunits - o.warehouseCounterfactualSubunits;
}

/** Dispatch based on `framing`. Falls back to plImpact for unknown values. */
export function frame(framing: string, o: OrderInputs): number {
  switch (framing) {
    case "pl_impact":
      return plImpact(o);
    case "revenue_retained":
      return revenueRetained(o);
    case "net_cost_delta":
      return netCostDelta(o);
    default:
      return plImpact(o);
  }
}

/**
 * Sum a list of OrderInputs into a single OrderInputs total. Useful for rolling
 * up city / month aggregates.
 */
export function sumInputs(orders: ReadonlyArray<OrderInputs>): OrderInputs {
  const acc: OrderInputs = {
    ldRevenueSubunits: 0,
    ldCarrierCostSubunits: 0,
    warehouseCounterfactualSubunits: 0,
    warehouseCustomerRateSubunits: 0,
    taxSavingsSubunits: 0,
  };
  for (const o of orders) {
    acc.ldRevenueSubunits += o.ldRevenueSubunits;
    acc.ldCarrierCostSubunits += o.ldCarrierCostSubunits;
    acc.warehouseCounterfactualSubunits += o.warehouseCounterfactualSubunits;
    acc.warehouseCustomerRateSubunits += o.warehouseCustomerRateSubunits;
    acc.taxSavingsSubunits += o.taxSavingsSubunits;
  }
  return acc;
}

/**
 * "LD net" component of the P&L story (used in the supporting cards on the
 * analytics page).
 */
export function ldNet(o: OrderInputs): number {
  return o.ldRevenueSubunits + o.taxSavingsSubunits - o.ldCarrierCostSubunits;
}

/**
 * "Warehouse counterfactual net" component.
 */
export function whNet(o: OrderInputs): number {
  return o.warehouseCustomerRateSubunits - o.warehouseCounterfactualSubunits;
}
