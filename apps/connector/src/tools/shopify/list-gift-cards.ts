import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query GiftCards($query: String, $cursor: String) {
    giftCards(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          maskedCode
          initialValue { amount currencyCode }
          balance { amount currencyCode }
          enabled
          expiresOn
          createdAt
          customer { firstName lastName email }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  maskedCode: string;
  initialValue: { amount: string; currencyCode: string };
  balance: { amount: string; currencyCode: string };
  enabled: boolean;
  expiresOn: string | null;
  createdAt: string;
  customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
};
type Resp = {
  giftCards: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listGiftCardsHandler(
  args: { status?: "enabled" | "disabled" | "all" | undefined; maxResults?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const status = args.status ?? "enabled";
  const maxResults = Math.min(args.maxResults ?? 50, 250);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const query =
    status === "all"
      ? undefined
      : status === "enabled"
        ? "status:enabled"
        : "status:disabled";
  const out: Node[] = [];
  let cursor: string | null = null;
  while (out.length < maxResults) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, {
        variables: { query, cursor },
      });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.giftCards.edges ?? []) {
      if (out.length >= maxResults) break;
      out.push(e.node);
    }
    if (!res.data?.giftCards.pageInfo.hasNextPage) break;
    cursor = res.data.giftCards.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (out.length === 0) {
    return {
      content: [
        { type: "text", text: `Nenhum gift card (${status}).` },
      ],
    };
  }
  const lines = out.map((g) => {
    const customer =
      [g.customer?.firstName, g.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      g.customer?.email ||
      "(sem cliente)";
    return `  ${g.maskedCode} · ${g.balance.amount}/${g.initialValue.amount} ${g.balance.currencyCode} · ${g.enabled ? "ativo" : "inativo"}${g.expiresOn ? ` · expira ${g.expiresOn.slice(0, 10)}` : ""} · ${customer}`;
  });
  const totalBalance = out.reduce((s, g) => s + Number(g.balance.amount), 0);
  return {
    content: [
      {
        type: "text",
        text: `Gift cards (${out.length}, status=${status}) · saldo total: ${totalBalance.toFixed(2)}:\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_gift_cards",
  description:
    "Gift cards emitidos: código mascarado, saldo atual vs valor inicial, status ativo, expiração. Útil pra auditoria de passivo.",
  inputSchema: {
    status: z.enum(["enabled", "disabled", "all"]).optional(),
    maxResults: z.number().int().min(10).max(250).optional(),
  },
  handler: listGiftCardsHandler,
});
