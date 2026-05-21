import type { AdminApiClient } from "@shopify/admin-api-client";
import {
  FINALIZACAO,
  GOOGLE_PRODUCT_CATEGORY,
  NECESSIDADE,
  PRODUCT_TYPES,
  TAG_ALLOWLIST,
  TAG_ALLOWLIST_SET,
  TAG_CATEGORY_REQUIRED,
  TIPO_DE_CABELO,
} from "./vocab.gebeauty.js";

/**
 * Controlled vocabulary loader.
 *
 * Default: serves the baked-in allowlist (instant, no GraphQL).
 * Refresh mode: samples N live products and reports drift against the
 * allowlist — does NOT mutate the allowlist (that's a PR concern).
 */

export type ControlledVocabularies = {
  productTypes: ReadonlySet<string>;
  tagAllowlist: ReadonlySet<string>;
  tagCategoriesRequired: typeof TAG_CATEGORY_REQUIRED;
  tipoDeCabelo: ReadonlySet<string>;
  necessidade: ReadonlySet<string>;
  finalizacao: ReadonlySet<string>;
  googleProductCategory: ReadonlySet<string>;
};

export function loadBakedVocabularies(): ControlledVocabularies {
  return {
    productTypes: new Set(PRODUCT_TYPES),
    tagAllowlist: TAG_ALLOWLIST_SET,
    tagCategoriesRequired: TAG_CATEGORY_REQUIRED,
    tipoDeCabelo: new Set(TIPO_DE_CABELO),
    necessidade: new Set(NECESSIDADE),
    finalizacao: new Set(FINALIZACAO),
    googleProductCategory: new Set(GOOGLE_PRODUCT_CATEGORY),
  };
}

export type VocabDrift = {
  /** Sample size used to derive the live picture. */
  sampleSize: number;
  /** Tags present on live products but not in the allowlist. */
  unknownLiveTags: string[];
  /** Tags in the allowlist that no live product uses (potentially stale). */
  unusedAllowlistTags: string[];
  /** ProductTypes seen live but not enumerated. */
  unknownProductTypes: string[];
  /** All distinct tags observed live (sorted). */
  liveTagsSorted: string[];
};

const TAG_SAMPLE_QUERY = /* GraphQL */ `
  query SampleProductsForVocab($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node { id productType tags }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type SampleResp = {
  products: {
    edges: Array<{ node: { id: string; productType: string; tags: string[] } }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export async function refreshVocabulariesFromLive(args: {
  client: AdminApiClient;
  /** How many recent products to sample. 100 is typical, max 250. */
  sampleSize?: number;
}): Promise<VocabDrift> {
  const sampleSize = Math.min(args.sampleSize ?? 100, 250);
  const tags = new Set<string>();
  const productTypes = new Set<string>();
  let fetched = 0;
  let after: string | undefined;

  while (fetched < sampleSize) {
    const first = Math.min(50, sampleSize - fetched);
    const res = await args.client.request<SampleResp>(TAG_SAMPLE_QUERY, {
      variables: { first, ...(after ? { after } : {}) },
    });
    if (res.errors) {
      throw new Error(
        `Shopify GraphQL error sampling products: ${res.errors.message ?? "unknown"}`,
      );
    }
    const page = res.data?.products;
    if (!page) break;
    for (const e of page.edges) {
      for (const t of e.node.tags) tags.add(t);
      if (e.node.productType) productTypes.add(e.node.productType);
      fetched += 1;
    }
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }

  const allowSet = TAG_ALLOWLIST_SET;
  const unknownLiveTags = [...tags].filter((t) => !allowSet.has(t)).sort();
  const usedLive = tags;
  const unusedAllowlistTags = TAG_ALLOWLIST.filter((t) => !usedLive.has(t)).sort();
  const ptSet: ReadonlySet<string> = new Set(PRODUCT_TYPES);
  const unknownProductTypes = [...productTypes].filter((p) => !ptSet.has(p)).sort();

  return {
    sampleSize: fetched,
    unknownLiveTags,
    unusedAllowlistTags,
    unknownProductTypes,
    liveTagsSorted: [...tags].sort(),
  };
}
