import "dotenv/config";
import { getShopifyClient } from "../../clients/shopify.js";
import { prisma } from "../../db/prisma.js";

const tenant = await prisma.integrationTenant.findUnique({
  where: { slug: "gebeauty" },
});
if (!tenant?.shopifyShop) throw new Error("tenant gebeauty missing");
const client = await getShopifyClient({
  ssmPrefix: tenant.ssmPrefix,
  shopifyShop: tenant.shopifyShop,
});

const QUERY = /* GraphQL */ `
  query Diag($q: String!) {
    orders(first: 10, query: $q, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          tags
          updatedAt
          shippingAddress { city }
          fulfillmentOrders(first: 5) {
            nodes { assignedLocation { location { id } } }
          }
        }
      }
    }
  }
`;

const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000)
  .toISOString()
  .slice(0, 10);

// Try four different searches to triangulate where it breaks.
const searches: Array<{ label: string; q: string }> = [
  { label: "any tag:ld_rota-01 (active)", q: "tag:ld_rota-01" },
  { label: "any tag containing rota (impossible? control)", q: "tag:ld_rota-01_26.04.30" },
  {
    label: "location_id:97784398144 + updated_at",
    q: `location_id:97784398144 updated_at:>=${sevenDaysAgo}`,
  },
  {
    label: "no filter, just updated_at last 7 days",
    q: `updated_at:>=${sevenDaysAgo}`,
  },
];

for (const s of searches) {
  console.log(`\n──── ${s.label} ── q: ${s.q}`);
  const res = await client.request<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          tags: string[];
          updatedAt: string;
          shippingAddress: { city: string | null } | null;
          fulfillmentOrders: {
            nodes: Array<{
              assignedLocation: { location: { id: string } | null } | null;
            }>;
          };
        };
      }>;
    };
  }>(QUERY, { variables: { q: s.q } });
  const edges = res.data?.orders.edges ?? [];
  console.log(`  → ${edges.length} orders`);
  for (const e of edges.slice(0, 5)) {
    const locs = e.node.fulfillmentOrders.nodes
      .map((n) => n.assignedLocation?.location?.id)
      .filter(Boolean)
      .map((g) => g!.split("/").pop());
    const ldTags = e.node.tags.filter((t) => /^ld_rota/.test(t));
    console.log(
      `    ${e.node.name}  upd=${e.node.updatedAt.slice(0, 10)}  loc=${locs.join(",")}  city=${e.node.shippingAddress?.city ?? "—"}  ld_tags=${ldTags.join(",")}`,
    );
  }
}

await prisma.$disconnect();
