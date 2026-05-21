import "dotenv/config";
import { parseArgs } from "node:util";
import { getShopifyClient } from "../../clients/shopify.js";
import { prisma } from "../../db/prisma.js";

/**
 * Apply the latest LdSimTweak to Shopify as authoritative ld_rota-NN tags.
 *
 * Authoritative model: for every order in the proposed clustering, ensure
 * exactly one `ld_rota-NN` tag is present. Strips any *active* `ld_rota-N*`
 * tag that doesn't match the proposed slot (archived `ld_rota-NN_YY.MM.DD`
 * tags are left alone — those are history).
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   npx tsx src/local-delivery/scripts/apply-tweak.ts --tenant gebeauty --batch <id>
 *   npx tsx src/local-delivery/scripts/apply-tweak.ts --tenant gebeauty --batch <id> --dry-run
 */

function die(msg: string): never {
  console.error(`[apply-tweak] ${msg}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    batch: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
  strict: true,
});

const slug = values.tenant;
const batchId = values.batch ? parseInt(values.batch, 10) : NaN;
const dryRun = !!values["dry-run"];

if (!slug) die("--tenant required");
if (!Number.isFinite(batchId)) die("--batch <id> required");

const tenant = await prisma.integrationTenant.findUnique({
  where: { slug: slug! },
});
if (!tenant?.shopifyShop) die(`tenant "${slug}" not found`);

const batch = await prisma.ldSimBatch.findUnique({
  where: { id: batchId },
});
if (!batch) die(`batch ${batchId} not found`);
if (batch.tenantId !== tenant!.id) die("batch belongs to different tenant");

// Production safety: today's live dispatches are managed in the cpg-labs UI.
// The simulator is for retrospective learning only — refuse to touch any
// batch whose date is today. Pass --force to override (not recommended).
const todayIso = new Date().toISOString().slice(0, 10);
const force = !!(values as { force?: boolean }).force;
if (batch.date === todayIso && !force) {
  die(
    `batch ${batchId} is dated ${batch.date} (today). The simulator is read-only for today's live dispatches — manage them in the cpg-labs UI. Use --force to override.`,
  );
}

const tweak = await prisma.ldSimTweak.findFirst({
  where: { batchId: batchId },
  orderBy: { createdAt: "desc" },
});
if (!tweak) die(`no tweaks for batch ${batchId} — nothing to apply`);

console.log(
  `[apply-tweak] batch=${batchId} (${batch.date} ${batch.locationName}) tweak=${tweak.id}${dryRun ? " (DRY RUN)" : ""}`,
);

type ProposedRoute = { routeIndex: number; orderIds: string[] };
const proposed = tweak.proposedRoutes as unknown as ProposedRoute[];

// Build orderId → desired slot map. routeIndex 0 → slot 1, etc.
const desiredSlot = new Map<string, number>();
proposed.forEach((r) => {
  const slot = r.routeIndex + 1;
  for (const oid of r.orderIds) desiredSlot.set(oid, slot);
});

if (desiredSlot.size === 0) {
  console.log("[apply-tweak] empty clustering — nothing to apply");
  await prisma.$disconnect();
  process.exit(0);
}

// Pull each order's CURRENT tags from Shopify so we know what to strip.
const client = await getShopifyClient({
  ssmPrefix: tenant!.ssmPrefix,
  shopifyShop: tenant!.shopifyShop!,
});

const ORDER_TAGS_QUERY = /* GraphQL */ `
  query GetTags($id: ID!) {
    order(id: $id) {
      id name tags
    }
  }
`;

const TAGS_REMOVE = /* GraphQL */ `
  mutation Rem($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;
const TAGS_ADD = /* GraphQL */ `
  mutation Add($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

const ACTIVE_ROUTE = /^ld_rota-\d+$/; // ld_rota-NN (no date suffix)

type Plan = {
  orderId: string;
  orderName: string;
  desiredTag: string;
  toRemove: string[]; // active ld_rota-NN tags to strip (other than desired)
  toAdd: string[]; // [desiredTag] if not already present, else []
};
const plans: Plan[] = [];

for (const [orderId, slot] of desiredSlot) {
  const desiredTag = `ld_rota-${String(slot).padStart(2, "0")}`;
  const res = await client.request<{
    order: { id: string; name: string; tags: string[] } | null;
  }>(ORDER_TAGS_QUERY, { variables: { id: orderId } });
  const order = res.data?.order;
  if (!order) {
    console.error(`  ${orderId}: not found in Shopify — skipping`);
    continue;
  }
  const activeRotaTags = order.tags.filter((t) => ACTIVE_ROUTE.test(t));
  const toRemove = activeRotaTags.filter((t) => t !== desiredTag);
  const toAdd = order.tags.includes(desiredTag) ? [] : [desiredTag];
  plans.push({
    orderId,
    orderName: order.name,
    desiredTag,
    toRemove,
    toAdd,
  });
}

const noopCount = plans.filter((p) => p.toRemove.length === 0 && p.toAdd.length === 0).length;
const writeCount = plans.length - noopCount;
console.log(
  `[apply-tweak] ${plans.length} orders • ${writeCount} need updates • ${noopCount} already correct`,
);
for (const p of plans) {
  if (p.toRemove.length === 0 && p.toAdd.length === 0) continue;
  const rem = p.toRemove.length > 0 ? `−[${p.toRemove.join(",")}]` : "";
  const add = p.toAdd.length > 0 ? `+[${p.toAdd.join(",")}]` : "";
  console.log(`  ${p.orderName.padEnd(8)}  ${rem} ${add}`.trimEnd());
}

if (dryRun) {
  console.log("[apply-tweak] dry run — no Shopify writes performed");
  await prisma.$disconnect();
  process.exit(0);
}

let okCount = 0;
let errCount = 0;
for (const p of plans) {
  if (p.toRemove.length === 0 && p.toAdd.length === 0) continue;
  if (p.toRemove.length > 0) {
    const res = await client.request<{
      tagsRemove: { userErrors: Array<{ field: string[]; message: string }> };
    }>(TAGS_REMOVE, { variables: { id: p.orderId, tags: p.toRemove } });
    const errs = res.data?.tagsRemove.userErrors ?? [];
    if (errs.length > 0) {
      console.error(`  ${p.orderName}: tagsRemove ${JSON.stringify(errs)}`);
      errCount += 1;
      continue;
    }
  }
  if (p.toAdd.length > 0) {
    const res = await client.request<{
      tagsAdd: { userErrors: Array<{ field: string[]; message: string }> };
    }>(TAGS_ADD, { variables: { id: p.orderId, tags: p.toAdd } });
    const errs = res.data?.tagsAdd.userErrors ?? [];
    if (errs.length > 0) {
      console.error(`  ${p.orderName}: tagsAdd ${JSON.stringify(errs)}`);
      errCount += 1;
      continue;
    }
  }
  okCount += 1;
}

console.log(
  `[apply-tweak] applied ok=${okCount} errors=${errCount}${errCount > 0 ? " — REVIEW BEFORE DISPATCH" : ""}`,
);

await prisma.$disconnect();
process.exit(errCount > 0 ? 1 : 0);
