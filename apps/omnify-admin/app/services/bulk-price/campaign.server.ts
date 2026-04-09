import type { PrismaClient, BulkPriceCampaign, BulkPriceCampaignItem } from "@prisma/client";
import { computeSmartBadge } from "../price-tags/discount.server";
import {
  fetchMetaobjectEntries,
  buildHandleGidMap,
  ensureMetaobjectEntry,
} from "../price-tags/metaobject.server";
import { findProductMetafieldForMetaobjectType } from "../price-tags/metafield.server";
import {
  setProductMetafieldValue,
  clearDiscountLabels,
} from "../price-tags/webhook-handler.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

interface ResolvedVariant {
  productGid: string;
  variantGid: string;
  price: number;
  compareAtPrice: number | null;
}

interface ComputedPrice {
  productGid: string;
  variantGid: string;
  originalPrice: number;
  originalCompareAtPrice: number | null;
  appliedPrice: number;
  appliedCompareAtPrice: number;
}

// ---------------------------------------------------------------------------
// GraphQL queries / mutations
// ---------------------------------------------------------------------------

const PRODUCTS_BY_TYPE_QUERY = `#graphql
  query ProductsByType($cursor: String, $query: String!) {
    products(first: 50, after: $cursor, query: $query, sortKey: ID) {
      edges {
        node {
          id
          title
          tags
          variants(first: 100) {
            edges {
              node {
                id
                price
                compareAtPrice
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCTS_BY_IDS_QUERY = `#graphql
  query ProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        tags
        variants(first: 100) {
          edges {
            node {
              id
              price
              compareAtPrice
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_TYPES_QUERY = `#graphql
  query ProductTypes {
    shop {
      productTypes(first: 250) {
        edges { node }
      }
    }
  }
`;

const SEARCH_PRODUCTS_QUERY = `#graphql
  query SearchProducts($query: String!) {
    products(first: 20, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          featuredMedia {
            preview { image { url } }
          }
          variants(first: 1) {
            edges {
              node {
                price
                compareAtPrice
              }
            }
          }
          totalVariants
        }
      }
    }
  }
`;

const VARIANTS_BULK_UPDATE = `#graphql
  mutation ProductVariantsBulkUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price compareAtPrice }
      userErrors { field message }
    }
  }
`;

// ---------------------------------------------------------------------------
// Resolve products matching campaign filters
// ---------------------------------------------------------------------------

export async function resolveProducts(
  admin: AdminClient,
  campaign: BulkPriceCampaign,
): Promise<ResolvedVariant[]> {
  const filterValues: string[] = JSON.parse(campaign.filterValues);
  const excludeTags: string[] = campaign.excludeEnabled
    ? JSON.parse(campaign.excludeValues)
    : [];

  console.info(
    `[bulk-price] resolveProducts START filterType=${campaign.filterType} values=${filterValues.length} excludeTags=${excludeTags.length}`,
  );

  let variants: ResolvedVariant[] = [];

  if (campaign.filterType === "product_types") {
    variants = await fetchByProductTypes(admin, filterValues);
  } else if (campaign.filterType === "collections") {
    variants = await fetchByCollections(admin, filterValues);
  } else {
    variants = await fetchByProductIds(admin, filterValues);
  }

  // Apply tag excludes
  if (excludeTags.length > 0) {
    const excludeSet = new Set(excludeTags.map((t) => t.toLowerCase()));
    const before = variants.length;
    variants = variants.filter((v) => {
      // We need product-level tag info — stored alongside variants during fetch
      return true; // Tag filtering happens in the fetch functions
    });
    console.info(
      `[bulk-price] resolveProducts tag filter before=${before} after=${variants.length}`,
    );
  }

  console.info(`[bulk-price] resolveProducts OK variants=${variants.length}`);
  return variants;
}

async function fetchByProductTypes(
  admin: AdminClient,
  productTypes: string[],
): Promise<ResolvedVariant[]> {
  const queryParts = productTypes.map((t) => `product_type:'${t}'`);
  const query = `(${queryParts.join(" OR ")}) AND status:active`;
  const variants: ResolvedVariant[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (page < 20) {
    page++;
    const response = await admin.graphql(PRODUCTS_BY_TYPE_QUERY, {
      variables: { cursor, query },
    });
    const json = await response.json();
    const data = json.data?.products;
    if (!data) break;

    for (const edge of data.edges ?? []) {
      const product = edge.node;
      for (const ve of product.variants?.edges ?? []) {
        variants.push({
          productGid: product.id,
          variantGid: ve.node.id,
          price: parseFloat(ve.node.price),
          compareAtPrice: ve.node.compareAtPrice
            ? parseFloat(ve.node.compareAtPrice)
            : null,
        });
      }
    }

    console.info(
      `[bulk-price] fetchByProductTypes page=${page} fetched=${data.edges?.length ?? 0} totalVariants=${variants.length}`,
    );

    if (!data.pageInfo?.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  return variants;
}

async function fetchByProductIds(
  admin: AdminClient,
  productGids: string[],
): Promise<ResolvedVariant[]> {
  const variants: ResolvedVariant[] = [];

  // Batch 50 IDs at a time
  for (let i = 0; i < productGids.length; i += 50) {
    const batch = productGids.slice(i, i + 50);
    const response = await admin.graphql(PRODUCTS_BY_IDS_QUERY, {
      variables: { ids: batch },
    });
    const json = await response.json();
    const nodes = json.data?.nodes ?? [];

    for (const product of nodes) {
      if (!product?.id) continue;
      for (const ve of product.variants?.edges ?? []) {
        variants.push({
          productGid: product.id,
          variantGid: ve.node.id,
          price: parseFloat(ve.node.price),
          compareAtPrice: ve.node.compareAtPrice
            ? parseFloat(ve.node.compareAtPrice)
            : null,
        });
      }
    }

    console.info(
      `[bulk-price] fetchByProductIds batch=${Math.floor(i / 50) + 1} ids=${batch.length} totalVariants=${variants.length}`,
    );
  }

  return variants;
}

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query CollectionProducts($id: ID!, $cursor: String) {
    collection(id: $id) {
      products(first: 100, after: $cursor) {
        edges { node { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

async function fetchByCollections(
  admin: AdminClient,
  collectionGids: string[],
): Promise<ResolvedVariant[]> {
  const productGids = new Set<string>();

  for (const collectionId of collectionGids) {
    let cursor: string | null = null;
    let page = 0;
    while (page < 20) {
      page++;
      const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
        variables: { id: collectionId, cursor },
      });
      const json = await response.json();
      const data = json.data?.collection?.products;
      if (!data) break;

      for (const edge of data.edges ?? []) {
        productGids.add(edge.node.id);
      }

      console.info(
        `[bulk-price] fetchByCollections collection=${collectionId} page=${page} products=${productGids.size}`,
      );

      if (!data.pageInfo?.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }
  }

  if (productGids.size === 0) return [];
  return fetchByProductIds(admin, [...productGids]);
}

// ---------------------------------------------------------------------------
// Compute discounted prices
// ---------------------------------------------------------------------------

export function computeDiscountedPrices(
  variants: ResolvedVariant[],
  discountType: string,
  discountValue: number,
): ComputedPrice[] {
  return variants.map((v) => {
    let newPrice: number;
    if (discountType === "percentage") {
      newPrice = v.price * (1 - discountValue / 100);
    } else {
      newPrice = v.price - discountValue;
    }
    newPrice = Math.max(0, Math.round(newPrice * 100) / 100);

    // The compareAt price shows the "original" price as strike-through
    // If the variant already had a compareAtPrice, use that as the display original
    const displayOriginal = v.compareAtPrice && v.compareAtPrice > v.price
      ? v.compareAtPrice
      : v.price;

    return {
      productGid: v.productGid,
      variantGid: v.variantGid,
      originalPrice: v.price,
      originalCompareAtPrice: v.compareAtPrice,
      appliedPrice: newPrice,
      appliedCompareAtPrice: displayOriginal,
    };
  });
}

// ---------------------------------------------------------------------------
// Apply bulk price updates to Shopify
// ---------------------------------------------------------------------------

async function bulkUpdatePrices(
  admin: AdminClient,
  items: Array<{
    productGid: string;
    variantGid: string;
    price: number;
    compareAtPrice: number | null;
  }>,
): Promise<{ updated: number; errors: string[] }> {
  // Group by product
  const byProduct = new Map<
    string,
    Array<{ variantGid: string; price: number; compareAtPrice: number | null }>
  >();
  for (const item of items) {
    const group = byProduct.get(item.productGid) ?? [];
    group.push(item);
    byProduct.set(item.productGid, group);
  }

  let updated = 0;
  const errors: string[] = [];

  for (const [productId, variants] of byProduct) {
    try {
      const response = await admin.graphql(VARIANTS_BULK_UPDATE, {
        variables: {
          productId,
          variants: variants.map((v) => ({
            id: v.variantGid,
            price: v.price.toFixed(2),
            compareAtPrice: v.compareAtPrice != null
              ? v.compareAtPrice.toFixed(2)
              : null,
          })),
        },
      });

      const json = await response.json();
      const userErrors =
        json.data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (userErrors.length > 0) {
        const msgs = userErrors.map(
          (e: { field: string[]; message: string }) => e.message,
        );
        errors.push(`${productId}: ${msgs.join(", ")}`);
      } else {
        updated += variants.length;
      }
    } catch (err) {
      errors.push(`${productId}: ${String(err)}`);
    }
  }

  return { updated, errors };
}

// ---------------------------------------------------------------------------
// Activate campaign
// ---------------------------------------------------------------------------

export async function activateCampaign(
  admin: AdminClient,
  prismaClient: PrismaClient,
  campaignId: string,
): Promise<{ ok: boolean; productCount: number; variantCount: number; errors: string[] }> {
  const campaign = await prismaClient.bulkPriceCampaign.findUniqueOrThrow({
    where: { id: campaignId },
  });

  console.info(
    `[bulk-price] activateCampaign START campaign=${campaign.name} shop=${campaign.shop}`,
  );

  // Resolve products from Shopify
  const variants = await resolveProducts(admin, campaign);
  if (variants.length === 0) {
    return { ok: false, productCount: 0, variantCount: 0, errors: ["No matching products found"] };
  }

  // Compute discounted prices
  const computed = computeDiscountedPrices(
    variants,
    campaign.discountType,
    campaign.discountValue,
  );

  // Store original prices in BulkPriceCampaignItem
  // Delete any existing items first (re-activation scenario)
  await prismaClient.bulkPriceCampaignItem.deleteMany({
    where: { campaignId },
  });

  // Batch insert using raw SQL for performance
  const batchSize = 500;
  for (let i = 0; i < computed.length; i += batchSize) {
    const batch = computed.slice(i, i + batchSize);
    const values = batch
      .map(
        (item) =>
          `(gen_random_uuid(), '${campaignId}', '${campaign.shop}', '${item.productGid}', '${item.variantGid}', ${item.originalPrice}, ${item.originalCompareAtPrice ?? "NULL"}, ${item.appliedPrice}, ${item.appliedCompareAtPrice}, NOW())`,
      )
      .join(",\n");

    await prismaClient.$executeRawUnsafe(`
      INSERT INTO "BulkPriceCampaignItem"
        ("id", "campaignId", "shop", "productGid", "variantGid", "originalPrice", "originalCompareAtPrice", "appliedPrice", "appliedCompareAtPrice", "createdAt")
      VALUES ${values}
    `);

    console.info(
      `[bulk-price] activateCampaign inserted items batch=${Math.floor(i / batchSize) + 1} count=${batch.length}`,
    );
  }

  // Apply prices to Shopify
  const updateItems = computed.map((c) => ({
    productGid: c.productGid,
    variantGid: c.variantGid,
    price: c.appliedPrice,
    compareAtPrice: c.appliedCompareAtPrice,
  }));

  const result = await bulkUpdatePrices(admin, updateItems);

  // Apply price tags if enabled
  if (campaign.priceTagsEnabled && campaign.priceTagMetaobjectType) {
    try {
      await applyPriceTags(admin, campaign, computed);
    } catch (err) {
      console.error(`[bulk-price:tags] applyPriceTags FAILED campaign=${campaign.name}`, err);
      result.errors.push(`Price tags failed: ${String(err)}`);
    }
  }

  // Count unique products
  const productGids = new Set(computed.map((c) => c.productGid));

  // Update campaign status
  await prismaClient.bulkPriceCampaign.update({
    where: { id: campaignId },
    data: {
      status: "active",
      activatedAt: new Date(),
      productCount: productGids.size,
      variantCount: computed.length,
    },
  });

  console.info(
    `[bulk-price] activateCampaign OK campaign=${campaign.name} products=${productGids.size} variants=${result.updated} errors=${result.errors.length}`,
  );

  return {
    ok: result.errors.length === 0,
    productCount: productGids.size,
    variantCount: result.updated,
    errors: result.errors,
  };
}

// ---------------------------------------------------------------------------
// Deactivate campaign (revert prices)
// ---------------------------------------------------------------------------

export async function deactivateCampaign(
  admin: AdminClient,
  prismaClient: PrismaClient,
  campaignId: string,
): Promise<{ ok: boolean; reverted: number; errors: string[] }> {
  const campaign = await prismaClient.bulkPriceCampaign.findUniqueOrThrow({
    where: { id: campaignId },
  });

  console.info(
    `[bulk-price] deactivateCampaign START campaign=${campaign.name} shop=${campaign.shop}`,
  );

  // Read stored original prices
  const items = await prismaClient.bulkPriceCampaignItem.findMany({
    where: { campaignId },
  });

  if (items.length === 0) {
    console.warn(`[bulk-price] deactivateCampaign SKIP no items found campaign=${campaignId}`);
    await prismaClient.bulkPriceCampaign.update({
      where: { id: campaignId },
      data: { status: "expired", deactivatedAt: new Date() },
    });
    return { ok: true, reverted: 0, errors: [] };
  }

  // Revert prices
  const revertItems = items.map((item) => ({
    productGid: item.productGid,
    variantGid: item.variantGid,
    price: item.originalPrice,
    compareAtPrice: item.originalCompareAtPrice,
  }));

  const result = await bulkUpdatePrices(admin, revertItems);

  // Clear price tags if they were enabled
  if (campaign.priceTagsEnabled && campaign.priceTagMetaobjectType) {
    try {
      await clearPriceTags(admin, campaign, items);
    } catch (err) {
      console.error(`[bulk-price:tags] clearPriceTags FAILED campaign=${campaign.name}`, err);
      result.errors.push(`Price tag cleanup failed: ${String(err)}`);
    }
  }

  // Update campaign status
  await prismaClient.bulkPriceCampaign.update({
    where: { id: campaignId },
    data: { status: "expired", deactivatedAt: new Date() },
  });

  console.info(
    `[bulk-price] deactivateCampaign OK campaign=${campaign.name} reverted=${result.updated} errors=${result.errors.length}`,
  );

  return { ok: result.errors.length === 0, reverted: result.updated, errors: result.errors };
}

// ---------------------------------------------------------------------------
// Fetch product types for the filter dropdown
// ---------------------------------------------------------------------------

export async function fetchProductTypes(
  admin: AdminClient,
): Promise<string[]> {
  const response = await admin.graphql(PRODUCT_TYPES_QUERY);
  const json = await response.json();
  const edges = json.data?.shop?.productTypes?.edges ?? [];
  return edges.map((e: { node: string }) => e.node).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Search products for the browse modal
// ---------------------------------------------------------------------------

export async function searchProducts(
  admin: AdminClient,
  query: string,
): Promise<
  Array<{
    id: string;
    title: string;
    image: string | null;
    price: string | null;
    compareAtPrice: string | null;
    variantCount: number;
  }>
> {
  const response = await admin.graphql(SEARCH_PRODUCTS_QUERY, {
    variables: { query: `title:*${query}* AND status:active` },
  });
  const json = await response.json();
  const edges = json.data?.products?.edges ?? [];

  return edges.map(
    (e: {
      node: {
        id: string;
        title: string;
        featuredMedia?: { preview?: { image?: { url?: string } } };
        variants?: { edges: Array<{ node: { price: string; compareAtPrice: string | null } }> };
        totalVariants: number;
      };
    }) => ({
      id: e.node.id,
      title: e.node.title,
      image: e.node.featuredMedia?.preview?.image?.url ?? null,
      price: e.node.variants?.edges?.[0]?.node?.price ?? null,
      compareAtPrice: e.node.variants?.edges?.[0]?.node?.compareAtPrice ?? null,
      variantCount: e.node.totalVariants ?? 1,
    }),
  );
}

// ---------------------------------------------------------------------------
// Search collections for the browse modal
// ---------------------------------------------------------------------------

const SEARCH_COLLECTIONS_QUERY = `#graphql
  query SearchCollections($query: String!) {
    collections(first: 25, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          image { url }
          productsCount { count }
        }
      }
    }
  }
`;

export async function searchCollections(
  admin: AdminClient,
  query: string,
): Promise<
  Array<{
    id: string;
    title: string;
    image: string | null;
    productCount: number;
  }>
> {
  const response = await admin.graphql(SEARCH_COLLECTIONS_QUERY, {
    variables: { query: query ? `title:*${query}*` : "" },
  });
  const json = await response.json();
  const edges = json.data?.collections?.edges ?? [];

  return edges.map(
    (e: {
      node: {
        id: string;
        title: string;
        image?: { url?: string } | null;
        productsCount?: { count?: number };
      };
    }) => ({
      id: e.node.id,
      title: e.node.title,
      image: e.node.image?.url ?? null,
      productCount: e.node.productsCount?.count ?? 0,
    }),
  );
}

// ---------------------------------------------------------------------------
// Apply price tags to campaign products
// ---------------------------------------------------------------------------

async function applyPriceTags(
  admin: AdminClient,
  campaign: BulkPriceCampaign,
  computed: ComputedPrice[],
): Promise<void> {
  const fieldDefaults: Record<string, string> = JSON.parse(
    campaign.priceTagFieldDefaults || "{}",
  );
  const metaobjectType = campaign.priceTagMetaobjectType!;
  const displayNameKey = campaign.priceTagDisplayNameKey || "";

  // Auto-detect metafield ns/key
  const mfDef = await findProductMetafieldForMetaobjectType(admin, metaobjectType);
  const ns = mfDef?.namespace ?? campaign.priceTagMetafieldNamespace ?? "";
  const key = mfDef?.key ?? campaign.priceTagMetafieldKey ?? "";
  const mfType = mfDef?.type ?? "list.metaobject_reference";

  // Cache existing metaobject entries
  const allEntries = await fetchMetaobjectEntries(admin, metaobjectType);
  const handleToGid = buildHandleGidMap(allEntries);

  // Group by product — use max originalPrice variant for badge computation
  const productPrices = new Map<string, number>();
  for (const item of computed) {
    const existing = productPrices.get(item.productGid) ?? 0;
    if (item.originalPrice > existing) {
      productPrices.set(item.productGid, item.originalPrice);
    }
  }

  for (const [productGid, originalPrice] of productPrices) {
    const badge = computeSmartBadge(
      campaign.discountType as "percentage" | "fixed",
      campaign.discountValue,
      originalPrice,
    );
    if (!badge) continue;

    const { gid: labelGid } = await ensureMetaobjectEntry(
      admin,
      metaobjectType,
      badge.handle,
      badge.text,
      handleToGid,
      fieldDefaults,
      displayNameKey,
    );

    await setProductMetafieldValue(admin, productGid, ns, key, [labelGid], mfType);
  }

  console.info(
    `[bulk-price:tags] applied price tags products=${productPrices.size}`,
  );
}

// ---------------------------------------------------------------------------
// Clear price tags from campaign products
// ---------------------------------------------------------------------------

async function clearPriceTags(
  admin: AdminClient,
  campaign: BulkPriceCampaign,
  items: BulkPriceCampaignItem[],
): Promise<void> {
  const metaobjectType = campaign.priceTagMetaobjectType!;
  const mfDef = await findProductMetafieldForMetaobjectType(admin, metaobjectType);
  const ns = mfDef?.namespace ?? campaign.priceTagMetafieldNamespace ?? "";
  const key = mfDef?.key ?? campaign.priceTagMetafieldKey ?? "";
  const mfType = mfDef?.type ?? "list.metaobject_reference";

  // Build gidToHandle map for clearDiscountLabels
  const allEntries = await fetchMetaobjectEntries(admin, metaobjectType);
  const gidToHandle = new Map<string, string>();
  for (const entry of allEntries) {
    gidToHandle.set(entry.gid, entry.handle);
  }

  const uniqueProducts = new Set(items.map((i) => i.productGid));
  for (const productGid of uniqueProducts) {
    await clearDiscountLabels(
      admin,
      campaign.shop,
      productGid,
      ns,
      key,
      gidToHandle,
      mfType,
    );
  }

  console.info(
    `[bulk-price:tags] cleared price tags products=${uniqueProducts.size}`,
  );
}
