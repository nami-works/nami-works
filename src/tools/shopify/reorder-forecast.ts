import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const SALES_QUERY = /* GraphQL */ `
  query RecentSales($query: String!, $cursor: String) {
    orders(first: 100, query: $query, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          createdAt
          cancelledAt
          lineItems(first: 100) {
            edges {
              node {
                quantity
                variant {
                  id
                  sku
                  displayName
                  product { id title }
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
    }
  }
`;

type LineItem = {
  quantity: number;
  variant: {
    id: string;
    sku: string | null;
    displayName: string;
    product: { id: string; title: string };
    inventoryQuantity: number | null;
  } | null;
};
type OrderNode = {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
  lineItems: { edges: Array<{ node: LineItem }> };
};
type Resp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: OrderNode }>;
  };
};

export async function reorderForecastHandler(
  args: {
    lookbackDays?: number | undefined;
    coverDays?: number | undefined;
    topN?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const lookbackDays = args.lookbackDays ?? 30;
  const coverDays = args.coverDays ?? 14;
  const topN = Math.min(args.topN ?? 25, 100);
  const since = new Date(Date.now() - lookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const query = `created_at:>=${since}`;

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const agg = new Map<
    string,
    {
      variantId: string;
      sku: string | null;
      displayName: string;
      productTitle: string;
      unitsSold: number;
      onHand: number;
    }
  >();
  let cursor: string | null = null;
  let pageCount = 0;
  while (pageCount < 30) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(SALES_QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const oe of res.data?.orders.edges ?? []) {
      if (oe.node.cancelledAt) continue;
      for (const lie of oe.node.lineItems.edges) {
        const v = lie.node.variant;
        if (!v) continue;
        const key = v.id;
        const prev = agg.get(key);
        if (prev) {
          prev.unitsSold += lie.node.quantity;
        } else {
          agg.set(key, {
            variantId: v.id,
            sku: v.sku,
            displayName: v.displayName,
            productTitle: v.product.title,
            unitsSold: lie.node.quantity,
            onHand: v.inventoryQuantity ?? 0,
          });
        }
      }
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
    pageCount++;
  }
  const rows = [...agg.values()]
    .map((r) => {
      const avgDaily = r.unitsSold / lookbackDays;
      const needed = Math.max(0, Math.ceil(avgDaily * coverDays - r.onHand));
      const daysCover = avgDaily > 0 ? r.onHand / avgDaily : Infinity;
      return { ...r, avgDaily, needed, daysCover };
    })
    .filter((r) => r.unitsSold > 0)
    .sort((a, b) => b.needed - a.needed || a.daysCover - b.daysCover)
    .slice(0, topN);
  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhuma venda nos últimos ${lookbackDays} dias. Nada a prever.`,
        },
      ],
    };
  }
  const lines = rows.map((r) => {
    const cov = r.daysCover === Infinity ? "∞" : r.daysCover.toFixed(1);
    const alert = r.needed > 0 ? "⚠️" : "✓";
    return `  ${alert} ${r.productTitle} · ${r.displayName} · SKU ${r.sku ?? "(sem)"} · vendas ${r.unitsSold}/${lookbackDays}d (${r.avgDaily.toFixed(1)}/d) · em mãos ${r.onHand} · cobertura ${cov}d · repor ${r.needed}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Previsão de reabastecimento — lookback ${lookbackDays}d, cobertura alvo ${coverDays}d (${rows.length} variantes):\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_reorder_forecast",
  description:
    "Previsão de reabastecimento: calcula venda média diária no lookback, cruza com estoque atual e estima quantas unidades repor pra cobrir N dias de vendas. Ordena por urgência.",
  inputSchema: {
    lookbackDays: z.number().int().min(7).max(180).optional(),
    coverDays: z.number().int().min(3).max(90).optional(),
    topN: z.number().int().min(5).max(100).optional(),
  },
  handler: reorderForecastHandler,
});
