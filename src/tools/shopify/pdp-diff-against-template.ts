import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { readPDPTemplate } from "../../services/shopify/pdp/pdp-template.js";
import { diffPDPTemplates } from "../../services/shopify/pdp/diff.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

export async function pdpDiffAgainstTemplateHandler(
  args: { templateProductId: string; candidateProductId: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  for (const [field, val] of [
    ["templateProductId", args.templateProductId],
    ["candidateProductId", args.candidateProductId],
  ] as const) {
    if (!val.startsWith("gid://shopify/Product/")) {
      return {
        content: [
          {
            type: "text",
            text: `${field} must be a Shopify product GID (gid://shopify/Product/<numeric>). Got: ${val}`,
          },
        ],
        isError: true,
      };
    }
  }

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const [reference, candidate] = await Promise.all([
    readPDPTemplate(args.templateProductId, client),
    readPDPTemplate(args.candidateProductId, client),
  ]);

  const diff = diffPDPTemplates(reference, candidate);

  const lines: string[] = [];
  lines.push(
    `PDP diff — reference="${reference.core.title}" (${reference.core.handle})`,
  );
  lines.push(
    `         vs candidate="${candidate.core.title}" (${candidate.core.handle})`,
  );
  lines.push(``);

  const total = diff.slots.length;
  lines.push(
    `Slot coverage: ${diff.summary.okCount}/${total} matched · ${diff.summary.missingInCandidate.length} missing · ${diff.summary.extraInCandidate.length} extra · ${diff.summary.typeMismatches.length} type-mismatched`,
  );
  lines.push(``);

  if (diff.summary.missingInCandidate.length > 0) {
    lines.push(`Missing on candidate (reference has, candidate doesn't):`);
    for (const s of diff.summary.missingInCandidate) lines.push(`  - ${s}`);
    lines.push(``);
  }
  if (diff.summary.extraInCandidate.length > 0) {
    lines.push(`Extra on candidate (candidate has, reference doesn't):`);
    for (const s of diff.summary.extraInCandidate) lines.push(`  + ${s}`);
    lines.push(``);
  }
  if (diff.summary.typeMismatches.length > 0) {
    lines.push(`Type mismatches:`);
    for (const s of diff.summary.typeMismatches) {
      const detail = diff.slots.find((x) => x.slot === s);
      lines.push(`  ! ${s} — ${detail?.notes ?? "details unavailable"}`);
    }
    lines.push(``);
  }

  lines.push(`Core comparison:`);
  lines.push(`  productType: ${diff.coreCompare.productTypeMatch ? "✓ match" : `✗ reference="${reference.core.productType}" vs candidate="${candidate.core.productType}"`}`);
  lines.push(`  status:      ${diff.coreCompare.statusMatch ? "✓ match" : `reference=${reference.core.status} vs candidate=${candidate.core.status}`}`);
  if (diff.coreCompare.tagsMissingInCandidate.length > 0) {
    lines.push(`  tags missing on candidate: ${diff.coreCompare.tagsMissingInCandidate.join(", ")}`);
  }
  if (diff.coreCompare.tagsExtraInCandidate.length > 0) {
    lines.push(`  tags extra on candidate:   ${diff.coreCompare.tagsExtraInCandidate.join(", ")}`);
  }
  lines.push(``);

  lines.push(`Media role coverage:`);
  lines.push(`  reference roles: ${diff.mediaCompare.referenceRoles.join(", ") || "(none inferred)"}`);
  lines.push(`  candidate roles: ${diff.mediaCompare.candidateRoles.join(", ") || "(none inferred)"}`);
  if (diff.mediaCompare.rolesMissingInCandidate.length > 0) {
    lines.push(`  roles missing on candidate: ${diff.mediaCompare.rolesMissingInCandidate.join(", ")}`);
  }
  lines.push(``);

  const ec = diff.embeddedCompare;
  lines.push(`Embedded metaobjects:`);
  lines.push(`  descricao_longa:  reference=${ec.descricaoLongaPresent.reference ? "✓" : "✗"} candidate=${ec.descricaoLongaPresent.candidate ? "✓" : "✗"}`);
  lines.push(`  antes_e_depois:   reference=${ec.antesDepoisPresent.reference ? "✓" : "✗"} candidate=${ec.antesDepoisPresent.candidate ? "✓" : "✗"}`);
  lines.push(`  ai_readiness:     reference=${ec.aiReadinessPresent.reference ? "✓" : "✗"} candidate=${ec.aiReadinessPresent.candidate ? "✓" : "✗"}`);
  lines.push(`  item_faq count:   reference=${ec.faqCount.reference} candidate=${ec.faqCount.candidate}`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_pdp_diff_against_template",
  description:
    "Compares an existing product against a reference PDP template product. Reports which expected metafield slots are missing, extra, or type-mismatched; tag drift; missing image roles; embedded metaobject completeness. Use to audit hand-crafted products or to verify a cloned product matches the gold standard.",
  inputSchema: {
    templateProductId: z
      .string()
      .min(1)
      .describe("Gold-standard reference product GID."),
    candidateProductId: z
      .string()
      .min(1)
      .describe("Candidate product GID to audit against the reference."),
  },
  handler: pdpDiffAgainstTemplateHandler,
});
