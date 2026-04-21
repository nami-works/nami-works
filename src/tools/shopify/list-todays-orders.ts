import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { getShopTimezone } from "../../clients/shopify-shop-info.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

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

/**
 * Format `now` as YYYY-MM-DD in the given IANA timezone. Shopify interprets
 * date values in search syntax in the shop's local timezone, so this date
 * passed to `created_at:>=...` correctly bounds "today" for the merchant
 * regardless of where the gateway process is running.
 */
export function todayInZone(
  ianaTimezone: string,
  now: Date = new Date(),
): string {
  // en-CA renders dates as ISO YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

export async function listTodaysOrdersHandler(
  args: { financialStatus?: string | undefined; fulfillmentStatus?: string | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const ianaTimezone = await getShopTimezone({
    shopifyShop: ctx.tenant.shopifyShop ?? "",
    client,
  });
  const today = todayInZone(ianaTimezone);

  const parts = [`created_at:>=${today}`];
  if (typeof args.financialStatus === "string") {
    parts.push(`financial_status:${args.financialStatus}`);
  }
  if (typeof args.fulfillmentStatus === "string") {
    parts.push(`fulfillment_status:${args.fulfillmentStatus}`);
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
          text: `No orders found for ${today} (${ianaTimezone}). Query: ${query}`,
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
    `Orders for ${today} (${ianaTimezone}) — ${orders.length} result(s):`,
    ``,
    ...lines,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_list_todays_orders",
  description:
    "List today's Shopify orders in the merchant's own timezone, most recent first. Optional filters: financialStatus (paid, pending, refunded) and fulfillmentStatus (unfulfilled, fulfilled, partial).",
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
  handler: listTodaysOrdersHandler,
});
