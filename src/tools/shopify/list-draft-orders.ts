import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query DraftOrders($cursor: String) {
    draftOrders(first: 100, sortKey: UPDATED_AT, reverse: true, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          status
          updatedAt
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName email }
          invoiceUrl
        }
      }
    }
  }
`;

type Node = {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  invoiceUrl: string | null;
};
type Resp = {
  draftOrders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listDraftOrdersHandler(
  args: { maxResults?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxResults = Math.min(args.maxResults ?? 50, 250);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const out: Node[] = [];
  let cursor: string | null = null;
  while (out.length < maxResults) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.draftOrders.edges ?? []) {
      if (out.length >= maxResults) break;
      out.push(e.node);
    }
    if (!res.data?.draftOrders.pageInfo.hasNextPage) break;
    cursor = res.data.draftOrders.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (out.length === 0) {
    return { content: [{ type: "text", text: "Nenhum draft order." }] };
  }
  const lines = out.map((d) => {
    const name =
      [d.customer?.firstName, d.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      d.customer?.email ||
      "(sem cliente)";
    return `  ${d.name} · ${d.status} · ${d.updatedAt.slice(0, 10)} · ${name} · ${d.totalPriceSet.shopMoney.amount} ${d.totalPriceSet.shopMoney.currencyCode}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Draft orders (${out.length}, mais recentes primeiro):\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_draft_orders",
  description:
    "Lista draft orders (quotes/pré-pedidos). Útil pra follow-up comercial e limpeza de drafts obsoletos.",
  inputSchema: {
    maxResults: z.number().int().min(10).max(250).optional(),
  },
  handler: listDraftOrdersHandler,
});
