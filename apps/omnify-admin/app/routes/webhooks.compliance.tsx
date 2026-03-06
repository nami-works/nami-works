import type { ActionFunctionArgs } from "react-router";
import { verifyWebhookRequest } from "../webhooks.server";
import { handleComplianceWebhook } from "../webhooks/compliance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { topic, shop, payload } = verified.result;
  const handled = await handleComplianceWebhook(topic, shop, payload as any);
  if (!handled) {
    return new Response("Unsupported webhook topic.", { status: 400 });
  }
  return new Response();
};
