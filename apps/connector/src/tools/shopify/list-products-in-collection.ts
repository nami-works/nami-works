import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ProductsInCollection($handle: String!, $cursor: String) {
    collectionByHandle(handle: $handle) {
      id
      title
      products(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            status
            tags
            variants(first: 1) {
              edges { node { sku price compareAtPrice } }
            }
          }
        }
      }
    }
  }
`;

type Variant = { sku: string | null; price: string; compareAtPrice: string | null };
type Product = {
  id: string;
  title: string;
  status: string;
  tags: string[];
  variants: { edges: Array<{ node: Variant }> };
};
type Resp = {
  collectionByHandle: {
    id: string;
    title: string;
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: Product }>;
    };
  } | null;
};

export async function listProductsInCollectionHandler(
  args: { handle: string; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxPages = Math.min(args.maxPages ?? 2, 5);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const all: Product[] = [];
  let cursor: string | null = null;
  let title = "";
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, {
        variables: { handle: args.handle, cursor },
      });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    const col = res.data?.collectionByHandle;
    if (!col) {
      return {
        content: [
          {
            type: "text",
            text: `Collection "${args.handle}" não encontrada.`,
          },
        ],
      };
    }
    title = col.title;
    for (const e of col.products.edges) all.push(e.node);
    if (!col.products.pageInfo.hasNextPage) break;
    cursor = col.products.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (all.length === 0) {
    return {
      content: [
        { type: "text", text: `Collection "${title}" está vazia.` },
      ],
    };
  }

  const lines = all.slice(0, 60).map((p) => {
    const v = p.variants.edges[0]?.node;
    const price = v?.price ?? "?";
    const compare = v?.compareAtPrice ? ` (era ${v.compareAtPrice})` : "";
    const sku = v?.sku ? ` [${v.sku}]` : "";
    return `  ${p.title}${sku} · ${p.status} · ${price}${compare}`;
  });

  return {
    content: [
      {
        type: "text",
        text: `Collection "${title}" · ${all.length} produto(s):\n\n${lines.join("\n")}${all.length > 60 ? `\n  (+${all.length - 60} outros)` : ""}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_products_in_collection",
  description:
    "Lista produtos em uma collection (pelo handle) com preço e status. Útil pra auditar quem está em qual campanha.",
  inputSchema: {
    handle: z.string().min(1).describe("Handle da collection (ex: 'verao-2026')."),
    maxPages: z.number().int().min(1).max(5).optional(),
  },
  handler: listProductsInCollectionHandler,
});
