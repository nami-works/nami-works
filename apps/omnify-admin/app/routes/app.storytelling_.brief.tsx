import { useMemo, useState } from "react";
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
import prisma from "../db.server";
import { PageTabs, type PageTab } from "../components/page-tabs";
import styles from "./app.storytelling_.brief/styles.module.css";

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          productType
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

type ProductSummary = {
  id: string;
  title: string;
  handle: string;
  productType: string;
};

type LoaderData = {
  products: ProductSummary[];
  hasBrandSettings: boolean;
  brandName: string | null;
  contentLanguage: string;
  toneTraitsCount: number;
  learningsCount: number;
  toneOfVoice: string | null;
  shop: string;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let products: ProductSummary[] = [];
  let cursor: string | null = null;

  console.info(`[storytelling:brief] loader START shop=${shop}`);
  try {
    do {
      const productsResponse = await admin.graphql(PRODUCTS_QUERY, {
        variables: { first: 250, after: cursor ?? undefined },
      });
      const productsJson = (await productsResponse.json()) as {
        data?: {
          products?: {
            edges?: Array<{
              node: {
                id: string;
                title: string;
                handle: string;
                productType: string;
              };
            }>;
            pageInfo?: { hasNextPage?: boolean; endCursor?: string };
          };
        };
      };
      const productsData = productsJson.data?.products;
      if (!productsData) break;

      const edges = productsData.edges ?? [];
      products = products.concat(
        edges.map((e) => ({
          id: e.node.id,
          title: e.node.title,
          handle: e.node.handle,
          productType: e.node.productType ?? "",
        })),
      );

      const pageInfo = productsData.pageInfo ?? {};
      cursor = pageInfo.hasNextPage ? (pageInfo.endCursor ?? null) : null;
    } while (cursor);
    console.info(
      `[storytelling:brief] loader OK shop=${shop} products=${products.length}`,
    );
  } catch (err) {
    console.error(`[storytelling:brief] loader products FAILED shop=${shop}`, err);
  }

  const settings = await getBrandAssets(shop);

  const [toneTraitsCount, learningsCount] = await Promise.all([
    prisma.brandToneHypothesis
      .count({ where: { shop, status: "accepted" } })
      .catch(() => 0),
    prisma.brandLearning
      .count({ where: { shop, status: "accepted" } })
      .catch(() => 0),
  ]);

  return {
    products,
    hasBrandSettings: settings !== null,
    brandName: settings?.brandName ?? null,
    contentLanguage: settings?.contentLanguage ?? "en_US",
    toneTraitsCount,
    learningsCount,
    toneOfVoice: settings?.toneOfVoice ?? null,
    shop,
  };
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

type ThemeForm = {
  id: string;
  title: string;
  seoPhrase: string;
  summary: string;
  productHandles: string[];
  primaryKeywords: string[];
  longTailKeywords: string[];
  relatedSearches: string[];
  competitionLevel: "low" | "medium" | "high";
  expanded: boolean;
};

type BriefForm = {
  campaignName: string;
  contentLanguage: string;
  themes: ThemeForm[];
};

function newTheme(expanded: boolean): ThemeForm {
  return {
    id: `theme_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    seoPhrase: "",
    summary: "",
    productHandles: [],
    primaryKeywords: [],
    longTailKeywords: [],
    relatedSearches: [],
    competitionLevel: "medium",
    expanded,
  };
}

function defaultBrief(): BriefForm {
  return {
    campaignName: "",
    contentLanguage: "en_US",
    themes: [{ ...newTheme(true) }],
  };
}

function toBriefJson(brief: BriefForm): string {
  const themes: Record<string, string> = {};
  const seoThemes: Record<string, string> = {};
  const summary: Record<string, string> = {};
  const products: Record<string, string[]> = {};
  const keywords: Record<
    string,
    {
      primary_keywords: string[];
      long_tail_keywords: string[];
      related_searches: string[];
      search_volume: Record<string, number>;
      competition_level: string;
    }
  > = {};

  brief.themes.forEach((theme, idx) => {
    const key = `theme_${idx + 1}`;
    themes[key] = theme.title;
    seoThemes[key] = theme.seoPhrase;
    summary[key] = theme.summary;
    products[key] = theme.productHandles;
    keywords[key] = {
      primary_keywords: theme.primaryKeywords,
      long_tail_keywords: theme.longTailKeywords,
      related_searches: theme.relatedSearches,
      search_volume: {},
      competition_level: theme.competitionLevel,
    };
  });

  return JSON.stringify(
    {
      macro_name: brief.campaignName.trim() || "campaign",
      themes,
      seo_themes: seoThemes,
      brief_summary: summary,
      products,
      keywords,
    },
    null,
    2,
  );
}

function fromBriefJson(json: string, fallback: BriefForm): BriefForm {
  try {
    const parsed = JSON.parse(json) as {
      macro_name?: string;
      themes?: Record<string, string>;
      seo_themes?: Record<string, string>;
      brief_summary?: Record<string, string>;
      products?: Record<string, string[]>;
      keywords?: Record<
        string,
        {
          primary_keywords?: string[];
          long_tail_keywords?: string[];
          related_searches?: string[];
          competition_level?: string;
        }
      >;
    };
    const themeKeys = parsed.themes ? Object.keys(parsed.themes) : [];
    if (themeKeys.length === 0) return fallback;
    return {
      campaignName: parsed.macro_name ?? "",
      contentLanguage: fallback.contentLanguage,
      themes: themeKeys.map((key, idx) => ({
        id: `theme_${idx}_${key}`,
        title: parsed.themes?.[key] ?? "",
        seoPhrase: parsed.seo_themes?.[key] ?? "",
        summary: parsed.brief_summary?.[key] ?? "",
        productHandles: parsed.products?.[key] ?? [],
        primaryKeywords: parsed.keywords?.[key]?.primary_keywords ?? [],
        longTailKeywords: parsed.keywords?.[key]?.long_tail_keywords ?? [],
        relatedSearches: parsed.keywords?.[key]?.related_searches ?? [],
        competitionLevel:
          (parsed.keywords?.[key]?.competition_level as
            | "low"
            | "medium"
            | "high") ?? "medium",
        expanded: idx === 0,
      })),
    };
  } catch {
    return fallback;
  }
}

type ChipInputProps = {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  productMode?: boolean;
};

function ChipInput({ values, onChange, placeholder, productMode }: ChipInputProps) {
  const [draft, setDraft] = useState("");
  return (
    <div className={styles.chipBox}>
      {values.map((v) => (
        <span
          key={v}
          className={`${styles.chip}${productMode ? ` ${styles.chipProduct}` : ""}`}
        >
          {v}
          <button
            type="button"
            className={styles.chipX}
            onClick={() => onChange(values.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const next = draft.trim();
            if (next && !values.includes(next)) {
              onChange([...values, next]);
            }
            setDraft("");
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => {
          const next = draft.trim();
          if (next && !values.includes(next)) {
            onChange([...values, next]);
          }
          setDraft("");
        }}
      />
    </div>
  );
}

type ProductPickerProps = {
  products: ProductSummary[];
  selected: string[];
  onChange: (next: string[]) => void;
};

function ProductPicker({ products, selected, onChange }: ProductPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return products.slice(0, 50);
    return products
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [products, query]);

  return (
    <div className={styles.productPicker}>
      <div className={styles.productSearch}>
        <input
          type="text"
          placeholder="Search products by title or handle..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className={styles.productList}>
        {filtered.length === 0 ? (
          <div style={{ padding: 12, color: "#6d7175", fontSize: 13 }}>
            No products match.
          </div>
        ) : (
          filtered.map((p) => {
            const isSelected = selected.includes(p.handle);
            return (
              <button
                type="button"
                key={p.handle}
                className={styles.productRow}
                onClick={() => {
                  if (isSelected) {
                    onChange(selected.filter((h) => h !== p.handle));
                  } else if (selected.length < 5) {
                    onChange([...selected, p.handle]);
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  readOnly
                  tabIndex={-1}
                />
                <span>
                  {p.title}{" "}
                  <span className={styles.productHandle}>{p.handle}</span>
                </span>
                {p.productType && (
                  <span className={styles.productHandle}>{p.productType}</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function BriefPage() {
  const {
    products,
    hasBrandSettings,
    brandName,
    contentLanguage,
    toneTraitsCount,
    learningsCount,
    toneOfVoice,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { t } = useTranslation("storytelling");

  const [brief, setBrief] = useState<BriefForm>(() => ({
    ...defaultBrief(),
    contentLanguage: contentLanguage,
  }));
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJsonDraft, setRawJsonDraft] = useState("");
  const [openProductPickerFor, setOpenProductPickerFor] = useState<string | null>(
    null,
  );

  const isSubmitting = fetcher.state !== "idle";

  function updateTheme(id: string, patch: Partial<ThemeForm>) {
    setBrief((prev) => ({
      ...prev,
      themes: prev.themes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }

  function addTheme() {
    setBrief((prev) => {
      if (prev.themes.length >= 5) return prev;
      return {
        ...prev,
        themes: [...prev.themes.map((t) => ({ ...t, expanded: false })), newTheme(true)],
      };
    });
  }

  function deleteTheme(id: string) {
    setBrief((prev) => ({
      ...prev,
      themes: prev.themes.filter((t) => t.id !== id),
    }));
  }

  function toggleExpand(id: string) {
    updateTheme(id, { expanded: !brief.themes.find((t) => t.id === id)?.expanded });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const json = showRawJson ? rawJsonDraft : toBriefJson(brief);
    fetcher.submit({ briefJson: json }, { method: "POST" });
  }

  function toggleJsonView() {
    if (!showRawJson) {
      setRawJsonDraft(toBriefJson(brief));
      setShowRawJson(true);
    } else {
      setBrief((prev) => fromBriefJson(rawJsonDraft, prev));
      setShowRawJson(false);
    }
  }

  const productByHandle = useMemo(() => {
    const map = new Map<string, ProductSummary>();
    products.forEach((p) => map.set(p.handle, p));
    return map;
  }, [products]);

  const hasInvalidTheme = brief.themes.some((t) => !t.title.trim());

  // Option-C tab strip (same pattern as Settings > Brand > Tone of voice):
  // extends the parent Storytelling tabs with "New brief" as the active tab
  // and "Blog posts" rendered in-trail (subdued + "›" separator after it).
  // Replaces the chevron back-action — the in-trail Blog posts tab IS the
  // "back" affordance, AND the parent tabs remain available for switching to
  // sibling sections (Alt-text). Order is reshuffled so the in-trail parent
  // sits immediately before the active sub-tab; the chevron then "leads
  // into" the active tab semantically.
  const briefTabs: PageTab[] = [
    { key: "alt-text", label: t("tabs.altText"), to: "/app/storytelling/alt-text" },
    { key: "blog-posts", label: t("tabs.blogPosts"), to: "/app/storytelling", variant: "in-trail" },
    { key: "new-brief", label: t("brief.pageHeading"), to: "/app/storytelling/brief" },
  ];

  return (
    // Heading is "Storytelling" (not "New brief") because the Shopify-chrome
    // breadcrumb above <s-page> reads from this prop — it must match the
    // top-level nav item ("Storytelling") regardless of which sub-page we're
    // on. The active sub-tab (New brief, with Blog posts in-trail) is
    // communicated by the <PageTabs> below.
    <s-page heading={t("pageHeading")}>
      <PageTabs activeKey="new-brief" tabs={briefTabs} ariaLabel={t("pageHeading") as string} />
      <div slot="primary-action" className={styles.headerActions}>
        <s-button variant="tertiary" onClick={toggleJsonView}>
          {showRawJson
            ? t("brief.viewAsForm", { defaultValue: "View as form" })
            : t("brief.viewAsJson", { defaultValue: "View as JSON" })}
        </s-button>
        <s-button
          variant="primary"
          onClick={() => {
            (document.getElementById("brief-form") as HTMLFormElement)?.requestSubmit();
          }}
          {...(isSubmitting ? { loading: true, disabled: true } : {})}
          {...(hasInvalidTheme && !showRawJson ? { disabled: true } : {})}
        >
          {t("brief.generate", { defaultValue: "Generate drafts →" })}
        </s-button>
      </div>

      <s-section heading={t("brief.briefConfig")}>
        {!hasBrandSettings && (
          <div className={styles.errorBanner}>
            {t("brief.configureBrandFirst")}{" "}
            <Link to="/app/settings/brand">{t("index.configureBrand")}</Link>{" "}
            {t("brief.beforeGenerating")}
          </div>
        )}

        {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
          <div className={styles.errorBanner}>{fetcher.data.error}</div>
        )}

        {fetcher.data && "jobId" in fetcher.data && fetcher.data.jobId && (
          <div className={styles.successBanner}>
            <span>
              {t("brief.generationStarted")}{" "}
              <Link to={`/app/storytelling/review?jobId=${fetcher.data.jobId}`}>
                {t("brief.viewProgress")}
              </Link>
            </span>
            <s-button variant="primary">
              <Link
                to={`/app/storytelling/review?jobId=${fetcher.data.jobId}`}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                {t("brief.goToReview")}
              </Link>
            </s-button>
          </div>
        )}

        <div className={styles.contextBand}>
          <div>
            <div className={styles.contextLabel}>
              {t("brief.brandContext.heading", {
                defaultValue: "Brand context the AI will use",
              })}
            </div>
            <div className={styles.contextSummary}>
              {brandName ? `${brandName} · ` : ""}
              {toneOfVoice ? toneOfVoice.slice(0, 60) + (toneOfVoice.length > 60 ? "…" : "") : t("brief.brandContext.noTone", { defaultValue: "no manual tone string" })}
              {" · "}
              {t("brief.brandContext.toneTraits", {
                count: toneTraitsCount,
                defaultValue: `${toneTraitsCount} validated tone trait${toneTraitsCount === 1 ? "" : "s"}`,
              })}
              {" · "}
              {t("brief.brandContext.learnings", {
                count: learningsCount,
                defaultValue: `${learningsCount} edit-correction${learningsCount === 1 ? "" : "s"}`,
              })}
              {" · "}
              {contentLanguage}
            </div>
          </div>
          <Link
            to="/app/settings/brand/tone-sources"
            className={styles.contextLink}
          >
            {t("brief.brandContext.manage", {
              defaultValue: "Manage tone sources →",
            })}
          </Link>
        </div>

        <form id="brief-form" onSubmit={handleSubmit}>
          {showRawJson ? (
            <textarea
              className={styles.jsonEditor}
              rows={28}
              value={rawJsonDraft}
              onChange={(e) => setRawJsonDraft(e.target.value)}
            />
          ) : (
            <>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {t("brief.fields.campaignName", {
                      defaultValue: "Campaign name",
                    })}
                  </span>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    value={brief.campaignName}
                    onChange={(e) =>
                      setBrief((prev) => ({
                        ...prev,
                        campaignName: e.target.value,
                      }))
                    }
                    placeholder="May launch — kit lançamento"
                  />
                  <span className={styles.fieldHint}>
                    {t("brief.fields.campaignNameHint", {
                      defaultValue:
                        "Used as the macro grouping name for this batch of posts.",
                    })}
                  </span>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {t("brief.fields.contentLanguage", {
                      defaultValue: "Target language",
                    })}
                  </span>
                  <select
                    className={styles.fieldSelect}
                    value={brief.contentLanguage}
                    onChange={(e) =>
                      setBrief((prev) => ({
                        ...prev,
                        contentLanguage: e.target.value,
                      }))
                    }
                  >
                    <option value="en_US">English (US)</option>
                    <option value="pt_BR">Portuguese (BR)</option>
                    <option value="es_MX">Spanish (MX)</option>
                  </select>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  margin: "12px 0",
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                    {t("brief.themes.heading", { defaultValue: "Themes" })}
                  </h3>
                  <div style={{ fontSize: 12, color: "#6d7175" }}>
                    {t("brief.themes.sub", {
                      count: brief.themes.length,
                      defaultValue: `${brief.themes.length} of 5 — each theme produces one blog post.`,
                    })}
                  </div>
                </div>
                <s-button
                  variant="tertiary"
                  onClick={addTheme}
                  {...(brief.themes.length >= 5 ? { disabled: true } : {})}
                >
                  {t("brief.themes.add", { defaultValue: "+ Add theme" })}
                </s-button>
              </div>

              <div className={styles.themeList}>
                {brief.themes.map((theme, idx) => {
                  const titleMissing = !theme.title.trim();
                  return (
                    <div
                      key={theme.id}
                      className={`${styles.themeCard}${theme.expanded ? ` ${styles.themeCardExpanded}` : ""}`}
                    >
                      <div
                        className={styles.themeHeader}
                        onClick={() => toggleExpand(theme.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleExpand(theme.id);
                          }
                        }}
                      >
                        <div className={styles.themeNumber}>{idx + 1}</div>
                        <div className={styles.themeTitle}>
                          <div className={styles.themeTitleText}>
                            {theme.title.trim() ||
                              t("brief.themes.untitled", {
                                defaultValue: "Untitled theme",
                              })}
                          </div>
                          <div className={styles.themeMeta}>
                            <span>
                              {theme.seoPhrase
                                ? `SEO: ${theme.seoPhrase}`
                                : t("brief.themes.noSeo", {
                                    defaultValue: "No SEO phrase",
                                  })}
                            </span>
                            <span>
                              {t("brief.themes.productCount", {
                                count: theme.productHandles.length,
                                defaultValue: `${theme.productHandles.length} product${theme.productHandles.length === 1 ? "" : "s"}`,
                              })}
                            </span>
                            <span>
                              {t("brief.themes.keywordCount", {
                                count:
                                  theme.primaryKeywords.length +
                                  theme.longTailKeywords.length,
                                defaultValue: `${theme.primaryKeywords.length + theme.longTailKeywords.length} keyword${theme.primaryKeywords.length + theme.longTailKeywords.length === 1 ? "" : "s"}`,
                              })}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`${styles.themeChevron}${theme.expanded ? ` ${styles.themeChevronExpanded}` : ""}`}
                        >
                          ⌃
                        </span>
                      </div>

                      {theme.expanded && (
                        <div className={styles.themeBody}>
                          <div className={styles.grid2}>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>
                                {t("brief.fields.themeTitle", {
                                  defaultValue: "Theme title",
                                })}
                              </span>
                              <input
                                className={`${styles.fieldInput}${titleMissing ? ` ${styles.fieldInputError}` : ""}`}
                                type="text"
                                value={theme.title}
                                onChange={(e) =>
                                  updateTheme(theme.id, { title: e.target.value })
                                }
                                placeholder={t("brief.fields.themeTitlePlaceholder", {
                                  defaultValue: "e.g. Skincare brasileira para peles maduras",
                                })}
                              />
                              {titleMissing && (
                                <span
                                  className={styles.fieldHint}
                                  style={{ color: "#d72c0d" }}
                                >
                                  {t("brief.fields.themeTitleRequired", {
                                    defaultValue: "Theme title is required.",
                                  })}
                                </span>
                              )}
                            </div>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>
                                {t("brief.fields.seoPhrase", {
                                  defaultValue: "SEO phrase",
                                })}
                              </span>
                              <input
                                className={styles.fieldInput}
                                type="text"
                                value={theme.seoPhrase}
                                onChange={(e) =>
                                  updateTheme(theme.id, {
                                    seoPhrase: e.target.value,
                                  })
                                }
                                placeholder={t("brief.fields.seoPhrasePlaceholder", {
                                  defaultValue: "e.g. skincare brasileira pele madura",
                                })}
                              />
                              <span className={styles.fieldHint}>
                                {t("brief.fields.seoPhraseHint", {
                                  defaultValue:
                                    "The phrase that should anchor the article's headline + first paragraph.",
                                })}
                              </span>
                            </div>
                          </div>

                          <div className={styles.field}>
                            <span className={styles.fieldLabel}>
                              {t("brief.fields.summary", {
                                defaultValue: "Brief summary",
                              })}
                            </span>
                            <textarea
                              className={styles.fieldTextarea}
                              rows={3}
                              value={theme.summary}
                              onChange={(e) =>
                                updateTheme(theme.id, { summary: e.target.value })
                              }
                              placeholder={t("brief.fields.summaryPlaceholder", {
                                defaultValue:
                                  "What should the post cover? The AI uses this as the editorial brief, not as copy.",
                              })}
                            />
                          </div>

                          <div className={styles.field}>
                            <span className={styles.fieldLabel}>
                              {t("brief.fields.products", {
                                defaultValue: "Products to feature",
                              })}
                            </span>
                            {theme.productHandles.length > 0 && (
                              <div className={styles.chipBox}>
                                {theme.productHandles.map((handle) => {
                                  const product = productByHandle.get(handle);
                                  return (
                                    <span
                                      key={handle}
                                      className={`${styles.chip} ${styles.chipProduct}`}
                                    >
                                      {product?.title ?? handle}
                                      <button
                                        type="button"
                                        className={styles.chipX}
                                        onClick={() =>
                                          updateTheme(theme.id, {
                                            productHandles:
                                              theme.productHandles.filter(
                                                (h) => h !== handle,
                                              ),
                                          })
                                        }
                                      >
                                        ×
                                      </button>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            <s-button
                              variant="tertiary"
                              onClick={() =>
                                setOpenProductPickerFor(
                                  openProductPickerFor === theme.id
                                    ? null
                                    : theme.id,
                                )
                              }
                            >
                              {openProductPickerFor === theme.id
                                ? t("brief.fields.closePicker", {
                                    defaultValue: "Close picker",
                                  })
                                : t("brief.fields.openPicker", {
                                    defaultValue: "Pick products",
                                  })}
                            </s-button>
                            {openProductPickerFor === theme.id && (
                              <ProductPicker
                                products={products}
                                selected={theme.productHandles}
                                onChange={(next) =>
                                  updateTheme(theme.id, { productHandles: next })
                                }
                              />
                            )}
                            <span className={styles.fieldHint}>
                              {t("brief.fields.productsHint", {
                                defaultValue:
                                  "Up to 5 products per theme. Empty = AI picks from your full catalog.",
                              })}
                            </span>
                          </div>

                          <div className={styles.grid2}>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>
                                {t("brief.fields.primaryKeywords", {
                                  defaultValue: "Primary keywords",
                                })}
                              </span>
                              <ChipInput
                                values={theme.primaryKeywords}
                                onChange={(next) =>
                                  updateTheme(theme.id, { primaryKeywords: next })
                                }
                                placeholder={t("brief.fields.keywordPlaceholder", {
                                  defaultValue: "Press enter to add...",
                                })}
                              />
                            </div>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>
                                {t("brief.fields.longTailKeywords", {
                                  defaultValue: "Long-tail keywords",
                                })}
                              </span>
                              <ChipInput
                                values={theme.longTailKeywords}
                                onChange={(next) =>
                                  updateTheme(theme.id, { longTailKeywords: next })
                                }
                                placeholder={t("brief.fields.keywordPlaceholder", {
                                  defaultValue: "Press enter to add...",
                                })}
                              />
                            </div>
                          </div>

                          <div className={styles.grid2}>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>
                                {t("brief.fields.relatedSearches", {
                                  defaultValue: "Related searches",
                                })}
                              </span>
                              <ChipInput
                                values={theme.relatedSearches}
                                onChange={(next) =>
                                  updateTheme(theme.id, { relatedSearches: next })
                                }
                                placeholder={t("brief.fields.keywordPlaceholder", {
                                  defaultValue: "Press enter to add...",
                                })}
                              />
                            </div>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>
                                {t("brief.fields.competitionLevel", {
                                  defaultValue: "Competition level",
                                })}
                              </span>
                              <select
                                className={styles.fieldSelect}
                                value={theme.competitionLevel}
                                onChange={(e) =>
                                  updateTheme(theme.id, {
                                    competitionLevel: e.target.value as
                                      | "low"
                                      | "medium"
                                      | "high",
                                  })
                                }
                              >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                              </select>
                              <span className={styles.fieldHint}>
                                {t("brief.fields.competitionLevelHint", {
                                  defaultValue:
                                    "Hint to the AI about how aggressively to optimize for the SEO phrase.",
                                })}
                              </span>
                            </div>
                          </div>

                          <div className={styles.themeFooter}>
                            {brief.themes.length > 1 && (
                              <s-button
                                variant="tertiary"
                                tone="critical"
                                onClick={() => deleteTheme(theme.id)}
                              >
                                {t("brief.themes.delete", {
                                  defaultValue: "Delete theme",
                                })}
                              </s-button>
                            )}
                            <s-button
                              variant="tertiary"
                              onClick={() => toggleExpand(theme.id)}
                            >
                              {t("brief.themes.collapse", {
                                defaultValue: "Collapse",
                              })}
                            </s-button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
