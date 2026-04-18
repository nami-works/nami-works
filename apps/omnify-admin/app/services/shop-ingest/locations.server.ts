/**
 * Shop Ingest — canonical location write path.
 *
 * Locations don't fire webhooks reliably, so the pattern here is:
 * fetch from Shopify on demand → upsert all locations for a shop in one call.
 * Called by:
 *   1. A daily refresh cron (phase 3)
 *   2. Any feature that needs a fresh location list (bypass in-memory caches)
 *
 * Stores a derived `isRetailStore` flag based on `localPickupSettingsV2 != null`,
 * the canonical Shopify signal for "physical retail presence" (per CLAUDE.md).
 */

import prisma from "../../db.server";
import { toJsonInput } from "./json-helpers";

export type ShopLocationIngestSource = "webhook" | "reconcile" | "backfill";

type UnknownRecord = Record<string, unknown>;

const asString = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
};

const asBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  return false;
};

const LOCATIONS_QUERY = `#graphql
  query ShopIngestLocations($first: Int!) {
    locations(first: $first) {
      nodes {
        id
        name
        isActive
        fulfillsOnlineOrders
        localPickupSettingsV2 { pickupTime }
        address {
          address1
          address2
          city
          province
          provinceCode
          country
          countryCode
          zip
          phone
          latitude
          longitude
        }
      }
    }
  }`;

interface ShopLocationNode {
  id: string;
  name?: string | null;
  isActive?: boolean | null;
  fulfillsOnlineOrders?: boolean | null;
  localPickupSettingsV2?: { pickupTime?: string | null } | null;
  address?: UnknownRecord | null;
}

/**
 * Fetch all locations from Shopify and upsert into `ShopLocation`. Returns
 * the list of canonicalized rows that were written.
 */
export async function ingestAllLocations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  source: ShopLocationIngestSource,
): Promise<{ count: number; rows: Array<{ id: string; name: string }> }> {
  const response = await admin.graphql(LOCATIONS_QUERY, {
    variables: { first: 50 },
  });
  const json = await response.json();
  const nodes: ShopLocationNode[] = json?.data?.locations?.nodes ?? [];

  const rows: Array<{ id: string; name: string }> = [];
  for (const node of nodes) {
    const gid = asString(node.id);
    if (!gid) continue;
    const legacyId = gid.replace("gid://shopify/Location/", "");
    const name = asString(node.name) ?? "(unnamed)";
    const isActive = node.isActive ?? true;
    const fulfillsOnlineOrders = node.fulfillsOnlineOrders ?? false;
    const localPickupEnabled = node.localPickupSettingsV2 != null;
    const isRetailStore = localPickupEnabled; // canonical signal per CLAUDE.md

    const addressJson = toJsonInput(node.address);
    await prisma.shopLocation.upsert({
      where: { shop_id: { shop, id: gid } },
      create: {
        shop,
        id: gid,
        legacyId,
        name,
        addressJson,
        isActive: asBool(isActive),
        fulfillsOnlineOrders: asBool(fulfillsOnlineOrders),
        localPickupEnabled,
        isRetailStore,
        ingestedVia: source,
      },
      update: {
        legacyId,
        name,
        addressJson,
        isActive: asBool(isActive),
        fulfillsOnlineOrders: asBool(fulfillsOnlineOrders),
        localPickupEnabled,
        isRetailStore,
        ingestedVia: source,
      },
    });
    rows.push({ id: gid, name });
  }

  await prisma.shopIngestMeta.upsert({
    where: { shop },
    create: { shop, locationsLastRefreshedAt: new Date() },
    update: { locationsLastRefreshedAt: new Date() },
  });

  console.info(
    `[shop-ingest:locations] refresh OK shop=${shop} count=${rows.length} source=${source}`,
  );
  return { count: rows.length, rows };
}
