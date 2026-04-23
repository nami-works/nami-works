import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query FulfillmentStragglers($query: String!) {
    orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: false) {
      edges {
        node {
          id
          name
          createdAt
          tags
          displayFinancialStatus
          displayFulfillmentStatus
          customer { firstName lastName email phone }
          shippingAddress { city province phone }
          totalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

type Order = {
  id: string;
  name: string;
  createdAt: string;
  tags: string[];
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  shippingAddress: {
    city: string | null;
    province: string | null;
    phone: string | null;
  } | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
};
type Resp = { orders: { edges: Array<{ node: Order }> } };

export async function listFulfillmentStragglersHandler(
  args: { staleDays?: number | undefined; excludeTag?: string | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const staleDays = args.staleDays ?? 5;
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const cutoffDate = new Date(
    Date.now() - staleDays * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const parts = [
    `financial_status:paid`,
    `fulfillment_status:unfulfilled`,
    `created_at:<${cutoffDate}`,
  ];
  const query = parts.join(" AND ");

  const res = await client.request<Resp>(QUERY, { variables: { query } });
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  let list = res.data?.orders.edges.map((e) => e.node) ?? [];
  if (args.excludeTag) {
    list = list.filter((o) => !o.tags.includes(args.excludeTag as string));
  }

  if (list.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `✅ Nenhum pedido pago há >${staleDays} dias sem fulfillment.`,
        },
      ],
    };
  }

  const now = Date.now();
  const lines = list.map((o) => {
    const ageDays = Math.floor(
      (now - new Date(o.createdAt).getTime()) / (24 * 60 * 60 * 1000),
    );
    const customer =
      [o.customer?.firstName, o.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      o.customer?.email ||
      "(guest)";
    const phone = o.customer?.phone ?? o.shippingAddress?.phone ?? "";
    const city = o.shippingAddress?.city ?? "";
    const total = `${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`;
    return `  ${ageDays.toString().padStart(3)}d · ${o.name} · ${customer} · ${city} · ${total}${phone ? ` · ${phone}` : ""}`;
  });

  const body = [
    `🚩 ${list.length} pedido(s) pago(s) há mais de ${staleDays} dias ainda UNFULFILLED:`,
    ``,
    ...lines,
  ].join("\n");

  return {
    content: [{ type: "text", text: body }],
    isError: true,
  };
}

registerToolDefinition({
  name: "shopify_list_fulfillment_stragglers",
  description:
    "Lista pedidos pagos há mais de N dias (default 5) que continuam UNFULFILLED. Opcional: excluir pedidos com uma tag (ex: 'aguardando-cliente'). Retorna isError=true quando há stragglers.",
  inputSchema: {
    staleDays: z.number().int().min(1).max(90).optional(),
    excludeTag: z
      .string()
      .optional()
      .describe("Tag que, se presente no pedido, o excluí da auditoria."),
  },
  handler: listFulfillmentStragglersHandler,
});
