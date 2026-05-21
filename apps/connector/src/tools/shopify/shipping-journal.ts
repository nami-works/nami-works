import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ShippingJournal($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          createdAt
          shippingAddress { city province zip country }
          fulfillments(first: 20) {
            name
            status
            displayStatus
            createdAt
            updatedAt
            estimatedDeliveryAt
            trackingInfo {
              number
              company
              url
            }
            events(first: 50) {
              edges {
                node {
                  status
                  happenedAt
                  message
                  city
                  province
                  country
                }
              }
            }
          }
        }
      }
    }
  }
`;

type Event = {
  status: string | null;
  happenedAt: string;
  message: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
};
type Fulfillment = {
  name: string;
  status: string | null;
  displayStatus: string | null;
  createdAt: string;
  updatedAt: string;
  estimatedDeliveryAt: string | null;
  trackingInfo: Array<{ number: string | null; company: string | null; url: string | null }>;
  events: { edges: Array<{ node: Event }> };
};
type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  shippingAddress: {
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
  } | null;
  fulfillments: Fulfillment[];
};
type Resp = { orders: { edges: Array<{ node: OrderNode }> } };

function orderQuery(t: string): string {
  const s = t.trim();
  if (s.startsWith("gid://")) return `id:${s}`;
  if (s.startsWith("#")) return `name:${s}`;
  return `name:#${s}`;
}

export async function shippingJournalHandler(
  args: { nameOrId: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY, {
    variables: { query: orderQuery(args.nameOrId) },
  });
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  const o = res.data?.orders.edges[0]?.node;
  if (!o) {
    return {
      content: [
        { type: "text", text: `Pedido "${args.nameOrId}" não encontrado.` },
      ],
    };
  }

  if (o.fulfillments.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Pedido ${o.name} ainda não tem fulfillments.`,
        },
      ],
    };
  }

  const blocks = o.fulfillments.map((f) => {
    const tracking = f.trackingInfo
      .map((t) => `${t.company ?? ""} ${t.number ?? ""}${t.url ? ` (${t.url})` : ""}`.trim())
      .filter(Boolean)
      .join(", ") || "(sem tracking)";
    const events = f.events.edges.map((e) => e.node);
    events.sort((a, b) => a.happenedAt.localeCompare(b.happenedAt));
    const eventLines = events.length
      ? events.map((ev) => {
          const loc = [ev.city, ev.province, ev.country].filter(Boolean).join(", ");
          return `    ${ev.happenedAt.slice(0, 16).replace("T", " ")} · ${ev.status ?? "?"}${loc ? ` · ${loc}` : ""}${ev.message ? ` · ${ev.message}` : ""}`;
        }).join("\n")
      : "    (nenhum evento)";
    return [
      `Fulfillment ${f.name} · ${f.displayStatus ?? f.status ?? "?"} · criado ${f.createdAt.slice(0, 10)}${f.estimatedDeliveryAt ? ` · previsão ${f.estimatedDeliveryAt.slice(0, 10)}` : ""}`,
      `  Tracking: ${tracking}`,
      `  Eventos:`,
      eventLines,
    ].join("\n");
  });

  const ship = o.shippingAddress
    ? [
        o.shippingAddress.city,
        o.shippingAddress.province,
        o.shippingAddress.zip,
        o.shippingAddress.country,
      ]
        .filter(Boolean)
        .join(", ")
    : "(sem endereço)";

  const body = [
    `Diário de envio · ${o.name} · destino: ${ship}`,
    ``,
    ...blocks,
  ].join("\n\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_shipping_journal",
  description:
    "Cronograma de envio de um pedido: fulfillments, tracking e TODOS os eventos de transporte (entrou no CD, saiu pra entrega, entregue). Portado de shipping_journal.py.",
  inputSchema: {
    nameOrId: z.string().min(1),
  },
  handler: shippingJournalHandler,
});
