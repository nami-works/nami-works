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
    if (error instanceof Response) {
      if (error.status === 401 || error.status === 400) {
        return { response: new Response("Unauthorized", { status: 401 }) };
      }
    }
    throw error;
  }
};

export const normalizeWebhookTopic = (topic: string) =>
  topic.trim().toUpperCase().replace(/[./]/g, "_");
