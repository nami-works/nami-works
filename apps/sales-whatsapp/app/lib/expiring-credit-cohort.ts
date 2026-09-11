// Cohort for the scheduled "credit expiring soon" WhatsApp push
// (docs/handoff-beautyback-credit-automation.md §7). Distinct from
// live-credit-holders.ts's worklist cohort: that one drives the rep-facing
// worklist UI (just-bought arm tags only); this one targets ANY live credit
// tranche expiring on a given day, across every issuance program, EXCEPT
// credit-reactivation — explicitly excluded per Lucas's decision (2026-09-11)
// after this session's own investigation confirmed the reactivation tag's
// tranches are a recurring mass-batch cliff (Branch 3 of
// issue_reactivation_wave.py: 21d expiry at a fixed T23:59:59Z clock time),
// not individually-timed like every other issuance path.
import type { ShopifyAdminClient } from "./live-credit-holders.js";

// Every ctx tag a credit-bearing customer can carry per handoff §1's table,
// minus credit-reactivation (excluded by design, see module comment above).
// Pre-filtering by tag (rather than scanning GE Beauty's ~150k customers)
// mirrors live-credit-holders.ts's ARM_TAG_QUERY approach.
const CREDIT_TAG_QUERY =
  "(tag:'just-bought-credit-30d' OR tag:'just-bought-credit-45d' OR tag:'just-bought-credit-60d' " +
  "OR tag:'credit-refill-soon' OR tag:'credit-refill-later' OR tag:'credit-refill' OR tag:'credit-goodwill') " +
  "AND -tag:'credit-reactivation'";

export type RawTranche = {
  __typename: string;
  createdAt: string;
  expiresAt?: string | null;
  remainingAmount?: { amount: string } | null;
};

export type RawOrderForRepeatCheck = {
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
};

export type RawCandidate = {
  id: string;
  firstName: string | null;
  phone: string | null;
  tags: string[];
  defaultAddress: { phone: string | null } | null;
  storeCreditAccounts: { edges: { node: { transactions: { edges: { node: RawTranche }[] } } }[] };
  orders: { edges: { node: RawOrderForRepeatCheck }[] };
};

// Cost discipline: apps/sales-whatsapp already hit the 1000-point single-query
// cap twice (see live-credit-holders.ts's incident comments) — this query is
// lighter per-customer (5 orders, no line items/images) but keep the same
// conservative-page-size-with-margin discipline rather than assuming it's fine.
const QUERY = `#graphql
  query ExpiringCreditCohort($cursor: String) {
    customers(first: 60, after: $cursor, query: "${CREDIT_TAG_QUERY}") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          firstName
          phone
          tags
          defaultAddress { phone }
          storeCreditAccounts(first: 5) {
            edges {
              node {
                transactions(first: 10, sortKey: CREATED_AT, reverse: true) {
                  edges {
                    node {
                      __typename
                      createdAt
                      ... on StoreCreditAccountCreditTransaction {
                        expiresAt
                        remainingAmount { amount }
                      }
                    }
                  }
                }
              }
            }
          }
          orders(first: 5, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                createdAt
                cancelledAt
                displayFinancialStatus
              }
            }
          }
        }
      }
    }
  }`;

const MAX_PAGES = 50; // 3,000 candidates — same bounded-pagination discipline as live-credit-holders.ts

export async function fetchExpiringCreditCandidates(admin: ShopifyAdminClient): Promise<RawCandidate[]> {
  const results: RawCandidate[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage && pages < MAX_PAGES) {
    const res = await admin.graphql(QUERY, { variables: { cursor } });
    const json = (await res.json()) as {
      data?: { customers?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: RawCandidate }[] } };
    };
    const page = json.data?.customers;
    if (!page) break;

    for (const edge of page.edges) results.push(edge.node);
    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    pages += 1;
  }

  return results;
}

export type ExpiringTranche = {
  customerGid: string;
  firstName: string | null;
  phone: string;
  trancheCreatedAt: string; // ISO
  expiresAt: string; // ISO
  amount: number;
  // Same orders(first:5) data already fetched for the repeat-buyer check,
  // reused for PAW's modal-slot computation (paw.ts) instead of a second
  // per-customer query — every tranche row for the same customer carries
  // the same list.
  orderCreatedAtIso: string[];
};

// BRT = UTC-3, no DST in Brazil since 2019 — a fixed offset is correct, not
// a simplification that will drift.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function brtDateKey(isoUtc: string): string {
  const brt = new Date(new Date(isoUtc).getTime() - BRT_OFFSET_MS);
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, "0")}-${String(brt.getUTCDate()).padStart(2, "0")}`;
}

function validE164Phone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length !== 10 && local.length !== 11) return null;
  return `+55${local}`;
}

function placedValidOrderAfter(orders: RawOrderForRepeatCheck[], afterIso: string): boolean {
  const afterMs = new Date(afterIso).getTime();
  return orders.some(
    (o) =>
      new Date(o.createdAt).getTime() > afterMs &&
      !o.cancelledAt &&
      o.displayFinancialStatus !== "REFUNDED" &&
      o.displayFinancialStatus !== "VOIDED",
  );
}

// Filters the raw candidate pool down to (customer, tranche) pairs that
// should actually receive the push on `targetDateBrt` — steps 2-5 of the
// handoff's cohort query spec, in order. One customer can yield more than
// one tranche if they hold multiple live tranches expiring the same day
// (rare, but the ledger's unique key is per-tranche so it's handled either
// way).
export function filterExpiringTranches(candidates: RawCandidate[], targetDateBrt: string): ExpiringTranche[] {
  const out: ExpiringTranche[] = [];

  for (const c of candidates) {
    // Defensive: the search query already excludes credit-reactivation, but
    // don't trust tag-search alone for a decision this deliberate — it's
    // eventually consistent (same caveat live-credit-holders.ts documents).
    if (c.tags.includes("credit-reactivation")) continue;

    const phone = validE164Phone(c.phone ?? c.defaultAddress?.phone ?? null);
    if (!phone) continue;

    const tranches = c.storeCreditAccounts.edges.flatMap((acc) =>
      acc.node.transactions.edges
        .map((e) => e.node)
        .filter(
          (t): t is RawTranche & { expiresAt: string; remainingAmount: { amount: string } } =>
            t.__typename === "StoreCreditAccountCreditTransaction" &&
            !!t.expiresAt &&
            !!t.remainingAmount &&
            Number(t.remainingAmount.amount) > 0 &&
            new Date(t.expiresAt).getTime() > Date.now() &&
            brtDateKey(t.expiresAt) === targetDateBrt,
        ),
    );
    if (tranches.length === 0) continue;

    const orders = c.orders.edges.map((e) => e.node);
    const orderCreatedAtIso = orders.map((o) => o.createdAt);

    for (const t of tranches) {
      if (placedValidOrderAfter(orders, t.createdAt)) continue;
      out.push({
        customerGid: c.id,
        firstName: c.firstName,
        phone,
        trancheCreatedAt: t.createdAt,
        expiresAt: t.expiresAt,
        amount: Number(t.remainingAmount.amount),
        orderCreatedAtIso,
      });
    }
  }

  return out;
}
