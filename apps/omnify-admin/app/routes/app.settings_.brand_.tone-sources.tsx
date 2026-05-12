import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import prisma from "../db.server";
import {
  acceptHypothesis,
  listPendingHypotheses,
  listRecentBatches,
  listSourceSummaries,
  makeBatchId,
  rejectHypothesis,
  type ToneSourceSummary,
  type ToneHypothesisRow,
  type ToneBatchSummary,
} from "../services/tone-sources/service.server";
import { ingestShopifyBlogs } from "../services/tone-sources/shopify.server";
import { runInferenceForBatch } from "../services/tone-sources/inference.server";
import {
  deleteManualReference,
  extractFromBuffer,
  extractFromUrl,
  listManualReferences,
  persistManualSource,
  persistManualUploadWithBinary,
  reExtractFromS3,
} from "../services/tone-sources/manual.server";
import {
  clearMondayConfig,
  getMondayConfig,
  ingestMonday,
  saveMondayConfig,
} from "../services/tone-sources/monday.server";
import {
  clearMetaConfig,
  getMetaConfig,
  ingestMeta,
  saveMetaConfig,
} from "../services/tone-sources/meta.server";
import type {
  ToneHypothesisCategory,
  ToneSourceType,
} from "../services/tone-sources/types";
import styles from "./app.settings_.brand_.tone-sources/styles.module.css";
import {
  ShopifyLogo,
  MetaLogo,
  MondayLogo,
  ManualUploadIcon,
} from "../components/brand-icons";
import { PageTabs, type PageTab } from "../components/page-tabs";

const MIN_CONFIDENCE = 0.5;

type LoaderData = {
  shop: string;
  manualToneOverride: string | null;
  sources: SerializedSource[];
  pendingHypotheses: SerializedHypothesis[];
  batches: SerializedBatch[];
  manualReferences: SerializedManualReference[];
  mondayConfigured: boolean;
  mondayBoardIds: string[];
  metaConfigured: boolean;
  metaIgBusinessId: string | null;
  metaFbPageId: string | null;
  basePath: string;
};

type SerializedManualReference = {
  id: string;
  sourceType: "manual_upload" | "manual_url";
  sourceId: string;
  sourceUrl: string | null;
  capturedAt: string;
  filename: string | null;
  charCount: number;
};

type SerializedSource = {
  sourceType: ToneSourceType;
  status: string;
  sampleCount: number;
  lastSampledAt: string | null;
  detail: string | null;
};

type SerializedHypothesis = {
  id: string;
  batchId: string;
  category: ToneHypothesisCategory;
  statement: string;
  evidence: Array<{ sourceType: string; sourceId: string; snippet: string }>;
  confidence: number;
  status: string;
  createdAt: string;
};

type SerializedBatch = {
  batchId: string;
  createdAt: string;
  totalSamples: number;
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  sourceTypes: ToneSourceType[];
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[tone-sources] loader shop=${shop}`);

  const [assets, sources, pending, batches, manualRefs, mondayConfig, metaConfig] =
    await Promise.all([
      prisma.brandAssets.findUnique({ where: { shop } }),
      listSourceSummaries(shop),
      listPendingHypotheses(shop, { minConfidence: MIN_CONFIDENCE }),
      listRecentBatches(shop, 5),
      listManualReferences(shop),
      getMondayConfig(shop),
      getMetaConfig(shop),
    ]);

  return {
    shop,
    manualToneOverride: assets?.toneOfVoice ?? null,
    sources: sources.map(serializeSource),
    pendingHypotheses: pending.map(serializeHypothesis),
    batches: batches.map(serializeBatch),
    manualReferences: manualRefs.map((r) => ({
      id: r.id,
      sourceType: r.sourceType as "manual_upload" | "manual_url",
      sourceId: r.sourceId,
      sourceUrl: r.sourceUrl,
      capturedAt: r.capturedAt.toISOString(),
      filename:
        (r.metaJson as { filename?: string } | null)?.filename ?? null,
      charCount: r.rawText.length,
    })),
    mondayConfigured: mondayConfig !== null,
    mondayBoardIds: mondayConfig?.boardIds ?? [],
    metaConfigured: metaConfig !== null,
    metaIgBusinessId: metaConfig?.igBusinessId ?? null,
    metaFbPageId: metaConfig?.fbPageId ?? null,
    basePath: process.env.BASE_PATH || "",
  };
};

function serializeSource(s: ToneSourceSummary): SerializedSource {
  return {
    sourceType: s.sourceType,
    status: s.status,
    sampleCount: s.sampleCount,
    lastSampledAt: s.lastSampledAt?.toISOString() ?? null,
    detail: s.detail,
  };
}

function serializeHypothesis(h: ToneHypothesisRow): SerializedHypothesis {
  return {
    id: h.id,
    batchId: h.batchId,
    category: h.category,
    statement: h.statement,
    evidence: h.evidence,
    confidence: h.confidence,
    status: h.status,
    createdAt: h.createdAt.toISOString(),
  };
}

function serializeBatch(b: ToneBatchSummary): SerializedBatch {
  return {
    batchId: b.batchId,
    createdAt: b.createdAt.toISOString(),
    totalSamples: b.totalSamples,
    pendingCount: b.pendingCount,
    acceptedCount: b.acceptedCount,
    rejectedCount: b.rejectedCount,
    sourceTypes: b.sourceTypes,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  console.info(`[tone-sources] action intent=${intent ?? "?"} shop=${shop}`);

  if (intent === "refreshShopify") {
    try {
      const batchId = makeBatchId();
      const ingestResult = await ingestShopifyBlogs({ admin, shop, batchId });

      let inferred = 0;
      let inferenceError: string | null = null;
      if (ingestResult.sampled > 0) {
        const infResult = await runInferenceForBatch({ shop, batchId });
        if ("error" in infResult) {
          inferenceError = infResult.error;
        } else {
          inferred = infResult.created;
        }
      }

      return {
        success: true,
        intent,
        sampled: ingestResult.sampled,
        skipped: ingestResult.skipped,
        inferred,
        batchId,
        ...(inferenceError ? { inferenceError } : {}),
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Shopify blog ingest failed.";
      return { success: false, intent, error: message };
    }
  }

  if (intent === "uploadFile") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, intent, error: "No file provided." };
    }
    if (file.size > 10 * 1024 * 1024) {
      return { success: false, intent, error: "File too large (>10MB)." };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await extractFromBuffer({
      shop,
      buffer,
      filename: file.name,
      mimeType: file.type,
    });
    if ("error" in extracted) {
      return { success: false, intent, error: extracted.error };
    }
    const batchId = makeBatchId();
    await persistManualUploadWithBinary({
      shop,
      batchId,
      sourceId: `upload_${Date.now()}_${file.name}`,
      rawText: extracted.text,
      buffer,
      contentType: file.type || "application/octet-stream",
      filename: file.name,
      mediaType: extracted.mediaType,
    });

    let inferred = 0;
    let inferenceError: string | null = null;
    const infResult = await runInferenceForBatch({ shop, batchId });
    if ("error" in infResult) {
      inferenceError = infResult.error;
    } else {
      inferred = infResult.created;
    }
    return {
      success: true,
      intent,
      filename: file.name,
      chars: extracted.text.length,
      inferred,
      ...(inferenceError ? { inferenceError } : {}),
    };
  }

  if (intent === "reExtract") {
    const sourceId = formData.get("sourceId") as string | null;
    if (!sourceId) {
      return { success: false, intent, error: "Missing source ID." };
    }
    const result = await reExtractFromS3({ shop, sourceId });
    if ("error" in result) {
      return { success: false, intent, error: result.error };
    }
    return {
      success: true,
      intent,
      chars: result.rawText.length,
    };
  }

  if (intent === "addUrl") {
    const url = formData.get("url") as string | null;
    if (!url || url.trim().length === 0) {
      return { success: false, intent, error: "URL is required." };
    }
    const extracted = await extractFromUrl({ shop, url: url.trim() });
    if ("error" in extracted) {
      return { success: false, intent, error: extracted.error };
    }
    const batchId = makeBatchId();
    await persistManualSource({
      shop,
      batchId,
      sourceType: "manual_url",
      sourceId: `url_${Date.now()}_${url}`.slice(0, 200),
      sourceUrl: url.trim(),
      rawText: extracted.text,
      metaJson: {
        url: url.trim(),
        mediaType: extracted.mediaType,
      },
    });

    let inferred = 0;
    let inferenceError: string | null = null;
    const infResult = await runInferenceForBatch({ shop, batchId });
    if ("error" in infResult) {
      inferenceError = infResult.error;
    } else {
      inferred = infResult.created;
    }
    return {
      success: true,
      intent,
      url: url.trim(),
      chars: extracted.text.length,
      inferred,
      ...(inferenceError ? { inferenceError } : {}),
    };
  }

  if (intent === "deleteReference") {
    const sourceId = formData.get("sourceId") as string | null;
    if (!sourceId) {
      return { success: false, intent, error: "Missing source ID." };
    }
    await deleteManualReference(shop, sourceId);
    return { success: true, intent };
  }

  if (intent === "saveMondayConfig") {
    const apiKey = formData.get("mondayApiKey") as string | null;
    const boardIdsRaw = formData.get("mondayBoardIds") as string | null;
    if (!apiKey || !boardIdsRaw) {
      return {
        success: false,
        intent,
        error: "API key and board IDs are required.",
      };
    }
    const boardIds = boardIdsRaw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (boardIds.length === 0) {
      return { success: false, intent, error: "At least one board ID is required." };
    }
    try {
      await saveMondayConfig({ shop, apiKey, boardIds });
      return { success: true, intent };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save Monday.com config.";
      return { success: false, intent, error: message };
    }
  }

  if (intent === "clearMondayConfig") {
    await clearMondayConfig(shop);
    return { success: true, intent };
  }

  if (intent === "saveMetaConfig") {
    const accessToken = formData.get("metaAccessToken") as string | null;
    const igBusinessId = formData.get("metaIgBusinessId") as string | null;
    const fbPageId = formData.get("metaFbPageId") as string | null;
    if (!accessToken || accessToken.trim().length === 0) {
      return {
        success: false,
        intent,
        error: "Long-lived page access token is required.",
      };
    }
    if (!igBusinessId && !fbPageId) {
      return {
        success: false,
        intent,
        error: "At least one of Instagram Business ID or Facebook Page ID is required.",
      };
    }
    try {
      await saveMetaConfig({
        shop,
        accessToken,
        igBusinessId: igBusinessId ?? null,
        fbPageId: fbPageId ?? null,
      });
      return { success: true, intent };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save Meta config.";
      return { success: false, intent, error: message };
    }
  }

  if (intent === "clearMetaConfig") {
    await clearMetaConfig(shop);
    return { success: true, intent };
  }

  if (intent === "refreshMeta") {
    const batchId = makeBatchId();
    const result = await ingestMeta({ shop, batchId });
    if ("error" in result) {
      return { success: false, intent, error: result.error };
    }
    let inferred = 0;
    let inferenceError: string | null = null;
    if (result.sampled > 0) {
      const infResult = await runInferenceForBatch({ shop, batchId });
      if ("error" in infResult) {
        inferenceError = infResult.error;
      } else {
        inferred = infResult.created;
      }
    }
    return {
      success: true,
      intent,
      sampled: result.sampled,
      skipped: result.skipped,
      ocrCount: result.ocrCount,
      inferred,
      batchId,
      ...(inferenceError ? { inferenceError } : {}),
    };
  }

  if (intent === "refreshMonday") {
    const batchId = makeBatchId();
    const result = await ingestMonday({ shop, batchId });
    if ("error" in result) {
      return { success: false, intent, error: result.error };
    }
    let inferred = 0;
    let inferenceError: string | null = null;
    if (result.sampled > 0) {
      const infResult = await runInferenceForBatch({ shop, batchId });
      if ("error" in infResult) {
        inferenceError = infResult.error;
      } else {
        inferred = infResult.created;
      }
    }
    return {
      success: true,
      intent,
      sampled: result.sampled,
      skipped: result.skipped,
      inferred,
      batchId,
      ...(inferenceError ? { inferenceError } : {}),
    };
  }

  if (intent === "acceptHypothesis") {
    const id = formData.get("hypothesisId") as string | null;
    if (!id) return { success: false, intent, error: "Missing hypothesis ID" };
    await acceptHypothesis(shop, id);
    return { success: true, intent };
  }

  if (intent === "rejectHypothesis") {
    const id = formData.get("hypothesisId") as string | null;
    if (!id) return { success: false, intent, error: "Missing hypothesis ID" };
    await rejectHypothesis(shop, id);
    return { success: true, intent };
  }

  return { success: false, error: "Unknown intent." };
};

/* ============================================================
 * Display rows (UI grouping over the 6 underlying source types)
 *  - shopify_blog                → "Shopify blog posts"
 *  - meta_ig + meta_fb           → "Instagram & Facebook"
 *  - monday                      → "Monday.com"
 *  - manual_upload + manual_url  → "Manual references"
 * ============================================================ */
type DisplayRowId = "shopify" | "meta" | "monday" | "manual";

function categoryPillClass(category: ToneHypothesisCategory): string {
  switch (category) {
    case "voice":
      return `${styles.categoryPill} ${styles.categoryPillVoice}`;
    case "vocabulary":
      return `${styles.categoryPill} ${styles.categoryPillVocabulary}`;
    case "do":
      return `${styles.categoryPill} ${styles.categoryPillDo}`;
    case "dont":
      return `${styles.categoryPill} ${styles.categoryPillDont}`;
    case "register":
      return `${styles.categoryPill} ${styles.categoryPillRegister}`;
    case "structure":
      return `${styles.categoryPill} ${styles.categoryPillStructure}`;
    default:
      return styles.categoryPill;
  }
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ============================================================
 * Brand-glyph SVG icons (inline, no external deps)
 * ============================================================ */
// Brand logos (Shopify, Meta, Monday) and the Manual upload icon now live in
// app/components/brand-icons.tsx. Imported at the top of this file.

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm0 1v11h10V6h-3V3H3z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M5.5 11.4a2 2 0 0 1 0-2.8l2-2a1 1 0 0 1 1.4 1.4l-2 2a.6.6 0 0 0 0 .8l1 1a.6.6 0 0 0 .8 0l2-2a1 1 0 0 1 1.4 1.4l-2 2a2.6 2.6 0 0 1-3.6 0zm-1.4-1.4a1 1 0 0 1-1.4 0 2.6 2.6 0 0 1 0-3.6l2-2a2.6 2.6 0 0 1 3.6 0 1 1 0 0 1-1.4 1.4.6.6 0 0 0-.8 0l-2 2a.6.6 0 0 0 0 .8 1 1 0 0 1 0 1.4z" />
    </svg>
  );
}

export default function ToneSourcesPage() {
  const {
    manualToneOverride,
    sources,
    pendingHypotheses,
    batches,
    manualReferences,
    mondayConfigured,
    mondayBoardIds,
    metaConfigured,
    metaIgBusinessId,
    metaFbPageId,
    basePath,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useTranslation("brand-settings");

  // ── single-expand-at-a-time state ──────────────────────────
  const [expandedRow, setExpandedRow] = useState<DisplayRowId | null>("shopify");

  // ── form input state ───────────────────────────────────────
  const [mondayApiKeyInput, setMondayApiKeyInput] = useState("");
  const [mondayBoardIdsInput, setMondayBoardIdsInput] = useState(
    mondayBoardIds.join(", "),
  );
  const [metaTokenInput, setMetaTokenInput] = useState("");
  const [metaIgInput, setMetaIgInput] = useState(metaIgBusinessId ?? "");
  const [metaFbInput, setMetaFbInput] = useState(metaFbPageId ?? "");

  const isRefreshingShopify =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "refreshShopify";
  const isRefreshingMonday =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "refreshMonday";
  const isSavingMonday =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "saveMondayConfig";
  const isRefreshingMeta =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "refreshMeta";
  const isSavingMeta =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "saveMetaConfig";
  const isUploading =
    uploadFetcher.state !== "idle" &&
    (uploadFetcher.formData?.get("intent") === "uploadFile" ||
      uploadFetcher.formData?.get("intent") === "addUrl");

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success && "sampled" in fetcher.data) {
      const sampled = fetcher.data.sampled ?? 0;
      const inferred =
        "inferred" in fetcher.data ? (fetcher.data.inferred ?? 0) : 0;
      shopify.toast?.show?.(
        t("toneSources.refreshOk", {
          sampled,
          inferred,
          defaultValue: `Sampled ${sampled} articles, inferred ${inferred} traits.`,
        }),
      );
    } else if (!fetcher.data.success && "error" in fetcher.data) {
      shopify.toast?.show?.(fetcher.data.error ?? "Action failed.");
    }
  }, [fetcher.data, shopify, t]);

  useEffect(() => {
    if (!uploadFetcher.data) return;
    if (uploadFetcher.data.success && "chars" in uploadFetcher.data) {
      const chars = uploadFetcher.data.chars ?? 0;
      const inferred =
        "inferred" in uploadFetcher.data
          ? (uploadFetcher.data.inferred ?? 0)
          : 0;
      shopify.toast?.show?.(
        t("toneSources.uploadOk", {
          chars,
          inferred,
          defaultValue: `Reference added (${chars} chars), inferred ${inferred} traits.`,
        }),
      );
    } else if (!uploadFetcher.data.success && "error" in uploadFetcher.data) {
      shopify.toast?.show?.(uploadFetcher.data.error ?? "Upload failed.");
    }
  }, [uploadFetcher.data, shopify, t]);

  // ── derive grouped row data from underlying sources ────────
  const sourceMap = new Map<ToneSourceType, SerializedSource>(
    sources.map((s) => [s.sourceType, s]),
  );

  const shopifySource = sourceMap.get("shopify_blog");
  const igSource = sourceMap.get("meta_ig");
  const fbSource = sourceMap.get("meta_fb");
  const mondaySource = sourceMap.get("monday");
  const uploadSource = sourceMap.get("manual_upload");
  const urlSource = sourceMap.get("manual_url");

  const metaSampleCount =
    (igSource?.sampleCount ?? 0) + (fbSource?.sampleCount ?? 0);
  const metaLastSampled =
    [igSource?.lastSampledAt, fbSource?.lastSampledAt]
      .filter((x): x is string => Boolean(x))
      .sort()
      .pop() ?? null;

  const manualSampleCount =
    (uploadSource?.sampleCount ?? 0) + (urlSource?.sampleCount ?? 0);

  const toggleRow = (id: DisplayRowId) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  // Option-C tab strip: extends the Settings tab strip with "Tone of voice"
  // as the active tab and "Brand" rendered in-trail (subdued + italic + "›"
  // separator after it). Replaces the chevron back-action — the in-trail
  // Brand tab IS the "back" affordance, AND the Settings tabs remain
  // available for switching to sibling Settings concepts.
  const toneSourcesTabs: PageTab[] = [
    {
      key: "settings",
      label: t("settings:tabs.locations", { defaultValue: "Locations" }),
      to: "/app/settings",
    },
    {
      key: "providers",
      label: t("settings:tabs.providers", { defaultValue: "Delivery providers" }),
      to: "/app/settings",
    },
    {
      key: "carriers",
      label: t("settings:tabs.carriers", { defaultValue: "Carriers" }),
      to: "/app/settings",
    },
    {
      key: "brand",
      label: t("settings:tabs.brand", { defaultValue: "Brand" }),
      to: "/app/settings/brand",
      variant: "in-trail",
    },
    {
      key: "tone-of-voice",
      label: t("toneSources.pageHeading", { defaultValue: "Tone of voice sources" }),
      to: "/app/settings/brand/tone-sources",
    },
  ];

  return (
    // Heading is "Settings" (not "Tone of voice") because the Shopify-chrome
    // breadcrumb above <s-page> reads from this prop — it must match the
    // top-level nav item ("Settings") regardless of which Settings sub-tab
    // we're on. The active sub-tab (Tone of voice, with Brand in-trail) is
    // communicated by the <PageTabs> below.
    <s-page heading={t("settings:pageHeading", { defaultValue: "Settings" })}>
      <PageTabs activeKey="tone-of-voice" tabs={toneSourcesTabs} ariaLabel="Settings" />
      <fetcher.Form method="POST" slot="primary-action">
        <input type="hidden" name="intent" value="refreshShopify" />
        <s-button
          type="submit"
          variant="primary"
          {...(isRefreshingShopify ? { loading: true, disabled: true } : {})}
        >
          {t("toneSources.refreshNow", { defaultValue: "Refresh tone now" })}
        </s-button>
      </fetcher.Form>

      <s-section
        heading={t("toneSources.sources.heading", {
          defaultValue: "Connected sources",
        })}
      >
        <s-paragraph>
          {t("toneSources.sources.description", {
            defaultValue:
              "We sample copy from these sources weekly to learn how your brand sounds. Every new batch is reviewed by you before it changes how blog posts are written.",
          })}
        </s-paragraph>

        <div className={styles.sourceList}>
          {/* ───── SHOPIFY ───── */}
          <SourceItem
            id="shopify"
            expanded={expandedRow === "shopify"}
            onToggle={toggleRow}
            iconClass={`${styles.sourceIcon} ${styles.sourceIconShopify}`}
            icon={<ShopifyLogo basePath={basePath} size={20} />}
            name={t("toneSources.rows.shopifyName", { defaultValue: "Shopify blog posts" })}
            detail={
              shopifySource?.detail
                ? formatDetail(shopifySource.detail, shopifySource.lastSampledAt)
                : t("toneSources.rows.shopifyDetailIdle", {
                    defaultValue: "Ready to sample your existing blog articles.",
                  })
            }
            statusKey={shopifySource?.sampleCount ? "connected" : "notConfigured"}
            statusText={
              shopifySource?.sampleCount
                ? t("toneSources.status.connected", { defaultValue: "Connected" })
                : t("toneSources.status.notConfigured", {
                    defaultValue: "Not configured",
                  })
            }
          >
            <p className={styles.bodyHelp}>
              {t("toneSources.shopify.help", {
                defaultValue:
                  "Auto-connected via your Shopify session — no credentials needed. We sample up to 5 blogs × 25 most recent articles.",
              })}
            </p>
            <div className={styles.bodyActions}>
              <fetcher.Form method="POST">
                <input type="hidden" name="intent" value="refreshShopify" />
                <s-button
                  type="submit"
                  variant="secondary"
                  {...(isRefreshingShopify ? { loading: true, disabled: true } : {})}
                >
                  {t("toneSources.actions.refreshNow", {
                    defaultValue: "Refresh now",
                  })}
                </s-button>
              </fetcher.Form>
            </div>
          </SourceItem>

          {/* ───── INSTAGRAM & FACEBOOK (merged) ───── */}
          <SourceItem
            id="meta"
            expanded={expandedRow === "meta"}
            onToggle={toggleRow}
            iconClass={`${styles.sourceIcon} ${styles.sourceIconMeta}`}
            icon={<MetaLogo basePath={basePath} size={20} />}
            name={t("toneSources.rows.metaName", {
              defaultValue: "Instagram & Facebook",
            })}
            detail={
              metaConfigured && metaSampleCount > 0
                ? `${metaSampleCount} ${t("toneSources.rows.metaPosts", { defaultValue: "posts" })} ${formatSampledRelative(metaLastSampled)}`
                : t("toneSources.rows.metaDetailIdle", {
                    defaultValue:
                      "Connect to pull captions + image text via Meta Graph API.",
                  })
            }
            statusKey={metaConfigured ? "connected" : "notConfigured"}
            statusText={
              metaConfigured
                ? t("toneSources.status.connected", { defaultValue: "Connected" })
                : t("toneSources.status.notConfigured", {
                    defaultValue: "Not configured",
                  })
            }
          >
            <p className={styles.bodyHelp}>
              {t("toneSources.meta.description", {
                defaultValue:
                  "Generate a long-lived Page Access Token in Meta Business Suite (Settings → Users → System Users → Generate token). Provide the IG Business ID and/or FB Page ID for accounts you want sampled.",
              })}
            </p>
            <fetcher.Form method="POST">
              <input type="hidden" name="intent" value="saveMetaConfig" />
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  {t("toneSources.meta.token", {
                    defaultValue: "Long-lived Page Access Token",
                  })}
                </label>
                <input
                  className={styles.fieldInput}
                  type="password"
                  name="metaAccessToken"
                  value={metaTokenInput}
                  onChange={(e) => setMetaTokenInput(e.target.value)}
                  placeholder={
                    metaConfigured
                      ? t("toneSources.meta.tokenPlaceholderConfigured", {
                          defaultValue: "(stored — leave blank to keep current)",
                        })
                      : "EAAB..."
                  }
                />
              </div>
              <div className={styles.fieldRow2}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>
                    {t("toneSources.meta.igBusinessId", {
                      defaultValue: "Instagram Business ID",
                    })}
                  </label>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    name="metaIgBusinessId"
                    value={metaIgInput}
                    onChange={(e) => setMetaIgInput(e.target.value)}
                    placeholder="17841400000000000"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>
                    {t("toneSources.meta.fbPageId", {
                      defaultValue: "Facebook Page ID",
                    })}
                  </label>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    name="metaFbPageId"
                    value={metaFbInput}
                    onChange={(e) => setMetaFbInput(e.target.value)}
                    placeholder="100000000000000"
                  />
                </div>
              </div>
              {metaConfigured ? (
                <div className={styles.bodyActionsSplit}>
                  <fetcher.Form method="POST">
                    <input type="hidden" name="intent" value="clearMetaConfig" />
                    <s-button type="submit" variant="tertiary" tone="critical">
                      {t("toneSources.meta.disconnect", {
                        defaultValue: "Disconnect",
                      })}
                    </s-button>
                  </fetcher.Form>
                  <div className={styles.bodyActionsRight}>
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="refreshMeta" />
                      <s-button
                        type="submit"
                        variant="secondary"
                        {...(isRefreshingMeta
                          ? { loading: true, disabled: true }
                          : {})}
                      >
                        {t("toneSources.actions.refreshNow", {
                          defaultValue: "Refresh now",
                        })}
                      </s-button>
                    </fetcher.Form>
                    <s-button
                      type="submit"
                      variant="primary"
                      {...(isSavingMeta ? { loading: true, disabled: true } : {})}
                    >
                      {t("toneSources.meta.save", {
                        defaultValue: "Save Meta config",
                      })}
                    </s-button>
                  </div>
                </div>
              ) : (
                <div className={styles.bodyActions}>
                  <s-button
                    type="submit"
                    variant="primary"
                    {...(isSavingMeta ? { loading: true, disabled: true } : {})}
                  >
                    {t("toneSources.meta.save", {
                      defaultValue: "Save Meta config",
                    })}
                  </s-button>
                </div>
              )}
            </fetcher.Form>
          </SourceItem>

          {/* ───── MONDAY ───── */}
          <SourceItem
            id="monday"
            expanded={expandedRow === "monday"}
            onToggle={toggleRow}
            iconClass={`${styles.sourceIcon} ${styles.sourceIconMonday}`}
            icon={<MondayLogo basePath={basePath} size={20} />}
            name={t("toneSources.rows.mondayName", { defaultValue: "Monday.com" })}
            detail={
              mondayConfigured && mondaySource?.sampleCount
                ? formatDetail(mondaySource.detail, mondaySource.lastSampledAt)
                : t("toneSources.rows.mondayDetailIdle", {
                    defaultValue:
                      "Add API key + board IDs to sample internal copy.",
                  })
            }
            statusKey={mondayConfigured ? "connected" : "notConfigured"}
            statusText={
              mondayConfigured
                ? t("toneSources.status.connected", { defaultValue: "Connected" })
                : t("toneSources.status.notConfigured", {
                    defaultValue: "Not configured",
                  })
            }
          >
            <p className={styles.bodyHelp}>
              {t("toneSources.monday.description", {
                defaultValue:
                  "Generate an API key in Monday.com (Profile → Admin → API). Paste your board IDs comma-separated.",
              })}
            </p>
            <fetcher.Form method="POST">
              <input type="hidden" name="intent" value="saveMondayConfig" />
              <div className={styles.fieldRow2}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>
                    {t("toneSources.monday.apiKey", { defaultValue: "API key" })}
                  </label>
                  <input
                    className={styles.fieldInput}
                    type="password"
                    name="mondayApiKey"
                    value={mondayApiKeyInput}
                    onChange={(e) => setMondayApiKeyInput(e.target.value)}
                    placeholder={
                      mondayConfigured
                        ? t("toneSources.monday.apiKeyPlaceholderConfigured", {
                            defaultValue:
                              "(stored — leave blank to keep current)",
                          })
                        : "eyJ0eX..."
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>
                    {t("toneSources.monday.boardIds", {
                      defaultValue: "Board IDs (comma-separated)",
                    })}
                  </label>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    name="mondayBoardIds"
                    value={mondayBoardIdsInput}
                    onChange={(e) => setMondayBoardIdsInput(e.target.value)}
                    placeholder="123456789, 987654321"
                  />
                </div>
              </div>
              {mondayConfigured ? (
                <div className={styles.bodyActionsSplit}>
                  <fetcher.Form method="POST">
                    <input type="hidden" name="intent" value="clearMondayConfig" />
                    <s-button type="submit" variant="tertiary" tone="critical">
                      {t("toneSources.monday.disconnect", {
                        defaultValue: "Disconnect",
                      })}
                    </s-button>
                  </fetcher.Form>
                  <div className={styles.bodyActionsRight}>
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="refreshMonday" />
                      <s-button
                        type="submit"
                        variant="secondary"
                        {...(isRefreshingMonday
                          ? { loading: true, disabled: true }
                          : {})}
                      >
                        {t("toneSources.actions.refreshNow", {
                          defaultValue: "Refresh now",
                        })}
                      </s-button>
                    </fetcher.Form>
                    <s-button
                      type="submit"
                      variant="primary"
                      {...(isSavingMonday ? { loading: true, disabled: true } : {})}
                    >
                      {t("toneSources.monday.save", {
                        defaultValue: "Save Monday.com config",
                      })}
                    </s-button>
                  </div>
                </div>
              ) : (
                <div className={styles.bodyActions}>
                  <s-button
                    type="submit"
                    variant="primary"
                    {...(isSavingMonday ? { loading: true, disabled: true } : {})}
                  >
                    {t("toneSources.monday.save", {
                      defaultValue: "Save Monday.com config",
                    })}
                  </s-button>
                </div>
              )}
            </fetcher.Form>
          </SourceItem>

          {/* ───── MANUAL REFERENCES (merged file + URL) ───── */}
          <SourceItem
            id="manual"
            expanded={expandedRow === "manual"}
            onToggle={toggleRow}
            iconClass={`${styles.sourceIcon} ${styles.sourceIconUpload}`}
            icon={<ManualUploadIcon size={16} />}
            name={t("toneSources.rows.manualName", {
              defaultValue: "Manual references",
            })}
            detail={
              manualReferences.length > 0
                ? manualReferences
                    .slice(0, 4)
                    .map((r) => r.filename ?? r.sourceUrl ?? "(ref)")
                    .join(" · ")
                : t("toneSources.rows.manualDetailIdle", {
                    defaultValue:
                      "Brandbooks, manifestos, or any reference document.",
                  })
            }
            statusKey={manualReferences.length > 0 ? "connected" : "notConfigured"}
            statusText={
              manualReferences.length > 0
                ? t("toneSources.rows.manualCount", {
                    count: manualReferences.length,
                    defaultValue:
                      manualReferences.length === 1
                        ? "1 reference"
                        : `${manualReferences.length} references`,
                  })
                : t("toneSources.status.noRefs", {
                    defaultValue: "No references yet",
                  })
            }
          >
            <div className={styles.uploadDropzone}>
              <div className={styles.uploadDropzoneCenter}>
                <div className={styles.uploadDropzoneTitle}>
                  {t("toneSources.upload.title", {
                    defaultValue:
                      "Add a brandbook, manifesto, or any reference",
                  })}
                </div>
                <div className={styles.uploadDropzoneSub}>
                  {t("toneSources.upload.sub", {
                    defaultValue:
                      "PDF, DOCX, TXT, MD up to 10MB · or paste a URL",
                  })}
                </div>
              </div>
              <div className={styles.uploadDropzoneRow}>
                <uploadFetcher.Form
                  method="POST"
                  style={{ display: "flex", gap: 8, flex: 1 }}
                >
                  <input type="hidden" name="intent" value="addUrl" />
                  <input
                    className={styles.uploadDropzoneInput}
                    type="text"
                    name="url"
                    placeholder="https://..."
                  />
                  <s-button
                    type="submit"
                    variant="secondary"
                    {...(isUploading ? { loading: true, disabled: true } : {})}
                  >
                    {t("toneSources.upload.fetchUrl", {
                      defaultValue: "Fetch URL",
                    })}
                  </s-button>
                </uploadFetcher.Form>
                <span className={styles.uploadDropzoneOr}>
                  {t("toneSources.upload.or", { defaultValue: "or" })}
                </span>
                <uploadFetcher.Form
                  method="POST"
                  encType="multipart/form-data"
                  style={{ display: "flex", gap: 8 }}
                >
                  <input type="hidden" name="intent" value="uploadFile" />
                  <input
                    type="file"
                    name="file"
                    accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                    onChange={(e) => {
                      if (e.currentTarget.files?.length) {
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    disabled={isUploading}
                  />
                </uploadFetcher.Form>
              </div>
            </div>

            {manualReferences.length > 0 && (
              <div className={styles.referenceList}>
                {manualReferences.map((r) => (
                  <div key={r.id} className={styles.referenceRow}>
                    <span className={styles.referenceRowIcon}>
                      {r.sourceType === "manual_url" ? <LinkIcon /> : <FileIcon />}
                    </span>
                    <span className={styles.referenceRowName}>
                      {r.sourceType === "manual_upload"
                        ? (r.filename ?? "(file)")
                        : (r.sourceUrl ?? "(url)")}
                    </span>
                    <span className={styles.referenceRowMeta}>
                      {r.charCount} chars
                    </span>
                    <span className={styles.referenceRowMeta}>
                      {formatRelative(r.capturedAt)}
                    </span>
                    {r.sourceType === "manual_upload" ? (
                      <fetcher.Form method="POST">
                        <input type="hidden" name="intent" value="reExtract" />
                        <input
                          type="hidden"
                          name="sourceId"
                          value={r.sourceId}
                        />
                        <s-button type="submit" variant="tertiary">
                          {t("toneSources.actions.reExtract", {
                            defaultValue: "Re-extract",
                          })}
                        </s-button>
                      </fetcher.Form>
                    ) : (
                      <span />
                    )}
                    <fetcher.Form method="POST">
                      <input
                        type="hidden"
                        name="intent"
                        value="deleteReference"
                      />
                      <input type="hidden" name="sourceId" value={r.sourceId} />
                      <s-button type="submit" variant="tertiary">
                        {t("toneSources.actions.delete", {
                          defaultValue: "Delete",
                        })}
                      </s-button>
                    </fetcher.Form>
                  </div>
                ))}
              </div>
            )}
            {manualSampleCount === 0 && (
              <p className={styles.bodyHelp} style={{ marginTop: 12 }}>
                {t("toneSources.manual.emptyHint", {
                  defaultValue:
                    "No references yet. Drop a file or paste a URL above to add one.",
                })}
              </p>
            )}
          </SourceItem>
        </div>

        <div className={styles.legacyToneRow}>
          <span className={styles.legacyToneTitle}>
            {t("toneSources.manualOverride.title", {
              defaultValue: "Manual override (always wins)",
            })}
          </span>
          <span className={styles.legacyToneBody}>
            {manualToneOverride
              ? `"${manualToneOverride}"`
              : t("toneSources.manualOverride.empty", {
                  defaultValue:
                    "No manual tone string set. Add one on Brand settings to override the inferred tone.",
                })}
          </span>
          <Link
            to="/app/settings/brand"
            style={{ color: "#005bd3", textDecoration: "none", fontSize: 12 }}
          >
            {t("toneSources.manualOverride.editLink", {
              defaultValue: "Edit on Brand settings →",
            })}
          </Link>
        </div>
      </s-section>

      <s-section
        heading={t("toneSources.pending.heading", {
          count: pendingHypotheses.length,
          defaultValue:
            pendingHypotheses.length === 1
              ? "Pending review · 1 trait"
              : `Pending review · ${pendingHypotheses.length} traits`,
        })}
      >
        {pendingHypotheses.length === 0 ? (
          <div className={styles.emptyHint}>
            {t("toneSources.pending.empty", {
              defaultValue:
                "No hypotheses pending. Run a refresh to sample your sources and infer traits.",
            })}
          </div>
        ) : (
          pendingHypotheses.map((h) => {
            const isAccepting =
              fetcher.state !== "idle" &&
              fetcher.formData?.get("intent") === "acceptHypothesis" &&
              fetcher.formData?.get("hypothesisId") === h.id;
            const isRejecting =
              fetcher.state !== "idle" &&
              fetcher.formData?.get("intent") === "rejectHypothesis" &&
              fetcher.formData?.get("hypothesisId") === h.id;

            return (
              <div className={styles.hypothesisCard} key={h.id}>
                <div className={styles.hypothesisHeader}>
                  <span className={categoryPillClass(h.category)}>
                    {h.category}
                  </span>
                  <div className={styles.confidenceBar}>
                    <div
                      className={styles.confidenceFill}
                      style={{ width: `${Math.round(h.confidence * 100)}%` }}
                    ></div>
                  </div>
                  <span className={styles.confidenceLabel}>
                    {h.confidence.toFixed(2)}
                  </span>
                </div>
                <p className={styles.hypothesisStatement}>{h.statement}</p>
                {h.evidence.length > 0 && (
                  <div className={styles.evidenceList}>
                    {h.evidence.slice(0, 3).map((e, i) => (
                      <div className={styles.evidenceItem} key={i}>
                        <span className={styles.evidenceSource}>
                          {e.sourceType}
                        </span>
                        &ldquo;{e.snippet}&rdquo;
                      </div>
                    ))}
                  </div>
                )}
                <div className={styles.hypothesisActions}>
                  <fetcher.Form method="POST">
                    <input
                      type="hidden"
                      name="intent"
                      value="rejectHypothesis"
                    />
                    <input type="hidden" name="hypothesisId" value={h.id} />
                    <s-button
                      type="submit"
                      variant="tertiary"
                      {...(isRejecting ? { loading: true, disabled: true } : {})}
                    >
                      {t("toneSources.actions.reject", {
                        defaultValue: "Reject",
                      })}
                    </s-button>
                  </fetcher.Form>
                  <fetcher.Form method="POST">
                    <input
                      type="hidden"
                      name="intent"
                      value="acceptHypothesis"
                    />
                    <input type="hidden" name="hypothesisId" value={h.id} />
                    <s-button
                      type="submit"
                      variant="primary"
                      {...(isAccepting ? { loading: true, disabled: true } : {})}
                    >
                      {t("toneSources.actions.accept", {
                        defaultValue: "Accept",
                      })}
                    </s-button>
                  </fetcher.Form>
                </div>
              </div>
            );
          })
        )}
      </s-section>

      <s-section
        heading={t("toneSources.batches.heading", {
          defaultValue: "Past batches",
        })}
      >
        {batches.length === 0 ? (
          <div className={styles.emptyHint}>
            {t("toneSources.batches.empty", {
              defaultValue: "No batches yet.",
            })}
          </div>
        ) : (
          <div className={styles.batchTable}>
            {batches.map((b) => (
              <div className={styles.batchRow} key={b.batchId}>
                <div>
                  <div className={styles.batchSource}>{b.batchId}</div>
                  <div className={styles.batchDate}>
                    {formatRelative(b.createdAt)} ·{" "}
                    {b.sourceTypes.length > 0
                      ? b.sourceTypes.join(", ")
                      : "no source"}
                  </div>
                </div>
                <span
                  className={`${styles.statusPill} ${styles.statusPillNotConfigured}`}
                >
                  {b.totalSamples} samples
                </span>
                <span
                  className={`${styles.statusPill} ${styles.statusPillNotConfigured}`}
                >
                  {b.pendingCount} pending
                </span>
                <span
                  className={`${styles.statusPill} ${styles.statusPillConnected}`}
                >
                  {b.acceptedCount} accepted
                </span>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

/* ============================================================
 * SourceItem — accordion row primitive
 * ============================================================ */
type SourceItemProps = {
  id: DisplayRowId;
  expanded: boolean;
  onToggle: (id: DisplayRowId) => void;
  iconClass: string;
  icon: React.ReactNode;
  name: string;
  detail: string;
  statusKey: "connected" | "notConfigured" | "error";
  statusText: string;
  children: React.ReactNode;
};

function SourceItem({
  id,
  expanded,
  onToggle,
  iconClass,
  icon,
  name,
  detail,
  statusKey,
  statusText,
  children,
}: SourceItemProps) {
  const wrapperClass = expanded
    ? `${styles.sourceItem} ${styles.sourceItemExpanded}`
    : styles.sourceItem;
  const statusClass =
    statusKey === "connected"
      ? `${styles.sourceStatus} ${styles.sourceStatusConnected}`
      : statusKey === "error"
        ? `${styles.sourceStatus} ${styles.sourceStatusError}`
        : styles.sourceStatus;
  const chevronClass = expanded
    ? `${styles.chevron} ${styles.chevronExpanded}`
    : styles.chevron;

  return (
    <div className={wrapperClass}>
      <button
        type="button"
        className={styles.sourceRow}
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
      >
        <div className={iconClass}>{icon}</div>
        <div className={styles.sourceMeta}>
          <div className={styles.sourceName}>{name}</div>
          <div className={styles.sourceDetail}>{detail}</div>
        </div>
        <span className={statusClass}>
          <span className={styles.sourceStatusDot} />
          {statusText}
        </span>
        <div className={chevronClass}>
          <ChevronIcon />
        </div>
      </button>
      {expanded && <div className={styles.sourceBody}>{children}</div>}
    </div>
  );
}

function formatDetail(detail: string | null, lastSampledAt: string | null): string {
  const base = detail ?? "";
  const rel = lastSampledAt ? formatRelative(lastSampledAt) : null;
  return rel ? `${base} · sampled ${rel}` : base;
}

function formatSampledRelative(iso: string | null): string {
  const rel = iso ? formatRelative(iso) : null;
  return rel ? `· sampled ${rel}` : "";
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
