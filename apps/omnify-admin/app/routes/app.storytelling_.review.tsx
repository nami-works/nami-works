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
import {
  getJob as getStoredJob,
  markDraftPublished,
} from "../services/storytelling/blog-post-job.server";

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
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  console.info(`[storytelling:review] loader START shop=${shop} jobId=${jobId ?? "?"}`);

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

  const storedJob = jobId ? await getStoredJob(shop, jobId) : null;

  return { blogs, storedJob };
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
    const jobId = formData.get("jobId") as string;
    const themeKey = formData.get("themeKey") as string;

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

      const articleGid = createResult?.article?.id as string | undefined;
      if (articleGid && jobId && themeKey) {
        await markDraftPublished({
          shop,
          jobId,
          themeKey,
          shopifyArticleId: articleGid,
        });
      }

      console.info(
        `[storytelling:review] publish OK shop=${shop} articleId=${articleGid ?? "?"} themeKey=${themeKey ?? "?"}`,
      );
      return {
        success: true,
        article: createResult?.article,
        themeKey,
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

type JobStatus = "idle" | "pending" | "running" | "completed" | "failed";

export default function ReviewPage() {
  const { blogs, storedJob } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("jobId");
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useTranslation("storytelling");

  const initialStatus: JobStatus =
    (storedJob?.status as JobStatus) ||
    (jobId ? "pending" : "idle");

  const [jobStatus, setJobStatus] = useState<JobStatus>(initialStatus);
  const [posts, setPosts] = useState<GeneratedPost[]>(() => {
    const themes = (storedJob?.resultJson as { themes?: GeneratedPost[] } | null)
      ?.themes;
    return themes && Array.isArray(themes) ? themes : [];
  });
  const [jobError, setJobError] = useState<string | null>(
    storedJob?.errorMessage ?? null,
  );
  const [publishedThemes, setPublishedThemes] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [selectedBlog, setSelectedBlog] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!jobId) return;
    if (jobStatus === "completed" || jobStatus === "failed") return;

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/blog-posts/job/${jobId}`);
        const data = (await response.json()) as {
          status?: string;
          result?: { themes?: GeneratedPost[] };
          error?: string;
        };

        if (cancelled) return;
        setJobStatus((data.status as JobStatus) || "pending");
        if (data.result?.themes) setPosts(data.result.themes);
        if (data.error) setJobError(data.error);

        if (data.status === "running" || data.status === "pending") {
          setTimeout(poll, 3000);
        }
      } catch (err) {
        if (cancelled) return;
        setJobError(err instanceof Error ? err.message : "Poll failed");
        setJobStatus("failed");
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.themeKey) {
      setPublishedThemes((prev) => {
        const next = new Set(prev);
        next.add(fetcher.data!.themeKey as string);
        return next;
      });
      shopify.toast?.show?.(t("review.articleCreatedDraft"));
    }
    if (fetcher.data?.error) {
      shopify.toast?.show?.(fetcher.data.error);
    }
  }, [fetcher.data, shopify, t]);

  const statusLabel = t(`review.statusLabels.${jobStatus}`, {
    defaultValue: jobStatus,
  });

  return (
    <s-page heading={t("review.pageHeading")}>
      <s-button variant="tertiary" slot="back-action">
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
              {t("review.status")} {statusLabel}. {t("review.jobId")} {jobId}
            </s-paragraph>
            {jobError && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-paragraph>{jobError}</s-paragraph>
              </s-box>
            )}
            {blogs.length === 0 && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-paragraph>{t("review.noBlogsFound")}</s-paragraph>
              </s-box>
            )}
            {posts.length > 0 && (
              <s-stack direction="block" gap="large">
                {posts.map((post) => {
                  const isPublished = publishedThemes.has(post.theme_key);
                  const targetBlogId =
                    selectedBlog[post.theme_key] ?? blogs[0]?.id ?? "";
                  const isSubmittingThisTheme =
                    fetcher.state !== "idle" &&
                    fetcher.formData?.get("themeKey") === post.theme_key;

                  return (
                    <s-box
                      key={post.theme_key}
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-stack direction="block" gap="base">
                        <s-heading>{post.theme_key}</s-heading>
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
                        {blogs.length > 0 && (
                          <s-stack direction="inline" gap="base">
                            <s-select
                              label={t("review.targetBlog")}
                              name={`blog-${post.theme_key}`}
                              value={targetBlogId}
                              onChange={(e) =>
                                setSelectedBlog((prev) => ({
                                  ...prev,
                                  [post.theme_key]: (
                                    e.currentTarget as unknown as { value: string }
                                  ).value,
                                }))
                              }
                            >
                              {blogs.map((b) => (
                                <s-option key={b.id} value={b.id}>
                                  {b.title}
                                </s-option>
                              ))}
                            </s-select>
                            <div style={{ marginLeft: "auto" }}>
                              {isPublished ? (
                                <s-badge tone="success">
                                  {t("review.publishedDraft")}
                                </s-badge>
                              ) : (
                                <fetcher.Form method="POST">
                                  <input type="hidden" name="intent" value="publish" />
                                  <input type="hidden" name="jobId" value={jobId} />
                                  <input type="hidden" name="themeKey" value={post.theme_key} />
                                  <input type="hidden" name="blogId" value={targetBlogId} />
                                  <input
                                    type="hidden"
                                    name="title"
                                    value={post.metafields?.meta_title ?? post.theme_key}
                                  />
                                  <input type="hidden" name="bodyHtml" value={post.html} />
                                  <input
                                    type="hidden"
                                    name="metaDescription"
                                    value={post.metafields?.meta_description ?? ""}
                                  />
                                  <input type="hidden" name="author" value="Story-telling" />
                                  <s-button
                                    type="submit"
                                    variant="primary"
                                    {...(isSubmittingThisTheme ? { loading: true, disabled: true } : {})}
                                  >
                                    {t("review.publish")}
                                  </s-button>
                                </fetcher.Form>
                              )}
                            </div>
                          </s-stack>
                        )}
                      </s-stack>
                    </s-box>
                  );
                })}
              </s-stack>
            )}
          </>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
