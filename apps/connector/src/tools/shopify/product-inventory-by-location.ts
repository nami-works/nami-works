import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ProductInventory($id: ID!) {
    product(id: $id) {
      id
      title
      variants(first: 100) {
        edges {
          node {
            id
            title
            sku
            inventoryItem {
              id
              tracked
              inventoryLevels(first: 20) {
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
    }
  }
`;

type Quantity = { name: string; quantity: number };
type Level = {
  location: { id: string; name: string };
  quantities: Quantity[];
};
type Variant = {
  id: string;
  title: string;
  sku: string | null;
  inventoryItem: {
    id: string;
    tracked: boolean;
    inventoryLevels: { edges: Array<{ node: Level }> };
  };
};
type Resp = {
  product: {
    id: string;
    title: string;
    variants: { edges: Array<{ node: Variant }> };
  } | null;
};

export async function productInventoryByLocationHandler(
  args: { productId: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const id = args.productId.startsWith("gid://")
    ? args.productId
    : `gid://shopify/Product/${args.productId}`;
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY, { variables: { id } });
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  const p = res.data?.product;
  if (!p) {
    return { content: [{ type: "text", text: `Produto não encontrado: ${args.productId}` }] };
  }
  const variants = p.variants.edges.map((e) => e.node);
  if (variants.length === 0) {
    return { content: [{ type: "text", text: `${p.title}: sem variantes.` }] };
  }
  const totals = new Map<string, { available: number; committed: number; onHand: number }>();
  const blocks = variants.map((v) => {
    const head = `${v.title} · SKU ${v.sku ?? "(sem)"}${v.inventoryItem.tracked ? "" : " · NÃO rastreado"}`;
    const levels = v.inventoryItem.inventoryLevels.edges.map((e) => {
      const q = e.node.quantities;
      const available = q.find((x) => x.name === "available")?.quantity ?? 0;
      const committed = q.find((x) => x.name === "committed")?.quantity ?? 0;
      const onHand = q.find((x) => x.name === "on_hand")?.quantity ?? 0;
      const locName = e.node.location.name;
      const t = totals.get(locName) ?? { available: 0, committed: 0, onHand: 0 };
      totals.set(locName, {
        available: t.available + available,
        committed: t.committed + committed,
        onHand: t.onHand + onHand,
      });
      return `    ${locName}: disp ${available} · reserv ${committed} · físico ${onHand}`;
    });
    return `  ${head}\n${levels.join("\n") || "    (sem níveis)"}`;
  });
  const totalsBlock = [...totals.entries()]
    .map(([loc, t]) => `  ${loc}: disp ${t.available} · reserv ${t.committed} · físico ${t.onHand}`)
    .join("\n");
  return {
    content: [
      {
        type: "text",
        text: `Inventário por localização — ${p.title}\n\nVariantes (${variants.length}):\n${blocks.join("\n")}\n\nTotais por localização:\n${totalsBlock}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_product_inventory_by_location",
  description:
    "Mostra inventário de um produto (todas as variantes) dividido por localização, com disponível/reservado/físico e totais agregados por loja.",
  inputSchema: {
    productId: z.string().min(1),
  },
  handler: productInventoryByLocationHandler,
});
