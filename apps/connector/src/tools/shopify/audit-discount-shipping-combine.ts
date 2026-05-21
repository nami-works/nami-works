import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ActiveDiscountCombines {
    discountNodes(first: 100, query: "status:active") {
      edges {
        node {
          id
          discount {
            __typename
            ... on DiscountCodeBasic {
              title
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            }
            ... on DiscountCodeBxgy {
              title
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            }
            ... on DiscountCodeFreeShipping {
              title
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            }
            ... on DiscountAutomaticBasic {
              title
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            }
            ... on DiscountAutomaticBxgy {
              title
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            }
            ... on DiscountAutomaticFreeShipping {
              title
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            }
          }
        }
      }
    }
  }
`;

type CombinesWith = {
  orderDiscounts: boolean;
  productDiscounts: boolean;
  shippingDiscounts: boolean;
};
type DiscountRaw = { title: string; combinesWith: CombinesWith };
type Node = { id: string; discount: (DiscountRaw & { __typename: string }) | { __typename: string } };
type Resp = { discountNodes: { edges: Array<{ node: Node }> } };

export async function auditDiscountShippingCombineHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY);
  if (res.errors) throw new Error(`Shopify GraphQL: ${res.errors.message ?? ""}`);

  const nodes = res.data?.discountNodes.edges.map((e) => e.node) ?? [];
  type Row = { title: string; type: string; shipping: boolean };
  const rows: Row[] = [];
  for (const n of nodes) {
    if ("combinesWith" in n.discount && "title" in n.discount) {
      rows.push({
        title: n.discount.title,
        type: n.discount.__typename,
        shipping: n.discount.combinesWith.shippingDiscounts,
      });
    }
  }

  if (rows.length === 0) {
    return { content: [{ type: "text", text: "Nenhum desconto ativo." }] };
  }

  const noShipping = rows.filter((r) => !r.shipping);
  const withShipping = rows.filter((r) => r.shipping);

  const body = [
    `Auditoria de combinação com frete · ${rows.length} desconto(s) ativo(s)`,
    `  ✅ ${withShipping.length} combinam com frete`,
    `  🚩 ${noShipping.length} NÃO combinam com frete`,
    ``,
    ...(noShipping.length > 0
      ? [
          `Descontos sem combinação de frete (podem ser intencionais, mas vale revisar):`,
          ...noShipping.map((r) => `  • ${r.title} (${r.type})`),
        ]
      : []),
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_audit_discount_shipping_combine",
  description:
    "Audita todos os descontos ATIVOS e lista quais estão configurados para NÃO combinar com descontos de frete. Útil pra detectar regras inconsistentes (portado do script audit_discount_shipping_combine.py).",
  inputSchema: {},
  handler: auditDiscountShippingCombineHandler,
});
