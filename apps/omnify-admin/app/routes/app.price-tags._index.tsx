import { useState, useCallback, useRef, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchMetaobjectTypes,
  fetchMetaobjectDefinitionFields,
  type MetaobjectFieldDef,
} from "../services/price-tags/metaobject.server";
import { findProductMetafieldForMetaobjectType } from "../services/price-tags/metafield.server";
import styles from "./app.price-tags/styles.module.css";

type ProductHit = {
  id: string;
  title: string;
  image: string | null;
  variantCount: number;
  price: string | null;
  compareAtPrice: string | null;
};

type CollectionHit = {
  id: string;
  title: string;
  image: string | null;
  productCount: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  console.info(`[price-tags] loader START shop=${shop}`);

  const config = await prisma.priceTagConfig.findUnique({ where: { shop } });
  const metaobjectTypes = await fetchMetaobjectTypes(admin);

  let fieldDefinitions: MetaobjectFieldDef[] = [];
  let detectedDisplayNameKey = "";
  if (config?.metaobjectType) {
    const def = await fetchMetaobjectDefinitionFields(admin, config.metaobjectType);
    fieldDefinitions = def.fields;
    detectedDisplayNameKey = def.displayNameKey;
  }

  console.info(`[price-tags] loader OK shop=${shop} configured=${!!config} metaobjectType=${config?.metaobjectType ?? "?"}`);

  return {
    config: config
      ? {
          metaobjectType: config.metaobjectType,
          displayNameKey: config.displayNameKey,
          metaobjectFieldDefaults: config.metaobjectFieldDefaults,
        }
      : null,
    metaobjectTypes,
    fieldDefinitions,
    detectedDisplayNameKey,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action") as string;

  if (intent === "saveFieldDefaults") {
    console.info(`[price-tags] action START shop=${shop} intent=${intent}`);
    const metaobjectType = formData.get("metaobjectType") as string;
    const displayNameKey = formData.get("displayNameKey") as string;
    const fieldDefaultsJson = formData.get("fieldDefaults") as string;

    // Auto-detect the product metafield definition that references this metaobject type
    const mfDef = await findProductMetafieldForMetaobjectType(admin, metaobjectType);
    const metafieldNamespace = mfDef?.namespace ?? "";
    const metafieldKey = mfDef?.key ?? "";

    if (!mfDef) {
      console.warn(`[price-tags] No product metafield definition found for metaobject type=${metaobjectType}`);
    }

    await prisma.priceTagConfig.upsert({
      where: { shop },
      create: {
        shop,
        metaobjectType,
        metafieldNamespace,
        metafieldKey,
        displayNameKey,
        metaobjectFieldDefaults: fieldDefaultsJson,
      },
      update: {
        metaobjectType,
        metafieldNamespace,
        metafieldKey,
        displayNameKey,
        metaobjectFieldDefaults: fieldDefaultsJson,
      },
    });

    return {
      ok: true,
      intent: "saveFieldDefaults",
      detectedMetafield: mfDef ? `${metafieldNamespace}.${metafieldKey}` : null,
    };
  }

  if (intent === "fetchFieldDefs") {
    const metaobjectType = formData.get("metaobjectType") as string;
    if (!metaobjectType) return { fields: [], displayNameKey: "", intent: "fetchFieldDefs" };
    const def = await fetchMetaobjectDefinitionFields(admin, metaobjectType);
    return { fields: def.fields, displayNameKey: def.displayNameKey, intent: "fetchFieldDefs" };
  }

  if (intent === "searchProducts") {
    const query = (formData.get("query") as string) ?? "";
    const gqlQuery = query.trim() ? `status:active ${query}` : "status:active";
    const response = await admin.graphql(
      `#graphql
      query SearchProducts($query: String!) {
        products(first: 25, query: $query, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              featuredMedia { preview { image { url } } }
              variants(first: 1) { edges { node { price compareAtPrice } } }
              totalVariants
            }
          }
        }
      }`,
      { variables: { query: gqlQuery } },
    );
    const json = await response.json();
    const products: ProductHit[] = (json.data?.products?.edges ?? []).map((edge: any) => {
      const node = edge.node;
      const v = node.variants?.edges?.[0]?.node;
      return {
        id: node.id,
        title: node.title,
        image: node.featuredMedia?.preview?.image?.url ?? null,
        variantCount: node.totalVariants ?? 1,
        price: v?.price ?? null,
        compareAtPrice: v?.compareAtPrice ?? null,
      };
    });
    return { products, intent: "searchProducts" };
  }

  if (intent === "searchCollections") {
    const query = (formData.get("query") as string) ?? "";
    const response = await admin.graphql(
      `#graphql
      query SearchCollections($query: String) {
        collections(first: 25, query: $query, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              image { url }
              productsCount { count }
            }
          }
        }
      }`,
      { variables: { query: query.trim() || undefined } },
    );
    const json = await response.json();
    const collections: CollectionHit[] = (json.data?.collections?.edges ?? []).map((edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      image: edge.node.image?.url ?? null,
      productCount: edge.node.productsCount?.count ?? 0,
    }));
    return { collections, intent: "searchCollections" };
  }

  if (intent === "applyTags") {
    const mode = formData.get("mode") as string;
    const idsJson = formData.get("ids") as string;
    const ids: string[] = JSON.parse(idsJson);

    if (ids.length === 0) return { ok: false, intent: "applyTags", error: "No items selected" };

    try {
      const { handleProductUpdate } = await import("../services/price-tags/webhook-handler.server");

      let productGids: string[] = [];
      if (mode === "products") {
        productGids = ids;
      } else {
        for (const collectionId of ids) {
          let cursor: string | null = null;
          let hasNextPage = true;
          while (hasNextPage) {
            const response: Response = await admin.graphql(
              `#graphql
              query CollectionProducts($id: ID!, $cursor: String) {
                collection(id: $id) {
                  products(first: 100, after: $cursor) {
                    edges { node { id } }
                    pageInfo { hasNextPage endCursor }
                  }
                }
              }`,
              { variables: { id: collectionId, cursor } },
            );
            const json: any = await response.json();
            const data: any = json.data?.collection?.products;
            if (!data) break;
            for (const edge of data.edges) productGids.push(edge.node.id);
            hasNextPage = data.pageInfo.hasNextPage;
            cursor = data.pageInfo.endCursor;
          }
        }
        productGids = [...new Set(productGids)];
      }

      // Fetch product details
      type ProductDetail = { id: string; title: string; status: string; price: string | null; compareAtPrice: string | null; image: string | null };
      const productDetails = new Map<string, ProductDetail>();
      for (let i = 0; i < productGids.length; i += 50) {
        const batch = productGids.slice(i, i + 50);
        const idsQuery = batch.map((id) => `id:${id.replace("gid://shopify/Product/", "")}`).join(" OR ");
        const resp = await admin.graphql(
          `#graphql
          query ProductDetails($query: String!) {
            products(first: 50, query: $query) {
              edges { node { id title status featuredMedia { preview { image { url } } } variants(first: 1) { edges { node { price compareAtPrice } } } } }
            }
          }`,
          { variables: { query: idsQuery } },
        );
        const json = await resp.json();
        for (const edge of json.data?.products?.edges ?? []) {
          const n = edge.node;
          const v = n.variants?.edges?.[0]?.node;
          productDetails.set(n.id, { id: n.id, title: n.title, status: n.status, image: n.featuredMedia?.preview?.image?.url ?? null, price: v?.price ?? null, compareAtPrice: v?.compareAtPrice ?? null });
        }
      }

      type ProductRow = { id: string; title: string; status: string; image: string | null; price: string | null; compareAtPrice: string | null; tagAssigned: string | null; tagStatus: "created" | "assigned" | "cleared" | "skipped" | "error"; error?: string };
      const rows: ProductRow[] = [];
      const createdTags = new Set<string>();

      for (const gid of productGids) {
        const detail = productDetails.get(gid);
        try {
          const result = await handleProductUpdate(admin, shop, gid);
          if (result.tagCreated) createdTags.add(result.tagCreated);
          let tagStatus: ProductRow["tagStatus"] = "skipped";
          if (result.action === "labeled" && result.tagCreated) tagStatus = "created";
          else if (result.action === "labeled") tagStatus = "assigned";
          else if (result.action === "cleared") tagStatus = "cleared";
          rows.push({ id: gid, title: detail?.title ?? gid, status: detail?.status ?? "UNKNOWN", image: detail?.image ?? null, price: detail?.price ?? null, compareAtPrice: detail?.compareAtPrice ?? null, tagAssigned: result.tagAssigned, tagStatus });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          rows.push({ id: gid, title: detail?.title ?? gid, status: detail?.status ?? "UNKNOWN", image: detail?.image ?? null, price: detail?.price ?? null, compareAtPrice: detail?.compareAtPrice ?? null, tagAssigned: null, tagStatus: "error", error: message });
        }
      }

      return { ok: true, intent: "applyTags", rows, createdTags: [...createdTags], total: productGids.length, processed: rows.filter((r) => r.tagStatus !== "error").length, errors: rows.filter((r) => r.tagStatus === "error").length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[price-tags] Apply tags failed:", err);
      return { ok: false, intent: "applyTags", error: message };
    }
  }

  return { ok: false };
};

// SVG search icon (Polaris style)
function SearchIcon() {
  return (
    <svg className={styles.modalSearchIcon} viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M13.5 13.5 17 17" />
    </svg>
  );
}

export default function PriceTagsCampaigns() {
  const { t } = useTranslation("priceTags");
  const { config, metaobjectTypes, fieldDefinitions: initialFieldDefs, detectedDisplayNameKey } = useLoaderData<typeof loader>();
  const searchFetcher = useFetcher<typeof action>();
  const syncFetcher = useFetcher<typeof action>();
  const fieldDefFetcher = useFetcher<typeof action>();
  const saveConfigFetcher = useFetcher<typeof action>();
  const modalRef = useRef<any>(null);

  // --- Aside state ---
  const savedDefaults: Record<string, string> = config?.metaobjectFieldDefaults
    ? JSON.parse(config.metaobjectFieldDefaults)
    : {};
  const [asideMetaobjectType, setAsideMetaobjectType] = useState(config?.metaobjectType || "");
  const [asideDisplayNameKey, setAsideDisplayNameKey] = useState(config?.displayNameKey || detectedDisplayNameKey || "");
  const [asideFieldValues, setAsideFieldValues] = useState<Record<string, string>>(savedDefaults);
  const [asideFieldDefs, setAsideFieldDefs] = useState<MetaobjectFieldDef[]>(initialFieldDefs);
  const [asideSaved, setAsideSaved] = useState(false);
  const [asideCollapsed, setAsideCollapsed] = useState(false);

  // Update field defs when fetcher returns
  useEffect(() => {
    const data = fieldDefFetcher.data as any;
    if (data?.intent === "fetchFieldDefs" && data.fields) {
      setAsideFieldDefs(data.fields);
      setAsideDisplayNameKey(data.displayNameKey || "");
      // Initialize field values for new fields, preserving existing
      const newValues: Record<string, string> = { ...asideFieldValues };
      for (const f of data.fields as MetaobjectFieldDef[]) {
        if (!(f.key in newValues) && !f.isDisplayName) {
          newValues[f.key] = "";
        }
      }
      setAsideFieldValues(newValues);
    }
  }, [fieldDefFetcher.data]);

  useEffect(() => {
    const data = saveConfigFetcher.data as any;
    if (data?.intent === "saveFieldDefaults" && data.ok) {
      setAsideSaved(true);
      setTimeout(() => setAsideSaved(false), 3000);
    }
  }, [saveConfigFetcher.data]);

  const handleAsideTypeChange = useCallback((type: string) => {
    setAsideMetaobjectType(type);
    setAsideSaved(false);
    if (type) {
      fieldDefFetcher.submit({ _action: "fetchFieldDefs", metaobjectType: type }, { method: "POST" });
    } else {
      setAsideFieldDefs([]);
      setAsideFieldValues({});
    }
  }, [fieldDefFetcher]);

  const handleSaveConfig = useCallback(() => {
    saveConfigFetcher.submit(
      {
        _action: "saveFieldDefaults",
        metaobjectType: asideMetaobjectType,
        displayNameKey: asideDisplayNameKey,
        fieldDefaults: JSON.stringify(asideFieldValues),
      },
      { method: "POST" },
    );
    setAsideCollapsed(true);
  }, [saveConfigFetcher, asideMetaobjectType, asideDisplayNameKey, asideFieldValues]);

  // --- Campaign state ---
  const [mode, setMode] = useState<"collections" | "products">("collections");
  const [inlineQuery, setInlineQuery] = useState("");
  const [modalQuery, setModalQuery] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const [selectedProducts, setSelectedProducts] = useState<ProductHit[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<CollectionHit[]>([]);
  const [stagedProducts, setStagedProducts] = useState<ProductHit[]>([]);
  const [stagedCollections, setStagedCollections] = useState<CollectionHit[]>([]);

  const searchResults = searchFetcher.data as any;
  const productResults: ProductHit[] = searchResults?.intent === "searchProducts" ? searchResults.products : [];
  const collectionResults: CollectionHit[] = searchResults?.intent === "searchCollections" ? searchResults.collections : [];
  const isSearching = searchFetcher.state !== "idle";

  const isSyncing = syncFetcher.state === "submitting" || syncFetcher.state === "loading";
  const syncData = syncFetcher.data as any;
  const syncDone = syncData?.intent === "applyTags";
  const syncSuccess = syncDone && syncData.ok;
  const syncFailed = syncDone && !syncData.ok;

  // Auto-collapse aside when results appear
  useEffect(() => {
    if (syncSuccess) {
      setAsideCollapsed(true);
    }
  }, [syncSuccess]);

  const selectedItems = mode === "collections" ? selectedCollections : selectedProducts;
  const hasSelection = selectedItems.length > 0;

  // Inline search — only captures text, no dropdown
  const handleInlineSearch = useCallback((value: string) => {
    setInlineQuery(value);
  }, []);

  // Modal search with debounce
  const handleModalSearch = useCallback((value: string) => {
    setModalQuery(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => {
      searchFetcher.submit(
        { _action: mode === "collections" ? "searchCollections" : "searchProducts", query: value },
        { method: "POST" },
      );
    }, 250);
    setDebounceTimer(timer);
  }, [searchFetcher, debounceTimer, mode]);

  const openModal = useCallback(() => {
    setStagedProducts([...selectedProducts]);
    setStagedCollections([...selectedCollections]);
    const q = inlineQuery.trim();
    setModalQuery(q);
    searchFetcher.submit(
      { _action: mode === "collections" ? "searchCollections" : "searchProducts", query: q },
      { method: "POST" },
    );
    setInlineQuery("");
    modalRef.current?.showOverlay?.();
  }, [selectedProducts, selectedCollections, searchFetcher, mode, inlineQuery]);

  const handleToggleProduct = useCallback((product: ProductHit) => {
    setStagedProducts((prev) => prev.some((p) => p.id === product.id) ? prev.filter((p) => p.id !== product.id) : [...prev, product]);
  }, []);

  const handleToggleCollection = useCallback((collection: CollectionHit) => {
    setStagedCollections((prev) => prev.some((c) => c.id === collection.id) ? prev.filter((c) => c.id !== collection.id) : [...prev, collection]);
  }, []);

  const handleConfirmModal = useCallback(() => {
    if (mode === "collections") setSelectedCollections([...stagedCollections]);
    else setSelectedProducts([...stagedProducts]);
    setModalQuery("");
    setInlineQuery("");
    modalRef.current?.hideOverlay?.();
  }, [mode, stagedProducts, stagedCollections]);

  const handleRemoveProduct = useCallback((id: string) => {
    setSelectedProducts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleRemoveCollection = useCallback((id: string) => {
    setSelectedCollections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleModeChange = useCallback((newMode: string) => {
    setMode(newMode as "collections" | "products");
    setSelectedProducts([]);
    setSelectedCollections([]);
  }, []);

  const handleApplyTags = useCallback(() => {
    const ids = mode === "collections"
      ? selectedCollections.map((c) => c.id)
      : selectedProducts.map((p) => p.id);
    syncFetcher.submit(
      { _action: "applyTags", mode, ids: JSON.stringify(ids) },
      { method: "POST" },
    );
  }, [syncFetcher, mode, selectedProducts, selectedCollections]);

  const stagedIds = mode === "collections"
    ? new Set(stagedCollections.map((c) => c.id))
    : new Set(stagedProducts.map((p) => p.id));
  const stagedCount = mode === "collections" ? stagedCollections.length : stagedProducts.length;

  const isConfigured = !!asideMetaobjectType;

  return (
    <>
      <div className={styles.campaignLayout}>
        {/* Main — Add price tags (first in DOM, left on desktop) */}
        <div className={styles.campaignMain}>
          <s-section heading={t("campaigns.heading")}>
            <s-paragraph>{t("campaigns.description")}</s-paragraph>

            {!isConfigured && (
              <s-banner tone="warning">{t("campaigns.aside.configRequired")}</s-banner>
            )}

            {isConfigured && (
              <>
                <s-select
                  label={t("campaigns.appliesTo")}
                  value={mode}
                  onChange={(e: any) => handleModeChange(e.currentTarget.value)}
                >
                  <s-option value="collections">{t("campaigns.specificCollections")}</s-option>
                  <s-option value="products">{t("campaigns.specificProducts")}</s-option>
                </s-select>

                <div className={styles.searchRow}>
                  <div className={styles.searchField}>
                    <div className={styles.searchInputWrap}>
                      <SearchIcon />
                      <input
                        type="text"
                        className={styles.searchInput}
                        placeholder={mode === "collections" ? t("campaigns.searchCollections") : t("campaigns.searchProducts")}
                        value={inlineQuery}
                        onChange={(e) => handleInlineSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openModal(); } }}
                      />
                    </div>
                  </div>
                  <s-button variant="secondary" onClick={openModal}>
                    {t("campaigns.browse")}
                  </s-button>
                </div>

                {hasSelection && (
                  <div className={styles.selectionFooter}>
                    <div className={styles.badgeList}>
                      {mode === "collections" && selectedCollections.map((c) => (
                        <span key={c.id} className={styles.badge}>
                          <span className={styles.badgeLabel}>{c.title}</span>
                          <span className={styles.badgeRemove} onClick={() => handleRemoveCollection(c.id)}>×</span>
                        </span>
                      ))}
                      {mode === "products" && selectedProducts.map((p) => (
                        <span key={p.id} className={styles.badge}>
                          <span className={styles.badgeLabel}>{p.title}</span>
                          <span className={styles.badgeRemove} onClick={() => handleRemoveProduct(p.id)}>×</span>
                        </span>
                      ))}
                    </div>
                    <div className={styles.applyButtonWrap}>
                      {isSyncing ? (
                        <s-button variant="primary" loading disabled>{t("campaigns.applying")}</s-button>
                      ) : (
                        <s-button variant="primary" onClick={handleApplyTags}>{t("campaigns.applyButton")}</s-button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </s-section>

        </div>

        {/* Aside — Metaobject definition (right on desktop, first on mobile) */}
        <div className={styles.campaignAside}>
          <div className={styles.collapsibleSectionWrap}>
          <s-section heading={t("campaigns.aside.heading")}>
            <div className={styles.asideSelectRow}>
              <div className={styles.asideSelectField}>
                <s-select
                  value={asideMetaobjectType}
                  onChange={(e: any) => { handleAsideTypeChange(e.currentTarget.value); setAsideCollapsed(false); }}
                >
                  <s-option value="">{t("campaigns.aside.selectDefinition")}</s-option>
                  {metaobjectTypes.map((mo) => (
                    <s-option key={mo.type} value={mo.type}>{mo.name} ({mo.type})</s-option>
                  ))}
                </s-select>
              </div>
            </div>

            {!asideCollapsed && (
              <>
                {asideFieldDefs.length > 0 && (
                  <div className={styles.asideFields}>
                    {(() => {
                      let paramLabelShown = false;
                      return asideFieldDefs.map((f) => {
                      if (f.isDisplayName) {
                        return (
                          <p key={f.key} className={styles.displayNameHint}>
                            {t("campaigns.aside.displayNameHint", { field: f.name })}
                          </p>
                        );
                      }
                      const showParamLabel = !paramLabelShown;
                      if (showParamLabel) paramLabelShown = true;
                      const paramLabel = showParamLabel ? <h3 className={styles.subSectionTitle}>{t("campaigns.aside.parametersLabel")}</h3> : null;
                      if (f.typeName === "color") {
                        const rawVal = asideFieldValues[f.key] || "";
                        const hexBody = rawVal.replace(/^#/, "");
                        const previewColor = hexBody.length >= 3 ? `#${hexBody}` : "#000000";
                        return (
                          <div key={f.key}>
                            {paramLabel}
                            <div className={styles.colorFieldRow}>
                              <label className={styles.colorFieldLabel}>{f.name} {f.required ? "*" : ""}</label>
                              <div className={styles.colorFieldInputs}>
                                <div
                                  className={styles.colorSwatch}
                                  style={{ backgroundColor: previewColor }}
                                />
                                <div className={styles.colorTextWrap}>
                                  <span className={styles.colorHash}>#</span>
                                  <input
                                    type="text"
                                    value={hexBody.toUpperCase()}
                                    onChange={(e) => {
                                      const cleaned = e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6).toUpperCase();
                                      setAsideFieldValues((prev) => ({ ...prev, [f.key]: `#${cleaned}` }));
                                      setAsideSaved(false);
                                    }}
                                    className={styles.colorText}
                                    placeholder="000000"
                                    maxLength={6}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      if (f.typeName === "boolean") {
                        return (
                          <div key={f.key}>
                            {paramLabel}
                            <div className={styles.boolFieldRow}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={asideFieldValues[f.key] === "true"}
                                  onChange={(e) => {
                                    setAsideFieldValues((prev) => ({ ...prev, [f.key]: e.target.checked ? "true" : "false" }));
                                    setAsideSaved(false);
                                  }}
                                />
                                {" "}{f.name} {f.required ? "*" : ""}
                              </label>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={f.key}>
                          {paramLabel}
                          <s-text-field
                            label={`${f.name} ${f.required ? "*" : ""}`}
                            value={asideFieldValues[f.key] || ""}
                            onChange={(e: any) => {
                              setAsideFieldValues((prev) => ({ ...prev, [f.key]: e.currentTarget.value }));
                              setAsideSaved(false);
                            }}
                          />
                        </div>
                      );
                    });
                    })()}
                  </div>
                )}

                <div className={styles.asideSaveRow}>
                  {asideSaved && <span className={styles.asideSavedLabel}>{t("campaigns.aside.saved")}</span>}
                  <s-button
                    variant="primary"
                    onClick={handleSaveConfig}
                    disabled={!asideMetaobjectType}
                  >
                    {t("campaigns.aside.save")}
                  </s-button>
                </div>
              </>
            )}
            <div
              className={`${styles.collapseChevron}${asideCollapsed ? ` ${styles.collapsed}` : ""}`}
              onClick={() => setAsideCollapsed((prev) => !prev)}
              role="button"
              aria-label="Toggle aside"
            >
              <span className={styles.chevronIcon}>›</span>
            </div>
          </s-section>
          </div>
        </div>
      </div>

      {/* Results table — full width below the two-column layout */}
      {syncSuccess && syncData.rows && (
        <div className={styles.resultsSection}>
          <s-section heading={t("campaigns.resultsHeading", { count: syncData.total })}>
            {syncData.createdTags?.length > 0 && (
              <s-banner tone="info">
                {t("campaigns.tagsCreated", { count: syncData.createdTags.length })}:{" "}
                {syncData.createdTags.join(", ")}
              </s-banner>
            )}
            <div className={styles.bulkTable}>
              <table className={styles.resultsTable}>
                <thead>
                  <tr>
                    <th className={styles.thTitle}>{t("campaigns.colTitle")}</th>
                    <th>{t("campaigns.colStatus")}</th>
                    <th className={styles.thNum}>{t("campaigns.colBasePrice")}</th>
                    <th className={styles.thNum}>{t("campaigns.colCompareAt")}</th>
                    <th>{t("campaigns.colTag")}</th>
                    <th>{t("campaigns.colTagStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {syncData.rows.map((row: any) => {
                    const numericId = row.id.replace("gid://shopify/Product/", "");
                    const productUrl = `/app/products/${numericId}`;
                    return (
                    <tr key={row.id}>
                      <td className={styles.tdTitle}>
                        <a href={`shopify:admin/products/${numericId}`} className={styles.productLink} target="_top">
                          {row.image ? <img src={row.image} alt="" className={styles.resultThumb} /> : <div className={styles.resultThumbPlaceholder} />}
                          <span>{row.title}</span>
                        </a>
                      </td>
                      <td>
                        <span className={`${styles.statusBadge} ${row.status === "ACTIVE" ? styles.statusActive : styles.statusOther}`}>
                          {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                        </span>
                      </td>
                      <td className={styles.tdNum}>{row.price ?? "—"}</td>
                      <td className={styles.tdNum}>{row.compareAtPrice ?? "—"}</td>
                      <td>{row.tagAssigned ?? "—"}</td>
                      <td>
                        {row.tagStatus === "created" && <span className={styles.tagBadgeSuccess}>{t("campaigns.tagCreated")}</span>}
                        {row.tagStatus === "assigned" && <span className={styles.tagBadgeSuccess}>{t("campaigns.tagAssigned")}</span>}
                        {row.tagStatus === "cleared" && <span className={styles.tagBadgeNeutral}>{t("campaigns.tagCleared")}</span>}
                        {row.tagStatus === "skipped" && <span className={styles.tagBadgeNeutral}>{t("campaigns.tagSkipped")}</span>}
                        {row.tagStatus === "error" && <span className={styles.tagBadgeError} title={row.error}>{t("campaigns.tagFailed")}</span>}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </s-section>
        </div>
      )}

      {syncFailed && (
        <s-banner tone="critical">{t("campaigns.applyError", { error: syncData.error })}</s-banner>
      )}

      {/* Browse modal — results only render here */}
      <s-modal
        id="browse-modal"
        ref={modalRef}
        heading={mode === "collections" ? t("campaigns.addCollections") : t("campaigns.addProducts")}
      >
        <div className={styles.modalSearchWrap}>
          <SearchIcon />
          <input
            type="text"
            className={styles.modalSearchInput}
            placeholder={mode === "collections" ? t("campaigns.searchCollections") : t("campaigns.searchProducts")}
            value={modalQuery}
            onChange={(e) => handleModalSearch(e.target.value)}
          />
        </div>

        {isSearching && <div className={styles.modalLoading}>{t("common:status.loading")}</div>}

        {mode === "collections" && collectionResults.length > 0 && !isSearching && (
          <div className={styles.searchResults}>
            {collectionResults.map((c) => {
              const isSelected = stagedIds.has(c.id);
              return (
                <div key={c.id} className={`${styles.searchResultItem} ${isSelected ? styles.searchResultSelected : ""}`} onClick={() => handleToggleCollection(c)}>
                  <input type="checkbox" checked={isSelected} readOnly className={styles.resultCheckbox} />
                  {c.image ? <img src={c.image} alt="" className={styles.productThumb} /> : <div className={styles.productThumbPlaceholder} />}
                  <div className={styles.productInfo}>
                    <div className={styles.productTitle}>{c.title}</div>
                    <div className={styles.productVariants}>{c.productCount} {t("campaigns.products")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {mode === "products" && productResults.length > 0 && !isSearching && (
          <div className={styles.searchResults}>
            {productResults.map((p) => {
              const isSelected = stagedIds.has(p.id);
              return (
                <div key={p.id} className={`${styles.searchResultItem} ${isSelected ? styles.searchResultSelected : ""}`} onClick={() => handleToggleProduct(p)}>
                  <input type="checkbox" checked={isSelected} readOnly className={styles.resultCheckbox} />
                  {p.image ? <img src={p.image} alt="" className={styles.productThumb} /> : <div className={styles.productThumbPlaceholder} />}
                  <div className={styles.productInfo}>
                    <div className={styles.productTitle}>{p.title}</div>
                    <div className={styles.productVariants}>
                      {p.compareAtPrice && <span style={{ textDecoration: "line-through", marginRight: 6 }}>{p.compareAtPrice}</span>}
                      {p.price && <span>{p.price}</span>}
                      {" · "}{p.variantCount} {p.variantCount === 1 ? "variant" : "variants"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div slot="footer" className={styles.modalFooter}>
          <span className={styles.modalCount}>
            {stagedCount}/100 {mode === "collections" ? t("campaigns.collectionsSelected") : t("campaigns.productsSelected")}
          </span>
          <div className={styles.modalActions}>
            <s-button variant="secondary" onClick={() => modalRef.current?.hideOverlay?.()}>{t("common:button.cancel")}</s-button>
            <s-button variant="primary" onClick={handleConfirmModal}>{t("campaigns.add")}</s-button>
          </div>
        </div>
      </s-modal>
    </>
  );
}
