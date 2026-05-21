import { prisma } from "../../db/prisma.js";
import { rootLogger } from "../../lib/logger.js";

// Shopify blog adapter for the tone-of-voice pipeline. Pulls up to MAX_BLOGS
// blogs × MAX_ARTICLES_PER_BLOG newest articles via the Admin GraphQL API
// (read_content scope) and stores stripped-text excerpts as BrandToneSource
// rows with sourceType = "shopify_blog".

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

// `Blog.articles` doesn't accept `sortKey` in the current Admin API. `reverse:
// true` is supported and gives newest-first default ordering, which is what
// we want for sampling recent voice.
const BLOGS_AND_ARTICLES_QUERY = `#graphql
  query ListBlogsWithArticles($first: Int!, $articlesFirst: Int!) {
    blogs(first: $first) {
      edges {
        node {
          id
          title
          handle
          articles(first: $articlesFirst, reverse: true) {
            edges {
              node {
                id
                title
                handle
                body
                publishedAt
              }
            }
          }
        }
      }
    }
  }
`;

const MAX_BLOGS = 5;
const MAX_ARTICLES_PER_BLOG = 25;

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ingestShopifyBlogs(input: {
  admin: AdminClient;
  tenantId: string;
  tenantSlug: string;
  batchId: string;
}): Promise<{ sampled: number; skipped: number }> {
  const { admin, tenantId, tenantSlug, batchId } = input;
  const log = rootLogger.child({
    tenant: tenantSlug,
    component: "tone-shopify",
  });
  log.info({ batchId }, "ingest START");

  let sampled = 0;
  let skipped = 0;

  try {
    const response = await admin.graphql(BLOGS_AND_ARTICLES_QUERY, {
      variables: { first: MAX_BLOGS, articlesFirst: MAX_ARTICLES_PER_BLOG },
    });
    const json = (await response.json()) as {
      data?: {
        blogs?: {
          edges?: Array<{
            node: {
              id: string;
              title: string;
              handle: string;
              articles?: {
                edges?: Array<{
                  node: {
                    id: string;
                    title: string;
                    handle: string;
                    body: string;
                    publishedAt: string | null;
                  };
                }>;
              };
            };
          }>;
        };
      };
    };

    const blogs = json.data?.blogs?.edges ?? [];
    for (const blogEdge of blogs) {
      const blog = blogEdge.node;
      const articles = blog.articles?.edges ?? [];
      for (const articleEdge of articles) {
        const article = articleEdge.node;
        const text = stripHtml(article.body || "");
        if (text.length < 100) {
          skipped += 1;
          continue;
        }

        await prisma.brandToneSource.upsert({
          where: {
            tenantId_sourceType_sourceId: {
              tenantId,
              sourceType: "shopify_blog",
              sourceId: article.id,
            },
          },
          create: {
            tenantId,
            sourceType: "shopify_blog",
            sourceId: article.id,
            sourceUrl: `${blog.handle}/${article.handle}`,
            rawText: text.slice(0, 50_000),
            metaJson: {
              blogId: blog.id,
              blogTitle: blog.title,
              articleTitle: article.title,
              publishedAt: article.publishedAt,
            },
            batchId,
          },
          update: {
            rawText: text.slice(0, 50_000),
            capturedAt: new Date(),
            batchId,
            metaJson: {
              blogId: blog.id,
              blogTitle: blog.title,
              articleTitle: article.title,
              publishedAt: article.publishedAt,
            },
          },
        });
        sampled += 1;
      }
    }

    log.info({ sampled, skipped }, "ingest OK");
    return { sampled, skipped };
  } catch (err) {
    log.error({ err }, "ingest FAILED");
    throw err;
  }
}
