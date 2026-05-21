/**
 * Monthly refresh of sample rate database.
 * Discovers new quadrants from recent orders and updates prices.
 *
 * Run via cron or scheduler, e.g.:
 *   0 0 1 * * cd /path/to/omnify && node --import tsx scripts/refresh-sample-rates-monthly.ts
 *
 * Or manually:
 *   node --import tsx scripts/refresh-sample-rates-monthly.ts
 *   node --import tsx scripts/refresh-sample-rates-monthly.ts --shop=store.myshopify.com
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";

async function main() {
  const prisma = (await import("../app/db.server")).default;
  const { refreshSampleRatesMonthly } = await import(
    "../app/services/carrier/sample-rate-db.server"
  );

  const args = process.argv.slice(2);
  const shopArg = args.find((a) => a.startsWith("--shop="));
  const shopFilter = shopArg ? shopArg.split("=")[1]?.trim() : null;

  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!googleMapsApiKey) {
    console.warn("Missing GOOGLE_MAPS_API_KEY; sample rate refresh may fail.");
  }

  const shops = await prisma.carrierServiceConfig.findMany({
    where: shopFilter ? { shop: shopFilter } : undefined,
    select: { shop: true },
  });

  const shopsToProcess = [...new Set(shops.map((s: { shop: string }) => s.shop))];

  if (shopsToProcess.length === 0) {
    console.log("No shops with carrier config found.");
    return;
  }

  let processed = 0;
  let errors = 0;

  for (const shop of shopsToProcess as string[]) {
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
      orderBy: { id: "desc" },
    });

    if (!session?.accessToken) {
      console.warn(`No offline session for ${shop}; skipping.`);
      errors++;
      continue;
    }

    const admin = {
      graphql: async (query: string, opts?: { variables?: Record<string, unknown> }) => {
        const res = await fetch(
          `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": session.accessToken,
            },
            body: JSON.stringify({
              query,
              variables: opts?.variables ?? {},
            }),
          },
        );
        return res;
      },
    };

    try {
      const count = await refreshSampleRatesMonthly(admin, shop, {
        googleMapsApiKey: googleMapsApiKey ?? undefined,
      });
      console.log(`[${shop}] Refreshed ${count} sample rates.`);
      processed++;
    } catch (e) {
      console.error(`[${shop}] Sample rate refresh failed:`, e);
      errors++;
    }
  }

  console.log(`Done. Processed ${String(processed)} shops, ${String(errors)} errors.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
