/**
 * Shop Ingest — canonical product write path.
 *
 * Accepts either a REST webhook payload (snake_case; variants array) or a
 * GraphQL node (camelCase). Keeps the raw variants/images/metafields as JSON
 * — features like Storytelling can project off them later.
 */

import prisma from "../../db.server";
import { toJsonArrayInput } from "./json-helpers";

export type ShopProductIngestSource = "webhook" | "reconcile" | "backfill";

type UnknownRecord = Record<string, unknown>;

const asString = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
};

const asDate = (v: unknown): Date | null => {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
};

const parseTags = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
};

export function canonicalizeProductPayload(
  shop: string,
  payload: UnknownRecord,
  source: ShopProductIngestSource,
): {
  shop: string;
  id: string;
  legacyId: string | null;
  title: string;
  handle: string | null;
  productType: string | null;
  vendor: string | null;
  status: string | null;
  createdAt: Date | null;
  shopifyUpdatedAt: Date;
  publishedAt: Date | null;
  tagsJson: string[];
  variantsJson: UnknownRecord[];
  imagesJson: UnknownRecord[] | null;
  metafieldsJson: UnknownRecord[] | null;
  ingestedVia: ShopProductIngestSource;
} | null {
  const idRaw = payload.admin_graphql_api_id ?? payload.id;
  const id = asString(idRaw);
  if (!id) return null;
  const gid = id.startsWith("gid://shopify/Product/")
    ? id
    : `gid://shopify/Product/${id}`;

  const legacyId = payload.id != null ? asString(payload.id) : null;

  const title = asString((payload as UnknownRecord).title) ?? "(untitled)";
  const handle = asString((payload as UnknownRecord).handle);

  const productType = asString(
    (payload as UnknownRecord).product_type ??
      (payload as UnknownRecord).productType,
  );
  const vendor = asString((payload as UnknownRecord).vendor);

  const statusRaw = asString((payload as UnknownRecord).status);
  const status = statusRaw ? statusRaw.toUpperCase() : null;

  const createdAt = asDate(
    (payload as UnknownRecord).created_at ??
      (payload as UnknownRecord).createdAt,
  );
  const shopifyUpdatedAt =
    asDate(
      (payload as UnknownRecord).updated_at ??
        (payload as UnknownRecord).updatedAt,
    ) ??
    createdAt ??
    new Date();
  const publishedAt = asDate(
    (payload as UnknownRecord).published_at ??
      (payload as UnknownRecord).publishedAt,
  );

  const variantsRaw = (payload as UnknownRecord).variants;
  const variantsJson = Array.isArray(variantsRaw)
    ? (variantsRaw as UnknownRecord[])
    : [];

  const imagesRaw = (payload as UnknownRecord).images;
  const imagesJson = Array.isArray(imagesRaw)
    ? (imagesRaw as UnknownRecord[])
    : null;

  const metafieldsRaw = (payload as UnknownRecord).metafields;
  const metafieldsJson = Array.isArray(metafieldsRaw)
    ? (metafieldsRaw as UnknownRecord[])
    : null;

  return {
    shop,
    id: gid,
    legacyId,
    title,
    handle,
    productType,
    vendor,
    status,
    createdAt,
    shopifyUpdatedAt,
    publishedAt,
    tagsJson: parseTags((payload as UnknownRecord).tags),
    variantsJson,
    imagesJson,
    metafieldsJson,
    ingestedVia: source,
  };
}

export async function ingestProduct(
  shop: string,
  payload: UnknownRecord,
  source: ShopProductIngestSource,
): Promise<{ ok: boolean; id: string | null; reason?: string }> {
  const row = canonicalizeProductPayload(shop, payload, source);
  if (!row) return { ok: false, id: null, reason: "canonicalize-failed" };

  try {
    const jsonFields = {
      tagsJson: toJsonArrayInput(row.tagsJson) ?? [],
      variantsJson: toJsonArrayInput(row.variantsJson) ?? [],
      imagesJson: toJsonArrayInput(row.imagesJson),
      metafieldsJson: toJsonArrayInput(row.metafieldsJson),
    };
    await prisma.shopProduct.upsert({
      where: { shop_id: { shop: row.shop, id: row.id } },
      create: {
        shop: row.shop,
        id: row.id,
        legacyId: row.legacyId,
        title: row.title,
        handle: row.handle,
        productType: row.productType,
        vendor: row.vendor,
        status: row.status,
        createdAt: row.createdAt,
        shopifyUpdatedAt: row.shopifyUpdatedAt,
        publishedAt: row.publishedAt,
        ingestedVia: row.ingestedVia,
        ...jsonFields,
      },
      update: {
        legacyId: row.legacyId,
        title: row.title,
        handle: row.handle,
        productType: row.productType,
        vendor: row.vendor,
        status: row.status,
        createdAt: row.createdAt,
        shopifyUpdatedAt: row.shopifyUpdatedAt,
        publishedAt: row.publishedAt,
        ingestedVia: row.ingestedVia,
        ...jsonFields,
      },
    });

    await prisma.shopIngestMeta.upsert({
      where: { shop },
      create: {
        shop,
        productsLastSeenUpdatedAt: row.shopifyUpdatedAt,
      },
      update: {
        productsLastSeenUpdatedAt: row.shopifyUpdatedAt,
      },
    });

    return { ok: true, id: row.id };
  } catch (err) {
    console.error(
      `[shop-ingest:products] upsert FAILED shop=${shop} productId=${row.id}`,
      err,
    );
    return { ok: false, id: row.id, reason: "db-error" };
  }
}

export async function deleteIngestedProduct(
  shop: string,
  productId: string,
): Promise<void> {
  const gid = productId.startsWith("gid://shopify/Product/")
    ? productId
    : `gid://shopify/Product/${productId}`;
  await prisma.shopProduct
    .delete({ where: { shop_id: { shop, id: gid } } })
    .catch(() => {
      // swallow — delete-on-missing is fine
    });
}
