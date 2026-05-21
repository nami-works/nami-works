import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query CustomerOrders($id: ID!, $cursor: String) {
    customer(id: $id) {
      id
      firstName
      lastName
      email
      orders(first: 100, after: $cursor, sortKey: PROCESSED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            lineItems(first: 3) {
              edges { node { title quantity } }
            }
          }
        }
      }
    }
  }
`;

type Order = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { edges: Array<{ node: { title: string; quantity: number } }> };
};
type Resp = {
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: Order }>;
    };
  } | null;
};

function toGid(v: string): string {
  return v.startsWith("gid://") ? v : `gid://shopify/Customer/${v}`;
}

export async function customerOrderHistoryHandler(
  args: { customerId: string; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxPages = Math.min(args.maxPages ?? 2, 5);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const all: Order[] = [];
  let cursor: string | null = null;
  let name = "";
  let email = "";
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, {
        variables: { id: toGid(args.customerId), cursor },
      });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    const c = res.data?.customer;
    if (!c) {
      return {
        content: [{ type: "text", text: `Cliente não encontrado.` }],
        isError: true,
      };
    }
    name =
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.email ||
      "(sem nome)";
    email = c.email ?? "";
    for (const e of c.orders.edges) all.push(e.node);
    if (!c.orders.pageInfo.hasNextPage) break;
    cursor = c.orders.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (all.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `${name} (${email}) não tem pedidos.`,
        },
      ],
    };
  }
  const lines = all.map((o) => {
    const items =
      o.lineItems.edges
        .map((e) => `${e.node.quantity}x ${e.node.title}`)
        .slice(0, 2)
        .join(", ") || "(itens)";
    return `  ${o.name} · ${o.createdAt.slice(0, 10)} · ${o.displayFinancialStatus ?? "?"} / ${o.displayFulfillmentStatus ?? "?"} · ${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode} · ${items}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Histórico de ${name} (${email}) · ${all.length} pedido(s):\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_customer_order_history",
  description:
    "Histórico completo de pedidos de um cliente (via customerId) com status, total e os primeiros itens de cada pedido.",
  inputSchema: {
    customerId: z.string().min(1),
    maxPages: z.number().int().min(1).max(5).optional(),
  },
  handler: customerOrderHistoryHandler,
});
