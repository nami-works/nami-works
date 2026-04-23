import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query RefundedOrders($query: String!, $cursor: String) {
    orders(first: 100, query: $query, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount } }
          refunds(first: 5) {
            createdAt
            note
            totalRefundedSet { shopMoney { amount currencyCode } }
          }
          customer { firstName lastName email }
        }
      }
    }
  }
`;

type Refund = {
  createdAt: string;
  note: string | null;
  totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
};
type Node = {
  id: string;
  name: string;
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  refunds: Refund[];
  customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
};
type Resp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listRecentRefundsHandler(
  args: { daysBack?: number | undefined; maxResults?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const daysBack = args.daysBack ?? 14;
  const maxResults = Math.min(args.maxResults ?? 50, 250);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const query = `financial_status:refunded OR financial_status:partially_refunded AND updated_at:>=${since}`;
  const out: Node[] = [];
  let cursor: string | null = null;
  while (out.length < maxResults) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.orders.edges ?? []) {
      if (out.length >= maxResults) break;
      out.push(e.node);
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (out.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum estorno nos últimos ${daysBack} dias.`,
        },
      ],
    };
  }
  const lines = out.flatMap((o) => {
    const name =
      [o.customer?.firstName, o.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      o.customer?.email ||
      "(guest)";
    const head = `  ${o.name} · ${o.createdAt.slice(0, 10)} · ${name} · total R$ ${o.totalPriceSet.shopMoney.amount} · refunded R$ ${o.totalRefundedSet.shopMoney.amount}`;
    const details = o.refunds.map(
      (r) =>
        `      ${r.createdAt.slice(0, 10)} · ${r.totalRefundedSet.shopMoney.amount} ${r.totalRefundedSet.shopMoney.currencyCode}${r.note ? ` · "${r.note.slice(0, 60)}"` : ""}`,
    );
    return [head, ...details];
  });
  return {
    content: [
      {
        type: "text",
        text: `Estornos últimos ${daysBack} dia(s) · ${out.length} pedido(s):\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_recent_refunds",
  description:
    "Pedidos estornados (completos ou parciais) nos últimos N dias. Mostra nota, data e valor de cada refund.",
  inputSchema: {
    daysBack: z.number().int().min(1).max(90).optional(),
    maxResults: z.number().int().min(10).max(250).optional(),
  },
  handler: listRecentRefundsHandler,
});
