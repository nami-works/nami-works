/**
 * CI guard: forbid admin-only deps in `site/package.json`.
 *
 * The public site (cpg-labs.io) is a static Astro project served from S3 +
 * CloudFront. It must NEVER carry runtime dependencies that belong to the
 * embedded admin app — Shopify SDKs, Prisma, Google APIs, etc. Those packages
 * pull in server code and credentials that have no place on a public CDN.
 *
 * If you genuinely need shared logic between admin and site, extract it into
 * `packages/<thing>` and add a focused dep there, not in site/.
 *
 * Wired into `npm run typecheck` so it fails the build before deploy.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SITE_PACKAGE_JSON = join(ROOT, "site", "package.json");

if (!existsSync(SITE_PACKAGE_JSON)) {
  // No site/ yet — guard is inert. Don't fail.
  console.log("[check-site-deps] site/package.json not found — skipping.");
  process.exit(0);
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const pkg: PackageJson = JSON.parse(
  readFileSync(SITE_PACKAGE_JSON, "utf8"),
);

// Patterns banned from site/. Each is a regex matched against dep names.
const BANNED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^@shopify\//, reason: "Shopify SDKs are admin-only" },
  { pattern: /^@prisma\/client$/, reason: "Prisma client requires DB access" },
  { pattern: /^prisma$/, reason: "Prisma CLI is admin-only" },
  { pattern: /^@anthropic-ai\//, reason: "AI SDKs go through admin endpoints, not direct from a public CDN" },
  { pattern: /^@cpg-labs\/shared-(auth|db|encryption|webhooks)$/, reason: "Server-only shared package" },
  { pattern: /^googleapis$/, reason: "Google service-account SDKs are admin-only" },
  { pattern: /^@google\/maps$/, reason: "Server Maps client is admin-only — use the JS SDK in the browser" },
];

const allDeps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};

const violations: Array<{ dep: string; reason: string }> = [];

for (const dep of Object.keys(allDeps)) {
  for (const { pattern, reason } of BANNED_PATTERNS) {
    if (pattern.test(dep)) {
      violations.push({ dep, reason });
    }
  }
}

if (violations.length > 0) {
  console.error("[check-site-deps] FAILED — banned deps in site/package.json:");
  for (const v of violations) {
    console.error(`  - ${v.dep}: ${v.reason}`);
  }
  console.error(
    "\nIf you genuinely need this in the public site, justify it in PR review and update scripts/check-site-deps.ts.",
  );
  process.exit(1);
}

console.log(
  `[check-site-deps] OK — ${Object.keys(allDeps).length} dep(s) in site/package.json, none on the banlist.`,
);
