import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * Given a campaign tag + the claimed discount percentage, validates that
 * every tagged product's price actually equals compareAtPrice x (1 - pct).
 * Distinct from shopify_audit_campaign_consistency (which only checks
 * whether products are UNIFORMLY discounted or not, not whether the math
 * is right). Catches the specific post-campaign drift where compareAtPrice
 * stays lifted after a sale ends, or price was hand-edited without
 * recomputing compareAtPrice to match.
 */

const QUERY = /* GraphQL */ `
  query CampaignPriceAlignment($query: String!, $cursor: String) {
    products(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          variants(first: 25) {
            edges {
              node { id title sku price compareAtPrice }
            }
          }
        }
      }
    }
  }
`;

type VariantNode = { id: string; title: string; sku: string | null; price: string; compareAtPrice: string | null };
type ProductNode = { id: string; title: string; variants: { edges: Array<{ node: VariantNode }> } };
type Response = {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: ProductNode }> };
};

export async function verifyCampaignPriceAlignmentHandler(
  args: { campaignTag: string; discountPercent: number; tolerance?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const tag = args.campaignTag.trim();
  if (tag.length === 0) {
    return { content: [{ type: "text", text: "campaignTag is required." }], isError: true };
  }
  if (args.discountPercent <= 0 || args.discountPercent >= 1) {
    return {
      content: [{ type: "text", text: "discountPercent must be a fraction between 0 and 1 (e.g. 0.20 for 20%)." }],
      isError: true,
    };
  }
  const tolerance = args.tolerance ?? 0.01; // R$0.01 default — rounding slack, not a real mismatch

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const products: ProductNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const res: { data?: Response; errors?: { message?: string } } = await client.request<Response>(QUERY, {
      variables: { query: `tag:${tag}`, cursor },
    });
    if (res.errors) throw new Error(`Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`);
    const conn = res.data?.products;
    if (!conn) break;
    products.push(...conn.edges.map((e) => e.node));
    hasNextPage = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }

  if (products.length === 0) {
    return { content: [{ type: "text", text: `No products found with tag "${tag}".` }] };
  }

  const missing: string[] = [];
  const mismatched: string[] = [];
  let aligned = 0;

  for (const p of products) {
    for (const { node: v } of p.variants.edges) {
      const price = Number(v.price);
      const compareAt = v.compareAtPrice ? Number(v.compareAtPrice) : null;
      const label = `${p.title}${v.title !== "Default Title" ? ` (${v.title})` : ""}${v.sku ? ` [${v.sku}]` : ""}`;

      if (compareAt === null || compareAt <= price) {
        missing.push(`${label} · price ${price.toFixed(2)}, no valid compareAtPrice`);
        continue;
      }
      const expectedPrice = compareAt * (1 - args.discountPercent);
      if (Math.abs(price - expectedPrice) > tolerance) {
        mismatched.push(
          `${label} · price ${price.toFixed(2)}, compareAt ${compareAt.toFixed(2)} → expected ${expectedPrice.toFixed(2)} at ${(args.discountPercent * 100).toFixed(0)}%`,
        );
        continue;
      }
      aligned++;
    }
  }

  if (missing.length === 0 && mismatched.length === 0) {
    return {
      content: [
        { type: "text", text: `✓ Campaign "${tag}" at ${(args.discountPercent * 100).toFixed(0)}% off: all ${aligned} variant(s) aligned.` },
      ],
    };
  }

  const lines = [
    `Campaign "${tag}" at ${(args.discountPercent * 100).toFixed(0)}% off: ${aligned} aligned, ${mismatched.length} price mismatch(es), ${missing.length} missing/invalid compareAtPrice.`,
    ``,
  ];
  if (mismatched.length > 0) {
    lines.push(`Price doesn't match the claimed discount (${mismatched.length}):`);
    lines.push(...mismatched.slice(0, 30).map((m) => `  • ${m}`));
    if (mismatched.length > 30) lines.push(`  (+${mismatched.length - 30} more)`);
    lines.push(``);
  }
  if (missing.length > 0) {
    lines.push(`No discount applied at all (${missing.length}):`);
    lines.push(...missing.slice(0, 30).map((m) => `  • ${m}`));
    if (missing.length > 30) lines.push(`  (+${missing.length - 30} more)`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}

registerToolDefinition({
  name: "shopify_verify_campaign_price_alignment",
  description:
    "Given a campaign tag and the claimed discount percentage, verifies every tagged variant's price actually equals compareAtPrice x (1 - percent). Catches post-campaign drift where compareAtPrice stays lifted, or price was hand-edited without recomputing compareAtPrice. Complements shopify_audit_campaign_consistency (which only checks uniform participation, not the math). Read-only, no confirm needed.",
  inputSchema: {
    campaignTag: z.string().min(1).describe("The tag marking products in this campaign."),
    discountPercent: z.number().gt(0).lt(1).describe("Claimed discount as a fraction, e.g. 0.20 for 20% off."),
    tolerance: z.number().optional().describe("R$ slack for rounding before flagging a mismatch. Defaults to 0.01."),
  },
  handler: verifyCampaignPriceAlignmentHandler,
});
