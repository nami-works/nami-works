import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query AbandonedCheckouts($query: String!, $cursor: String) {
    abandonedCheckouts(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName email phone }
          lineItemsQuantity
          abandonedCheckoutUrl
        }
      }
    }
  }
`;

type Node = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  lineItemsQuantity: number;
  abandonedCheckoutUrl: string;
};
type Resp = {
  abandonedCheckouts: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function listAbandonedCheckoutsHandler(
  args: { sinceDaysBack?: number | undefined; maxResults?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const daysBack = args.sinceDaysBack ?? 7;
  const maxResults = Math.min(args.maxResults ?? 50, 250);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (!ISO.test(since)) {
    throw new Error(`Derived date invalid: ${since}`);
  }
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const query = `created_at:>=${since}`;
  const out: Node[] = [];
  let cursor: string | null = null;
  while (out.length < maxResults) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.abandonedCheckouts.edges ?? []) {
      if (out.length >= maxResults) break;
      out.push(e.node);
    }
    if (!res.data?.abandonedCheckouts.pageInfo.hasNextPage) break;
    cursor = res.data.abandonedCheckouts.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (out.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum checkout abandonado nos últimos ${daysBack} dia(s).`,
        },
      ],
    };
  }
  const lines = out.map((c) => {
    const name =
      [c.customer?.firstName, c.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      c.customer?.email ||
      "(guest)";
    const contact = [c.customer?.email, c.customer?.phone]
      .filter(Boolean)
      .join(" / ") || "(sem contato)";
    return `  ${c.name} · ${c.createdAt.slice(0, 10)} · ${name} · ${contact} · ${c.lineItemsQuantity} itens · ${c.totalPriceSet.shopMoney.amount} ${c.totalPriceSet.shopMoney.currencyCode}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Checkouts abandonados últimos ${daysBack} dia(s) · ${out.length} encontrados:\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_abandoned_checkouts",
  description:
    "Lista checkouts abandonados dos últimos N dias (default 7) com contato e valor. Alvos de campanha de recovery.",
  inputSchema: {
    sinceDaysBack: z.number().int().min(1).max(90).optional(),
    maxResults: z.number().int().min(10).max(250).optional(),
  },
  handler: listAbandonedCheckoutsHandler,
});
