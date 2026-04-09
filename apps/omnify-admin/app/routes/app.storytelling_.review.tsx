import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useSearchParams, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";

const BLOGS_QUERY = `#graphql
  query GetBlogs {
    blogs(first: 50) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[storytelling:review] loader START shop=${shop}`);

  let blogs: { id: string; title: string; handle: string }[] = [];
  try {
    const response = await admin.graphql(BLOGS_QUERY);
    const json = await response.json();
    const edges = json.data?.blogs?.edges || [];
    blogs = edges.map(
      (e: { node: { id: string; title: string; handle: string } }) => ({
        id: e.node.id,
        title: e.node.title,
        handle: e.node.handle,
      }),
    );
    console.info(`[storytelling:review] loader OK shop=${shop} blogs=${blogs.length}`);
  } catch (err) {
    console.error(`[storytelling:review] loader blogs FAILED shop=${shop}`, err);
  }

  return { blogs };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");
  console.info(`[storytelling:review] action intent=${intent ?? "?"} shop=${shop}`);

  if (intent === "publish") {
    const blogId = formData.get("blogId") as string;
    const title = formData.get("title") as string;
    const bodyHtml = formData.get("bodyHtml") as string;
    const metaDescription = formData.get("metaDescription") as string;
    const author = formData.get("author") as string;

    if (!blogId || !title || !bodyHtml) {
      return { error: "Missing required fields for publish." };
    }

    try {
      const response = await admin.graphql(
        `#graphql
        mutation CreateArticle($article: ArticleCreateInput!) {
          articleCreate(article: $article) {
            article {
              id
              title
              handle
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            article: {
              blogId,
              title,
              body: bodyHtml,
              summary: metaDescription?.slice(0, 200) || undefined,
              isPublished: false,
              author: { name: author || "Story-telling" },
            },
          },
        },
      );

      const json = await response.json();
      const createResult = json.data?.articleCreate;
      const errors = createResult?.userErrors || [];

      if (errors.length > 0) {
        return { error: errors.map((e: { message: string }) => e.message).join(", ") };
      }

      console.info(`[storytelling:review] publish OK shop=${shop} articleId=${createResult?.article?.id ?? "?"}`);
      return {
        success: true,
        article: createResult?.article,
      };
    } catch (err) {
      console.error(`[storytelling:review] publish FAILED shop=${shop}`, err);
      return {
        error: err instanceof Error ? err.message : "Failed to create article.",
      };
    }
  }

  return { error: "Unknown action." };
};

type GeneratedPost = {
  theme_key: string;
  html: string;
  metafields: { meta_title?: string; meta_description?: string };
};

export default function ReviewPage() {
  const { blogs } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("jobId");
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useTranslation("storytelling");

  const [jobStatus, setJobStatus] = useState<
    "idle" | "pending" | "running" | "completed" | "failed"
  >("idle");
  const [posts, setPosts] = useState<GeneratedPost[]>([]);
  const [jobError, setJobError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const response = await fetch(`/api/blog-posts/job/${jobId}`);
        const data = (await response.json()) as {
          status?: string;
          result?: { themes?: GeneratedPost[] };
          error?: string;
        };

        setJobStatus((data.status as typeof jobStatus) || "pending");
        if (data.result?.themes) setPosts(data.result.themes);
        if (data.error) setJobError(data.error);

        if (data.status === "running" || data.status === "pending") {
          setTimeout(poll, 5000);
        }
      } catch (err) {
        setJobError(err instanceof Error ? err.message : "Poll failed");
        setJobStatus("failed");
      }
    };

    poll();
  }, [jobId]);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast?.show?.(t("review.articleCreatedDraft"));
    }
    if (fetcher.data?.error) {
      shopify.toast?.show?.(fetcher.data.error);
    }
  }, [fetcher.data, shopify, t]);

  return (
    <s-page heading={t("review.pageHeading")}>
      <s-button variant="tertiary" slot="secondary-actions">
        <Link to="/app/storytelling" style={{ color: "inherit", textDecoration: "none" }}>
          {t("common:button.back")}
        </Link>
      </s-button>

      <s-section heading={t("review.generatedContent")}>
        {!jobId && (
          <s-paragraph>
            {t("review.noJobId")}{" "}
            <Link to="/app/storytelling/brief">{t("brief.pageHeading")}</Link>.
          </s-paragraph>
        )}

        {jobId && (
          <>
            <s-paragraph>
              {t("review.status")} {jobStatus}. {t("review.jobId")} {jobId}
            </s-paragraph>
            {jobError && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-paragraph>{jobError}</s-paragraph>
              </s-box>
            )}
            {posts.length > 0 && (
              <s-stack direction="block" gap="large">
                {posts.map((post) => (
                  <s-box
                    key={post.theme_key}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="block" gap="base">
                      <s-stack direction="inline" gap="base">
                        <s-heading>{post.theme_key}</s-heading>
                        <fetcher.Form method="POST" style={{ marginLeft: "auto" }}>
                          <input type="hidden" name="intent" value="publish" />
                          <input type="hidden" name="blogId" value={blogs[0]?.id ?? ""} />
                          <input type="hidden" name="title" value={post.metafields?.meta_title ?? post.theme_key} />
                          <input type="hidden" name="bodyHtml" value={post.html} />
                          <input type="hidden" name="metaDescription" value={post.metafields?.meta_description ?? ""} />
                          <input type="hidden" name="author" value="Story-telling" />
                          <s-button
                            type="submit"
                            variant="primary"
                            {...(fetcher.state !== "idle" ? { loading: true } : {})}
                          >
                            {t("review.publish")}
                          </s-button>
                        </fetcher.Form>
                      </s-stack>
                      <div
                        dangerouslySetInnerHTML={{ __html: post.html }}
                        style={{
                          maxHeight: 200,
                          overflow: "auto",
                          border: "1px solid #ccc",
                          padding: 8,
                          fontSize: 14,
                        }}
                      />
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            )}
          </>
        )}
      </s-section>

      <s-section slot="aside" heading={t("review.blogs")}>
        <s-paragraph>
          {blogs.length === 0
            ? t("review.noBlogsFound")
            : t("review.publishingTo", { blogs: blogs.map((b) => b.title).join(", ") })}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
