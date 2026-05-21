import "dotenv/config";
import { parseArgs } from "node:util";
import { getShopifyClient } from "../../clients/shopify.js";
import { prisma } from "../../db/prisma.js";

const { values } = parseArgs({
  options: { names: { type: "string" } },
  strict: true,
});
const names = (values.names ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (names.length === 0) {
  console.error("--names <comma-separated order names like 78758,78834>");
  process.exit(1);
}

const tenant = await prisma.integrationTenant.findUnique({
  where: { slug: "gebeauty" },
});
const client = await getShopifyClient({
  ssmPrefix: tenant!.ssmPrefix,
  shopifyShop: tenant!.shopifyShop!,
});

const Q = /* GraphQL */ `
  query LookupByName($q: String!) {
    orders(first: 5, query: $q) {
      edges {
        node {
          id name displayFulfillmentStatus tags createdAt
          shippingAddress { address1 address2 city province zip latitude longitude }
          fulfillmentOrders(first: 5) {
            nodes {
              id status
              deliveryMethod { methodType }
              assignedLocation { location { id name } }
            }
          }
        }
      }
    }
  }
`;

for (const name of names) {
  const query = `name:#${name}`;
  const res = await client.request<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          displayFulfillmentStatus: string;
          tags: string[];
          createdAt: string;
          shippingAddress: {
            address1: string | null;
            address2: string | null;
            city: string | null;
            province: string | null;
            zip: string | null;
            latitude: number | null;
            longitude: number | null;
          } | null;
          fulfillmentOrders: {
            nodes: Array<{
              id: string;
              status: string;
              deliveryMethod: { methodType: string | null } | null;
              assignedLocation: { location: { id: string; name: string } | null } | null;
            }>;
          };
        };
      }>;
    };
  }>(Q, { variables: { q: query } });
  const edges = res.data?.orders.edges ?? [];
  console.log(`\n══ #${name} ══ (${edges.length} match)`);
  for (const e of edges) {
    const o = e.node;
    const a = o.shippingAddress;
    const ld = o.tags.filter((t) => t.startsWith("ld_")).join(",") || "(none)";
    console.log(`  ${o.name}  ${o.displayFulfillmentStatus}  created=${o.createdAt.slice(0, 10)}`);
    console.log(`    addr: ${a?.address1 ?? ""} | ${a?.address2 ?? ""} | ${a?.city ?? ""} ${a?.zip ?? ""}`);
    console.log(`    geo: ${a?.latitude ?? "null"}, ${a?.longitude ?? "null"}`);
    console.log(`    ld tags: ${ld}`);
    console.log(`    other tags: ${o.tags.filter((t) => !t.startsWith("ld_")).join(",") || "(none)"}`);
    for (const f of o.fulfillmentOrders.nodes) {
      console.log(
        `    fo: status=${f.status}  method=${f.deliveryMethod?.methodType ?? "?"}  loc=${f.assignedLocation?.location?.name ?? "?"} (${f.assignedLocation?.location?.id?.split("/").pop() ?? "?"})`,
      );
    }
  }
}

await prisma.$disconnect();
