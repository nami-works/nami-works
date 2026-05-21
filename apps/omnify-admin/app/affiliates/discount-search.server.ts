/**
 * Affiliates — Search Shopify code-discount nodes for the Add-program modal.
 *
 * Uses `codeDiscountNodes(query, sortKey: ID)` so pagination stays stable —
 * Shopify's default cursor pagination is not deterministic without sortKey.
 * We only return the first 20 matches; the search modal is for picking a
 * specific known discount, not browsing.
 */

import { graphqlJsonWithRetry } from "./sync.server";
import type { DiscountSearchResult } from "./types";

const SEARCH_DISCOUNTS_QUERY = /* GraphQL */ `
  query SearchDiscounts($query: String!, $first: Int!) {
    codeDiscountNodes(first: $first, query: $query, sortKey: ID) {
      nodes {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title
            status
            codesCount {
              count
            }
          }
          ... on DiscountCodeBxgy {
            title
            status
            codesCount {
              count
            }
          }
          ... on DiscountCodeFreeShipping {
            title
            status
            codesCount {
              count
            }
          }
          ... on DiscountCodeApp {
            title
            status
            codesCount {
              count
            }
          }
        }
      }
    }
  }
`;

function escapeForShopifyQuery(raw: string): string {
  // Shopify search-syntax is permissive but we strip backslashes, double
  // quotes, parens, colons — anything that could break the AND/OR boolean.
  return raw.replace(/[\\"():*]/g, "").trim();
}

function mapStatus(status: unknown): "ACTIVE" | "EXPIRED" | "SCHEDULED" {
  const s = String(status ?? "").toUpperCase();
  if (s === "ACTIVE") return "ACTIVE";
  if (s === "SCHEDULED") return "SCHEDULED";
  return "EXPIRED";
}

export async function searchShopifyDiscounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  query: string,
  shop?: string,
): Promise<DiscountSearchResult[]> {
  const cleaned = escapeForShopifyQuery(query);
  // Build a Shopify search string — title prefix + status filter. Empty
  // query returns the latest 20 active/scheduled discounts.
  const titleClause = cleaned ? `title:*${cleaned}*` : "";
  const statusClause = "(status:ACTIVE OR status:SCHEDULED)";
  const fullQuery = titleClause
    ? `${titleClause} AND ${statusClause}`
    : statusClause;

  console.info(
    `[affiliate-programs:search] START shop=${shop ?? "?"} query="${cleaned}"`,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = await graphqlJsonWithRetry(admin, SEARCH_DISCOUNTS_QUERY, {
      query: fullQuery,
      first: 20,
    });
  } catch (err) {
    console.error(
      `[affiliate-programs:search] FAILED shop=${shop ?? "?"} query="${cleaned}"`,
      err,
    );
    throw err;
  }

  const nodes: Array<{
    id?: string;
    codeDiscount?: {
      title?: string;
      status?: string;
      codesCount?: { count?: number };
    };
  }> = json?.data?.codeDiscountNodes?.nodes ?? [];

  const results: DiscountSearchResult[] = nodes
    .filter((n) => n?.id && n.codeDiscount)
    .map((n) => ({
      nodeId: String(n.id),
      title: String(n.codeDiscount?.title ?? "(untitled)"),
      status: mapStatus(n.codeDiscount?.status),
      codesCount: Number(n.codeDiscount?.codesCount?.count ?? 0),
    }));

  console.info(
    `[affiliate-programs:search] OK shop=${shop ?? "?"} query="${cleaned}" results=${results.length}`,
  );
  return results;
}
