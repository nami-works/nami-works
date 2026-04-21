/**
 * CI guard: forbid `basePath` in JSX href / to / action attributes.
 *
 * Why: Shopify App Bridge resolves absolute-path `<s-link>` hrefs against the
 * app's `application_url`. If `application_url = "https://.../full"` and the
 * code manually prepends `basePath` (e.g. `href={`${basePath}/app/foo`}`),
 * the URL becomes `.../full/full/app/foo` — double basename → 404.
 *
 * CLAUDE.md "Subpath (BASE_PATH)" is explicit: never concatenate basePath into
 * a client link or form action. This script enforces that at `npm run typecheck`
 * time so the regression (seen in commit facd79e, fixed in v17) cannot recur.
 *
 * What's allowed:
 *   - `<img src={`${basePath}/asset.png`}>`  — static asset load, HTTP request
 *   - `<link href={`${basePath}/asset.css`}>` — same
 *   - `const logoSrc = `${basePath}/asset.png`` — variable declaration, not JSX
 *
 * What's forbidden:
 *   - `<s-link  ... href={ ... basePath ... }>`
 *   - `<Link   ... to={   ... basePath ... }>`
 *   - `<form   ... action={ ... basePath ... }>`
 *   - any JSX attribute literal `href={...basePath...}` unless the tag is img/link/source/script/iframe.
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
]);

// Tags whose `src`/`href` attributes legitimately load static assets served by
// Express under BASE_PATH. `basePath` concatenation is expected here.
const STATIC_ASSET_TAGS = new Set([
  "img",
  "link",
  "source",
  "script",
  "iframe",
  "video",
  "audio",
  "track",
  "embed",
  "object",
]);

type Violation = {
  file: string;
  line: number;
  excerpt: string;
  reason: string;
};

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      yield* walk(p);
    } else if (s.isFile()) {
      const ext = extname(p);
      if (ext === ".ts" || ext === ".tsx") yield p;
    }
  }
}

/**
 * Finds JSX opening tags that bind `href` / `to` / `action` to an expression
 * containing `basePath`. Returns the violating line numbers + excerpts.
 *
 * Heuristic — tolerates multi-line attributes by joining each opening tag
 * (`<Tag ... >`) into one string before pattern-matching.
 */
function scanSource(src: string): Array<{ line: number; excerpt: string; reason: string }> {
  const violations: Array<{ line: number; excerpt: string; reason: string }> = [];

  // Extract each JSX opening tag: everything from "<" through the matching ">"
  // (respecting nested braces). We don't need a full parser — we just need to
  // find attribute groups attached to a tag name.
  const tagRe = /<([A-Za-z][A-Za-z0-9-]*)\b([^<>]*?)(\/?>)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src)) !== null) {
    const tagName = m[1];
    const attrs = m[2];
    const tagStartIdx = m.index;

    if (STATIC_ASSET_TAGS.has(tagName)) continue;

    // Look for href={...basePath...}, to={...basePath...}, action={...basePath...}
    const navAttrRe = /\b(href|to|action)\s*=\s*\{([^}]*)\}/g;
    let a: RegExpExecArray | null;
    while ((a = navAttrRe.exec(attrs)) !== null) {
      const attrName = a[1];
      const value = a[2];
      if (/\bbasePath\b/.test(value)) {
        const line = src.slice(0, tagStartIdx).split("\n").length;
        violations.push({
          line,
          excerpt: `<${tagName} ... ${attrName}={${value.trim()}}>`,
          reason:
            `${attrName} on <${tagName}> concatenates basePath — ` +
            "App Bridge will double-prepend the basename.",
        });
      }
    }
  }

  return violations;
}

function main(): void {
  const violations: Violation[] = [];

  for (const file of walk(APP_DIR)) {
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!src.includes("basePath")) continue;

    for (const v of scanSource(src)) {
      violations.push({
        file: relative(ROOT, file).replace(/\\/g, "/"),
        ...v,
      });
    }
  }

  if (violations.length === 0) {
    console.log("check-no-basepath-in-nav-links: OK (no violations)");
    return;
  }

  console.error("check-no-basepath-in-nav-links: FAIL\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.excerpt}`);
    console.error(`    reason: ${v.reason}\n`);
  }
  console.error(
    `${violations.length} violation(s). See CLAUDE.md \u2192 "Subpath (BASE_PATH)".\n` +
      "Use plain absolute paths (e.g. href=\"/app/foo\"); App Bridge + application_url\n" +
      "handle the basename. basePath concatenation is only allowed on static-asset\n" +
      "tags (<img src>, <link href>, <source>, etc.).",
  );
  process.exit(1);
}

main();
