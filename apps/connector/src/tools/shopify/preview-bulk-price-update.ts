import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query PreviewBulkPrice($query: String!) {
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

type PreviewResponse = {
  products: { edges: Array<{ node: ProductNode }> };
};

type Mode = "set" | "markdown_pct" | "markdown_brl";

export async function previewBulkPriceUpdateHandler(
  args: {
    tag: string;
    mode: Mode;
    value: number;
    preserveCompareAtPrice?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const tag = args.tag.trim();
  if (tag.length === 0) {
    return {
      content: [{ type: "text", text: "tag é obrigatório." }],
      isError: true,
    };
  }
  if (!["set", "markdown_pct", "markdown_brl"].includes(args.mode)) {
    return {
      content: [
        {
          type: "text",
          text: "mode deve ser 'set', 'markdown_pct' ou 'markdown_brl'.",
        },
      ],
      isError: true,
    };
  }
  if (args.mode === "markdown_pct" && (args.value <= 0 || args.value >= 1)) {
    return {
      content: [
        {
          type: "text",
          text: "Para markdown_pct, value deve ser > 0 e < 1 (ex: 0.20 = 20% off).",
        },
      ],
      isError: true,
    };
  }

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const res = await client.request<PreviewResponse>(QUERY, {
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
          text: `Nenhum produto encontrado com a tag "${tag}". Nada seria alterado.`,
        },
      ],
    };
  }

  type PreviewRow = {
    title: string;
    sku: string | null;
    currentPrice: number;
    currentCompare: number | null;
    newPrice: number;
    newCompare: number | null;
    delta: number;
  };

  const rows: PreviewRow[] = [];
  for (const p of products) {
    for (const v of p.variants.edges.map((e) => e.node)) {
      const currentPrice = Number(v.price);
      const currentCompare = v.compareAtPrice ? Number(v.compareAtPrice) : null;

      let newPrice: number;
      if (args.mode === "set") newPrice = args.value;
      else if (args.mode === "markdown_pct")
        newPrice = Math.round(currentPrice * (1 - args.value) * 100) / 100;
      else newPrice = Math.max(0, currentPrice - args.value);

      if (newPrice === currentPrice) continue; // no change

      // compareAtPrice strategy: if user is pushing DOWN and there's no
      // compareAtPrice today, set it to the current price (so the markdown
      // is visible as "was X now Y"). If there IS one, leave it alone unless
      // preserveCompareAtPrice=false.
      let newCompare: number | null = currentCompare;
      if (args.preserveCompareAtPrice !== false && currentCompare === null && newPrice < currentPrice) {
        newCompare = currentPrice;
      }

      rows.push({
        title: p.title,
        sku: v.sku,
        currentPrice,
        currentCompare,
        newPrice,
        newCompare,
        delta: newPrice - currentPrice,
      });
    }
  }

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhuma mudança seria aplicada. Todos os variantes com a tag "${tag}" já estão no preço alvo.`,
        },
      ],
    };
  }

  const totalDown = rows
    .filter((r) => r.delta < 0)
    .reduce((sum, r) => sum + -r.delta, 0);
  const totalUp = rows
    .filter((r) => r.delta > 0)
    .reduce((sum, r) => sum + r.delta, 0);

  const header = [
    `Preview · campanha tag:${tag} · modo ${args.mode} · valor ${args.value}`,
    `${rows.length} variante(s) afetada(s) entre ${products.length} produto(s).`,
    `Preço médio: -R$ ${(totalDown / rows.length).toFixed(2)} ↓ · +R$ ${(totalUp / rows.length || 0).toFixed(2)} ↑`,
    ``,
    `⚠ Este é um preview. Nenhuma mudança foi aplicada. Para executar, use shopify_update_product_price por variante (write é gated por confirm).`,
    ``,
  ].join("\n");

  const lines = rows.slice(0, 50).map((r) => {
    const deltaStr = r.delta < 0 ? `${r.delta.toFixed(2)}` : `+${r.delta.toFixed(2)}`;
    const sku = r.sku ? ` [${r.sku}]` : "";
    const compare = r.newCompare !== null ? ` (compare ${r.newCompare.toFixed(2)})` : "";
    return `  ${r.title}${sku} · ${r.currentPrice.toFixed(2)} → ${r.newPrice.toFixed(2)} (${deltaStr})${compare}`;
  });

  const truncated = rows.length > 50 ? `\n  (+${rows.length - 50} outros)` : "";

  return {
    content: [
      { type: "text", text: `${header}${lines.join("\n")}${truncated}` },
    ],
  };
}

registerToolDefinition({
  name: "shopify_preview_bulk_price_update",
  description:
    "Preview de uma atualização de preço em lote por tag, SEM aplicar mudanças. Mostra exatamente quais variantes mudariam e em quanto. Modos: 'set' (preço absoluto), 'markdown_pct' (desconto percentual 0-1), 'markdown_brl' (desconto em R$).",
  inputSchema: {
    tag: z
      .string()
      .min(1)
      .describe("Tag da campanha. Case-sensitive. Ex: 'BEAUTYBACK'."),
    mode: z
      .enum(["set", "markdown_pct", "markdown_brl"])
      .describe("Estratégia de preço: set / markdown_pct / markdown_brl."),
    value: z
      .number()
      .describe(
        "Para 'set': preço absoluto (ex: 79.90). Para 'markdown_pct': 0-1 (0.20 = 20% off). Para 'markdown_brl': valor em R$ a descontar.",
      ),
    preserveCompareAtPrice: z
      .boolean()
      .optional()
      .describe(
        "Default true: mantém compareAtPrice existente e, se o preço está descendo e não há compareAtPrice, define como o preço atual (para mostrar como promo). Passe false para nunca tocar compareAtPrice.",
      ),
  },
  handler: previewBulkPriceUpdateHandler,
});
