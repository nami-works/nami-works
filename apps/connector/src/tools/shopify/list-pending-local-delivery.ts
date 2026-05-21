import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query PendingLocalDelivery($query: String!) {
    orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          tags
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName phone }
          shippingAddress {
            address1
            city
            zip
            province
            phone
          }
        }
      }
    }
  }
`;

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  tags: string[];
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  } | null;
  shippingAddress: {
    address1: string | null;
    city: string | null;
    zip: string | null;
    province: string | null;
    phone: string | null;
  } | null;
};

type Response = {
  orders: { edges: Array<{ node: OrderNode }> };
};

export async function listPendingLocalDeliveryHandler(
  args: { deliveryTag?: string | undefined; cityFilter?: string | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const tag = args.deliveryTag?.trim() ?? "entrega-local";

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const query = `tag:${tag} AND fulfillment_status:unfulfilled AND financial_status:paid`;
  const res = await client.request<Response>(QUERY, {
    variables: { query },
  });
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown"}`,
    );
  }

  const cityFilter = args.cityFilter?.trim().toLowerCase();
  const orders = (res.data?.orders.edges.map((e) => e.node) ?? []).filter(
    (o) => {
      if (!cityFilter) return true;
      return (o.shippingAddress?.city ?? "").toLowerCase() === cityFilter;
    },
  );

  if (orders.length === 0) {
    const msg = cityFilter
      ? `Nenhum pedido pago + não-fulfilled com tag "${tag}" em "${args.cityFilter}".`
      : `Nenhum pedido pago + não-fulfilled com tag "${tag}".`;
    return { content: [{ type: "text", text: msg }] };
  }

  const lines = orders.map((o) => {
    const customer =
      [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") ||
      "(guest)";
    const ship = o.shippingAddress;
    const addr = ship
      ? [ship.address1, ship.city, ship.province, ship.zip]
          .filter(Boolean)
          .join(", ")
      : "(sem endereço)";
    const phone = ship?.phone ?? o.customer?.phone ?? "(sem telefone)";
    const total = `${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`;
    const tagList = o.tags.join(", ");
    return `  ${o.name} · ${customer} · ${total}
    📍 ${addr}
    📞 ${phone}
    🏷  ${tagList}`;
  });

  const header = `Pedidos pendentes para entrega local (tag:${tag}, pagos, não-fulfilled): ${orders.length}\n`;
  return {
    content: [{ type: "text", text: header + "\n" + lines.join("\n\n") }],
  };
}

registerToolDefinition({
  name: "shopify_list_pending_local_delivery",
  description:
    "Lista pedidos pagos e ainda não-fulfilled marcados para entrega local (tag default: 'entrega-local'). Mostra endereço, telefone e tags de cada pedido — pronto para roteirização.",
  inputSchema: {
    deliveryTag: z
      .string()
      .optional()
      .describe(
        "Tag que identifica entrega local. Default 'entrega-local'.",
      ),
    cityFilter: z
      .string()
      .optional()
      .describe(
        "Opcional: filtra por cidade (case-insensitive, match exato).",
      ),
  },
  handler: listPendingLocalDeliveryHandler,
});
