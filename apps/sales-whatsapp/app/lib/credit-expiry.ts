// Resolves a customer's real just-bought-arm credit expiry from their raw
// Shopify store-credit transactions — replacing the placeholder that
// previously made ranking degrade to a pure balance tiebreak.
//
// Per the bump-feature spike (2026-08-12, documented in the PM brief):
// Shopify's StoreCreditSystemEvent doesn't tag which app/program issued a
// credit (storeCreditAccountCredit lands as generic ADJUSTMENT, same as
// CD Extrema or reactivation-wave credits). The just-bought system is the
// only program using exactly 30/45/60-day expiry windows (CD Extrema uses
// 90 days, reactivation waves used 7) — so a credit transaction whose
// (expiresAt - createdAt) is exactly 30, 45, or 60 days is identified as
// "ours" purely from data Shopify already gives us, no connector coupling.
const JUST_BOUGHT_ARM_DAYS = [30, 45, 60] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
// Real-world creation/expiry timestamps won't land on an exact millisecond
// boundary (network/processing jitter) — allow a small tolerance rather
// than demanding an exact 30.000000-day interval.
const TOLERANCE_MS = 6 * 60 * 60 * 1000; // 6 hours

export type CreditTransaction = {
  createdAt: string; // ISO
  expiresAt: string | null; // ISO
  remainingAmount: number;
};

function matchesJustBoughtArm(createdAt: string, expiresAt: string): boolean {
  const spanMs = new Date(expiresAt).getTime() - new Date(createdAt).getTime();
  return JUST_BOUGHT_ARM_DAYS.some((days) => Math.abs(spanMs - days * DAY_MS) <= TOLERANCE_MS);
}

// Among all of a customer's credit transactions, find the ones that match
// the just-bought arm signature AND still have money left, then return the
// soonest-expiring one's expiresAt — that's the real "vence em" date for
// the worklist. Returns null if the customer has no matching, unspent
// just-bought credit (shouldn't happen for anyone reaching the worklist at
// all, since they were found via the just-bought-credit-*d tag search, but
// handled explicitly rather than assumed).
export function resolveJustBoughtExpiry(transactions: CreditTransaction[]): string | null {
  const candidates = transactions.filter(
    (t) => t.expiresAt !== null && t.remainingAmount > 0 && matchesJustBoughtArm(t.createdAt, t.expiresAt),
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime());
  return candidates[0]!.expiresAt;
}
