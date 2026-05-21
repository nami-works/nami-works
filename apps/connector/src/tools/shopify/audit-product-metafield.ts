import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query AuditProductMetafield(
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
          metafield(namespace: $namespace, key: $key) {
            value
          }
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

export async function auditProductMetafieldHandler(
  args: {
    namespace: string;
    key: string;
    tag?: string | undefined;
    expectValue?: string | undefined;
    maxPages?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxPages = Math.min(args.maxPages ?? 4, 10);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const scope = args.tag ? `tag:${args.tag}` : "status:active";

  type Row = {
    title: string;
    present: boolean;
    value: string | null;
  };
  const rows: Row[] = [];
  let cursor: string | null = null;
  let productsSeen = 0;
  let truncated = false;

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
      rows.push({
        title: e.node.title,
        present: v !== null,
        value: v,
      });
    }
    if (!res.data?.products.pageInfo.hasNextPage) break;
    cursor = res.data.products.pageInfo.endCursor;
    if (!cursor) break;
    if (i === maxPages - 1) truncated = true;
  }

  const missing = rows.filter((r) => !r.present);
  const wrongValue = args.expectValue
    ? rows.filter((r) => r.present && r.value !== args.expectValue)
    : [];

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum produto encontrado no escopo ${scope}.`,
        },
      ],
    };
  }
  if (missing.length === 0 && wrongValue.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `✅ Auditoria limpa · ${productsSeen} produto(s) no escopo ${scope}, todos com metafield ${args.namespace}.${args.key}${args.expectValue ? ` = "${args.expectValue}"` : " presente"}.${truncated ? " (limite de páginas atingido)" : ""}`,
        },
      ],
    };
  }

  const sections: string[] = [
    `Auditoria · ${args.namespace}.${args.key}${args.expectValue ? ` esperado "${args.expectValue}"` : ""} · escopo ${scope}`,
    `${productsSeen} produto(s) verificado(s), ${missing.length} sem metafield${wrongValue.length > 0 ? `, ${wrongValue.length} com valor diferente do esperado` : ""}.`,
    truncated ? "⚠ Limite de páginas atingido — refine com tag mais específica." : "",
    ``,
  ].filter(Boolean);

  if (missing.length > 0) {
    sections.push("🚩 Sem metafield (top 25):");
    for (const r of missing.slice(0, 25)) sections.push(`  ${r.title}`);
    if (missing.length > 25) sections.push(`  (+${missing.length - 25} outros)`);
    sections.push("");
  }
  if (wrongValue.length > 0) {
    sections.push("⚠ Com valor inesperado (top 25):");
    for (const r of wrongValue.slice(0, 25))
      sections.push(`  ${r.title} · value="${r.value}"`);
    if (wrongValue.length > 25)
      sections.push(`  (+${wrongValue.length - 25} outros)`);
  }

  return {
    content: [{ type: "text", text: sections.join("\n") }],
    isError: true,
  };
}

registerToolDefinition({
  name: "shopify_audit_product_metafield",
  description:
    "Audita produtos faltando um metafield específico (ex: 'custom.badge', 'custom.categoria'). Opcional: filtra por tag e exige um valor específico. Surge produtos sem o metafield e/ou com valor diferente do esperado.",
  inputSchema: {
    namespace: z.string().min(1).describe("Namespace do metafield (ex: 'custom')."),
    key: z.string().min(1).describe("Key do metafield (ex: 'badge')."),
    tag: z.string().optional().describe("Opcional: filtra por tag para reduzir escopo."),
    expectValue: z.string().optional().describe("Opcional: valor esperado exato."),
    maxPages: z.number().int().min(1).max(10).optional(),
  },
  handler: auditProductMetafieldHandler,
});
