/**
 * One-shot migration: rename Shopify order tag ld_address-confirm → ld_confirm-address
 *
 * WHY: The address-confirm tag was renamed 2026-05-19 to put the verb first
 * ("confirm") so it groups visually with future ld_confirm-* tags. Existing
 * prod orders still carry the legacy form. This script backfills the rename
 * via Shopify Admin GraphQL: `tagsRemove` the legacy tag, `tagsAdd` the new
 * canonical one.
 *
 * SAFETY: Idempotent. tagsAdd is no-op if the tag already exists; tagsRemove
 * is no-op if absent. Re-running is safe — orders that already migrated
 * become tag:ld_confirm-address only and won't match the legacy search query
 * the next time around.
 *
 * USAGE:
 *   # dry-run, no mutations:
 *   npx tsx scripts/migrate-ld-confirm-address-tag.ts --dry-run
 *   # live run:
 *   npx tsx scripts/migrate-ld-confirm-address-tag.ts
 *
 * ENV VARS (mirror scripts/migrate-ld-address-review-tag.ts):
 *   SHOPIFY_SHOP_DOMAIN              — target shop (fallback below)
 *   SHOPIFY_ADMIN_ACCESS_TOKEN       — Admin API access token
 *   SHOPIFY_API_VERSION              — optional, defaults to 2025-10
 *
 *   Fallback shop: ge-beauty-cosmeticos.myshopify.com — only shop with this
 *   tag in production at time of writing. Override via env var.
 *
 * EXPECTED VOLUME: a few hundred orders at most. The 600ms sleep between
 * orders respects Shopify's ~2 mutations/sec budget; full run should finish
 * in well under 10 minutes.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const LEGACY_TAG = "ld_address-confirm";
const CANONICAL_TAG = "ld_confirm-address";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const SHOP_DOMAIN =
  process.env.SHOPIFY_SHOP_DOMAIN ||
  process.env.SHOPIFY_STORE_DOMAIN ||
  "ge-beauty-cosmeticos.myshopify.com";
const ADMIN_TOKEN =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ACCESS_TOKEN ||
  "";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const requireEnv = () => {
  if (!SHOP_DOMAIN) throw new Error("Missing SHOPIFY_SHOP_DOMAIN.");
  if (!ADMIN_TOKEN) throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN.");
};

const shopifyGraphql = async <T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify GraphQL failed: ${response.status} ${text}`);
  }
  const json = (await response.json()) as GraphqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(", "));
  }
  if (!json.data) throw new Error("Shopify GraphQL returned no data.");
  return json.data;
};

type OrderNode = { id: string; name: string };

const fetchLegacyTaggedOrders = async function* (): AsyncGenerator<OrderNode> {
  let cursor: string | null = null;
  let hasNextPage = true;

  type LegacyOrdersData = {
    orders: {
      nodes: OrderNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  while (hasNextPage) {
    const data: LegacyOrdersData = await shopifyGraphql<LegacyOrdersData>(
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
};

const tagsRemove = async (orderId: string, tags: string[]) => {
  const data = await shopifyGraphql<{
    tagsRemove: { userErrors: Array<{ field: string[] | null; message: string }> };
  }>(
    `#graphql
      mutation TagsRemove($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }`,
    { id: orderId, tags },
  );
  return data.tagsRemove.userErrors;
};

const tagsAdd = async (orderId: string, tags: string[]) => {
  const data = await shopifyGraphql<{
    tagsAdd: { userErrors: Array<{ field: string[] | null; message: string }> };
  }>(
    `#graphql
      mutation TagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }`,
    { id: orderId, tags },
  );
  return data.tagsAdd.userErrors;
};

const main = async () => {
  requireEnv();
  const startedAt = Date.now();
  console.info(
    `[migrate-ld-tag] START shop=${SHOP_DOMAIN} legacy=${LEGACY_TAG} canonical=${CANONICAL_TAG} dryRun=${dryRun}`,
  );

  let total = 0;
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for await (const order of fetchLegacyTaggedOrders()) {
    total += 1;
    if (dryRun) {
      console.info(
        `[migrate-ld-tag] WOULD-MIGRATE order=${order.id} name=${order.name}`,
      );
      skipped += 1;
      continue;
    }
    try {
      const removeErrors = await tagsRemove(order.id, [LEGACY_TAG]);
      if (removeErrors.length) {
        console.warn(`[migrate-ld-tag] tagsRemove userErrors order=${order.id}`, removeErrors);
      }
      const addErrors = await tagsAdd(order.id, [CANONICAL_TAG]);
      if (addErrors.length) {
        console.warn(`[migrate-ld-tag] tagsAdd userErrors order=${order.id}`, addErrors);
      }
      migrated += 1;
      console.info(`[migrate-ld-tag] OK order=${order.id} name=${order.name}`);
      await sleep(600);
    } catch (error) {
      errors += 1;
      console.error(`[migrate-ld-tag] FAILED order=${order.id}`, error);
    }
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.info(
    `[migrate-ld-tag] DONE shop=${SHOP_DOMAIN} total=${total} migrated=${migrated} skipped=${skipped} errors=${errors} elapsedSec=${elapsed}`,
  );
};

await main();
