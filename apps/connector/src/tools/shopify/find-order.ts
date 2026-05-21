import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query FindOrder($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          email
          createdAt
          processedAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName email phone }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                variant { sku }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

type OrderNode = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  processedAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        title: string;
        quantity: number;
        variant: { sku: string | null } | null;
        originalUnitPriceSet: {
          shopMoney: { amount: string; currencyCode: string };
        };
      };
    }>;
  };
};

type FindOrderResponse = {
  orders: { edges: Array<{ node: OrderNode }> };
};

function buildQuery(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("gid://")) return `id:${trimmed}`;
  const nameCandidate = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return `name:${nameCandidate}`;
}

function formatCustomer(c: OrderNode["customer"]): string {
  if (!c) return "(guest checkout)";
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  const id = name || c.email || c.phone || "(unknown)";
  const contact = [c.email, c.phone].filter(Boolean).join(" / ");
  return contact ? `${id} (${contact})` : id;
}

export async function findOrderHandler(
  args: { nameOrId: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const query = buildQuery(args.nameOrId);
  const res = await client.request<FindOrderResponse>(QUERY, {
    variables: { query },
  });

  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`,
    );
  }

  const order = res.data?.orders.edges[0]?.node;
  if (!order) {
    return {
      content: [
        { type: "text", text: `No order found matching "${args.nameOrId}".` },
      ],
    };
  }

  const total = `${order.totalPriceSet.shopMoney.amount} ${order.totalPriceSet.shopMoney.currencyCode}`;
  const lines = order.lineItems.edges.map((e) => {
    const unit = `${e.node.originalUnitPriceSet.shopMoney.amount} ${e.node.originalUnitPriceSet.shopMoney.currencyCode}`;
    const sku = e.node.variant?.sku ? ` [${e.node.variant.sku}]` : "";
    return `  • ${e.node.quantity}x ${e.node.title}${sku} @ ${unit}`;
  });

  const body = [
    `Order ${order.name} · ${formatCustomer(order.customer)}`,
    `Total: ${total}`,
    `Financial: ${order.displayFinancialStatus ?? "unknown"} | Fulfillment: ${order.displayFulfillmentStatus ?? "unknown"}`,
    `Created: ${order.createdAt}`,
    ``,
    `Line items:`,
    ...lines,
    ``,
    `Shopify ID: ${order.id}`,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_find_order",
  description:
    "Look up a single Shopify order by its order name (e.g. #1234), a numeric order number, or a Shopify GID. Returns the order summary, customer, totals, and line items.",
  inputSchema: {
    nameOrId: z
      .string()
      .min(1)
      .describe(
        "Order name like #1234, a numeric order number, or a Shopify GID.",
      ),
  },
  handler: findOrderHandler,
});
