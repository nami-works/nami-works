// Paginated POS-order backfill for Sales Goals analytics.
// Pattern mirrors app/routes/app.retail-footprint.tsx fetchAllOrders.

import {
  upsertSalesOrders,
  recomputeAllMonthly,
  writeSyncStarted,
  writeSyncProgress,
  writeSyncFinished,
  writeSyncError,
  type SalesOrderRow,
} from "./analytics-queries.server";
import {
  filterCandidateLocations,
  resolveOrderLocation,
  type OrderForResolution,
  type RetailLocation,
} from "./classification";

const PAGE_SIZE = 250;
const MAX_THROTTLE_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isThrottled = (json: any) => {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return errors.some((e: any) =>
    String(e?.message ?? "")
      .toLowerCase()
      .includes("throttl"),
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

const LOCATIONS_QUERY = `#graphql
  query LocationsForSalesGoalsSync {
    locations(first: 50) {
      nodes {
        id
        name
        isActive
        isFulfillmentService
        fulfillmentService { id }
      }
    }
  }`;

const ORDERS_QUERY = `#graphql
  query OrdersForSalesGoalsSync($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        processedAt
        createdAt
        tags
        sourceName
        physicalLocation { id name }
        currentTotalPriceSet {
          shopMoney { amount currencyCode }
        }
        currentTotalDiscountsSet {
          shopMoney { amount }
        }
        totalRefundedSet {
          shopMoney { amount }
        }
      }
    }
  }`;

export const fetchRetailLocations = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<RetailLocation[]> => {
  const json = await graphqlWithRetry(admin, LOCATIONS_QUERY, {});
  const raw = (json.data?.locations?.nodes ?? []) as Array<{
    id: string;
    name: string;
    isActive?: boolean;
    isFulfillmentService?: boolean;
    fulfillmentService?: { id: string } | null;
  }>;
  return filterCandidateLocations(raw);
};

/**
 * Runs a full backfill of POS orders for a shop over the last `monthsBack`
 * months (default 14 — covers current month + previous year).
 *
 * - Filters web orders at Shopify query time (`-source_name:web`).
 * - Writes each page to `SalesOrder` via bulk upsert.
 * - Persists progress per page so ECS restarts can be observed.
 * - Recomputes `SalesOrderMonthly` once at the end.
 */
export async function runSalesGoalsSync(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  monthsBack = 14,
): Promise<{ total: number; lastOrderDate: Date | null }> {
  console.info(`[sales-goals:sync] START shop=${shop} monthsBack=${monthsBack}`);
  const phaseStart = Date.now();

  try {
    await writeSyncStarted(shop);

    const retailLocations = await fetchRetailLocations(admin);
    console.info(
      `[sales-goals:sync] retail locations=${retailLocations.length} shop=${shop}`,
    );

    if (retailLocations.length === 0) {
      await writeSyncFinished(shop, 0, null);
      return { total: 0, lastOrderDate: null };
    }

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
    const startKey = startDate.toISOString().slice(0, 10);
    const endKey = new Date().toISOString().slice(0, 10);
    // Why not `(source_name:pos OR source_name:<IGLU>)`? Shopify's search
    // engine silently returns 0 for `source_name:<numeric-app-id>` even when
    // quoted — verified empirically against ge-beauty-cosmeticos. Using
    // `-source_name:web` instead is the robust filter: it includes Shopify
    // POS, IGLU POS, draft orders, tiktok, etc., and the in-app
    // resolveOrderLocation classifier drops non-retail rows anyway.
    const query = `created_at:>=${startKey} created_at:<=${endKey} -source_name:web`;

    let hasNextPage = true;
    let after: string | null = null;
    let pageCount = 0;
    let total = 0;
    let lastOrderDate: Date | null = null;

    while (hasNextPage) {
      pageCount++;
      const json = await graphqlWithRetry(admin, ORDERS_QUERY, {
        first: PAGE_SIZE,
        after,
        query,
      });
      const payload = json.data.orders;
      const nodes = payload.nodes as Array<{
        id: string;
        name: string;
        processedAt: string | null;
        createdAt: string;
        tags: string[];
        sourceName: string | null;
        physicalLocation: { id: string; name: string } | null;
        currentTotalPriceSet: {
          shopMoney: { amount: string; currencyCode: string };
        } | null;
        currentTotalDiscountsSet: {
          shopMoney: { amount: string };
        } | null;
        totalRefundedSet: {
          shopMoney: { amount: string };
        } | null;
      }>;

      const pageRows: SalesOrderRow[] = [];
      let unmatched = 0;

      for (const node of nodes) {
        const forResolution: OrderForResolution = {
          name: node.name,
          sourceName: node.sourceName,
          tags: node.tags ?? [],
          physicalLocation: node.physicalLocation,
        };
        const resolved = resolveOrderLocation(forResolution, retailLocations);
        if (!resolved) {
          unmatched++;
          continue;
        }
        const currentTotal = Number(
          node.currentTotalPriceSet?.shopMoney?.amount ?? 0,
        );
        const refunded = Number(
          node.totalRefundedSet?.shopMoney?.amount ?? 0,
        );
        // Match Shopify's "Total sales by channel" report:
        // admin sometimes shows currentTotalPrice reflecting a refund (=0)
        // and sometimes doesn't (the refund is recorded separately). The
        // `max(0, current - refunded)` clamp handles both cases and matches
        // admin-reported totals to the cent (verified via
        // gebeauty/scripts/audit_retail_goals_totals.py).
        const amount = Math.max(0, currentTotal - refunded);
        const discount = Number(
          node.currentTotalDiscountsSet?.shopMoney?.amount ?? 0,
        );
        const currency =
          node.currentTotalPriceSet?.shopMoney?.currencyCode ?? null;
        const orderDate = new Date(node.processedAt ?? node.createdAt);
        if (!lastOrderDate || orderDate > lastOrderDate) {
          lastOrderDate = orderDate;
        }
        pageRows.push({
          id: node.id,
          source: resolved.source,
          locationId: resolved.locationId,
          locationName: resolved.locationName,
          orderDate,
          totalAmount: amount,
          discountAmount: discount,
          currencyCode: currency,
        });
      }

      if (pageRows.length > 0) {
        await upsertSalesOrders(shop, pageRows).catch((err) => {
          console.warn(
            `[sales-goals:sync] upsertSalesOrders SKIP page=${pageCount} shop=${shop}`,
            err,
          );
        });
      }

      total += pageRows.length;
      hasNextPage = payload.pageInfo.hasNextPage;
      after = payload.pageInfo.endCursor;

      const elapsed = ((Date.now() - phaseStart) / 1000).toFixed(1);
      console.info(
        `[sales-goals:sync] page=${pageCount} pageNodes=${nodes.length} accepted=${pageRows.length} unmatched=${unmatched} total=${total} hasNextPage=${hasNextPage} elapsed=${elapsed}s shop=${shop}`,
      );

      if (pageCount % 3 === 0) {
        await writeSyncProgress(shop, "fetching", total);
      }
    }

    await writeSyncProgress(shop, "aggregating", total);
    const buckets = await recomputeAllMonthly(shop);
    console.info(
      `[sales-goals:sync] recomputeAllMonthly OK buckets=${buckets} shop=${shop}`,
    );

    await writeSyncFinished(shop, total, lastOrderDate);
    const totalSec = ((Date.now() - phaseStart) / 1000).toFixed(1);
    console.info(
      `[sales-goals:sync] DONE shop=${shop} total=${total} pages=${pageCount} buckets=${buckets} duration=${totalSec}s`,
    );
    return { total, lastOrderDate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sales-goals:sync] FAILED shop=${shop}`, err);
    await writeSyncError(shop, message);
    throw err;
  }
}
