import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * Surfaces collections with 0 products — a navigation cleanup gap. Smart
 * (automated) collections at 0 usually mean a tag/rule mismatch (e.g. the
 * rule references a tag no product carries anymore); manual collections at
 * 0 are just empty. The rule set is included so the mismatch is diagnosable
 * without opening the admin.
 */

const QUERY = /* GraphQL */ `
  query DeadCollections($cursor: String) {
    collections(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        sortOrder
        productsCount { count }
        ruleSet {
          appliedDisjunctively
          rules { column relation condition }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  title: string;
  handle: string;
  sortOrder: string;
  productsCount: { count: number };
  ruleSet: {
    appliedDisjunctively: boolean;
    rules: Array<{ column: string; relation: string; condition: string }>;
  } | null;
};
type Response = {
  collections: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Node[];
  };
};

export async function listDeadCollectionsHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const all: Node[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const res: { data?: Response; errors?: { message?: string } } = await client.request<Response>(
      QUERY,
      { variables: { cursor } },
    );
    if (res.errors) {
      throw new Error(`Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`);
    }
    const conn = res.data?.collections;
    if (!conn) break;
    all.push(...conn.nodes);
    hasNextPage = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }

  const dead = all.filter((c) => c.productsCount.count === 0);
  if (dead.length === 0) {
    return { content: [{ type: "text", text: `No dead collections — all ${all.length} collections have at least 1 product.` }] };
  }

  const lines = dead.map((c) => {
    if (!c.ruleSet) {
      return `  • ${c.title} (${c.handle}) — manual collection, 0 products (nothing added)`;
    }
    const joiner = c.ruleSet.appliedDisjunctively ? "OR" : "AND";
    const rules = c.ruleSet.rules.map((r) => `${r.column} ${r.relation} "${r.condition}"`).join(` ${joiner} `);
    return `  • ${c.title} (${c.handle}) — smart collection, 0 products. Rules: ${rules}`;
  });

  return {
    content: [
      {
        type: "text",
        text: [
          `${dead.length}/${all.length} collections have 0 products:`,
          ``,
          ...lines,
        ].join("\n"),
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_dead_collections",
  description:
    "List collections with 0 products — a navigation cleanup surface. For smart (automated) collections, includes the rule set so a tag/rule mismatch is diagnosable without opening the admin.",
  inputSchema: {},
  handler: listDeadCollectionsHandler,
});
