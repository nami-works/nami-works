import { useState, useCallback, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchProductTypes,
  searchProducts,
  activateCampaign,
  deactivateCampaign,
} from "../services/bulk-price/campaign.server";
import styles from "./app.merchandising/styles.module.css";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const { id } = params;
  const isNew = id === "new";

  const productTypes = await fetchProductTypes(admin);

  if (isNew) {
    return {
      isNew: true,
      campaign: null,
      productTypes,
    };
  }

  const campaign = await prisma.bulkPriceCampaign.findFirst({
    where: { id, shop },
  });

  if (!campaign) {
    throw new Response("Not found", { status: 404 });
  }

  return { isNew: false, campaign, productTypes };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action") as string;

  // --- Search products (AJAX) ---
  if (intent === "searchProducts") {
    const query = formData.get("query") as string;
    const results = await searchProducts(admin, query || "");
    return { intent: "searchProducts", products: results };
  }

  // --- Save ---
  if (intent === "save") {
    const name = formData.get("name") as string;
    const discountType = formData.get("discountType") as string;
    const discountValue = parseFloat(formData.get("discountValue") as string);
    const filterType = formData.get("filterType") as string;
    const filterValues = formData.get("filterValues") as string;
    const excludeEnabled = formData.get("excludeEnabled") === "true";
    const excludeValues = formData.get("excludeValues") as string;
    const startAt = new Date(formData.get("startAt") as string);
    const endAtRaw = formData.get("endAt") as string;
    const endAt = endAtRaw ? new Date(endAtRaw) : null;

    const status = startAt > new Date() ? "scheduled" : "draft";

    const data = {
      shop,
      name,
      status,
      discountType,
      discountValue,
      filterType,
      filterValues,
      excludeEnabled,
      excludeType: "tags",
      excludeValues: excludeValues || "[]",
      startAt,
      endAt,
    };

    if (params.id === "new") {
      const created = await prisma.bulkPriceCampaign.create({ data });
      console.info(`[bulk-price] campaign created id=${created.id} shop=${shop} name=${name}`);
      return redirect(`/app/merchandising/campaigns/${created.id}`);
    }

    await prisma.bulkPriceCampaign.update({
      where: { id: params.id },
      data,
    });
    console.info(`[bulk-price] campaign updated id=${params.id} shop=${shop}`);
    return { intent: "save", ok: true };
  }

  // --- Activate ---
  if (intent === "activate") {
    const result = await activateCampaign(admin, prisma, params.id!);
    return { intent: "activate", ...result };
  }

  // --- Deactivate ---
  if (intent === "deactivate") {
    const result = await deactivateCampaign(admin, prisma, params.id!);
    return { intent: "deactivate", ...result };
  }

  // --- Duplicate ---
  if (intent === "duplicate") {
    const source = await prisma.bulkPriceCampaign.findUniqueOrThrow({
      where: { id: params.id },
    });
    const copy = await prisma.bulkPriceCampaign.create({
      data: {
        shop,
        name: `${source.name} (Copy)`,
        status: "draft",
        discountType: source.discountType,
        discountValue: source.discountValue,
        filterType: source.filterType,
        filterValues: source.filterValues,
        excludeEnabled: source.excludeEnabled,
        excludeType: source.excludeType,
        excludeValues: source.excludeValues,
        startAt: new Date(),
        endAt: null,
      },
    });
    console.info(`[bulk-price] campaign duplicated from=${params.id} to=${copy.id} shop=${shop}`);
    return redirect(`/app/merchandising/campaigns/${copy.id}`);
  }

  // --- Delete ---
  if (intent === "delete") {
    await prisma.bulkPriceCampaign.delete({ where: { id: params.id } });
    console.info(`[bulk-price] campaign deleted id=${params.id} shop=${shop}`);
    return redirect("/app/merchandising/campaigns");
  }

  return { ok: false };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CampaignDetail() {
  const { isNew, campaign, productTypes } = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const searchFetcher = useFetcher<typeof action>();

  // Form state
  const [name, setName] = useState(campaign?.name ?? "");
  const [discountType, setDiscountType] = useState(campaign?.discountType ?? "percentage");
  const [discountValue, setDiscountValue] = useState(campaign?.discountValue?.toString() ?? "15");
  const [filterType, setFilterType] = useState(campaign?.filterType ?? "product_types");
  const [selectedTypes, setSelectedTypes] = useState<string[]>(
    campaign?.filterValues ? JSON.parse(campaign.filterValues) : [],
  );
  const [selectedProducts, setSelectedProducts] = useState<
    Array<{ id: string; title: string; image: string | null }>
  >([]);
  const [excludeEnabled, setExcludeEnabled] = useState(campaign?.excludeEnabled ?? false);
  const [excludeTags, setExcludeTags] = useState<string[]>(
    campaign?.excludeValues ? JSON.parse(campaign.excludeValues) : [],
  );
  const [startAt, setStartAt] = useState(
    campaign?.startAt
      ? new Date(campaign.startAt).toISOString().slice(0, 16)
      : "",
  );
  const [hasEndDate, setHasEndDate] = useState(!!campaign?.endAt);
  const [endAt, setEndAt] = useState(
    campaign?.endAt
      ? new Date(campaign.endAt).toISOString().slice(0, 16)
      : "",
  );

  // Type search
  const [typeSearch, setTypeSearch] = useState("");
  const filteredTypes = productTypes.filter(
    (pt) =>
      pt.toLowerCase().includes(typeSearch.toLowerCase()) &&
      !selectedTypes.includes(pt),
  );

  // Product search modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalQuery, setModalQuery] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleModalSearch = useCallback(
    (query: string) => {
      setModalQuery(query);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        if (query.length >= 2) {
          searchFetcher.submit(
            { _action: "searchProducts", query },
            { method: "POST" },
          );
        }
      }, 250);
    },
    [searchFetcher],
  );

  const searchResults =
    (searchFetcher.data as { intent?: string; products?: Array<{ id: string; title: string; image: string | null }> })?.intent ===
    "searchProducts"
      ? (searchFetcher.data as { products: Array<{ id: string; title: string; image: string | null }> }).products
      : [];

  // Tag input
  const [tagInput, setTagInput] = useState("");

  // Status
  const status = campaign?.status ?? "draft";
  const isActive = status === "active";
  const isSubmitting = fetcher.state !== "idle";

  // Preview computation
  const discVal = parseFloat(discountValue) || 0;
  const samplePrice = 100;
  const previewPrice =
    discountType === "percentage"
      ? samplePrice * (1 - discVal / 100)
      : Math.max(0, samplePrice - discVal);

  // --- Save handler ---
  const handleSave = () => {
    const filterValues =
      filterType === "product_types"
        ? JSON.stringify(selectedTypes)
        : JSON.stringify(selectedProducts.map((p) => p.id));

    fetcher.submit(
      {
        _action: "save",
        name,
        discountType,
        discountValue,
        filterType,
        filterValues,
        excludeEnabled: String(excludeEnabled),
        excludeValues: JSON.stringify(excludeTags),
        startAt,
        endAt: hasEndDate ? endAt : "",
      },
      { method: "POST" },
    );
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <s-button variant="tertiary" onClick={() => navigate("/app/merchandising/campaigns")}>
            ← Back
          </s-button>
          <h2 className={styles.modalTitle}>
            {isNew ? t("campaigns.createCampaign") : name}
          </h2>
          {!isNew && (
            <span className={`${styles.statusBadge} ${
              status === "active" ? styles.statusActive
              : status === "scheduled" ? styles.statusScheduled
              : status === "expired" ? styles.statusOther
              : styles.statusDraft
            }`}>
              {t(`campaigns.status${status.charAt(0).toUpperCase() + status.slice(1)}`)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {!isNew && status !== "active" && (
            <fetcher.Form method="POST">
              <input type="hidden" name="_action" value="duplicate" />
              <s-button variant="secondary">{t("campaigns.duplicate")}</s-button>
            </fetcher.Form>
          )}
          {(status === "expired" || status === "scheduled" || status === "draft") && !isNew && (
            <fetcher.Form method="POST">
              <input type="hidden" name="_action" value="activate" />
              <s-button variant="primary">
                {isSubmitting ? t("campaigns.activating") : t("campaigns.activate")}
              </s-button>
            </fetcher.Form>
          )}
          {status === "active" && (
            <fetcher.Form method="POST">
              <input type="hidden" name="_action" value="deactivate" />
              <s-button variant="primary" tone="critical">
                {isSubmitting ? t("campaigns.deactivating") : t("campaigns.deactivate")}
              </s-button>
            </fetcher.Form>
          )}
        </div>
      </div>

      <div className={styles.campaignLayout}>
        {/* --- Main form --- */}
        <div className={styles.campaignMain}>

          {/* Campaign name */}
          <div className={styles.formSection}>
            <label className={styles.formSectionTitle}>{t("campaigns.name")}</label>
            <s-text-field
              label=""
              value={name}
              onChange={(e: Event) =>
                setName((e.target as HTMLInputElement).value)
              }
              disabled={isActive}
            />
            <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>
              {t("campaigns.nameHelper")}
            </div>
          </div>

          {/* Discount */}
          <div className={styles.formSection}>
            <div className={styles.formSectionTitle}>{t("campaigns.discount")}</div>
            <div className={styles.formRow}>
              <s-select
                label=""
                value={discountType}
                onChange={(e: Event) =>
                  setDiscountType((e.currentTarget as HTMLSelectElement).value)
                }
                disabled={isActive}
              >
                <s-option value="percentage">{t("campaigns.percentage")}</s-option>
                <s-option value="fixed">{t("campaigns.fixedAmount")}</s-option>
              </s-select>
              <s-text-field
                label=""
                value={discountValue}
                onChange={(e: Event) =>
                  setDiscountValue((e.target as HTMLInputElement).value)
                }
                suffix={discountType === "percentage" ? "%" : "R$"}
                disabled={isActive}
              />
            </div>
          </div>

          {/* Products */}
          <div className={styles.formSection}>
            <div className={styles.formSectionTitle}>{t("campaigns.products")}</div>
            <s-select
              label=""
              value={filterType}
              onChange={(e: Event) =>
                setFilterType((e.currentTarget as HTMLSelectElement).value)
              }
              disabled={isActive}
            >
              <s-option value="product_types">{t("campaigns.productTypes")}</s-option>
              <s-option value="products">{t("campaigns.specificProducts")}</s-option>
            </s-select>

            {filterType === "product_types" && (
              <>
                <div className={styles.searchRow} style={{ marginTop: "12px" }}>
                  <div className={styles.searchInputWrap}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" style={{ color: "#8c9196", flexShrink: 0 }}>
                      <path fill="currentColor" d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293-4.82-4.82A5.968 5.968 0 0 0 14 8 6 6 0 0 0 2 8a6 6 0 0 0 6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z" />
                    </svg>
                    <input
                      className={styles.searchInput}
                      type="text"
                      placeholder={t("campaigns.searchProductTypes")}
                      value={typeSearch}
                      onChange={(e) => setTypeSearch(e.target.value)}
                      disabled={isActive}
                    />
                  </div>
                </div>
                {typeSearch && filteredTypes.length > 0 && !isActive && (
                  <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", maxHeight: "200px", overflowY: "auto", marginTop: "4px" }}>
                    {filteredTypes.slice(0, 10).map((pt) => (
                      <div
                        key={pt}
                        className={styles.searchResultItem}
                        onClick={() => {
                          setSelectedTypes((prev) => [...prev, pt]);
                          setTypeSearch("");
                        }}
                      >
                        {pt}
                      </div>
                    ))}
                  </div>
                )}
                {selectedTypes.length > 0 && (
                  <div className={styles.badgeList}>
                    {selectedTypes.map((pt) => (
                      <span key={pt} className={styles.badge}>
                        {pt}
                        {!isActive && (
                          <span
                            className={styles.badgeRemove}
                            onClick={() =>
                              setSelectedTypes((prev) =>
                                prev.filter((t2) => t2 !== pt),
                              )
                            }
                          >
                            ×
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            {filterType === "products" && (
              <>
                <div className={styles.searchRow} style={{ marginTop: "12px" }}>
                  <div className={styles.searchInputWrap}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" style={{ color: "#8c9196", flexShrink: 0 }}>
                      <path fill="currentColor" d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293-4.82-4.82A5.968 5.968 0 0 0 14 8 6 6 0 0 0 2 8a6 6 0 0 0 6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z" />
                    </svg>
                    <input
                      className={styles.searchInput}
                      type="text"
                      placeholder={t("campaigns.searchProducts")}
                      value={modalQuery}
                      onChange={(e) => handleModalSearch(e.target.value)}
                      disabled={isActive}
                    />
                  </div>
                  <s-button
                    variant="secondary"
                    onClick={() => setModalOpen(true)}
                    disabled={isActive}
                  >
                    {t("campaigns.browse")}
                  </s-button>
                </div>
                {selectedProducts.length > 0 && (
                  <div style={{ marginTop: "12px" }}>
                    {selectedProducts.map((p) => (
                      <div key={p.id} className={styles.searchResultItem}>
                        {p.image ? (
                          <img src={p.image} alt="" className={styles.productThumb} />
                        ) : (
                          <div className={styles.productThumbPlaceholder}>🖼</div>
                        )}
                        <div className={styles.productInfo}>
                          <div className={styles.productTitle}>{p.title}</div>
                        </div>
                        {!isActive && (
                          <span
                            className={styles.badgeRemove}
                            onClick={() =>
                              setSelectedProducts((prev) =>
                                prev.filter((sp) => sp.id !== p.id),
                              )
                            }
                          >
                            ×
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {modalOpen && (
                  <s-modal
                    id="product-browse-modal"
                    heading={t("campaigns.searchProducts")}
                    ref={(el: HTMLElement | null) => { if (el) el.setAttribute("open", ""); }}
                  >
                    <div className={styles.modalSearchWrap}>
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" style={{ color: "#8c9196" }}>
                        <path fill="currentColor" d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293-4.82-4.82A5.968 5.968 0 0 0 14 8 6 6 0 0 0 2 8a6 6 0 0 0 6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z" />
                      </svg>
                      <input
                        className={styles.modalSearchInput}
                        type="text"
                        placeholder={t("campaigns.searchProducts")}
                        value={modalQuery}
                        onChange={(e) => handleModalSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    {searchResults.map((p) => {
                      const isSelected = selectedProducts.some((sp) => sp.id === p.id);
                      return (
                        <div
                          key={p.id}
                          className={`${styles.searchResultItem} ${isSelected ? styles.searchResultSelected : ""}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedProducts((prev) =>
                                prev.filter((sp) => sp.id !== p.id),
                              );
                            } else {
                              setSelectedProducts((prev) => [
                                ...prev,
                                { id: p.id, title: p.title, image: p.image },
                              ]);
                            }
                          }}
                        >
                          <input type="checkbox" checked={isSelected} readOnly />
                          {p.image ? (
                            <img src={p.image} alt="" className={styles.productThumb} />
                          ) : (
                            <div className={styles.productThumbPlaceholder}>🖼</div>
                          )}
                          <div className={styles.productInfo}>
                            <div className={styles.productTitle}>{p.title}</div>
                          </div>
                        </div>
                      );
                    })}
                    <div slot="footer" className={styles.modalFooter}>
                      <span className={styles.modalCount}>
                        {selectedProducts.length} selected
                      </span>
                      <div className={styles.modalActions}>
                        <s-button
                          variant="secondary"
                          onClick={() => document.getElementById("product-browse-modal")?.removeAttribute("open")}
                        >
                          Done
                        </s-button>
                      </div>
                    </div>
                  </s-modal>
                )}
              </>
            )}
          </div>

          {/* Excludes */}
          <div className={styles.formSection}>
            <div className={styles.formSectionTitle}>{t("campaigns.excludes")}</div>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={excludeEnabled}
                onChange={(e) => setExcludeEnabled(e.target.checked)}
                disabled={isActive}
              />
              {t("campaigns.enableExcludes")}
            </label>
            {excludeEnabled && (
              <>
                <div className={styles.searchRow} style={{ marginTop: "12px" }}>
                  <div className={styles.searchInputWrap}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" style={{ color: "#8c9196", flexShrink: 0 }}>
                      <path fill="currentColor" d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293-4.82-4.82A5.968 5.968 0 0 0 14 8 6 6 0 0 0 2 8a6 6 0 0 0 6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z" />
                    </svg>
                    <input
                      className={styles.searchInput}
                      type="text"
                      placeholder={t("campaigns.searchProductTags")}
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && tagInput.trim()) {
                          e.preventDefault();
                          if (!excludeTags.includes(tagInput.trim())) {
                            setExcludeTags((prev) => [...prev, tagInput.trim()]);
                          }
                          setTagInput("");
                        }
                      }}
                      disabled={isActive}
                    />
                  </div>
                </div>
                {excludeTags.length > 0 && (
                  <div className={styles.badgeList}>
                    {excludeTags.map((tag) => (
                      <span key={tag} className={styles.badge} style={{ background: "#fde8e8" }}>
                        {tag}
                        {!isActive && (
                          <span
                            className={styles.badgeRemove}
                            onClick={() =>
                              setExcludeTags((prev) =>
                                prev.filter((t2) => t2 !== tag),
                              )
                            }
                          >
                            ×
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Schedule */}
          <div className={styles.formSection}>
            <div className={styles.formSectionTitle}>{t("campaigns.schedule")}</div>
            <div className={styles.formRow}>
              <div>
                <label style={{ fontSize: "13px", color: "#6d7175", display: "block", marginBottom: "4px" }}>
                  {t("campaigns.startDate")}
                </label>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  disabled={isActive}
                  style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #8c9196", fontSize: "13px" }}
                />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasEndDate}
                onChange={(e) => setHasEndDate(e.target.checked)}
                disabled={isActive}
              />
              {t("campaigns.setEndDate")}
            </label>
            {hasEndDate && (
              <div className={styles.formRow} style={{ marginTop: "12px" }}>
                <div>
                  <label style={{ fontSize: "13px", color: "#6d7175", display: "block", marginBottom: "4px" }}>
                    {t("campaigns.endDate")}
                  </label>
                  <input
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    disabled={isActive}
                    style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #8c9196", fontSize: "13px" }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Save button */}
          {!isActive && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {!isNew && (status === "draft" || status === "cancelled") && (
                <fetcher.Form method="POST">
                  <input type="hidden" name="_action" value="delete" />
                  <s-button variant="secondary" tone="critical">
                    {t("campaigns.delete")}
                  </s-button>
                </fetcher.Form>
              )}
              {!isNew && status !== "draft" && status !== "cancelled" && <div />}
              {isNew && <div />}
              <s-button
                variant="primary"
                onClick={handleSave}
                disabled={!name || !startAt || discVal <= 0}
                loading={isSubmitting}
              >
                {isSubmitting ? t("campaigns.saving") : t("campaigns.save")}
              </s-button>
            </div>
          )}
        </div>

        {/* --- Aside --- */}
        <div className={styles.campaignAside}>

          {/* Discount preview */}
          <div className={styles.formSection}>
            <h3 className={styles.modalTitle}>{t("campaigns.preview")}</h3>

            <div className={styles.previewCard} style={{ marginTop: "12px" }}>
              <div className={styles.previewSection}>
                <div className={styles.previewSectionTitle}>{t("campaigns.onProductPage")}</div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "8px" }}>
                  {t("campaigns.withoutCompareAt")}
                </div>
                <div className={styles.previewRow}>
                  <span className={styles.previewLabel}>{t("campaigns.before")}</span>
                  <span className={styles.previewPrice}>R${samplePrice.toFixed(2)}</span>
                </div>
                <div className={styles.previewRow}>
                  <span className={styles.previewLabel}>{t("campaigns.after")}</span>
                  <span>
                    <span className={styles.previewPrice}>R${previewPrice.toFixed(2)}</span>
                    <span className={styles.previewPriceStrike}>R${samplePrice.toFixed(2)}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className={styles.formSection}>
            <h3 className={styles.modalTitle}>{t("campaigns.summary")}</h3>
            <div style={{ marginTop: "12px", fontSize: "13px" }}>
              <p style={{ color: "#6d7175", marginBottom: "4px" }}>{name || "---"}</p>
              <p style={{ fontWeight: 600, marginBottom: "8px" }}>{t("campaigns.campaignType")}</p>
              <ul style={{ margin: "0 0 12px 16px", padding: 0, color: "#6d7175", fontSize: "13px" }}>
                <li>{t("campaigns.priceRuleAndClearance")}</li>
                <li>{discVal}{discountType === "percentage" ? "%" : " R$"} {t("campaigns.off")}</li>
              </ul>
              <p style={{ fontWeight: 600, marginBottom: "8px" }}>{t("campaigns.details")}</p>
              <ul style={{ margin: "0 0 0 16px", padding: 0, color: "#6d7175", fontSize: "13px" }}>
                {filterType === "product_types" && selectedTypes.length > 0 && (
                  <li>{t("campaigns.appliesToProductTypes")}</li>
                )}
                {filterType === "products" && selectedProducts.length > 0 && (
                  <li>{t("campaigns.appliesToProducts")}</li>
                )}
                {excludeEnabled && excludeTags.length > 0 && (
                  <li>{t("campaigns.excludesProductTags")}</li>
                )}
                {startAt && <li>Start: {new Date(startAt).toLocaleString()}</li>}
                {hasEndDate && endAt && <li>End: {new Date(endAt).toLocaleString()}</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
