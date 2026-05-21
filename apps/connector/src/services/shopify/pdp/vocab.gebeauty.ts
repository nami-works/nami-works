/**
 * GE Beauty controlled vocabularies — baked-in allowlist.
 *
 * Source of truth for tag taxonomy, productType enum, closed-choice metafield
 * values, and Google product category subset. Editing this file is the gate
 * for adding a new tag/category — keeps drift under code review.
 *
 * Pull-from-live verification is done by `vocab.ts#refreshVocabulariesFromLive`,
 * which prints what's in production but not in this allowlist (and vice versa).
 */

export const PRODUCT_TYPES = [
  "product",
  "kit",
  "acessorio",
  "rappi",
  "gift-card",
] as const;

/**
 * Tag allowlist. Grouped by category in comments for human review, but the
 * tool flattens to a single Set for membership checks.
 *
 * Drift policy: a tag that exists on a live product but not here is reported
 * by the refresh tool. To add: bump this list in a PR, deploy, ship.
 */
export const TAG_ALLOWLIST: readonly string[] = [
  // hair type
  "cabelos-cacheados",
  "cabelos-crespos",
  "cabelos-finos",
  "cabelos-lisos",
  "cabelos-ondulados",
  "cabelos-porosos",

  // hair need
  "antifrizz",
  "protecao-termica",
  "protecao-uv",
  "sem-volume",
  "queda-quebra",
  "ressecados",
  "com-quimica",

  // formula / form
  "finalizador",
  "formula",
  "full-size",
  "produto-full-size",
  "travel-size",
  "contem-finalizador",
  "contem-leave-in",
  "booster",
  "primer",
  "leave-in",
  "shampoo",
  "mascara",

  // segmentation
  "avulso",
  "best-seller",
  "ex-promo",
  "ex-quiz",
  "hero24",
  "presenteavel",
  "presenteie",
  "stockable",
  "upsell-option",
  "acessorio",
  "bundle",

  // bundle
  "dupla",
  "dupla_leave-in+booster",
  "kit-full-size",
  "kit-ate-300",
  "kits",

  // campaign / launch — bump year suffix per cycle
  "lancto2025",
  "lancto2026",
  "hexagon-disabled",
];

export const TAG_ALLOWLIST_SET: ReadonlySet<string> = new Set(TAG_ALLOWLIST);

/** Required tag categories — every product must include at least one tag from each. */
export const TAG_CATEGORY_REQUIRED: ReadonlyArray<{
  category: string;
  members: readonly string[];
}> = [
  {
    category: "hair-type",
    members: [
      "cabelos-cacheados",
      "cabelos-crespos",
      "cabelos-finos",
      "cabelos-lisos",
      "cabelos-ondulados",
      "cabelos-porosos",
    ],
  },
  {
    category: "segmentation",
    members: ["avulso", "stockable", "best-seller", "bundle", "acessorio"],
  },
];

/** custom.tipo_de_cabelo closed choices (matches metafield validation). */
export const TIPO_DE_CABELO = [
  "Cacheados",
  "Crespos",
  "Finos",
  "Lisos",
  "Ondulados",
  "Equilibrados",
  "Oleosos ou mistos",
  "Desidratados",
] as const;

/** custom.necessidade closed choices. */
export const NECESSIDADE = [
  "Com química ou descoloridos",
  "Ressecados ou secos",
  "Com frizz",
  "Poroso",
  "Queda ou quebra",
  "Expostos ao sol",
  "Quebradiços ou danificados",
  "Raiz oleosa",
  "Sem vitalidade",
  "Sem volume",
  "Couro cabeludo sensível",
] as const;

/** custom.finalizacao closed choices. */
export const FINALIZACAO = [
  "Cachos definidos",
  "Ondas naturais",
  "Seco ao vento",
  "Babyliss duradouro",
  "Hidratado e com brilho",
  "Renovado em 30 seg.",
] as const;

/**
 * Brand-used subset of Google Product Category IDs.
 * 1901 = Health & Beauty > Personal Care > Hair Care
 * (gebeauty uses essentially one bucket — keep tight).
 */
export const GOOGLE_PRODUCT_CATEGORY = ["1901"] as const;
