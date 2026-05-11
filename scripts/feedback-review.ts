import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "../src/db/prisma.js";

/**
 * Admin: read the feedback queue. By default, lists all new feedback across
 * tenants, newest first. Use --status to filter, --tenant to scope to one
 * tenant, --mark to flip a row's status.
 *
 * Usage:
 *   DATABASE_URL=<prod> npm run feedback-review
 *   DATABASE_URL=<prod> npm run feedback-review -- --tenant gebeauty --status new
 *   DATABASE_URL=<prod> npm run feedback-review -- --mark <id> --status reviewing --note "looking at this"
 */

const VALID_STATUSES = ["new", "reviewing", "actioned", "wont_fix"] as const;
type Status = (typeof VALID_STATUSES)[number];

function die(message: string, code = 1): never {
  console.error(`[feedback-review] ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    status: { type: "string" },
    tenant: { type: "string" },
    mark: { type: "string" },
    note: { type: "string" },
    limit: { type: "string" },
  },
  strict: true,
});

const statusFilter = values.status as Status | undefined;
const tenantSlug = values.tenant;
const markId = values.mark;
const noteText = values.note;
const limit = values.limit ? Number(values.limit) : 50;

if (statusFilter && !(VALID_STATUSES as readonly string[]).includes(statusFilter)) {
  die(`--status must be one of: ${VALID_STATUSES.join(", ")}`);
}

async function markRow(): Promise<void> {
  if (!statusFilter) die("--mark requires --status to set");
  const updated = await prisma.feedback.update({
    where: { id: markId! },
    data: {
      status: statusFilter,
      reviewedAt: new Date(),
      ...(noteText ? { reviewNote: noteText } : {}),
    },
    select: { id: true, status: true, reviewedAt: true },
  });
  console.log(`Updated ${updated.id} → ${updated.status} at ${updated.reviewedAt?.toISOString()}`);
}

async function list(): Promise<void> {
  let tenantId: string | undefined;
  if (tenantSlug) {
    const t = await prisma.integrationTenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!t) die(`tenant "${tenantSlug}" not found`);
    tenantId = t.id;
  }

  const rows = await prisma.feedback.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      ...(statusFilter ? { status: statusFilter } : { status: "new" }),
    },
    include: { tenant: { select: { slug: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) {
    console.log(
      `No feedback matching filters (status=${statusFilter ?? "new"}${tenantSlug ? `, tenant=${tenantSlug}` : ""}).`,
    );
    return;
  }

  const byCategory: Record<string, number> = {};
  for (const r of rows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  }

  console.log(
    `\n${rows.length} feedback entries (filter: status=${statusFilter ?? "new"}${tenantSlug ? `, tenant=${tenantSlug}` : ""})`,
  );
  console.log(
    `By category: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", ")}\n`,
  );

  for (const r of rows) {
    const date = r.createdAt.toISOString().slice(0, 19).replace("T", " ");
    const tool = r.relatedTool ? ` [tool: ${r.relatedTool}]` : "";
    console.log(
      `[${date}] [${r.tenant.slug}] [${r.category}]${tool} id=${r.id}`,
    );
    console.log(`  ${r.message.replace(/\n/g, "\n  ")}`);
    if (r.reviewNote) console.log(`  └─ review: ${r.reviewNote}`);
    console.log();
  }

  console.log(
    `To mark one: npm run feedback-review -- --mark <id> --status reviewing --note "..."`,
  );
}

async function main(): Promise<void> {
  if (markId) {
    await markRow();
  } else {
    await list();
  }
}

main()
  .catch((err: unknown) => {
    console.error("[feedback-review] failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
