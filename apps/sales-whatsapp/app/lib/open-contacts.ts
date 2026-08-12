import { COOLDOWN_DAYS, cooldownExpired } from "./cooldown.js";

// Pure decision logic for "is this WorklistContactEvent row still open
// (should exclude the customer from a fresh worklist)" — extracted for
// testability after an adversarial review (2026-08-13) found the original
// inline filter had a real bug: it required `!skippedAt`, which means a
// skipped row can NEVER be "open" — the skip button was a silent no-op,
// the customer reappeared on the very next loader run.
//
// Correct semantics:
// - Converted: always open (permanent exclusion — they already bought).
// - Skipped: open only within the same cooldown window as a contact (a
//   "not interested" today shouldn't be retried tomorrow, but isn't
//   permanent either — no reason given to treat it differently from a
//   plain unconverted contact for MVP).
// - Otherwise (contacted, no resolution yet): open within cooldown.
export function isRowOpen(
  row: { convertedAt: Date | null; skippedAt: Date | null; contactedAt: Date },
  now: Date,
): boolean {
  if (row.convertedAt) return true;
  if (row.skippedAt) return !cooldownExpired(row.skippedAt, now);
  return !cooldownExpired(row.contactedAt, now);
}

export type OpenContactRow = { customerGid: string; convertedAt: Date | null; skippedAt: Date | null; contactedAt: Date };

export function openCustomerGids(rows: OpenContactRow[], now: Date): Set<string> {
  return new Set(rows.filter((r) => isRowOpen(r, now)).map((r) => r.customerGid));
}

// Lookback window for the Prisma query itself — anything older than this
// can't possibly be "open" under cooldownExpired's own math, so there's no
// reason to pull it from the DB at all. Prevents the table scan from
// growing unbounded as the app accumulates months of history (also
// flagged in the same review). Converted rows are the one case that could
// theoretically matter past this window, but by the time a customer's
// original credit cycle is this old, re-including them as a fresh
// candidate on a NEW credit cycle is correct, not a bug — so bounding the
// lookback for converted rows too is intentional, not an oversight.
export const OPEN_CONTACTS_LOOKBACK_DAYS = COOLDOWN_DAYS * 2;

export function openContactsLookbackCutoff(now: Date): Date {
  return new Date(now.getTime() - OPEN_CONTACTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}
