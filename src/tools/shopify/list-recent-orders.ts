import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query RecentOrders($query: String!, $cursor: String) {
    orders(first: 100, query: $query, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
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

type Node = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { firstName: string | null; lastName: string | null } | null;
};
type Resp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function listRecentOrdersHandler(
  args: {
    desde: string;
    ate?: string | undefined;
    financialStatus?: string | undefined;
    maxResults?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ISO.test(args.desde)) {
    return {
      content: [{ type: "text", text: "desde em ISO YYYY-MM-DD." }],
      isError: true,
    };
  }
  if (args.ate && !ISO.test(args.ate)) {
    return {
      content: [{ type: "text", text: "ate em ISO YYYY-MM-DD." }],
      isError: true,
    };
  }
  const maxResults = Math.min(args.maxResults ?? 100, 250);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const parts = [`created_at:>=${args.desde}`];
  if (args.ate) parts.push(`created_at:<=${args.ate}`);
  if (args.financialStatus) parts.push(`financial_status:${args.financialStatus}`);
  const query = parts.join(" AND ");
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
        {
          type: "text",
          text: `Nenhum pedido no intervalo (${query}).`,
        },
      ],
    };
  }
  const lines = out.map((o) => {
    const name =
      [o.customer?.firstName, o.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || "(guest)";
    return `  ${o.name} · ${o.createdAt.slice(0, 10)} · ${name} · ${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode} · ${o.displayFinancialStatus ?? "?"} / ${o.displayFulfillmentStatus ?? "?"}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Pedidos ${query} · ${out.length}:\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_recent_orders",
  description:
    "Lista pedidos em uma faixa de datas arbitrária (desde obrigatório, ate opcional = hoje) com filtros por status financeiro. Paginação até 250.",
  inputSchema: {
    desde: z.string().regex(ISO),
    ate: z.string().regex(ISO).optional(),
    financialStatus: z.string().optional(),
    maxResults: z.number().int().min(10).max(250).optional(),
  },
  handler: listRecentOrdersHandler,
});
