import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query NegativeInventory($query: String!, $cursor: String) {
    inventoryItems(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          sku
          tracked
          variant {
            id
            displayName
            product { id title }
          }
          inventoryLevels(first: 20) {
            edges {
              node {
                location { id name }
                quantities(names: ["available", "on_hand"]) {
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
    product: { id: string; title: string };
  } | null;
  inventoryLevels: { edges: Array<{ node: Level }> };
};
type Resp = {
  inventoryItems: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function auditInventoryNegativesHandler(
  args: { threshold?: number | undefined; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const threshold = args.threshold ?? 0;
  const maxPages = Math.min(args.maxPages ?? 5, 20);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const query = `inventory_quantity:<=${threshold}`;
  const hits: Array<{
    product: string;
    variant: string;
    sku: string;
    location: string;
    available: number;
    onHand: number;
  }> = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.inventoryItems.edges ?? []) {
      if (!e.node.tracked) continue;
      for (const le of e.node.inventoryLevels.edges) {
        const q = le.node.quantities;
        const available = q.find((x) => x.name === "available")?.quantity ?? 0;
        const onHand = q.find((x) => x.name === "on_hand")?.quantity ?? 0;
        if (available < threshold || onHand < 0) {
          hits.push({
            product: e.node.variant?.product.title ?? "(sem produto)",
            variant: e.node.variant?.displayName ?? "",
            sku: e.node.sku ?? "(sem SKU)",
            location: le.node.location.name,
            available,
            onHand,
          });
        }
      }
    }
    if (!res.data?.inventoryItems.pageInfo.hasNextPage) break;
    cursor = res.data.inventoryItems.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (hits.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `✓ Nenhum item rastreado com estoque < ${threshold} ou físico negativo.`,
        },
      ],
    };
  }
  hits.sort((a, b) => a.available - b.available);
  const lines = hits
    .slice(0, 200)
    .map(
      (h) =>
        `  ⚠️  ${h.product} · ${h.variant} · SKU ${h.sku} · ${h.location} · disp ${h.available} · físico ${h.onHand}`,
    );
  const cropped = hits.length > 200 ? `\n\n…mais ${hits.length - 200} ocultos (ajuste maxPages/threshold)` : "";
  return {
    content: [
      {
        type: "text",
        text: `Inventário sob o limiar (threshold=${threshold}) — ${hits.length} ocorrências:\n\n${lines.join("\n")}${cropped}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_audit_inventory_negatives",
  description:
    "Audita itens com estoque negativo ou abaixo do limiar (default 0) em qualquer localização. Ignora itens não rastreados. Útil pra detectar oversells e erros de sincronização.",
  inputSchema: {
    threshold: z.number().int().min(-100).max(100).optional(),
    maxPages: z.number().int().min(1).max(20).optional(),
  },
  handler: auditInventoryNegativesHandler,
});
