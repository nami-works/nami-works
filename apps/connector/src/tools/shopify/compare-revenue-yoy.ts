import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { getShopTimezone } from "../../clients/shopify-shop-info.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query OrdersForRevenueWindow($query: String!, $cursor: String) {
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

type OrdersResponse = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        displayFinancialStatus: string | null;
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      };
    }>;
  };
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type WindowAgg = {
  orders: number;
  paidOrders: number;
  grossRevenue: number;
  paidRevenue: number;
  currency: string;
};

async function readWindow(
  client: Awaited<ReturnType<typeof getShopifyClient>>,
  desde: string,
  ate: string,
  maxPages: number,
): Promise<{ agg: WindowAgg; pagesRead: number; truncated: boolean }> {
  const agg: WindowAgg = {
    orders: 0,
    paidOrders: 0,
    grossRevenue: 0,
    paidRevenue: 0,
    currency: "BRL",
  };
  let cursor: string | null = null;
  let pages = 0;
  let truncated = false;
  for (let i = 0; i < maxPages; i++) {
    const res: {
      data?: OrdersResponse;
      errors?: { message?: string };
    } = await client.request<OrdersResponse>(QUERY, {
      variables: {
        query: `created_at:>=${desde} AND created_at:<=${ate}`,
        cursor,
      },
    });
    if (res.errors) {
      throw new Error(
        `Shopify GraphQL error: ${res.errors.message ?? "unknown"}`,
      );
    }
    pages += 1;
    for (const e of res.data?.orders.edges ?? []) {
      const o = e.node;
      const amt = Number(o.totalPriceSet.shopMoney.amount);
      agg.orders += 1;
      agg.grossRevenue += amt;
      agg.currency = o.totalPriceSet.shopMoney.currencyCode;
      if (o.displayFinancialStatus === "PAID") {
        agg.paidOrders += 1;
        agg.paidRevenue += amt;
      }
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
    if (i === maxPages - 1) truncated = true;
  }
  return { agg, pagesRead: pages, truncated };
}

function shiftIsoDate(iso: string, yearOffset: number): string {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCFullYear(dt.getUTCFullYear() + yearOffset);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function pctChange(now: number, prev: number): string {
  if (prev === 0) return now === 0 ? "0%" : "+∞%";
  const delta = ((now - prev) / prev) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

export async function compareRevenueYoYHandler(
  args: {
    desde: string;
    ate: string;
    yearsBack?: number | undefined;
    maxPagesPerWindow?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ISO_DATE.test(args.desde) || !ISO_DATE.test(args.ate)) {
    return {
      content: [
        { type: "text", text: "desde e ate devem estar em ISO YYYY-MM-DD." },
      ],
      isError: true,
    };
  }
  const yearsBack = args.yearsBack ?? 1;
  if (yearsBack < 1 || yearsBack > 5) {
    return {
      content: [
        { type: "text", text: "yearsBack deve estar entre 1 e 5." },
      ],
      isError: true,
    };
  }
  const maxPages = Math.min(args.maxPagesPerWindow ?? 4, 10);

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const ianaTimezone = await getShopTimezone({
    shopifyShop: ctx.tenant.shopifyShop ?? "",
    client,
  });

  const desdePrev = shiftIsoDate(args.desde, -yearsBack);
  const atePrev = shiftIsoDate(args.ate, -yearsBack);

  const [now, prev] = await Promise.all([
    readWindow(client, args.desde, args.ate, maxPages),
    readWindow(client, desdePrev, atePrev, maxPages),
  ]);

  const aov = (a: WindowAgg) => (a.orders === 0 ? 0 : a.grossRevenue / a.orders);

  const lines = [
    `YoY revenue compare · timezone ${ianaTimezone}`,
    `Janela atual:    ${args.desde} → ${args.ate}`,
    `Janela ${yearsBack} ano(s) atrás: ${desdePrev} → ${atePrev}`,
    ``,
    `                       atual          anterior       delta`,
    `Pedidos:               ${now.agg.orders.toString().padStart(8)}     ${prev.agg.orders.toString().padStart(8)}      ${pctChange(now.agg.orders, prev.agg.orders)}`,
    `Pedidos pagos:         ${now.agg.paidOrders.toString().padStart(8)}     ${prev.agg.paidOrders.toString().padStart(8)}      ${pctChange(now.agg.paidOrders, prev.agg.paidOrders)}`,
    `Receita bruta:    ${now.agg.currency} ${now.agg.grossRevenue.toFixed(2).padStart(11)}  ${prev.agg.grossRevenue.toFixed(2).padStart(11)}     ${pctChange(now.agg.grossRevenue, prev.agg.grossRevenue)}`,
    `Receita paga:     ${now.agg.currency} ${now.agg.paidRevenue.toFixed(2).padStart(11)}  ${prev.agg.paidRevenue.toFixed(2).padStart(11)}     ${pctChange(now.agg.paidRevenue, prev.agg.paidRevenue)}`,
    `Ticket médio:     ${now.agg.currency} ${aov(now.agg).toFixed(2).padStart(11)}  ${aov(prev.agg).toFixed(2).padStart(11)}     ${pctChange(aov(now.agg), aov(prev.agg))}`,
  ];

  if (now.truncated || prev.truncated) {
    lines.push(
      "",
      `⚠ Pelo menos uma janela atingiu o limite de paginação (${maxPages} páginas × 250 pedidos). Os totais podem estar subdimensionados — refine a faixa de datas para precisão completa.`,
    );
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_compare_revenue_yoy",
  description:
    "Compara receita / pedidos / ticket médio de uma janela atual contra a mesma janela N anos atrás. Útil para análise sazonal e definição de metas de vendas.",
  inputSchema: {
    desde: z.string().regex(ISO_DATE).describe("Início da janela atual (ISO)."),
    ate: z.string().regex(ISO_DATE).describe("Fim da janela atual (ISO)."),
    yearsBack: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Quantos anos atrás comparar. Default 1."),
    maxPagesPerWindow: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Páginas por janela (250 pedidos cada). Default 4."),
  },
  handler: compareRevenueYoYHandler,
});
