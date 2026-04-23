import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query MissingSeo($query: String!, $cursor: String) {
    products(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          seo { title description }
          bodyHtml
        }
      }
    }
  }
`;

type Node = {
  id: string;
  title: string;
  seo: { title: string | null; description: string | null };
  bodyHtml: string | null;
};
type Resp = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function auditMissingSeoHandler(
  args: { tag?: string | undefined; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxPages = Math.min(args.maxPages ?? 4, 10);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const scope = args.tag ? `tag:${args.tag}` : "status:active";
  const missingDesc: Node[] = [];
  const missingTitle: Node[] = [];
  const missingBody: Node[] = [];
  let checked = 0;
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query: scope, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.products.edges ?? []) {
      checked += 1;
      if (!e.node.seo.description || e.node.seo.description.trim() === "")
        missingDesc.push(e.node);
      if (!e.node.seo.title || e.node.seo.title.trim() === "")
        missingTitle.push(e.node);
      if (!e.node.bodyHtml || e.node.bodyHtml.trim() === "")
        missingBody.push(e.node);
    }
    if (!res.data?.products.pageInfo.hasNextPage) break;
    cursor = res.data.products.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (missingDesc.length + missingTitle.length + missingBody.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `✅ ${checked} produto(s) no escopo ${scope}, todos com SEO + descrição preenchidos.`,
        },
      ],
    };
  }
  const section = (label: string, arr: Node[]): string[] => {
    if (arr.length === 0) return [];
    const out = ["", `${label}: ${arr.length}`];
    for (const p of arr.slice(0, 20)) out.push(`  ${p.title}`);
    if (arr.length > 20) out.push(`  (+${arr.length - 20})`);
    return out;
  };
  const lines = [
    `Auditoria SEO · escopo ${scope} · ${checked} verificados`,
    ...section("🚩 Sem meta description", missingDesc),
    ...section("⚠ Sem meta title", missingTitle),
    ...section("⚠ Sem body HTML (descrição do produto)", missingBody),
  ].join("\n");
  return {
    content: [{ type: "text", text: lines }],
    isError: true,
  };
}

registerToolDefinition({
  name: "shopify_audit_missing_seo",
  description:
    "Produtos com SEO ou descrição faltando: meta title, meta description, body HTML. Útil antes de auditorias de SEO.",
  inputSchema: {
    tag: z.string().optional(),
    maxPages: z.number().int().min(1).max(10).optional(),
  },
  handler: auditMissingSeoHandler,
});
