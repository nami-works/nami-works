import { PrismaClient } from "@prisma/client";
const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const prisma = new PrismaClient();
const s = await prisma.session.findFirst({ where: { shop: SHOP }, orderBy: { expires: "desc" }, select: { accessToken: true } });
const TOKEN = s.accessToken;
async function gql(q, v) {
  const r = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query: q, variables: v ?? {} }),
  });
  return r.json();
}

// Simplest possible recent-orders query.
const r1 = await gql(`{ orders(first: 5, reverse: true, sortKey: CREATED_AT) { nodes { id name createdAt } } }`);
console.log("Recent (no variables):", JSON.stringify(r1, null, 2).slice(0, 800));

// With variable.
const r2 = await gql(
  `query F($q: String!) { orders(first: 5, query: $q) { nodes { id name createdAt sourceName } } }`,
  { q: "name:80841" },
);
console.log("\nLookup name:80841:", JSON.stringify(r2, null, 2).slice(0, 800));

// Try with broader range of similar numbers.
for (const n of [80841, 80814, 80481, 80148, 80048, 80084]) {
  const r = await gql(
    `query F($q: String!) { orders(first: 3, query: $q) { nodes { id name createdAt sourceName tags } } }`,
    { q: `name:${n}` },
  );
  const nodes = r?.data?.orders?.nodes ?? [];
  console.log(`  ${n}: ${nodes.length} results — ${nodes.map((o) => o.name + " @ " + o.createdAt).join(", ")}`);
}

await prisma[String.fromCharCode(36) + "disconnect"]();
