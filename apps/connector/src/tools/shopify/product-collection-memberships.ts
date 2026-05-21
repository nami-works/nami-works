import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ProductCollections($id: ID!) {
    product(id: $id) {
      id
      title
      collections(first: 50) {
        edges {
          node { id title handle }
        }
      }
    }
  }
`;

type Resp = {
  product: {
    id: string;
    title: string;
    collections: {
      edges: Array<{ node: { id: string; title: string; handle: string } }>;
    };
  } | null;
};

function toGid(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Product/${trimmed}`;
  return trimmed;
}

export async function productCollectionMembershipsHandler(
  args: { productId: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY, {
    variables: { id: toGid(args.productId) },
  });
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  const p = res.data?.product;
  if (!p) {
    return {
      content: [
        {
          type: "text",
          text: `Produto "${args.productId}" não encontrado.`,
        },
      ],
      isError: true,
    };
  }
  const cols = p.collections.edges.map((e) => e.node);
  if (cols.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `"${p.title}" não está em nenhuma collection.`,
        },
      ],
    };
  }
  const lines = cols.map((c) => `  ${c.title} (${c.handle})`);
  return {
    content: [
      {
        type: "text",
        text: `"${p.title}" está em ${cols.length} collection(s):\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_product_collections",
  description:
    "Lista todas as collections que contêm um produto específico. Útil pra entender onde uma campanha age.",
  inputSchema: {
    productId: z.string().min(1).describe("GID ou ID numérico do produto."),
  },
  handler: productCollectionMembershipsHandler,
});
