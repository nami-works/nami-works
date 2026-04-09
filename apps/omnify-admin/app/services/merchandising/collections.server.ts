// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export interface CollectionRule {
  column: string;
  relation: string;
  condition: string;
}

export interface CollectionHealth {
  id: string;
  title: string;
  handle: string;
  productCount: number;
  isAutomated: boolean;
  rules: CollectionRule[];
  status: "empty" | "low" | "healthy";
}

export interface BadgeCoverage {
  id: string;
  handle: string;
  displayName: string;
  productsAssigned: number;
}

// ---------------------------------------------------------------------------
// Fetch collections with health
// ---------------------------------------------------------------------------

export async function fetchCollectionsWithHealth(
  admin: AdminClient,
  maxPages = 5,
): Promise<CollectionHealth[]> {
  console.info(`[merchandising:collections] fetchCollectionsWithHealth START`);
  const collections: CollectionHealth[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (page < maxPages) {
    page++;
    const response = await admin.graphql(
      `#graphql
      query Collections($cursor: String) {
        collections(first: 50, after: $cursor, sortKey: ID) {
          edges {
            node {
              id title handle
              productsCount { count }
              ruleSet {
                appliedDisjunctively
                rules { column relation condition }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { cursor } },
    );

    const json = await response.json();
    const data = json.data?.collections;
    if (!data) break;

    for (const edge of data.edges ?? []) {
      const node = edge.node;
      const count: number = node.productsCount?.count ?? 0;
      const isAutomated = !!node.ruleSet;
      const rules: CollectionRule[] = (node.ruleSet?.rules ?? []).map(
        (r: { column: string; relation: string; condition: string }) => ({
          column: r.column,
          relation: r.relation,
          condition: r.condition,
        }),
      );

      let status: CollectionHealth["status"] = "healthy";
      if (count === 0) status = "empty";
      else if (count < 3) status = "low";

      collections.push({
        id: node.id,
        title: node.title ?? "(untitled)",
        handle: node.handle ?? "",
        productCount: count,
        isAutomated,
        rules,
        status,
      });
    }

    console.info(`[merchandising:collections] page=${page} fetched=${data.edges?.length ?? 0} total=${collections.length}`);

    if (!data.pageInfo?.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
  }

  console.info(`[merchandising:collections] fetchCollectionsWithHealth OK count=${collections.length}`);
  return collections;
}

// ---------------------------------------------------------------------------
// Badge assignment audit
// ---------------------------------------------------------------------------

export async function fetchBadgeCoverage(admin: AdminClient): Promise<BadgeCoverage[]> {
  console.info(`[merchandising:collections] fetchBadgeCoverage START`);

  // Step 1: Fetch all etiqueta metaobjects
  const badgeRes = await admin.graphql(
    `#graphql
    query BadgeMetaobjects {
      metaobjects(type: "etiqueta", first: 50) {
        nodes { id handle displayName }
      }
    }`,
  );
  const badgeJson = await badgeRes.json();
  const badges: BadgeCoverage[] = (badgeJson.data?.metaobjects?.nodes ?? []).map(
    (n: { id: string; handle: string; displayName: string }) => ({
      id: n.id,
      handle: n.handle,
      displayName: n.displayName,
      productsAssigned: 0,
    }),
  );

  if (badges.length === 0) {
    console.info(`[merchandising:collections] fetchBadgeCoverage → no etiqueta metaobjects found`);
    return [];
  }

  // Step 2: Fetch all products with etiqueta metafield and count
  const badgeIdSet = new Set(badges.map((b) => b.id));
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage && page < 10) {
    page++;
    const response = await admin.graphql(
      `#graphql
      query ProductBadges($cursor: String) {
        products(first: 50, after: $cursor, query: "status:active", sortKey: ID) {
          edges {
            node {
              metafield(namespace: "custom", key: "etiqueta") { value }
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

    for (const edge of data.edges ?? []) {
      const metafieldValue: string | null = edge.node?.metafield?.value ?? null;
      if (metafieldValue && badgeIdSet.has(metafieldValue)) {
        const badge = badges.find((b) => b.id === metafieldValue);
        if (badge) badge.productsAssigned++;
      }
    }

    hasNextPage = data.pageInfo?.hasNextPage ?? false;
    cursor = data.pageInfo?.endCursor ?? null;
  }

  console.info(`[merchandising:collections] fetchBadgeCoverage OK badges=${badges.length} pages=${page}`);
  return badges;
}
