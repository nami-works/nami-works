/**
 * PDP cloning — shared types.
 *
 * `PDPTemplate` is the read-shape: a fully-resolved snapshot of a reference
 * product's structure (core scalars + variants + media + every metafield slot
 * we care about + resolved embedded/shared metaobjects). The Phase A read
 * tools produce this; Phase B/C consume it.
 *
 * `PDPCandidate` is the write-shape (Phase B/C). Kept as a forward-compat
 * skeleton here so the schema is co-located even though only Phase A uses it.
 */

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

/** Role-based image slots. `unknown` is the fallback for templates whose
 *  altText doesn't disclose the slot — most reference products have role
 *  hints in altText but not all. */
export type ImageSlotRole =
  | "hero"
  | "magazine"
  | "raw_bottle"
  | "application"
  | "ingredients"
  | "antes_depois_combined"
  | "social_proof"
  | "unknown";

export type CoreScalars = {
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: ProductStatus;
  descriptionHtml: string;
  seo: { title: string | null; description: string | null };
  tags: string[];
};

export type VariantTemplate = {
  gid: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  weightKg: number | null;
  bulletFileGid: string | null;
};

export type MediaTemplate = {
  mediaGid: string;
  mediaType: "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO" | "MODEL_3D" | "OTHER";
  url: string | null;
  altText: string;
  width: number | null;
  height: number | null;
  position: number;
  inferredSlot: ImageSlotRole;
};

export type MetaobjectTemplate = {
  gid: string;
  type: string;
  handle: string;
  fields: Record<string, string>;
};

export type MetafieldPresent = {
  state: "present";
  value: string;
  type: string;
  /** Resolved references for `*_reference` and `list.*_reference` types. */
  references: Array<{ gid: string; kind: string; handle?: string }>;
};

export type MetafieldMissing = { state: "missing" };

export type MetafieldSlot = MetafieldPresent | MetafieldMissing;

/** The full PDPTemplate — output of `readPDPTemplate`. */
export type PDPTemplate = {
  productGid: string;
  scrapedAt: string;

  core: CoreScalars;
  variants: VariantTemplate[];
  media: MediaTemplate[];

  /** Keyed by "namespace.key" e.g. "custom.finalidade". */
  metafields: Record<string, MetafieldSlot>;

  /** Per-product metaobjects (cloned per PDP — never shared). */
  embedded: {
    descricao_longa: MetaobjectTemplate | null;
    antes_e_depois: MetaobjectTemplate | null;
    item_faq: MetaobjectTemplate[];
    ai_readiness: MetaobjectTemplate | null;
  };

  /** Shared/library metaobjects (referenced, not cloned). */
  shared: {
    etiquetas: MetaobjectTemplate[];
    shopify_hair_type: MetaobjectTemplate[];
    shopify_product_form: MetaobjectTemplate[];
    shopify_target_gender: MetaobjectTemplate[];
  };

  collections: Array<{ gid: string; title: string; handle: string }>;

  /** Diff helpers: which expected slots are populated/missing on this template. */
  presentSlots: string[];
  missingSlots: string[];
};

/**
 * The full canonical slot list. Every populated metafield on a gold-standard
 * GE Beauty hero PDP. Diff and validator both reference this.
 *
 * NOT included here intentionally:
 * - `loox.reviews/num_reviews/avg_rating` and `reviews.rating/rating_count` →
 *   auto-populated by Loox + Shopify; never set by the create tool.
 * - `seo.hidden` → manual SEO control, opt-in per product.
 */
export const EXPECTED_PRODUCT_METAFIELD_SLOTS = [
  "custom.descricao_longa_com_abas",
  "custom.finalidade",
  "custom.etiquetas",
  "custom.caracteristicas",
  "custom.dosagem",
  "custom.antes_e_depois",
  "custom.faq",
  "custom.tipo_de_cabelo",
  "custom.necessidade",
  "custom.finalizacao",
  "custom.video_stories",
  "custom.beneficio_em_destaque_1",
  "custom.beneficio_em_destaque_2",
  "custom.beneficio_em_destaque_3",
  "custom.imagem_beneficio_em_destaque_1",
  "custom.imagem_beneficio_em_destaque_2",
  "custom.imagem_beneficio_em_destaque_3",
  "custom.texto_promocional",
  "custom.texto_promo",
  "custom.ai_readiness",
  "shopify.hair-type",
  "shopify.product-form",
  "shopify.target-gender",
  "shopify--discovery--product_recommendation.complementary_products",
  "shopify--discovery--product_recommendation.related_products",
  "shopify--discovery--product_recommendation.related_products_display",
  "shopify--discovery--product_search_boost.queries",
  "mm-google-shopping.google_product_category",
  "mc-facebook.google_product_category",
  "mm-google-shopping.custom_product",
  "fullcomm.ncm",
  "global.title_tag",
  "global.description_tag",
] as const;

export type ExpectedSlot = (typeof EXPECTED_PRODUCT_METAFIELD_SLOTS)[number];

export const EXPECTED_VARIANT_METAFIELD_SLOTS = ["custom.bullet"] as const;
export type ExpectedVariantSlot =
  (typeof EXPECTED_VARIANT_METAFIELD_SLOTS)[number];
