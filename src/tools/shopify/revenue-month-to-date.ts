import { getShopifyClient } from "../../clients/shopify.js";
import { getShopTimezone } from "../../clients/shopify-shop-info.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query MtdOrders($query: String!, $cursor: String) {
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          sourceName
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

function monthStartInZone(ianaTimezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
  });
  const [year, month] = fmt.format(new Date()).split("-");
  return `${year}-${month}-01`;
}

function todayInZone(ianaTimezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function revenueMonthToDateHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const tz = await getShopTimezone({
    shopifyShop: ctx.tenant.shopifyShop ?? "",
    client,
  });
  const desde = monthStartInZone(tz);
  const ate = todayInZone(tz);
  const query = `created_at:>=${desde} AND created_at:<=${ate}`;

  const buckets = new Map<string, { orders: number; gross: number; currency: string }>();
  let cursor: string | null = null;
  for (let i = 0; i < 8; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.orders.edges ?? []) {
      const o = e.node;
      if (o.cancelledAt) continue;
      const src = o.sourceName === "pos" ? "POS" : o.sourceName ?? "online";
      const amt = Math.max(
        0,
        Number(o.currentTotalPriceSet.shopMoney.amount) -
          Number(o.totalRefundedSet.shopMoney.amount),
      );
      const cur = o.currentTotalPriceSet.shopMoney.currencyCode;
      const b = buckets.get(src) ?? { orders: 0, gross: 0, currency: cur };
      b.orders += 1;
      b.gross += amt;
      b.currency = cur;
      buckets.set(src, b);
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }

  const total = [...buckets.values()].reduce((s, b) => s + b.gross, 0);
  const totalOrders = [...buckets.values()].reduce((s, b) => s + b.orders, 0);
  const cur = [...buckets.values()][0]?.currency ?? "BRL";

  const channelLines = [...buckets.entries()]
    .sort(([, a], [, b]) => b.gross - a.gross)
    .map(([src, b]) => {
      const pct = total > 0 ? ((b.gross / total) * 100).toFixed(1) : "0";
      return `  ${src}: ${b.orders} pedidos · ${b.currency} ${b.gross.toFixed(2)} (${pct}%)`;
    });

  const body = [
    `Receita MTD · ${desde} a ${ate} (${tz})`,
    `Total: ${totalOrders} pedidos · ${cur} ${total.toFixed(2)}`,
    ``,
    `Por canal:`,
    ...channelLines,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_revenue_month_to_date",
  description:
    "Receita mês-até-hoje (MTD), líquida de estornos e cancelados, quebrada por canal (POS + online). Portado de retail_revenue_mtd.py.",
  inputSchema: {},
  handler: revenueMonthToDateHandler,
});
