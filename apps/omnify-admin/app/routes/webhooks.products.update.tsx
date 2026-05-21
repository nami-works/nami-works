import type { ActionFunctionArgs } from "react-router";
import { normalizeWebhookTopic, verifyWebhookRequest } from "../webhooks.server";
import { handleProductUpdate } from "../services/price-tags/webhook-handler.server";
import { ingestProduct } from "../services/shop-ingest/products.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { topic, payload, shop, admin } = verified.result;
  if (normalizeWebhookTopic(String(topic)) !== "PRODUCTS_UPDATE") {
    return new Response("Unsupported webhook topic.", { status: 400 });
  }

  console.info(`[webhooks:products] received topic=${topic} shop=${shop}`);

  if (!admin) {
    console.warn(`[webhooks:products] no admin context SKIP shop=${shop} reason=missing admin session`);
    return new Response();
  }

  const productGid = payload.admin_graphql_api_id as string;
  if (!productGid || !productGid.startsWith("gid://shopify/Product/")) {
    console.warn(`[webhooks:products] invalid productGid SKIP shop=${shop} productGid=${productGid ?? "?"}`);
    return new Response();
  }

  // Only process when variant pricing data is present in the payload.
  // Metafield-only updates do not include variants, avoiding infinite loops.
  const variants = (payload.variants ?? []) as Array<{
    price?: string;
    compare_at_price?: string | null;
  }>;

  if (variants.length === 0) {
    console.warn(`[webhooks:products] no variant data SKIP shop=${shop} productGid=${productGid} reason=metafield-only update`);
    return new Response();
  }

  // Shadow-mode: upsert canonical ShopProduct row. Additive — existing
  // price-tag handler still runs below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ingestProduct(shop, payload as any, "webhook").catch((err) =>
    console.warn(
      `[shop-ingest:products] ingest SKIP shop=${shop} productGid=${productGid}`,
      err,
    ),
  );

  console.info(`[webhooks:products] handleProductUpdate START shop=${shop} productGid=${productGid}`);
  try {
    const result = await handleProductUpdate(admin, shop, productGid);
    console.info(`[webhooks:products] handleProductUpdate OK shop=${shop} productGid=${productGid} action=${result.action} tagCreated=${result.tagCreated} tagAssigned=${result.tagAssigned}`);
  } catch (error) {
    console.error(`[webhooks:products] handleProductUpdate FAILED shop=${shop} productGid=${productGid}`, error);
  }

  return new Response();
};
