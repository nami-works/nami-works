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
import styles from "./app.brand-settings_.tone-sources/styles.module.css";

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
    await persistManualSource({
      shop,
      batchId,
      sourceType: "manual_upload",
      sourceId: `upload_${Date.now()}_${file.name}`,
      sourceUrl: null,
      rawText: extracted.text,
      metaJson: {
        filename: file.name,
        mediaType: extracted.mediaType,
        sizeBytes: file.size,
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
      filename: file.name,
      chars: extracted.text.length,
      inferred,
      ...(inferenceError ? { inferenceError } : {}),
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

const SOURCE_DISPLAY: Record<
  ToneSourceType,
  { name: string; iconClass: string; iconLetter: string; defaultDetail: string }
> = {
  shopify_blog: {
    name: "Shopify blog posts",
    iconClass: styles.sourceIcon,
    iconLetter: "S",
    defaultDetail: "Ready to sample your existing blog articles.",
  },
  meta_ig: {
    name: "Instagram",
    iconClass: `${styles.sourceIcon} ${styles.sourceIconMeta}`,
    iconLetter: "IG",
    defaultDetail: "Connect to pull captions + image text via Meta Graph API.",
  },
  meta_fb: {
    name: "Facebook",
    iconClass: `${styles.sourceIcon} ${styles.sourceIconMeta}`,
    iconLetter: "FB",
    defaultDetail: "Connect to pull captions + image text via Meta Graph API.",
  },
  monday: {
    name: "Monday.com",
    iconClass: `${styles.sourceIcon} ${styles.sourceIconMonday}`,
    iconLetter: "M",
    defaultDetail: "Add API key + board IDs to sample internal copy.",
  },
  manual_upload: {
    name: "Manual references — files",
    iconClass: `${styles.sourceIcon} ${styles.sourceIconUpload}`,
    iconLetter: "F",
    defaultDetail: "Upload brandbooks, manifestos, or any reference document.",
  },
  manual_url: {
    name: "Manual references — URLs",
    iconClass: `${styles.sourceIcon} ${styles.sourceIconUpload}`,
    iconLetter: "U",
    defaultDetail: "Paste a URL to fetch and extract reference copy.",
  },
};

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
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useTranslation("brand-settings");

  const [showMondayConfig, setShowMondayConfig] = useState(false);
  const [mondayApiKeyInput, setMondayApiKeyInput] = useState("");
  const [mondayBoardIdsInput, setMondayBoardIdsInput] = useState(
    mondayBoardIds.join(", "),
  );

  const [showMetaConfig, setShowMetaConfig] = useState(false);
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
      const inferred = uploadFetcher.data.inferred ?? 0;
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

  return (
    <s-page heading={t("toneSources.pageHeading", { defaultValue: "Tone of voice sources" })}>
      <s-button variant="tertiary" slot="secondary-actions">
        <Link
          to="/app/brand-settings"
          style={{ color: "inherit", textDecoration: "none" }}
        >
          {t("common:button.back", { defaultValue: "Back" })}
        </Link>
      </s-button>
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
          {sources.map((source) => {
            const display = SOURCE_DISPLAY[source.sourceType];
            const sampledRelative = formatRelative(source.lastSampledAt);
            const detail = source.detail
              ? sampledRelative
                ? `${source.detail} · sampled ${sampledRelative}`
                : source.detail
              : display.defaultDetail;

            return (
              <div className={styles.sourceRow} key={source.sourceType}>
                <div className={display.iconClass}>{display.iconLetter}</div>
                <div className={styles.sourceMeta}>
                  <div className={styles.sourceName}>{display.name}</div>
                  <div className={styles.sourceDetail}>{detail}</div>
                </div>
                {source.status === "connected" ? (
                  <span
                    className={`${styles.statusPill} ${styles.statusPillConnected}`}
                  >
                    {t("toneSources.status.connected", {
                      defaultValue: "Connected",
                    })}
                  </span>
                ) : (
                  <span
                    className={`${styles.statusPill} ${styles.statusPillNotConfigured}`}
                  >
                    {t("toneSources.status.notConfigured", {
                      defaultValue: "Not configured",
                    })}
                  </span>
                )}
                {source.sourceType === "shopify_blog" ? (
                  <fetcher.Form method="POST">
                    <input
                      type="hidden"
                      name="intent"
                      value="refreshShopify"
                    />
                    <s-button
                      type="submit"
                      variant="tertiary"
                      {...(isRefreshingShopify
                        ? { loading: true, disabled: true }
                        : {})}
                    >
                      {t("toneSources.actions.refresh", {
                        defaultValue: "Refresh",
                      })}
                    </s-button>
                  </fetcher.Form>
                ) : source.sourceType === "manual_upload" ||
                  source.sourceType === "manual_url" ? (
                  <span style={{ width: 96 }} />
                ) : source.sourceType === "meta_ig" ||
                  source.sourceType === "meta_fb" ? (
                  metaConfigured ? (
                    <fetcher.Form method="POST">
                      <input
                        type="hidden"
                        name="intent"
                        value="refreshMeta"
                      />
                      <s-button
                        type="submit"
                        variant="tertiary"
                        {...(isRefreshingMeta
                          ? { loading: true, disabled: true }
                          : {})}
                      >
                        {t("toneSources.actions.refresh", {
                          defaultValue: "Refresh",
                        })}
                      </s-button>
                    </fetcher.Form>
                  ) : (
                    <s-button
                      variant="tertiary"
                      onClick={() => setShowMetaConfig((prev) => !prev)}
                    >
                      {t("toneSources.actions.configure", {
                        defaultValue: "Configure",
                      })}
                    </s-button>
                  )
                ) : source.sourceType === "monday" ? (
                  mondayConfigured ? (
                    <fetcher.Form method="POST">
                      <input
                        type="hidden"
                        name="intent"
                        value="refreshMonday"
                      />
                      <s-button
                        type="submit"
                        variant="tertiary"
                        {...(isRefreshingMonday
                          ? { loading: true, disabled: true }
                          : {})}
                      >
                        {t("toneSources.actions.refresh", {
                          defaultValue: "Refresh",
                        })}
                      </s-button>
                    </fetcher.Form>
                  ) : (
                    <s-button
                      variant="tertiary"
                      onClick={() => setShowMondayConfig((prev) => !prev)}
                    >
                      {t("toneSources.actions.configure", {
                        defaultValue: "Configure",
                      })}
                    </s-button>
                  )
                ) : (
                  <s-button variant="tertiary" disabled>
                    {t("toneSources.actions.configureSoon", {
                      defaultValue: "Coming soon",
                    })}
                  </s-button>
                )}
              </div>
            );
          })}
        </div>

        {(showMetaConfig || metaConfigured) && (
          <div
            style={{
              marginTop: 14,
              padding: 16,
              border: "1px solid #e1e3e5",
              borderRadius: 8,
              background: "#fafafa",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {t("toneSources.meta.title", {
                defaultValue: "Instagram & Facebook configuration",
              })}
            </div>
            <div
              style={{ fontSize: 12, color: "#6d7175", marginBottom: 12 }}
            >
              {t("toneSources.meta.description", {
                defaultValue:
                  "Generate a long-lived Page Access Token in Meta Business Suite (Settings → Users → System Users → Generate token). Provide the IG Business ID and/or FB Page ID for accounts you want sampled.",
              })}
            </div>
            <fetcher.Form method="POST">
              <input
                type="hidden"
                name="intent"
                value="saveMetaConfig"
              />
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#6d7175",
                    marginBottom: 4,
                  }}
                >
                  {t("toneSources.meta.token", {
                    defaultValue: "Long-lived Page Access Token",
                  })}
                </label>
                <input
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
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    border: "1px solid #e1e3e5",
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6d7175",
                      marginBottom: 4,
                    }}
                  >
                    {t("toneSources.meta.igBusinessId", {
                      defaultValue: "Instagram Business ID",
                    })}
                  </label>
                  <input
                    type="text"
                    name="metaIgBusinessId"
                    value={metaIgInput}
                    onChange={(e) => setMetaIgInput(e.target.value)}
                    placeholder="17841400000000000"
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      border: "1px solid #e1e3e5",
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6d7175",
                      marginBottom: 4,
                    }}
                  >
                    {t("toneSources.meta.fbPageId", {
                      defaultValue: "Facebook Page ID",
                    })}
                  </label>
                  <input
                    type="text"
                    name="metaFbPageId"
                    value={metaFbInput}
                    onChange={(e) => setMetaFbInput(e.target.value)}
                    placeholder="100000000000000"
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      border: "1px solid #e1e3e5",
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                {metaConfigured && (
                  <fetcher.Form method="POST">
                    <input
                      type="hidden"
                      name="intent"
                      value="clearMetaConfig"
                    />
                    <s-button type="submit" variant="tertiary" tone="critical">
                      {t("toneSources.meta.disconnect", {
                        defaultValue: "Disconnect",
                      })}
                    </s-button>
                  </fetcher.Form>
                )}
                <s-button
                  type="submit"
                  variant="primary"
                  {...(isSavingMeta
                    ? { loading: true, disabled: true }
                    : {})}
                >
                  {t("toneSources.meta.save", {
                    defaultValue: "Save Meta config",
                  })}
                </s-button>
              </div>
            </fetcher.Form>
          </div>
        )}

        {(showMondayConfig || mondayConfigured) && (
          <div
            style={{
              marginTop: 14,
              padding: 16,
              border: "1px solid #e1e3e5",
              borderRadius: 8,
              background: "#fafafa",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {t("toneSources.monday.title", {
                defaultValue: "Monday.com configuration",
              })}
            </div>
            <div
              style={{ fontSize: 12, color: "#6d7175", marginBottom: 12 }}
            >
              {t("toneSources.monday.description", {
                defaultValue:
                  "Generate an API key in Monday.com (Profile → Admin → API). Paste your board IDs comma-separated.",
              })}
            </div>
            <fetcher.Form method="POST">
              <input
                type="hidden"
                name="intent"
                value="saveMondayConfig"
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6d7175",
                      marginBottom: 4,
                    }}
                  >
                    {t("toneSources.monday.apiKey", {
                      defaultValue: "API key",
                    })}
                  </label>
                  <input
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
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      border: "1px solid #e1e3e5",
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6d7175",
                      marginBottom: 4,
                    }}
                  >
                    {t("toneSources.monday.boardIds", {
                      defaultValue: "Board IDs (comma-separated)",
                    })}
                  </label>
                  <input
                    type="text"
                    name="mondayBoardIds"
                    value={mondayBoardIdsInput}
                    onChange={(e) =>
                      setMondayBoardIdsInput(e.target.value)
                    }
                    placeholder="123456789, 987654321"
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      border: "1px solid #e1e3e5",
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
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
                  {...(isSavingMonday
                    ? { loading: true, disabled: true }
                    : {})}
                >
                  {t("toneSources.monday.save", {
                    defaultValue: "Save Monday.com config",
                  })}
                </s-button>
              </div>
            </fetcher.Form>
          </div>
        )}

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
                variant="tertiary"
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
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#6d7175",
                marginBottom: 8,
              }}
            >
              {t("toneSources.upload.referencesHeading", {
                defaultValue: "Manual references",
              })}
            </div>
            {manualReferences.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 12px",
                  borderBottom: "1px solid #f1f1f1",
                  fontSize: 12,
                }}
              >
                <span style={{ flex: 1 }}>
                  {r.sourceType === "manual_upload"
                    ? r.filename ?? "(file)"
                    : r.sourceUrl ?? "(url)"}
                </span>
                <span style={{ color: "#6d7175" }}>{r.charCount} chars</span>
                <span style={{ color: "#6d7175" }}>
                  {formatRelative(r.capturedAt)}
                </span>
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
            to="/app/brand-settings"
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

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
