import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query Segments($cursor: String) {
    segments(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          query
          creationDate
          lastEditDate
        }
      }
    }
  }
`;

type Node = {
  id: string;
  name: string;
  query: string;
  creationDate: string;
  lastEditDate: string;
};
type Resp = {
  segments: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listCustomerSegmentsHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const all: Node[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 4; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.segments.edges ?? []) all.push(e.node);
    if (!res.data?.segments.pageInfo.hasNextPage) break;
    cursor = res.data.segments.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (all.length === 0) {
    return {
      content: [{ type: "text", text: "Nenhum segmento de cliente configurado." }],
    };
  }
  const lines = all.map(
    (s) => `  ${s.name} · editado ${s.lastEditDate.slice(0, 10)}\n    query: ${s.query}`,
  );
  return {
    content: [
      {
        type: "text",
        text: `Segmentos de cliente (${all.length}):\n\n${lines.join("\n\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_customer_segments",
  description:
    "Lista segmentos de cliente configurados na loja (Customers → Segments). Mostra nome, data de edição e a query do segmento.",
  inputSchema: {},
  handler: listCustomerSegmentsHandler,
});
