import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query TopCustomers($cursor: String) {
    customers(first: 250, sortKey: TOTAL_SPENT, reverse: true, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          firstName
          lastName
          email
          numberOfOrders
          amountSpent { amount currencyCode }
        }
      }
    }
  }
`;

type Customer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  numberOfOrders: string | number;
  amountSpent: { amount: string; currencyCode: string };
};
type Resp = {
  customers: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Customer }>;
  };
};

export async function topCustomersByLtvHandler(
  args: { topN?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const topN = args.topN ?? 100;
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const all: Customer[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 4 && all.length < topN; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.customers.edges ?? []) {
      if (all.length >= topN) break;
      all.push(e.node);
    }
    if (!res.data?.customers.pageInfo.hasNextPage) break;
    cursor = res.data.customers.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (all.length === 0) {
    return {
      content: [{ type: "text", text: "Nenhum cliente encontrado." }],
    };
  }

  const lines = all.map((c, idx) => {
    const name =
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.email ||
      "(sem nome)";
    const n =
      typeof c.numberOfOrders === "string"
        ? Number(c.numberOfOrders)
        : c.numberOfOrders;
    return `  ${(idx + 1).toString().padStart(3)}. ${name} · ${n} pedidos · ${c.amountSpent.amount} ${c.amountSpent.currencyCode}`;
  });

  const cur = all[0]?.amountSpent.currencyCode ?? "BRL";
  const total = all.reduce((s, c) => s + Number(c.amountSpent.amount), 0);
  const header = `Top ${all.length} clientes por LTV · total gasto somado: ${cur} ${total.toFixed(2)}\n\n`;

  return { content: [{ type: "text", text: header + lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_top_customers_by_ltv",
  description:
    "Top N clientes ordenados por amountSpent lifetime (decrescente). Útil pra identificar VIPs e definir programas de fidelidade (portado de vip100.py).",
  inputSchema: {
    topN: z.number().int().min(10).max(1000).optional().describe("Default 100."),
  },
  handler: topCustomersByLtvHandler,
});
