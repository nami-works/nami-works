// Fetches the candidate pool of live credit holders from Shopify directly —
// no read from apps/connector's database, per the isolation principle.
//
// Deliberately NOT a full customer-base scan. GE Beauty has ~150k
// customers; scanning all of them daily to check store-credit balance would
// be a real API-cost and rate-limit problem, not just slow. Instead this
// pre-filters via the arm tags apps/connector's just-bought-credit.ts
// already stamps on every issuance (just-bought-credit-30d/45d/60d) — a
// tag-based search narrows the candidate pool to roughly the right size
// before any balance/address/order data is fetched.
//
// Tag-search IS eventually-consistent (the exact problem this whole
// initiative exists to fix for real-time issuance) — but that risk doesn't
// apply here: this is a coarse pre-filter for a daily batch job, and every
// candidate's balance/expiry is still verified via a live, non-tag read
// immediately after. A few seconds of index staleness on which customers
// even GET considered is a non-issue for a once-a-day list; it would be a
// real issue if this were the trigger for issuing money, which it isn't.
const ARM_TAG_QUERY = `(tag:'just-bought-credit-30d' OR tag:'just-bought-credit-45d' OR tag:'just-bought-credit-60d')`;

export type ShopifyAdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type RawCreditTransactionNode = {
  __typename: string;
  createdAt: string;
  expiresAt?: string | null;
  remainingAmount?: { amount: string } | null;
};

export type RawOrderLineItem = {
  title: string;
  quantity: number;
  originalUnitPriceSet: { presentmentMoney: { amount: string } } | null;
  image: { url: string } | null;
};

export type RawOrder = {
  createdAt: string;
  totalPriceSet: { presentmentMoney: { amount: string } } | null;
  sourceName: string | null;
  app: { id: string } | null;
  customAttributes: { key: string; value: string }[];
  shippingLines: { edges: { node: { title: string } }[] };
  lineItems: { edges: { node: RawOrderLineItem }[] };
};

export type RawCustomer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  numberOfOrders: string;
  amountSpent: { amount: string } | null;
  defaultPhoneNumber: { phoneNumber: string } | null;
  defaultAddress: { latitude: number | null; longitude: number | null; city: string | null } | null;
  storeCreditAccounts: {
    edges: { node: { balance: { amount: string }; transactions: { edges: { node: RawCreditTransactionNode }[] } } }[];
  };
  orders: { edges: { node: RawOrder }[] };
};

// Query validated against the real Admin API schema (2026-01) via
// validate_graphql_codeblocks, 2026-08-13 — not hand-guessed. Two things
// that check caught: Customer.phone is deprecated (use
// defaultPhoneNumber.phoneNumber), and this query needs
// read_store_credit_accounts + read_store_credit_account_transactions
// scopes, not just read_customers/read_orders — declared in
// shopify.app.toml.
//
// numberOfOrders/amountSpent + orders(first: 10)/lineItems(quantity) added
// 2026-08-17 for the customer highlights modal — also re-validated (2026-04),
// no new scopes required.
//
// Order-level totalPriceSet/sourceName/app/customAttributes/shippingLines/
// fulfillmentOrders and per-line-item originalUnitPriceSet/image added
// 2026-08-18 for the richer modal (order history with delivery-method
// badges, product prices/images) — see delivery-channel.ts for how these
// feed the loader.
//
// INCIDENT (2026-08-18, ~1h outage): these additions pushed
// requestedQueryCost to 1244 at the previous customers(first: 100) page
// size, over Shopify's 1000-point single-query cap — every loader request
// threw GraphqlQueryError and the app showed its generic ErrorBoundary.
// Verified live via curl against the real API (cost is a static
// query-shape calculation, independent of which token/app queries it):
// first:100 -> 1244, first:60-90 -> 1106, first:40-50 -> 968, first:25-30
// -> 830. Dropped to 30 for real margin (17%), not just barely under.
// Cost doesn't scale linearly with `first` — Shopify buckets it — so
// don't assume a proportional adjustment is safe next time; re-measure.
//
// SECOND INCIDENT, same deploy: fulfillmentOrders (used for the
// methodType-based channel badge) hit "Access denied for fulfillmentOrders
// field" — this app's scopes don't cover it, and adding a scope needs an
// app-config change plus the shop re-consenting, not a same-day fix.
// Dropped the field; delivery-channel.ts now derives the badge from
// shippingLines + the IGLU custom attribute instead (see its own comment).
//
// THIRD INCIDENT, same deploy: the "Ainda não experimentou" discovery
// products also had a live products() lookup (discovery-products.ts, now
// deleted) for image/price — hit "Access denied for products field", same
// missing-scope story (read_products isn't granted either). That section
// shows name-only until read_products is approved and re-consented.
//
// PERF (2026-08-25): with fulfillmentOrders and products both gone, the
// query is lighter than when the 30-page-size measurement was taken.
// Re-measured live: first:70-90 -> 914 (safe), first:100 -> 1028 (over).
// Bumped to 80 — same margin discipline as before (safe, not just-under),
// but ~2.7x fewer paginated round trips than 30 for the same candidate
// pool, which was the dominant cost in the "app takes forever to load"
// complaint (worse than pre-incident, since 30 was picked purely to fix
// the cost cap, not for throughput).
const QUERY = `#graphql
  query LiveCreditHolders($cursor: String) {
    customers(first: 80, after: $cursor, query: "${ARM_TAG_QUERY}") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id firstName lastName
          numberOfOrders
          amountSpent { amount }
          defaultPhoneNumber { phoneNumber }
          defaultAddress { latitude longitude city }
          storeCreditAccounts(first: 5) {
            edges {
              node {
                balance { amount }
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
          orders(first: 10, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                createdAt
                totalPriceSet { presentmentMoney { amount } }
                sourceName
                app { id }
                customAttributes { key value }
                shippingLines(first: 1) { edges { node { title } } }
                lineItems(first: 20) {
                  edges {
                    node {
                      title
                      quantity
                      originalUnitPriceSet { presentmentMoney { amount } }
                      image { url }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

// Same page-size/pagination discipline as apps/connector's Omie windowed
// fetch (contas-a-pagar.ts) — bounded pages, no unbounded accumulation, a
// hard cap on total pages fetched so a runaway query can't hang or blow
// the request budget.
const MAX_PAGES = 50; // 5,000 candidates — comfortably above any realistic daily pool

export async function fetchLiveCreditHolders(admin: ShopifyAdminClient): Promise<RawCustomer[]> {
  const results: RawCustomer[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage && pages < MAX_PAGES) {
    const res = await admin.graphql(QUERY, { variables: { cursor } });
    const json = (await res.json()) as {
      data?: { customers?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: RawCustomer }[] } };
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
