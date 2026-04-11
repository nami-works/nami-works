import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchProductTypes,
  searchProducts,
  searchCollections,
  activateCampaign,
  deactivateCampaign,
  getProductsByIds,
  getCollectionsByIds,
  previewCampaignScope,
} from "../services/bulk-price/campaign.server";
import { fetchMetaobjectTypes, fetchMetaobjectDefinitionFields } from "../services/price-tags/metaobject.server";
import { findProductMetafieldForMetaobjectType } from "../services/price-tags/metafield.server";
import { computeSmartBadge } from "../services/price-tags/smart-badge";
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
  const metaobjectTypes = await fetchMetaobjectTypes(admin).catch(() => []);

  // Load price tag defaults from last-used config
  const priceTagDefaults = await prisma.priceTagConfig.findUnique({ where: { shop } });

  if (isNew) {
    return {
      isNew: true,
      campaign: null,
      productTypes,
      metaobjectTypes,
      priceTagDefaults,
      fieldDefinitions: null as Awaited<ReturnType<typeof fetchMetaobjectDefinitionFields>> | null,
      initialSelectedProducts: [] as Array<{ id: string; title: string; image: string | null }>,
      initialSelectedCollections: [] as Array<{ id: string; title: string; image: string | null; productCount: number }>,
      isStuckActivation: false,
    };
  }

  const campaign = await prisma.bulkPriceCampaign.findFirst({
    where: { id, shop },
  });

  if (!campaign) {
    throw new Response("Not found", { status: 404 });
  }

  // If campaign has price tags enabled, load field definitions
  let fieldDefinitions: Awaited<ReturnType<typeof fetchMetaobjectDefinitionFields>> | null = null;
  if (campaign.priceTagsEnabled && campaign.priceTagMetaobjectType) {
    fieldDefinitions = await fetchMetaobjectDefinitionFields(admin, campaign.priceTagMetaobjectType).catch(() => null);
  }

  // Hydrate selected products / collections from persisted GIDs so the
  // editor form reflects the saved filter (C1: prevents Save-wipes-filter).
  let initialSelectedProducts: Array<{ id: string; title: string; image: string | null }> = [];
  let initialSelectedCollections: Array<{ id: string; title: string; image: string | null; productCount: number }> = [];
  try {
    const storedIds: string[] = campaign.filterValues ? JSON.parse(campaign.filterValues) : [];
    if (campaign.filterType === "products" && storedIds.length > 0) {
      initialSelectedProducts = await getProductsByIds(admin, storedIds);
    } else if (campaign.filterType === "collections" && storedIds.length > 0) {
      initialSelectedCollections = await getCollectionsByIds(admin, storedIds);
    }
  } catch (err) {
    console.warn(`[bulk-price] hydrate filter values FAILED campaign=${id} shop=${shop}`, err);
  }

  // Stuck-campaign detection (W1): a draft campaign with leftover
  // BulkPriceCampaignItem rows means the previous activation crashed
  // between item insertion and the status flip.
  let isStuckActivation = false;
  if (campaign.status === "draft") {
    const orphanCount = await prisma.bulkPriceCampaignItem.count({ where: { campaignId: campaign.id } });
    isStuckActivation = orphanCount > 0;
  }

  return {
    isNew: false,
    campaign,
    productTypes,
    metaobjectTypes,
    priceTagDefaults,
    fieldDefinitions,
    initialSelectedProducts,
    initialSelectedCollections,
    isStuckActivation,
  };
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

  // --- Search collections (AJAX) ---
  if (intent === "searchCollections") {
    const query = formData.get("query") as string;
    const results = await searchCollections(admin, query || "");
    return { intent: "searchCollections", collections: results };
  }

  // --- Fetch metaobject field definitions (AJAX) ---
  if (intent === "fetchFieldDefs") {
    const metaobjectType = formData.get("metaobjectType") as string;
    try {
      const defs = await fetchMetaobjectDefinitionFields(admin, metaobjectType);
      const mfDef = await findProductMetafieldForMetaobjectType(admin, metaobjectType);
      return { intent: "fetchFieldDefs", ...defs, metafieldNamespace: mfDef?.namespace ?? "", metafieldKey: mfDef?.key ?? "" };
    } catch {
      return { intent: "fetchFieldDefs", fields: [], displayNameKey: "", metafieldNamespace: "", metafieldKey: "" };
    }
  }

  // --- Save field defaults (price tag config) ---
  if (intent === "saveFieldDefaults") {
    console.info(`[bulk-price] saveFieldDefaults START shop=${shop}`);
    const metaobjectType = formData.get("metaobjectType") as string;
    const displayNameKey = formData.get("displayNameKey") as string;
    const fieldDefaultsJson = formData.get("fieldDefaults") as string;

    const mfDef = await findProductMetafieldForMetaobjectType(admin, metaobjectType);
    const metafieldNamespace = mfDef?.namespace ?? "";
    const metafieldKey = mfDef?.key ?? "";

    await prisma.priceTagConfig.upsert({
      where: { shop },
      create: { shop, metaobjectType, metafieldNamespace, metafieldKey, displayNameKey, metaobjectFieldDefaults: fieldDefaultsJson },
      update: { metaobjectType, metafieldNamespace, metafieldKey, displayNameKey, metaobjectFieldDefaults: fieldDefaultsJson },
    });

    return { ok: true, intent: "saveFieldDefaults", detectedMetafield: mfDef ? `${metafieldNamespace}.${metafieldKey}` : null };
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

    // Preserve `active` status when saving an already-running campaign.
    // For everything else, derive status from the start date.
    const existing =
      params.id && params.id !== "new"
        ? await prisma.bulkPriceCampaign.findUnique({ where: { id: params.id } })
        : null;
    const status =
      existing?.status === "active"
        ? "active"
        : startAt > new Date()
          ? "scheduled"
          : "draft";

    const priceTagsEnabled = formData.get("priceTagsEnabled") === "true";
    const priceTagMetaobjectType = (formData.get("priceTagMetaobjectType") as string) || null;
    const priceTagDisplayNameKey = (formData.get("priceTagDisplayNameKey") as string) || null;
    const priceTagFieldDefaults = (formData.get("priceTagFieldDefaults") as string) || null;
    const priceTagMetafieldNamespace = (formData.get("priceTagMetafieldNamespace") as string) || null;
    const priceTagMetafieldKey = (formData.get("priceTagMetafieldKey") as string) || null;

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
      priceTagsEnabled,
      priceTagMetaobjectType,
      priceTagDisplayNameKey,
      priceTagFieldDefaults,
      priceTagMetafieldNamespace,
      priceTagMetafieldKey,
    };

    // Persist price tag config as "last used" defaults
    if (priceTagsEnabled && priceTagMetaobjectType) {
      await prisma.priceTagConfig.upsert({
        where: { shop },
        update: {
          metaobjectType: priceTagMetaobjectType,
          displayNameKey: priceTagDisplayNameKey ?? "",
          metaobjectFieldDefaults: priceTagFieldDefaults ?? "{}",
          metafieldNamespace: priceTagMetafieldNamespace ?? "",
          metafieldKey: priceTagMetafieldKey ?? "",
        },
        create: {
          shop,
          metaobjectType: priceTagMetaobjectType,
          displayNameKey: priceTagDisplayNameKey ?? "",
          metaobjectFieldDefaults: priceTagFieldDefaults ?? "{}",
          metafieldNamespace: priceTagMetafieldNamespace ?? "",
          metafieldKey: priceTagMetafieldKey ?? "",
        },
      });
    }

    if (params.id === "new") {
      const created = await prisma.bulkPriceCampaign.create({ data });
      console.info(`[bulk-price] campaign created id=${created.id} shop=${shop} name=${name}`);
      return redirect(`/app/merchandising/sale/${created.id}`);
    }

    await prisma.bulkPriceCampaign.update({
      where: { id: params.id },
      data,
    });
    console.info(`[bulk-price] campaign updated id=${params.id} shop=${shop}`);
    return { intent: "save", ok: true };
  }

  // --- Preview scope (dry-run of resolveProducts) ---
  if (intent === "previewScope") {
    const filterType = formData.get("filterType") as string;
    const filterValues = JSON.parse((formData.get("filterValues") as string) || "[]");
    const excludeEnabled = formData.get("excludeEnabled") === "true";
    const excludeValues = JSON.parse((formData.get("excludeValues") as string) || "[]");
    try {
      const result = await previewCampaignScope(admin, {
        filterType,
        filterValues,
        excludeEnabled,
        excludeValues,
      });
      return { intent: "previewScope", ok: true, ...result };
    } catch (err) {
      console.error(`[bulk-price] previewScope FAILED shop=${shop}`, err);
      return {
        intent: "previewScope",
        ok: false,
        productCount: 0,
        variantCount: 0,
        sampleTitles: [] as string[],
        error: String(err),
      };
    }
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
        priceTagsEnabled: source.priceTagsEnabled,
        priceTagMetaobjectType: source.priceTagMetaobjectType,
        priceTagDisplayNameKey: source.priceTagDisplayNameKey,
        priceTagFieldDefaults: source.priceTagFieldDefaults,
        priceTagMetafieldNamespace: source.priceTagMetafieldNamespace,
        priceTagMetafieldKey: source.priceTagMetafieldKey,
      },
    });
    console.info(`[bulk-price] campaign duplicated from=${params.id} to=${copy.id} shop=${shop}`);
    return redirect(`/app/merchandising/sale/${copy.id}`);
  }

  // --- Delete ---
  if (intent === "delete") {
    await prisma.bulkPriceCampaign.delete({ where: { id: params.id } });
    console.info(`[bulk-price] campaign deleted id=${params.id} shop=${shop}`);
    return redirect("/app/merchandising/sale");
  }

  return { ok: false };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CampaignDetail() {
  const {
    isNew,
    campaign,
    productTypes,
    metaobjectTypes,
    priceTagDefaults,
    fieldDefinitions,
    initialSelectedProducts,
    initialSelectedCollections,
    isStuckActivation,
  } = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const navigate = useNavigate();
  // Per-intent fetchers so spinners/labels never overlap.
  const saveFetcher = useFetcher<typeof action>();
  const activateFetcher = useFetcher<typeof action>();
  const deactivateFetcher = useFetcher<typeof action>();
  const duplicateFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const searchFetcher = useFetcher<typeof action>();
  const collectionSearchFetcher = useFetcher<typeof action>();
  const fieldDefsFetcher = useFetcher<typeof action>();
  const saveConfigFetcher = useFetcher<typeof action>();
  const previewScopeFetcher = useFetcher<typeof action>();

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
  >(initialSelectedProducts ?? []);
  const [selectedCollections, setSelectedCollections] = useState<
    Array<{ id: string; title: string; image: string | null; productCount: number }>
  >(initialSelectedCollections ?? []);
  const [excludeEnabled, setExcludeEnabled] = useState(campaign?.excludeEnabled ?? false);
  const [excludeTags, setExcludeTags] = useState<string[]>(
    campaign?.excludeValues ? JSON.parse(campaign.excludeValues) : [],
  );
  const [startDate, setStartDate] = useState(() => {
    if (!campaign?.startAt) return "";
    return new Date(campaign.startAt).toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState(() => {
    if (!campaign?.startAt) return "";
    return new Date(campaign.startAt).toTimeString().slice(0, 5);
  });
  const [hasEndDate, setHasEndDate] = useState(!!campaign?.endAt);
  const [endDate, setEndDate] = useState(() => {
    if (!campaign?.endAt) return "";
    return new Date(campaign.endAt).toISOString().slice(0, 10);
  });
  const [endTime, setEndTime] = useState(() => {
    if (!campaign?.endAt) return "";
    return new Date(campaign.endAt).toTimeString().slice(0, 5);
  });

  // Price tags state
  const [priceTagsEnabled, setPriceTagsEnabled] = useState(campaign?.priceTagsEnabled ?? false);
  const [ptMetaobjectType, setPtMetaobjectType] = useState(
    campaign?.priceTagMetaobjectType ?? priceTagDefaults?.metaobjectType ?? "",
  );
  const [ptDisplayNameKey, setPtDisplayNameKey] = useState(
    campaign?.priceTagDisplayNameKey ?? priceTagDefaults?.displayNameKey ?? "",
  );
  const [ptFieldDefaults, setPtFieldDefaults] = useState<Record<string, string>>(
    JSON.parse(campaign?.priceTagFieldDefaults ?? priceTagDefaults?.metaobjectFieldDefaults ?? "{}"),
  );
  const [ptFieldDefs, setPtFieldDefs] = useState(fieldDefinitions?.fields ?? []);
  const [ptMetafieldNs, setPtMetafieldNs] = useState(
    campaign?.priceTagMetafieldNamespace ?? priceTagDefaults?.metafieldNamespace ?? "",
  );
  const [ptMetafieldKey, setPtMetafieldKey] = useState(
    campaign?.priceTagMetafieldKey ?? priceTagDefaults?.metafieldKey ?? "",
  );

  // Aside state for price tag config
  const [ptAsideCollapsed, setPtAsideCollapsed] = useState(true);
  const [ptAsideSaved, setPtAsideSaved] = useState(false);

  // Delete confirmation modal (W4)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Result banner (C4) — surfaces save/activate/deactivate/duplicate outcomes.
  const [banner, setBanner] = useState<
    { tone: "success" | "critical" | "warning" | "info"; message: string } | null
  >(null);

  useEffect(() => {
    const data = saveConfigFetcher.data as any;
    if (data?.intent === "saveFieldDefaults" && data.ok) {
      setPtAsideSaved(true);
      const timer = setTimeout(() => setPtAsideSaved(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveConfigFetcher.data]);

  // Surface save outcome.
  useEffect(() => {
    const data = saveFetcher.data as any;
    if (!data || saveFetcher.state !== "idle") return;
    if (data.intent === "save" && data.ok) {
      setBanner({ tone: "success", message: t("campaigns.saveSuccess") });
    }
  }, [saveFetcher.data, saveFetcher.state, t]);

  // Surface activate outcome.
  useEffect(() => {
    const data = activateFetcher.data as any;
    if (!data || activateFetcher.state !== "idle") return;
    if (data.intent !== "activate") return;
    const errs: string[] = Array.isArray(data.errors) ? data.errors : [];
    if (data.ok && errs.length === 0) {
      setBanner({
        tone: "success",
        message: t("campaigns.activateSuccess", {
          products: data.productCount ?? 0,
          variants: data.variantCount ?? 0,
        }),
      });
    } else if (data.ok && errs.length > 0) {
      setBanner({
        tone: "warning",
        message: t("campaigns.activatePartial", {
          products: data.productCount ?? 0,
          variants: data.variantCount ?? 0,
          errors: errs.join("; "),
        }),
      });
    } else {
      setBanner({
        tone: "critical",
        message: t("campaigns.activateFailed", {
          errors: errs.length > 0 ? errs.join("; ") : t("campaigns.unknownError"),
        }),
      });
    }
  }, [activateFetcher.data, activateFetcher.state, t]);

  // Surface deactivate outcome.
  useEffect(() => {
    const data = deactivateFetcher.data as any;
    if (!data || deactivateFetcher.state !== "idle") return;
    if (data.intent !== "deactivate") return;
    const errs: string[] = Array.isArray(data.errors) ? data.errors : [];
    if (data.ok && errs.length === 0) {
      setBanner({
        tone: "success",
        message: t("campaigns.deactivateSuccess", { reverted: data.reverted ?? 0 }),
      });
    } else if (data.ok && errs.length > 0) {
      setBanner({
        tone: "warning",
        message: t("campaigns.deactivatePartial", {
          reverted: data.reverted ?? 0,
          errors: errs.join("; "),
        }),
      });
    } else {
      setBanner({
        tone: "critical",
        message: t("campaigns.deactivateFailed", {
          errors: errs.length > 0 ? errs.join("; ") : t("campaigns.unknownError"),
        }),
      });
    }
  }, [deactivateFetcher.data, deactivateFetcher.state, t]);

  const tzOffset = useMemo(() => {
    const offset = new Date().getTimezoneOffset();
    const sign = offset <= 0 ? "+" : "-";
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
    return `${sign}${hours}`;
  }, []);

  // Collection search
  const [collectionQuery, setCollectionQuery] = useState("");
  const collectionSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);

  const handleCollectionSearch = useCallback(
    (query: string) => {
      setCollectionQuery(query);
      if (collectionSearchTimer.current) clearTimeout(collectionSearchTimer.current);
      collectionSearchTimer.current = setTimeout(() => {
        collectionSearchFetcher.submit(
          { _action: "searchCollections", query },
          { method: "POST" },
        );
      }, 250);
    },
    [collectionSearchFetcher],
  );

  const collectionSearchResults =
    (collectionSearchFetcher.data as any)?.intent === "searchCollections"
      ? (collectionSearchFetcher.data as any).collections ?? []
      : [];

  // Handle metaobject type change → fetch field defs
  const handleMetaobjectTypeChange = useCallback(
    (type: string) => {
      setPtMetaobjectType(type);
      if (type) {
        fieldDefsFetcher.submit(
          { _action: "fetchFieldDefs", metaobjectType: type },
          { method: "POST" },
        );
      } else {
        setPtFieldDefs([]);
        setPtDisplayNameKey("");
      }
    },
    [fieldDefsFetcher],
  );

  // Update field defs when fetcher responds
  if (
    (fieldDefsFetcher.data as any)?.intent === "fetchFieldDefs" &&
    (fieldDefsFetcher.data as any)?.fields
  ) {
    const data = fieldDefsFetcher.data as any;
    if (ptFieldDefs.length === 0 || data.fields.length !== ptFieldDefs.length) {
      setPtFieldDefs(data.fields);
      setPtDisplayNameKey(data.displayNameKey ?? "");
      setPtMetafieldNs(data.metafieldNamespace ?? "");
      setPtMetafieldKey(data.metafieldKey ?? "");
    }
  }

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
        if (query.trim().length > 0) {
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

  // Sync React modal state with s-modal native close events so dismissing
  // via escape key / backdrop click flips state back (C6).
  useEffect(() => {
    if (!modalOpen) return;
    const el = document.getElementById("product-browse-modal");
    if (!el) return;
    const handler = () => setModalOpen(false);
    el.addEventListener("close", handler);
    return () => el.removeEventListener("close", handler);
  }, [modalOpen]);

  useEffect(() => {
    if (!collectionModalOpen) return;
    const el = document.getElementById("collection-browse-modal");
    if (!el) return;
    const handler = () => setCollectionModalOpen(false);
    el.addEventListener("close", handler);
    return () => el.removeEventListener("close", handler);
  }, [collectionModalOpen]);

  // Tag input
  const [tagInput, setTagInput] = useState("");

  // Status
  const status = campaign?.status ?? "draft";
  const isActive = status === "active";
  const isSaving = saveFetcher.state !== "idle";
  const isActivating = activateFetcher.state !== "idle";
  const isDeactivating = deactivateFetcher.state !== "idle";
  const isDuplicating = duplicateFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";

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
        : filterType === "collections"
        ? JSON.stringify(selectedCollections.map((c) => c.id))
        : JSON.stringify(selectedProducts.map((p) => p.id));

    saveFetcher.submit(
      {
        _action: "save",
        name,
        discountType,
        discountValue,
        filterType,
        filterValues,
        excludeEnabled: String(excludeEnabled),
        excludeValues: JSON.stringify(excludeTags),
        startAt: startDate && startTime ? `${startDate}T${startTime}` : startDate ? `${startDate}T00:00` : "",
        endAt: hasEndDate && endDate ? (endTime ? `${endDate}T${endTime}` : `${endDate}T23:59`) : "",
        priceTagsEnabled: String(priceTagsEnabled),
        priceTagMetaobjectType: ptMetaobjectType,
        priceTagDisplayNameKey: ptDisplayNameKey,
        priceTagFieldDefaults: JSON.stringify(ptFieldDefaults),
        priceTagMetafieldNamespace: ptMetafieldNs,
        priceTagMetafieldKey: ptMetafieldKey,
      },
      { method: "POST" },
    );
  };

  const handleActivate = useCallback(() => {
    activateFetcher.submit({ _action: "activate" }, { method: "POST" });
  }, [activateFetcher]);

  const handleDeactivate = useCallback(() => {
    deactivateFetcher.submit({ _action: "deactivate" }, { method: "POST" });
  }, [deactivateFetcher]);

  const handleDuplicate = useCallback(() => {
    duplicateFetcher.submit({ _action: "duplicate" }, { method: "POST" });
  }, [duplicateFetcher]);

  const handleDelete = useCallback(() => {
    deleteFetcher.submit({ _action: "delete" }, { method: "POST" });
  }, [deleteFetcher]);

  const handlePreviewScope = useCallback(() => {
    const filterValues =
      filterType === "product_types"
        ? JSON.stringify(selectedTypes)
        : filterType === "collections"
          ? JSON.stringify(selectedCollections.map((c) => c.id))
          : JSON.stringify(selectedProducts.map((p) => p.id));

    const key = JSON.stringify({
      filterType,
      types: selectedTypes,
      cols: selectedCollections.map((c) => c.id),
      prods: selectedProducts.map((p) => p.id),
      excludeEnabled,
      excludeTags,
    });
    setLastPreviewKey(key);

    previewScopeFetcher.submit(
      {
        _action: "previewScope",
        filterType,
        filterValues,
        excludeEnabled: String(excludeEnabled),
        excludeValues: JSON.stringify(excludeTags),
      },
      { method: "POST" },
    );
  }, [previewScopeFetcher, filterType, selectedTypes, selectedCollections, selectedProducts, excludeEnabled, excludeTags]);

  // Clear the scope preview whenever the filter changes so a stale count
  // can't be mistaken for the current filter.
  const previewScopeKey = useMemo(
    () =>
      JSON.stringify({
        filterType,
        types: selectedTypes,
        cols: selectedCollections.map((c) => c.id),
        prods: selectedProducts.map((p) => p.id),
        excludeEnabled,
        excludeTags,
      }),
    [filterType, selectedTypes, selectedCollections, selectedProducts, excludeEnabled, excludeTags],
  );
  const [lastPreviewKey, setLastPreviewKey] = useState<string | null>(null);
  const previewScopeData =
    lastPreviewKey === previewScopeKey && (previewScopeFetcher.data as any)?.intent === "previewScope"
      ? (previewScopeFetcher.data as any)
      : null;
  const isPreviewingScope = previewScopeFetcher.state !== "idle";

  const handleSavePtConfig = useCallback(() => {
    saveConfigFetcher.submit(
      {
        _action: "saveFieldDefaults",
        metaobjectType: ptMetaobjectType,
        displayNameKey: ptDisplayNameKey,
        fieldDefaults: JSON.stringify(ptFieldDefaults),
      },
      { method: "POST" },
    );
    setPtAsideCollapsed(true);
  }, [saveConfigFetcher, ptMetaobjectType, ptDisplayNameKey, ptFieldDefaults]);

  return (
    <>
      {banner && (
        <s-banner tone={banner.tone} onDismiss={() => setBanner(null)}>
          {banner.message}
        </s-banner>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <s-button variant="tertiary" onClick={() => navigate("/app/merchandising/sale")}>
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
            isDuplicating ? (
              <s-button variant="secondary" loading disabled>{t("campaigns.duplicate")}</s-button>
            ) : (
              <s-button variant="secondary" onClick={handleDuplicate}>
                {t("campaigns.duplicate")}
              </s-button>
            )
          )}
          {(status === "expired" || status === "scheduled" || status === "draft") && !isNew && (
            isActivating ? (
              <s-button variant="primary" loading disabled>{t("campaigns.activating")}</s-button>
            ) : (
              <s-button variant="primary" onClick={handleActivate}>{t("campaigns.activate")}</s-button>
            )
          )}
          {status === "active" && (
            isDeactivating ? (
              <s-button variant="primary" tone="critical" loading disabled>{t("campaigns.deactivating")}</s-button>
            ) : (
              <s-button variant="primary" tone="critical" onClick={handleDeactivate}>{t("campaigns.deactivate")}</s-button>
            )
          )}
        </div>
      </div>

      <div className={styles.campaignLayout}>
        {/* --- Main form --- */}
        <div className={styles.campaignMain}>

          {isActive && (
            <s-banner tone="info">
              {t("campaigns.activeEditBanner")}
            </s-banner>
          )}

          {isStuckActivation && (
            <s-banner tone="warning">
              {t("campaigns.stuckRecoveryBanner")}
            </s-banner>
          )}

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
              <s-option value="collections">{t("campaigns.specificCollections")}</s-option>
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

            {filterType === "collections" && (
              <>
                <div className={styles.searchRow} style={{ marginTop: "12px" }}>
                  <div className={styles.searchInputWrap}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" style={{ color: "#8c9196", flexShrink: 0 }}>
                      <path fill="currentColor" d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293-4.82-4.82A5.968 5.968 0 0 0 14 8 6 6 0 0 0 2 8a6 6 0 0 0 6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z" />
                    </svg>
                    <input
                      className={styles.searchInput}
                      type="text"
                      placeholder={t("campaigns.searchCollections")}
                      value={collectionQuery}
                      onChange={(e) => handleCollectionSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && collectionQuery.trim()) {
                          e.preventDefault();
                          setCollectionModalOpen(true);
                        }
                      }}
                      disabled={isActive}
                    />
                  </div>
                  <s-button
                    variant="secondary"
                    onClick={() => {
                      setCollectionModalOpen(true);
                      // Carry any typed text into the modal so the search
                      // results are already populated when it opens.
                      handleCollectionSearch(collectionQuery);
                    }}
                    disabled={isActive}
                  >
                    {t("campaigns.browse")}
                  </s-button>
                </div>
                {collectionQuery && collectionSearchResults.length > 0 && !collectionModalOpen && !isActive && (
                  <div className={styles.inlineTypeahead}>
                    {collectionSearchResults.slice(0, 10).map((c: any) => {
                      const isSelected = selectedCollections.some((sc) => sc.id === c.id);
                      return (
                        <div
                          key={c.id}
                          className={`${styles.searchResultItem} ${isSelected ? styles.searchResultSelected : ""}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedCollections((prev) => prev.filter((sc) => sc.id !== c.id));
                            } else {
                              setSelectedCollections((prev) => [
                                ...prev,
                                { id: c.id, title: c.title, image: c.image, productCount: c.productCount },
                              ]);
                            }
                          }}
                        >
                          <input type="checkbox" checked={isSelected} readOnly />
                          <div className={styles.productInfo}>
                            <div className={styles.productTitle}>{c.title}</div>
                            <div style={{ fontSize: "12px", color: "#6d7175" }}>{c.productCount} products</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {selectedCollections.length > 0 && (
                  <div className={styles.badgeList}>
                    {selectedCollections.map((c) => (
                      <span key={c.id} className={styles.badge}>
                        {c.title} ({c.productCount})
                        {!isActive && (
                          <span
                            className={styles.badgeRemove}
                            onClick={() =>
                              setSelectedCollections((prev) =>
                                prev.filter((sc) => sc.id !== c.id),
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
                {collectionModalOpen && (
                  <s-modal
                    id="collection-browse-modal"
                    heading={t("campaigns.searchCollections")}
                    ref={(el: HTMLElement | null) => { if (el) el.setAttribute("open", ""); }}
                  >
                    <div className={styles.modalSearchWrap}>
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" style={{ color: "#8c9196" }}>
                        <path fill="currentColor" d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm9.707 4.293-4.82-4.82A5.968 5.968 0 0 0 14 8 6 6 0 0 0 2 8a6 6 0 0 0 6 6 5.968 5.968 0 0 0 3.473-1.113l4.82 4.82a.997.997 0 0 0 1.414 0 .999.999 0 0 0 0-1.414z" />
                      </svg>
                      <input
                        className={styles.modalSearchInput}
                        type="text"
                        placeholder={t("campaigns.searchCollections")}
                        value={collectionQuery}
                        onChange={(e) => handleCollectionSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    {collectionSearchResults.map((c: any) => {
                      const isSelected = selectedCollections.some((sc) => sc.id === c.id);
                      return (
                        <div
                          key={c.id}
                          className={`${styles.searchResultItem} ${isSelected ? styles.searchResultSelected : ""}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedCollections((prev) =>
                                prev.filter((sc) => sc.id !== c.id),
                              );
                            } else {
                              setSelectedCollections((prev) => [
                                ...prev,
                                { id: c.id, title: c.title, image: c.image, productCount: c.productCount },
                              ]);
                            }
                          }}
                        >
                          <input type="checkbox" checked={isSelected} readOnly />
                          <div className={styles.productInfo}>
                            <div className={styles.productTitle}>{c.title}</div>
                            <div style={{ fontSize: "12px", color: "#6d7175" }}>{c.productCount} products</div>
                          </div>
                        </div>
                      );
                    })}
                    <div slot="footer" className={styles.modalFooter}>
                      <span className={styles.modalCount}>{selectedCollections.length} selected</span>
                      <div className={styles.modalActions}>
                        <s-button
                          variant="secondary"
                          onClick={() => {
                            document.getElementById("collection-browse-modal")?.removeAttribute("open");
                            setCollectionModalOpen(false);
                          }}
                        >
                          Done
                        </s-button>
                      </div>
                    </div>
                  </s-modal>
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && modalQuery.trim()) {
                          e.preventDefault();
                          setModalOpen(true);
                        }
                      }}
                      disabled={isActive}
                    />
                  </div>
                  <s-button
                    variant="secondary"
                    onClick={() => {
                      setModalOpen(true);
                      // Typed text already lives in modalQuery and
                      // searchFetcher already has its results cached.
                    }}
                    disabled={isActive}
                  >
                    {t("campaigns.browse")}
                  </s-button>
                </div>
                {modalQuery && searchResults.length > 0 && !modalOpen && !isActive && (
                  <div className={styles.inlineTypeahead}>
                    {searchResults.slice(0, 10).map((p) => {
                      const isSelected = selectedProducts.some((sp) => sp.id === p.id);
                      return (
                        <div
                          key={p.id}
                          className={`${styles.searchResultItem} ${isSelected ? styles.searchResultSelected : ""}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedProducts((prev) => prev.filter((sp) => sp.id !== p.id));
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
                  </div>
                )}
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
                          onClick={() => {
                            document.getElementById("product-browse-modal")?.removeAttribute("open");
                            setModalOpen(false);
                          }}
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
            <div style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }} onClick={() => !isActive && setExcludeEnabled(prev => !prev)} role="button">
              <s-checkbox checked={excludeEnabled || undefined} onChange={() => setExcludeEnabled(prev => !prev)} disabled={isActive || undefined} />
              {t("campaigns.enableExcludes")}
            </div>
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

          {/* Price Tags toggle */}
          <div className={styles.formSection}>
            <div className={styles.formSectionTitle}>{t("campaigns.priceTags")}</div>
            <div className={styles.checkboxToggle} onClick={() => !isActive && setPriceTagsEnabled(prev => !prev)} role="button">
              <s-checkbox checked={priceTagsEnabled || undefined} onChange={() => setPriceTagsEnabled(prev => !prev)} disabled={isActive || undefined} />
              {t("campaigns.addPriceTags")}
            </div>
          </div>

          {/* Schedule */}
          <div className={styles.formSection}>
            <div className={styles.formSectionTitle}>{t("campaigns.activeDates")}</div>
            <div className={styles.dateTimeRow}>
              <div>
                <label className={styles.dateTimeLabel}>{t("campaigns.startDate")}</label>
                <div className={styles.dateTimeInputWrap}>
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className={styles.dateTimeIcon}>
                    <path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h4V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1ZM5 9v7h10V9H5Z" />
                  </svg>
                  <input type="date" className={styles.dateTimeInput} value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={isActive} />
                </div>
              </div>
              <div>
                <label className={styles.dateTimeLabel}>{t("campaigns.startTime")} ({tzOffset})</label>
                <div className={styles.dateTimeInputWrap}>
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className={styles.dateTimeIcon}>
                    <path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 3.75v4.5l3.1 1.86a.75.75 0 1 1-.77 1.28l-3.46-2.07a.75.75 0 0 1-.37-.65V5.75a.75.75 0 0 1 1.5 0Z" />
                  </svg>
                  <input type="time" className={styles.dateTimeInput} value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={isActive} />
                </div>
              </div>
            </div>
            <div className={styles.checkboxToggle} style={{ marginTop: "12px" }} onClick={() => !isActive && setHasEndDate(prev => !prev)} role="button">
              <s-checkbox checked={hasEndDate || undefined} onChange={() => setHasEndDate(prev => !prev)} disabled={isActive || undefined} />
              {t("campaigns.setEndDate")}
            </div>
            {hasEndDate && (
              <div className={styles.dateTimeRow} style={{ marginTop: "12px" }}>
                <div>
                  <label className={styles.dateTimeLabel}>{t("campaigns.endDate")}</label>
                  <div className={styles.dateTimeInputWrap}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className={styles.dateTimeIcon}>
                      <path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h4V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1ZM5 9v7h10V9H5Z" />
                    </svg>
                    <input type="date" className={styles.dateTimeInput} value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={isActive} />
                  </div>
                </div>
                <div>
                  <label className={styles.dateTimeLabel}>{t("campaigns.endTime")} ({tzOffset})</label>
                  <div className={styles.dateTimeInputWrap}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className={styles.dateTimeIcon}>
                      <path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 3.75v4.5l3.1 1.86a.75.75 0 1 1-.77 1.28l-3.46-2.07a.75.75 0 0 1-.37-.65V5.75a.75.75 0 0 1 1.5 0Z" />
                    </svg>
                    <input type="time" className={styles.dateTimeInput} value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={isActive} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Save button */}
          {!isActive && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {!isNew && (status === "draft" || status === "cancelled") ? (
                isDeleting ? (
                  <s-button variant="secondary" tone="critical" loading disabled>
                    {t("campaigns.delete")}
                  </s-button>
                ) : (
                  <s-button variant="secondary" tone="critical" onClick={() => setDeleteConfirmOpen(true)}>
                    {t("campaigns.delete")}
                  </s-button>
                )
              ) : (
                <div />
              )}
              {isSaving ? (
                <s-button variant="primary" loading disabled>{t("campaigns.saving")}</s-button>
              ) : (
                <s-button
                  variant="primary"
                  onClick={handleSave}
                  disabled={!name || !startDate || discVal <= 0 || undefined}
                >
                  {t("campaigns.save")}
                </s-button>
              )}
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
                {priceTagsEnabled && discVal > 0 && (() => {
                  const badge = computeSmartBadge(
                    discountType as "percentage" | "fixed",
                    discVal,
                    samplePrice,
                  );
                  if (!badge) return null;
                  return (
                    <div style={{
                      marginTop: "12px",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      display: "inline-block",
                      background: ptFieldDefaults.cor_do_fundo || ptFieldDefaults.corDoFundo || "#DF3630",
                      color: ptFieldDefaults.cor_do_texto || ptFieldDefaults.corDoTexto || "#FFFFFF",
                    }}>
                      {badge.text}
                    </div>
                  );
                })()}
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
                {filterType === "collections" && selectedCollections.length > 0 && (
                  <li>{t("campaigns.appliesToCollections")}</li>
                )}
                {filterType === "products" && selectedProducts.length > 0 && (
                  <li>{t("campaigns.appliesToProducts")}</li>
                )}
                {excludeEnabled && excludeTags.length > 0 && (
                  <li>{t("campaigns.excludesProductTags")}</li>
                )}
                {startDate && <li>Start: {startDate}{startTime ? ` ${startTime}` : ""}</li>}
                {hasEndDate && endDate && <li>End: {endDate}{endTime ? ` ${endTime}` : ""}</li>}
                <li>Price tags: {priceTagsEnabled ? t("campaigns.tagsOn") : t("campaigns.tagsOff")}</li>
              </ul>

              <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                {isPreviewingScope ? (
                  <s-button variant="secondary" loading disabled>{t("campaigns.previewScopeLoading")}</s-button>
                ) : (
                  <s-button variant="secondary" onClick={handlePreviewScope}>
                    {t("campaigns.previewScope")}
                  </s-button>
                )}
              </div>

              {previewScopeData && (
                <div className={styles.scopePreview}>
                  {previewScopeData.productCount > 0 ? (
                    <>
                      <div className={styles.scopePreviewCount}>
                        {t("campaigns.previewScopeResult", {
                          products: previewScopeData.productCount,
                          variants: previewScopeData.variantCount,
                        })}
                      </div>
                      {previewScopeData.sampleTitles?.length > 0 && (
                        <div className={styles.scopePreviewSamples}>
                          {t("campaigns.previewScopeSamples", {
                            samples: previewScopeData.sampleTitles.join(", "),
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={styles.scopePreviewEmpty}>
                      {t("campaigns.previewScopeEmpty")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Price tag config aside */}
          {priceTagsEnabled && (
            <div className={styles.collapsibleSectionWrap}>
              <s-section heading={t("campaigns.metaobjectDefinition")}>
                <div className={styles.asideSelectRow}>
                  <s-select
                    value={ptMetaobjectType}
                    onChange={(e: Event) => {
                      handleMetaobjectTypeChange((e.currentTarget as HTMLSelectElement).value);
                      setPtAsideCollapsed(false);
                    }}
                    disabled={isActive}
                  >
                    <s-option value="">{t("campaigns.selectDefinition")}</s-option>
                    {(metaobjectTypes ?? []).map((mt: { type: string; name: string }) => (
                      <s-option key={mt.type} value={mt.type}>{mt.name} ({mt.type})</s-option>
                    ))}
                  </s-select>
                </div>

                {!ptAsideCollapsed && (
                  <>
                    {ptDisplayNameKey && (
                      <p className={styles.displayNameHint}>
                        {t("campaigns.displayNameHint", { field: ptDisplayNameKey })}
                      </p>
                    )}

                    {ptFieldDefs.length > 0 && (
                      <div className={styles.asideFields}>
                        {(() => {
                          let paramLabelShown = false;
                          return ptFieldDefs
                            .filter((f: any) => !f.isDisplayName)
                            .map((field: any) => {
                              const showParamLabel = !paramLabelShown;
                              if (showParamLabel) paramLabelShown = true;
                              const paramLabel = showParamLabel ? <h3 className={styles.subSectionTitle}>{t("campaigns.metaobjectParameters")}</h3> : null;

                              if (field.typeName === "color") {
                                const rawVal = ptFieldDefaults[field.key] || "";
                                const hexBody = rawVal.replace(/^#/, "");
                                const previewColor = hexBody.length >= 3 ? `#${hexBody}` : "#000000";
                                return (
                                  <div key={field.key}>
                                    {paramLabel}
                                    <div className={styles.colorFieldRow}>
                                      <label className={styles.colorFieldLabel}>{field.name} {field.required ? "*" : ""}</label>
                                      <div className={styles.colorFieldInputs}>
                                        <div className={styles.colorSwatch} style={{ backgroundColor: previewColor }} />
                                        <div className={styles.colorTextWrap}>
                                          <span className={styles.colorHash}>#</span>
                                          <input
                                            type="text"
                                            value={hexBody.toUpperCase()}
                                            onChange={(e) => {
                                              const cleaned = e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6).toUpperCase();
                                              setPtFieldDefaults((prev) => ({ ...prev, [field.key]: `#${cleaned}` }));
                                              setPtAsideSaved(false);
                                            }}
                                            className={styles.colorText}
                                            placeholder="000000"
                                            maxLength={6}
                                            disabled={isActive}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }
                              if (field.typeName === "boolean") {
                                return (
                                  <div key={field.key}>
                                    {paramLabel}
                                    <div className={styles.boolFieldRow}>
                                      <div className={styles.checkboxToggle} onClick={() => !isActive && setPtFieldDefaults((prev) => ({ ...prev, [field.key]: prev[field.key] === "true" ? "false" : "true" }))} role="button">
                                        <s-checkbox
                                          checked={ptFieldDefaults[field.key] === "true" || undefined}
                                          onChange={() => setPtFieldDefaults((prev) => ({ ...prev, [field.key]: prev[field.key] === "true" ? "false" : "true" }))}
                                          disabled={isActive || undefined}
                                        />
                                        {field.name} {field.required ? "*" : ""}
                                      </div>
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div key={field.key}>
                                  {paramLabel}
                                  <s-text-field
                                    label={`${field.name} ${field.required ? "*" : ""}`}
                                    value={ptFieldDefaults[field.key] || ""}
                                    onChange={(e: any) => {
                                      setPtFieldDefaults((prev) => ({ ...prev, [field.key]: e.currentTarget.value }));
                                      setPtAsideSaved(false);
                                    }}
                                    disabled={isActive}
                                  />
                                </div>
                              );
                            });
                        })()}
                      </div>
                    )}

                    <div className={styles.asideSaveRow}>
                      {ptAsideSaved && <span className={styles.asideSavedLabel}>{t("campaigns.saved")}</span>}
                      <s-button variant="primary" onClick={handleSavePtConfig} disabled={!ptMetaobjectType || isActive}>
                        {t("campaigns.save")}
                      </s-button>
                    </div>
                  </>
                )}

                <div
                  className={`${styles.collapseChevron}${ptAsideCollapsed ? ` ${styles.collapsed}` : ""}`}
                  onClick={() => setPtAsideCollapsed((prev) => !prev)}
                  role="button"
                  aria-label="Toggle price tag config"
                >
                  <span className={styles.chevronIcon}>›</span>
                </div>
              </s-section>
            </div>
          )}
        </div>
      </div>

      {deleteConfirmOpen && (
        <s-modal
          id="campaign-delete-confirm"
          heading={t("campaigns.deleteTitle")}
          ref={(el: HTMLElement | null) => { if (el) el.setAttribute("open", ""); }}
        >
          <div style={{ padding: "16px" }}>
            {t("campaigns.deleteConfirm")}
          </div>
          <div slot="footer" className={styles.modalFooter}>
            <div className={styles.modalActions} style={{ marginLeft: "auto" }}>
              <s-button
                variant="secondary"
                onClick={() => {
                  document.getElementById("campaign-delete-confirm")?.removeAttribute("open");
                  setDeleteConfirmOpen(false);
                }}
              >
                {t("campaigns.cancel")}
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                onClick={() => {
                  document.getElementById("campaign-delete-confirm")?.removeAttribute("open");
                  setDeleteConfirmOpen(false);
                  handleDelete();
                }}
              >
                {t("campaigns.delete")}
              </s-button>
            </div>
          </div>
        </s-modal>
      )}
    </>
  );
}
