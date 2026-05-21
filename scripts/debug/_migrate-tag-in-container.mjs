// One-shot tag migration running INSIDE cpg-labs-full container.
// Reads prod Session.accessToken via Prisma; renames ld_address-confirm
// to ld_confirm-address on every order that still carries the legacy tag.
//
// USAGE:
//   sudo docker cp /tmp/_migrate-tag-in-container.mjs cpg-labs-full:/app/_m.mjs
//   sudo docker exec -w /app cpg-labs-full node /app/_m.mjs [--dry-run]
//   sudo docker exec cpg-labs-full rm /app/_m.mjs
//
// Idempotent. Re-running is safe.

import { PrismaClient } from "@prisma/client";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const LEGACY_TAG = "ld_address-confirm";
const CANONICAL_TAG = "ld_confirm-address";
const API_VERSION = "2025-01";
const DRY_RUN = process.argv.includes("--dry-run");

const prisma = new PrismaClient();
// Prefer offline session (isOnline: false, no expires) — those tokens don't
// expire, unlike online sessions which roll over per-user. The fallback
// covers shops that only have online sessions (less common).
const allSessions = await prisma.session.findMany({
  where: { shop: SHOP },
  select: { id: true, accessToken: true, isOnline: true, expires: true, scope: true },
  orderBy: [
    { isOnline: "asc" }, // offline first
    { expires: "desc" },
  ],
});
console.info(`[migrate-tag] candidate sessions: ${allSessions.length}`);
for (const s of allSessions.slice(0, 5)) {
  console.info(
    `  id=${s.id.slice(0, 16)}...  isOnline=${s.isOnline}  expires=${s.expires?.toISOString() ?? "null"}  scope=${(s.scope ?? "").slice(0, 60)}`,
  );
}
const session = allSessions.find((s) => !s.isOnline) ?? allSessions[0];
if (!session?.accessToken) {
  console.error("No Session row with accessToken for", SHOP);
  process.exit(2);
}
console.info(
  `[migrate-tag] using session id=${session.id.slice(0, 16)}... isOnline=${session.isOnline}`,
);
const TOKEN = session.accessToken;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables) {
  const res = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

async function* fetchLegacyTaggedOrders() {
  let cursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await gql(
      `#graphql
        query LegacyTagged($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: ID) {
            nodes { id name }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { query: `tag:${LEGACY_TAG}`, first: 250, after: cursor },
    );
    for (const node of data.orders.nodes) yield node;
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = data.orders.pageInfo.endCursor;
  }
}

async function tagsRemove(orderId, tags) {
  const data = await gql(
    `#graphql
      mutation TagsRemove($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }`,
    { id: orderId, tags },
  );
  return data.tagsRemove.userErrors;
}

async function tagsAdd(orderId, tags) {
  const data = await gql(
    `#graphql
      mutation TagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }`,
    { id: orderId, tags },
  );
  return data.tagsAdd.userErrors;
}

console.info(
  `[migrate-tag] START shop=${SHOP} legacy=${LEGACY_TAG} canonical=${CANONICAL_TAG} dryRun=${DRY_RUN}`,
);

const startedAt = Date.now();
let total = 0;
let migrated = 0;
let errors = 0;
const sampleNames = [];

for await (const order of fetchLegacyTaggedOrders()) {
  total += 1;
  if (sampleNames.length < 10) sampleNames.push(order.name);

  if (DRY_RUN) continue;

  try {
    const removeErrors = await tagsRemove(order.id, [LEGACY_TAG]);
    if (removeErrors.length) {
      console.warn(`[migrate-tag] tagsRemove userErrors order=${order.name}`, removeErrors);
    }
    const addErrors = await tagsAdd(order.id, [CANONICAL_TAG]);
    if (addErrors.length) {
      console.warn(`[migrate-tag] tagsAdd userErrors order=${order.name}`, addErrors);
    }
    migrated += 1;
    if (migrated % 25 === 0) {
      console.info(`[migrate-tag] progress migrated=${migrated} total-seen=${total}`);
    }
    await sleep(600);
  } catch (err) {
    errors += 1;
    console.error(`[migrate-tag] FAILED order=${order.name}`, err.message);
  }
}

const elapsed = Math.round((Date.now() - startedAt) / 1000);
console.info(
  `\n[migrate-tag] DONE shop=${SHOP} total=${total} migrated=${migrated} errors=${errors} elapsedSec=${elapsed}`,
);
if (DRY_RUN && total > 0) {
  console.info(
    `[migrate-tag] First ${sampleNames.length} order names: ${sampleNames.join(", ")}`,
  );
  console.info(
    `[migrate-tag] DRY-RUN: would migrate ${total} order(s). Re-run without --dry-run to execute.`,
  );
}

await prisma[String.fromCharCode(36) + "disconnect"]();
