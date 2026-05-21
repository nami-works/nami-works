import { prisma } from "../../db/prisma.js";
import { rootLogger } from "../../lib/logger.js";
import { decryptSecret, encryptSecret } from "../security/encryption.js";
import { extractTextFromImage } from "./claude.js";

// Meta Graph API adapter for Instagram + Facebook captions. Credentials live
// encrypted in BrandIntegrationConfig (one row per tenant, integrationType =
// "meta"). Captions plus optional Claude-vision OCR over post images land as
// BrandToneSource rows with sourceType = "meta_ig" or "meta_fb".

const META_GRAPH_API = "https://graph.facebook.com/v19.0";
const MAX_POSTS_PER_SOURCE = 50;
const MAX_OCR_PER_RUN = 50;

type MetaConfig = {
  accessToken: string;
  igBusinessId: string | null;
  fbPageId: string | null;
};

export async function saveMetaConfig(input: {
  tenantId: string;
  tenantSlug: string;
  accessToken: string;
  igBusinessId: string | null;
  fbPageId: string | null;
}): Promise<void> {
  const payload = JSON.stringify({
    accessToken: input.accessToken.trim(),
    igBusinessId: input.igBusinessId?.trim() || null,
    fbPageId: input.fbPageId?.trim() || null,
  });
  const { ciphertext, keyVersion } = encryptSecret(payload);

  await prisma.brandIntegrationConfig.upsert({
    where: {
      tenantId_integrationType: {
        tenantId: input.tenantId,
        integrationType: "meta",
      },
    },
    create: {
      tenantId: input.tenantId,
      integrationType: "meta",
      configCipher: ciphertext,
      keyVersion,
      enabled: true,
    },
    update: {
      configCipher: ciphertext,
      keyVersion,
      enabled: true,
    },
  });
  rootLogger
    .child({ tenant: input.tenantSlug, component: "tone-meta" })
    .info("config saved");
}

export async function getMetaConfig(input: {
  tenantId: string;
  tenantSlug: string;
}): Promise<MetaConfig | null> {
  const row = await prisma.brandIntegrationConfig.findUnique({
    where: {
      tenantId_integrationType: {
        tenantId: input.tenantId,
        integrationType: "meta",
      },
    },
  });
  if (!row || !row.enabled) return null;
  try {
    const decrypted = decryptSecret(row.configCipher);
    const parsed = JSON.parse(decrypted) as MetaConfig;
    if (!parsed.accessToken) return null;
    return parsed;
  } catch (err) {
    rootLogger
      .child({ tenant: input.tenantSlug, component: "tone-meta" })
      .error({ err }, "decrypt FAILED");
    return null;
  }
}

export async function clearMetaConfig(input: {
  tenantId: string;
  tenantSlug: string;
}): Promise<void> {
  await prisma.brandIntegrationConfig.deleteMany({
    where: { tenantId: input.tenantId, integrationType: "meta" },
  });
  rootLogger
    .child({ tenant: input.tenantSlug, component: "tone-meta" })
    .info("config cleared");
}

type IgMedia = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  permalink?: string;
  timestamp?: string;
};

type FbPost = {
  id: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  created_time?: string;
};

async function fetchInstagram(input: {
  accessToken: string;
  igBusinessId: string;
}): Promise<IgMedia[] | { error: string }> {
  const url = `${META_GRAPH_API}/${input.igBusinessId}/media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=${MAX_POSTS_PER_SOURCE}&access_token=${encodeURIComponent(input.accessToken)}`;
  try {
    const response = await fetch(url);
    const json = (await response.json()) as {
      data?: IgMedia[];
      error?: { message?: string };
    };
    if (!response.ok || json.error) {
      return { error: json.error?.message || `Meta IG API ${response.status}` };
    }
    return json.data ?? [];
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Meta IG fetch failed.",
    };
  }
}

async function fetchFacebook(input: {
  accessToken: string;
  fbPageId: string;
}): Promise<FbPost[] | { error: string }> {
  const url = `${META_GRAPH_API}/${input.fbPageId}/posts?fields=id,message,full_picture,permalink_url,created_time&limit=${MAX_POSTS_PER_SOURCE}&access_token=${encodeURIComponent(input.accessToken)}`;
  try {
    const response = await fetch(url);
    const json = (await response.json()) as {
      data?: FbPost[];
      error?: { message?: string };
    };
    if (!response.ok || json.error) {
      return { error: json.error?.message || `Meta FB API ${response.status}` };
    }
    return json.data ?? [];
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Meta FB fetch failed.",
    };
  }
}

export async function ingestMeta(input: {
  tenantId: string;
  tenantSlug: string;
  batchId: string;
}): Promise<
  { sampled: number; skipped: number; ocrCount: number } | { error: string }
> {
  const { tenantId, tenantSlug, batchId } = input;
  const log = rootLogger.child({ tenant: tenantSlug, component: "tone-meta" });
  const config = await getMetaConfig({ tenantId, tenantSlug });
  if (!config) {
    return { error: "Meta is not configured." };
  }

  log.info("ingest START");

  let sampled = 0;
  let skipped = 0;
  let ocrCount = 0;

  if (config.igBusinessId) {
    const media = await fetchInstagram({
      accessToken: config.accessToken,
      igBusinessId: config.igBusinessId,
    });
    if ("error" in media) {
      log.warn({ reason: media.error }, "ig fetch SKIP");
    } else {
      for (const m of media) {
        const captionText = m.caption?.trim() ?? "";

        let imageText = "";
        if (
          ocrCount < MAX_OCR_PER_RUN &&
          m.media_type === "IMAGE" &&
          m.media_url
        ) {
          const ocr = await extractTextFromImage({
            tenantSlug,
            imageUrl: m.media_url,
          });
          if (!("error" in ocr)) {
            imageText = ocr.text.trim();
            ocrCount += 1;
          }
        }

        const combined = [
          captionText,
          imageText ? `[image text]\n${imageText}` : null,
        ]
          .filter(Boolean)
          .join("\n\n")
          .trim();

        if (combined.length < 50) {
          skipped += 1;
          continue;
        }

        await prisma.brandToneSource.upsert({
          where: {
            tenantId_sourceType_sourceId: {
              tenantId,
              sourceType: "meta_ig",
              sourceId: m.id,
            },
          },
          create: {
            tenantId,
            sourceType: "meta_ig",
            sourceId: m.id,
            sourceUrl: m.permalink ?? null,
            rawText: combined.slice(0, 50_000),
            metaJson: {
              mediaType: m.media_type,
              timestamp: m.timestamp,
              hasOcr: imageText.length > 0,
            },
            batchId,
          },
          update: {
            rawText: combined.slice(0, 50_000),
            capturedAt: new Date(),
            batchId,
            metaJson: {
              mediaType: m.media_type,
              timestamp: m.timestamp,
              hasOcr: imageText.length > 0,
            },
          },
        });
        sampled += 1;
      }
    }
  }

  if (config.fbPageId) {
    const posts = await fetchFacebook({
      accessToken: config.accessToken,
      fbPageId: config.fbPageId,
    });
    if ("error" in posts) {
      log.warn({ reason: posts.error }, "fb fetch SKIP");
    } else {
      for (const p of posts) {
        const messageText = p.message?.trim() ?? "";

        let imageText = "";
        if (ocrCount < MAX_OCR_PER_RUN && p.full_picture) {
          const ocr = await extractTextFromImage({
            tenantSlug,
            imageUrl: p.full_picture,
          });
          if (!("error" in ocr)) {
            imageText = ocr.text.trim();
            ocrCount += 1;
          }
        }

        const combined = [
          messageText,
          imageText ? `[image text]\n${imageText}` : null,
        ]
          .filter(Boolean)
          .join("\n\n")
          .trim();

        if (combined.length < 50) {
          skipped += 1;
          continue;
        }

        await prisma.brandToneSource.upsert({
          where: {
            tenantId_sourceType_sourceId: {
              tenantId,
              sourceType: "meta_fb",
              sourceId: p.id,
            },
          },
          create: {
            tenantId,
            sourceType: "meta_fb",
            sourceId: p.id,
            sourceUrl: p.permalink_url ?? null,
            rawText: combined.slice(0, 50_000),
            metaJson: {
              createdTime: p.created_time,
              hasOcr: imageText.length > 0,
            },
            batchId,
          },
          update: {
            rawText: combined.slice(0, 50_000),
            capturedAt: new Date(),
            batchId,
            metaJson: {
              createdTime: p.created_time,
              hasOcr: imageText.length > 0,
            },
          },
        });
        sampled += 1;
      }
    }
  }

  log.info({ sampled, skipped, ocrCount }, "ingest OK");
  return { sampled, skipped, ocrCount };
}
