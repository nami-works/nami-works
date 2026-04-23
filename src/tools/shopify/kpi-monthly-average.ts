import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { getShopTimezone } from "../../clients/shopify-shop-info.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query KpiOrders($query: String!, $cursor: String) {
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          createdAt
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
  createdAt: string;
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

function monthStart(year: number, month: number): string {
  const m = String(month).padStart(2, "0");
  return `${year}-${m}-01`;
}
function monthEnd(year: number, month: number): string {
  // last day of month
  const d = new Date(Date.UTC(year, month, 0)); // month is 1-12; last day of prev month in UTC
  return d.toISOString().slice(0, 10);
}

async function windowRevenue(
  client: Awaited<ReturnType<typeof getShopifyClient>>,
  desde: string,
  ate: string,
): Promise<{ orders: number; gross: number; currency: string }> {
  let cursor: string | null = null;
  let orders = 0;
  let gross = 0;
  let currency = "BRL";
  const query = `created_at:>=${desde} AND created_at:<=${ate}`;
  for (let i = 0; i < 8; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.orders.edges ?? []) {
      const o = e.node;
      if (o.cancelledAt) continue;
      const amt = Math.max(
        0,
        Number(o.currentTotalPriceSet.shopMoney.amount) -
          Number(o.totalRefundedSet.shopMoney.amount),
      );
      orders += 1;
      gross += amt;
      currency = o.currentTotalPriceSet.shopMoney.currencyCode;
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }
  return { orders, gross, currency };
}

export async function kpiMonthlyAverageHandler(
  args: { monthsBack?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const monthsBack = Math.min(Math.max(args.monthsBack ?? 6, 2), 24);

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const tz = await getShopTimezone({
    shopifyShop: ctx.tenant.shopifyShop ?? "",
    client,
  });

  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  });
  const [curYear, curMonth] = fmt.format(now).split("-").map((n) => Number(n));
  if (!curYear || !curMonth) throw new Error("Failed to derive current year/month");

  // Current MTD window:
  const mtdStart = monthStart(curYear, curMonth);
  const mtdEnd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Previous N full months
  const months: Array<{ label: string; desde: string; ate: string }> = [];
  for (let i = 1; i <= monthsBack; i++) {
    let y = curYear;
    let m = curMonth - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    months.push({
      label: `${y}-${String(m).padStart(2, "0")}`,
      desde: monthStart(y, m),
      ate: monthEnd(y, m),
    });
  }

  const mtd = await windowRevenue(client, mtdStart, mtdEnd);
  const historic = await Promise.all(
    months.map(async (mw) => ({
      ...mw,
      agg: await windowRevenue(client, mw.desde, mw.ate),
    })),
  );

  const avgOrders =
    historic.reduce((s, m) => s + m.agg.orders, 0) / historic.length;
  const avgGross =
    historic.reduce((s, m) => s + m.agg.gross, 0) / historic.length;
  const cur = historic[0]?.agg.currency ?? "BRL";

  const dayOfMonth = Number(mtdEnd.slice(-2));
  const projected = (mtd.gross / Math.max(1, dayOfMonth)) * 30;

  const lines = historic.map(
    (m) =>
      `  ${m.label}: ${m.agg.orders.toString().padStart(4)} pedidos · ${cur} ${m.agg.gross.toFixed(2).padStart(11)}`,
  );

  const body = [
    `KPI mensal · timezone ${tz}`,
    `MTD (${mtdStart} → ${mtdEnd}, dia ${dayOfMonth}): ${mtd.orders} pedidos · ${cur} ${mtd.gross.toFixed(2)}`,
    `Projeção mês cheio (linear): ${cur} ${projected.toFixed(2)}`,
    ``,
    `Média últimos ${historic.length} meses fechados:`,
    `  ${avgOrders.toFixed(0)} pedidos/mês · ${cur} ${avgGross.toFixed(2)}`,
    ``,
    `Histórico:`,
    ...lines,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_kpi_monthly_average",
  description:
    "KPI: receita MTD + projeção linear + média dos últimos N meses fechados. Portado de api.kpi.monthly-average.tsx.",
  inputSchema: {
    monthsBack: z.number().int().min(2).max(24).optional().describe("Default 6."),
  },
  handler: kpiMonthlyAverageHandler,
});
