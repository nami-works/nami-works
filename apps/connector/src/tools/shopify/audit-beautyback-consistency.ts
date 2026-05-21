import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query BeautybackConsistency($query: String!, $cursor: String) {
    codeDiscountNodes(first: 50, sortKey: CREATED_AT, reverse: true, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              title
              status
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            }
          }
        }
      }
    }
  }
`;

type Basic = {
  __typename: "DiscountCodeBasic";
  title: string;
  status: string;
  combinesWith: {
    orderDiscounts: boolean;
    productDiscounts: boolean;
    shippingDiscounts: boolean;
  };
};
type Resp = {
  codeDiscountNodes: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: { id: string; codeDiscount: Basic | { __typename: string } } }>;
  };
};

export async function auditBeautybackConsistencyHandler(
  args: {
    prefix?: string | undefined;
    expectOrderCombines?: boolean | undefined;
    expectProductCombines?: boolean | undefined;
    expectShippingCombines?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const prefix = args.prefix ?? "BEAUTYBACK";
  const expect = {
    order: args.expectOrderCombines ?? true,
    product: args.expectProductCombines ?? true,
    shipping: args.expectShippingCombines ?? true,
  };

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  type Violation = { title: string; status: string; mismatches: string[] };
  const violations: Violation[] = [];
  let totalActive = 0;
  let cursor: string | null = null;

  for (let i = 0; i < 20; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query: prefix, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.codeDiscountNodes.edges ?? []) {
      const d = e.node.codeDiscount;
      if (d.__typename !== "DiscountCodeBasic") continue;
      const b = d as Basic;
      if (b.status !== "ACTIVE") continue;
      totalActive += 1;
      const mismatches: string[] = [];
      if (b.combinesWith.orderDiscounts !== expect.order)
        mismatches.push(`orderDiscounts=${b.combinesWith.orderDiscounts} (esperado ${expect.order})`);
      if (b.combinesWith.productDiscounts !== expect.product)
        mismatches.push(`productDiscounts=${b.combinesWith.productDiscounts} (esperado ${expect.product})`);
      if (b.combinesWith.shippingDiscounts !== expect.shipping)
        mismatches.push(`shippingDiscounts=${b.combinesWith.shippingDiscounts} (esperado ${expect.shipping})`);
      if (mismatches.length > 0) {
        violations.push({ title: b.title, status: b.status, mismatches });
      }
    }
    if (!res.data?.codeDiscountNodes.pageInfo.hasNextPage) break;
    cursor = res.data.codeDiscountNodes.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (totalActive === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum código ATIVO com prefixo "${prefix}".`,
        },
      ],
    };
  }

  if (violations.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `✅ Auditoria limpa · ${totalActive} código(s) ATIVO(s) com prefixo "${prefix}", todos com combines order=${expect.order} product=${expect.product} shipping=${expect.shipping}.`,
        },
      ],
    };
  }

  const lines = violations.map(
    (v) => `  ${v.title} · ${v.mismatches.join(" · ")}`,
  );
  const body = [
    `🚩 ${violations.length} de ${totalActive} código(s) ATIVO(s) "${prefix}" com combines divergentes do esperado (order=${expect.order}, product=${expect.product}, shipping=${expect.shipping}):`,
    ``,
    ...lines,
  ].join("\n");

  return {
    content: [{ type: "text", text: body }],
    isError: true,
  };
}

registerToolDefinition({
  name: "shopify_audit_beautyback_consistency",
  description:
    "Audita combines de códigos ativos com prefixo (default BEAUTYBACK). Flags entradas onde combinesWith diverge do esperado (default: todos true). Cada flag é sobrescrivível. CPG-biased: default assume a convenção gebeauty de 'BEAUTYBACK combina com tudo'.",
  inputSchema: {
    prefix: z.string().optional(),
    expectOrderCombines: z.boolean().optional(),
    expectProductCombines: z.boolean().optional(),
    expectShippingCombines: z.boolean().optional(),
  },
  handler: auditBeautybackConsistencyHandler,
});
