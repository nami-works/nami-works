import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { prisma } from "../apps/connector/src/db/prisma.js";

/**
 * Rotate a tenant's bearer token.
 *
 * Usage:
 *   npm run rotate-bearer -- --slug=gebeauty
 *
 * Side effects:
 *   - Generates a new 48-byte random bearer (base64url).
 *   - Overwrites the bearerTokenHash column for the tenant row.
 *   - Old bearer becomes invalid IMMEDIATELY on the next auth check
 *     (auth middleware reads fresh each request).
 *
 * After running, the operator must:
 *   1. Paste the new bearer into claude.ai's connector OAuth consent page
 *      (the connector itself doesn't need re-adding — the OAuth token flow
 *      re-issues a JWT off the new bearer).
 *   2. Any direct-curl clients must swap their Authorization header.
 */

function die(message: string, code = 1): never {
  console.error(`[rotate-bearer] ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
  },
  strict: true,
});

const slug = values.slug;
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  die("--slug is required and must match /^[a-z0-9-]+$/");
}

const existing = await prisma.integrationTenant.findUnique({
  where: { slug },
});
if (!existing) {
  die(`tenant "${slug}" not found`);
}

const bearer = randomBytes(48).toString("base64url");
const bearerTokenHash = createHash("sha256").update(bearer).digest("hex");

await prisma.integrationTenant.update({
  where: { slug },
  data: { bearerTokenHash },
});

const line = "=".repeat(72);
console.log(`
${line}
Bearer rotated for tenant: ${slug}

New bearer (SHOWN ONCE — save to password manager now):
  ${bearer}

Next steps:
  1. In claude.ai, open the connector "NAMI works for ${slug}" and re-do the
     OAuth consent flow — paste the new bearer above.
  2. Update any direct-curl scripts that hold the old bearer.
  3. The old bearer is invalid immediately. No gateway restart needed.
${line}
`);

await prisma.$disconnect();
