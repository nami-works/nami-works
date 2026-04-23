import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query TwoOrders($queryA: String!, $queryB: String!) {
    a: orders(first: 1, query: $queryA) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          tags
          lineItems(first: 50) {
            edges { node { title quantity sku } }
          }
        }
      }
    }
    b: orders(first: 1, query: $queryB) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          tags
          lineItems(first: 50) {
            edges { node { title quantity sku } }
          }
        }
      }
    }
  }
`;

type OrderLite = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  tags: string[];
  lineItems: { edges: Array<{ node: { title: string; quantity: number; sku: string | null } }> };
};
type Resp = {
  a: { edges: Array<{ node: OrderLite }> };
  b: { edges: Array<{ node: OrderLite }> };
};

function orderQuery(t: string): string {
  const s = t.trim();
  if (s.startsWith("gid://")) return `id:${s}`;
  if (s.startsWith("#")) return `name:${s}`;
  return `name:#${s}`;
}

function skuQtyMap(o: OrderLite): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of o.lineItems.edges) {
    const k = e.node.sku ?? e.node.title;
    m.set(k, (m.get(k) ?? 0) + e.node.quantity);
  }
  return m;
}

export async function compareTwoOrdersHandler(
  args: { orderA: string; orderB: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY, {
    variables: {
      queryA: orderQuery(args.orderA),
      queryB: orderQuery(args.orderB),
    },
  });
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);

  const a = res.data?.a.edges[0]?.node;
  const b = res.data?.b.edges[0]?.node;
  if (!a || !b) {
    return {
      content: [
        {
          type: "text",
          text: `Pelo menos um pedido não foi encontrado (${args.orderA} / ${args.orderB}).`,
        },
      ],
      isError: true,
    };
  }

  const mapA = skuQtyMap(a);
  const mapB = skuQtyMap(b);
  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  const itemLines: string[] = [];
  for (const k of allKeys) {
    const qA = mapA.get(k) ?? 0;
    const qB = mapB.get(k) ?? 0;
    const marker = qA === qB ? "=" : qA > 0 && qB === 0 ? "só A" : qA === 0 && qB > 0 ? "só B" : "≠";
    itemLines.push(`  ${marker} ${k}: A=${qA} · B=${qB}`);
  }

  const tagsA = new Set(a.tags);
  const tagsB = new Set(b.tags);
  const onlyA = [...tagsA].filter((t) => !tagsB.has(t));
  const onlyB = [...tagsB].filter((t) => !tagsA.has(t));

  const body = [
    `Comparação de pedidos`,
    `  A · ${a.name} · ${a.displayFinancialStatus ?? "?"} / ${a.displayFulfillmentStatus ?? "?"} · ${a.totalPriceSet.shopMoney.amount} ${a.totalPriceSet.shopMoney.currencyCode}`,
    `  B · ${b.name} · ${b.displayFinancialStatus ?? "?"} / ${b.displayFulfillmentStatus ?? "?"} · ${b.totalPriceSet.shopMoney.amount} ${b.totalPriceSet.shopMoney.currencyCode}`,
    ``,
    `Line items (por SKU):`,
    ...itemLines,
    ``,
    `Tags:`,
    onlyA.length > 0 ? `  Só em A: ${onlyA.join(", ")}` : `  A/B com tags idênticas ou nenhuma exclusiva em A.`,
    onlyB.length > 0 ? `  Só em B: ${onlyB.join(", ")}` : `  Nenhuma tag exclusiva em B.`,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_compare_two_orders",
  description:
    "Compara dois pedidos lado-a-lado: status, totais, line items por SKU, tags. Mostra ✓/≠/só-A/só-B. Portado de fetch_order_compare.py.",
  inputSchema: {
    orderA: z.string().min(1),
    orderB: z.string().min(1),
  },
  handler: compareTwoOrdersHandler,
});
