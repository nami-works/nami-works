// Deeper read-only introspection: any input/type that mentions DeliveryMethod
// or methodType, plus FulfillmentService-related mutations.

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

// 1. List every input-object type whose name mentions Delivery / Pickup / Fulfillment / Method.
console.log("== Step 1: input types matching delivery/pickup/method/fulfillment ==\n");
const allTypes = await gql(`{
  __schema {
    types {
      name
      kind
    }
  }
}`);
const matchedTypes = (allTypes?.data?.__schema?.types ?? [])
  .filter((t) => t.kind === "INPUT_OBJECT" && /delivery|pickup|pick_up|method|fulfillment/i.test(t.name))
  .map((t) => t.name)
  .sort();

console.log(`  Found ${matchedTypes.length} candidate input types:`);
for (const n of matchedTypes) console.log(`    - ${n}`);

// 2. For each, dump fields and find anything that holds a method type.
console.log("\n== Step 2: field dumps (filter to entries containing 'method' OR 'type' OR 'deliveryMethod') ==\n");
for (const name of matchedTypes) {
  const r = await gql(`query I($n: String!) {
    __type(name: $n) {
      name
      inputFields {
        name
        type { name kind ofType { name kind ofType { name kind } } }
      }
    }
  }`, { n: name });
  const t = r?.data?.__type;
  if (!t?.inputFields) continue;
  const relevant = t.inputFields.filter((f) =>
    /method|type|delivery/i.test(f.name) ||
    /delivery|method/i.test(f.type?.name ?? "") ||
    /delivery|method/i.test(f.type?.ofType?.name ?? "")
  );
  if (relevant.length > 0) {
    console.log(`  ${t.name}:`);
    for (const f of relevant) {
      const tn = f.type?.name ?? f.type?.ofType?.name ?? f.type?.ofType?.ofType?.name ?? f.type?.kind;
      console.log(`    ${f.name}: ${tn}`);
    }
  }
}

// 3. Check the DeliveryMethodType enum exists + its values.
console.log("\n== Step 3: DeliveryMethodType enum values ==\n");
const enumQ = await gql(`{
  __type(name: "DeliveryMethodType") {
    name
    enumValues { name }
  }
}`);
console.log(JSON.stringify(enumQ?.data?.__type, null, 2));

// 4. FulfillmentService-related types (they often carry method-type semantics).
console.log("\n== Step 4: FulfillmentService inputs ==\n");
for (const name of ["FulfillmentServiceInput", "DeliveryLocationLocalPickupEnableInput", "DeliveryLocationLocalPickupSettingsInput"]) {
  const r = await gql(`query I($n: String!) {
    __type(name: $n) {
      name
      inputFields {
        name
        type { name kind ofType { name kind } }
      }
    }
  }`, { n: name });
  const t = r?.data?.__type;
  if (!t) { console.log(`  ${name}: not found`); continue; }
  console.log(`  ${t.name}:`);
  for (const f of t.inputFields ?? []) {
    const tn = f.type?.name ?? f.type?.ofType?.name ?? f.type?.kind;
    console.log(`    ${f.name}: ${tn}`);
  }
}

// 5. Order-update mutation — can methodType be set after creation?
console.log("\n== Step 5: OrderInput / OrderUpdateInput field shapes ==\n");
for (const name of ["OrderInput", "OrderUpdateInput", "ShippingLineInput"]) {
  const r = await gql(`query I($n: String!) {
    __type(name: $n) {
      name
      inputFields {
        name
        type { name kind ofType { name kind } }
      }
    }
  }`, { n: name });
  const t = r?.data?.__type;
  if (!t) { console.log(`  ${name}: not found`); continue; }
  console.log(`  ${t.name}:`);
  for (const f of t.inputFields ?? []) {
    const tn = f.type?.name ?? f.type?.ofType?.name ?? f.type?.kind;
    console.log(`    ${f.name}: ${tn}`);
  }
}

await prisma[String.fromCharCode(36) + "disconnect"]();
