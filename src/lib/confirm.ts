import type { ToolResult } from "../mcp/types.js";

/**
 * Two-step confirmation pattern for write tools.
 *
 * Every write tool takes `confirm: z.boolean().optional()`. When called
 * without `confirm: true`, the handler builds a human-readable summary of
 * what the write would change and returns it via `confirmationPreview`.
 * Claude.ai surfaces this to the user; the user reads, approves, and a
 * second call with `confirm: true` executes the actual mutation.
 *
 * The "Why": gebeauty ops have been burned by stacked promos, wrong-priced
 * BEAUTYBACK codes, and stale markdowns. A narration + confirm step makes
 * the LLM-driven write surface safe for non-technical operators.
 */
export function confirmationPreview(args: {
  summary: string;
  actionLabel: string;
}): ToolResult {
  const body = [
    `Preview (no changes made yet):`,
    ``,
    args.summary,
    ``,
    `If this looks correct, call this tool again with confirm: true to execute "${args.actionLabel}".`,
  ].join("\n");

  return {
    content: [{ type: "text", text: body }],
  };
}
