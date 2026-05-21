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

// ---------------------------------------------------------------------------
// Helpers
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
  const rp = Math.ceil(percent);
  const prefix = ate ? "até " : "";
  const hPrefix = ate ? "ate-" : "";
  if (rd >= rp) {
    return { text: `${prefix}R$${rd} off`, handle: `${hPrefix}r-${rd}-off` };
  }
  return { text: `${prefix}${rp}% off`, handle: `${hPrefix}${rp}-percent-off` };
}

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
      product(id: $id) { metafield(namespace: $ns, key: $key) { value } }
    }`,
    { variables: { id: productGid, ns: namespace, key } },
  );
  const json = await response.json();
  const mf = json.data?.product?.metafield;
  if (!mf?.value) {
    console.log(`[price-tags] getProductMetafield ${productGid} → empty (no metafield)`);
    return [];
  }
  if (mfType === "metaobject_reference") {
    // Singular: value is a plain GID string
    const gid = mf.value.trim();
    console.log(`[price-tags] getProductMetafield ${productGid} → singular: ${gid}`);
    return gid.startsWith("gid://") ? [gid] : [];
  }
  // List: value is a JSON array
  try {
    const parsed = JSON.parse(mf.value) as string[];
    console.log(`[price-tags] getProductMetafield ${productGid} → list: ${parsed.length} entries`);
    return parsed;
  } catch {
    console.warn(`[price-tags] getProductMetafield ${productGid} → parse error, value:`, mf.value);
    return [];
  }
}

export async function setProductMetafieldValue(
  admin: AdminClient,
  productGid: string,
  namespace: string,
  key: string,
  gids: string[],
  mfType: MetafieldRefType,
): Promise<void> {
  console.log(`[price-tags] setProductMetafield product=${productGid} ns=${namespace} key=${key} type=${mfType} gids=${JSON.stringify(gids)}`);
  if (gids.length === 0) {
    const delResponse = await admin.graphql(
      `#graphql
      mutation DeleteMetafield($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields { ownerId }
          userErrors { field message }
        }
      }`,
      { variables: { metafields: [{ ownerId: productGid, namespace, key }] } },
    );
    const delJson = await delResponse.json();
    const delErrors = delJson.data?.metafieldsDelete?.userErrors ?? [];
    if (delErrors.length > 0) {
      console.error(`[price-tags] metafieldsDelete FAILED for ${productGid}:`, JSON.stringify(delErrors));
    }
    return;
  }
  const value = mfType === "metaobject_reference" ? gids[0] : JSON.stringify(gids);
  try {
    // Omit `type` — let Shopify infer from the existing metafield definition.
    // Passing `type` when a definition already exists can cause conflicts.
    const setResponse = await admin.graphql(
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
    const setJson = await setResponse.json();
    if (setJson.errors) {
      console.error(`[price-tags] metafieldsSet GQL ERROR for ${productGid}:`, JSON.stringify(setJson.errors));
    }
    const setErrors = setJson.data?.metafieldsSet?.userErrors ?? [];
    if (setErrors.length > 0) {
      console.error(`[price-tags] metafieldsSet userErrors for ${productGid}:`, JSON.stringify(setErrors));
      throw new Error(`metafieldsSet: ${setErrors[0].message}`);
    } else if (setJson.data?.metafieldsSet) {
      console.log(`[price-tags] metafieldsSet OK for ${productGid}`);
    }
  } catch (err: unknown) {
    // Shopify admin client throws GraphqlQueryError on top-level errors.
    // Narrow via inline shape — ESLint's no-explicit-any rule is satisfied
    // because we describe the fields we actually read.
    const e = err as {
      body?: {
        errors?: { graphQLErrors?: unknown[] };
        data?: { metafieldsSet?: { userErrors?: unknown[] } };
      };
      message?: string;
    };
    const gqlErrors = e?.body?.errors?.graphQLErrors ?? e?.body?.data?.metafieldsSet?.userErrors ?? [];
    const errMsg = gqlErrors.length > 0
      ? JSON.stringify(gqlErrors)
      : (e?.message ?? String(err));
    console.error(`[price-tags] metafieldsSet THREW for ${productGid}: ${errMsg}`);
    throw new Error(`metafieldsSet failed: ${errMsg}`);
  }
}

export async function clearDiscountLabels(
  admin: AdminClient,
  shop: string,
  productGid: string,
  namespace: string,
  key: string,
  gidToHandle: Map<string, string>,
  mfType: MetafieldRefType,
): Promise<void> {
  const currentGids = await getProductMetafieldValue(admin, productGid, namespace, key, mfType);
  const discountGids = currentGids.filter((gid) => {
    const h = gidToHandle.get(gid);
    return h && h.includes("-off");
  });
  if (discountGids.length === 0) return;

  const remaining = currentGids.filter((gid) => !discountGids.includes(gid));
  await setProductMetafieldValue(admin, productGid, namespace, key, remaining, mfType);
  await upsertLog(shop, productGid, false, null);
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

// ---------------------------------------------------------------------------
// Webhook handler: single product update
// ---------------------------------------------------------------------------

export interface ProductUpdateResult {
  action: "labeled" | "cleared" | "skipped";
  tagCreated: string | null;
  tagAssigned: string | null;
}

export async function handleProductUpdate(
  admin: AdminClient,
  shop: string,
  productGid: string,
): Promise<ProductUpdateResult> {
  const skip: ProductUpdateResult = { action: "skipped", tagCreated: null, tagAssigned: null };
  console.log(`[price-tags] handleProductUpdate START product=${productGid} shop=${shop}`);

  // Guard 1: Skip if product is managed by an active campaign
  const campaignItem = await prisma.bulkPriceCampaignItem.findFirst({
    where: { shop, productGid, campaign: { status: "active" } },
  });
  if (campaignItem) {
    console.info(`[price-tags:webhook] SKIP product=${productGid} reason=active-campaign`);
    return skip;
  }

  // Guard 2: Skip if webhook sync is disabled for this shop
  const config = await prisma.priceTagConfig.findUnique({ where: { shop } });
  if (!config?.webhookSyncEnabled) {
    console.info(`[price-tags:webhook] SKIP product=${productGid} reason=sync-disabled`);
    return skip;
  }

  if (!config.metaobjectType) {
    console.warn(`[price-tags] No metaobject type configured for shop=${shop}`);
    return skip;
  }

  const mode = config.discountMode as DiscountMode;
  const dollarThreshold = config.dollarThreshold ?? undefined;
  const fieldDefaults: Record<string, string> = JSON.parse(config.metaobjectFieldDefaults || "{}");
  const displayNameKey = config.displayNameKey || "";

  // Fetch product variants
  const response = await admin.graphql(
    `#graphql
    query ProductWithVariants($id: ID!) {
      product(id: $id) {
        id
        variants(first: 100) {
          edges { node { price compareAtPrice } }
        }
      }
    }`,
    { variables: { id: productGid } },
  );

  const json = await response.json();
  const product = json.data?.product;
  if (!product) return skip;

  const variants = product.variants.edges.map(
    (v: { node: { price: string; compareAtPrice: string | null } }) => ({
      price: parseFloat(v.node.price),
      compareAtPrice: v.node.compareAtPrice ? parseFloat(v.node.compareAtPrice) : null,
    }),
  );

  const discount = resolveProductDiscount(variants, mode, dollarThreshold);
  console.log(`[price-tags] product=${productGid} discount: dollar=${discount.dollar.toFixed(2)} percent=${discount.percent.toFixed(1)}% effective=${discount.effectiveValue.toFixed(2)} type=${discount.effectiveType}`);

  // Build entry caches
  const allEntries = await fetchMetaobjectEntries(admin, config.metaobjectType);
  const handleToGid = buildHandleGidMap(allEntries);
  const gidToHandle = new Map<string, string>();
  for (const e of allEntries) gidToHandle.set(e.gid, e.handle);

  // Check for custom tier rules
  const tierRows = await prisma.priceTagTierRule.findMany({
    where: { shop },
    orderBy: { sortOrder: "asc" },
  });
  const tiersWithHandles = tierRows.filter((r) => {
    const handles = JSON.parse(r.metaobjectHandles) as string[];
    return handles.length > 0 && handles.some((h) => h.trim() !== "");
  });

  // Resolve metafield ns/key/type from the store definition, falling back to DB config
  const mfDef = await findProductMetafieldForMetaobjectType(admin, config.metaobjectType);
  const ns = mfDef?.namespace ?? config.metafieldNamespace;
  const key = mfDef?.key ?? config.metafieldKey;
  const mfType: MetafieldRefType = mfDef?.type ?? "list.metaobject_reference";
  console.log(`[price-tags] resolved metafield: ${ns}.${key} (${mfType})${mfDef ? " from store definition" : " from DB config fallback"}`);

  if (!ns || !key) {
    console.error(`[price-tags] No metafield namespace/key resolved for shop=${shop} — create a product metafield definition referencing metaobject type "${config.metaobjectType}" in Shopify admin`);
    return skip;
  }

  if (tiersWithHandles.length > 0) {
    // ---------- Custom tier-based ----------
    const tiers: TierInput[] = tiersWithHandles.map((row) => ({
      discountType: row.discountType as "percent" | "dollar",
      startingAt: row.startingAt,
      metaobjectHandles: JSON.parse(row.metaobjectHandles) as string[],
      metaobjectGids: JSON.parse(row.metaobjectGids) as string[],
      sortOrder: row.sortOrder,
    }));

    const tier = matchTier(discount.effectiveValue, discount.effectiveType, tiers);

    if (tier && tier.metaobjectHandles.length > 0) {
      const handle = tier.metaobjectHandles[0];
      const gid = handleToGid.get(handle);
      if (gid) {
        const currentGids = await getProductMetafieldValue(admin, productGid, ns, key, mfType);
        if (currentGids.length === 1 && currentGids[0] === gid) {
          console.info(`[price-tags] metafield unchanged for ${productGid}, skip write`);
          return { action: "labeled", tagCreated: null, tagAssigned: handle };
        }
        await setProductMetafieldValue(admin, productGid, ns, key, [gid], mfType);
        await upsertLog(shop, productGid, true, handle);
        return { action: "labeled", tagCreated: null, tagAssigned: handle };
      }
    } else {
      await clearDiscountLabels(admin, shop, productGid, ns, key, gidToHandle, mfType);
      return { action: "cleared", tagCreated: null, tagAssigned: null };
    }
    return skip;
  } else {
    // ---------- Default auto-label ----------
    const ate = needsAtePrefix(variants);
    const label = generateAutoLabel(discount.dollar, discount.percent, ate);

    if (!label) {
      await clearDiscountLabels(admin, shop, productGid, ns, key, gidToHandle, mfType);
      return { action: "cleared", tagCreated: null, tagAssigned: null };
    }

    // 1. Read current metafield and strip all auto-generated ("-off") refs
    const currentGids = await getProductMetafieldValue(admin, productGid, ns, key, mfType);
    const nonDiscountGids = currentGids.filter((gid) => {
      const h = gidToHandle.get(gid);
      return !h || !h.includes("-off");
    });

    // 2. Upsert metaobject (always runs — ensures ACTIVE status)
    const { gid: labelGid, created } = await ensureMetaobjectEntry(
      admin, config.metaobjectType,
      label.handle, label.text, handleToGid,
      fieldDefaults, displayNameKey,
    );
    gidToHandle.set(labelGid, label.handle);

    // 3. Write back: non-discount refs + the correct discount ref (skip if unchanged)
    const newGids = [...nonDiscountGids, labelGid];
    const unchanged =
      currentGids.length === newGids.length &&
      currentGids.every((g) => newGids.includes(g)) &&
      newGids.every((g) => currentGids.includes(g));
    if (unchanged) {
      console.info(`[price-tags] metafield unchanged for ${productGid}, skip write`);
    } else {
      await setProductMetafieldValue(admin, productGid, ns, key, newGids, mfType);
    }
    await upsertLog(shop, productGid, true, label.handle);
    return { action: "labeled", tagCreated: created ? label.text : null, tagAssigned: label.text };
  }
}
