import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query AdvancedSearch($query: String!, $cursor: String) {
    customers(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          numberOfOrders
          amountSpent { amount currencyCode }
          tags
          defaultAddress { city provinceCode }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  numberOfOrders: string | number;
  amountSpent: { amount: string; currencyCode: string };
  tags: string[];
  defaultAddress: { city: string | null; provinceCode: string | null } | null;
};
type Resp = {
  customers: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function searchCustomersAdvancedHandler(
  args: {
    tag?: string | undefined;
    city?: string | undefined;
    minOrders?: number | undefined;
    minSpent?: number | undefined;
    maxResults?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxResults = Math.min(args.maxResults ?? 50, 250);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const parts: string[] = [];
  if (args.tag) parts.push(`tag:${args.tag}`);
  if (args.city) parts.push(`default_address.city:${args.city}`);
  if (typeof args.minOrders === "number")
    parts.push(`number_of_orders:>=${args.minOrders}`);
  if (typeof args.minSpent === "number")
    parts.push(`total_spent:>=${args.minSpent}`);

  const query = parts.join(" AND ") || "*";
  const results: Node[] = [];
  let cursor: string | null = null;
  while (results.length < maxResults) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.customers.edges ?? []) {
      if (results.length >= maxResults) break;
      results.push(e.node);
    }
    if (!res.data?.customers.pageInfo.hasNextPage) break;
    cursor = res.data.customers.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (results.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum cliente encontrado para: ${query}`,
        },
      ],
    };
  }

  const lines = results.map((c) => {
    const name =
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.email ||
      "(sem nome)";
    const n =
      typeof c.numberOfOrders === "string"
        ? Number(c.numberOfOrders)
        : c.numberOfOrders;
    const loc =
      [c.defaultAddress?.city, c.defaultAddress?.provinceCode]
        .filter(Boolean)
        .join(", ") || "(sem endereço)";
    return `  ${name} · ${n} pedidos · ${c.amountSpent.amount} ${c.amountSpent.currencyCode} · ${loc}`;
  });

  return {
    content: [
      {
        type: "text",
        text: `${results.length} cliente(s) para: ${query}\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_search_customers_advanced",
  description:
    "Busca avançada de clientes: tag, cidade, mínimo de pedidos, mínimo gasto. Combina filtros. Útil pra listas de campanha segmentada.",
  inputSchema: {
    tag: z.string().optional(),
    city: z.string().optional(),
    minOrders: z.number().int().min(0).optional(),
    minSpent: z.number().min(0).optional(),
    maxResults: z.number().int().min(10).max(250).optional(),
  },
  handler: searchCustomersAdvancedHandler,
});
