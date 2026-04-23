import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query DiscountUsage($cursor: String) {
    codeDiscountNodes(first: 100, sortKey: CREATED_AT, reverse: true, after: $cursor) {
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
              asyncUsageCount
              usageLimit
              codes(first: 3) { edges { node { code } } }
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
  startsAt: string;
  endsAt: string | null;
  asyncUsageCount: number;
  usageLimit: number | null;
  codes: { edges: Array<{ node: { code: string } }> };
};
type Resp = {
  codeDiscountNodes: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: { id: string; codeDiscount: Basic | { __typename: string } } }>;
  };
};

export async function discountUsageSummaryHandler(
  args: { topN?: number | undefined; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const topN = args.topN ?? 30;
  const maxPages = Math.min(args.maxPages ?? 3, 20);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  type Row = {
    code: string;
    title: string;
    status: string;
    uses: number;
    limit: number | null;
  };
  const rows: Row[] = [];
  let cursor: string | null = null;

  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.codeDiscountNodes.edges ?? []) {
      const d = e.node.codeDiscount;
      if (d.__typename !== "DiscountCodeBasic") continue;
      const b = d as Basic;
      const code = b.codes.edges[0]?.node.code ?? b.title;
      rows.push({
        code,
        title: b.title,
        status: b.status,
        uses: b.asyncUsageCount,
        limit: b.usageLimit,
      });
    }
    if (!res.data?.codeDiscountNodes.pageInfo.hasNextPage) break;
    cursor = res.data.codeDiscountNodes.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (rows.length === 0) {
    return {
      content: [{ type: "text", text: "Nenhum código de desconto encontrado." }],
    };
  }

  rows.sort((a, b) => b.uses - a.uses);
  const totalUses = rows.reduce((s, r) => s + r.uses, 0);
  const top = rows.slice(0, topN);

  const lines = top.map((r, i) => {
    const pct = totalUses > 0 ? ((r.uses / totalUses) * 100).toFixed(1) : "0";
    const cap = r.limit !== null ? `/${r.limit}` : "";
    return `  ${(i + 1).toString().padStart(3)}. ${r.code} (${r.status}) · ${r.uses}${cap} usos (${pct}%)`;
  });

  const body = [
    `Uso de códigos de desconto · ${rows.length} códigos analisados, ${totalUses} redeem(s) no total`,
    `Top ${top.length} por uso:`,
    ``,
    ...lines,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_discount_usage_summary",
  description:
    "Ranking de códigos de desconto por número de resgates (asyncUsageCount). Mostra % do total e limite. Útil pra ver quais campanhas pegaram tração.",
  inputSchema: {
    topN: z.number().int().min(5).max(200).optional(),
    maxPages: z.number().int().min(1).max(20).optional(),
  },
  handler: discountUsageSummaryHandler,
});
