/**
 * Loads the v1 spatial-reasoner system prompt from
 * `v1-spatial-reasoner.md`.
 *
 * The .md file is human-readable documentation of the prompt; the actual
 * verbatim system-prompt text lives inside a fenced code block under the
 * heading "## System prompt (verbatim)". This loader extracts that block
 * at startup and exposes the prompt string + its version stamp.
 *
 * Pure function — no side effects, suitable for both production and tests.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the markdown file holding the prompt definition. */
export const V1_PROMPT_PATH = join(__dirname, "v1-spatial-reasoner.md");

export type LoadedPrompt = {
  systemPrompt: string;
  version: string;
};

const VERBATIM_HEADING = "## System prompt (verbatim)";

/**
 * Read the prompt file and extract the verbatim system-prompt code block.
 * Throws if the file is missing or the verbatim block isn't found.
 */
export function loadV1Prompt(): LoadedPrompt {
  const raw = readFileSync(V1_PROMPT_PATH, "utf8");
  const headingIdx = raw.indexOf(VERBATIM_HEADING);
  if (headingIdx < 0) {
    throw new Error(`v1 prompt: heading not found ("${VERBATIM_HEADING}")`);
  }
  // Locate the first fenced code block after the heading.
  const afterHeading = raw.slice(headingIdx);
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
