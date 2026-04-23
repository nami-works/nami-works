import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query OrdersByTag($query: String!, $cursor: String) {
    orders(first: 100, query: $query, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          tags
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName email }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  name: string;
  createdAt: string;
  tags: string[];
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
};
type Resp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listOrdersByTagHandler(
  args: { tag: string; maxResults?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxResults = Math.min(args.maxResults ?? 100, 250);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const query = `tag:${args.tag}`;
  const out: Node[] = [];
  let cursor: string | null = null;
  while (out.length < maxResults) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.orders.edges ?? []) {
      if (out.length >= maxResults) break;
      out.push(e.node);
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (out.length === 0) {
    return {
      content: [
        { type: "text", text: `Nenhum pedido com a tag "${args.tag}".` },
      ],
    };
  }
  const lines = out.map((o) => {
    const name =
      [o.customer?.firstName, o.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      o.customer?.email ||
      "(guest)";
    return `  ${o.name} · ${o.createdAt.slice(0, 10)} · ${name} · ${o.displayFinancialStatus ?? "?"} / ${o.displayFulfillmentStatus ?? "?"} · ${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Pedidos com tag:${args.tag} (${out.length}, mais recentes primeiro):\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_orders_by_tag",
  description:
    "Lista pedidos que contêm uma tag específica (ex: 'revisar-endereco', 'cliente-vip').",
  inputSchema: {
    tag: z.string().min(1),
    maxResults: z.number().int().min(10).max(250).optional(),
  },
  handler: listOrdersByTagHandler,
});
