import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query BeautybackFamily($query: String!, $cursor: String) {
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
              startsAt
              endsAt
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
              asyncUsageCount
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
type Basic = {
  __typename: "DiscountCodeBasic";
  title: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  combinesWith: CombinesWith;
  asyncUsageCount: number;
};
type Resp = {
  codeDiscountNodes: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: { id: string; codeDiscount: Basic | { __typename: string } } }>;
  };
};

export async function listBeautybackCodesHandler(
  args: { prefix?: string | undefined; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const prefix = args.prefix ?? "BEAUTYBACK";
  const maxPages = Math.min(args.maxPages ?? 4, 20);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  type Row = {
    title: string;
    status: string;
    combines: string;
    uses: number;
  };
  const rows: Row[] = [];
  let cursor: string | null = null;
  let truncated = false;

  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query: prefix, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.codeDiscountNodes.edges ?? []) {
      const d = e.node.codeDiscount;
      if (d.__typename !== "DiscountCodeBasic") continue;
      const b = d as Basic;
      const c = b.combinesWith;
      rows.push({
        title: b.title,
        status: b.status,
        combines: `order=${c.orderDiscounts ? "✓" : "✗"} product=${c.productDiscounts ? "✓" : "✗"} shipping=${c.shippingDiscounts ? "✓" : "✗"}`,
        uses: b.asyncUsageCount,
      });
    }
    if (!res.data?.codeDiscountNodes.pageInfo.hasNextPage) break;
    cursor = res.data.codeDiscountNodes.pageInfo.endCursor;
    if (!cursor) break;
    if (i === maxPages - 1) truncated = true;
  }

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum código encontrado com prefixo "${prefix}".`,
        },
      ],
    };
  }

  const lines = rows.map(
    (r) => `  ${r.title} · ${r.status} · ${r.combines} · ${r.uses} usos`,
  );
  const header = [
    `Códigos "${prefix}" (${rows.length}${truncated ? "+ — limite de páginas atingido" : ""}):`,
    ``,
  ].join("\n");

  return { content: [{ type: "text", text: header + lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_list_beautyback_codes",
  description:
    "Lista códigos de desconto que começam com um prefixo (default BEAUTYBACK), mostrando status, flags de combinação e usos. Útil pra auditar famílias de códigos de campanha.",
  inputSchema: {
    prefix: z.string().optional().describe("Prefixo de busca. Default 'BEAUTYBACK'."),
    maxPages: z.number().int().min(1).max(20).optional(),
  },
  handler: listBeautybackCodesHandler,
});
