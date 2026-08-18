import type { ActionFunctionArgs } from "react-router";
import { verifyWebhookRequest } from "../webhooks.server.js";
import { sessionStorage } from "../shopify.server.js";

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { session } = verified.result;
  if (session) {
    await sessionStorage.deleteSessions([session.id]);
  }
  return new Response();
};
