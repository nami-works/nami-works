import prisma from "../../db.server";
import {
  decryptSecret,
  encryptSecret,
} from "../security/encryption.server";
import { extractTextFromImage } from "../claude/client.server";

const META_GRAPH_API = "https://graph.facebook.com/v19.0";
const MAX_POSTS_PER_SOURCE = 50;
const MAX_OCR_PER_RUN = 50;
const MAX_OCR_IMAGE_SIZE = 1024;

type MetaConfig = {
  accessToken: string;
  igBusinessId: string | null;
  fbPageId: string | null;
};

export async function saveMetaConfig(input: {
  shop: string;
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
      shop_integrationType: { shop: input.shop, integrationType: "meta" },
    },
    create: {
      shop: input.shop,
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
  console.info(`[tone-sources:meta] config saved shop=${input.shop}`);
}

export async function getMetaConfig(shop: string): Promise<MetaConfig | null> {
  const row = await prisma.brandIntegrationConfig.findUnique({
    where: { shop_integrationType: { shop, integrationType: "meta" } },
  });
  if (!row || !row.enabled) return null;
  try {
    const decrypted = decryptSecret(row.configCipher);
    const parsed = JSON.parse(decrypted) as MetaConfig;
    if (!parsed.accessToken) return null;
    return parsed;
  } catch (err) {
    console.error(`[tone-sources:meta] decrypt FAILED shop=${shop}`, err);
    return null;
  }
}

export async function clearMetaConfig(shop: string): Promise<void> {
  await prisma.brandIntegrationConfig.deleteMany({
    where: { shop, integrationType: "meta" },
  });
  console.info(`[tone-sources:meta] config cleared shop=${shop}`);
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
  shop: string;
  batchId: string;
}): Promise<
  { sampled: number; skipped: number; ocrCount: number } | { error: string }
> {
  const { shop, batchId } = input;
  const config = await getMetaConfig(shop);
  if (!config) {
    return { error: "Meta is not configured." };
  }

  console.info(`[tone-sources:meta] ingest START shop=${shop}`);

  let sampled = 0;
  let skipped = 0;
  let ocrCount = 0;

  // ── Instagram ──────────────────────────────────────────────────────
  if (config.igBusinessId) {
    const media = await fetchInstagram({
      accessToken: config.accessToken,
      igBusinessId: config.igBusinessId,
    });
    if ("error" in media) {
      console.warn(
        `[tone-sources:meta] ig fetch SKIP shop=${shop} reason=${media.error}`,
      );
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
            shop,
            imageUrl: m.media_url,
            maxDimension: MAX_OCR_IMAGE_SIZE,
          });
          if (!("error" in ocr)) {
            imageText = ocr.text.trim();
            ocrCount += 1;
          }
        }

        const combined = [captionText, imageText ? `[image text]\n${imageText}` : null]
          .filter(Boolean)
          .join("\n\n")
          .trim();

        if (combined.length < 50) {
          skipped += 1;
          continue;
        }

        await prisma.brandToneSource.upsert({
          where: {
            shop_sourceType_sourceId: {
              shop,
              sourceType: "meta_ig",
              sourceId: m.id,
            },
          },
          create: {
            shop,
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

  // ── Facebook ───────────────────────────────────────────────────────
  if (config.fbPageId) {
    const posts = await fetchFacebook({
      accessToken: config.accessToken,
      fbPageId: config.fbPageId,
    });
    if ("error" in posts) {
      console.warn(
        `[tone-sources:meta] fb fetch SKIP shop=${shop} reason=${posts.error}`,
      );
    } else {
      for (const p of posts) {
        const messageText = p.message?.trim() ?? "";

        let imageText = "";
        if (ocrCount < MAX_OCR_PER_RUN && p.full_picture) {
          const ocr = await extractTextFromImage({
            shop,
            imageUrl: p.full_picture,
            maxDimension: MAX_OCR_IMAGE_SIZE,
          });
          if (!("error" in ocr)) {
            imageText = ocr.text.trim();
            ocrCount += 1;
          }
        }

        const combined = [messageText, imageText ? `[image text]\n${imageText}` : null]
          .filter(Boolean)
          .join("\n\n")
          .trim();

        if (combined.length < 50) {
          skipped += 1;
          continue;
        }

        await prisma.brandToneSource.upsert({
          where: {
            shop_sourceType_sourceId: {
              shop,
              sourceType: "meta_fb",
              sourceId: p.id,
            },
          },
          create: {
            shop,
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

  console.info(
    `[tone-sources:meta] ingest OK shop=${shop} sampled=${sampled} skipped=${skipped} ocr=${ocrCount}`,
  );
  return { sampled, skipped, ocrCount };
}
