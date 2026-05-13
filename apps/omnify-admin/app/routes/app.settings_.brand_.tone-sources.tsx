import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
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
  fetchMondaySchema,
  getMondayConfig,
  ingestMonday,
  saveMondayConfig,
  type MondayBoardSchema,
  type MondayFilterRule,
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
  sources: SerializedSource[];
  pendingHypotheses: SerializedHypothesis[];
  batches: SerializedBatch[];
  manualReferences: SerializedManualReference[];
  mondayConfigured: boolean;
  mondayBoardIds: string[];
  mondayFilters: MondayFilterRule[];
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

  const [sources, pending, batches, manualRefs, mondayConfig, metaConfig] =
    await Promise.all([
      listSourceSummaries(shop),
      listPendingHypotheses(shop, { minConfidence: MIN_CONFIDENCE }),
      listRecentBatches(shop, 5),
      listManualReferences(shop),
      getMondayConfig(shop),
      getMetaConfig(shop),
    ]);

  return {
    shop,
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
    mondayFilters: mondayConfig?.filters ?? [],
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
    if (file.size > 30 * 1024 * 1024) {
      return { success: false, intent, error: "File too large (>30MB)." };
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
    const existingConfig = await getMondayConfig(shop);
    // API key is optional on re-save when one is already stored (lets the
    // merchant tweak board IDs without re-typing the key).
    const effectiveApiKey =
      apiKey && apiKey.trim().length > 0 ? apiKey : existingConfig?.apiKey;
    if (!effectiveApiKey || !boardIdsRaw) {
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
      await saveMondayConfig({
        shop,
        apiKey: effectiveApiKey,
        boardIds,
        // Preserve existing filters when API key / boards change.
        filters: existingConfig?.filters ?? [],
      });
      return { success: true, intent };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save Monday.com config.";
      return { success: false, intent, error: message };
    }
  }

  if (intent === "saveMondayFilters") {
    const filtersRaw = formData.get("mondayFiltersJson") as string | null;
    const config = await getMondayConfig(shop);
    if (!config) {
      return {
        success: false,
        intent,
        error: "Connect Monday.com first.",
      };
    }
    let filters: MondayFilterRule[] = [];
    if (filtersRaw) {
      try {
        const parsed = JSON.parse(filtersRaw);
        if (!Array.isArray(parsed)) throw new Error("Filters must be an array");
        filters = parsed.filter(
          (r): r is MondayFilterRule =>
            typeof r === "object" &&
            r !== null &&
            typeof r.column === "string" &&
            typeof r.op === "string" &&
            Array.isArray(r.values),
        );
      } catch (err) {
        return {
          success: false,
          intent,
          error: err instanceof Error ? err.message : "Invalid filter payload.",
        };
      }
    }
    try {
      await saveMondayConfig({
        shop,
        apiKey: config.apiKey,
        boardIds: config.boardIds,
        filters,
      });
      return { success: true, intent, ruleCount: filters.length };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save Monday.com filters.";
      return { success: false, intent, error: message };
    }
  }

  if (intent === "fetchMondaySchema") {
    const config = await getMondayConfig(shop);
    if (!config) {
      return {
        success: false,
        intent,
        error: "Connect Monday.com first.",
      };
    }
    const result = await fetchMondaySchema({
      apiKey: config.apiKey,
      boardIds: config.boardIds,
    });
    if ("error" in result) {
      return { success: false, intent, error: result.error };
    }
    return { success: true, intent, schema: result };
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
    sources,
    pendingHypotheses,
    batches,
    manualReferences,
    mondayConfigured,
    mondayBoardIds,
    mondayFilters,
    metaConfigured,
    metaIgBusinessId,
    metaFbPageId,
    basePath,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shopify = useAppBridge();
  const { t } = useTranslation("brand-settings");

  // ── single-expand-at-a-time state ──────────────────────────
  const [expandedRow, setExpandedRow] = useState<DisplayRowId | null>("shopify");

  // ── form input state ───────────────────────────────────────
  const [mondayApiKeyInput, setMondayApiKeyInput] = useState("");
  const [mondayBoardIdsInput, setMondayBoardIdsInput] = useState(
    mondayBoardIds.join(", "),
  );
  // Monday filter UI — 4 phases: connect → columns → rules → preview.
  // Returning users (configured + has filters) land on preview; otherwise connect.
  const [mondayPhase, setMondayPhase] = useState<
    "connect" | "columns" | "rules" | "preview"
  >(mondayConfigured && mondayFilters.length > 0 ? "preview" : "connect");
  const [mondaySchema, setMondaySchema] = useState<MondayBoardSchema[] | null>(
    null,
  );
  const [mondayRules, setMondayRules] = useState<MondayFilterRule[]>(
    mondayFilters,
  );
  const [metaTokenInput, setMetaTokenInput] = useState("");
  const [metaIgInput, setMetaIgInput] = useState(metaIgBusinessId ?? "");
  const [metaFbInput, setMetaFbInput] = useState(metaFbPageId ?? "");
  // Meta in-block phased flow (parity with the Monday filter UI).
  // Tabs: "what" (intro + trust strip) → "generate" (token steps) → "paste" (form).
  const [metaPhase, setMetaPhase] = useState<
    "what" | "generate" | "paste"
  >("what");

  const isRefreshingShopify =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "refreshShopify";
  const isRefreshingMonday =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "refreshMonday";
  const isSavingMonday =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "saveMondayConfig";
  const isFetchingSchema =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "fetchMondaySchema";
  const isSavingFilters =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "saveMondayFilters";
  const isRefreshingMeta =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "refreshMeta";
  const isSavingMeta =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "saveMetaConfig";
  // Decouple per-form loading state so uploading a file doesn't spin the
  // Fetch URL button (and vice versa). One fetcher backs both forms, but
  // each button only spins when its own intent is in flight.
  const isFetchingUrl =
    uploadFetcher.state !== "idle" &&
    uploadFetcher.formData?.get("intent") === "addUrl";
  const isUploadingFile =
    uploadFetcher.state !== "idle" &&
    uploadFetcher.formData?.get("intent") === "uploadFile";

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

  // Monday-specific: capture the schema response and advance to phase B
  // (Choose columns) automatically. Also reset rule selections if the user
  // re-connects with new board IDs.
  useEffect(() => {
    if (!fetcher.data) return;
    if (
      fetcher.data.success &&
      "intent" in fetcher.data &&
      fetcher.data.intent === "fetchMondaySchema" &&
      "schema" in fetcher.data
    ) {
      setMondaySchema(fetcher.data.schema as MondayBoardSchema[]);
      setMondayPhase("columns");
    }
    if (
      fetcher.data.success &&
      "intent" in fetcher.data &&
      fetcher.data.intent === "saveMondayFilters"
    ) {
      // Filters saved — show preview state as the resting view.
      setMondayPhase("preview");
    }
  }, [fetcher.data]);

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
    // Clear the native file input after a file-upload action completes
    // (success OR rejection) so the merchant can try another file without
    // the rejected filename lingering in the input.
    const data = uploadFetcher.data;
    if (
      data &&
      "intent" in data &&
      data.intent === "uploadFile" &&
      fileInputRef.current
    ) {
      fileInputRef.current.value = "";
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

  const metaSampleCount =
    (igSource?.sampleCount ?? 0) + (fbSource?.sampleCount ?? 0);
  const metaLastSampled =
    [igSource?.lastSampledAt, fbSource?.lastSampledAt]
      .filter((x): x is string => Boolean(x))
      .sort()
      .pop() ?? null;

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
            {metaConfigured ? (
              <MetaEditView
                fetcher={fetcher}
                metaIgInput={metaIgInput}
                setMetaIgInput={setMetaIgInput}
                metaFbInput={metaFbInput}
                setMetaFbInput={setMetaFbInput}
                metaTokenInput={metaTokenInput}
                setMetaTokenInput={setMetaTokenInput}
                isSavingMeta={isSavingMeta}
                isRefreshingMeta={isRefreshingMeta}
              />
            ) : (
              <MetaTabbedFlow
                phase={metaPhase}
                setPhase={setMetaPhase}
                fetcher={fetcher}
                metaIgInput={metaIgInput}
                setMetaIgInput={setMetaIgInput}
                metaFbInput={metaFbInput}
                setMetaFbInput={setMetaFbInput}
                metaTokenInput={metaTokenInput}
                setMetaTokenInput={setMetaTokenInput}
                isSavingMeta={isSavingMeta}
              />
            )}
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
            <MondayTabbedFlow
              phase={mondayPhase}
              setPhase={setMondayPhase}
              fetcher={fetcher}
              mondayConfigured={mondayConfigured}
              mondayApiKeyInput={mondayApiKeyInput}
              setMondayApiKeyInput={setMondayApiKeyInput}
              mondayBoardIdsInput={mondayBoardIdsInput}
              setMondayBoardIdsInput={setMondayBoardIdsInput}
              mondaySchema={mondaySchema}
              mondayRules={mondayRules}
              setMondayRules={setMondayRules}
              isSavingMonday={isSavingMonday}
              isRefreshingMonday={isRefreshingMonday}
              isFetchingSchema={isFetchingSchema}
              isSavingFilters={isSavingFilters}
            />
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
            {/* Hidden file input — triggered by the Polaris "Choose file"
                button below. Replaces the native browser file picker so
                the i18n label stays ours (no "Escolher arquivo" leaks). */}
            <uploadFetcher.Form
              method="POST"
              encType="multipart/form-data"
              id="manual-upload-form"
              style={{ display: "none" }}
            >
              <input type="hidden" name="intent" value="uploadFile" />
              <input
                ref={fileInputRef}
                type="file"
                name="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                onChange={(e) => {
                  const input = e.currentTarget;
                  if (input.files?.length) {
                    input.form?.requestSubmit();
                  }
                }}
                disabled={isUploadingFile}
              />
            </uploadFetcher.Form>

            {/* Upload progress strip — only during a file upload */}
            {isUploadingFile && (
              <div className={styles.uploadStrip}>
                <div className={styles.uploadStripIcon}>
                  <FileIcon />
                </div>
                <div>
                  <div className={styles.uploadStripName}>
                    {(uploadFetcher.formData?.get("file") as File | null)
                      ?.name ??
                      t("toneSources.upload.uploadingFallbackName", {
                        defaultValue: "Uploading…",
                      })}
                  </div>
                  <div className={styles.uploadStripStatus}>
                    {t("toneSources.upload.extractingStatus", {
                      defaultValue: "Extracting text via Claude…",
                    })}
                  </div>
                  <div className={styles.uploadStripProgress} />
                </div>
              </div>
            )}

            {/* Per-form error banner — only for the upload fetcher */}
            {uploadFetcher.data &&
              !uploadFetcher.data.success &&
              "error" in uploadFetcher.data &&
              uploadFetcher.data.error && (
                <div className={styles.errBanner}>
                  <span aria-hidden="true">⚠</span>
                  <div>
                    <strong>
                      {t("toneSources.upload.failedLabel", {
                        defaultValue: "Upload rejected.",
                      })}
                    </strong>{" "}
                    {uploadFetcher.data.error}
                  </div>
                </div>
              )}

            {/* Reference list — top of the body when refs exist */}
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

            {/* Dropzone — visual emphasis when empty, compact when has refs */}
            <div
              className={`${styles.dropzone}${manualReferences.length > 0 ? ` ${styles.dropzoneCompact}` : ""}${isUploadingFile ? ` ${styles.dropzoneDisabled}` : ""}`}
            >
              {manualReferences.length === 0 && (
                <div className={styles.dropzoneIcon} aria-hidden="true">
                  <s-icon type="upload" tone="neutral" />
                </div>
              )}
              <div className={styles.dropzoneTitle}>
                {manualReferences.length === 0
                  ? t("toneSources.upload.title", {
                      defaultValue:
                        "Drop a brandbook, manifesto, or any reference",
                    })
                  : t("toneSources.upload.addAnother", {
                      defaultValue: "Add another reference",
                    })}
              </div>
              <div className={styles.dropzoneSub}>
                {t("toneSources.upload.sub", {
                  defaultValue:
                    "PDF, DOCX, TXT, MD up to 30MB · click below or drag a file here",
                })}
              </div>
              <div className={styles.dropzoneButtons}>
                <s-button
                  variant={manualReferences.length === 0 ? "primary" : "secondary"}
                  onClick={() => fileInputRef.current?.click()}
                  {...(isUploadingFile ? { loading: true, disabled: true } : {})}
                >
                  {t("toneSources.upload.chooseFile", {
                    defaultValue: "Choose file",
                  })}
                </s-button>
              </div>
            </div>

            {/* URL row — separate sibling intake method */}
            <uploadFetcher.Form method="POST" className={styles.urlRow}>
              <input type="hidden" name="intent" value="addUrl" />
              <input
                className={styles.urlRowInput}
                type="text"
                name="url"
                placeholder={t("toneSources.upload.urlPlaceholder", {
                  defaultValue:
                    "…or paste a URL (https://…) to fetch reference copy from a web page",
                })}
              />
              <s-button
                type="submit"
                variant="secondary"
                {...(isFetchingUrl ? { loading: true, disabled: true } : {})}
              >
                {t("toneSources.upload.fetchUrl", {
                  defaultValue: "Fetch URL",
                })}
              </s-button>
            </uploadFetcher.Form>
          </SourceItem>
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

/* ============================================================
 * Meta in-block tabbed flow (parity with Monday filter UI)
 * 3 tabs: What we sample · Generate token · Paste & connect
 * ============================================================ */
type MetaPhase = "what" | "generate" | "paste";
type MetaFetcher = ReturnType<typeof useFetcher<typeof action>>;

function MetaTabbedFlow({
  phase,
  setPhase,
  fetcher,
  metaIgInput,
  setMetaIgInput,
  metaFbInput,
  setMetaFbInput,
  metaTokenInput,
  setMetaTokenInput,
  isSavingMeta,
}: {
  phase: MetaPhase;
  setPhase: (p: MetaPhase) => void;
  fetcher: MetaFetcher;
  metaIgInput: string;
  setMetaIgInput: (v: string) => void;
  metaFbInput: string;
  setMetaFbInput: (v: string) => void;
  metaTokenInput: string;
  setMetaTokenInput: (v: string) => void;
  isSavingMeta: boolean;
}) {
  const { t } = useTranslation("brand-settings");
  return (
    <>
      <div className={styles.phaseTabs}>
        <button
          type="button"
          className={`${styles.phaseTab}${phase === "what" ? ` ${styles.phaseTabActive}` : ` ${styles.phaseTabDone}`}`}
          onClick={() => setPhase("what")}
        >
          {t("toneSources.metaPhases.what", {
            defaultValue: "A. What we sample",
          })}
        </button>
        <button
          type="button"
          className={`${styles.phaseTab}${phase === "generate" ? ` ${styles.phaseTabActive}` : phase === "paste" ? ` ${styles.phaseTabDone}` : ""}`}
          onClick={() => setPhase("generate")}
        >
          {t("toneSources.metaPhases.generate", {
            defaultValue: "B. Generate token",
          })}
        </button>
        <button
          type="button"
          className={`${styles.phaseTab}${phase === "paste" ? ` ${styles.phaseTabActive}` : ""}`}
          onClick={() => setPhase("paste")}
        >
          {t("toneSources.metaPhases.paste", {
            defaultValue: "C. Paste & connect",
          })}
        </button>
      </div>

      {phase === "what" && (
        <>
          <p className={styles.bodyHelp}>
            {t("toneSources.meta.whatIntro", {
              defaultValue:
                "Every Monday we sample your most recent Instagram & Facebook posts (captions plus any text rendered inside images) and pass them to the tone-of-voice inference engine alongside Shopify and Monday.com sources.",
            })}
          </p>
          <div className={styles.metaTrust}>
            <div className={styles.metaTrustItem}>
              <span className={styles.metaTrustIcon}>✓</span>
              {t("toneSources.meta.trust1", {
                defaultValue:
                  "Read-only access to posts on the IG/FB accounts you choose.",
              })}
            </div>
            <div className={styles.metaTrustItem}>
              <span className={styles.metaTrustIcon}>✓</span>
              {t("toneSources.meta.trust2", {
                defaultValue:
                  "Captions and image-text only. No DMs, ads, audience data, or insights.",
              })}
            </div>
            <div className={styles.metaTrustItem}>
              <span className={styles.metaTrustIcon}>✓</span>
              {t("toneSources.meta.trust3", {
                defaultValue:
                  "You generate the token in Meta Business Suite. We never see your Facebook password.",
              })}
            </div>
            <div className={styles.metaTrustItem}>
              <span className={styles.metaTrustIcon}>✓</span>
              {t("toneSources.meta.trust4", {
                defaultValue:
                  "Token is encrypted at rest. Disconnect at any time.",
              })}
            </div>
          </div>
          <p className={styles.bodyHelp} style={{ marginBottom: 0 }}>
            {t("toneSources.meta.whatOutro", {
              defaultValue:
                "The next tab walks you through generating the token in Meta Business Suite — about 2 minutes.",
            })}
          </p>
          <div className={styles.bodyActions}>
            <s-button variant="primary" onClick={() => setPhase("generate")}>
              {t("common:button.continue", { defaultValue: "Continue" })}
            </s-button>
          </div>
        </>
      )}

      {phase === "generate" && (
        <>
          <p className={styles.bodyHelp}>
            {t("toneSources.meta.generateIntro", {
              defaultValue:
                "Open Meta Business Suite in a new tab, then follow these 3 steps. We'll wait here while you do.",
            })}
          </p>
          <ol className={styles.metaSteps}>
            <li>
              <strong>
                {t("toneSources.meta.step1Title", {
                  defaultValue:
                    "business.facebook.com → Settings → Users → System Users.",
                })}
              </strong>
              <div className={styles.metaStepHint}>
                {t("toneSources.meta.step1Hint", {
                  defaultValue:
                    "Don't have a System User yet? Add → name it 'Omnify tone access' → role Admin.",
                })}
              </div>
            </li>
            <li>
              <strong>
                {t("toneSources.meta.step2Title", {
                  defaultValue:
                    "Generate New Token. Choose permissions: pages_read_engagement, instagram_basic, pages_show_list.",
                })}
              </strong>
              <div className={styles.metaStepHint}>
                {t("toneSources.meta.step2Hint", {
                  defaultValue:
                    "Token expiration: select 'Never' for the long-lived flow.",
                })}
              </div>
            </li>
            <li>
              <strong>
                {t("toneSources.meta.step3Title", {
                  defaultValue:
                    "Copy the token shown on screen, then come back here.",
                })}
              </strong>
              <div className={styles.metaStepHint}>
                {t("toneSources.meta.step3Hint", {
                  defaultValue:
                    "You'll also need your IG Business ID and/or FB Page ID — both visible in Settings → Accounts.",
                })}
              </div>
            </li>
          </ol>
          <div className={styles.bodyActionsSplit}>
            <s-button variant="tertiary" onClick={() => setPhase("what")}>
              {t("common:button.back", { defaultValue: "Back" })}
            </s-button>
            <s-button variant="primary" onClick={() => setPhase("paste")}>
              {t("toneSources.meta.haveToken", {
                defaultValue: "I have my token",
              })}
            </s-button>
          </div>
        </>
      )}

      {phase === "paste" && (
        <fetcher.Form method="POST">
          <input type="hidden" name="intent" value="saveMetaConfig" />
          <p className={styles.bodyHelp}>
            {t("toneSources.meta.pasteIntro", {
              defaultValue:
                "Token gets encrypted before being stored. Provide at least one of IG Business ID or FB Page ID.",
            })}
          </p>
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
              placeholder="EAAB..."
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
          <div className={styles.bodyActionsSplit}>
            <s-button
              type="button"
              variant="tertiary"
              onClick={() => setPhase("generate")}
            >
              {t("common:button.back", { defaultValue: "Back" })}
            </s-button>
            <s-button
              type="submit"
              variant="primary"
              {...(isSavingMeta ? { loading: true, disabled: true } : {})}
            >
              {t("toneSources.meta.connectCta", { defaultValue: "Connect" })}
            </s-button>
          </div>
        </fetcher.Form>
      )}
    </>
  );
}

/* Condensed edit view for already-configured Meta merchants. */
function MetaEditView({
  fetcher,
  metaIgInput,
  setMetaIgInput,
  metaFbInput,
  setMetaFbInput,
  metaTokenInput,
  setMetaTokenInput,
  isSavingMeta,
  isRefreshingMeta,
}: {
  fetcher: MetaFetcher;
  metaIgInput: string;
  setMetaIgInput: (v: string) => void;
  metaFbInput: string;
  setMetaFbInput: (v: string) => void;
  metaTokenInput: string;
  setMetaTokenInput: (v: string) => void;
  isSavingMeta: boolean;
  isRefreshingMeta: boolean;
}) {
  const { t } = useTranslation("brand-settings");
  return (
    <fetcher.Form method="POST">
      <input type="hidden" name="intent" value="saveMetaConfig" />
      <p className={styles.bodyHelp}>
        {t("toneSources.meta.connectedHelp", {
          defaultValue:
            "Connected. Token rotates every 60 days — we'll prompt you ahead of expiry.",
        })}
      </p>
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
          placeholder={t("toneSources.meta.tokenPlaceholderConfigured", {
            defaultValue: "(stored — leave blank to keep current)",
          })}
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
              {...(isRefreshingMeta ? { loading: true, disabled: true } : {})}
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
            {t("toneSources.meta.save", { defaultValue: "Save changes" })}
          </s-button>
        </div>
      </div>
    </fetcher.Form>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Monday filter UI — 4 phases (A: connect, B: choose columns, C: filter
// rules, D: preview & save). Rules within a column combine with OR;
// rules across columns combine with AND. Status columns expose discrete
// values from `settings_str`; the synthetic "_group_" column references
// board groups.
// ────────────────────────────────────────────────────────────────────────

type MondayPhase = "connect" | "columns" | "rules" | "preview";
type MondayFetcher = ReturnType<typeof useFetcher<typeof action>>;

function MondayTabbedFlow({
  phase,
  setPhase,
  fetcher,
  mondayConfigured,
  mondayApiKeyInput,
  setMondayApiKeyInput,
  mondayBoardIdsInput,
  setMondayBoardIdsInput,
  mondaySchema,
  mondayRules,
  setMondayRules,
  isSavingMonday,
  isRefreshingMonday,
  isFetchingSchema,
  isSavingFilters,
}: {
  phase: MondayPhase;
  setPhase: (p: MondayPhase) => void;
  fetcher: MondayFetcher;
  mondayConfigured: boolean;
  mondayApiKeyInput: string;
  setMondayApiKeyInput: (v: string) => void;
  mondayBoardIdsInput: string;
  setMondayBoardIdsInput: (v: string) => void;
  mondaySchema: MondayBoardSchema[] | null;
  mondayRules: MondayFilterRule[];
  setMondayRules: (rules: MondayFilterRule[]) => void;
  isSavingMonday: boolean;
  isRefreshingMonday: boolean;
  isFetchingSchema: boolean;
  isSavingFilters: boolean;
}) {
  const { t } = useTranslation("brand-settings");

  // Build the catalog of filterable columns (status + the synthetic group
  // sentinel). Each entry exposes the column id, label and allowed values.
  type FilterableColumn = {
    id: string;
    label: string;
    values: string[];
    boardName?: string;
  };
  const filterableColumns: FilterableColumn[] = [];
  if (mondaySchema) {
    const groupTitles = new Set<string>();
    for (const board of mondaySchema) {
      for (const g of board.groups) {
        if (g.title) groupTitles.add(g.title);
      }
      for (const c of board.columns) {
        if (c.filterable) {
          filterableColumns.push({
            id: c.id,
            label: c.title,
            values: c.values ?? [],
            boardName: board.name,
          });
        }
      }
    }
    if (groupTitles.size > 0) {
      filterableColumns.unshift({
        id: "_group_",
        label: t("toneSources.monday.groupColumnLabel", {
          defaultValue: "Group (board section)",
        }),
        values: Array.from(groupTitles),
      });
    }
  }

  function addRule() {
    const first = filterableColumns[0];
    if (!first) return;
    setMondayRules([
      ...mondayRules,
      { column: first.id, op: "is_one_of", values: [] },
    ]);
  }
  function updateRule(idx: number, patch: Partial<MondayFilterRule>) {
    const next = mondayRules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setMondayRules(next);
  }
  function removeRule(idx: number) {
    setMondayRules(mondayRules.filter((_, i) => i !== idx));
  }
  function toggleRuleValue(idx: number, value: string) {
    const rule = mondayRules[idx];
    if (!rule) return;
    const has = rule.values.includes(value);
    const nextValues = has
      ? rule.values.filter((v) => v !== value)
      : [...rule.values, value];
    updateRule(idx, { values: nextValues });
  }

  const totalItems = mondaySchema?.reduce((sum, b) => sum + b.itemsCount, 0) ?? 0;

  return (
    <>
      <div className={styles.phaseTabs}>
        <button
          type="button"
          className={`${styles.phaseTab}${phase === "connect" ? ` ${styles.phaseTabActive}` : ` ${styles.phaseTabDone}`}`}
          onClick={() => setPhase("connect")}
        >
          {t("toneSources.mondayPhases.connect", {
            defaultValue: "A. Connect",
          })}
        </button>
        <button
          type="button"
          className={`${styles.phaseTab}${phase === "columns" ? ` ${styles.phaseTabActive}` : phase === "rules" || phase === "preview" ? ` ${styles.phaseTabDone}` : ""}`}
          onClick={() => {
            if (mondaySchema) setPhase("columns");
          }}
          disabled={!mondaySchema}
        >
          {t("toneSources.mondayPhases.columns", {
            defaultValue: "B. Choose columns",
          })}
        </button>
        <button
          type="button"
          className={`${styles.phaseTab}${phase === "rules" ? ` ${styles.phaseTabActive}` : phase === "preview" ? ` ${styles.phaseTabDone}` : ""}`}
          onClick={() => {
            if (mondaySchema) setPhase("rules");
          }}
          disabled={!mondaySchema}
        >
          {t("toneSources.mondayPhases.rules", {
            defaultValue: "C. Filter rules",
          })}
        </button>
        <button
          type="button"
          className={`${styles.phaseTab}${phase === "preview" ? ` ${styles.phaseTabActive}` : ""}`}
          onClick={() => {
            if (mondaySchema) setPhase("preview");
          }}
          disabled={!mondaySchema}
        >
          {t("toneSources.mondayPhases.preview", {
            defaultValue: "D. Preview & save",
          })}
        </button>
      </div>

      {phase === "connect" && (
        <fetcher.Form method="POST">
          <input
            type="hidden"
            name="intent"
            value={
              mondayConfigured ? "fetchMondaySchema" : "saveMondayConfig"
            }
          />
          <p className={styles.bodyHelp}>
            {t("toneSources.monday.description", {
              defaultValue:
                "Generate an API key in Monday.com (Profile → Admin → API). Paste your board IDs comma-separated.",
            })}
          </p>
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
                        defaultValue: "(stored — leave blank to keep current)",
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
          <div className={styles.bodyActions}>
            {mondayConfigured && (
              <fetcher.Form method="POST">
                <input
                  type="hidden"
                  name="intent"
                  value="clearMondayConfig"
                />
                <s-button type="submit" variant="tertiary" tone="critical">
                  {t("toneSources.monday.disconnect", {
                    defaultValue: "Disconnect",
                  })}
                </s-button>
              </fetcher.Form>
            )}
            <s-button
              type="submit"
              variant="primary"
              {...(isSavingMonday || isFetchingSchema
                ? { loading: true, disabled: true }
                : {})}
            >
              {mondayConfigured
                ? t("toneSources.monday.fetchSchema", {
                    defaultValue: "Fetch schema",
                  })
                : t("toneSources.monday.connectCta", {
                    defaultValue: "Connect",
                  })}
            </s-button>
          </div>
        </fetcher.Form>
      )}

      {phase === "columns" && mondaySchema && (
        <>
          <p className={styles.bodyHelp}>
            {t("toneSources.monday.columnsIntro", {
              defaultValue:
                "We found these columns on your boards. Status columns expose discrete values you can filter on. Text columns are always included as content sources.",
            })}
          </p>

          <div className={styles.boardSummary}>
            {mondaySchema.map((b) => (
              <div className={styles.boardSummaryRow} key={b.id}>
                <div className={styles.boardName}>{b.name}</div>
                <span className={styles.boardCount}>
                  {t("toneSources.monday.boardStat", {
                    items: b.itemsCount,
                    columns: b.columns.length,
                    groups: b.groups.length,
                    defaultValue: `${b.itemsCount} items · ${b.columns.length} columns · ${b.groups.length} groups`,
                  })}
                </span>
              </div>
            ))}
          </div>

          <div className={styles.columnList}>
            {filterableColumns.length === 0 && (
              <div className={styles.columnRow}>
                <span />
                <div className={styles.columnLeft}>
                  <div className={styles.columnName}>
                    {t("toneSources.monday.noFilterableColumns", {
                      defaultValue:
                        "No filterable columns (status / group) found.",
                    })}
                  </div>
                  <div className={styles.columnType}>
                    {t("toneSources.monday.noFilterableHint", {
                      defaultValue:
                        "Sampling will include every item from these boards.",
                    })}
                  </div>
                </div>
              </div>
            )}
            {filterableColumns.map((col) => (
              <div
                className={`${styles.columnRow} ${styles.columnRowIncluded}`}
                key={col.id}
              >
                <span className={styles.chip + " " + styles.chipSuccess}>
                  ✓
                </span>
                <div className={styles.columnLeft}>
                  <div className={styles.columnName}>{col.label}</div>
                  <div className={styles.columnType}>
                    {col.id === "_group_"
                      ? t("toneSources.monday.builtInGroupHint", {
                          values: col.values.join(", "),
                          defaultValue: `built-in · values: ${col.values.join(", ")}`,
                        })
                      : t("toneSources.monday.statusColumnHint", {
                          values: col.values.join(", "),
                          defaultValue: `status · values: ${col.values.join(", ")}`,
                        })}
                  </div>
                </div>
                <span className={styles.chip}>
                  {t("toneSources.monday.filterableChip", {
                    defaultValue: "filterable",
                  })}
                </span>
              </div>
            ))}
          </div>

          <div className={styles.bodyActionsSplit}>
            <s-button variant="tertiary" onClick={() => setPhase("connect")}>
              {t("common:button.back", { defaultValue: "Back" })}
            </s-button>
            <div className={styles.bodyActionsRight}>
              <s-button
                variant="secondary"
                onClick={() => {
                  setMondayRules([]);
                  setPhase("preview");
                }}
              >
                {t("toneSources.monday.skipFiltering", {
                  defaultValue: "Skip filtering",
                })}
              </s-button>
              <s-button
                variant="primary"
                onClick={() => setPhase("rules")}
                {...(filterableColumns.length === 0
                  ? { disabled: true }
                  : {})}
              >
                {t("common:button.continue", { defaultValue: "Continue" })}
              </s-button>
            </div>
          </div>
        </>
      )}

      {phase === "rules" && mondaySchema && (
        <>
          <p className={styles.bodyHelp}>
            {t("toneSources.monday.rulesIntro", {
              defaultValue:
                "Multiple values inside one rule combine with OR. Multiple rules combine with AND.",
            })}
          </p>

          <div className={styles.filterRuleList}>
            {mondayRules.length === 0 && (
              <div className={styles.bodyHelp}>
                {t("toneSources.monday.noRulesYet", {
                  defaultValue:
                    "No rules yet — add one to filter which items get sampled.",
                })}
              </div>
            )}
            {mondayRules.map((rule, idx) => {
              const col = filterableColumns.find((c) => c.id === rule.column);
              const isNeg = rule.op === "is_not_one_of";
              return (
                <div className={styles.filterRuleRow} key={idx}>
                  <select
                    className={styles.filterRuleSelect}
                    value={rule.column}
                    onChange={(e) =>
                      updateRule(idx, { column: e.currentTarget.value, values: [] })
                    }
                  >
                    {filterableColumns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className={styles.filterRuleSelect}
                    value={rule.op}
                    onChange={(e) =>
                      updateRule(idx, {
                        op: e.currentTarget.value as MondayFilterRule["op"],
                      })
                    }
                  >
                    <option value="is_one_of">
                      {t("toneSources.monday.opIsOneOf", {
                        defaultValue: "is one of",
                      })}
                    </option>
                    <option value="is_not_one_of">
                      {t("toneSources.monday.opIsNotOneOf", {
                        defaultValue: "is not one of",
                      })}
                    </option>
                    <option value="is_empty">
                      {t("toneSources.monday.opIsEmpty", {
                        defaultValue: "is empty",
                      })}
                    </option>
                  </select>
                  <div className={styles.filterRuleValues}>
                    {rule.op === "is_empty" ? (
                      <span className={styles.chip + " " + styles.chipMuted}>
                        {t("toneSources.monday.noValuesNeeded", {
                          defaultValue: "(no values needed)",
                        })}
                      </span>
                    ) : col && col.values.length > 0 ? (
                      col.values.map((v) => {
                        const active = rule.values.includes(v);
                        const chipClass = active
                          ? `${styles.filterValueChip} ${styles.filterValueChipActive}${isNeg ? ` ${styles.filterValueChipNegative}` : ""}`
                          : styles.filterValueChip;
                        return (
                          <span
                            className={chipClass}
                            key={v}
                            onClick={() => toggleRuleValue(idx, v)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleRuleValue(idx, v);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            {v}
                          </span>
                        );
                      })
                    ) : (
                      <span className={styles.chip + " " + styles.chipMuted}>
                        {t("toneSources.monday.noValuesAvailable", {
                          defaultValue: "(no values available)",
                        })}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => removeRule(idx)}
                    aria-label={t("toneSources.monday.removeRule", {
                      defaultValue: "Remove rule",
                    })}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M3 4h10v1H3V4zm1 2h8l-.5 8a1 1 0 0 1-1 .9H5.5a1 1 0 0 1-1-.9L4 6zm2-3h4l.5 1H5.5l.5-1z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          <div className={styles.filterAddRow}>
            <s-button
              variant="secondary"
              onClick={addRule}
              {...(filterableColumns.length === 0 ? { disabled: true } : {})}
            >
              {t("toneSources.monday.addRule", {
                defaultValue: "Add another rule",
              })}
            </s-button>
          </div>

          <div className={styles.bodyActionsSplit}>
            <s-button variant="tertiary" onClick={() => setPhase("columns")}>
              {t("common:button.back", { defaultValue: "Back" })}
            </s-button>
            <s-button variant="primary" onClick={() => setPhase("preview")}>
              {t("toneSources.monday.previewCta", {
                defaultValue: "Preview",
              })}
            </s-button>
          </div>
        </>
      )}

      {phase === "preview" && (
        <fetcher.Form method="POST">
          <input type="hidden" name="intent" value="saveMondayFilters" />
          <input
            type="hidden"
            name="mondayFiltersJson"
            value={JSON.stringify(mondayRules)}
          />

          <div className={styles.previewBlock}>
            <div className={styles.previewSummary}>
              {mondayRules.length === 0
                ? t("toneSources.monday.previewNoRules", {
                    items: totalItems,
                    defaultValue: `No filters — sampling all ${totalItems} items.`,
                  })
                : t("toneSources.monday.previewRuleCount", {
                    count: mondayRules.length,
                    defaultValue: `${mondayRules.length} filter rule${mondayRules.length === 1 ? "" : "s"} — items must satisfy every rule.`,
                  })}
            </div>
            {mondayRules.map((rule, idx) => {
              const col = filterableColumns.find((c) => c.id === rule.column);
              return (
                <div className={styles.previewRuleLine} key={idx}>
                  <code>
                    <strong>{col?.label ?? rule.column}</strong>{" "}
                    {rule.op === "is_one_of"
                      ? t("toneSources.monday.opIsOneOf", {
                          defaultValue: "is one of",
                        })
                      : rule.op === "is_not_one_of"
                        ? t("toneSources.monday.opIsNotOneOf", {
                            defaultValue: "is not one of",
                          })
                        : t("toneSources.monday.opIsEmpty", {
                            defaultValue: "is empty",
                          })}{" "}
                    {rule.op !== "is_empty" && rule.values.join(", ")}
                  </code>
                </div>
              );
            })}
          </div>

          <div className={styles.bodyActionsSplit}>
            <s-button
              type="button"
              variant="tertiary"
              onClick={() => setPhase("rules")}
            >
              {t("toneSources.monday.editRules", {
                defaultValue: "Edit rules",
              })}
            </s-button>
            <div className={styles.bodyActionsRight}>
              <s-button
                type="submit"
                variant="secondary"
                {...(isSavingFilters ? { loading: true, disabled: true } : {})}
              >
                {t("toneSources.monday.saveFilters", {
                  defaultValue: "Save filters",
                })}
              </s-button>
              <fetcher.Form
                method="POST"
                style={{ display: "inline-flex" }}
              >
                <input type="hidden" name="intent" value="refreshMonday" />
                <s-button
                  type="submit"
                  variant="primary"
                  {...(isRefreshingMonday
                    ? { loading: true, disabled: true }
                    : {})}
                >
                  {t("toneSources.monday.saveAndRefresh", {
                    defaultValue: "Refresh now",
                  })}
                </s-button>
              </fetcher.Form>
            </div>
          </div>
        </fetcher.Form>
      )}
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
