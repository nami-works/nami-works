import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query StaleMarkdowns($query: String!, $cursor: String) {
    products(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          updatedAt
          tags
          variants(first: 10) {
            edges {
              node {
                id
                sku
                price
                compareAtPrice
                updatedAt
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
  updatedAt: string;
  tags: string[];
  variants: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        price: string;
        compareAtPrice: string | null;
        updatedAt: string;
      };
    }>;
  };
};

type Response = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: ProductNode }>;
  };
};

export async function detectStaleMarkdownsHandler(
  args: {
    thresholdDays?: number | undefined;
    maxPages?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const thresholdDays = args.thresholdDays ?? 60;
  const maxPages = Math.min(args.maxPages ?? 3, 10);

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  // We can't filter by "has compareAtPrice" in the query language, so we
  // page through all active products and client-side-filter. Cap pages.
  const cutoff = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;
  type Finding = {
    productTitle: string;
    variantSku: string | null;
    price: number;
    compareAtPrice: number;
    discountPct: number;
    lastUpdated: string;
    ageDays: number;
  };
  const findings: Finding[] = [];
  let cursor: string | null = null;
  let productsSeen = 0;
  let truncated = false;

  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Response; errors?: { message?: string } } =
      await client.request<Response>(QUERY, {
        variables: { query: "status:active", cursor },
      });
    if (res.errors) {
      throw new Error(
        `Shopify GraphQL error: ${res.errors.message ?? "unknown"}`,
      );
    }
    const edges = res.data?.products.edges ?? [];
    for (const e of edges) {
      const p = e.node;
      productsSeen += 1;
      for (const v of p.variants.edges.map((ve) => ve.node)) {
        const price = Number(v.price);
        const compare = v.compareAtPrice ? Number(v.compareAtPrice) : 0;
        if (!(compare > price && price > 0)) continue;
        const variantUpdated = new Date(v.updatedAt).getTime();
        if (variantUpdated >= cutoff) continue;
        const ageDays = Math.floor(
          (Date.now() - variantUpdated) / (24 * 60 * 60 * 1000),
        );
        findings.push({
          productTitle: p.title,
          variantSku: v.sku,
          price,
          compareAtPrice: compare,
          discountPct: (compare - price) / compare,
          lastUpdated: v.updatedAt,
          ageDays,
        });
      }
    }
    if (!res.data?.products.pageInfo.hasNextPage) break;
    cursor = res.data.products.pageInfo.endCursor;
    if (!cursor) break;
    if (i === maxPages - 1) truncated = true;
  }

  if (findings.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Auditoria limpa · ${productsSeen} produto(s) verificado(s), nenhum com compareAtPrice parado há mais de ${thresholdDays} dias.`,
        },
      ],
    };
  }

  findings.sort((a, b) => b.ageDays - a.ageDays);

  const lines = findings.slice(0, 40).map((f) => {
    const sku = f.variantSku ? ` [${f.variantSku}]` : "";
    return `  ${f.ageDays}d · ${f.productTitle}${sku} · ${f.price.toFixed(2)} (era ${f.compareAtPrice.toFixed(2)}, -${(f.discountPct * 100).toFixed(0)}%) · última edição ${f.lastUpdated.slice(0, 10)}`;
  });

  const truncMsg = truncated
    ? `⚠ Limite de páginas atingido (${maxPages} × 100 produtos). Aumente maxPages para cobrir toda a base.`
    : "";

  const body = [
    `🚩 ${findings.length} variante(s) com compareAtPrice parada há mais de ${thresholdDays} dias.`,
    `${productsSeen} produto(s) ativo(s) verificado(s). Ordenado do mais antigo primeiro.`,
    truncMsg,
    ``,
    `Recomendação: revisar se a promoção ainda deveria estar ativa. Se não, remover compareAtPrice.`,
    ``,
    ...lines,
    findings.length > 40 ? `  (+${findings.length - 40} outras não listadas)` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content: [{ type: "text", text: body }],
  };
}

registerToolDefinition({
  name: "shopify_detect_stale_markdowns",
  description:
    "Encontra variantes com compareAtPrice ativa há muito tempo (default: >60 dias sem edição). Útil para detectar promoções esquecidas que o ops não removeu no fim da campanha. Puramente leitura Shopify.",
  inputSchema: {
    thresholdDays: z
      .number()
      .int()
      .min(7)
      .max(730)
      .optional()
      .describe("Idade mínima em dias para considerar stale. Default 60."),
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Páginas de 100 produtos cada. Default 3 (=300 produtos)."),
  },
  handler: detectStaleMarkdownsHandler,
});
