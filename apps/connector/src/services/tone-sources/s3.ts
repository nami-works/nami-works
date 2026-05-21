import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { rootLogger } from "../../lib/logger.js";

// Tenant-scoped S3 client for manual-reference binary storage. One bucket,
// tenant-prefixed keys. Bucket + region come from env so terraform owns the
// actual values; the default is the nami-works production bucket.

const DEFAULT_BUCKET = "nami-works-tone-uploads";

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
    });
  }
  return cachedClient;
}

function getBucket(): string {
  return process.env.TONE_UPLOADS_S3_BUCKET ?? DEFAULT_BUCKET;
}

function objectKey(tenantSlug: string, sourceId: string): string {
  const safeSlug = tenantSlug.replace(/[^a-zA-Z0-9.-]/g, "_");
  const safeId = sourceId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `tenants/${safeSlug}/tone-uploads/${safeId}`;
}

export function isS3Configured(): boolean {
  return Boolean(process.env.AWS_REGION || process.env.TONE_UPLOADS_S3_BUCKET);
}

export async function uploadToneFile(input: {
  tenantSlug: string;
  sourceId: string;
  body: Buffer;
  contentType: string;
  filename: string;
}): Promise<{ key: string } | { error: string }> {
  const key = objectKey(input.tenantSlug, input.sourceId);
  const bucket = getBucket();
  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "tone-s3",
  });
  try {
    log.info({ key, bytes: input.body.length }, "upload START");
    await getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: {
          filename: input.filename,
        },
      }),
    );
    log.info({ key }, "upload OK");
    return { key };
  } catch (err) {
    log.error({ err }, "upload FAILED");
    return {
      error: err instanceof Error ? err.message : "S3 upload failed.",
    };
  }
}

export async function downloadToneFile(input: {
  tenantSlug: string;
  key: string;
}): Promise<{ body: Buffer; contentType: string | null } | { error: string }> {
  const bucket = getBucket();
  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "tone-s3",
  });
  try {
    log.info({ key: input.key }, "download START");
    const response = await getClient().send(
      new GetObjectCommand({ Bucket: bucket, Key: input.key }),
    );
    if (!response.Body) {
      return { error: "S3 returned no body." };
    }
    const stream = response.Body as {
      transformToByteArray(): Promise<Uint8Array>;
    };
    const bytes = await stream.transformToByteArray();
    const body = Buffer.from(bytes);
    log.info({ key: input.key, bytes: body.length }, "download OK");
    return {
      body,
      contentType: response.ContentType ?? null,
    };
  } catch (err) {
    log.error({ err }, "download FAILED");
    return {
      error: err instanceof Error ? err.message : "S3 download failed.",
    };
  }
}

export async function deleteToneFile(input: {
  tenantSlug: string;
  key: string;
}): Promise<{ ok: true } | { error: string }> {
  const bucket = getBucket();
  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "tone-s3",
  });
  try {
    log.info({ key: input.key }, "delete START");
    await getClient().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: input.key }),
    );
    log.info({ key: input.key }, "delete OK");
    return { ok: true };
  } catch (err) {
    log.error({ err }, "delete FAILED");
    return {
      error: err instanceof Error ? err.message : "S3 delete failed.",
    };
  }
}
