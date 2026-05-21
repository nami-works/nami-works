// READ-ONLY: introspect Shopify Admin GraphQL schema to confirm whether
// deliveryMethod (or method_type) is settable at order creation, and
// where else it MIGHT be settable (draftOrderCreate, fulfillmentOrder
// mutations, etc.).
import { PrismaClient } from "@prisma/client";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const prisma = new PrismaClient();
const s = await prisma.session.findFirst({
  where: { shop: SHOP }, orderBy: { expires: "desc" }, select: { accessToken: true },
});
const TOKEN = s.accessToken;

async function gql(q, v) {
  const r = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query: q, variables: v ?? {} }),
  });
  return r.json();
}

const INPUTS_TO_PROBE = [
  "OrderCreateOrderInput",
  "OrderCreateFulfillmentInput",
  "OrderCreateLineItemInput",
  "OrderCreateShippingLineInput",
  "DraftOrderInput",
  "DraftOrderShippingLineInput",
  "FulfillmentOrderHoldInput",
  "FulfillmentInput",
  "FulfillmentV2Input",
];

console.log("== Probing input shapes ==\n");
for (const name of INPUTS_TO_PROBE) {
  const r = await gql(
    `query I($n: String!) {
      __type(name: $n) {
        name
        inputFields {
          name
          type { name kind ofType { name kind ofType { name kind } } }
        }
      }
    }`,
    { n: name },
  );
  const t = r?.data?.__type;
  if (!t) { console.log(`  ${name}: NOT FOUND in schema (errors=${JSON.stringify(r?.errors ?? "")})`); continue; }
  console.log(`  ${t.name}:`);
  for (const f of t.inputFields ?? []) {
    const tn = f.type?.name ?? f.type?.ofType?.name ?? f.type?.ofType?.ofType?.name ?? f.type?.kind;
    console.log(`    ${f.name}: ${tn}`);
  }
  console.log("");
}

console.log("== Mutations that mention delivery / methodType ==\n");
const mutationProbe = await gql(`{
  __schema {
    mutationType {
      fields {
        name
        args { name type { name kind ofType { name } } }
      }
    }
  }
}`);
const mutations = mutationProbe?.data?.__schema?.mutationType?.fields ?? [];
for (const m of mutations) {
  if (/delivery|fulfillment|pickup|pick_up/i.test(m.name)) {
    console.log(`  ${m.name}`);
    for (const a of m.args ?? []) {
      const tn = a.type?.name ?? a.type?.ofType?.name ?? a.type?.kind;
      console.log(`      ${a.name}: ${tn}`);
    }
  }
}

await prisma[String.fromCharCode(36) + "disconnect"]();
