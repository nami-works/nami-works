import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query AuditMarkdowns($query: String!) {
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
                title
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
        title: string;
        sku: string | null;
        price: string;
        compareAtPrice: string | null;
      };
    }>;
  };
};

type AuditMarkdownsResponse = {
  products: { edges: Array<{ node: ProductNode }> };
};

// Products tagged with this are supposed to be EXCLUDED from campaigns.
// Finding one marked down is always a violation (per gebeauty ops memory).
const EXCLUSION_TAG = "lancto";

// Anything over this is almost certainly an error (not a promo).
const DEEP_DISCOUNT_THRESHOLD = 0.5;

export async function auditMarkdownsHandler(
  args: { tag?: string | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const query = typeof args.tag === "string" && args.tag.length > 0
    ? `tag:${args.tag}`
    : "status:active";

  const res = await client.request<AuditMarkdownsResponse>(QUERY, {
    variables: { query },
  });
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`,
    );
  }

  const products = res.data?.products.edges.map((e) => e.node) ?? [];

  type Finding = {
    productId: string;
    title: string;
    variantSku: string | null;
    price: number;
    compareAtPrice: number;
    discountPct: number;
    tags: string[];
    flags: string[];
  };

  const findings: Finding[] = [];
  for (const p of products) {
    for (const v of p.variants.edges.map((e) => e.node)) {
      const price = Number(v.price);
      const compare = v.compareAtPrice ? Number(v.compareAtPrice) : 0;
      if (!(compare > price && price > 0)) continue; // not marked down
      const discountPct = (compare - price) / compare;

      const flags: string[] = [];
      if (p.tags.includes(EXCLUSION_TAG)) {
        flags.push(`EXCLUSION_VIOLATION (tag ${EXCLUSION_TAG} is set)`);
      }
      if (discountPct > DEEP_DISCOUNT_THRESHOLD) {
        flags.push(
          `DEEP_DISCOUNT (${(discountPct * 100).toFixed(0)}% off)`,
        );
      }

      findings.push({
        productId: p.id,
        title: p.title,
        variantSku: v.sku,
        price,
        compareAtPrice: compare,
        discountPct,
        tags: p.tags,
        flags,
      });
    }
  }

  if (findings.length === 0) {
    const scope =
      typeof args.tag === "string"
        ? `com a tag "${args.tag}"`
        : "ativos";
    return {
      content: [
        {
          type: "text",
          text: `Nenhum produto marcado para baixo (compareAtPrice > price) entre os produtos ${scope}.`,
        },
      ],
    };
  }

  const violations = findings.filter((f) => f.flags.length > 0);
  const normalPromos = findings.filter((f) => f.flags.length === 0);

  const formatFinding = (f: Finding): string => {
    const sku = f.variantSku ? ` [${f.variantSku}]` : "";
    const flagsStr = f.flags.length > 0 ? ` · ${f.flags.join("; ")}` : "";
    return `  ${f.title}${sku} · ${f.price.toFixed(2)} (era ${f.compareAtPrice.toFixed(2)}, -${(f.discountPct * 100).toFixed(0)}%)${flagsStr}`;
  };

  const header = typeof args.tag === "string"
    ? `Auditoria de promos · escopo tag:${args.tag}`
    : `Auditoria de promos · todos os produtos ativos`;

  const sections: string[] = [header, ""];

  if (violations.length > 0) {
    sections.push(
      `🚩 ${violations.length} VIOLAÇÃO(ÕES) (revise urgentemente):`,
    );
    sections.push(...violations.map(formatFinding));
    sections.push("");
  }

  sections.push(`${normalPromos.length} promoção(ões) regular(es):`);
  sections.push(...normalPromos.slice(0, 50).map(formatFinding));
  if (normalPromos.length > 50) {
    sections.push(`  (+${normalPromos.length - 50} outras não listadas)`);
  }

  return { content: [{ type: "text", text: sections.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_audit_markdowns",
  description:
    "Auditoria: lista produtos Shopify atualmente em promoção (price < compareAtPrice), flagrando violações como produtos com a tag 'lancto' (que deveriam estar fora de campanhas) e descontos deep (>50%). Opcionalmente filtra por uma tag de campanha.",
  inputSchema: {
    tag: z
      .string()
      .optional()
      .describe(
        "Opcional: filtra por uma tag de campanha específica (ex. 'BEAUTYBACK'). Sem tag, audita todos os produtos ativos.",
      ),
  },
  handler: auditMarkdownsHandler,
});
