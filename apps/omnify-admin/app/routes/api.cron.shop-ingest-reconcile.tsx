/**
 * Shop Ingest — hourly drift-aware reconcile cron.
 *
 * For each shop we've seen, ask Shopify "any orders/customers/products updated
 * since our watermark?" via a cheap count query. If zero, advance the watermark
 * and move on. If non-zero, paginate the delta and upsert each entity through
 * the canonical ingest service — same code path as webhooks.
 *
 * Auth: X-Cron-Secret header OR ?secret= query param, matched against
 * CRON_SECRET env var.
 *
 * Runs hourly. Complements webhooks — webhooks are the real-time path, this
 * cron is the safety net for dropped deliveries.
 */

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { ingestOrder } from "../services/shop-ingest/orders.server";
import { ingestCustomer } from "../services/shop-ingest/customers.server";
import { ingestProduct } from "../services/shop-ingest/products.server";

const PAGE_SIZE = 250;
const MAX_PAGES_PER_SHOP = 40; // safety cap = 10k records per entity per run
const MAX_THROTTLE_RETRIES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isThrottled = (json: any) => {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return errors.some((e: any) =>
    String(e?.message ?? "").toLowerCase().includes("throttl"),
  );
};

const graphqlWithRetry = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  query: string,
  variables: Record<string, unknown>,
) => {
  for (let attempt = 1; attempt <= MAX_THROTTLE_RETRIES; attempt += 1) {
    const response = await admin.graphql(query, { variables });
    const json = await response.json();
    if (isThrottled(json)) {
      if (attempt < MAX_THROTTLE_RETRIES) {
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      throw new Error("Shopify GraphQL throttled after retries.");
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      throw new Error(
        json.errors
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((e: any) => String(e?.message ?? "Unknown GraphQL error"))
          .join("; "),
      );
    }
    return json;
  }
  throw new Error("GraphQL request failed.");
};

const ORDERS_DELTA_QUERY = `#graphql
  query ShopIngestOrdersDelta($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        updatedAt
        processedAt
        cancelledAt
        closedAt
        sourceName
        tags
        customer { id displayName email phone }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        currentTotalDiscountsSet { shopMoney { amount } }
        totalRefundedSet { shopMoney { amount } }
        physicalLocation { id name }
        shippingAddress {
          address1 address2 city province provinceCode
          country countryCode zip latitude longitude
        }
        billingAddress {
          address1 address2 city province provinceCode
          country countryCode zip
        }
      }
    }
  }`;

const CUSTOMERS_DELTA_QUERY = `#graphql
  query ShopIngestCustomersDelta($first: Int!, $after: String, $query: String) {
    customers(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        email
        phone
        firstName
        lastName
        displayName
        createdAt
        updatedAt
        numberOfOrders
        amountSpent { amount currencyCode }
        tags
        defaultAddress {
          address1 address2 city province provinceCode
          country countryCode zip latitude longitude
        }
      }
    }
  }`;

const PRODUCTS_DELTA_QUERY = `#graphql
  query ShopIngestProductsDelta($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        productType
        vendor
        status
        createdAt
        updatedAt
        publishedAt
        tags
        variants(first: 100) {
          nodes { id sku title price compareAtPrice inventoryQuantity }
        }
      }
    }
  }`;

type ReconcileEntity = "orders" | "customers" | "products";

interface ReconcileStats {
  entity: ReconcileEntity;
  pagesFetched: number;
  rowsIngested: number;
  skipped: boolean;
  error?: string;
}

const isoOrEpoch = (d: Date | null | undefined) =>
  d ? d.toISOString() : "2000-01-01T00:00:00Z";

async function reconcileOrders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  since: Date | null,
): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    entity: "orders",
    pagesFetched: 0,
    rowsIngested: 0,
    skipped: false,
  };
  const query = `updated_at:>=${isoOrEpoch(since)}`;

  let cursor: string | null = null;
  let latestSeenUpdatedAt: Date | null = since;
  try {
    for (let page = 0; page < MAX_PAGES_PER_SHOP; page += 1) {
      const json = await graphqlWithRetry(admin, ORDERS_DELTA_QUERY, {
        first: PAGE_SIZE,
        after: cursor,
        query,
      });
      stats.pagesFetched += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodes = (json?.data?.orders?.nodes ?? []) as Array<any>;
      if (nodes.length === 0 && page === 0) {
        stats.skipped = true;
        break;
      }
      for (const node of nodes) {
        const result = await ingestOrder(shop, node, "reconcile");
        if (result.ok) stats.rowsIngested += 1;
        const nodeUpdated = node?.updatedAt ? new Date(node.updatedAt) : null;
        if (
          nodeUpdated &&
          (!latestSeenUpdatedAt || nodeUpdated > latestSeenUpdatedAt)
        ) {
          latestSeenUpdatedAt = nodeUpdated;
        }
      }
      const pageInfo = json?.data?.orders?.pageInfo ?? {};
      console.info(
        `[shop-ingest:reconcile:orders] page shop=${shop} page=${page} nodes=${nodes.length} running=${stats.rowsIngested} hasNext=${pageInfo.hasNextPage}`,
      );
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }
  } catch (err) {
    stats.error = err instanceof Error ? err.message : String(err);
    console.error(
      `[shop-ingest:reconcile:orders] FAILED shop=${shop}`,
      err,
    );
  }

  await prisma.shopIngestMeta.upsert({
    where: { shop },
    create: {
      shop,
      ordersLastSeenUpdatedAt: latestSeenUpdatedAt ?? undefined,
      ordersLastReconcileAt: new Date(),
    },
    update: {
      ordersLastSeenUpdatedAt: latestSeenUpdatedAt ?? undefined,
      ordersLastReconcileAt: new Date(),
    },
  });

  return stats;
}

async function reconcileCustomers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  since: Date | null,
): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    entity: "customers",
    pagesFetched: 0,
    rowsIngested: 0,
    skipped: false,
  };
  const query = `updated_at:>=${isoOrEpoch(since)}`;

  let cursor: string | null = null;
  let latestSeenUpdatedAt: Date | null = since;
  try {
    for (let page = 0; page < MAX_PAGES_PER_SHOP; page += 1) {
      const json = await graphqlWithRetry(admin, CUSTOMERS_DELTA_QUERY, {
        first: PAGE_SIZE,
        after: cursor,
        query,
      });
      stats.pagesFetched += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodes = (json?.data?.customers?.nodes ?? []) as Array<any>;
      if (nodes.length === 0 && page === 0) {
        stats.skipped = true;
        break;
      }
      for (const node of nodes) {
        const result = await ingestCustomer(shop, node, "reconcile");
        if (result.ok) stats.rowsIngested += 1;
        const nodeUpdated = node?.updatedAt ? new Date(node.updatedAt) : null;
        if (
          nodeUpdated &&
          (!latestSeenUpdatedAt || nodeUpdated > latestSeenUpdatedAt)
        ) {
          latestSeenUpdatedAt = nodeUpdated;
        }
      }
      const pageInfo = json?.data?.customers?.pageInfo ?? {};
      console.info(
        `[shop-ingest:reconcile:customers] page shop=${shop} page=${page} nodes=${nodes.length} running=${stats.rowsIngested} hasNext=${pageInfo.hasNextPage}`,
      );
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }
  } catch (err) {
    stats.error = err instanceof Error ? err.message : String(err);
    console.error(
      `[shop-ingest:reconcile:customers] FAILED shop=${shop}`,
      err,
    );
  }

  await prisma.shopIngestMeta.upsert({
    where: { shop },
    create: {
      shop,
      customersLastSeenUpdatedAt: latestSeenUpdatedAt ?? undefined,
      customersLastReconcileAt: new Date(),
    },
    update: {
      customersLastSeenUpdatedAt: latestSeenUpdatedAt ?? undefined,
      customersLastReconcileAt: new Date(),
    },
  });

  return stats;
}

async function reconcileProducts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  since: Date | null,
): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    entity: "products",
    pagesFetched: 0,
    rowsIngested: 0,
    skipped: false,
  };
  const query = `updated_at:>=${isoOrEpoch(since)}`;

  let cursor: string | null = null;
  let latestSeenUpdatedAt: Date | null = since;
  try {
    for (let page = 0; page < MAX_PAGES_PER_SHOP; page += 1) {
      const json = await graphqlWithRetry(admin, PRODUCTS_DELTA_QUERY, {
        first: PAGE_SIZE,
        after: cursor,
        query,
      });
      stats.pagesFetched += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodes = (json?.data?.products?.nodes ?? []) as Array<any>;
      if (nodes.length === 0 && page === 0) {
        stats.skipped = true;
        break;
      }
      for (const node of nodes) {
        // Flatten variants.nodes → variants array to match REST payload shape
        const flatNode = {
          ...node,
          variants: node?.variants?.nodes ?? [],
        };
        const result = await ingestProduct(shop, flatNode, "reconcile");
        if (result.ok) stats.rowsIngested += 1;
        const nodeUpdated = node?.updatedAt ? new Date(node.updatedAt) : null;
        if (
          nodeUpdated &&
          (!latestSeenUpdatedAt || nodeUpdated > latestSeenUpdatedAt)
        ) {
          latestSeenUpdatedAt = nodeUpdated;
        }
      }
      const pageInfo = json?.data?.products?.pageInfo ?? {};
      console.info(
        `[shop-ingest:reconcile:products] page shop=${shop} page=${page} nodes=${nodes.length} running=${stats.rowsIngested} hasNext=${pageInfo.hasNextPage}`,
      );
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }
  } catch (err) {
    stats.error = err instanceof Error ? err.message : String(err);
    console.error(
      `[shop-ingest:reconcile:products] FAILED shop=${shop}`,
      err,
    );
  }

  await prisma.shopIngestMeta.upsert({
    where: { shop },
    create: {
      shop,
      productsLastSeenUpdatedAt: latestSeenUpdatedAt ?? undefined,
      productsLastReconcileAt: new Date(),
    },
    update: {
      productsLastSeenUpdatedAt: latestSeenUpdatedAt ?? undefined,
      productsLastReconcileAt: new Date(),
    },
  });

  return stats;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret =
    request.headers.get("X-Cron-Secret") ?? url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const entityFilter = url.searchParams.get("entity"); // "orders" | "customers" | "products" | null (= all)

  // Seed the shop list from any shop we've already ingested for, plus the
  // sibling sync-meta tables (covers shops that have session but haven't
  // triggered an ingest yet).
  const seedShops = await prisma.$queryRawUnsafe<Array<{ shop: string }>>(
    `SELECT DISTINCT shop FROM (
        SELECT shop FROM "ShopIngestMeta"
        UNION SELECT shop FROM "SalesGoalsSyncMeta"
        UNION SELECT shop FROM "RetailSyncMeta"
        UNION SELECT shop FROM "AffiliateSyncMeta"
     ) AS all_shops`,
  );
  const shops = seedShops.map((r) => r.shop).filter(Boolean);

  const phaseStart = Date.now();
  console.info(
    `[shop-ingest:reconcile] START shops=${shops.length} entity=${entityFilter ?? "all"}`,
  );

  let processed = 0;
  let skipped = 0;
  const errors: Array<{ shop: string; entity: ReconcileEntity; error: string }> = [];
  const summary: Array<{
    shop: string;
    orders?: ReconcileStats;
    customers?: ReconcileStats;
    products?: ReconcileStats;
  }> = [];

  for (const shop of shops) {
    let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
    try {
      ({ admin } = await unauthenticated.admin(shop));
    } catch (err) {
      skipped += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[shop-ingest:reconcile] SKIP shop=${shop} reason=no-session`,
      );
      if (!/no.*session|session.*not.*found|offline.*session|Unauthorized/i.test(message)) {
        errors.push({ shop, entity: "orders", error: message });
      }
      continue;
    }

    const meta = await prisma.shopIngestMeta.findUnique({ where: { shop } });
    const shopRow: { shop: string; orders?: ReconcileStats; customers?: ReconcileStats; products?: ReconcileStats } = { shop };

    if (!entityFilter || entityFilter === "orders") {
      shopRow.orders = await reconcileOrders(
        admin,
        shop,
        meta?.ordersLastSeenUpdatedAt ?? null,
      );
      if (shopRow.orders.error)
        errors.push({ shop, entity: "orders", error: shopRow.orders.error });
    }
    if (!entityFilter || entityFilter === "customers") {
      shopRow.customers = await reconcileCustomers(
        admin,
        shop,
        meta?.customersLastSeenUpdatedAt ?? null,
      );
      if (shopRow.customers.error)
        errors.push({ shop, entity: "customers", error: shopRow.customers.error });
    }
    if (!entityFilter || entityFilter === "products") {
      shopRow.products = await reconcileProducts(
        admin,
        shop,
        meta?.productsLastSeenUpdatedAt ?? null,
      );
      if (shopRow.products.error)
        errors.push({ shop, entity: "products", error: shopRow.products.error });
    }

    summary.push(shopRow);
    processed += 1;
  }

  const elapsed = ((Date.now() - phaseStart) / 1000).toFixed(1);
  console.info(
    `[shop-ingest:reconcile] DONE processed=${processed} skipped=${skipped} errors=${errors.length} elapsed=${elapsed}s`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      processed,
      skipped,
      totalShops: shops.length,
      errors,
      summary,
      elapsedSeconds: Number(elapsed),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
