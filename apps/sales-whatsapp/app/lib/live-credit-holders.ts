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
  fulfillmentOrders: {
    edges: {
      node: {
        deliveryMethod: { methodType: string | null } | null;
        assignedLocation: { location: { name: string } | null } | null;
      };
    }[];
  };
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
// badges, product prices/images) — see delivery-channel.ts and
// discovery-products.ts for how these feed the loader. Not yet re-run
// through validate_graphql_codeblocks (MCP was disconnected this session);
// verify on first live smoke-test post-deploy.
const QUERY = `#graphql
  query LiveCreditHolders($cursor: String) {
    customers(first: 100, after: $cursor, query: "${ARM_TAG_QUERY}") {
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
                fulfillmentOrders(first: 1) {
                  edges {
                    node {
                      deliveryMethod { methodType }
                      assignedLocation { location { name } }
                    }
                  }
                }
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
