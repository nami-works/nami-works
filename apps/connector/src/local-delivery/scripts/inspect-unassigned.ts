import "dotenv/config";
import { parseArgs } from "node:util";
import { getShopifyClient } from "../../clients/shopify.js";
import { prisma } from "../../db/prisma.js";

const { values } = parseArgs({
  options: { batch: { type: "string" } },
  strict: true,
});
const batchId = parseInt(values.batch ?? "0", 10);
if (!Number.isFinite(batchId) || batchId <= 0) {
  console.error("--batch <id> required");
  process.exit(1);
}

const batch = await prisma.ldSimBatch.findUnique({ where: { id: batchId } });
if (!batch) {
  console.error(`batch ${batchId} not found`);
  process.exit(1);
}

const payload = batch.payload as unknown as {
  unassigned?: string[];
  routes: Array<{ orderIds: string[] }>;
};
const ids = payload.unassigned ?? [];
console.log(`Batch ${batchId} (${batch.locationName}) — ${ids.length} unassigned`);

const tenant = await prisma.integrationTenant.findUnique({
  where: { slug: "gebeauty" },
});
const client = await getShopifyClient({
  ssmPrefix: tenant!.ssmPrefix,
  shopifyShop: tenant!.shopifyShop!,
});

const Q = /* GraphQL */ `
  query Get($id: ID!) {
    order(id: $id) {
      id name tags displayFulfillmentStatus
      shippingAddress { address1 address2 zip city province latitude longitude }
      createdAt
    }
  }
`;

for (const id of ids) {
  const res = await client.request<{
    order: {
      id: string;
      name: string;
      tags: string[];
      displayFulfillmentStatus: string;
      shippingAddress: {
        address1: string | null;
        address2: string | null;
        zip: string | null;
        city: string | null;
        province: string | null;
        latitude: number | null;
        longitude: number | null;
      } | null;
      createdAt: string;
    } | null;
  }>(Q, { variables: { id } });
  const o = res.data?.order;
  if (!o) continue;
  const ldTags = o.tags.filter((t) => t.startsWith("ld_")).join(",") || "(none)";
  const a = o.shippingAddress;
  const geo = a?.latitude != null ? "✓" : "✗";
  console.log(
    `${o.name.padEnd(8)}  ${o.displayFulfillmentStatus.padEnd(12)}  geo=${geo}  ld=[${ldTags}]`,
  );
  console.log(
    `         ${a?.address1 ?? ""} | ${a?.address2 ?? ""} | ${a?.city ?? ""} ${a?.zip ?? ""}`,
  );
}

await prisma.$disconnect();
