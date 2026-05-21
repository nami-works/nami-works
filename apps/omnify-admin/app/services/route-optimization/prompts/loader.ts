/**
 * Loads the v1 spatial-reasoner system prompt from
 * `v1-spatial-reasoner.md`.
 *
 * The .md file is human-readable documentation of the prompt; the actual
 * verbatim system-prompt text lives inside a fenced code block under the
 * heading "## System prompt (verbatim)". This loader extracts that block
 * at startup and exposes the prompt string + its version stamp.
 *
 * The markdown is inlined at build time via Vite's `?raw` query so the
 * server bundle is self-contained — no runtime filesystem lookup. The
 * previous `readFileSync(__dirname/v1-spatial-reasoner.md)` approach
 * broke in production because the bundled output sits at
 * /app/build/server/ where the sibling .md doesn't exist.
 */

import promptMarkdown from "./v1-spatial-reasoner.md?raw";

export type LoadedPrompt = {
  systemPrompt: string;
  version: string;
};

const VERBATIM_HEADING = "## System prompt (verbatim)";

/**
 * Extract the verbatim system-prompt code block from the bundled
 * markdown. Throws if the block isn't found.
 */
export function loadV1Prompt(): LoadedPrompt {
  const headingIdx = promptMarkdown.indexOf(VERBATIM_HEADING);
  if (headingIdx < 0) {
    throw new Error(`v1 prompt: heading not found ("${VERBATIM_HEADING}")`);
  }
  const afterHeading = promptMarkdown.slice(headingIdx);
  const fenceMatch = afterHeading.match(/```\s*([\s\S]*?)```/);
  if (!fenceMatch) {
    throw new Error("v1 prompt: no fenced code block under verbatim heading");
  }
  const systemPrompt = fenceMatch[1]!.trim();
  if (systemPrompt.length === 0) {
    throw new Error("v1 prompt: extracted block is empty");
  }
  return { systemPrompt, version: "v1" };
}
