import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query LowInventory($query: String!, $cursor: String) {
    productVariants(first: 250, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          sku
          displayName
          inventoryQuantity
          product { id title tags }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  sku: string | null;
  displayName: string | null;
  inventoryQuantity: number | null;
  product: { id: string; title: string; tags: string[] };
};
type Resp = {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function lowInventoryAlertHandler(
  args: {
    threshold?: number | undefined;
    tag?: string | undefined;
    maxPages?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const threshold = args.threshold ?? 50;
  const maxPages = Math.min(args.maxPages ?? 3, 10);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  // Shopify variant-search supports `inventory_quantity:<N` (with operators).
  // Combine with optional tag filter via product_tag.
  const parts: string[] = [`inventory_quantity:<=${threshold}`];
  if (args.tag) parts.push(`product_tag:${args.tag}`);
  const query = parts.join(" AND ");

  type Row = { title: string; sku: string | null; qty: number; tags: string[] };
  const rows: Row[] = [];
  let cursor: string | null = null;
  let truncated = false;

  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.productVariants.edges ?? []) {
      const v = e.node;
      const qty = v.inventoryQuantity ?? 0;
      if (qty > threshold) continue; // defensive double-check
      rows.push({
        title: v.product.title + (v.displayName ? ` · ${v.displayName}` : ""),
        sku: v.sku,
        qty,
        tags: v.product.tags,
      });
    }
    if (!res.data?.productVariants.pageInfo.hasNextPage) break;
    cursor = res.data.productVariants.pageInfo.endCursor;
    if (!cursor) break;
    if (i === maxPages - 1) truncated = true;
  }

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhuma variante com estoque <= ${threshold}${args.tag ? ` e tag "${args.tag}"` : ""}.`,
        },
      ],
    };
  }

  rows.sort((a, b) => a.qty - b.qty);

  const lines = rows.slice(0, 100).map((r) => {
    const sku = r.sku ? ` [${r.sku}]` : "";
    return `  qty=${r.qty.toString().padStart(3)} · ${r.title}${sku}`;
  });
  const truncMsg = truncated
    ? `\n⚠ Limite de páginas atingido (${maxPages} × 250 variantes); refine com tag.`
    : "";
  const header = `🟡 ${rows.length} variante(s) com estoque <= ${threshold}${args.tag ? ` (tag:${args.tag})` : ""}:${truncMsg}\n\n`;

  return {
    content: [
      {
        type: "text",
        text:
          header +
          lines.join("\n") +
          (rows.length > 100 ? `\n  (+${rows.length - 100} outras)` : ""),
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_low_inventory_alert",
  description:
    "Lista variantes com estoque <= N (default 50), ordenadas da mais baixa primeiro. Opcional: filtra por tag pra focar em uma categoria/campanha. Essencial pra reposição e promo-planning.",
  inputSchema: {
    threshold: z.number().int().min(0).max(100).optional(),
    tag: z.string().optional(),
    maxPages: z.number().int().min(1).max(10).optional(),
  },
  handler: lowInventoryAlertHandler,
});
