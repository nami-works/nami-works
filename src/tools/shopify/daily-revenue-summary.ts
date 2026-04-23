import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { getShopTimezone } from "../../clients/shopify-shop-info.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query DailyRevenue($query: String!, $cursor: String) {
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          createdAt
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

type Response = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        createdAt: string;
        displayFinancialStatus: string | null;
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      };
    }>;
  };
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateInZone(ianaTimezone: string, iso: string): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

export async function dailyRevenueSummaryHandler(
  args: { desde: string; ate: string; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ISO_DATE.test(args.desde) || !ISO_DATE.test(args.ate)) {
    return {
      content: [{ type: "text", text: "desde e ate em ISO YYYY-MM-DD." }],
      isError: true,
    };
  }
  const maxPages = Math.min(args.maxPages ?? 4, 10);

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const ianaTimezone = await getShopTimezone({
    shopifyShop: ctx.tenant.shopifyShop ?? "",
    client,
  });

  const query = `created_at:>=${args.desde} AND created_at:<=${args.ate}`;
  const buckets = new Map<string, { orders: number; paid: number; revenue: number; currency: string }>();

  let cursor: string | null = null;
  let truncated = false;
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Response; errors?: { message?: string } } =
      await client.request<Response>(QUERY, {
        variables: { query, cursor },
      });
    if (res.errors) {
      throw new Error(`Shopify GraphQL error: ${res.errors.message ?? "unknown"}`);
    }
    const edges = res.data?.orders.edges ?? [];
    for (const e of edges) {
      const o = e.node;
      const day = dateInZone(ianaTimezone, o.createdAt);
      const amt = Number(o.totalPriceSet.shopMoney.amount);
      const cur = o.totalPriceSet.shopMoney.currencyCode;
      const b = buckets.get(day) ?? { orders: 0, paid: 0, revenue: 0, currency: cur };
      b.orders += 1;
      if (o.displayFinancialStatus === "PAID") b.paid += 1;
      b.revenue += amt;
      b.currency = cur;
      buckets.set(day, b);
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
          text: `Nenhum pedido entre ${args.desde} e ${args.ate} (timezone ${ianaTimezone}).`,
        },
      ],
    };
  }

  const days = [...buckets.keys()].sort();
  const totalOrders = [...buckets.values()].reduce((s, b) => s + b.orders, 0);
  const totalRevenue = [...buckets.values()].reduce((s, b) => s + b.revenue, 0);
  const cur = [...buckets.values()][0]?.currency ?? "BRL";

  const lines = days.map((day) => {
    const b = buckets.get(day)!;
    const pct = totalRevenue > 0 ? ((b.revenue / totalRevenue) * 100).toFixed(1) : "0.0";
    return `  ${day} · ${b.orders.toString().padStart(3)} pedidos (${b.paid} pagos) · ${b.currency} ${b.revenue.toFixed(2).padStart(10)} (${pct}%)`;
  });

  const header = [
    `Receita diária · ${args.desde} a ${args.ate} (timezone ${ianaTimezone})`,
    `Total: ${totalOrders} pedidos · ${cur} ${totalRevenue.toFixed(2)}`,
    truncated
      ? `⚠ Limite de paginação atingido (${maxPages} páginas × 250). Refine a faixa para precisão total.`
      : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return { content: [{ type: "text", text: header + lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_daily_revenue_summary",
  description:
    "Receita diária numa faixa de datas, quebrada por dia no timezone do merchant. Mostra pedidos, pagos, receita e % do total. Lê até 1000 pedidos por default (4 páginas × 250).",
  inputSchema: {
    desde: z.string().regex(ISO_DATE),
    ate: z.string().regex(ISO_DATE),
    maxPages: z.number().int().min(1).max(10).optional(),
  },
  handler: dailyRevenueSummaryHandler,
});
