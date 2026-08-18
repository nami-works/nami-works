// Fetches live image + price for the fixed REC_PREF discovery products
// (recommendations.ts) — one query per loader run, not per customer, since
// the candidate set is always the same 4 canonical products.
//
// Matched back via canon() rather than a hardcoded title/handle map: those
// 4 canonical names already have distinctive substrings (Melon Mood,
// Pluma, Antifrizz, Condicionadora) that no other product in the catalog
// shares, per gebeauty/products.json + gebeauty/CLAUDE.md's product table.
// Filtered to productType:product per the house hard rule (never take
// prices from rappi/brinde/kit variants).
import { canon, REC_PREF } from "./recommendations.js";
import type { ShopifyAdminClient } from "./live-credit-holders.js";

const SEARCH_TERMS = ["Melon Mood", "Pluma", "Antifrizz", "Condicionadora"];

const QUERY = `#graphql
  query DiscoveryProducts($q: String!) {
    products(first: 20, query: $q) {
      edges {
        node {
          title
          featuredImage { url }
          priceRangeV2 { minVariantPrice { amount } }
        }
      }
    }
  }`;

export type DiscoveryProductInfo = { title: string; imageUrl: string | null; price: number };

export async function fetchDiscoveryProductInfo(
  admin: ShopifyAdminClient,
): Promise<Map<string, DiscoveryProductInfo>> {
  const q = `productType:product AND (${SEARCH_TERMS.map((t) => `title:*${t}*`).join(" OR ")})`;
  const res = await admin.graphql(QUERY, { variables: { q } });
  const json = (await res.json()) as {
    data?: {
      products?: {
        edges: {
          node: { title: string; featuredImage: { url: string } | null; priceRangeV2: { minVariantPrice: { amount: string } } };
        }[];
      };
    };
  };
  const edges = json.data?.products?.edges ?? [];

  const byCanon = new Map<string, DiscoveryProductInfo>();
  for (const { node } of edges) {
    const c = canon(node.title);
    if (!c || !REC_PREF.includes(c) || byCanon.has(c)) continue;
    byCanon.set(c, {
      title: node.title,
      imageUrl: node.featuredImage?.url ?? null,
      price: Number(node.priceRangeV2.minVariantPrice.amount),
    });
  }
  return byCanon;
}
