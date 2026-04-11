import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import {
  generateBlogPost,
  isContentGenConfigured,
} from "../services/content-gen/client.server";
import {
  getBrandAssets,
  getBrandContextForGeneration,
} from "../services/brand-assets/service.server";
import { createJob } from "../services/storytelling/blog-post-job.server";

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          productType
          variants(first: 5) {
            edges {
              node {
                id
                price
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let products: { id: string; title: string; handle: string; productType: string }[] = [];
  let cursor: string | null = null;

  console.info(`[storytelling:brief] loader START shop=${shop}`);
  try {
    do {
      const productsResponse = await admin.graphql(PRODUCTS_QUERY, {
        variables: { first: 250, after: cursor ?? undefined },
      });
      const productsJson = (await productsResponse.json()) as {
        data?: { products?: { edges?: unknown[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } } };
      };
      const productsData = productsJson.data?.products;
      if (!productsData) break;

      const edges = (productsData.edges || []) as { node: { id: string; title: string; handle: string; productType: string } }[];
      products = products.concat(
        edges.map((e) => ({
          id: e.node.id,
          title: e.node.title,
          handle: e.node.handle,
          productType: e.node.productType || "",
        })),
      );

      const pageInfo = productsData.pageInfo || {};
      cursor = pageInfo.hasNextPage ? pageInfo.endCursor ?? null : null;
    } while (cursor);
    console.info(`[storytelling:brief] loader OK shop=${shop} products=${products.length}`);
  } catch (err) {
    console.error(`[storytelling:brief] loader products FAILED shop=${shop}`, err);
  }

  const settings = await getBrandAssets(shop);

  return { products, settings, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  if (!isContentGenConfigured()) {
    return {
      error: "Content Gen API not configured. Set CONTENT_GEN_API_URL and CONTENT_GEN_API_KEY.",
    };
  }
  console.info(`[storytelling:brief] action generate START shop=${shop}`);

  const formData = await request.formData();
  const briefJson = formData.get("briefJson") as string;

  if (!briefJson) {
    return { error: "Brief data is required." };
  }

  let brief: Record<string, unknown>;
  try {
    brief = JSON.parse(briefJson) as Record<string, unknown>;
  } catch {
    return { error: "Invalid brief JSON." };
  }

  const brandContext = await getBrandContextForGeneration(shop);

  // Resolve product handles to full context for the API
  const productHandles = new Set<string>();
  const productsMap = brief.products as Record<string, string[]> | undefined;
  if (productsMap && typeof productsMap === "object") {
    for (const handles of Object.values(productsMap)) {
      if (Array.isArray(handles)) {
        handles.forEach((h: string) => productHandles.add(h));
      }
    }
  }

  let productContext: { handle: string; title: string }[] = [];
  if (productHandles.size > 0) {
    const q = Array.from(productHandles)
      .slice(0, 10)
      .map((h) => `handle:${h}`)
      .join(" OR ");
    const productsResponse = await admin.graphql(
      `#graphql
      query GetProductsByHandles($query: String!) {
        products(first: 50, query: $query) {
          edges {
            node {
              handle
              title
            }
          }
        }
      }`,
      { variables: { query: q } },
    );
    const productsJson = await productsResponse.json();
    const edges = productsJson.data?.products?.edges || [];
    productContext = edges.map(
      (e: { node: { handle: string; title: string } }) => ({
        handle: e.node.handle,
        title: e.node.title,
      }),
    );
  }
  brief.productContext = productContext;

  const result = await generateBlogPost({ shop, brief, brandContext });
  if ("error" in result) {
    return { error: result.error };
  }

  await createJob({ shop, jobId: result.jobId, briefJson });
  return { jobId: result.jobId, success: true };
};

const DEFAULT_BRIEF = {
  macro_name: "my_campaign",
  themes: { theme_1: "Theme title here" },
  seo_themes: { theme_1: "SEO phrase for theme" },
  brief_summary: { theme_1: "Summary of what the post should cover" },
  products: { theme_1: ["product-handle"] },
  keywords: {
    theme_1: {
      primary_keywords: ["keyword1", "keyword2"],
      long_tail_keywords: [],
      related_searches: [],
      search_volume: {},
      competition_level: "medium",
    },
  },
};

export default function BriefPage() {
  const { products, settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { t } = useTranslation("storytelling");
  const [briefJson, setBriefJson] = useState(
    () => JSON.stringify(DEFAULT_BRIEF, null, 2),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetcher.submit(
      { briefJson },
      { method: "POST" },
    );
  };

  return (
    <s-page heading={t("brief.pageHeading")}>
      <s-button variant="tertiary" slot="secondary-actions">
        <Link to="/app/storytelling" style={{ color: "inherit", textDecoration: "none" }}>
          {t("common:button.back")}
        </Link>
      </s-button>
      <s-button variant="primary" slot="primary-action" onClick={() => (document.getElementById("brief-form") as HTMLFormElement)?.requestSubmit()}>
        {t("common:button.confirm")}
      </s-button>

      <s-section heading={t("brief.briefConfig")}>
        {!settings && (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>
              {t("brief.configureBrandFirst")}{" "}
              <s-link href="/app/brand-settings">{t("index.configureBrand")}</s-link>{" "}
              {t("brief.beforeGenerating")}
            </s-paragraph>
          </s-box>
        )}

        {fetcher.data?.error && (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-box>
        )}

        {fetcher.data?.jobId && (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>
              {t("brief.generationStarted")}{" "}
              <Link to={`/app/storytelling/review?jobId=${fetcher.data.jobId}`}>
                {t("brief.viewProgress")}
              </Link>
            </s-paragraph>
            <s-button variant="primary">
              <Link to={`/app/storytelling/review?jobId=${fetcher.data.jobId}`}>
                {t("brief.goToReview")}
              </Link>
            </s-button>
          </s-box>
        )}

        <s-paragraph>
          {t("brief.defineThemes")}
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-section heading={t("brief.availableProducts")}>
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-paragraph>
                {t("brief.productCount", { count: products.length })}{" "}
                {products.slice(0, 20).map((p) => p.handle).join(", ")}
                {products.length > 20 ? "..." : ""}
              </s-paragraph>
            </s-box>
          </s-section>

          <form id="brief-form" onSubmit={handleSubmit}>
            <s-stack direction="block" gap="base">
              <label htmlFor="briefJson">{t("brief.briefJson")}</label>
              <textarea
                id="briefJson"
                name="briefJson"
                rows={20}
                value={briefJson}
                onChange={(e) => setBriefJson(e.target.value)}
                style={{ width: "100%", fontFamily: "monospace", fontSize: "12px" }}
              />
              <s-button type="submit" variant="primary" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
                {t("common:button.confirm")}
              </s-button>
            </s-stack>
          </form>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading={t("brief.briefStructure")}>
        <s-paragraph>
          {t("brief.requiredKeys")}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
