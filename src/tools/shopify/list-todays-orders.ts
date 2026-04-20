import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";

const QUERY = /* GraphQL */ `
  query ListRecentOrders($query: String!) {
    orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          email
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName }
        }
      }
    }
  }
`;

type OrderSummaryNode = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { firstName: string | null; lastName: string | null } | null;
};

type ListResponse = {
  orders: { edges: Array<{ node: OrderSummaryNode }> };
};

function todayIsoDate(now: () => Date = () => new Date()): string {
  const d = now();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

registerToolDefinition({
  name: "shopify_list_todays_orders",
  description:
    "List today's Shopify orders, most recent first. Optional filters: financialStatus (paid, pending, refunded, etc.) and fulfillmentStatus (unfulfilled, fulfilled, partial).",
  inputSchema: {
    financialStatus: z
      .string()
      .optional()
      .describe('Optional filter: "paid", "pending", "refunded", etc.'),
    fulfillmentStatus: z
      .string()
      .optional()
      .describe(
        'Optional filter: "unfulfilled", "fulfilled", "partial", "unshipped".',
      ),
  },
  handler: async ({ financialStatus, fulfillmentStatus }, ctx) => {
    const client = await getShopifyClient({
      ssmPrefix: ctx.tenant.ssmPrefix,
      shopifyShop: ctx.tenant.shopifyShop ?? "",
    });

    const parts = [`created_at:>=${todayIsoDate()}`];
    if (typeof financialStatus === "string") {
      parts.push(`financial_status:${financialStatus}`);
    }
    if (typeof fulfillmentStatus === "string") {
      parts.push(`fulfillment_status:${fulfillmentStatus}`);
    }
    const query = parts.join(" AND ");

    const res = await client.request<ListResponse>(QUERY, {
      variables: { query },
    });
    if (res.errors) {
      throw new Error(
        `Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`,
      );
    }

    const orders = res.data?.orders.edges.map((e) => e.node) ?? [];
    if (orders.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No orders found today matching: ${query}`,
          },
        ],
      };
    }

    const lines = orders.map((o) => {
      const total = `${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`;
      const name =
        [o.customer?.firstName, o.customer?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        o.email ||
        "(guest)";
      return `  ${o.name} | ${name} | ${total} | ${o.displayFinancialStatus ?? "-"} / ${o.displayFulfillmentStatus ?? "-"}`;
    });

    const body = [
      `Today's orders (${orders.length}):`,
      ``,
      ...lines,
    ].join("\n");

    return { content: [{ type: "text", text: body }] };
  },
});

export const __testables = { todayIsoDate };
