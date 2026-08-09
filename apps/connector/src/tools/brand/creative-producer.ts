import { z } from "zod";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";
import { SERVED_SKILLS } from "../../generated/served-skills.js";

/**
 * brand_creative_producer — serves the FULL /creative-producer skill through the
 * connector: the SKILL.md operating brief PLUS the canonical
 * creative-ad-image-pipeline playbook, so team members without repo access get
 * the complete directing knowledge, not a hand-written digest.
 *
 * The content is bundled at build time from the canonical `.claude/skills/**` +
 * `docs/**` sources (see apps/connector/scripts/bundle-skills.mjs) into
 * `src/generated/served-skills.ts`, because those sources sit outside the Docker
 * build context (.dockerignore excludes `.claude` and `docs`). A connector
 * rebuild re-bakes the current copy — source of truth stays the repo skill.
 *
 * Like brand_tone_current, this returns a prompt-like BINDING brief the reading
 * model executes with the user's OWN Canva + Magnific MCP connections — the
 * connector delivers the knowledge, not the pixels.
 */

const MODES = ["matrix", "format-add", "fix"] as const;

export async function creativeProducerHandler(
  args: {
    mode?: (typeof MODES)[number] | undefined;
    campaign?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const skill = SERVED_SKILLS["creative-producer"];
  if (!skill) {
    return {
      content: [
        {
          type: "text",
          text:
            "The creative-producer skill content isn't bundled in this connector build. " +
            "Ask an admin to run `node apps/connector/scripts/bundle-skills.mjs` and redeploy.",
        },
      ],
      isError: true,
    };
  }

  const mode = args.mode ?? "matrix";
  const header =
    `# CREATIVE PRODUCER — ${ctx.tenant.displayName}\n` +
    `Mode: ${mode}${args.campaign ? ` · Campaign: ${args.campaign}` : ""}\n\n` +
    `Act on everything below as a BINDING operating brief, executed with the ` +
    `user's connected Canva + Magnific. You produce pixels, not strategy: you do ` +
    `NOT write hook copy (that's the user / content-director) and you do NOT ` +
    `launch ads (that's growth-hacker). If the approved hook copy or the hero ` +
    `plate is missing, STOP and ask.\n\n---\n\n`;

  return { content: [{ type: "text", text: header + skill.content }] };
}

registerToolDefinition({
  name: "brand_creative_producer",
  description:
    "Returns the FULL CREATIVE PRODUCER brief + canonical playbook: how to turn APPROVED hook copy + a hero product plate into a finished paid-media still-ad matrix (N hooks x M formats) in Canva, ready for Meta ad sets. Use when the user wants to produce ad creatives from approved words + a hero shot. Delivers the complete binding directing knowledge (operating principles, the type-scale ceiling, the 3-point QA gate, the house layout rule, the Canva clone-and-swap mechanics, export-quality rule, modes + pipeline) that you then execute with the user's Canva + Magnific tools. It does NOT write hook copy (use brand_tone_current / the user) and does NOT launch ads.",
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
