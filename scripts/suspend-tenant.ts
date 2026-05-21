import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "../apps/connector/src/db/prisma.js";

/**
 * Kill switch: flip a tenant's status between active / suspended / disabled.
 *
 * Usage:
 *   npm run suspend-tenant -- --slug=gebeauty
 *   npm run suspend-tenant -- --slug=gebeauty --activate
 *   npm run suspend-tenant -- --slug=gebeauty --disable
 *
 * Effects:
 *   - status=suspended  → 401 on all tool calls. Billing pause. Reversible.
 *   - status=disabled   → 401 on all tool calls. "Offboarded" state.
 *                         Convention: suspended is temporary, disabled is final.
 *   - status=active     → tool calls work normally.
 *
 * No token re-issue, no SSM changes, no Claude.ai reconfiguration needed —
 * the auth middleware re-checks status on every request.
 */

function die(message: string, code = 1): never {
  console.error(`[suspend-tenant] ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    activate: { type: "boolean" },
    disable: { type: "boolean" },
  },
  strict: true,
});

const slug = values.slug;
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  die("--slug is required and must match /^[a-z0-9-]+$/");
}

if (values.activate && values.disable) {
  die("--activate and --disable are mutually exclusive");
}

const targetStatus: "active" | "suspended" | "disabled" = values.activate
  ? "active"
  : values.disable
    ? "disabled"
    : "suspended";

const existing = await prisma.integrationTenant.findUnique({
  where: { slug },
});
if (!existing) {
  die(`tenant "${slug}" not found`);
}

if (existing.status === targetStatus) {
  console.log(
    `[suspend-tenant] tenant "${slug}" is already ${targetStatus}. No change.`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.integrationTenant.update({
  where: { slug },
  data: { status: targetStatus },
});

console.log(
  `[suspend-tenant] tenant "${slug}" status: ${existing.status} → ${targetStatus}`,
);
if (targetStatus !== "active") {
  console.log(
    `[suspend-tenant] All tool calls for "${slug}" will now return 401. No gateway restart needed.`,
  );
}

await prisma.$disconnect();
