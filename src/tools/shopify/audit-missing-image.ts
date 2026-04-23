import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query MissingImage($query: String!, $cursor: String) {
    products(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          featuredImage { id }
          images(first: 1) { edges { node { id } } }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  title: string;
  featuredImage: { id: string } | null;
  images: { edges: Array<{ node: { id: string } }> };
};
type Resp = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function auditMissingImageHandler(
  args: { tag?: string | undefined; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxPages = Math.min(args.maxPages ?? 4, 10);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const scope = args.tag ? `tag:${args.tag}` : "status:active";
  const missing: Node[] = [];
  const onlyFallback: Node[] = [];
  let checked = 0;
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query: scope, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.products.edges ?? []) {
      checked += 1;
      if (e.node.images.edges.length === 0) missing.push(e.node);
      else if (!e.node.featuredImage) onlyFallback.push(e.node);
    }
    if (!res.data?.products.pageInfo.hasNextPage) break;
    cursor = res.data.products.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (missing.length === 0 && onlyFallback.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `✅ ${checked} produto(s) em ${scope}, todos com pelo menos uma imagem e featuredImage.`,
        },
      ],
    };
  }
  const sections: string[] = [
    `Auditoria de imagens · escopo ${scope} · ${checked} verificados`,
  ];
  if (missing.length > 0) {
    sections.push("", `🚩 ${missing.length} sem nenhuma imagem:`);
    for (const p of missing.slice(0, 30)) sections.push(`  ${p.title}`);
    if (missing.length > 30) sections.push(`  (+${missing.length - 30} outros)`);
  }
  if (onlyFallback.length > 0) {
    sections.push("", `⚠ ${onlyFallback.length} com imagens mas sem featuredImage:`);
    for (const p of onlyFallback.slice(0, 15)) sections.push(`  ${p.title}`);
    if (onlyFallback.length > 15) sections.push(`  (+${onlyFallback.length - 15} outros)`);
  }
  return {
    content: [{ type: "text", text: sections.join("\n") }],
    isError: true,
  };
}

registerToolDefinition({
  name: "shopify_audit_missing_image",
  description:
    "Produtos sem imagem (nenhuma) ou sem featuredImage (só fallback). Escopo default: todos ativos; passe tag pra restringir.",
  inputSchema: {
    tag: z.string().optional(),
    maxPages: z.number().int().min(1).max(10).optional(),
  },
  handler: auditMissingImageHandler,
});
