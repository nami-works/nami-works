import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query AuditLanctoConflicts($query: String!) {
    products(first: 100, query: $query) {
      edges {
        node {
          id
          title
          tags
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
  tags: string[];
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

type AuditLanctoResponse = {
  products: { edges: Array<{ node: ProductNode }> };
};

const DEFAULT_EXCLUSION_TAG = "lancto";

export async function auditExcludedInCampaignHandler(
  args: { exclusionTag?: string | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const excl = args.exclusionTag ?? DEFAULT_EXCLUSION_TAG;

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const res = await client.request<AuditLanctoResponse>(QUERY, {
    variables: { query: `tag:${excl}` },
  });
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`,
    );
  }

  const products = res.data?.products.edges.map((e) => e.node) ?? [];

  type Offender = {
    productId: string;
    title: string;
    variantSku: string | null;
    price: number;
    compareAtPrice: number;
    discountPct: number;
  };

  const offenders: Offender[] = [];
  for (const p of products) {
    for (const v of p.variants.edges.map((e) => e.node)) {
      const price = Number(v.price);
      const compare = v.compareAtPrice ? Number(v.compareAtPrice) : 0;
      if (!(compare > price && price > 0)) continue; // not discounted
      offenders.push({
        productId: p.id,
        title: p.title,
        variantSku: v.sku,
        price,
        compareAtPrice: compare,
        discountPct: (compare - price) / compare,
      });
    }
  }

  if (products.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum produto com a tag "${excl}" foi encontrado.`,
        },
      ],
    };
  }

  if (offenders.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `✅ Auditoria limpa. ${products.length} produto(s) com a tag "${excl}" encontrados, nenhum está em promoção (compareAtPrice desativado).`,
        },
      ],
    };
  }

  const lines = offenders.map((o) => {
    const sku = o.variantSku ? ` [${o.variantSku}]` : "";
    return `  ${o.title}${sku} · ${o.price.toFixed(2)} (era ${o.compareAtPrice.toFixed(2)}, -${(o.discountPct * 100).toFixed(0)}%)`;
  });

  const body = [
    `🚩 VIOLAÇÃO: ${offenders.length} produto(s) com tag "${excl}" estão em promoção.`,
    ``,
    `Produtos com essa tag deveriam ficar FORA de campanhas. Ação recomendada: remover o compareAtPrice (ou remover a tag se a exclusão não é mais necessária).`,
    ``,
    ...lines,
    ``,
    `Total de produtos tagueados "${excl}": ${products.length} · em violação: ${offenders.length}.`,
  ].join("\n");

  return {
    content: [{ type: "text", text: body }],
    ...(offenders.length > 0 ? { isError: true as const } : {}),
  };
}

registerToolDefinition({
  name: "shopify_audit_excluded_in_campaign",
  description:
    "Auditoria: encontra produtos tagueados como excluídos de campanhas (default: tag 'lancto') que ainda estão em promoção (compareAtPrice definido). Estes são erros operacionais comuns que invalidam a exclusão.",
  inputSchema: {
    exclusionTag: z
      .string()
      .optional()
      .describe(
        "Tag que marca produtos como excluídos de campanhas. Default 'lancto'.",
      ),
  },
  handler: auditExcludedInCampaignHandler,
});
