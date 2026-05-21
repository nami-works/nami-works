import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query AllCollections($cursor: String) {
    collections(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          productsCount { count }
          updatedAt
        }
      }
    }
  }
`;

type Node = {
  id: string;
  title: string;
  handle: string;
  productsCount: { count: number };
  updatedAt: string;
};
type Resp = {
  collections: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listCollectionsHandler(
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
    for (const e of res.data?.collections.edges ?? []) all.push(e.node);
    if (!res.data?.collections.pageInfo.hasNextPage) break;
    cursor = res.data.collections.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (all.length === 0) {
    return { content: [{ type: "text", text: "Nenhuma collection." }] };
  }
  all.sort((a, b) => b.productsCount.count - a.productsCount.count);
  const lines = all.map(
    (c) => `  ${c.title} (${c.handle}) · ${c.productsCount.count} produtos · atualizada ${c.updatedAt.slice(0, 10)}`,
  );
  return {
    content: [
      {
        type: "text",
        text: `Collections (${all.length}, ordenadas por nº de produtos):\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_collections",
  description:
    "Lista todas as collections da loja com contagem de produtos e última atualização. Ordenado pela maior collection primeiro.",
  inputSchema: {},
  handler: listCollectionsHandler,
});
