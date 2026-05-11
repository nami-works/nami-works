import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import {
  loadBakedVocabularies,
  refreshVocabulariesFromLive,
} from "../../services/shopify/pdp/vocab.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

export async function pdpListControlledVocabulariesHandler(
  args: { refresh?: boolean | undefined; sampleSize?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const vocab = loadBakedVocabularies();

  const lines: string[] = [];
  lines.push(
    `PDP controlled vocabularies for tenant ${ctx.tenant.slug} (baked-in source)`,
  );
  lines.push(``);
  lines.push(`Product types (${vocab.productTypes.size}): ${[...vocab.productTypes].join(", ")}`);
  lines.push(``);
  lines.push(`Tag allowlist (${vocab.tagAllowlist.size}):`);
  lines.push(`  ${[...vocab.tagAllowlist].sort().join(", ")}`);
  lines.push(``);
  lines.push(`Required tag categories:`);
  for (const cat of vocab.tagCategoriesRequired) {
    lines.push(`  • ${cat.category}: at least one of [${cat.members.join(", ")}]`);
  }
  lines.push(``);
  lines.push(`custom.tipo_de_cabelo choices: ${[...vocab.tipoDeCabelo].join(" | ")}`);
  lines.push(`custom.necessidade choices:    ${[...vocab.necessidade].join(" | ")}`);
  lines.push(`custom.finalizacao choices:    ${[...vocab.finalizacao].join(" | ")}`);
  lines.push(``);
  lines.push(`Google product category (brand-used): ${[...vocab.googleProductCategory].join(", ")}`);

  if (args.refresh) {
    lines.push(``);
    lines.push(`--- live drift report (sampling recent products) ---`);
    const client = await getShopifyClient({
      ssmPrefix: ctx.tenant.ssmPrefix,
      shopifyShop: ctx.tenant.shopifyShop ?? "",
    });
    const drift = await refreshVocabulariesFromLive({
      client,
      ...(args.sampleSize !== undefined ? { sampleSize: args.sampleSize } : {}),
    });
    lines.push(`Sampled ${drift.sampleSize} most-recently-updated products.`);
    lines.push(``);
    if (drift.unknownLiveTags.length > 0) {
      lines.push(`⚠️  Tags found on live products but NOT in allowlist (${drift.unknownLiveTags.length}):`);
      for (const t of drift.unknownLiveTags) lines.push(`  - ${t}`);
      lines.push(`  → To accept, add to src/services/shopify/pdp/vocab.gebeauty.ts and PR.`);
    } else {
      lines.push(`✓ No unknown tags live.`);
    }
    lines.push(``);
    if (drift.unusedAllowlistTags.length > 0) {
      lines.push(`Allowlist tags NOT seen on any sampled product (${drift.unusedAllowlistTags.length}):`);
      for (const t of drift.unusedAllowlistTags) lines.push(`  - ${t}`);
      lines.push(`  → Either stale or simply not in the recent sample.`);
    }
    lines.push(``);
    if (drift.unknownProductTypes.length > 0) {
      lines.push(`⚠️  Product types live but not enumerated: ${drift.unknownProductTypes.join(", ")}`);
    } else {
      lines.push(`✓ All live product types are enumerated.`);
    }
  } else {
    lines.push(``);
    lines.push(`Pass refresh=true to compare baked allowlist against live store and report drift.`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_pdp_list_controlled_vocabularies",
  description:
    "Returns the controlled vocabularies the PDP cloning tool enforces (tag allowlist, productType enum, closed-choice metafield values, Google category). Pass refresh=true to also compare against live Shopify data and report drift — tags on live products missing from the allowlist (or vice versa).",
  inputSchema: {
    refresh: z
      .boolean()
      .optional()
      .describe("If true, sample recent products and report drift against the baked allowlist."),
    sampleSize: z
      .number()
      .int()
      .min(10)
      .max(250)
      .optional()
      .describe("How many recent products to sample when refresh=true. Default 100."),
  },
  handler: pdpListControlledVocabulariesHandler,
});
