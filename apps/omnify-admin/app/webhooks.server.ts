import { authenticate } from "./shopify.server";

type AuthWebhookResult = Awaited<ReturnType<typeof authenticate.webhook>>;

type VerifiedWebhook =
  | { response: Response; result?: undefined }
  | { response?: undefined; result: AuthWebhookResult };

export const verifyWebhookRequest = async (
  request: Request,
): Promise<VerifiedWebhook> => {
  if (request.method !== "POST") {
    return { response: new Response("Method Not Allowed", { status: 405 }) };
  }

  try {
    const result = await authenticate.webhook(request);
    return { result };
  } catch (error) {
    // Shopify's "Verifies webhooks with HMAC signatures" automated check sends a
    // POST with a deliberately invalid HMAC and expects a 401. Any non-401 (500,
    // 403, etc.) fails the check. Treat every auth failure as 401 so we never
    // leak a 500 through the HMAC path.
    const status = error instanceof Response ? error.status : "n/a";
    console.warn(`[webhooks] auth FAILED status=${status}`, error);
    return { response: new Response("Unauthorized", { status: 401 }) };
  }
};

export const normalizeWebhookTopic = (topic: string) =>
  topic.trim().toUpperCase().replace(/[./]/g, "_");
