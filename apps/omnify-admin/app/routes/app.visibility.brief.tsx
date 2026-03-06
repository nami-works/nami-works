import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

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
  } catch (err) {
    console.error("Error loading products:", err);
  }

  const settings = await prisma.brandSettings.findUnique({
    where: { shop },
  });

  return { products, settings, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const apiUrl = process.env.BLOG_GEN_API_URL;
  const apiKey = process.env.BLOG_GEN_API_KEY;

  if (!apiUrl || !apiKey) {
    return {
      error: "Blog Gen API not configured. Set BLOG_GEN_API_URL and BLOG_GEN_API_KEY.",
    };
  }

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

  const settings = await prisma.brandSettings.findUnique({
    where: { shop },
  });

  const brandContext = settings
    ? {
        about: settings.about,
        toneOfVoice: settings.toneOfVoice,
        brandName: settings.brandName ?? shop.split(".")[0],
        blogUrl: settings.blogUrl,
        contentLanguage: settings.contentLanguage ?? "en_US",
        benchmarks: settings.benchmarks,
        brandCategory: settings.brandCategory,
        editorialGuidelines: settings.editorialGuidelines,
        formatRecommendations: settings.formatRecommendations,
      }
    : { brandName: shop.split(".")[0], contentLanguage: "en_US" };

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

  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        shop,
        brief,
        brandContext,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { error: `API error: ${response.status} - ${text}` };
    }

    const data = (await response.json()) as { job_id?: string };
    return { jobId: data.job_id, success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to start generation.",
    };
  }
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
    <s-page heading="Create brief">
      <s-button variant="tertiary" slot="secondary-actions">
        <Link to="/app/visibility" style={{ color: "inherit", textDecoration: "none" }}>
          Back
        </Link>
      </s-button>
      <s-button variant="primary" slot="primary-action" onClick={() => (document.getElementById("brief-form") as HTMLFormElement)?.requestSubmit()}>
        Generate
      </s-button>

      <s-section heading="Brief configuration">
        {!settings && (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>
              Configure your brand in{" "}
              <s-link href="/app/brand-settings">Brand settings</s-link> before generating.
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
              Generation started.{" "}
              <Link to={`/app/visibility/review?jobId=${fetcher.data.jobId}`}>
                View progress
              </Link>
            </s-paragraph>
            <s-button variant="primary">
              <Link to={`/app/visibility/review?jobId=${fetcher.data.jobId}`}>
                Go to review
              </Link>
            </s-button>
          </s-box>
        )}

        <s-paragraph>
          Define your themes, product mapping, and keywords. Use valid product
          handles from your catalog.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-section heading="Available products">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-paragraph>
                {products.length} product(s). Handles:{" "}
                {products.slice(0, 20).map((p) => p.handle).join(", ")}
                {products.length > 20 ? "..." : ""}
              </s-paragraph>
            </s-box>
          </s-section>

          <form id="brief-form" onSubmit={handleSubmit}>
            <s-stack direction="block" gap="base">
              <label htmlFor="briefJson">Brief (JSON)</label>
              <textarea
                id="briefJson"
                name="briefJson"
                rows={20}
                value={briefJson}
                onChange={(e) => setBriefJson(e.target.value)}
                style={{ width: "100%", fontFamily: "monospace", fontSize: "12px" }}
              />
              <s-button type="submit" variant="primary" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
                Generate
              </s-button>
            </s-stack>
          </form>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Brief structure">
        <s-paragraph>
          Required keys: macro_name, themes, seo_themes, brief_summary,
          products, keywords. Products map theme_key to array of product handles.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
