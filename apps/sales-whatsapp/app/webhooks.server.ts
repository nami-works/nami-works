import { authenticate } from "./shopify.server.js";

type AuthWebhookResult = Awaited<ReturnType<typeof authenticate.webhook>>;
type VerifiedWebhook = { response: Response; result?: undefined } | { response?: undefined; result: AuthWebhookResult };

// Same shape as omnify-admin's webhooks.server.ts, reimplemented here rather
// than imported — the pattern is worth reusing verbatim, the code isn't
// worth a cross-app dependency. Same lesson baked in: Shopify's automated
// "verifies webhooks with HMAC signatures" check sends a deliberately
// invalid HMAC and expects exactly 401 back, never a 500.
export const verifyWebhookRequest = async (request: Request): Promise<VerifiedWebhook> => {
  if (request.method !== "POST") {
    return { response: new Response("Method Not Allowed", { status: 405 }) };
  }
  try {
    const result = await authenticate.webhook(request);
    return { result };
  } catch (error) {
    const status = error instanceof Response ? error.status : "n/a";
    console.warn(`[webhooks] auth FAILED status=${status}`, error);
    return { response: new Response("Unauthorized", { status: 401 }) };
  }
};
