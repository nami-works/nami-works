import "dotenv/config";
import { parseArgs } from "node:util";
import { getShopifyClient } from "../../clients/shopify.js";
import { prisma } from "../../db/prisma.js";
import { fetchHistoricalBatches } from "../history/fetch.js";
import { upsertBatches } from "../history/persist.js";

/**
 * CLI: pull the last N days of LD batches for a tenant and persist to
 * `LdSimBatch`. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx src/local-delivery/scripts/fetch-history.ts --tenant gebeauty --days 30
 *   npx tsx src/local-delivery/scripts/fetch-history.ts --tenant gebeauty --days 7 --location gid://shopify/Location/97784398144
 */

function die(message: string, code = 1): never {
  console.error(`[fetch-history] ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    days: { type: "string" },
    location: { type: "string" },
  },
  strict: true,
});

const slug = values.tenant;
const days = parseInt(values.days ?? "30", 10);
if (!slug) die("--tenant <slug> is required");
if (!Number.isFinite(days) || days <= 0 || days > 365) {
  die("--days must be a positive integer ≤ 365");
}

const tenant = await prisma.integrationTenant.findUnique({
  where: { slug },
});
if (!tenant) die(`tenant "${slug}" not found`);
if (!tenant.shopifyShop) die(`tenant "${slug}" has no shopifyShop configured`);

const client = await getShopifyClient({
  ssmPrefix: tenant.ssmPrefix,
  shopifyShop: tenant.shopifyShop,
});

const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
if (!apiKey) {
  console.warn(
    "[fetch-history] GOOGLE_MAPS_API_KEY missing — orders without Shopify-side coords will be skipped from geocoding fallback",
  );
}

const args: Parameters<typeof fetchHistoricalBatches>[0] = {
  client,
  days,
  ...(values.location ? { locationId: values.location } : {}),
  ...(apiKey ? { googleMapsApiKey: apiKey } : {}),
};

console.log(
  `[fetch-history] tenant=${slug} days=${days}${
    values.location ? ` location=${values.location}` : ""
  } — fetching…`,
);

const batches = await fetchHistoricalBatches(args);
console.log(`[fetch-history] fetched ${batches.length} batches`);

if (batches.length === 0) {
  console.log("[fetch-history] nothing to persist");
  process.exit(0);
}

const result = await upsertBatches(tenant.id, batches);
console.log(
  `[fetch-history] persisted: created=${result.created} updated=${result.updated}`,
);

const summary = batches
  .map(
    (b) =>
      `  ${b.date} ${b.locationName.padEnd(18)} orders=${b.orders.length} routes=${b.routes.length}`,
  )
  .join("\n");
console.log(`[fetch-history] batches:\n${summary}`);

await prisma.$disconnect();
