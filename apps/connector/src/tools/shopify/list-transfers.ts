import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query InventoryTransfers($cursor: String) {
    inventoryTransfers(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          status
          createdAt
          origin { ... on Location { id name } }
          destination { ... on Location { id name } }
          lineItemsCount { count }
          totalQuantities { quantityAccepted quantityRejected quantityShipped }
        }
      }
    }
  }
`;

type Loc = { id: string; name: string };
type Node = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  origin: Loc | null;
  destination: Loc | null;
  lineItemsCount: { count: number } | null;
  totalQuantities: {
    quantityAccepted: number;
    quantityRejected: number;
    quantityShipped: number;
  } | null;
};
type Resp = {
  inventoryTransfers: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listTransfersHandler(
  args: { status?: string | undefined; maxResults?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxResults = Math.min(args.maxResults ?? 50, 200);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const out: Node[] = [];
  let cursor: string | null = null;
  try {
    while (out.length < maxResults) {
      const res: { data?: Resp; errors?: { message?: string } } =
        await client.request<Resp>(QUERY, { variables: { cursor } });
      if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
      for (const e of res.data?.inventoryTransfers.edges ?? []) {
        if (out.length >= maxResults) break;
        if (args.status && e.node.status.toLowerCase() !== args.status.toLowerCase()) continue;
        out.push(e.node);
      }
      if (!res.data?.inventoryTransfers.pageInfo.hasNextPage) break;
      cursor = res.data.inventoryTransfers.pageInfo.endCursor;
      if (!cursor) break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `inventoryTransfers indisponível (pode não estar habilitado para este plano): ${msg}`,
        },
      ],
    };
  }
  if (out.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhuma transferência de inventário encontrada${args.status ? ` com status=${args.status}` : ""}.`,
        },
      ],
    };
  }
  const lines = out.map((t) => {
    const qty = t.totalQuantities;
    const qtys = qty
      ? `aceito ${qty.quantityAccepted} · rej ${qty.quantityRejected} · env ${qty.quantityShipped}`
      : "(sem quantidades)";
    return `  ${t.name} · ${t.status} · ${t.createdAt.slice(0, 10)} · ${t.origin?.name ?? "?"} → ${t.destination?.name ?? "?"} · ${t.lineItemsCount?.count ?? 0} SKUs · ${qtys}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Transferências de inventário (${out.length}):\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_transfers",
  description:
    "Lista transferências de inventário entre localizações (origem → destino, status, SKUs, quantidades). Requer o recurso InventoryTransfers habilitado na loja.",
  inputSchema: {
    status: z.string().optional().describe("Filtro opcional: OPEN, IN_TRANSIT, RECEIVED, etc."),
    maxResults: z.number().int().min(10).max(200).optional(),
  },
  handler: listTransfersHandler,
});
