// READ-ONLY: 2-step search.
//   Step 1: customers endpoint → find customer GIDs matching first+last
//   Step 2: orders endpoint → fetch each customer's orders in last 5 days,
//           classify as Recife / not, FULFILLED / not.

import fs from "node:fs";

const envPath = new URL("../../gebeauty/.env", import.meta.url);
for (const l of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const RECIFE_LOCATION = "gid://shopify/Location/97397014848";

const PEOPLE = [
  { first: "Renata", last: "Pereira" },
  { first: "Bruna", last: "Cabral" },
  { first: "Luciana", last: "Oliveira" },
  { first: "Carolina", last: "Coelho" },
];

async function gql(query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const DAYS = parseInt(process.argv[2] ?? "5", 10);
const fiveDaysAgoIso = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);

console.log(`\n=== Recife double-pack check ===`);
console.log(`Window: orders created since ${fiveDaysAgoIso} (UTC)\n`);

const allHits = [];

for (const p of PEOPLE) {
  // Step 1: find customers matching first+last
  const custQ = `first_name:${p.first} last_name:${p.last}`;
  const custResp = await gql(
    `#graphql
      query CustQ($q: String!) {
        customers(first: 25, query: $q) {
          nodes {
            id displayName firstName lastName email phone
            defaultAddress { city province }
          }
        }
      }`,
    { q: custQ },
  );
  const customers = custResp?.data?.customers?.nodes ?? [];
  console.log(`\n[${p.first} ${p.last}] — matched ${customers.length} customer record(s):`);
  if (customers.length === 0) continue;
  for (const c of customers) {
    console.log(`  · ${c.displayName} | ${c.email ?? "no-email"} | ${c.phone ?? "no-phone"} | city=${c.defaultAddress?.city ?? "?"}`);
  }

  // Step 2: for each customer, fetch orders in last 5 days
  for (const c of customers) {
    const ordersResp = await gql(
      `#graphql
        query OrdersForCust($id: ID!) {
          customer(id: $id) {
            orders(first: 50, sortKey: CREATED_AT, reverse: true) {
              nodes {
                id name createdAt displayFulfillmentStatus tags
                totalPriceSet { shopMoney { amount currencyCode } }
                shippingAddress { city province address1 }
                fulfillments(first: 5) {
                  id status createdAt deliveredAt
                  location { id name }
                }
                fulfillmentOrders(first: 5) {
                  nodes {
                    id status
                    assignedLocation { location { id name } }
                  }
                }
              }
            }
          }
        }`,
      { id: c.id },
    );
    const ordersRaw = ordersResp?.data?.customer?.orders?.nodes ?? [];
    const orders = ordersRaw.filter((o) => o.createdAt.slice(0, 10) >= fiveDaysAgoIso);
    if (orders.length === 0) {
      console.log(`    customer ${c.id.split("/").pop()}: no orders in last 5 days`);
      continue;
    }
    for (const o of orders) {
      const recifeFul = (o.fulfillments ?? []).find((f) => f.location?.id === RECIFE_LOCATION);
      const recifeAssigned = (o.fulfillmentOrders?.nodes ?? []).find(
        (fo) => fo.assignedLocation?.location?.id === RECIFE_LOCATION,
      );
      const isRecife = !!recifeFul || !!recifeAssigned;
      const ldTags = (o.tags ?? []).filter((t) => t.startsWith("ld_")).join(",") || "-";
      const city = o.shippingAddress?.city ?? "?";
      const amount = o.totalPriceSet?.shopMoney
        ? `${o.totalPriceSet.shopMoney.currencyCode} ${o.totalPriceSet.shopMoney.amount}`
        : "?";
      const lastFul = o.fulfillments?.[o.fulfillments.length - 1];

      console.log(
        `    ${o.name.padEnd(8)} ${o.createdAt.slice(0, 10)} ${o.displayFulfillmentStatus.padEnd(20)} ` +
        `city=${city.padEnd(14)} ${amount.padEnd(13)} recife=${isRecife ? "YES" : "no"} ` +
        `lastFul=${lastFul?.status ?? "-"}@${lastFul?.createdAt?.slice(0, 10) ?? "-"} tags=${ldTags}`,
      );
      if (isRecife) {
        allHits.push({
          person: `${p.first} ${p.last}`,
          customerDisplay: c.displayName,
          orderName: o.name,
          status: o.displayFulfillmentStatus,
          createdAt: o.createdAt,
          deliveredAt: lastFul?.deliveredAt,
          lastFulCreatedAt: lastFul?.createdAt,
          lastFulStatus: lastFul?.status,
          ldTags: o.tags?.filter((t) => t.startsWith("ld_")) ?? [],
          amount,
          city,
          address1: o.shippingAddress?.address1,
          province: o.shippingAddress?.province,
        });
      }
    }
  }
}

console.log(`\n\n=== VERDICT — Recife-assigned orders for these 4 customers, last 5 days ===\n`);
console.log(`Total hits: ${allHits.length}\n`);
for (const h of allHits) {
  const verdict =
    h.status === "FULFILLED" && h.lastFulStatus === "SUCCESS"
      ? "🟢 ALREADY DELIVERED — re-pack would be a double-give"
      : h.status === "UNFULFILLED"
      ? "🟡 still unfulfilled — legit re-send"
      : `⚠️  ${h.status}/${h.lastFulStatus} — needs human review`;
  console.log(`  ${h.person.padEnd(20)} | ${h.orderName.padEnd(8)} | ${h.status.padEnd(18)} | fulfilledAt=${h.lastFulCreatedAt?.slice(0, 16) ?? "-"} | ${h.amount.padEnd(14)} | ${verdict}`);
  console.log(`    addr: ${h.address1 ?? "?"}, ${h.city}, ${h.province ?? "?"}`);
  console.log(`    ld-tags: ${h.ldTags.join(",") || "-"}`);
}
