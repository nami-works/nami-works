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

  console.info(`[webhooks:uninstall] received topic=${topic} shop=${shop}`);

  // Clean up carrier service data so re-install gets a fresh state.
  console.info(`[webhooks:uninstall] delete carrier service data START shop=${shop}`);
  await db.carrierServiceRegistration.deleteMany({ where: { shop } });
  await db.carrierServiceConfig.deleteMany({ where: { shop } });
  await db.lalamoveShopCredential.deleteMany({ where: { shop } });
  console.info(`[webhooks:uninstall] delete carrier service data OK shop=${shop}`);

  // Clean up price tags data.
  console.info(`[webhooks:uninstall] delete price tags data START shop=${shop}`);
  await db.priceTagProductLog.deleteMany({ where: { shop } });
  await db.priceTagTierRule.deleteMany({ where: { shop } });
  await db.priceTagConfig.deleteMany({ where: { shop } });
  console.info(`[webhooks:uninstall] delete price tags data OK shop=${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    console.info(`[webhooks:uninstall] delete sessions START shop=${shop}`);
    await db.session.deleteMany({ where: { shop } });
    console.info(`[webhooks:uninstall] delete sessions OK shop=${shop}`);
  } else {
    console.warn(`[webhooks:uninstall] delete sessions SKIP shop=${shop} reason=no session (may have already been cleaned up)`);
  }

  return new Response();
};
