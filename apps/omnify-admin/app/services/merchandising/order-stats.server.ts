// Re-export shared types & pure functions so existing server-side imports keep working
export { computeStats, getDateRange } from "./order-stats-shared";
export type { OrderStatsRaw, ComputedStats } from "./order-stats-shared";
import type { OrderStatsRaw } from "./order-stats-shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// ---------------------------------------------------------------------------
// Fetch order stats from Shopify
// ---------------------------------------------------------------------------

export async function fetchOrderStats(
  admin: AdminClient,
  startDate: string,
  endDate: string,
  maxPages = 10,
): Promise<OrderStatsRaw> {
  console.info(`[merchandising:order-stats] fetchOrderStats START range=${startDate}..${endDate}`);

  const query = `created_at:>='${startDate}' created_at:<='${endDate}'`;
  let cursor: string | null = null;
  let page = 0;

  const stats: OrderStatsRaw = {
    totalOrders: 0,
    ordersWithDiscount: 0,
    totalDiscountAmount: 0,
    totalSubtotal: 0,
    totalShipping: 0,
    sumSubtotalDiscounted: 0,
    sumSubtotalNonDiscounted: 0,
  };

  while (page < maxPages) {
    page++;
    const response = await admin.graphql(
      `#graphql
      query OrderStats($first: Int!, $after: String, $query: String) {
        orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
          nodes {
            totalDiscountsSet { shopMoney { amount } }
            currentSubtotalPriceSet { shopMoney { amount } }
            totalShippingPriceSet { shopMoney { amount } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { first: 250, after: cursor, query } },
    );

    const json = await response.json();
    const data = json.data?.orders;
    if (!data) break;

    for (const order of data.nodes ?? []) {
      const discount = parseFloat(order.totalDiscountsSet?.shopMoney?.amount ?? "0");
      const subtotal = parseFloat(order.currentSubtotalPriceSet?.shopMoney?.amount ?? "0");
      const shipping = parseFloat(order.totalShippingPriceSet?.shopMoney?.amount ?? "0");
      const hasDiscount = discount > 0;

      stats.totalOrders++;
      stats.totalDiscountAmount += discount;
      stats.totalSubtotal += subtotal;
      stats.totalShipping += shipping;

      if (hasDiscount) {
        stats.ordersWithDiscount++;
        stats.sumSubtotalDiscounted += subtotal;
      } else {
        stats.sumSubtotalNonDiscounted += subtotal;
      }
    }

    console.info(`[merchandising:order-stats] page=${page} fetched=${data.nodes?.length ?? 0} totalOrders=${stats.totalOrders}`);

    if (!data.pageInfo?.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  console.info(`[merchandising:order-stats] fetchOrderStats OK orders=${stats.totalOrders} withDiscount=${stats.ordersWithDiscount} totalDisc=R$${stats.totalDiscountAmount.toFixed(2)}`);
  return stats;
}
