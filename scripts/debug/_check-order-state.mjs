// READ-ONLY: check Shopify state for a list of order names.
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const NAMES = process.argv.slice(2);
if (!TOKEN || NAMES.length === 0) {
  console.error("Usage: node _check-order-state.mjs <order#> <order#> ...");
  process.exit(2);
}

const query = `name:${NAMES.map((n) => n.replace("#", "")).join(" OR name:")}`;

const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
  body: JSON.stringify({
    query: `#graphql
      query Q($q: String!) {
        orders(first: 50, query: $q) {
          nodes {
            id name displayFulfillmentStatus tags createdAt
            fulfillments(first: 5) { id status createdAt deliveredAt }
          }
        }
      }`,
    variables: { q: query },
  }),
});
const j = await res.json();
const nodes = j?.data?.orders?.nodes ?? [];
console.log(`\nQueried ${NAMES.length} order names, got ${nodes.length} results:\n`);
for (const o of nodes.sort((a, b) => a.name.localeCompare(b.name))) {
  const ldTags = (o.tags ?? []).filter((t) => t.startsWith("ld_")).join(",") || "-";
  const fc = o.fulfillments.length;
  const lastFul = o.fulfillments[o.fulfillments.length - 1];
  console.log(`  ${o.name.padEnd(8)} ${o.displayFulfillmentStatus.padEnd(20)} fulfillments=${fc}${lastFul ? ` lastStatus=${lastFul.status} lastCreatedAt=${lastFul.createdAt}` : ""} | ld-tags=${ldTags}`);
}
