/**
 * Debug script to inspect what the deliveryProfiles API returns.
 * Run with: npx tsx scripts/debug-delivery-profiles.ts
 * Loads SHOP and token from .env (supports SHOP, SHOPIFY_STORE_DOMAIN, etc.)
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const query = `#graphql
  query LocalDeliveryZonesByLocation {
    deliveryProfiles(first: 20, merchantOwnedOnly: false) {
      nodes {
        id
        name
        default
        profileLocationGroups {
          locationGroup {
            id
            locations(first: 50) {
              nodes {
                id
                name
              }
            }
          }
          locationGroupZones(first: 50) {
            nodes {
              zone {
                id
                name
              }
              methodDefinitions(first: 10) {
                nodes {
                  id
                  name
                  description
                  rateProvider {
                    __typename
                    ... on DeliveryRateDefinition {
                      price {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function main() {
  const shop =
    process.env.SHOP ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    process.env.SHOPIFY_STORE;
  const token =
    process.env.SHOPIFY_ACCESS_TOKEN ||
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.SHOPIFY_API_ACCESS_TOKEN;
  if (!shop || !token) {
    console.error(
      "Add SHOP (or SHOPIFY_STORE_DOMAIN) and SHOPIFY_ACCESS_TOKEN (or SHOPIFY_ADMIN_ACCESS_TOKEN) to .env",
    );
    process.exit(1);
  }
  const shopDomain = shop.includes(".") ? shop : `${shop}.myshopify.com`;
  const url = `https://${shopDomain}/admin/api/2026-01/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as {
    data?: { deliveryProfiles?: { nodes?: unknown[] } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors) {
    console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
    return;
  }
  const nodes = json.data?.deliveryProfiles?.nodes ?? [];
  console.log("Profiles count:", nodes.length);
  for (const profile of nodes) {
    const p = profile as {
      id: string;
      name: string;
      default?: boolean;
      profileLocationGroups?: Array<{
        locationGroup?: {
          id: string;
          locations?: { nodes?: Array<{ id: string; name: string }> };
        };
        locationGroupZones?: {
          nodes?: Array<{
            zone?: { id: string; name: string };
            methodDefinitions?: {
              nodes?: Array<{
                id: string;
                name: string;
                description?: string;
                rateProvider?: { __typename?: string };
              }>;
            };
          }>;
        };
      }>;
    };
    console.log("\nProfile:", p.id, p.name, p.default ? "(default)" : "");
    for (const plg of p.profileLocationGroups ?? []) {
      const locs = plg.locationGroup?.locations?.nodes ?? [];
      console.log("  Location group:", plg.locationGroup?.id);
      console.log("  Locations:", locs.map((l) => `${l.name} (${l.id})`).join(", "));
      const zoneNodes = plg.locationGroupZones?.nodes ?? [];
      console.log("  Zones count:", zoneNodes.length);
      for (const zg of zoneNodes) {
        const z = zg.zone ?? zg;
        const methods = zg.methodDefinitions?.nodes ?? [];
        console.log(
          "    Zone:",
          (z as { name?: string }).name,
          "- methods:",
          methods.map((m) => m.name).join(", "),
        );
      }
    }
  }
}

main().catch(console.error);
