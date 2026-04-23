import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query AuditCampaignConsistency($query: String!) {
    products(first: 100, query: $query) {
      edges {
        node {
          id
          title
          variants(first: 25) {
            edges {
              node {
                id
                sku
                price
                compareAtPrice
              }
            }
          }
        }
      }
    }
  }
`;

type ProductNode = {
  id: string;
  title: string;
  variants: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        price: string;
        compareAtPrice: string | null;
      };
    }>;
  };
};

type CampaignResponse = {
  products: { edges: Array<{ node: ProductNode }> };
};

export async function auditCampaignConsistencyHandler(
  args: { campaignTag: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const tag = args.campaignTag.trim();
  if (tag.length === 0) {
    return {
      content: [{ type: "text", text: "campaignTag é obrigatório." }],
      isError: true,
    };
  }

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const res = await client.request<CampaignResponse>(QUERY, {
    variables: { query: `tag:${tag}` },
  });
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`,
    );
  }

  const products = res.data?.products.edges.map((e) => e.node) ?? [];
  if (products.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum produto encontrado com a tag "${tag}".`,
        },
      ],
    };
  }

  type ProductStatus = {
    title: string;
    sku: string | null;
    discounted: boolean;
    price: number;
    compareAtPrice: number;
  };

  const statuses: ProductStatus[] = [];
  for (const p of products) {
    // Use the first variant as canonical for campaign consistency reporting
    // (a product can have multiple variants; ops normally sets campaigns
    // product-wide, not variant-wide).
    const v = p.variants.edges[0]?.node;
    if (!v) continue;
    const price = Number(v.price);
    const compare = v.compareAtPrice ? Number(v.compareAtPrice) : 0;
    const discounted = compare > price && price > 0;
    statuses.push({
      title: p.title,
      sku: v.sku,
      discounted,
      price,
      compareAtPrice: compare,
    });
  }

  const discounted = statuses.filter((s) => s.discounted);
  const notDiscounted = statuses.filter((s) => !s.discounted);

  const isConsistent = discounted.length === 0 || notDiscounted.length === 0;
  const majorityDiscounted = discounted.length >= notDiscounted.length;

  if (isConsistent) {
    const state = discounted.length > 0 ? "todos em promoção" : "nenhum em promoção";
    return {
      content: [
        {
          type: "text",
          text: `✅ Campanha "${tag}" consistente: ${statuses.length} produto(s), ${state}.`,
        },
      ],
    };
  }

  // Inconsistent — report which side is the "minority" (likely the bug).
  const minority = majorityDiscounted ? notDiscounted : discounted;
  const minorityLabel = majorityDiscounted
    ? "NÃO estão em promoção (mas deveriam, já que a maioria está)"
    : "ESTÃO em promoção (mas não deveriam, já que a maioria não está)";

  const lines = minority.slice(0, 30).map((s) => {
    const sku = s.sku ? ` [${s.sku}]` : "";
    return `  ${s.title}${sku} · ${s.price.toFixed(2)}${s.compareAtPrice > 0 ? ` (era ${s.compareAtPrice.toFixed(2)})` : ""}`;
  });

  const body = [
    `🚩 Campanha "${tag}" INCONSISTENTE:`,
    ``,
    `  ${discounted.length} produto(s) em promoção, ${notDiscounted.length} sem promoção.`,
    ``,
    `Os seguintes ${minority.length} produto(s) ${minorityLabel}:`,
    ``,
    ...lines,
    ...(minority.length > 30 ? [`  (+${minority.length - 30} outros)`] : []),
  ].join("\n");

  return {
    content: [{ type: "text", text: body }],
    isError: true,
  };
}

registerToolDefinition({
  name: "shopify_audit_campaign_consistency",
  description:
    "Auditoria: dado uma tag de campanha, verifica se TODOS os produtos com essa tag têm o mesmo estado promocional (todos em promoção OU todos sem). Flagra divergências — comum quando uma campanha foi aplicada/revertida parcialmente.",
  inputSchema: {
    campaignTag: z
      .string()
      .min(1)
      .describe(
        "Tag da campanha. Ex: 'BEAUTYBACK', 'nataljanho2026'. Case-sensitive.",
      ),
  },
  handler: auditCampaignConsistencyHandler,
});
