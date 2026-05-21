/**
 * Classification thresholds for the per-affiliate margin-leakage detection.
 *
 * All numbers here are tunable — edit in one place and every metric/flag
 * downstream picks up the change. If a weekly review shows too many false
 * positives, raise FLAG_LEAKAGE_PCT or FLAG_LOYALTY_LIFT_PP; too few, lower.
 *
 * The intersection logic: an affiliate is flagged only when ALL THREE hold:
 *   1. totalCustomersTouched >= FLAG_MIN_CUSTOMERS   (noise floor)
 *   2. leakagePct >= FLAG_LEAKAGE_PCT                (material leak)
 *   3. loyaltyLiftPct < FLAG_LOYALTY_LIFT_PP         (no retention defense)
 *
 * Leakage alone is NOT damning. A 50%-leakage affiliate with +15pp loyalty-lift
 * is actually reactivating dormant customers and is a net win. Only when both
 * metrics go bad together does the flag fire.
 */

/** Minimum customers touched before we compute or show the flag. */
export const FLAG_MIN_CUSTOMERS = 10;

/** Leakage %% (pre-existing / total customers) considered "high". */
export const FLAG_LEAKAGE_PCT = 30;

/** Loyalty-lift below this (in percentage points above organic cohort) counts as "low". */
export const FLAG_LOYALTY_LIFT_PP = 5;

/** Days since last successful sync before the UI shows a "stale data" warning. */
export const STALE_SYNC_DAYS = 7;

/** Paid ads spend as %% of organic gross sales — placeholder until we can
 * source this from ad-platform data. Rendered as a subtraction bar in the
 * Organic column of the margin waterfall to make the comparison fair
 * (affiliate cohort has commission + affiliate discount as costs; organic
 * cohort has ad-spend as the equivalent cost). */
export const PAID_ADS_PCT = 10;
