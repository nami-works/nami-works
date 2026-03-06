import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { normalizeWebhookTopic, verifyWebhookRequest } from "../webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { shop, session, topic } = verified.result;
  if (normalizeWebhookTopic(String(topic)) !== "APP_UNINSTALLED") {
    return new Response("Unsupported webhook topic.", { status: 400 });
  }

  console.log(`Received ${topic} webhook for ${shop}`);

  // Clean up carrier service data so re-install gets a fresh state.
  await db.carrierServiceRegistration.deleteMany({ where: { shop } });
  await db.carrierServiceConfig.deleteMany({ where: { shop } });
  await db.lalamoveShopCredential.deleteMany({ where: { shop } });

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
