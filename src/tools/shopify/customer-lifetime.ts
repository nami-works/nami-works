import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query CustomerLifetime($query: String!) {
    customers(first: 5, query: $query) {
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          createdAt
          numberOfOrders
          amountSpent { amount currencyCode }
          lastOrder {
            id
            name
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
          }
          orders(first: 1, sortKey: PROCESSED_AT, reverse: false) {
            edges {
              node {
                createdAt
                totalPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

type CustomerNode = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  numberOfOrders: string | number;
  amountSpent: { amount: string; currencyCode: string };
  lastOrder: {
    id: string;
    name: string;
    createdAt: string;
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  } | null;
  orders: {
    edges: Array<{
      node: {
        createdAt: string;
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      };
    }>;
  };
};

type Response = { customers: { edges: Array<{ node: CustomerNode }> } };

function escapeQuery(v: string): string {
  if (/[\s"']/.test(v)) return `"${v.replace(/"/g, '\\"')}"`;
  return v;
}

export async function customerLifetimeHandler(
  args: { email?: string | undefined; phone?: string | undefined; customerId?: string | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const filters: string[] = [];
  if (args.email) filters.push(`email:${escapeQuery(args.email)}`);
  if (args.phone) filters.push(`phone:${escapeQuery(args.phone)}`);
  if (args.customerId) filters.push(`id:${escapeQuery(args.customerId)}`);
  if (filters.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "Forneça ao menos um identificador: email, phone ou customerId.",
        },
      ],
      isError: true,
    };
  }

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const res = await client.request<Response>(QUERY, {
    variables: { query: filters.join(" OR ") },
  });
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown"}`,
    );
  }

  const customers = res.data?.customers.edges.map((e) => e.node) ?? [];
  if (customers.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum cliente encontrado para: ${filters.join(" OR ")}`,
        },
      ],
    };
  }

  const lines = customers.map((c) => {
    const name =
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.email ||
      c.phone ||
      "(sem nome)";
    const nOrders =
      typeof c.numberOfOrders === "string"
        ? Number(c.numberOfOrders)
        : c.numberOfOrders;
    const totalSpent = `${c.amountSpent.amount} ${c.amountSpent.currencyCode}`;
    const avg =
      nOrders > 0 && Number(c.amountSpent.amount) > 0
        ? (Number(c.amountSpent.amount) / nOrders).toFixed(2)
        : "0.00";
    const firstOrder = c.orders.edges[0]?.node;
    const firstStr = firstOrder
      ? `${firstOrder.createdAt.slice(0, 10)}`
      : "(primeiro pedido n/a)";
    const lastStr = c.lastOrder
      ? `${c.lastOrder.name} em ${c.lastOrder.createdAt.slice(0, 10)}`
      : "(sem último pedido)";
    return [
      `  ${name}`,
      `    Email: ${c.email ?? "(sem email)"} · Telefone: ${c.phone ?? "(sem telefone)"}`,
      `    Cadastrado: ${c.createdAt.slice(0, 10)}`,
      `    LTV: ${nOrders} pedidos · ${totalSpent} · ticket médio ${avg} ${c.amountSpent.currencyCode}`,
      `    Primeiro pedido: ${firstStr} · Último: ${lastStr}`,
      `    ID: ${c.id}`,
    ].join("\n");
  });

  const header = `${customers.length} cliente(s) encontrado(s):\n\n`;
  return { content: [{ type: "text", text: header + lines.join("\n\n") }] };
}

registerToolDefinition({
  name: "shopify_customer_lifetime",
  description:
    "Busca um cliente (por email, phone ou customerId) e retorna LTV: total de pedidos, valor gasto, ticket médio, data do primeiro e do último pedido.",
  inputSchema: {
    email: z.string().email().optional(),
    phone: z.string().optional(),
    customerId: z.string().optional(),
  },
  handler: customerLifetimeHandler,
});
