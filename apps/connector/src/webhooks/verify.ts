import { createHmac, timingSafeEqual } from "node:crypto";

// Shopify signs the raw request body with the app's client secret, base64
// HMAC-SHA256, in the X-Shopify-Hmac-Sha256 header. Verification against the
// RAW bytes is mandatory before trusting any webhook payload — non-negotiable
// per .claude/initiatives/realtime-credit-webhook.md, not a nice-to-have.
export function verifyShopifyHmac(
  rawBody: Buffer,
  hmacHeader: string | undefined,
  secret: string,
): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
