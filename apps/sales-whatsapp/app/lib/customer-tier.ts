// Row-level proxy signals for the worklist redesign (2026-09-01), per the
// crm-director consult: order count is the single highest-leverage fact for
// HOW a rep should open the conversation (first-timer vs. repeat vs. loyal),
// and it's already computed server-side — no new Shopify dependency.
//
// This is a LOCAL PROXY, not GE's real rfm_group segment (that's a Shopify-
// native customer segment this app doesn't read). Thresholds are
// placeholders pending growth-analyst's real order-count distribution —
// see inputs/mockups/ge-sales-whatsapp-worklist-v2.html's "Questões em
// aberto" panel.

export type CustomerTier = "nova" | "recorrente" | "fiel";

export const TIER_LABELS: Record<CustomerTier, string> = {
  nova: "Nova",
  recorrente: "Recorrente",
  fiel: "Fiel",
};

export function tierFor(numberOfOrders: number): CustomerTier {
  if (numberOfOrders <= 1) return "nova";
  if (numberOfOrders <= 3) return "recorrente";
  return "fiel";
}

// Merges credit balance + days-left into one glanceable urgency band,
// replacing two columns a rep had to combine mentally. Thresholds are the
// same placeholder caveat as tierFor — not validated with the sales team.
export type UrgencyBand = "critical" | "warning" | "neutral";

export function urgencyFor(daysUntilExpiry: number): UrgencyBand {
  if (daysUntilExpiry <= 6) return "critical";
  if (daysUntilExpiry <= 15) return "warning";
  return "neutral";
}
