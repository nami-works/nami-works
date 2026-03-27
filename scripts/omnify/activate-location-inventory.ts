import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type LocationNode = {
  id: string;
  name: string;
};

type InventoryItemNode = {
  id: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const SHOP_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.SHOPIFY_SHOP_DOMAIN ||
  process.env.SHOPIFY_STORE ||
  "";
const ADMIN_TOKEN =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ACCESS_TOKEN ||
  "";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const printIds = args.includes("--print-ids");
const limitVariantsArg = args.find((arg) => arg.startsWith("--limit-variants="));
const limitLocationsArg = args.find((arg) => arg.startsWith("--limit-locations="));
const quantityArg = args.find((arg) => arg.startsWith("--quantity="));
const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="));
const locationIdsArg = args.find((arg) => arg.startsWith("--location-ids="));
const setQuantity = args.includes("--set-quantity");

const limitVariants = limitVariantsArg
  ? Number(limitVariantsArg.split("=")[1])
  : undefined;
const limitLocations = limitLocationsArg
  ? Number(limitLocationsArg.split("=")[1])
  : undefined;
const quantity = quantityArg ? Number(quantityArg.split("=")[1]) : 1;
const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 3;
const locationIdsFilter = locationIdsArg
  ? locationIdsArg
      .split("=")[1]
      ?.split(",")
      .map((id) => id.trim())
      .filter(Boolean) ?? []
  : [];

const requireEnv = () => {
  if (!SHOP_DOMAIN) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN.");
  }
  if (!ADMIN_TOKEN) {
    throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN.");
  }
};

const shopifyGraphql = async <T>(query: string, variables?: Record<string, any>) => {
  const response = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify GraphQL failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as ShopifyGraphqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(", "));
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data.");
  }
  return json.data;
};

const fetchAllLocations = async (): Promise<LocationNode[]> => {
  const nodes: LocationNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: {
      locations: {
        nodes: LocationNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await shopifyGraphql(
      `#graphql
        query Locations($first: Int!, $after: String) {
          locations(first: $first, after: $after) {
            nodes {
              id
              name
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { first: 50, after: cursor },
    );

    nodes.push(...data.locations.nodes);
    hasNextPage = data.locations.pageInfo.hasNextPage;
    cursor = data.locations.pageInfo.endCursor;

    if (limitLocations && nodes.length >= limitLocations) {
      return nodes.slice(0, limitLocations);
    }
  }

  return nodes;
};

const fetchAllInventoryItems = async (): Promise<InventoryItemNode[]> => {
  const nodes: InventoryItemNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: {
      productVariants: {
        nodes: Array<{ inventoryItem: InventoryItemNode | null }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await shopifyGraphql(
      `#graphql
        query InventoryItems($first: Int!, $after: String) {
          productVariants(first: $first, after: $after) {
            nodes {
              inventoryItem {
                id
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { first: 100, after: cursor },
    );

    data.productVariants.nodes.forEach((variant: { inventoryItem: InventoryItemNode | null }) => {
      if (variant.inventoryItem?.id) {
        nodes.push({ id: variant.inventoryItem.id });
      }
    });
    hasNextPage = data.productVariants.pageInfo.hasNextPage;
    cursor = data.productVariants.pageInfo.endCursor;

    if (limitVariants && nodes.length >= limitVariants) {
      return nodes.slice(0, limitVariants);
    }
  }

  return nodes;
};

const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
) => {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      await task(items[currentIndex]!, currentIndex);
    }
  });
  await Promise.all(workers);
};

const activateInventoryItem = async (locationId: string, inventoryItemId: string) => {
  const data = await shopifyGraphql<{
    inventoryActivate: {
      inventoryLevel: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    `#graphql
      mutation ActivateInventory(
        $inventoryItemId: ID!
        $locationId: ID!
        $available: Int
      ) {
        inventoryActivate(
          inventoryItemId: $inventoryItemId
          locationId: $locationId
          available: $available
        ) {
          inventoryLevel {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { inventoryItemId, locationId, available: quantity },
  );

  return data.inventoryActivate.userErrors;
};

const setInventoryQuantity = async (
  locationId: string,
  inventoryItemId: string,
  availableQuantity: number,
) => {
  const data = await shopifyGraphql<{
    inventorySetQuantities: {
      inventoryAdjustmentGroup: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    `#graphql
      mutation SetInventoryQuantities(
        $input: InventorySetQuantitiesInput!
      ) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [
          {
            inventoryItemId,
            locationId,
            quantity: availableQuantity,
          },
        ],
      },
    },
  );

  return data.inventorySetQuantities.userErrors;
};

const isAlreadyStockedError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("already stocked") ||
    lowered.includes("already activated") ||
    lowered.includes("already active")
  );
};

const isNotStockedError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("not stocked") ||
    lowered.includes("isn't stocked") ||
    lowered.includes("does not exist at location")
  );
};

const main = async () => {
  requireEnv();

  const [locations, inventoryItems] = await Promise.all([
    fetchAllLocations(),
    fetchAllInventoryItems(),
  ]);

  const filteredLocations =
    locationIdsFilter.length === 0
      ? locations
      : locations.filter((location) => locationIdsFilter.includes(location.id));

  if (filteredLocations.length === 0) {
    throw new Error("No locations matched the provided filters.");
  }

  if (inventoryItems.length === 0) {
    throw new Error("No inventory items found.");
  }

  if (printIds) {
    console.log("Locations:");
    filteredLocations.forEach((location) => {
      console.log(`- ${location.name}: ${location.id}`);
    });
    console.log(`Inventory items: ${inventoryItems.length}`);
    inventoryItems.slice(0, 50).forEach((item) => console.log(`- ${item.id}`));
    if (inventoryItems.length > 50) {
      console.log("... truncated (pass --limit-variants to reduce)");
    }
  }

  if (dryRun) {
    console.log(
      `Dry run: would activate ${inventoryItems.length} items for ${filteredLocations.length} locations.`,
    );
    return;
  }

  for (const location of filteredLocations) {
    let activated = 0;
    let skipped = 0;
    let failed = 0;

    console.log(
      `Activating inventory for ${location.name} (${location.id})...`,
    );

    await runWithConcurrency(inventoryItems, concurrency, async (item, idx) => {
      try {
        if (setQuantity) {
          const errors = await setInventoryQuantity(
            location.id,
            item.id,
            quantity,
          );
          if (errors.length === 0) {
            activated += 1;
            return;
          }
          const requiresActivation = errors.some((error) =>
            isNotStockedError(error.message),
          );
          if (requiresActivation) {
            const activateErrors = await activateInventoryItem(
              location.id,
              item.id,
            );
            const remainingErrors = activateErrors.filter(
              (error) => !isAlreadyStockedError(error.message),
            );
            if (remainingErrors.length === 0) {
              activated += 1;
              return;
            }
            failed += 1;
            console.error(
              `Activation error (${location.name}, item ${idx + 1}): ${remainingErrors
                .map((error) => error.message)
                .join(", ")}`,
            );
            return;
          }
          failed += 1;
          console.error(
            `Set quantity error (${location.name}, item ${idx + 1}): ${errors
              .map((error) => error.message)
              .join(", ")}`,
          );
          return;
        }

        const errors = await activateInventoryItem(location.id, item.id);
        if (errors.length === 0) {
          activated += 1;
          return;
        }
        const onlyAlreadyStocked = errors.every((error) =>
          isAlreadyStockedError(error.message),
        );
        if (onlyAlreadyStocked) {
          skipped += 1;
          return;
        }
        failed += 1;
        console.error(
          `Activation error (${location.name}, item ${idx + 1}): ${errors
            .map((error) => error.message)
            .join(", ")}`,
        );
      } catch (error) {
        failed += 1;
        console.error(
          `Activation failed (${location.name}, item ${idx + 1}):`,
          error,
        );
      }
    });

    console.log(
      `Done ${location.name}: activated=${activated}, skipped=${skipped}, failed=${failed}`,
    );
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
