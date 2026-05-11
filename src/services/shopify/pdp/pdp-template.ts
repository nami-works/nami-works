import type { AdminApiClient } from "@shopify/admin-api-client";
import {
  EXPECTED_PRODUCT_METAFIELD_SLOTS,
  type ImageSlotRole,
  type MediaTemplate,
  type MetafieldSlot,
  type MetaobjectTemplate,
  type PDPTemplate,
  type VariantTemplate,
} from "./types.js";

/**
 * Read a product into the canonical PDPTemplate shape.
 *
 * One round-trip: a single deep GraphQL query covers core fields, variants,
 * media, every expected metafield slot (resolved via `metafields(identifiers:)`,
 * Shopify caps that at 25 identifiers so we batch), and the embedded/shared
 * metaobjects one nested level deep. Total schema depth stays under Shopify's
 * query-complexity ceiling for this query.
 *
 * The function does NOT validate the template's content — it just maps the
 * raw Admin API response into the typed shape. Validation is Phase B's job.
 */

const PRODUCT_QUERY = /* GraphQL */ `
  query PDPTemplateRead($id: ID!, $idents1: [HasMetafieldsIdentifier!]!, $idents2: [HasMetafieldsIdentifier!]!) {
    product(id: $id) {
      id
      title
      handle
      vendor
      productType
      status
      descriptionHtml
      tags
      seo { title description }

      variants(first: 50) {
        edges { node {
          id title sku barcode price compareAtPrice
          inventoryItem { measurement { weight { value unit } } }
          bullet: metafield(namespace: "custom", key: "bullet") {
            value
            type
            reference {
              __typename
              ... on MediaImage { id image { url } }
              ... on GenericFile { id url }
            }
          }
        } }
      }

      media(first: 30) {
        edges { node {
          mediaContentType
          alt
          ... on MediaImage { id image { url width height altText } }
          ... on Video { id sources { url mimeType format } }
          ... on ExternalVideo { id originUrl }
        } }
      }

      mf1: metafields(identifiers: $idents1) {
        namespace key type value
        references(first: 10) {
          edges { node {
            __typename
            ... on Metaobject { id type handle fields { key type value } }
            ... on Product { id handle title }
            ... on MediaImage { id image { url } }
            ... on GenericFile { id url }
            ... on Video { id }
          } }
        }
        reference {
          __typename
          ... on Metaobject { id type handle fields { key type value } }
          ... on Product { id handle title }
          ... on MediaImage { id image { url } }
          ... on GenericFile { id url }
          ... on Video { id }
        }
      }

      mf2: metafields(identifiers: $idents2) {
        namespace key type value
        references(first: 10) {
          edges { node {
            __typename
            ... on Metaobject { id type handle fields { key type value } }
            ... on Product { id handle title }
            ... on MediaImage { id image { url } }
            ... on GenericFile { id url }
            ... on Video { id }
          } }
        }
        reference {
          __typename
          ... on Metaobject { id type handle fields { key type value } }
          ... on Product { id handle title }
          ... on MediaImage { id image { url } }
          ... on GenericFile { id url }
          ... on Video { id }
        }
      }

      collections(first: 50) {
        edges { node { id title handle } }
      }
    }
  }
`;

type Identifier = { namespace: string; key: string };

function slotKeyToIdentifier(slot: string): Identifier {
  const dot = slot.lastIndexOf(".");
  return { namespace: slot.slice(0, dot), key: slot.slice(dot + 1) };
}

type RawMetaobject = {
  __typename: "Metaobject";
  id: string;
  type: string;
  handle: string;
  fields: Array<{ key: string; type: string; value: string | null }>;
};

type RawMediaImage = {
  __typename: "MediaImage";
  id: string;
  image?: { url: string | null } | null;
};

type RawGenericFile = {
  __typename: "GenericFile";
  id: string;
  url: string | null;
};

type RawVideo = { __typename: "Video"; id: string };

type RawProductRef = {
  __typename: "Product";
  id: string;
  title: string;
  handle: string;
};

type AnyReferenceNode =
  | RawMetaobject
  | RawMediaImage
  | RawGenericFile
  | RawVideo
  | RawProductRef
  | { __typename: string };

type RawMetafield = {
  namespace: string;
  key: string;
  type: string;
  value: string | null;
  reference?: AnyReferenceNode | null;
  references?: { edges: Array<{ node: AnyReferenceNode }> } | null;
};

type RawResponse = {
  product: {
    id: string;
    title: string;
    handle: string;
    vendor: string;
    productType: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    descriptionHtml: string;
    tags: string[];
    seo: { title: string | null; description: string | null };
    variants: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          sku: string | null;
          barcode: string | null;
          price: string;
          compareAtPrice: string | null;
          inventoryItem: {
            measurement: {
              weight: { value: number; unit: string } | null;
            } | null;
          } | null;
          bullet: {
            value: string | null;
            type: string;
            reference: AnyReferenceNode | null;
          } | null;
        };
      }>;
    };
    media: {
      edges: Array<{
        node: {
          mediaContentType: string;
          alt: string | null;
          id: string;
          image?: {
            url: string;
            width: number | null;
            height: number | null;
            altText: string | null;
          } | null;
          sources?: Array<{ url: string; mimeType: string }>;
          originUrl?: string;
        };
      }>;
    };
    mf1: Array<RawMetafield | null>;
    mf2: Array<RawMetafield | null>;
    collections: {
      edges: Array<{ node: { id: string; title: string; handle: string } }>;
    };
  } | null;
};

function parseMetaobject(node: RawMetaobject): MetaobjectTemplate {
  const fields: Record<string, string> = {};
  for (const f of node.fields) {
    if (f.value !== null) fields[f.key] = f.value;
  }
  return { gid: node.id, type: node.type, handle: node.handle, fields };
}

function asMetaobject(node: AnyReferenceNode | null | undefined): MetaobjectTemplate | null {
  if (!node || node.__typename !== "Metaobject") return null;
  return parseMetaobject(node as RawMetaobject);
}

function inferSlotFromAlt(alt: string | null): ImageSlotRole {
  if (!alt) return "unknown";
  const lower = alt.toLowerCase();
  if (lower.includes("antes") && lower.includes("depois")) return "antes_depois_combined";
  if (lower.includes("aplica") || lower.includes("modo de uso")) return "application";
  if (lower.includes("fórmula") || lower.includes("ingrediente") || lower.includes("formula"))
    return "ingredients";
  if (lower.includes("review") || lower.includes("@") || lower.includes("benefício") || lower.includes("beneficio"))
    return "social_proof";
  if (lower.includes("magazine") || lower.includes("press") || lower.includes("elle"))
    return "magazine";
  return "unknown";
}

function buildReferences(
  mf: RawMetafield,
): Array<{ gid: string; kind: string; handle?: string }> {
  const out: Array<{ gid: string; kind: string; handle?: string }> = [];
  const push = (node: AnyReferenceNode) => {
    if ("id" in node && typeof node.id === "string") {
      const ref: { gid: string; kind: string; handle?: string } = {
        gid: node.id,
        kind: node.__typename,
      };
      const handle = (node as { handle?: string }).handle;
      if (typeof handle === "string") ref.handle = handle;
      out.push(ref);
    }
  };
  if (mf.reference) push(mf.reference);
  if (mf.references) {
    for (const e of mf.references.edges) push(e.node);
  }
  return out;
}

function buildMetafieldsMap(
  raws: (RawMetafield | null)[],
): Record<string, MetafieldSlot> {
  const map: Record<string, MetafieldSlot> = {};
  for (const slot of EXPECTED_PRODUCT_METAFIELD_SLOTS) {
    map[slot] = { state: "missing" };
  }
  for (const mf of raws) {
    if (!mf) continue;
    const slotKey = `${mf.namespace}.${mf.key}`;
    map[slotKey] = {
      state: "present",
      value: mf.value ?? "",
      type: mf.type,
      references: buildReferences(mf),
    };
  }
  return map;
}

function extractMetaobjectByType(
  raws: (RawMetafield | null)[],
  slotKey: string,
): MetaobjectTemplate | null {
  for (const mf of raws) {
    if (!mf) continue;
    if (`${mf.namespace}.${mf.key}` !== slotKey) continue;
    return asMetaobject(mf.reference ?? null);
  }
  return null;
}

function extractMetaobjectListByType(
  raws: (RawMetafield | null)[],
  slotKey: string,
): MetaobjectTemplate[] {
  for (const mf of raws) {
    if (!mf) continue;
    if (`${mf.namespace}.${mf.key}` !== slotKey) continue;
    if (!mf.references) return [];
    return mf.references.edges
      .map((e) => asMetaobject(e.node))
      .filter((m): m is MetaobjectTemplate => m !== null);
  }
  return [];
}

export async function readPDPTemplate(
  productGid: string,
  client: AdminApiClient,
): Promise<PDPTemplate> {
  // Shopify caps `metafields(identifiers:)` at 25 entries per call. Split.
  const allIdents = EXPECTED_PRODUCT_METAFIELD_SLOTS.map(slotKeyToIdentifier);
  const idents1 = allIdents.slice(0, 25);
  const idents2 = allIdents.slice(25);

  const res = await client.request<RawResponse>(PRODUCT_QUERY, {
    variables: { id: productGid, idents1, idents2 },
  });

  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error reading PDP template: ${res.errors.message ?? "unknown"}`,
    );
  }
  const product = res.data?.product;
  if (!product) {
    throw new Error(`Product not found: ${productGid}`);
  }

  const allMetafields = [...product.mf1, ...product.mf2];
  const metafieldsMap = buildMetafieldsMap(allMetafields);

  const variants: VariantTemplate[] = product.variants.edges.map((e) => {
    const v = e.node;
    const weight = v.inventoryItem?.measurement?.weight ?? null;
    let weightKg: number | null = null;
    if (weight) {
      if (weight.unit === "KILOGRAMS") weightKg = weight.value;
      else if (weight.unit === "GRAMS") weightKg = weight.value / 1000;
      else if (weight.unit === "POUNDS") weightKg = weight.value * 0.453592;
      else if (weight.unit === "OUNCES") weightKg = weight.value * 0.0283495;
    }
    return {
      gid: v.id,
      title: v.title,
      sku: v.sku,
      barcode: v.barcode,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      weightKg,
      bulletFileGid:
        v.bullet?.reference && "id" in v.bullet.reference
          ? (v.bullet.reference as { id: string }).id
          : null,
    };
  });

  const media: MediaTemplate[] = product.media.edges.map((e, idx) => {
    const n = e.node;
    const isImage = n.mediaContentType === "IMAGE";
    const alt = n.image?.altText ?? n.alt ?? "";
    const url = isImage
      ? (n.image?.url ?? null)
      : n.sources?.[0]?.url ?? n.originUrl ?? null;
    return {
      mediaGid: n.id,
      mediaType: (n.mediaContentType as MediaTemplate["mediaType"]) ?? "OTHER",
      url,
      altText: alt,
      width: n.image?.width ?? null,
      height: n.image?.height ?? null,
      position: idx,
      inferredSlot: isImage ? inferSlotFromAlt(alt) : "unknown",
    };
  });

  const embedded = {
    descricao_longa: extractMetaobjectByType(
      allMetafields,
      "custom.descricao_longa_com_abas",
    ),
    antes_e_depois: extractMetaobjectByType(allMetafields, "custom.antes_e_depois"),
    item_faq: extractMetaobjectListByType(allMetafields, "custom.faq"),
    ai_readiness: extractMetaobjectByType(allMetafields, "custom.ai_readiness"),
  };

  const shared = {
    etiquetas: extractMetaobjectListByType(allMetafields, "custom.etiquetas"),
    shopify_hair_type: extractMetaobjectListByType(allMetafields, "shopify.hair-type"),
    shopify_product_form: extractMetaobjectListByType(
      allMetafields,
      "shopify.product-form",
    ),
    shopify_target_gender: extractMetaobjectListByType(
      allMetafields,
      "shopify.target-gender",
    ),
  };

  const presentSlots: string[] = [];
  const missingSlots: string[] = [];
  for (const slot of EXPECTED_PRODUCT_METAFIELD_SLOTS) {
    const entry = metafieldsMap[slot];
    if (entry?.state === "present") presentSlots.push(slot);
    else missingSlots.push(slot);
  }

  return {
    productGid: product.id,
    scrapedAt: new Date().toISOString(),
    core: {
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      productType: product.productType,
      status: product.status,
      descriptionHtml: product.descriptionHtml,
      seo: product.seo,
      tags: product.tags,
    },
    variants,
    media,
    metafields: metafieldsMap,
    embedded,
    shared,
    collections: product.collections.edges.map((e) => ({
      gid: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
    })),
    presentSlots,
    missingSlots,
  };
}
