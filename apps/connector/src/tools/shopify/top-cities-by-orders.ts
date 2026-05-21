import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { getShopTimezone } from "../../clients/shopify-shop-info.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query OrdersForCityRanking($query: String!, $cursor: String) {
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          totalPriceSet { shopMoney { amount currencyCode } }
          shippingAddress { city province countryCodeV2 }
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
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        shippingAddress: {
          city: string | null;
          province: string | null;
          countryCodeV2: string | null;
        } | null;
      };
    }>;
  };
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCity(name: string): string {
  return name
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export async function topCitiesByOrdersHandler(
  args: {
    desde: string;
    ate: string;
    topN?: number | undefined;
    maxPages?: number | undefined;
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
  const topN = args.topN ?? 20;
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

  type CityAgg = {
    name: string;
    province: string | null;
    countryCode: string | null;
    orders: number;
    revenue: number;
    currency: string;
  };
  const cities = new Map<string, CityAgg>();
  let cursor: string | null = null;
  let totalOrders = 0;
  let unknownCity = 0;
  let pagesRead = 0;

  for (let i = 0; i < maxPages; i++) {
    const res: {
      data?: OrdersResponse;
      errors?: { message?: string };
    } = await client.request<OrdersResponse>(QUERY, {
      variables: { query, cursor },
    });
    if (res.errors) {
      throw new Error(
        `Shopify GraphQL error: ${res.errors.message ?? "unknown"}`,
      );
    }
    const edges = res.data?.orders.edges ?? [];
    pagesRead += 1;
    for (const e of edges) {
      const o = e.node;
      totalOrders += 1;
      const ship = o.shippingAddress;
      if (!ship?.city) {
        unknownCity += 1;
        continue;
      }
      const key = normalizeCity(ship.city);
      const amt = Number(o.totalPriceSet.shopMoney.amount);
      const cur = o.totalPriceSet.shopMoney.currencyCode;
      const existing = cities.get(key);
      if (existing) {
        existing.orders += 1;
        existing.revenue += amt;
      } else {
        cities.set(key, {
          name: ship.city,
          province: ship.province,
          countryCode: ship.countryCodeV2,
          orders: 1,
          revenue: amt,
          currency: cur,
        });
      }
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (cities.size === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum pedido encontrado entre ${args.desde} e ${args.ate} (timezone: ${ianaTimezone}).`,
        },
      ],
    };
  }

  const ranked = [...cities.values()].sort((a, b) => b.orders - a.orders);
  const top = ranked.slice(0, topN);
  const totalRev = ranked.reduce((s, c) => s + c.revenue, 0);

  const header = [
    `Top ${top.length} cidades por pedidos · ${args.desde} a ${args.ate} (timezone ${ianaTimezone})`,
    `Total: ${totalOrders} pedidos · ${cities.size} cidades distintas · receita R$ ${totalRev.toFixed(2)}`,
    unknownCity > 0
      ? `${unknownCity} pedido(s) sem cidade no shipping address (não contabilizados).`
      : null,
    pagesRead === maxPages
      ? `⚠ Limite de paginação atingido (${maxPages} páginas × 250 pedidos = ${maxPages * 250} máximo). Reduza a faixa de datas para um ranking completo.`
      : null,
    ``,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  const lines = top.map((c, idx) => {
    const loc = [c.province, c.countryCode].filter(Boolean).join(", ");
    return `  ${(idx + 1).toString().padStart(2)}. ${c.name}${loc ? ` (${loc})` : ""} · ${c.orders} pedidos · ${c.currency} ${c.revenue.toFixed(2)}`;
  });

  return {
    content: [
      { type: "text", text: `${header}${lines.join("\n")}` },
    ],
  };
}

registerToolDefinition({
  name: "shopify_top_cities_by_orders",
  description:
    "Ranking de cidades por número de pedidos em uma faixa de datas. Útil para análise de footprint expansion (onde vale a pena abrir loja física). Agrega o shipping address dos pedidos. Por padrão lê até 1000 pedidos (4 páginas × 250); ajustável até 10 páginas.",
  inputSchema: {
    desde: z.string().regex(ISO_DATE).describe("Data inicial ISO YYYY-MM-DD."),
    ate: z.string().regex(ISO_DATE).describe("Data final ISO YYYY-MM-DD."),
    topN: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Quantas cidades mostrar no topo. Default 20."),
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Limite de páginas (250 pedidos cada) a ler. Default 4."),
  },
  handler: topCitiesByOrdersHandler,
});
