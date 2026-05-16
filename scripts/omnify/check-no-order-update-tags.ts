/**
 * CI guard: forbid `orderUpdate(input: { tags: [...] })` — replaces the entire
 * tag list and silently wipes any tag not in the array.
 *
 * Why this matters: Lucas's tag-persistence rule (2026-05-16) — tags added to
 * orders MUST persist until either (a) the user removes them manually via the
 * Order details modal toggle, or (b) a system state-transition flow explicitly
 * targets them with `tagsRemove`. A code change that uses Shopify's
 * `orderUpdate` mutation with a `tags` field replaces the whole list and
 * erases tags that weren't in the curated array — a silent data-loss bug.
 *
 * The safe primitives:
 *   - `tagsAdd(id, tags: [...])`    — only adds (idempotent if tag exists)
 *   - `tagsRemove(id, tags: [...])` — only removes the named tags
 *   - Helpers `addTags()` / `removeTags()` in `app/services/lalamove-sync.server.ts`
 *
 * What this check forbids:
 *   - Any `orderUpdate` mutation graphql template where the OrderInput field
 *     list contains `tags:` (commented-out `tags:` inside `# ...` is allowed
 *     for documentation, but we don't bother distinguishing — comment it out
 *     differently if you hit a false positive).
 *
 * What is allowed:
 *   - `orderUpdate(input: { id, shippingAddress: { ... } })` ✓
 *   - `orderUpdate(input: { id, note: "..." })` ✓
 *   - `tagsAdd(id, tags)` / `tagsRemove(id, tags)` ✓ (different mutation)
 *
 * Maintenance note: this is a heuristic regex scan, not a TS-AST analysis.
 * If a future use case needs `orderUpdate` with `tags`, suppress with a
 * `// allow-order-update-tags:` line comment immediately above the
 * mutation's `orderUpdate(` token AND add a justification.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "app");

const SKIP_DIRS = new Set([
  "node_modules",
  ".react-router",
  "build",
  "dist",
  ".cache",
  ".git",
  "site",
]);

const SCAN_EXTS = new Set([".ts", ".tsx"]);

interface Violation {
  file: string;
  line: number;
  snippet: string;
}

function walk(dir: string, files: string[]) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (SCAN_EXTS.has(extname(entry))) {
      files.push(full);
    }
  }
}

function scanFile(file: string): Violation[] {
  const out: Violation[] = [];
  const text = readFileSync(file, "utf8");
  // Find each `orderUpdate(` occurrence; check whether the same template
  // literal also names `tags:` as an input field. We scan the next ~500
  // characters after `orderUpdate(` looking for `tags:` BEFORE the closing
  // backtick or `}`. False positives can be suppressed with the inline
  // comment described in the file header.
  const orderUpdateRegex = /orderUpdate\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = orderUpdateRegex.exec(text)) != null) {
    const startIdx = match.index;
    // Check the 2 lines preceding for the suppression comment.
    const preChunk = text.slice(Math.max(0, startIdx - 200), startIdx);
    if (/\/\/\s*allow-order-update-tags:/i.test(preChunk)) continue;

    // Scan forward ~500 chars looking for `tags:` before mutation closes.
    const tail = text.slice(startIdx, startIdx + 500);
    // Stop at the first closing `}` that is part of an OrderInput literal
    // OR the closing backtick of the template — whichever comes first.
    const closeIdx = tail.indexOf("`");
    const inputClose = tail.search(/\}\s*\)/);
    const stopIdx =
      closeIdx >= 0 && inputClose >= 0
        ? Math.min(closeIdx, inputClose)
        : closeIdx >= 0
          ? closeIdx
          : inputClose >= 0
            ? inputClose
            : 500;
    const window = tail.slice(0, stopIdx);
    // Look for `tags:` as a field name in the GraphQL input. Skip
    // `userErrors`, GraphQL comment lines (`#`), and obvious `removeTags`/
    // `addTags` call substrings.
    const tagsFieldRegex = /(?:^|[\s,{])tags\s*:/m;
    if (tagsFieldRegex.test(window)) {
      const linesBefore = text.slice(0, startIdx).split("\n");
      out.push({
        file,
        line: linesBefore.length,
        snippet: window.split("\n").slice(0, 5).join("\n"),
      });
    }
  }
  return out;
}

function main() {
  if (!statSync(APP_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`[check-no-order-update-tags] app/ not found at ${APP_DIR}`);
    process.exit(2);
  }
  const files: string[] = [];
  walk(APP_DIR, files);
  const violations: Violation[] = [];
  for (const file of files) {
    violations.push(...scanFile(file));
  }
  if (violations.length === 0) {
    console.log("[check-no-order-update-tags] OK — no violations");
    return;
  }
  console.error(
    `[check-no-order-update-tags] FAIL — ${violations.length} violation(s):\n`,
  );
  for (const v of violations) {
    const rel = relative(ROOT, v.file);
    console.error(`  ${rel}:${v.line}`);
    console.error(v.snippet.split("\n").map((l) => `    ${l}`).join("\n"));
    console.error("");
  }
  console.error(
    `Use tagsAdd/tagsRemove mutations (or addTags/removeTags helpers) instead.\n` +
      `If you have a genuine reason to overwrite tags via orderUpdate, place\n` +
      `// allow-order-update-tags: <reason>  immediately above the orderUpdate( call.`,
  );
  process.exit(1);
}

main();
