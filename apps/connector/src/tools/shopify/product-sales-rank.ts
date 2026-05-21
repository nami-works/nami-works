import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query OrdersForSalesRank($query: String!, $cursor: String) {
    orders(first: 100, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          cancelledAt
          lineItems(first: 50) {
            edges {
              node {
                title
                sku
                quantity
                originalUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

type Resp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        cancelledAt: string | null;
        lineItems: {
          edges: Array<{
            node: {
              title: string;
              sku: string | null;
              quantity: number;
              originalUnitPriceSet: {
                shopMoney: { amount: string; currencyCode: string };
              };
            };
          }>;
        };
      };
    }>;
  };
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function productSalesRankHandler(
  args: { desde: string; ate: string; topN?: number | undefined; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ISO.test(args.desde) || !ISO.test(args.ate)) {
    return {
      content: [{ type: "text", text: "desde/ate em ISO." }],
      isError: true,
    };
  }
  const topN = args.topN ?? 25;
  const maxPages = Math.min(args.maxPages ?? 6, 20);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const query = `created_at:>=${args.desde} AND created_at:<=${args.ate}`;
  const agg = new Map<string, { title: string; qty: number; revenue: number; currency: string }>();
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.orders.edges ?? []) {
      if (e.node.cancelledAt) continue;
      for (const li of e.node.lineItems.edges) {
        const key = li.node.sku ?? li.node.title;
        const amt = Number(li.node.originalUnitPriceSet.shopMoney.amount) * li.node.quantity;
        const cur = li.node.originalUnitPriceSet.shopMoney.currencyCode;
        const b = agg.get(key) ?? { title: li.node.title, qty: 0, revenue: 0, currency: cur };
        b.qty += li.node.quantity;
        b.revenue += amt;
        b.currency = cur;
        agg.set(key, b);
      }
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (agg.size === 0) {
    return {
      content: [{ type: "text", text: `Nenhuma venda no intervalo ${query}.` }],
    };
  }
  const ranked = [...agg.entries()].sort(([, a], [, b]) => b.qty - a.qty).slice(0, topN);
  const lines = ranked.map(
    ([key, v], idx) =>
      `  ${(idx + 1).toString().padStart(3)}. ${v.title} [${key}] · ${v.qty} unidades · ${v.currency} ${v.revenue.toFixed(2)}`,
  );
  return {
    content: [
      {
        type: "text",
        text: `Top ${ranked.length} produtos vendidos · ${args.desde} a ${args.ate}:\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_product_sales_rank",
  description:
    "Ranking de produtos mais vendidos num intervalo (por quantidade). Exclui cancelados. Top N default 25.",
  inputSchema: {
    desde: z.string().regex(ISO),
    ate: z.string().regex(ISO),
    topN: z.number().int().min(5).max(200).optional(),
    maxPages: z.number().int().min(1).max(20).optional(),
  },
  handler: productSalesRankHandler,
});
