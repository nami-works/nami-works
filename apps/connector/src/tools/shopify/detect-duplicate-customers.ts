import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query CustomersForDedup($cursor: String) {
    customers(first: 250, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          numberOfOrders
        }
      }
    }
  }
`;

type C = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  numberOfOrders: string | number;
};
type Resp = {
  customers: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: C }>;
  };
};

function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  return p.replace(/\D/g, "");
}

export async function detectDuplicateCustomersHandler(
  args: { maxPages?: number | undefined; by?: "email" | "phone" | "both" | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const maxPages = Math.min(args.maxPages ?? 4, 20);
  const by = args.by ?? "both";
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const all: C[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.customers.edges ?? []) all.push(e.node);
    if (!res.data?.customers.pageInfo.hasNextPage) break;
    cursor = res.data.customers.pageInfo.endCursor;
    if (!cursor) break;
  }

  const byEmail = new Map<string, C[]>();
  const byPhone = new Map<string, C[]>();
  for (const c of all) {
    if ((by === "email" || by === "both") && c.email) {
      const k = c.email.trim().toLowerCase();
      byEmail.set(k, [...(byEmail.get(k) ?? []), c]);
    }
    if ((by === "phone" || by === "both") && c.phone) {
      const k = normalizePhone(c.phone);
      if (k) byPhone.set(k, [...(byPhone.get(k) ?? []), c]);
    }
  }

  const dupEmail = [...byEmail.entries()].filter(([, v]) => v.length > 1);
  const dupPhone = [...byPhone.entries()].filter(([, v]) => v.length > 1);

  if (dupEmail.length === 0 && dupPhone.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhuma duplicata detectada em ${all.length} cliente(s) verificado(s).`,
        },
      ],
    };
  }

  const fmt = (c: C): string => {
    const name =
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.email ||
      "(sem nome)";
    const n =
      typeof c.numberOfOrders === "string"
        ? Number(c.numberOfOrders)
        : c.numberOfOrders;
    return `    ${name} · ${n} pedidos · ${c.id}`;
  };

  const sections: string[] = [
    `Análise de duplicatas · ${all.length} cliente(s) verificado(s)`,
  ];
  if (dupEmail.length > 0) {
    sections.push("", `🚩 ${dupEmail.length} email(s) duplicado(s):`);
    for (const [email, group] of dupEmail.slice(0, 15)) {
      sections.push(`  "${email}" · ${group.length} registros`);
      for (const c of group) sections.push(fmt(c));
    }
    if (dupEmail.length > 15) sections.push(`  (+${dupEmail.length - 15} outros)`);
  }
  if (dupPhone.length > 0) {
    sections.push("", `🚩 ${dupPhone.length} telefone(s) duplicado(s):`);
    for (const [phone, group] of dupPhone.slice(0, 15)) {
      sections.push(`  "${phone}" · ${group.length} registros`);
      for (const c of group) sections.push(fmt(c));
    }
    if (dupPhone.length > 15) sections.push(`  (+${dupPhone.length - 15} outros)`);
  }
  return {
    content: [{ type: "text", text: sections.join("\n") }],
    isError: true,
  };
}

registerToolDefinition({
  name: "shopify_detect_duplicate_customers",
  description:
    "Detecta clientes duplicados por email (case-insensitive) e/ou telefone (dígitos apenas). Configurável via 'by'. Util pra limpeza de CRM antes de campanhas.",
  inputSchema: {
    maxPages: z.number().int().min(1).max(20).optional(),
    by: z.enum(["email", "phone", "both"]).optional(),
  },
  handler: detectDuplicateCustomersHandler,
});
