import { PrismaClient } from "@prisma/client";
const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const prisma = new PrismaClient();
const s = await prisma.session.findFirst({ where: { shop: SHOP }, orderBy: { expires: "desc" }, select: { accessToken: true } });
const TOKEN = s.accessToken;
async function gql(q, v) {
  const r = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query: q, variables: v }),
  });
  return r.json();
}

// Try multiple lookups
for (const q of ["name:80841", "name:#80841", "name:'#80841'", "order_id:80841"]) {
  const r = await gql(`#graphql query L($q: String!) { orders(first: 5, query: $q) { nodes { id name createdAt sourceName tags } } }`, { q });
  console.log(`q="${q}": ${(r?.data?.orders?.nodes ?? []).length} results, errors=${JSON.stringify(r?.errors ?? "none").slice(0,80)}`);
  for (const o of r?.data?.orders?.nodes ?? []) console.log(`  ${o.name} ${o.createdAt} src=${o.sourceName}`);
}

// And list recent orders to see the range
const recent = await gql(`#graphql query L { orders(first: 10, reverse: true, sortKey: CREATED_AT) { nodes { id name createdAt sourceName tags } } }`, {});
console.log(`\n10 most recent orders:`);
for (const o of recent?.data?.orders?.nodes ?? []) console.log(`  ${o.name} ${o.createdAt} src=${o.sourceName} tags=${(o.tags ?? []).slice(0,4).join(",")}`);

await prisma[String.fromCharCode(36) + "disconnect"]();
