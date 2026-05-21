import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query DeepDigOrder($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          cancelledAt
          cancelReason
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount } }
          tags
          note
          customer {
            id
            firstName
            lastName
            email
            phone
          }
          shippingAddress { city province zip phone }
          lineItems(first: 50) {
            edges { node { title quantity sku variantTitle currentQuantity } }
          }
          transactions(first: 20) {
            gateway
            kind
            status
            amountSet { shopMoney { amount currencyCode } }
            createdAt
          }
          fulfillments(first: 10) {
            name
            status
            displayStatus
            createdAt
            trackingInfo { number company url }
          }
          refunds(first: 10) {
            createdAt
            note
            totalRefundedSet { shopMoney { amount currencyCode } }
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
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  tags: string[];
  note: string | null;
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  shippingAddress: {
    city: string | null;
    province: string | null;
    zip: string | null;
    phone: string | null;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        title: string;
        quantity: number;
        sku: string | null;
        variantTitle: string | null;
        currentQuantity: number;
      };
    }>;
  };
  transactions: Array<{
    gateway: string | null;
    kind: string;
    status: string;
    amountSet: { shopMoney: { amount: string; currencyCode: string } };
    createdAt: string;
  }>;
  fulfillments: Array<{
    name: string;
    status: string | null;
    displayStatus: string | null;
    createdAt: string;
    trackingInfo: Array<{
      number: string | null;
      company: string | null;
      url: string | null;
    }>;
  }>;
  refunds: Array<{
    createdAt: string;
    note: string | null;
    totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
  }>;
};
type Resp = { orders: { edges: Array<{ node: OrderNode }> } };

export async function deepDigOrderHandler(
  args: { nameOrId: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const t = args.nameOrId.trim();
  const q = t.startsWith("gid://")
    ? `id:${t}`
    : t.startsWith("#")
      ? `name:${t}`
      : `name:#${t}`;
  const res = await client.request<Resp>(QUERY, { variables: { query: q } });
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  const o = res.data?.orders.edges[0]?.node;
  if (!o) {
    return {
      content: [{ type: "text", text: `Pedido "${t}" não encontrado.` }],
    };
  }

  const cust =
    [o.customer?.firstName, o.customer?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    o.customer?.email ||
    "(guest)";
  const ship = o.shippingAddress
    ? `${o.shippingAddress.city ?? ""} ${o.shippingAddress.province ?? ""} ${o.shippingAddress.zip ?? ""}`.trim()
    : "(sem endereço)";

  const items = o.lineItems.edges
    .map((e) => {
      const sku = e.node.sku ? ` [${e.node.sku}]` : "";
      const vt = e.node.variantTitle ? ` · ${e.node.variantTitle}` : "";
      return `  ${e.node.quantity}x ${e.node.title}${vt}${sku}`;
    })
    .join("\n");

  const txs = o.transactions
    .map(
      (t) =>
        `  ${t.createdAt.slice(0, 10)} · ${t.kind} (${t.status}) · ${t.amountSet.shopMoney.amount} ${t.amountSet.shopMoney.currencyCode}${t.gateway ? ` via ${t.gateway}` : ""}`,
    )
    .join("\n");

  const fulfs = o.fulfillments.length
    ? o.fulfillments
        .map((f) => {
          const tr = f.trackingInfo
            .map(
              (t) => `${t.company ?? ""} ${t.number ?? ""} ${t.url ?? ""}`.trim(),
            )
            .filter(Boolean)
            .join(", ");
          return `  ${f.name} · ${f.displayStatus ?? f.status ?? "?"}${tr ? ` · ${tr}` : ""}`;
        })
        .join("\n")
    : "  (sem fulfillments)";

  const refunds = o.refunds.length
    ? o.refunds
        .map(
          (r) =>
            `  ${r.createdAt.slice(0, 10)} · ${r.totalRefundedSet.shopMoney.amount} ${r.totalRefundedSet.shopMoney.currencyCode}${r.note ? ` · "${r.note.slice(0, 80)}"` : ""}`,
        )
        .join("\n")
    : "  (sem refunds)";

  const body = [
    `🔍 Deep dig · ${o.name} · ${o.displayFinancialStatus ?? "?"} / ${o.displayFulfillmentStatus ?? "?"}${o.cancelledAt ? ` · CANCELADO (${o.cancelReason ?? "sem motivo"})` : ""}`,
    `Cliente: ${cust} · ${o.customer?.email ?? "(sem email)"} · ${o.customer?.phone ?? "(sem tel)"}`,
    `Endereço: ${ship}`,
    `Total: ${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode} (refunded ${o.totalRefundedSet.shopMoney.amount})`,
    `Criado: ${o.createdAt} · Atualizado: ${o.updatedAt}`,
    `Tags: ${o.tags.join(", ") || "(nenhuma)"}`,
    o.note ? `Nota: ${o.note}` : null,
    ``,
    `Line items:`,
    items,
    ``,
    `Transações (${o.transactions.length}):`,
    txs || "  (nenhuma)",
    ``,
    `Fulfillments:`,
    fulfs,
    ``,
    `Refunds:`,
    refunds,
    ``,
    `Shopify ID: ${o.id}`,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_deep_dig_order",
  description:
    "Dump completo de UM pedido: cabeçalho, cliente, endereço, line items, TODAS as transações financeiras, fulfillments com tracking, e refunds. Útil pra investigar casos complexos (portado de _order_deep_dig.py).",
  inputSchema: {
    nameOrId: z.string().min(1).describe("Nome do pedido (#1234), número (1234) ou GID."),
  },
  handler: deepDigOrderHandler,
});
