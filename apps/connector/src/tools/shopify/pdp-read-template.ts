import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { readPDPTemplate } from "../../services/shopify/pdp/pdp-template.js";
import { EXPECTED_PRODUCT_METAFIELD_SLOTS } from "../../services/shopify/pdp/types.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

export async function pdpReadTemplateHandler(
  args: { productId: string; format?: "summary" | "json" | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!args.productId.startsWith("gid://shopify/Product/")) {
    return {
      content: [
        {
          type: "text",
          text: `productId must be a Shopify product GID (gid://shopify/Product/<numeric>). Got: ${args.productId}`,
        },
      ],
      isError: true,
    };
  }

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const template = await readPDPTemplate(args.productId, client);
  const format = args.format ?? "summary";

  if (format === "json") {
    return {
      content: [
        { type: "text", text: JSON.stringify(template, null, 2) },
      ],
    };
  }

  const lines: string[] = [];
  lines.push(
    `PDP template — "${template.core.title}" (${template.core.handle})`,
  );
  lines.push(`Status: ${template.core.status} · Type: ${template.core.productType} · Vendor: ${template.core.vendor}`);
  lines.push(`Tags (${template.core.tags.length}): ${template.core.tags.join(", ")}`);
  lines.push(`SEO title: ${template.core.seo.title ?? "(none)"}`);
  lines.push(`SEO desc:  ${template.core.seo.description ?? "(none)"}`);
  lines.push(`Variants: ${template.variants.length}`);
  for (const v of template.variants) {
    const weight = v.weightKg ? ` · ${v.weightKg.toFixed(3)}kg` : "";
    const cmp = v.compareAtPrice ? ` (de ${v.compareAtPrice})` : "";
    lines.push(`  • ${v.title} · SKU ${v.sku ?? "?"} · R$ ${v.price}${cmp}${weight}`);
  }

  lines.push(``);
  lines.push(`Media (${template.media.length} items):`);
  for (const m of template.media) {
    lines.push(`  ${m.position + 1}. [${m.mediaType}] [slot: ${m.inferredSlot}] ${m.altText || "(no alt)"}`);
  }

  lines.push(``);
  lines.push(
    `Metafield slots: ${template.presentSlots.length}/${EXPECTED_PRODUCT_METAFIELD_SLOTS.length} populated`,
  );
  if (template.missingSlots.length > 0) {
    lines.push(`Missing (${template.missingSlots.length}):`);
    for (const s of template.missingSlots) lines.push(`  - ${s}`);
  }

  lines.push(``);
  lines.push(`Embedded metaobjects:`);
  lines.push(
    `  descricao_longa:  ${template.embedded.descricao_longa ? `✓ ${template.embedded.descricao_longa.handle}` : "✗ missing"}`,
  );
  lines.push(
    `  antes_e_depois:   ${template.embedded.antes_e_depois ? `✓ ${template.embedded.antes_e_depois.handle}` : "✗ missing"}`,
  );
  lines.push(
    `  ai_readiness:     ${template.embedded.ai_readiness ? `✓ ${template.embedded.ai_readiness.handle}` : "✗ missing"}`,
  );
  lines.push(`  item_faq:         ${template.embedded.item_faq.length} entries`);

  lines.push(``);
  lines.push(`Shared metaobject refs:`);
  lines.push(
    `  etiquetas:             ${template.shared.etiquetas.map((m) => m.handle).join(", ") || "(none)"}`,
  );
  lines.push(
    `  shopify.hair-type:     ${template.shared.shopify_hair_type.map((m) => m.handle).join(", ") || "(none)"}`,
  );
  lines.push(
    `  shopify.product-form:  ${template.shared.shopify_product_form.map((m) => m.handle).join(", ") || "(none)"}`,
  );
  lines.push(
    `  shopify.target-gender: ${template.shared.shopify_target_gender.map((m) => m.handle).join(", ") || "(none)"}`,
  );

  lines.push(``);
  lines.push(`Collections (${template.collections.length}): ${template.collections.map((c) => c.handle).join(", ")}`);

  lines.push(``);
  lines.push(`scrapedAt: ${template.scrapedAt}`);
  lines.push(
    `Pass format="json" to get the full structured PDPTemplate JSON for downstream tools.`,
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_pdp_read_template",
  description:
    "Reads a reference Shopify product into the canonical PDPTemplate shape: core scalars, variants, media gallery, every expected metafield slot, embedded metaobjects (descricao_longa, antes_e_depois, item_faq, ai_readiness), and shared metaobject refs. Use to inspect a gold-standard PDP before cloning, or to extract the template a candidate must match.",
  inputSchema: {
    productId: z
      .string()
      .min(1)
      .describe("Full product GID, e.g. gid://shopify/Product/9668674879808"),
    format: z
      .enum(["summary", "json"])
      .optional()
      .describe("'summary' (default) returns a readable report. 'json' returns the full PDPTemplate JSON."),
  },
  handler: pdpReadTemplateHandler,
});
