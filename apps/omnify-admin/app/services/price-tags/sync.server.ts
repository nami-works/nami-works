import prisma from "../../db.server";
import {
  computeVariantDiscount,
  resolveProductDiscount,
  matchTier,
  type DiscountMode,
  type TierInput,
} from "./discount.server";
import {
  fetchMetaobjectEntries,
  buildHandleGidMap,
  ensureMetaobjectEntry,
} from "./metaobject.server";
import { findProductMetafieldForMetaobjectType, type MetafieldRefType } from "./metafield.server";

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export interface SyncResult {
  processed: number;
  updated: number;
  cleared: number;
  created: number;
}

// ---------------------------------------------------------------------------
// Auto-label helpers
// ---------------------------------------------------------------------------

function needsAtePrefix(
  variants: Array<{ price: number; compareAtPrice: number | null }>,
): boolean {
  const keys = new Set<string>();
  for (const v of variants) {
    const d = computeVariantDiscount(v.price, v.compareAtPrice);
    if (d.dollar > 0) {
      keys.add(`${Math.floor(d.dollar)}:${Math.floor(d.percent)}`);
    }
  }
  return keys.size > 1;
}

function generateAutoLabel(
  dollar: number,
  percent: number,
  ate: boolean,
): { text: string; handle: string } | null {
  if (dollar <= 0 && percent <= 0) return null;
  const rd = Math.floor(dollar);
  const rp = Math.floor(percent);
  const prefix = ate ? "até " : "";
  const hPrefix = ate ? "ate-" : "";
  if (rd >= rp) {
    return { text: `${prefix}R$${rd} off`, handle: `${hPrefix}r-${rd}-off` };
  }
  return { text: `${prefix}${rp}% off`, handle: `${hPrefix}${rp}-percent-off` };
}

// ---------------------------------------------------------------------------
// List metafield helpers
// ---------------------------------------------------------------------------

async function getProductMetafieldValue(
  admin: AdminClient,
  productGid: string,
  namespace: string,
  key: string,
  mfType: MetafieldRefType,
): Promise<string[]> {
  const response = await admin.graphql(
    `#graphql
    query ProductMetafield($id: ID!, $ns: String!, $key: String!) {
      product(id: $id) {
        metafield(namespace: $ns, key: $key) { value }
      }
    }`,
    { variables: { id: productGid, ns: namespace, key } },
  );
  const json = await response.json();
  const mf = json.data?.product?.metafield;
  if (!mf?.value) return [];
  if (mfType === "metaobject_reference") {
    const gid = mf.value.trim();
    return gid.startsWith("gid://") ? [gid] : [];
  }
  try {
    return JSON.parse(mf.value) as string[];
  } catch {
    return [];
  }
}

async function setProductMetafieldValue(
  admin: AdminClient,
  productGid: string,
  namespace: string,
  key: string,
  gids: string[],
  mfType: MetafieldRefType,
): Promise<void> {
  if (gids.length === 0) {
    await admin.graphql(
      `#graphql
      mutation DeleteMetafield($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields { ownerId }
          userErrors { field message }
        }
      }`,
      { variables: { metafields: [{ ownerId: productGid, namespace, key }] } },
    );
    return;
  }
  const value = mfType === "metaobject_reference" ? gids[0] : JSON.stringify(gids);
  await admin.graphql(
    `#graphql
    mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [{
          ownerId: productGid, namespace, key,
          value,
        }],
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Core sync
// ---------------------------------------------------------------------------

function parseTierRuleRow(row: {
  discountType: string;
  startingAt: number;
  metaobjectHandles: string;
  metaobjectGids: string;
  sortOrder: number;
}): TierInput {
  return {
    discountType: row.discountType as "percent" | "dollar",
    startingAt: row.startingAt,
    metaobjectHandles: JSON.parse(row.metaobjectHandles) as string[],
    metaobjectGids: JSON.parse(row.metaobjectGids) as string[],
    sortOrder: row.sortOrder,
  };
}

export async function runFullSync(
  admin: AdminClient,
  shop: string,
): Promise<SyncResult> {
  const config = await prisma.priceTagConfig.findUnique({ where: { shop } });
  if (!config || !config.metaobjectType) {
    return { processed: 0, updated: 0, cleared: 0, created: 0 };
  }

  const fieldDefaults: Record<string, string> = JSON.parse(config.metaobjectFieldDefaults || "{}");
  const displayNameKey = config.displayNameKey || "";

  const tierRows = await prisma.priceTagTierRule.findMany({
    where: { shop },
    orderBy: { sortOrder: "asc" },
  });

  const tiersWithHandles = tierRows.filter((r) => {
    const handles = JSON.parse(r.metaobjectHandles) as string[];
    return handles.length > 0 && handles.some((h) => h.trim() !== "");
  });
  const useCustomTiers = tiersWithHandles.length > 0;
  const tiers = useCustomTiers ? tiersWithHandles.map(parseTierRuleRow) : [];
  const mode = config.discountMode as DiscountMode;
  const dollarThreshold = config.dollarThreshold ?? undefined;

  const entries = await fetchMetaobjectEntries(admin, config.metaobjectType);
  const handleToGid = buildHandleGidMap(entries);
  const gidToHandle = new Map<string, string>();
  for (const e of entries) gidToHandle.set(e.gid, e.handle);

  // Resolve metafield ns/key/type from the store definition, falling back to DB config
  const mfDef = await findProductMetafieldForMetaobjectType(admin, config.metaobjectType);
  const mfNs = mfDef?.namespace ?? config.metafieldNamespace;
  const mfKey = mfDef?.key ?? config.metafieldKey;
  const mfType: MetafieldRefType = mfDef?.type ?? "list.metaobject_reference";
  console.log(`[price-tags] sync resolved metafield: ${mfNs}.${mfKey} (${mfType})${mfDef ? " from store definition" : " from DB config fallback"}`);

  if (!mfNs || !mfKey) {
    console.error(`[price-tags] No metafield namespace/key resolved for shop=${shop} — create a product metafield definition referencing metaobject type "${config.metaobjectType}" in Shopify admin`);
    return { processed: 0, updated: 0, cleared: 0, created: 0 };
  }

  const result: SyncResult = { processed: 0, updated: 0, cleared: 0, created: 0 };

  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query ActiveProducts($cursor: String) {
        products(first: 50, query: "status:active", after: $cursor) {
          edges {
            node {
              id
              variants(first: 100) {
                edges { node { price compareAtPrice } }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { cursor } },
    );

    const json = await response.json();
    const data = json.data?.products;
    if (!data) break;

    for (const productEdge of data.edges) {
      const product = productEdge.node;
      result.processed++;

      const variants = product.variants.edges.map(
        (v: { node: { price: string; compareAtPrice: string | null } }) => ({
          price: parseFloat(v.node.price),
          compareAtPrice: v.node.compareAtPrice
            ? parseFloat(v.node.compareAtPrice)
            : null,
        }),
      );

      const discount = resolveProductDiscount(variants, mode, dollarThreshold);

      if (useCustomTiers) {
        const tier = matchTier(discount.effectiveValue, discount.effectiveType, tiers);
        if (tier && tier.metaobjectHandles.length > 0) {
          const handle = tier.metaobjectHandles[0];
          const gid = handleToGid.get(handle);
          if (gid) {
            await setProductMetafieldValue(
              admin, product.id,
              mfNs, mfKey,
              [gid], mfType,
            );
            result.updated++;
            await upsertLog(shop, product.id, true, handle);
          }
        } else {
          const cleared = await clearDiscountLabels(
            admin, shop, product.id,
            mfNs, mfKey,
            gidToHandle, mfType,
          );
          if (cleared) result.cleared++;
        }
      } else {
        const ate = needsAtePrefix(variants);
        const label = generateAutoLabel(discount.dollar, discount.percent, ate);

        if (!label) {
          const cleared = await clearDiscountLabels(
            admin, shop, product.id,
            mfNs, mfKey,
            gidToHandle, mfType,
          );
          if (cleared) result.cleared++;
          continue;
        }

        const { gid: labelGid, created } = await ensureMetaobjectEntry(
          admin, config.metaobjectType,
          label.handle, label.text,
          handleToGid,
          fieldDefaults, displayNameKey,
        );
        if (created) {
          gidToHandle.set(labelGid, label.handle);
          result.created++;
        }

        const currentGids = await getProductMetafieldValue(
          admin, product.id,
          mfNs, mfKey,
          mfType,
        );

        const nonDiscountGids = currentGids.filter((gid) => {
          const h = gidToHandle.get(gid);
          return !h || !h.includes("-off");
        });

        const currentDiscountGids = currentGids.filter((gid) => {
          const h = gidToHandle.get(gid);
          return h && h.includes("-off");
        });

        if (currentDiscountGids.length === 1 && currentDiscountGids[0] === labelGid) {
          continue;
        }

        const newGids = [...nonDiscountGids, labelGid];
        await setProductMetafieldValue(
          admin, product.id,
          mfNs, mfKey,
          newGids, mfType,
        );
        result.updated++;
        await upsertLog(shop, product.id, true, label.handle);
      }
    }

    hasNextPage = data.pageInfo.hasNextPage;
    cursor = data.pageInfo.endCursor;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDiscountLabels(
  admin: AdminClient,
  shop: string,
  productGid: string,
  namespace: string,
  key: string,
  gidToHandle: Map<string, string>,
  mfType: MetafieldRefType,
): Promise<boolean> {
  const currentGids = await getProductMetafieldValue(admin, productGid, namespace, key, mfType);
  const discountGids = currentGids.filter((gid) => {
    const h = gidToHandle.get(gid);
    return h && h.includes("-off");
  });
  if (discountGids.length === 0) return false;

  const remaining = currentGids.filter((gid) => !discountGids.includes(gid));
  await setProductMetafieldValue(admin, productGid, namespace, key, remaining, mfType);
  await upsertLog(shop, productGid, false, null);
  return true;
}

async function upsertLog(
  shop: string,
  productGid: string,
  metafieldSet: boolean,
  lastTierHandle: string | null,
): Promise<void> {
  await prisma.priceTagProductLog.upsert({
    where: { shop_productGid: { shop, productGid } },
    create: { shop, productGid, metafieldSet, lastTierHandle, lastProcessedAt: new Date() },
    update: { metafieldSet, lastTierHandle, lastProcessedAt: new Date() },
  });
}
