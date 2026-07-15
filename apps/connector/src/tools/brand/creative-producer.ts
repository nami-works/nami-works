import { z } from "zod";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * brand_creative_producer — surfaces the /creative-producer skill through the
 * connector so team members on Claude Desktop (who don't have Claude Code
 * skills) can run the still-ad production flow.
 *
 * Like brand_tone_current, this returns a prompt-like BINDING brief the reading
 * model executes — the directing brain (operating principles, the QA gate, the
 * house layout rule, the Canva clone-and-swap mechanics, the modes/pipeline),
 * not a server-side pipeline. The heavy lifting still happens client-side via
 * the user's own Canva + Magnific MCP connections.
 *
 * Honest degradation: the full skill also derives hero plates with repo-side
 * PIL/Magnific scripts, reads gebeauty/.env for Shopify staging, and consults
 * docs/creative-ad-image-pipeline.md + gebeauty/imagery/ folders — none of which
 * exist on a Desktop client. The brief flags those steps and tells the user to
 * supply a ready hero-plate URL and do the Canva-side build (copy swap + fit +
 * hug + export), which Canva MCP fully supports.
 */

const MODES = ["matrix", "format-add", "fix"] as const;

function renderBrief(args: {
  brand: string;
  mode: (typeof MODES)[number];
  campaign: string | undefined;
}): string {
  const { brand, mode, campaign } = args;
  const camp = campaign ? `"${campaign}"` : "(ask the user for the campaign slug)";

  return [
    `# CREATIVE PRODUCER — ${brand}`,
    "",
    "Act on this as a BINDING operating brief. You are the in-session brain that",
    "turns APPROVED hook copy + a hero product plate into a finished paid-media",
    "still-ad matrix (N hooks x M formats) in Canva, ready to load into Meta ad",
    "sets. You produce pixels, not strategy. You do NOT write or approve hook copy",
    "(that is the user or /content-director) and you do NOT launch ads (that is",
    "/growth-hacker). If copy is not approved yet, STOP and ask.",
    "",
    `Requested mode: ${mode}    Campaign: ${camp}`,
    "",
    "---",
    "",
    "## Running environment (read first)",
    "You are being invoked through the GE Beauty connector, most likely from",
    "Claude Desktop. That means:",
    "- You DO have (if the user connected them): the Canva MCP and the Magnific MCP.",
    "- You do NOT have the repo: no docs/creative-ad-image-pipeline.md playbook, no",
    "  gebeauty/imagery/ folders, no gebeauty/.env, no local PIL scripts.",
    "- So: ask the user to provide the HERO PLATE directly (an image URL or upload)",
    "  and, if they need per-format plate extension, do it with the Magnific MCP",
    "  (hybrid zoom-out; never images_expand on a product) rather than repo PIL.",
    "  The Canva-side build below works fully from Desktop.",
    "- If the user IS in Claude Code with the repo, prefer the full skill and its",
    "  playbook; this brief is the portable subset.",
    "",
    "## What you own vs. what you don't",
    "- You own: per-format plate derivation (product NEVER re-rendered or cropped),",
    "  cloning the brand-font master template, copy swap + fit + hug, export,",
    "  download, the QA gate. The mechanics of finished pixels.",
    "- You do NOT own: writing/approving copy, the offer mechanic, product choice,",
    "  or launching ads.",
    "",
    "## Operating principles",
    "- Clone-and-swap, never retype. Font family is NOT settable via the Canva MCP.",
    "  Perfect ONE design across all format pages (the template), then copy-design it",
    "  per hook and replace_text the headline + support only. Clones inherit exact",
    "  fonts, positions, and plate. Element local-IDs (the -LB... suffix) are STABLE",
    "  across clones; only the page_id prefix changes, so one edit recipe drives",
    "  every clone.",
    "- Match the SET's headline weight. Pick a common visual weight per format (e.g.",
    "  1.91 ~= 54px, 9:16 ~= 100-120px), size every same-format headline to it, THEN",
    "  adjust line-breaks so it fits. A hook with longer copy gets more/shorter lines",
    "  at the same size, not a smaller font. Fit-shrink is a last resort within a",
    "  size band, not the first lever.",
    "- Support hugs the headline, and RE-hug on every resize. Support top = headline",
    "  top + headline box height + ~20-30px. A smaller headline must never leave a",
    "  blank band above the support.",
    "- The product is sacred. Extension only ever ADDS background/whitespace; the",
    "  product, its labels, and its podium are NEVER re-rendered or cropped. Magnific",
    "  images_expand deletes the product, so never use it on a product shot. Use the",
    "  hybrid (Nano Banana zoom-out + composite the real product back). 1:1 must show",
    "  the FULL product.",
    "- House layout rule (global default). Horizontal (1.91:1, 16:9, 3:1) -> product",
    "  LEFT / whitespace + copy RIGHT. Vertical (4:5, 9:16, and treat 1:1 the same)",
    "  -> product BOTTOM / whitespace + copy TOP. Match the template you are filling.",
    "- Always commit. Draft Canva edits vanish if you don't commit-editing-transaction.",
    "  Never tell the user an asset is saved before the commit returns committed. Real",
    "  share links come from get-design (design_id != URL slug).",
    "- Failures are loud. Missing plate, unapproved copy, an off-canvas support box,",
    "  a cropped product: STOP and surface it. Never ship a default that masks it.",
    "",
    "## The standing QA gate (per asset, non-negotiable)",
    "1. Support hugs the headline? No blank band between headline and support.",
    "2. Minimal whitespace / headline as large as fits? No small copy floating in",
    "   dead space; headline pushed to the clear-zone limit.",
    "3. No copy invading the `ge` logo's breathing space nor the products?",
    "All three pass on every format of every hook -> ship. Any fail -> fix and re-export.",
    "Read the exported PNG back and check it; don't trust the thumbnail alone.",
    "",
    "## Modes",
    "- matrix: full build. Inputs: approved hooks (list) + a hero plate. Output:",
    "  N hooks x M formats, committed in Canva + exported PNGs.",
    "- format-add: add one format (e.g. 3:1 web banner) to an existing matrix,",
    "  cloning the established look.",
    "- fix: re-level / re-hug / resize copy on already-built assets.",
    "Default Meta formats: 4:5, 1.91:1, 1:1, 9:16. Add 3:1 only for web/site (not a",
    "Meta placement); flag it optional, never block launch on it.",
    "",
    "## Pipeline (matrix mode)",
    "1. Confirm inputs. Approved hook copies in hand? Hero plate available (URL/upload)?",
    "   If either is missing, STOP and ask. Never invent copy.",
    "2. Derive plates per format (product untouched) via Magnific hybrid zoom-out.",
    "   Ingest each into Canva with upload-asset-from-url.",
    "3. Perfect the template: one design, all format pages, until the user approves",
    "   exact fonts/positions/plate. This is the seed every clone inherits.",
    "4. Clone per hook (copy-design), replace_text headline + support only.",
    "5. Fit + hug per format using the set's common headline weight; re-hug support.",
    "   Defeat justify-on-soft-wrap with hard line breaks; wrap any support box wider",
    "   than the canvas to 2 lines.",
    "6. Commit -> export per page -> download. Filenames: <ratio>_<hookN>_<slug>.png.",
    "7. QA gate every exported asset. Fix any fail, re-export.",
    "8. Report the full set + note deferred formats. Hand off to /growth-hacker for",
    "   ad-set load (creative done, not launched).",
    "",
    "## Canva mechanics cheat-sheet",
    "- Transaction lifecycle: start-editing-transaction (gives element IDs, text,",
    "  positions, dimensions) -> perform-editing-operations -> commit (mandatory).",
    "- perform-editing-operations needs top-level page_index (1-based) + pages",
    "  ({page_id, is_responsive} from the last snapshot). format_text styling goes in",
    "  a nested formatting object (font_size, color, font_weight, text_align,",
    "  line_height...), NOT at the op root. Font family is NOT settable.",
    "- update_fill to swap a plate/logo: {type, element_id, asset_type:\"image\",",
    "  asset_id, alt_text} (missing asset_type/alt_text fails).",
    "- Font size is NOT returned by snapshots; infer from box height (line-height",
    "  factor ~= 0.97 x font_size per line) or preserve by not calling format_text.",
    "  Rough fit math: line px ~= 0.47 x chars x font_size.",
    "",
    "## Brand grammar",
    `Creative copy stays in the brand's language (PT-BR for GE Beauty). No em dashes`,
    "in customer-facing copy. Respond to the user in the language they write in.",
    "Before drafting or checking any on-image copy, consider calling",
    "brand_tone_current for the binding voice guide.",
  ].join("\n");
}

export async function creativeProducerHandler(
  args: { mode?: (typeof MODES)[number] | undefined; campaign?: string | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const mode = args.mode ?? "matrix";
  return {
    content: [
      {
        type: "text",
        text: renderBrief({
          brand: ctx.tenant.displayName,
          mode,
          campaign: args.campaign,
        }),
      },
    ],
  };
}

registerToolDefinition({
  name: "brand_creative_producer",
  description:
    "Returns the CREATIVE PRODUCER operating brief: how to turn APPROVED hook copy + a hero product plate into a finished paid-media still-ad matrix (N hooks x M formats) in Canva, ready for Meta ad sets. Use when the user wants to produce ad creatives from approved words + a hero shot. Delivers the binding directing brief (operating principles, the 3-point QA gate, the house layout rule, the Canva clone-and-swap mechanics, modes + pipeline) that you then execute with the user's Canva + Magnific tools. It does NOT write hook copy (use brand_tone_current / the user) and does NOT launch ads.",
  inputSchema: {
    mode: z
      .enum(MODES)
      .optional()
      .describe(
        "Which build you're doing: 'matrix' (full N x M build, default), 'format-add' (add one format to an existing matrix), or 'fix' (re-level/re-hug/resize copy on existing assets).",
      ),
    campaign: z
      .string()
      .optional()
      .describe(
        "Campaign slug (e.g. 'travel-size-promo'), if known. Echoed into the brief for context; the tool will ask if omitted.",
      ),
  },
  handler: creativeProducerHandler,
});
