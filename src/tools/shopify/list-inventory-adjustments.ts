import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query InventoryAdjustments($query: String, $cursor: String) {
    inventoryItems(first: 50, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          sku
          tracked
          variant {
            id
            displayName
            product { title }
          }
          inventoryLevels(first: 10) {
            edges {
              node {
                location { id name }
                quantities(names: ["available", "committed", "on_hand"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;

type Quantity = { name: string; quantity: number };
type Level = {
  location: { id: string; name: string };
  quantities: Quantity[];
};
type Node = {
  id: string;
  sku: string | null;
  tracked: boolean;
  variant: {
    id: string;
    displayName: string;
    product: { title: string };
  } | null;
  inventoryLevels: { edges: Array<{ node: Level }> };
};
type Resp = {
  inventoryItems: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listInventoryAdjustmentsHandler(
  args: { sku?: string | undefined; productTitle?: string | undefined; maxItems?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxItems = Math.min(args.maxItems ?? 50, 200);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const parts: string[] = [];
  if (args.sku) parts.push(`sku:${args.sku}`);
  if (args.productTitle) parts.push(`product_title:${args.productTitle}`);
  const query = parts.join(" AND ") || undefined;

  const out: Node[] = [];
  let cursor: string | null = null;
  while (out.length < maxItems) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.inventoryItems.edges ?? []) {
      if (out.length >= maxItems) break;
      out.push(e.node);
    }
    if (!res.data?.inventoryItems.pageInfo.hasNextPage) break;
    cursor = res.data.inventoryItems.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (out.length === 0) {
    return { content: [{ type: "text", text: "Nenhum item de inventário encontrado." }] };
  }
  const blocks = out.map((it) => {
    const head = `${it.variant?.product.title ?? "(sem produto)"} · ${it.variant?.displayName ?? ""} · SKU ${it.sku ?? "(sem SKU)"}${it.tracked ? "" : " · NÃO rastreado"}`;
    const levels = it.inventoryLevels.edges.map((e) => {
      const q = e.node.quantities;
      const available = q.find((x) => x.name === "available")?.quantity ?? 0;
      const committed = q.find((x) => x.name === "committed")?.quantity ?? 0;
      const onHand = q.find((x) => x.name === "on_hand")?.quantity ?? 0;
      return `    ${e.node.location.name}: disp ${available} · reserv ${committed} · físico ${onHand}`;
    });
    return `${head}\n${levels.join("\n") || "    (sem níveis)"}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Níveis de inventário (${out.length} itens):\n\n${blocks.join("\n\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_inventory_adjustments",
  description:
    "Snapshot de inventário por item: disponível, reservado (committed) e físico (on_hand) por localização. Filtros opcionais por SKU ou título de produto.",
  inputSchema: {
    sku: z.string().optional(),
    productTitle: z.string().optional(),
    maxItems: z.number().int().min(10).max(200).optional(),
  },
  handler: listInventoryAdjustmentsHandler,
});
