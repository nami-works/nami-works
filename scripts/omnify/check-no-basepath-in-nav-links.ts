/**
 * CI guard: forbid `basePath` in JSX href / to / action attrs.
 *
 * Why: every URL-handling layer in this app already accounts for basename;
 * manual `basePath` concatenation adds it a second time → `/full/full/...` →
 * 404.
 *
 * - React Router `<Link>` / `<Form>` / `useSubmit` — basename is configured in
 *   `react-router.config.ts` and applied automatically.
 * - Shopify App Bridge `<s-link>` — prepends the `application_url`'s path
 *   component (e.g. `/full`) to absolute-path hrefs at navigation time.
 *   Verified from CloudWatch 2026-04-22: `<s-link href="/full/app/retail-sales">`
 *   produced `GET /full/__manifest?paths=%2Ffull%2Ffull%2Fapp%2Fretail-sales`
 *   (double prefix → 404). `<s-link href="/app/retail-sales">` is the correct
 *   form. Regression history: facd79e added the prefix (broken), v17 reverted
 *   (correct but masked by split-brain), v18 re-added (broken again), v19
 *   reverted definitively.
 *
 * What's allowed:
 *   - `<img src={`${basePath}/asset.png`}>`  — static asset, direct HTTP
 *   - `<link href={`${basePath}/asset.css`}>` — same
 *   - `const logoSrc = `${basePath}/asset.png`` — variable, not a JSX attr
 *
 * What's forbidden:
 *   - `<s-link ... href={   ... basePath ... }>` — App Bridge prepends it
 *   - `<Link   ... to={     ... basePath ... }>` — React Router prepends it
 *   - `<form   ... action={ ... basePath ... }>` — React Router prepends it
 *   - `href={...basePath...}` on any non-static-asset JSX tag.
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
            "React Router already prepends the basename, so this produces " +
            "/full/full/... and 404s.",
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
      "Every URL-handling layer already prepends the basename:\n" +
      "  - React Router <Link>/<form> - via react-router.config.ts basename.\n" +
      "  - App Bridge <s-link> - via application_url's path component.\n" +
      "Manual basePath concatenation adds it a second time and produces\n" +
      "/full/full/... and 404s. Use plain absolute paths (e.g. to=\"/app/foo\",\n" +
      "href=\"/app/foo\"). basePath concatenation is only allowed on static-\n" +
      "asset tags (<img src>, <link href>, <source>, etc.).",
  );
  process.exit(1);
}

main();
