import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import {
  SUPPORTED_CLIENTS,
  generateMarketplaceRegistry,
  toCsv,
  type SupportedClient,
} from "../../services/shopify/marketplace-registry.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

export async function generateMarketplaceRegistryHandler(
  args: { client: SupportedClient; format?: "summary" | "csv" | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const result = await generateMarketplaceRegistry(args.client, client);
  const format = args.format ?? "summary";

  if (format === "csv") {
    return { content: [{ type: "text", text: toCsv(result) }] };
  }

  const lines: string[] = [];
  lines.push(`Marketplace registry — ${result.client} (${result.rows.length} rows, ${result.columns.length} columns)`);
  lines.push(``);

  if (result.criticalGaps.length === 0) {
    lines.push(`No critical gaps — every row has EAN, dimensions, cost basis, and Anvisa process filled.`);
  } else {
    lines.push(`Critical gaps (${result.criticalGaps.length} row(s)):`);
    for (const g of result.criticalGaps) {
      lines.push(`  • ${g.sku} (${g.name}): ${g.columns.join(", ")}`);
    }
  }

  const nonCritical = Object.entries(result.gapsByColumn).sort((a, b) => b[1] - a[1]);
  if (nonCritical.length > 0) {
    lines.push(``);
    lines.push(`Pending fields by column (across all rows):`);
    for (const [col, count] of nonCritical) {
      lines.push(`  ${String(count).padStart(3)}x  ${col}`);
    }
  }

  lines.push(``);
  lines.push(`Call again with format: "csv" to get the full export.`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_generate_marketplace_registry",
  description:
    "Generate a marketplace/perfumaria product-registration export (e.g. Sephora's CADASTROS template) from GE Beauty's canonical catalog + live Shopify data. Fills every field that's automatable (EAN, dimensions, NCM, images, descriptions) and leaves genuinely external fields (B2B pricing, Anvisa registration, buyer-assigned codes) marked [PENDENTE] rather than guessing — see gebeauty/b2b/marketplace-registry-field-mapping.md for which fields need which human owner. Read-only, no store writes. format: summary (default) shows a gap report; csv returns the full export ready to paste into the registry spreadsheet.",
  inputSchema: {
    client: z
      .enum(SUPPORTED_CLIENTS)
      .describe("Which marketplace/perfumaria registry to generate."),
    format: z
      .enum(["summary", "csv"])
      .optional()
      .describe("summary (default): gap report. csv: full export."),
  },
  handler: generateMarketplaceRegistryHandler,
});
