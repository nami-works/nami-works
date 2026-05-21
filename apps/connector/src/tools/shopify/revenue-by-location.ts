import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query OrdersForLocationBreakdown($query: String!, $cursor: String) {
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          sourceName
          retailLocation { id name }
          displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount } }
          cancelledAt
        }
      }
    }
  }
`;

type Order = {
  id: string;
  sourceName: string | null;
  retailLocation: { id: string; name: string } | null;
  displayFinancialStatus: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  cancelledAt: string | null;
};
type Resp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Order }>;
  };
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function revenueByLocationHandler(
  args: { desde: string; ate: string; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ISO.test(args.desde) || !ISO.test(args.ate)) {
    return {
      content: [{ type: "text", text: "desde/ate em ISO YYYY-MM-DD." }],
      isError: true,
    };
  }
  const maxPages = Math.min(args.maxPages ?? 5, 15);

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const buckets = new Map<
    string,
    { orders: number; gross: number; refunds: number; currency: string }
  >();
  let cursor: string | null = null;
  let truncated = false;
  const query = `created_at:>=${args.desde} AND created_at:<=${args.ate}`;

  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.orders.edges ?? []) {
      const o = e.node;
      if (o.cancelledAt) continue;
      const key = o.retailLocation?.name ?? o.sourceName ?? "(online/unknown)";
      const amt = Math.max(
        0,
        Number(o.currentTotalPriceSet.shopMoney.amount) -
          Number(o.totalRefundedSet.shopMoney.amount),
      );
      const cur = o.currentTotalPriceSet.shopMoney.currencyCode;
      const b = buckets.get(key) ?? {
        orders: 0,
        gross: 0,
        refunds: 0,
        currency: cur,
      };
      b.orders += 1;
      b.gross += amt;
      b.refunds += Number(o.totalRefundedSet.shopMoney.amount);
      b.currency = cur;
      buckets.set(key, b);
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
    if (i === maxPages - 1) truncated = true;
  }

  if (buckets.size === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum pedido entre ${args.desde} e ${args.ate}.`,
        },
      ],
    };
  }

  const ranked = [...buckets.entries()].sort(
    ([, a], [, b]) => b.gross - a.gross,
  );
  const totalOrders = ranked.reduce((s, [, b]) => s + b.orders, 0);
  const totalGross = ranked.reduce((s, [, b]) => s + b.gross, 0);
  const cur = ranked[0]?.[1].currency ?? "BRL";

  const lines = ranked.map(([loc, b]) => {
    const pct = totalGross > 0 ? ((b.gross / totalGross) * 100).toFixed(1) : "0";
    return `  ${loc} · ${b.orders} pedidos · ${b.currency} ${b.gross.toFixed(2)} (${pct}%)${b.refunds > 0 ? ` · estornos ${b.refunds.toFixed(2)}` : ""}`;
  });

  const header = [
    `Receita por location · ${args.desde} a ${args.ate}`,
    `Total: ${totalOrders} pedidos · ${cur} ${totalGross.toFixed(2)}`,
    truncated ? `⚠ Limite de páginas (${maxPages}) atingido; refine as datas.` : "",
    ``,
  ]
    .filter(Boolean)
    .join("\n");

  return { content: [{ type: "text", text: header + lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_revenue_by_location",
  description:
    "Receita líquida (gross - refunds) quebrada por retailLocation (lojas físicas) e pelo canal online para um período. Exclui cancelados. Portado de retail_revenue_by_location.py.",
  inputSchema: {
    desde: z.string().regex(ISO),
    ate: z.string().regex(ISO),
    maxPages: z.number().int().min(1).max(15).optional(),
  },
  handler: revenueByLocationHandler,
});
