import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query FindByMetafield(
    $query: String!
    $namespace: String!
    $key: String!
    $cursor: String
  ) {
    products(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          tags
          metafield(namespace: $namespace, key: $key) { value }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  title: string;
  tags: string[];
  metafield: { value: string } | null;
};
type Resp = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function findProductsByMetafieldHandler(
  args: {
    namespace: string;
    key: string;
    value?: string | undefined;
    tag?: string | undefined;
    maxPages?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxPages = Math.min(args.maxPages ?? 3, 10);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const scope = args.tag ? `tag:${args.tag}` : "status:active";

  type Row = { title: string; value: string | null; tags: string[] };
  const rows: Row[] = [];
  let cursor: string | null = null;
  let productsSeen = 0;
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, {
        variables: {
          query: scope,
          namespace: args.namespace,
          key: args.key,
          cursor,
        },
      });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.products.edges ?? []) {
      productsSeen += 1;
      const v = e.node.metafield?.value ?? null;
      if (args.value) {
        if (v === args.value) {
          rows.push({ title: e.node.title, value: v, tags: e.node.tags });
        }
      } else if (v !== null) {
        rows.push({ title: e.node.title, value: v, tags: e.node.tags });
      }
    }
    if (!res.data?.products.pageInfo.hasNextPage) break;
    cursor = res.data.products.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (rows.length === 0) {
    const desc = args.value
      ? `com metafield ${args.namespace}.${args.key} = "${args.value}"`
      : `com metafield ${args.namespace}.${args.key} preenchido`;
    return {
      content: [
        {
          type: "text",
          text: `Nenhum produto ${desc} no escopo ${scope} (${productsSeen} verificados).`,
        },
      ],
    };
  }

  // Value-histogram when no filter
  const histogram = new Map<string, number>();
  for (const r of rows) {
    if (r.value === null) continue;
    histogram.set(r.value, (histogram.get(r.value) ?? 0) + 1);
  }
  const histSection =
    !args.value && histogram.size > 0
      ? [
          ``,
          `Distribuição de valores:`,
          ...[...histogram.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([v, n]) => `  "${v}" · ${n}`),
        ]
      : [];

  const lines = rows.slice(0, 60).map((r) => {
    const v = r.value ? ` · "${r.value}"` : "";
    return `  ${r.title}${v}`;
  });

  const body = [
    `${rows.length} produto(s) encontrado(s) (de ${productsSeen} verificados) · metafield ${args.namespace}.${args.key}${args.value ? ` = "${args.value}"` : ""}`,
    ...histSection,
    ``,
    ...lines,
    rows.length > 60 ? `  (+${rows.length - 60} outros)` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_find_products_by_metafield",
  description:
    "Busca produtos por metafield: passa namespace+key (ex: 'custom.categoria') e opcionalmente um valor alvo. Sem valor, retorna todos os produtos que TÊM o metafield + histograma de valores.",
  inputSchema: {
    namespace: z.string().min(1),
    key: z.string().min(1),
    value: z.string().optional().describe("Opcional: valor exato pra filtrar."),
    tag: z.string().optional().describe("Opcional: restringe ao produtos com esta tag."),
    maxPages: z.number().int().min(1).max(10).optional(),
  },
  handler: findProductsByMetafieldHandler,
});
