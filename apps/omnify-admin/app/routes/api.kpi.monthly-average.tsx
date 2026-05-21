import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  type KpiType,
  getMonthsIncluded,
  bucketByMonth,
  monthlyAverageFromBuckets,
  validateKpiParams,
} from "../services/kpi-monthly-average.server";

const PAGE_SIZE = 100;

function jsonResponse(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GET /api/kpi/monthly-average?kpi=net_sales|orders|customers&start=ISO&end=ISO&tz=IANA
 * Returns monthsIncluded, monthlyBuckets, monthlyAverage per inputs/shopify-help.md.
 * Requires admin session (embedded app).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"];
  let shop = "unknown";
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    shop = auth.session.shop;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const url = new URL(request.url);
  const kpi = url.searchParams.get("kpi") ?? "";
  const startStr = url.searchParams.get("start") ?? "";
  const endStr = url.searchParams.get("end") ?? "";
  const tz = url.searchParams.get("tz") ?? "UTC";

  const validated = validateKpiParams(kpi, startStr, endStr, tz);
  if (!validated) {
    return jsonResponse(
      {
        error:
          "Invalid params. Required: kpi in (net_sales,orders,customers), start<=end (ISO), tz (IANA).",
      },
      400,
    );
  }

  const { start, end } = validated;
  const monthsIncluded = getMonthsIncluded(start, end);
  const monthlyBuckets: Record<string, number> = {};
  monthsIncluded.forEach((m) => {
    monthlyBuckets[m] = 0;
  });

  console.info(`[kpi] loader START shop=${shop} kpi=${kpi} start=${startStr} end=${endStr}`);

  if (kpi === "orders") {
    const orders: Array<{ createdAt: string | null }> = [];
    let cursor: string | null = null;
    const startQuery = start.toISOString();
    const endQuery = end.toISOString();
    const query = `created_at:>=${startQuery} created_at:<=${endQuery}`;

    do {
      const variables: { first: number; after: string | null; query?: string } =
        { first: PAGE_SIZE, after: cursor };
      variables.query = query;

      const res = await admin.graphql(
        `#graphql
        query OrdersForKpi($first: Int!, $after: String, $query: String) {
          orders(first: $first, after: $after, query: $query) {
            nodes { createdAt }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { variables },
      );
      const json = await res.json();
      const nodes = json?.data?.orders?.nodes ?? [];
      const pageInfo = json?.data?.orders?.pageInfo ?? {};
      nodes.forEach((n: { createdAt: string | null }) =>
        orders.push({ createdAt: n.createdAt }),
      );
      console.info(`[kpi] graphql page kpi=orders cursor=${cursor ?? "start"} pageNodes=${nodes.length} runningTotal=${orders.length} hasNextPage=${pageInfo.hasNextPage}`);
      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (cursor !== null);

    const buckets = bucketByMonth(
      orders,
      (o) => o.createdAt,
      () => 1,
      start,
      end,
      tz,
    );
    Object.assign(monthlyBuckets, buckets);
  } else if (kpi === "customers") {
    const customers: Array<{ createdAt: string | null }> = [];
    let cursor: string | null = null;
    const startQuery = start.toISOString();
    const endQuery = end.toISOString();
    const query = `created_at:>=${startQuery} created_at:<=${endQuery}`;

    do {
      const res: Response = await admin.graphql(
        `#graphql
        query CustomersForKpi($first: Int!, $after: String, $query: String) {
          customers(first: $first, after: $after, query: $query) {
            nodes { createdAt }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        {
          variables: {
            first: PAGE_SIZE,
            after: cursor,
            query,
          },
        },
      );
      const json = await res.json();
      const nodes = json?.data?.customers?.nodes ?? [];
      const pageInfo = json?.data?.customers?.pageInfo ?? {};
      nodes.forEach((n: { createdAt: string | null }) =>
        customers.push({ createdAt: n.createdAt }),
      );
      console.info(`[kpi] graphql page kpi=customers cursor=${cursor ?? "start"} pageNodes=${nodes.length} runningTotal=${customers.length} hasNextPage=${pageInfo.hasNextPage}`);
      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (cursor !== null);

    const buckets = bucketByMonth(
      customers,
      (c) => c.createdAt,
      () => 1,
      start,
      end,
      tz,
    );
    Object.assign(monthlyBuckets, buckets);
  } else {
    // net_sales: documented proxy (gross - discounts - returns from orders)
    const orders: Array<{
      createdAt: string | null;
      total: number;
    }> = [];
    let cursor: string | null = null;
    const startQuery = start.toISOString();
    const endQuery = end.toISOString();
    const query = `created_at:>=${startQuery} created_at:<=${endQuery}`;

    do {
      const res: Response = await admin.graphql(
        `#graphql
        query OrdersNetSales($first: Int!, $after: String, $query: String) {
          orders(first: $first, after: $after, query: $query) {
            nodes {
              createdAt
              currentTotalPriceSet { shopMoney { amount } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        {
          variables: { first: PAGE_SIZE, after: cursor, query },
        },
      );
      const json = await res.json();
      const nodes = json?.data?.orders?.nodes ?? [];
      const pageInfo = json?.data?.orders?.pageInfo ?? {};
      nodes.forEach(
        (n: {
          createdAt: string | null;
          currentTotalPriceSet?: { shopMoney?: { amount?: string } };
        }) => {
          const amount = n.currentTotalPriceSet?.shopMoney?.amount;
          const total = amount ? parseFloat(amount) : 0;
          orders.push({ createdAt: n.createdAt, total });
        },
      );
      console.info(`[kpi] graphql page kpi=net_sales cursor=${cursor ?? "start"} pageNodes=${nodes.length} runningTotal=${orders.length} hasNextPage=${pageInfo.hasNextPage}`);
      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (cursor !== null);

    const buckets = bucketByMonth(
      orders,
      (o) => o.createdAt,
      (o) => o.total,
      start,
      end,
      tz,
    );
    Object.assign(monthlyBuckets, buckets);
  }

  const monthlyAverage = monthlyAverageFromBuckets(monthlyBuckets, monthsIncluded);
  console.info(`[kpi] loader OK shop=${shop} kpi=${kpi} monthlyAverage=${monthlyAverage}`);

  const body: Record<string, unknown> = {
    kpi: kpi as KpiType,
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: tz,
    monthsIncluded,
    monthlyBuckets,
    monthlyAverage,
  };
  if (kpi === "net_sales") {
    body.currency = "Store currency (from order)";
    body.notes = [
      "Average computed across intersecting calendar months",
      "Net sales proxy: sum of order currentTotalPriceSet (not ShopifyQL net_sales). Does not match Shopify finance reports.",
    ];
  } else {
    body.notes = ["Average computed across intersecting calendar months"];
  }

  return jsonResponse(body);
};
