/**
 * CI guard: forbid `basePath` in React Router JSX href / to / action attrs.
 *
 * Why: when running under a basename (e.g. `/full`), React Router's `<Link>`,
 * `<Form>`, and `useSubmit` already prepend the basename automatically. Manual
 * `basePath` concatenation produces `/full/full/...` → 404. CLAUDE.md
 * "Subpath (BASE_PATH)" documents the rule.
 *
 * Important exception — App Bridge `<s-link>`. Polaris web components do NOT
 * go through React Router. App Bridge constructs the iframe URL using the
 * href verbatim, ignoring `application_url`'s subpath. So `<s-link
 * href="/app/foo">` from inside a `/full`-mounted iframe drops `/full` →
 * backend gets `/app/foo` → 404. For `<s-link>` the basePath prefix is
 * REQUIRED (`<s-link href={`${basePath}${path}`}>`). The check skips
 * `<s-link>` for that reason. See `APP_BRIDGE_NAV_TAGS` below.
 *
 * What's allowed:
 *   - `<img src={`${basePath}/asset.png`}>`  — static asset, direct HTTP
 *   - `<link href={`${basePath}/asset.css`}>` — same
 *   - `<s-link href={`${basePath}/app/foo`}>` — App Bridge nav, see above
 *   - `const logoSrc = `${basePath}/asset.png`` — variable, not a JSX attr
 *
 * What's forbidden:
 *   - `<Link  ... to={     ... basePath ... }>` — React Router, basename already applied
 *   - `<form  ... action={ ... basePath ... }>` — React Router, basename already applied
 *   - `href={...basePath...}` on any non-`<s-link>` non-static-asset JSX tag.
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

// App Bridge web components that DON'T honor React Router's basename — their
// hrefs MUST include basePath manually or the iframe drops the subpath and
// 404s at the origin. CLAUDE.md "Subpath (BASE_PATH)" documents the exception.
const APP_BRIDGE_NAV_TAGS = new Set([
  "s-link",
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
    if (APP_BRIDGE_NAV_TAGS.has(tagName)) continue;

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
      "React Router's <Link>/<form> already prepend the basename - concatenating\n" +
      "basePath produces /full/full/... and 404s. Use plain absolute paths\n" +
      '(e.g. to="/app/foo"). basePath concatenation IS allowed on:\n' +
      "  - static-asset tags (<img src>, <link href>, <source>, etc.)\n" +
      "  - App Bridge <s-link>, which does NOT honor React Router's basename\n" +
      "    and requires the basePath in the href.",
  );
  process.exit(1);
}

main();
