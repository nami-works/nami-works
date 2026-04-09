import type { ActiveDiscount } from "./promo-scanner.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export interface CombinesWith {
  orderDiscounts: boolean;
  productDiscounts: boolean;
  shippingDiscounts: boolean;
}

export interface DiscountNode {
  id: string;
  title: string;
  type: "automatic" | "code";
  mechanism: "basic" | "bxgy" | "free_shipping" | "app";
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  value: { percentage?: number; amount?: string } | null;
  combinesWith: CombinesWith;
  targets: string;
  minimumRequirement: string | null;
  codes?: string[];
  usageLimit?: number | null;
}

// ---------------------------------------------------------------------------
// Fetch active automatic discounts
// ---------------------------------------------------------------------------

export async function fetchActiveAutomaticDiscounts(admin: AdminClient): Promise<DiscountNode[]> {
  console.info("[merchandising:discounts] fetchActiveAutomaticDiscounts START");

  const response = await admin.graphql(
    `#graphql
    query AutomaticDiscounts {
      automaticDiscountNodes(first: 50, query: "status:active") {
        edges {
          node {
            id
            automaticDiscount {
              __typename
              ... on DiscountAutomaticBasic {
                title status startsAt endsAt
                minimumRequirement {
                  ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
                  ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
                }
                customerGets {
                  items {
                    ... on AllDiscountItems { allItems }
                    ... on DiscountProducts { products(first: 5) { edges { node { title } } } }
                    ... on DiscountCollections { collections(first: 5) { edges { node { title } } } }
                  }
                  value {
                    ... on DiscountPercentage { percentage }
                    ... on DiscountAmount { amount { amount currencyCode } }
                  }
                }
                combinesWith { orderDiscounts productDiscounts shippingDiscounts }
              }
              ... on DiscountAutomaticFreeShipping {
                title status startsAt endsAt
                minimumRequirement {
                  ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
                }
                combinesWith { orderDiscounts productDiscounts shippingDiscounts }
              }
              ... on DiscountAutomaticBxgy {
                title status startsAt endsAt
                combinesWith { orderDiscounts productDiscounts shippingDiscounts }
              }
              ... on DiscountAutomaticApp {
                title status startsAt endsAt
                combinesWith { orderDiscounts productDiscounts shippingDiscounts }
                appDiscountType { title }
              }
            }
          }
        }
      }
    }`,
  );

  const json = await response.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges = json.data?.automaticDiscountNodes?.edges ?? [];
  const nodes: DiscountNode[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const edge of edges) {
    const ad = edge.node?.automaticDiscount;
    if (!ad) continue;

    const typename: string = ad.__typename ?? "";
    const mechanism: DiscountNode["mechanism"] =
      typename === "DiscountAutomaticBasic" ? "basic"
      : typename === "DiscountAutomaticFreeShipping" ? "free_shipping"
      : typename === "DiscountAutomaticBxgy" ? "bxgy"
      : "app";

    // Extract value
    let value: DiscountNode["value"] = null;
    if (ad.customerGets?.value) {
      const v = ad.customerGets.value;
      if (v.percentage != null) {
        value = { percentage: v.percentage * 100 };
      } else if (v.amount?.amount != null) {
        value = { amount: v.amount.amount };
      }
    }
    if (mechanism === "free_shipping") {
      value = { percentage: 100 };
    }

    // Extract targets
    let targets = "All products";
    const items = ad.customerGets?.items;
    if (items) {
      if (items.products?.edges?.length) {
        targets = items.products.edges.map((e: { node: { title: string } }) => e.node.title).join(", ");
      } else if (items.collections?.edges?.length) {
        targets = items.collections.edges.map((e: { node: { title: string } }) => e.node.title).join(", ");
      }
    }

    // Extract minimum requirement
    let minimumRequirement: string | null = null;
    const mr = ad.minimumRequirement;
    if (mr) {
      if (mr.greaterThanOrEqualToQuantity != null) {
        minimumRequirement = `\u2265 ${mr.greaterThanOrEqualToQuantity} items`;
      } else if (mr.greaterThanOrEqualToSubtotal?.amount != null) {
        minimumRequirement = `\u2265 R$${mr.greaterThanOrEqualToSubtotal.amount}`;
      }
    }

    nodes.push({
      id: edge.node.id,
      title: ad.title ?? "(untitled)",
      type: "automatic",
      mechanism,
      status: ad.status ?? "ACTIVE",
      startsAt: ad.startsAt ?? null,
      endsAt: ad.endsAt ?? null,
      value,
      combinesWith: ad.combinesWith ?? { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
      targets,
      minimumRequirement,
    });
  }

  console.info(`[merchandising:discounts] fetchActiveAutomaticDiscounts OK count=${nodes.length}`);
  return nodes;
}

// ---------------------------------------------------------------------------
// Fetch active code discounts (paginated)
// ---------------------------------------------------------------------------

export async function fetchActiveCodeDiscounts(
  admin: AdminClient,
  maxPages = 4,
): Promise<DiscountNode[]> {
  console.info(`[merchandising:discounts] fetchActiveCodeDiscounts START maxPages=${maxPages}`);
  const nodes: DiscountNode[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (page < maxPages) {
    page++;
    const response = await admin.graphql(
      `#graphql
      query CodeDiscounts($cursor: String) {
        codeDiscountNodes(first: 50, after: $cursor, query: "status:active", sortKey: CREATED_AT) {
          edges {
            node {
              id
              codeDiscount {
                __typename
                ... on DiscountCodeBasic {
                  title status startsAt endsAt
                  codes(first: 1) { edges { node { code } } }
                  customerGets {
                    items {
                      ... on AllDiscountItems { allItems }
                      ... on DiscountCollections { collections(first: 3) { edges { node { title } } } }
                    }
                    value {
                      ... on DiscountPercentage { percentage }
                      ... on DiscountAmount { amount { amount currencyCode } }
                    }
                  }
                  combinesWith { orderDiscounts productDiscounts shippingDiscounts }
                  usageLimit
                }
                ... on DiscountCodeFreeShipping {
                  title status startsAt endsAt
                  codes(first: 1) { edges { node { code } } }
                  combinesWith { orderDiscounts productDiscounts shippingDiscounts }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { cursor } },
    );

    const json = await response.json();
    const data = json.data?.codeDiscountNodes;
    if (!data) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const edge of data.edges ?? []) {
      const cd = edge.node?.codeDiscount;
      if (!cd) continue;

      const typename: string = cd.__typename ?? "";
      const mechanism: DiscountNode["mechanism"] =
        typename === "DiscountCodeFreeShipping" ? "free_shipping" : "basic";

      let value: DiscountNode["value"] = null;
      if (cd.customerGets?.value) {
        const v = cd.customerGets.value;
        if (v.percentage != null) {
          value = { percentage: v.percentage * 100 };
        } else if (v.amount?.amount != null) {
          value = { amount: v.amount.amount };
        }
      }
      if (mechanism === "free_shipping") {
        value = { percentage: 100 };
      }

      let targets = "All products";
      const items = cd.customerGets?.items;
      if (items) {
        if (items.collections?.edges?.length) {
          targets = items.collections.edges.map((e: { node: { title: string } }) => e.node.title).join(", ");
        }
      }

      const codes = (cd.codes?.edges ?? []).map((e: { node: { code: string } }) => e.node.code);

      nodes.push({
        id: edge.node.id,
        title: cd.title ?? "(untitled)",
        type: "code",
        mechanism,
        status: cd.status ?? "ACTIVE",
        startsAt: cd.startsAt ?? null,
        endsAt: cd.endsAt ?? null,
        value,
        combinesWith: cd.combinesWith ?? { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
        targets,
        minimumRequirement: null,
        codes,
        usageLimit: cd.usageLimit ?? null,
      });
    }

    console.info(`[merchandising:discounts] fetchActiveCodeDiscounts page=${page} fetched=${data.edges?.length ?? 0} total=${nodes.length}`);

    if (!data.pageInfo?.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  console.info(`[merchandising:discounts] fetchActiveCodeDiscounts OK count=${nodes.length}`);
  return nodes;
}

// ---------------------------------------------------------------------------
// Combined fetch
// ---------------------------------------------------------------------------

export async function fetchAllActiveDiscounts(admin: AdminClient): Promise<DiscountNode[]> {
  const [automatic, codes] = await Promise.all([
    fetchActiveAutomaticDiscounts(admin),
    fetchActiveCodeDiscounts(admin),
  ]);
  return [...automatic, ...codes];
}

// ---------------------------------------------------------------------------
// Convert to promo-scanner format
// ---------------------------------------------------------------------------

export function toPromoScannerFormat(nodes: DiscountNode[]): ActiveDiscount[] {
  return nodes.map((n) => {
    let summary = "";
    if (n.value?.percentage != null) {
      summary = `${n.value.percentage}% off`;
    } else if (n.value?.amount != null) {
      summary = `R$${n.value.amount} off`;
    } else if (n.mechanism === "bxgy") {
      summary = "Buy X Get Y";
    } else if (n.mechanism === "free_shipping") {
      summary = "Free shipping";
    }
    if (n.minimumRequirement) {
      summary += ` (min: ${n.minimumRequirement})`;
    }

    return {
      title: n.title,
      type: n.type,
      mechanism: n.mechanism,
      summary,
      status: n.status,
      startsAt: n.startsAt,
      endsAt: n.endsAt,
    };
  });
}
