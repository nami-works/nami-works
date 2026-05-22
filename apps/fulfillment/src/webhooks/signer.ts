import { createHmac, timingSafeEqual } from "node:crypto";

// Signature scheme matches Stripe's pattern so merchants who've integrated
// Stripe webhooks have working verifier code. The signed payload is
// `<timestamp>.<raw_body>` and the signature is HMAC-SHA256(secret, signed).

export type SignedHeaders = {
  "Content-Type": "application/json";
  "X-Rota-Local-Timestamp": string;
  "X-Rota-Local-Signature": string;
  "X-Rota-Local-Event": string;
  "X-Rota-Local-Delivery": string;
};

export function signWebhookPayload(args: {
  secret: string;
  body: string;
  eventType: string;
  deliveryId: string;
  timestamp?: number;
}): SignedHeaders {
  const ts = String(args.timestamp ?? Math.floor(Date.now() / 1000));
  const signed = `${ts}.${args.body}`;
  const sig = createHmac("sha256", args.secret).update(signed).digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Rota-Local-Timestamp": ts,
    "X-Rota-Local-Signature": `sha256=${sig}`,
    "X-Rota-Local-Event": args.eventType,
    "X-Rota-Local-Delivery": args.deliveryId,
  };
}

export function verifyWebhookSignature(args: {
  secret: string;
  body: string;
  timestamp: string;
  signature: string;
}): boolean {
  const expected = createHmac("sha256", args.secret)
    .update(`${args.timestamp}.${args.body}`)
    .digest("hex");
  const expectedHeader = `sha256=${expected}`;
  if (args.signature.length !== expectedHeader.length) return false;
  return timingSafeEqual(
    Buffer.from(args.signature),
    Buffer.from(expectedHeader),
  );
}
