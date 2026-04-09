// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export interface ProductVariant {
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string;
  inventoryQuantity: number | null;
}

export interface ProductWithPricing {
  id: string;
  title: string;
  status: string;
  tags: string[];
  variants: ProductVariant[];
}

export type AlignmentStatus = "aligned" | "deeper" | "shallower" | "not_on_sale" | "launch";

export interface ProductPricingResult {
  product: ProductWithPricing;
  effectivePct: number | null;
  status: AlignmentStatus;
}

export interface PricingHealthSummary {
  campaignTarget: number | null;
  products: ProductPricingResult[];
  aligned: number;
  deeper: number;
  shallower: number;
  notOnSale: number;
  oversold: { product: ProductWithPricing; variant: ProductVariant }[];
  outOfStock: { product: ProductWithPricing; variant: ProductVariant }[];
}

// ---------------------------------------------------------------------------
// Fetch active products with pricing
// ---------------------------------------------------------------------------

export async function fetchActiveProductsWithPricing(
  admin: AdminClient,
  maxPages = 10,
): Promise<ProductWithPricing[]> {
  console.info(`[merchandising:products] fetchActiveProductsWithPricing START maxPages=${maxPages}`);
  const products: ProductWithPricing[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (page < maxPages) {
    page++;
    const response = await admin.graphql(
      `#graphql
      query ProductPricing($cursor: String) {
        products(first: 50, after: $cursor, query: "status:active", sortKey: ID) {
          edges {
            node {
              id title status tags
              variants(first: 10) {
                edges {
                  node {
                    title price compareAtPrice sku inventoryQuantity
                  }
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
    const data = json.data?.products;
    if (!data) break;

    for (const edge of data.edges ?? []) {
      const node = edge.node;
      const title: string = node.title ?? "";

      // Exclude rappi and brinde products
      if (title.startsWith("[rappi]") || title.startsWith("[brinde]")) continue;

      products.push({
        id: node.id,
        title,
        status: node.status ?? "ACTIVE",
        tags: node.tags ?? [],
        variants: (node.variants?.edges ?? []).map((ve: { node: { title: string; price: string; compareAtPrice: string | null; sku: string; inventoryQuantity: number | null } }) => ({
          title: ve.node.title ?? "Default",
          price: ve.node.price ?? "0",
          compareAtPrice: ve.node.compareAtPrice ?? null,
          sku: ve.node.sku ?? "",
          inventoryQuantity: ve.node.inventoryQuantity ?? null,
        })),
      });
    }

    console.info(`[merchandising:products] page=${page} fetched=${data.edges?.length ?? 0} total=${products.length}`);

    if (!data.pageInfo?.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  console.info(`[merchandising:products] fetchActiveProductsWithPricing OK count=${products.length}`);
  return products;
}

// ---------------------------------------------------------------------------
// Compute pricing health
// ---------------------------------------------------------------------------

export function computePricingHealth(products: ProductWithPricing[]): PricingHealthSummary {
  console.info(`[merchandising:products] computePricingHealth START count=${products.length}`);

  // Compute effective discount % for each product (use first variant)
  const results: ProductPricingResult[] = [];
  const pctCounts = new Map<number, number>();
  const oversold: PricingHealthSummary["oversold"] = [];
  const outOfStock: PricingHealthSummary["outOfStock"] = [];

  for (const product of products) {
    const isLaunch = product.tags.some((tag) => tag.toLowerCase() === "lancto");
    const variant = product.variants[0];

    if (!variant) {
      results.push({ product, effectivePct: null, status: "not_on_sale" });
      continue;
    }

    const price = parseFloat(variant.price);
    const compareAt = variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null;

    let effectivePct: number | null = null;
    if (compareAt && compareAt > 0 && price < compareAt) {
      effectivePct = Math.round((1 - price / compareAt) * 1000) / 10;
    }

    // Track inventory issues
    for (const v of product.variants) {
      if (v.inventoryQuantity != null && v.inventoryQuantity < 0) {
        oversold.push({ product, variant: v });
      } else if (v.inventoryQuantity != null && v.inventoryQuantity === 0) {
        outOfStock.push({ product, variant: v });
      }
    }

    if (effectivePct == null) {
      results.push({
        product,
        effectivePct: null,
        status: isLaunch ? "launch" : "not_on_sale",
      });
    } else {
      // Round to nearest 0.5% for grouping
      const rounded = Math.round(effectivePct * 2) / 2;
      pctCounts.set(rounded, (pctCounts.get(rounded) ?? 0) + 1);
      results.push({ product, effectivePct, status: "aligned" }); // status updated below
    }
  }

  // Find dominant percentage (mode)
  let campaignTarget: number | null = null;
  let maxCount = 0;
  for (const [pct, count] of pctCounts) {
    if (count > maxCount) {
      maxCount = count;
      campaignTarget = pct;
    }
  }

  // Re-evaluate alignment against target
  let aligned = 0;
  let deeper = 0;
  let shallower = 0;
  let notOnSale = 0;

  for (const result of results) {
    if (result.status === "launch" || result.status === "not_on_sale") {
      notOnSale++;
      continue;
    }
    if (result.effectivePct == null || campaignTarget == null) {
      notOnSale++;
      result.status = "not_on_sale";
      continue;
    }

    const diff = result.effectivePct - campaignTarget;
    if (Math.abs(diff) <= 2) {
      result.status = "aligned";
      aligned++;
    } else if (diff > 2) {
      result.status = "deeper";
      deeper++;
    } else {
      result.status = "shallower";
      shallower++;
    }
  }

  console.info(`[merchandising:products] computePricingHealth OK target=${campaignTarget}% aligned=${aligned} deeper=${deeper} shallower=${shallower} notOnSale=${notOnSale} oversold=${oversold.length}`);

  return {
    campaignTarget,
    products: results,
    aligned,
    deeper,
    shallower,
    notOnSale,
    oversold,
    outOfStock,
  };
}
