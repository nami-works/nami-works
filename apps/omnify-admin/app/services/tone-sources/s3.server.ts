import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const DEFAULT_BUCKET = "cpg-labs-tone-uploads";

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

function objectKey(shop: string, sourceId: string): string {
  const safeShop = shop.replace(/[^a-zA-Z0-9.-]/g, "_");
  const safeId = sourceId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `shops/${safeShop}/tone-uploads/${safeId}`;
}

export function isS3Configured(): boolean {
  return Boolean(process.env.AWS_REGION || process.env.TONE_UPLOADS_S3_BUCKET);
}

export async function uploadToneFile(input: {
  shop: string;
  sourceId: string;
  body: Buffer;
  contentType: string;
  filename: string;
}): Promise<{ key: string } | { error: string }> {
  const key = objectKey(input.shop, input.sourceId);
  const bucket = getBucket();
  try {
    console.info(
      `[tone-sources:s3] upload START shop=${input.shop} key=${key} bytes=${input.body.length}`,
    );
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
    console.info(`[tone-sources:s3] upload OK shop=${input.shop} key=${key}`);
    return { key };
  } catch (err) {
    console.error(`[tone-sources:s3] upload FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "S3 upload failed.",
    };
  }
}

export async function downloadToneFile(input: {
  shop: string;
  key: string;
}): Promise<{ body: Buffer; contentType: string | null } | { error: string }> {
  const bucket = getBucket();
  try {
    console.info(
      `[tone-sources:s3] download START shop=${input.shop} key=${input.key}`,
    );
    const response = await getClient().send(
      new GetObjectCommand({ Bucket: bucket, Key: input.key }),
    );
    if (!response.Body) {
      return { error: "S3 returned no body." };
    }
    const stream = response.Body as { transformToByteArray(): Promise<Uint8Array> };
    const bytes = await stream.transformToByteArray();
    const body = Buffer.from(bytes);
    console.info(
      `[tone-sources:s3] download OK shop=${input.shop} key=${input.key} bytes=${body.length}`,
    );
    return {
      body,
      contentType: response.ContentType ?? null,
    };
  } catch (err) {
    console.error(`[tone-sources:s3] download FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "S3 download failed.",
    };
  }
}

export async function deleteToneFile(input: {
  shop: string;
  key: string;
}): Promise<{ ok: true } | { error: string }> {
  const bucket = getBucket();
  try {
    console.info(
      `[tone-sources:s3] delete START shop=${input.shop} key=${input.key}`,
    );
    await getClient().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: input.key }),
    );
    console.info(`[tone-sources:s3] delete OK shop=${input.shop} key=${input.key}`);
    return { ok: true };
  } catch (err) {
    console.error(`[tone-sources:s3] delete FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "S3 delete failed.",
    };
  }
}
