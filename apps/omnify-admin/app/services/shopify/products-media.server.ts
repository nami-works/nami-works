export type ShopifyProductImage = {
  id: string;
  url: string;
  altText: string | null;
};

export type ShopifyProductWithMedia = {
  id: string;
  title: string;
  description: string | null;
  images: ShopifyProductImage[];
};

const PRODUCTS_WITH_MEDIA_QUERY = `#graphql
  query ProductsWithMedia($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          title
          description
          media(first: 20) {
            edges {
              node {
                ... on MediaImage {
                  id
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function* paginateProductsWithMedia(
  admin: AdminClient,
  pageSize = 50,
): AsyncGenerator<ShopifyProductWithMedia> {
  let cursor: string | null = null;
  do {
    const response = await admin.graphql(PRODUCTS_WITH_MEDIA_QUERY, {
      variables: { first: pageSize, after: cursor ?? undefined },
    });
    const json = (await response.json()) as {
      data?: {
        products?: {
          edges?: Array<{
            node: {
              id: string;
              title: string;
              description: string | null;
              media?: {
                edges?: Array<{
                  node: {
                    id?: string;
                    image?: { url?: string; altText?: string | null } | null;
                  };
                }>;
              };
            };
          }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string };
        };
      };
    };

    const products = json.data?.products;
    if (!products) return;

    const edges = products.edges ?? [];
    for (const edge of edges) {
      const node = edge.node;
      const images: ShopifyProductImage[] = (node.media?.edges ?? [])
        .map((m) => {
          const id = m.node.id;
          const url = m.node.image?.url;
          if (!id || !url) return null;
          return {
            id,
            url,
            altText: m.node.image?.altText ?? null,
          };
        })
        .filter((x): x is ShopifyProductImage => x !== null);

      yield {
        id: node.id,
        title: node.title,
        description: node.description,
        images,
      };
    }

    const pageInfo = products.pageInfo ?? {};
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor ?? null : null;
  } while (cursor);
}

const UPDATE_IMAGE_ALT_MUTATION = `#graphql
  mutation UpdateImageAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          image { altText }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export async function updateImageAlt(
  admin: AdminClient,
  input: { productId: string; imageId: string; alt: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await admin.graphql(UPDATE_IMAGE_ALT_MUTATION, {
    variables: {
      productId: input.productId,
      media: [{ id: input.imageId, alt: input.alt }],
    },
  });
  const json = (await response.json()) as {
    data?: {
      productUpdateMedia?: {
        mediaUserErrors?: Array<{ message: string }>;
      };
    };
  };
  const errors = json.data?.productUpdateMedia?.mediaUserErrors ?? [];
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => e.message).join(", ") };
  }
  return { ok: true };
}
