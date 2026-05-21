import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ListDiscountCodes {
    codeDiscountNodes(first: 100, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              title
              status
              startsAt
              endsAt
              usageLimit
              appliesOncePerCustomer
              asyncUsageCount
              codes(first: 5) { edges { node { code } } }
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount {
                    amount { amount currencyCode }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type DiscountBasic = {
  __typename: "DiscountCodeBasic";
  title: string;
  status: "ACTIVE" | "EXPIRED" | "SCHEDULED" | string;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  appliesOncePerCustomer: boolean;
  asyncUsageCount: number;
  codes: { edges: Array<{ node: { code: string } }> };
  customerGets?: {
    value:
      | { percentage: number }
      | { amount: { amount: string; currencyCode: string } };
  };
};

type DiscountNode = {
  id: string;
  codeDiscount: DiscountBasic | { __typename: string };
};

type Response = {
  codeDiscountNodes: { edges: Array<{ node: DiscountNode }> };
};

function formatValue(d: DiscountBasic): string {
  const v = d.customerGets?.value;
  if (!v) return "(sem valor)";
  if ("percentage" in v) return `${(v.percentage * 100).toFixed(0)}% off`;
  if ("amount" in v) return `${v.amount.amount} ${v.amount.currencyCode} off`;
  return "(formato desconhecido)";
}

export async function listDiscountCodesHandler(
  args: { onlyActive?: boolean | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const res = await client.request<Response>(QUERY);
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown"}`,
    );
  }

  const nodes = res.data?.codeDiscountNodes.edges.map((e) => e.node) ?? [];

  type Row = {
    code: string;
    title: string;
    value: string;
    status: string;
    startsAt: string;
    endsAt: string | null;
    usageLimit: number | null;
    uses: number;
    oncePerCustomer: boolean;
    flags: string[];
  };

  const rows: Row[] = [];
  for (const n of nodes) {
    const d = n.codeDiscount;
    if (d.__typename !== "DiscountCodeBasic") continue;
    const basic = d as DiscountBasic;
    if (args.onlyActive !== false && basic.status !== "ACTIVE") continue;

    const flags: string[] = [];
    if (!basic.endsAt) flags.push("SEM_EXPIRAÇÃO");
    if (basic.usageLimit === null) flags.push("USOS_ILIMITADOS");
    if (
      basic.usageLimit !== null &&
      basic.asyncUsageCount >= basic.usageLimit
    ) {
      flags.push("ESGOTADO");
    }
    if (basic.endsAt && new Date(basic.endsAt) < new Date()) {
      flags.push("VENCIDO_MAS_ATIVO");
    }

    const codes = basic.codes.edges.map((e) => e.node.code);
    for (const code of codes) {
      rows.push({
        code,
        title: basic.title,
        value: formatValue(basic),
        status: basic.status,
        startsAt: basic.startsAt,
        endsAt: basic.endsAt,
        usageLimit: basic.usageLimit,
        uses: basic.asyncUsageCount,
        oncePerCustomer: basic.appliesOncePerCustomer,
        flags,
      });
    }
  }

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            args.onlyActive === false
              ? "Nenhum código de desconto encontrado."
              : "Nenhum código de desconto ATIVO.",
        },
      ],
    };
  }

  rows.sort((a, b) => b.uses - a.uses); // most-used first

  const withFlags = rows.filter((r) => r.flags.length > 0);
  const clean = rows.filter((r) => r.flags.length === 0);

  const sections: string[] = [
    `Códigos de desconto (${rows.length} total, ${withFlags.length} com alertas):`,
    ``,
  ];

  if (withFlags.length > 0) {
    sections.push("🚩 Com alertas:");
    for (const r of withFlags) {
      sections.push(
        `  ${r.code} · ${r.value} · usos ${r.uses}${r.usageLimit !== null ? `/${r.usageLimit}` : ""} · flags: ${r.flags.join(", ")}`,
      );
    }
    sections.push("");
  }

  sections.push(`Regulares (mais usados primeiro, top 25):`);
  for (const r of clean.slice(0, 25)) {
    sections.push(
      `  ${r.code} · ${r.value} · usos ${r.uses}${r.usageLimit !== null ? `/${r.usageLimit}` : ""}${r.oncePerCustomer ? " · 1/cliente" : ""}${r.endsAt ? ` · até ${r.endsAt.slice(0, 10)}` : ""}`,
    );
  }
  if (clean.length > 25) {
    sections.push(`  (+${clean.length - 25} outros não listados)`);
  }

  return { content: [{ type: "text", text: sections.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_list_discount_codes",
  description:
    "Lista códigos de desconto (DiscountCodeBasic) com flags para anomalias comuns: sem data de expiração, sem limite de uso, vencidos-mas-ainda-ativos, esgotados. Por default mostra apenas status=ACTIVE.",
  inputSchema: {
    onlyActive: z
      .boolean()
      .optional()
      .describe(
        "Default true. Passe false para incluir códigos EXPIRED/SCHEDULED.",
      ),
  },
  handler: listDiscountCodesHandler,
});
